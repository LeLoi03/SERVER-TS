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
     * Main entry point for analysis. Implements a 2-layer caching strategy.
     */
    async performConferenceAnalysisAndUpdate(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number,
        textFilter?: string
    ): Promise<ConferenceLogAnalysisResult> {
        const logContext = { function: 'performConferenceAnalysisAndUpdate', textFilter };
        const logger = this.serviceLogger.child(logContext);
        const hasFilters = filterStartTimeInput !== undefined || filterEndTimeInput !== undefined || !!textFilter;

        if (!hasFilters) {
            // SỬ DỤNG FINGERPRINT MỚI DỰA TRÊN THƯ MỤC LOG
            const currentFingerprint = await this.cacheService.generateLogStateFingerprint('conference');

            const overallCache = await this.cacheService.readOverallCache<ConferenceLogAnalysisResult>('conference');

            if (overallCache && overallCache.fingerprint === currentFingerprint) {
                return this.decorateResult(overallCache.data, 'Aggregated from cache');
            }
            const aggregatedResult = await this.performFullAggregation();
            // Lưu lại cache tổng hợp với fingerprint mới
            await this.cacheService.writeOverallCache('conference', currentFingerprint, aggregatedResult);
            return aggregatedResult;
        }
        return this.performFullAggregation(filterStartTimeInput, filterEndTimeInput, textFilter);
    }


    /**
     * This function handles the logic of fetching all individual results, filtering them,
     * and deciding whether to return a single detail view or an aggregated list view.
     */
    private async performFullAggregation(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number,
        textFilter?: string
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'performFullAggregation', textFilter });

        const allUniqueRequestIds = await this.discoverAllRequestIds();
        if (allUniqueRequestIds.length === 0) {
            return this.aggregator.aggregate([]);
        }

        // Fetch all individual analyses, prioritizing cache.
        const allSingleAnalyses = await Promise.all(
            allUniqueRequestIds.map(id => this.analyzeSingleRequest(id, filterStartTimeInput, filterEndTimeInput))
        );

        // Filter the complete set of results based on the textFilter.
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
        // Decide what to return based on the number of filtered results.
        if (filteredAnalyses.length === 1) {
            const finalResult = filteredAnalyses[0];
            finalResult.filterRequestId = finalResult.analyzedRequestIds[0];
            return finalResult;
        }
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
     */
    private async analyzeSingleRequest(
        batchRequestId: string,
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'analyzeSingleRequest', batchRequestId });
        const hasTimeFilter = filterStartTimeInput !== undefined || filterEndTimeInput !== undefined;
        const requestLogFilePath = this.configService.getRequestSpecificLogFilePath('conference', batchRequestId);

        if (this.configService.analysisCacheEnabled && !hasTimeFilter) {
            const cachedResult = await this.cacheService.readFromCache<ConferenceLogAnalysisResult>('conference', batchRequestId);
            if (cachedResult && cachedResult.status && !['Processing', 'Unknown'].includes(cachedResult.status)) {
                return this.decorateResult(cachedResult, requestLogFilePath);
            }
        }
        const saveEventsMap = await this.logReader.readConferenceSaveEvents();
        const analysisResult = await this.singleAnalyzer.analyze(
            batchRequestId,
            requestLogFilePath,
            saveEventsMap,
            filterStartTimeInput,
            filterEndTimeInput
        );

        if (this.configService.analysisCacheEnabled && !hasTimeFilter && analysisResult.status && !['Processing', 'Unknown'].includes(analysisResult.status)) {
            await this.cacheService.writeToCache('conference', batchRequestId, analysisResult);
        }

        return analysisResult;
    }

    /**
     * Decorates a result object with additional, non-cached information.
     */
    private async decorateResult(
        result: ConferenceLogAnalysisResult,
        logFilePath: string
    ): Promise<ConferenceLogAnalysisResult> {
        result.logFilePath = logFilePath;
        result.analysisTimestamp = new Date().toISOString();
        return result;
    }
}