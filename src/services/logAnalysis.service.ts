// src/services/logAnalysis.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import { LogAnalysisResult, ReadLogResult, FilteredData } from '../types/logAnalysis.types';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

import {
    initializeLogAnalysisResult,
    readAndGroupLogs,
    filterRequests,
    processLogEntry,
    calculateFinalMetrics
} from '../utils/logAnalysis/logProcessing.utils';

/**
 * Service responsible for performing real-time or historical analysis of application logs.
 * It reads the configured log file, processes log entries, extracts metrics,
 * and provides summarized results for monitoring and debugging.
 */
@singleton()
export class LogAnalysisService {
    private readonly logger: Logger;
    private latestResult: LogAnalysisResult | null = null; // Stores the result of the most recent analysis
    private logFilePath: string; // Path to the log file to be analyzed

    /**
     * Constructs an instance of LogAnalysisService.
     * @param {ConfigService} configService - Injected service for application configuration.
     * @param {LoggingService} loggingService - Injected service for obtaining a logger instance.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        this.logger = this.loggingService.getLogger({ service: 'LogAnalysisService' });

        // Retrieve the application log file path from ConfigService
        this.logFilePath = this.configService.appLogFilePath;

        this.logger.info({ event: 'log_analysis_init_success', logFilePath: this.logFilePath }, `LogAnalysisService initialized. Log file path: ${this.logFilePath}.`);

        // Warn if the log file doesn't exist at startup (analysis might still be requested later)
        if (!fs.existsSync(this.logFilePath)) {
            this.logger.warn({ event: 'log_file_not_found_on_init', logFilePath: this.logFilePath }, `Log file not found at configured path: ${this.logFilePath}. Analysis attempts might fail or return empty results until the file is created.`);
        }
    }

    /**
     * Performs a comprehensive analysis of the application log file.
     * It reads, parses, filters, processes, and calculates various metrics.
     * The results are stored internally and also returned.
     *
     * @param {Date | number} [filterStartTime] - Optional: Start timestamp (Date object or Unix timestamp) to filter log entries.
     * @param {Date | number} [filterEndTime] - Optional: End timestamp (Date object or Unix timestamp) to filter log entries.
     * @param {string} [filterRequestId] - Optional: A specific request ID to filter log entries by.
     * @returns {Promise<LogAnalysisResult>} A Promise that resolves with the detailed log analysis result.
     */
    async performAnalysisAndUpdate(
        filterStartTime?: Date | number,
        filterEndTime?: Date | number,
        filterRequestId?: string
    ): Promise<LogAnalysisResult> {
        const logContext = { function: 'performAnalysisAndUpdate', logFilePath: this.logFilePath, filterRequestId, filterStartTime, filterEndTime };
        this.logger.info({ ...logContext, event: 'analysis_start' }, 'Starting log analysis execution.');

        // Initialize a new result object for the current analysis run
        const results: LogAnalysisResult = initializeLogAnalysisResult(this.logFilePath, filterRequestId);

        // Convert filter times to milliseconds for consistent comparison
        const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
        const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

        // Basic validation for time range
        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            this.logger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, `Filter start time (${filterStartTime}) is after filter end time (${filterEndTime}). This range will result in no data.`);
            // Set error status and message directly and return early
            results.status = 'Failed';
            results.errorMessage = 'Invalid filter time range: Start time is after end time.';
            results.logProcessingErrors.push(results.errorMessage);
            this.latestResult = results;
            return results;
        }

        try {
            // Phase 0: Pre-check if log file exists
            if (!fs.existsSync(this.logFilePath)) {
                const errorMsg = `Log file not found at path: ${this.logFilePath}. Cannot perform analysis.`;
                this.logger.error({ ...logContext, event: 'analysis_error_file_not_found' }, errorMsg);
                results.status = 'Failed';
                results.errorMessage = errorMsg;
                results.logProcessingErrors.push(errorMsg);
                this.latestResult = results;
                return results;
            }

            // Phase 1: Read and Group Logs
            this.logger.info({ ...logContext, event: 'analysis_read_start' }, 'Phase 1: Starting to read and group logs.');
            const readResult: ReadLogResult = await readAndGroupLogs(this.logFilePath);
            results.totalLogEntries = readResult.totalEntries;
            results.parsedLogEntries = readResult.parsedEntries;
            results.parseErrors = readResult.parseErrors;
            results.logProcessingErrors.push(...readResult.logProcessingErrors);
            this.logger.info({
                ...logContext,
                event: 'analysis_read_finish',
                totalEntries: readResult.totalEntries,
                parsedEntries: readResult.parsedEntries,
                parseErrorsCount: readResult.parseErrors,
                requestsFound: readResult.requestsData.size
            }, 'Phase 1: Finished reading and grouping logs.');

            if (readResult.requestsData.size === 0 && readResult.totalEntries > 0) {
                this.logger.warn({ ...logContext, event: 'analysis_warning_no_requests_found' }, 'Log file parsed, but no log entries with associated request IDs were found for analysis.');
            }

            // Phase 2a: Filter Requests
            this.logger.info({ ...logContext, event: 'analysis_filter_start' }, 'Phase 2a: Starting to filter requests based on provided criteria.');
            const {
                filteredRequests,
                analysisStartMillis, // Actual start time of logs included in analysis
                analysisEndMillis    // Actual end time of logs included in analysis
            }: FilteredData = filterRequests(
                readResult.requestsData,
                filterStartMillis,
                filterEndMillis,
                filterRequestId
            );
            results.analyzedRequestIds = Array.from(filteredRequests.keys());
            this.logger.info({
                ...logContext,
                event: 'analysis_filter_finish',
                includedRequestsCount: filteredRequests.size,
                actualAnalysisRangeStart: analysisStartMillis ? new Date(analysisStartMillis).toISOString() : 'N/A',
                actualAnalysisRangeEnd: analysisEndMillis ? new Date(analysisEndMillis).toISOString() : 'N/A'
            }, `Phase 2a: Finished filtering requests. Included ${filteredRequests.size} requests.`);

            if (filterRequestId && filteredRequests.size === 0) {
                this.logger.warn({ ...logContext, event: 'analysis_target_request_id_not_found' }, `Requested requestId '${filterRequestId}' not found in logs or did not match time filters. No specific data to analyze for this ID.`);
                // We don't set this as a 'Failed' status unless it's critical,
                // as it might just mean the ID wasn't in the logs for that period.
                // The `analyzedRequestIds` will reflect that no requests were analyzed.
            }

            // Phase 2b: Process Log Entries for Included Requests
            this.logger.info({ ...logContext, event: 'analysis_processing_start', requestCount: filteredRequests.size }, 'Phase 2b: Starting to process log entries for included requests.');
            const conferenceLastTimestamp: { [compositeKey: string]: number } = {}; // To track last timestamp for each conference
            for (const [requestId, requestInfo] of filteredRequests.entries()) {
                const requestLogger = this.logger.child({ requestId }); // Child logger for specific request ID
                for (const logEntry of requestInfo.logs) {
                    processLogEntry(logEntry, results, conferenceLastTimestamp);
                }
            }
            this.logger.info({ ...logContext, event: 'analysis_processing_end' }, 'Phase 2b: Finished processing log entries.');

            // Phase 3: Calculate Final Metrics
            this.logger.info({ ...logContext, event: 'analysis_calculate_metrics_start' }, 'Phase 3: Starting to calculate final metrics.');
            calculateFinalMetrics(results, conferenceLastTimestamp, analysisStartMillis, analysisEndMillis, filteredRequests);
            results.status = 'Completed';
            this.logger.info({ ...logContext, event: 'analysis_calculate_metrics_finish' }, 'Phase 3: Finished calculating final metrics. Analysis completed successfully.');

            // Store the latest successful result
            this.latestResult = results;
            this.logger.info({ ...logContext, event: 'analysis_completed_success', processedConferences: results.overall.processedConferencesCount, errorLogs: results.errorLogCount }, `Analysis completed successfully. Processed ${results.overall.processedConferencesCount} conferences, found ${results.errorLogCount} error logs.`);
            return results;

        } catch (error: unknown) { // Catch any unhandled errors during the analysis process
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            this.logger.error({ ...logContext, err: { message: errorMessage, stack: errorStack }, event: 'analysis_error_fatal' }, `Fatal error occurred during log analysis execution: "${errorMessage}".`);
            results.status = 'Failed';
            results.errorMessage = `Fatal error during analysis: "${errorMessage}".`;
            results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: "${errorMessage}". Stack: ${errorStack}.`);
            this.latestResult = results; // Store the failed result as the latest
            return results;
        }
    }

    /**
     * Retrieves the result of the most recently performed log analysis.
     * @returns {LogAnalysisResult | null} The latest analysis result, or null if no analysis has been performed yet.
     */
    getLatestAnalysisResult(): LogAnalysisResult | null {
        this.logger.debug({ event: 'get_latest_analysis_result' }, 'Retrieving latest analysis result.');
        return this.latestResult;
    }
}