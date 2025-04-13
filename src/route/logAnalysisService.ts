import path from 'path';
// Import necessary types and logger
import { logger } from '../conference/11_utils'; // Adjust path
import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis'; // Adjust path
// Import the refactored steps and helpers
import { initializeLogAnalysisResult } from './analysisHelpers'; // Adjust path
import {
    readAndGroupLogs,
    filterRequestsByTime,
    processLogEntry,
    calculateFinalMetrics,
    ReadLogResult,
    FilteredData,
    RequestLogData // Ensure RequestLogData is exported if needed elsewhere
} from './logProcessingSteps'; // Adjust path

// --- Main Log Analysis Orchestration Function ---
export const performLogAnalysis = async (
    filterStartTime?: Date | number,
    filterEndTime?: Date | number
): Promise<LogAnalysisResult> => {
    const logFilePath = path.join(__dirname, '../../logs/app.log'); // !!! DOUBLE-CHECK THIS PATH !!!
    const logContext = { filePath: logFilePath, function: 'performLogAnalysis' };
    logger.info({ ...logContext, event: 'analysis_start', filterStartTime, filterEndTime }, 'Starting log analysis execution');

    // --- Initialize Results Structure ---
    const results: LogAnalysisResult = initializeLogAnalysisResult(logFilePath);

    // --- Convert filter times to milliseconds ---
    const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
    const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

    if (filterStartMillis && filterEndMillis && filterStartMillis > filterEndMillis) {
        logger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, 'Filter start time is after filter end time. Analysis might yield unexpected results.');
        // Proceeding, but the filter might not match anything due to invalid range.
    }

    try {
        // --- Step 1: Read and Group Logs ---
        const readResult: ReadLogResult = await readAndGroupLogs(logFilePath);
        results.totalLogEntries = readResult.totalEntries;
        results.parsedLogEntries = readResult.parsedEntries;
        results.parseErrors = readResult.parseErrors;
        results.logProcessingErrors.push(...readResult.logProcessingErrors);

        if (readResult.requestsData.size === 0 && readResult.totalEntries > 0) {
             logger.warn({ ...logContext, event: 'analysis_warning_no_requests_found' }, 'Log file parsed, but no entries with requestIds found for analysis.');
             // Return early or continue with empty analysis? Continue for now.
        }

        // --- Step 2: Filter Requests by Time ---
        const { filteredRequests, analysisStartMillis, analysisEndMillis }: FilteredData = filterRequestsByTime(
            readResult.requestsData,
            filterStartMillis,
            filterEndMillis
        );

        // --- Step 3: Process Log Entries for Filtered Requests ---
        logger.info({ ...logContext, event: 'analysis_processing_start', requestCount: filteredRequests.size }, 'Starting Phase 2b: Processing log entries for included requests');
        const conferenceLastTimestamp: { [compositeKey: string]: number } = {}; // Track last seen time per conference

        for (const [requestId, requestInfo] of filteredRequests.entries()) {
            logger.debug({ ...logContext, event: 'analysis_processing_request', requestId, logCount: requestInfo.logs.length }, 'Analyzing logs for request');
            const processLogContext = { function: 'processLogEntry' }; // Base context for the processor function
            for (const logEntry of requestInfo.logs) {
                processLogEntry(logEntry, results, conferenceLastTimestamp, processLogContext);
            }
        }
         logger.info({ ...logContext, event: 'analysis_processing_end' }, 'Finished Phase 2b: Processing log entries');


        // --- Step 4: Calculate Final Metrics and Finalize Details ---
        calculateFinalMetrics(results, conferenceLastTimestamp, analysisStartMillis, analysisEndMillis);

        // --- Final Logging ---
        const finalLogPayload = {
            event: 'analysis_finish_success',
            filter: { start: filterStartTime, end: filterEndTime },
            analysisRange: { start: results.overall.startTime, end: results.overall.endTime, durationSec: results.overall.durationSeconds },
            requestsAnalyzed: filteredRequests.size,
            logStats: {
                total: results.totalLogEntries,
                parsed: results.parsedLogEntries,
                parseErrors: results.parseErrors,
                errorsInAnalysis: results.errorLogCount,
                fatalInAnalysis: results.fatalLogCount,
            },
            conferenceStats: {
                processed: results.overall.processedConferencesCount,
                completed: results.overall.completedTasks,
                failedOrCrashed: results.overall.failedOrCrashedTasks,
                processing: results.overall.processingTasks,
                successfulExtractions: results.overall.successfulExtractions
            },
            // Add summaries of key error types if desired
            // googleSearchErrors: Object.keys(results.googleSearch.errorsByType).length,
            // playwrightErrors: Object.keys(results.playwright.errorsByType).length,
            // geminiErrors: Object.keys(results.geminiApi.errorsByType).length,
            // aggregatedErrors: Object.keys(results.errorsAggregated).length,
        };
        logger.info(finalLogPayload, `Log analysis execution completed successfully.`);

        return results;

    } catch (error: any) {
        // Catch errors from file reading, stream issues, or fatal processing errors
        logger.error({ ...logContext, err: error, event: 'analysis_error_fatal' }, 'Fatal error during log analysis execution');
        results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: ${error.message}`);
        // Return potentially partial results collected before the fatal error
        return results;
    }
};