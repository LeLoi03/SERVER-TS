// src/services/logAnalysis.service.ts
import path from 'path';
import fs from 'fs'; // Import fs để kiểm tra file tồn tại
import { LogAnalysisResult, ReadLogResult, FilteredData } from '../client/types/logAnalysis'; // <<< Import từ vị trí type mới
import { config } from '../config/environment'; // <<< Import config để có thể lấy đường dẫn log từ env
import { logger } from '../conference/11_utils';
import logToFile from '../utils/logger';

// <<< Import các hàm xử lý từ vị trí utils mới >>>
import {
    initializeLogAnalysisResult,
    readAndGroupLogs,
    filterRequestsByTime,
    processLogEntry,
    calculateFinalMetrics
} from '../utils/logProcessing.utils';


export class LogAnalysisService {
    private latestResult: LogAnalysisResult | null = null;
    private logFilePath: string;

    constructor() {
        this.logFilePath = config.logFilePath || path.resolve(__dirname, '../../../logs/app.log');
        logger.info(`[LogAnalysis Service] Initialized. Log file path: ${this.logFilePath}`);
        logToFile(`[LogAnalysis Service] Initialized. Log file path: ${this.logFilePath}`);
        if (!fs.existsSync(this.logFilePath)) {
            const warnMsg = `Log file not found at configured path: ${this.logFilePath}. Analysis might fail or return empty results.`;
            logger.warn(`[LogAnalysis Service] ${warnMsg}`);
            logToFile(`[LogAnalysis Service] WARN: ${warnMsg}`);
        }
    }

    async performAnalysisAndUpdate(
        filterStartTime?: Date | number,
        filterEndTime?: Date | number
    ): Promise<LogAnalysisResult> {
        const logContext = { filePath: this.logFilePath, function: 'performAnalysisAndUpdate' };
        logger.info({ ...logContext, event: 'analysis_start', filterStartTime, filterEndTime }, 'Starting log analysis execution');
        logToFile(`[LogAnalysis Service] Starting analysis. Filters: Start=${filterStartTime}, End=${filterEndTime}`);

        const results: LogAnalysisResult = initializeLogAnalysisResult(this.logFilePath);

        const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
        const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

        if (filterStartMillis && filterEndMillis && filterStartMillis > filterEndMillis) {
            logger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, 'Filter start time is after filter end time.');
            logToFile('[LogAnalysis Service] WARN: Filter start time is after filter end time.');
        }

        try {
            if (!fs.existsSync(this.logFilePath)) {
                const errorMsg = `Log file not found at path: ${this.logFilePath}`;
                logger.error({ ...logContext, event: 'analysis_error_file_not_found' }, errorMsg);
                logToFile(`[LogAnalysis Service] ERROR: ${errorMsg}`);
                // VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV
                results.status = 'Failed'; // Gán status (Sẽ hoạt động sau khi sửa type)
                results.errorMessage = errorMsg; // Gán errorMessage (Sẽ hoạt động sau khi sửa type)
                // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                results.logProcessingErrors.push(errorMsg);
                this.latestResult = results;
                return results;
            }

            logger.info({ ...logContext, event: 'analysis_read_start' }, 'Starting Phase 1: Read and Group Logs');
            const readResult: ReadLogResult = await readAndGroupLogs(this.logFilePath);
            results.totalLogEntries = readResult.totalEntries;
            results.parsedLogEntries = readResult.parsedEntries;
            results.parseErrors = readResult.parseErrors;
            results.logProcessingErrors.push(...readResult.logProcessingErrors);
            logger.info({ ...logContext, event: 'analysis_read_finish', totalEntries: readResult.totalEntries, parsedEntries: readResult.parsedEntries, requestsFound: readResult.requestsData.size }, 'Finished Phase 1');

            if (readResult.requestsData.size === 0 && readResult.totalEntries > 0) {
                logger.warn({ ...logContext, event: 'analysis_warning_no_requests_found' }, 'Log file parsed, but no entries with requestIds found for analysis.');
                logToFile('[LogAnalysis Service] WARN: No request data found in logs.');
            }

            const { filteredRequests, analysisStartMillis, analysisEndMillis }: FilteredData = filterRequestsByTime(
                readResult.requestsData,
                filterStartMillis,
                filterEndMillis
            );
            logger.info({ ...logContext, event: 'analysis_filter_finish', includedRequests: filteredRequests.size, rangeStart: analysisStartMillis, rangeEnd: analysisEndMillis }, 'Finished Phase 2a: Filtering Requests');

            logger.info({ ...logContext, event: 'analysis_processing_start', requestCount: filteredRequests.size }, 'Starting Phase 2b: Processing log entries for included requests');
            const conferenceLastTimestamp: { [compositeKey: string]: number } = {};

            for (const [requestId, requestInfo] of filteredRequests.entries()) {
                const processLogContext = { function: 'processLogEntry' };
                for (const logEntry of requestInfo.logs) {
                    processLogEntry(logEntry, results, conferenceLastTimestamp, processLogContext);
                }
            }
            logger.info({ ...logContext, event: 'analysis_processing_end' }, 'Finished Phase 2b: Processing log entries');

            calculateFinalMetrics(results, conferenceLastTimestamp, analysisStartMillis, analysisEndMillis);
            // VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV
            results.status = 'Completed'; // Gán status (Sẽ hoạt động sau khi sửa type)
            // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            logger.info({ ...logContext, event: 'analysis_calculate_metrics_finish' }, 'Finished Phase 3: Calculating final metrics');

            this.latestResult = results;
            // VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV
            // Truy cập requestsAnalyzed (Sẽ hoạt động sau khi sửa type)
            logToFile(`[LogAnalysis Service] Analysis completed successfully. Requests: ${results.overall.requestsAnalyzed}, Errors: ${results.errorLogCount}`);
            // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

            return results;

        } catch (error: any) {
            logger.error({ ...logContext, err: error, event: 'analysis_error_fatal' }, 'Fatal error during log analysis execution');
            logToFile(`[LogAnalysis Service] FATAL ERROR during analysis: ${error.message}\nStack: ${error.stack}`);
            // VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV
            results.status = 'Failed'; // Gán status (Sẽ hoạt động sau khi sửa type)
            results.errorMessage = `Fatal error during analysis: ${error.message}`; // Gán errorMessage (Sẽ hoạt động sau khi sửa type)
            // ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
            results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: ${error.message}`);

            this.latestResult = results;
            return results;
        }
    }

    getLatestAnalysisResult(): LogAnalysisResult | null {
        logger.debug('[LogAnalysis Service] getLatestAnalysisResult called.');
        return this.latestResult;
    }
}