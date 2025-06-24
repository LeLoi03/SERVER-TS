import 'reflect-metadata';
import { singleton, inject, delay } from 'tsyringe';
import { Logger } from 'pino';
import { ConferenceLogAnalysisResult } from '../types/logAnalysis';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { LogAnalysisCacheService } from './logAnalysisCache.service';
import {
    ConferenceLogReaderService,
    SingleConferenceRequestAnalyzerService,
    ConferenceAnalysisAggregatorService
} from './logAnalysis/conference';

@singleton()
export class ConferenceLogAnalysisService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(delay(() => LogAnalysisCacheService)) private cacheService: LogAnalysisCacheService,
        @inject(ConferenceLogReaderService) private logReader: ConferenceLogReaderService,
        @inject(SingleConferenceRequestAnalyzerService) private singleAnalyzer: SingleConferenceRequestAnalyzerService,
        @inject(ConferenceAnalysisAggregatorService) private aggregator: ConferenceAnalysisAggregatorService
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'ConferenceLogAnalysisService' });
    }

    /**
     * Main entry point for analysis. Orchestrates fetching, filtering, and response formatting.
     * This is the definitive, optimized logic.
     */
    async performConferenceAnalysisAndUpdate(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number,
        textFilter?: string
    ): Promise<ConferenceLogAnalysisResult> {
        const logContext = { function: 'performConferenceAnalysisAndUpdate', textFilter };
        const logger = this.serviceLogger.child(logContext);
        logger.info(`Orchestrating analysis. Text filter: '${textFilter || 'none'}'`);

        // Step 1: Discover all possible request IDs
        const allUniqueRequestIds = await this.discoverAllRequestIds();
        logger.info(`Found ${allUniqueRequestIds.length} total unique request IDs.`);

        if (allUniqueRequestIds.length === 0) {
            return this.aggregator.aggregate([]);
        }

        // Step 2: Fetch individual analysis for all requests, prioritizing cache.
        // This is efficient because our cache now contains all necessary fields for filtering.
        const allSingleAnalyses = await Promise.all(
            allUniqueRequestIds.map(id => this.analyzeSingleRequest(id, filterStartTimeInput, filterEndTimeInput))
        );

        // Step 3: Filter the complete set of results based on the textFilter
        let filteredAnalyses = allSingleAnalyses;
        if (textFilter && textFilter.trim()) {
            const lowerCaseFilter = textFilter.trim().toLowerCase();
            filteredAnalyses = allSingleAnalyses.filter(analysis => {
                const reqId = analysis?.filterRequestId;
                if (!reqId) return false;
                const reqDetails = analysis.requests?.[reqId];
                if (!reqDetails) return false;

                return (
                    reqId.toLowerCase().includes(lowerCaseFilter) ||
                    (reqDetails.originalRequestId && reqDetails.originalRequestId.toLowerCase().includes(lowerCaseFilter)) ||
                    (reqDetails.description && reqDetails.description.toLowerCase().includes(lowerCaseFilter))
                );
            });
        }
        logger.info(`Filtered down to ${filteredAnalyses.length} matching analysis results.`);

        // Step 4: Decide what to return based on the number of filtered results
        
        // Case 1: Exactly one match. Return its detailed result directly.
        if (filteredAnalyses.length === 1) {
            logger.info(`Exactly one match found. Returning its detailed analysis.`);
            const finalResult = filteredAnalyses[0];
            finalResult.filterRequestId = finalResult.analyzedRequestIds[0];
            return finalResult;
        }

        // Case 2: Multiple matches or no matches. Return an aggregated result.
        logger.info(`Multiple or no matches found. Returning an aggregated result.`);
        return this.aggregator.aggregate(filteredAnalyses);
    }

    /**
     * Discovers all request IDs from both cache and log files.
     */
    private async discoverAllRequestIds(): Promise<string[]> {
        const cachedRequestIds = await this.cacheService.getAllCachedRequestIds('conference');
        const liveRequestIds = await this.logReader.discoverRequestIdsFromLogFiles();
        return Array.from(new Set([...cachedRequestIds, ...liveRequestIds]));
    }

    /**
     * Analyzes a single request, using cache if possible.
     * This is the core data fetching unit.
     */
    private async analyzeSingleRequest(
        batchRequestId: string,
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'analyzeSingleRequest', batchRequestId });
        const hasTimeFilter = filterStartTimeInput !== undefined || filterEndTimeInput !== undefined;
        const requestLogFilePath = this.configService.getRequestSpecificLogFilePath('conference', batchRequestId);

        // Always try to read from cache first if no time filter is applied.
        if (this.configService.analysisCacheEnabled && !hasTimeFilter) {
            const cachedResult = await this.cacheService.readFromCache<ConferenceLogAnalysisResult>('conference', batchRequestId);
            // A valid cache must have a final status.
            if (cachedResult && cachedResult.status && !['Processing', 'Unknown'].includes(cachedResult.status)) {
                // logger.info(`Valid cached result found for ${batchRequestId}.`);
                return this.decorateResult(cachedResult, requestLogFilePath);
            }
        }

        // If no valid cache, perform live analysis.
        logger.info(`No valid cache for ${batchRequestId}. Performing live analysis.`);
        const saveEventsMap = await this.logReader.readConferenceSaveEvents();
        const analysisResult = await this.singleAnalyzer.analyze(
            batchRequestId,
            requestLogFilePath,
            saveEventsMap,
            filterStartTimeInput,
            filterEndTimeInput
        );

        // Cache the new result if it's final and no time filter was used.
        if (this.configService.analysisCacheEnabled && !hasTimeFilter && analysisResult.status && !['Processing', 'Unknown'].includes(analysisResult.status)) {
            await this.cacheService.writeToCache('conference', batchRequestId, analysisResult);
        }

        return analysisResult;
    }

    /**
     * Decorates a result object with additional, non-cached information like log file path.
     */
    private async decorateResult(
        result: ConferenceLogAnalysisResult,
        logFilePath: string
    ): Promise<ConferenceLogAnalysisResult> {
        result.logFilePath = logFilePath;
        result.analysisTimestamp = new Date().toISOString();
        // The save events decoration can be added here if needed, but it's better
        // to have it in the live analysis to ensure it's cached correctly.
        // For simplicity, we assume the cached data is sufficient.
        return result;
    }
}