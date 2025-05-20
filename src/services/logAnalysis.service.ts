// src/services/logAnalysis.service.ts
import 'reflect-metadata'; // Import reflect-metadata
import { singleton, inject } from 'tsyringe'; // Import singleton and inject
import fs from 'fs';
import { LogAnalysisResult, ReadLogResult, FilteredData } from '../types/logAnalysis.types';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service'; // Import LoggingService
import { Logger } from 'pino'; // Import Logger type

import { // Assuming processingSteps.ts is now correctly pathed or moved to src/utils/logAnalysis/
    initializeLogAnalysisResult,
    readAndGroupLogs,
    filterRequests, // <<< CHANGED from filterRequestsByTime
    processLogEntry,
    calculateFinalMetrics
} from '../utils/logAnalysis/logProcessing.utils'; // Adjust path if needed

@singleton() // Sử dụng decorator singleton
export class LogAnalysisService {
    private readonly logger: Logger; // Sử dụng Logger từ pino
    private latestResult: LogAnalysisResult | null = null;
    private logFilePath: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService, // Inject ConfigService
        @inject(LoggingService) private loggingService: LoggingService // Inject LoggingService
    ) {
        this.logger = this.loggingService.getLogger({ service: 'LogAnalysisService' }); // Khởi tạo logger

        // Sử dụng getter từ ConfigService để lấy đường dẫn file log
        this.logFilePath = this.configService.appLogFilePath;

        this.logger.info(`Initialized. Log file path: ${this.logFilePath}`);

        if (!fs.existsSync(this.logFilePath)) {
            // const warnMsg = `Log file not found at configured path: ${this.logFilePath}. Analysis might fail or return empty results.`;
            // this.logger.warn(warnMsg);
        }
    }

    async performAnalysisAndUpdate(
        filterStartTime?: Date | number,
        filterEndTime?: Date | number,
        filterRequestId?: string // <<< NEW parameter
    ): Promise<LogAnalysisResult> {
        const logContext = { filePath: this.logFilePath, function: 'performAnalysisAndUpdate', filterRequestId }; // Add filterRequestId to context
        // this.logger.info({ ...logContext, event: 'analysis_start', filterStartTime, filterEndTime }, 'Starting log analysis execution');

        const results: LogAnalysisResult = initializeLogAnalysisResult(this.logFilePath, filterRequestId); // Pass filterRequestId

        const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
        const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            // this.logger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, 'Filter start time is after filter end time.');
        }

        try {
            if (!fs.existsSync(this.logFilePath)) {
                const errorMsg = `Log file not found at path: ${this.logFilePath}`;
                // this.logger.error({ ...logContext, event: 'analysis_error_file_not_found' }, errorMsg);
                results.status = 'Failed';
                results.errorMessage = errorMsg;
                results.filterRequestId = filterRequestId; // Ensure it's set on error

                results.logProcessingErrors.push(errorMsg);
                this.latestResult = results;
                return results;
            }

            // this.logger.info({ ...logContext, event: 'analysis_read_start' }, 'Starting Phase 1: Read and Group Logs');
            const readResult: ReadLogResult = await readAndGroupLogs(this.logFilePath);
            results.totalLogEntries = readResult.totalEntries;
            results.parsedLogEntries = readResult.parsedEntries;
            results.parseErrors = readResult.parseErrors;
            results.logProcessingErrors.push(...readResult.logProcessingErrors);
            // this.logger.info({ ...logContext, event: 'analysis_read_finish', ... }, 'Finished Phase 1');

            if (readResult.requestsData.size === 0 && readResult.totalEntries > 0) {
                // this.logger.warn({ ...logContext, event: 'analysis_warning_no_requests_found' }, 'Log file parsed, but no entries with requestIds found for analysis.');
            }

            // <<< MODIFIED FILTERING LOGIC >>>
            const {
                filteredRequests,
                analysisStartMillis,
                analysisEndMillis
            }: FilteredData = filterRequests( // Use the modified/renamed function
                readResult.requestsData,
                filterStartMillis,
                filterEndMillis,
                filterRequestId // <<< Pass the requestIdFilter
                // this.logger // Pass logger if filterRequests uses it
            );
            // this.logger.info({ ...logContext, event: 'analysis_filter_finish', includedRequests: filteredRequests.size, rangeStart: analysisStartMillis, rangeEnd: analysisEndMillis }, 'Finished Phase 2a: Filtering Requests');

            // Populate analyzedRequestIds from the keys of the filtered map
            results.analyzedRequestIds = Array.from(filteredRequests.keys());

            if (filterRequestId && filteredRequests.size === 0) {
                // this.logger.warn({ ...logContext, event: 'analysis_target_request_id_not_found' }, `Requested requestId '${filterRequestId}' not found in logs or did not match time filters.`);
                // Optionally set an error message or specific status
                // results.errorMessage = `Data for requestId '${filterRequestId}' not found.`;
            }


            // this.logger.info({ ...logContext, event: 'analysis_processing_start', requestCount: filteredRequests.size }, 'Starting Phase 2b: Processing log entries for included requests');
            const conferenceLastTimestamp: { [compositeKey: string]: number } = {};
            for (const [requestId, requestInfo] of filteredRequests.entries()) {
                for (const logEntry of requestInfo.logs) {
                    processLogEntry(logEntry, results, conferenceLastTimestamp /*, this.logger.child({requestId}) */);
                }
            }
            // this.logger.info({ ...logContext, event: 'analysis_processing_end' }, 'Finished Phase 2b: Processing log entries');

            calculateFinalMetrics(results, conferenceLastTimestamp, analysisStartMillis, analysisEndMillis, filteredRequests /*, this.logger */); // NEW
            results.status = 'Completed';
            // this.logger.info({ ...logContext, event: 'analysis_calculate_metrics_finish' }, 'Finished Phase 3: Calculating final metrics');

            this.latestResult = results;
            // this.logger.info(`Analysis completed successfully. Requests: ${results.overall.processedConferencesCount}, Errors: ${results.errorLogCount}`);
            return results;

        } catch (error: any) {
            // this.logger.error({ ...logContext, err: error, event: 'analysis_error_fatal' }, 'Fatal error during log analysis execution');
            results.status = 'Failed';
            results.errorMessage = `Fatal error during analysis: ${error.message}`;
            results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: ${error.message}`);
            results.filterRequestId = filterRequestId; // Ensure it's set on error
            this.latestResult = results;
            return results;
        }
    }

    getLatestAnalysisResult(): LogAnalysisResult | null {
        // this.logger.debug('getLatestAnalysisResult called.');
        return this.latestResult;
    }
}