// src/services/logAnalysis.service.ts
import 'reflect-metadata'; // Import reflect-metadata
import { singleton, inject } from 'tsyringe'; // Import singleton and inject
import fs from 'fs';
import { LogAnalysisResult, ReadLogResult, FilteredData } from '../client/types/logAnalysis';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service'; // Import LoggingService
import { Logger } from 'pino'; // Import Logger type

// <<< Import các hàm xử lý từ vị trí utils mới >>>
import {
    initializeLogAnalysisResult,
    readAndGroupLogs,
    filterRequestsByTime,
    processLogEntry,
    calculateFinalMetrics
} from '../utils/logAnalysis/logProcessing.utils';

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
            const warnMsg = `Log file not found at configured path: ${this.logFilePath}. Analysis might fail or return empty results.`;
            this.logger.warn(warnMsg);
        }
    }

    async performAnalysisAndUpdate(
        filterStartTime?: Date | number,
        filterEndTime?: Date | number
    ): Promise<LogAnalysisResult> {
        const logContext = { filePath: this.logFilePath, function: 'performAnalysisAndUpdate' };
        this.logger.info({ ...logContext, event: 'analysis_start', filterStartTime, filterEndTime }, 'Starting log analysis execution');

        const results: LogAnalysisResult = initializeLogAnalysisResult(this.logFilePath);

        const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
        const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            this.logger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, 'Filter start time is after filter end time.');
        }

        try {
            if (!fs.existsSync(this.logFilePath)) {
                const errorMsg = `Log file not found at path: ${this.logFilePath}`;
                this.logger.error({ ...logContext, event: 'analysis_error_file_not_found' }, errorMsg);
                results.status = 'Failed';
                results.errorMessage = errorMsg;
                results.logProcessingErrors.push(errorMsg);
                this.latestResult = results;
                return results;
            }

            this.logger.info({ ...logContext, event: 'analysis_read_start' }, 'Starting Phase 1: Read and Group Logs');
            const readResult: ReadLogResult = await readAndGroupLogs(this.logFilePath);
            results.totalLogEntries = readResult.totalEntries;
            results.parsedLogEntries = readResult.parsedEntries;
            results.parseErrors = readResult.parseErrors;
            results.logProcessingErrors.push(...readResult.logProcessingErrors);
            this.logger.info({ ...logContext, event: 'analysis_read_finish', totalEntries: readResult.totalEntries, parsedEntries: readResult.parsedEntries, requestsFound: readResult.requestsData.size }, 'Finished Phase 1');

            if (readResult.requestsData.size === 0 && readResult.totalEntries > 0) {
                this.logger.warn({ ...logContext, event: 'analysis_warning_no_requests_found' }, 'Log file parsed, but no entries with requestIds found for analysis.');
            }

            const { filteredRequests, analysisStartMillis, analysisEndMillis }: FilteredData = filterRequestsByTime(
                readResult.requestsData,
                filterStartMillis,
                filterEndMillis
            );
            this.logger.info({ ...logContext, event: 'analysis_filter_finish', includedRequests: filteredRequests.size, rangeStart: analysisStartMillis, rangeEnd: analysisEndMillis }, 'Finished Phase 2a: Filtering Requests');

            this.logger.info({ ...logContext, event: 'analysis_processing_start', requestCount: filteredRequests.size }, 'Starting Phase 2b: Processing log entries for included requests');
            const conferenceLastTimestamp: { [compositeKey: string]: number } = {};

            for (const [requestId, requestInfo] of filteredRequests.entries()) {
                const processLogContext = { function: 'processLogEntry', requestId: requestId }; // Thêm requestId vào context
                for (const logEntry of requestInfo.logs) {
                    // Truyền logger vào hàm xử lý nếu nó cần log bên trong
                    processLogEntry(logEntry, results, conferenceLastTimestamp, processLogContext, this.logger);
                }
            }
            this.logger.info({ ...logContext, event: 'analysis_processing_end' }, 'Finished Phase 2b: Processing log entries');

            calculateFinalMetrics(results, conferenceLastTimestamp, analysisStartMillis, analysisEndMillis);
            results.status = 'Completed';
            this.logger.info({ ...logContext, event: 'analysis_calculate_metrics_finish' }, 'Finished Phase 3: Calculating final metrics');

            this.latestResult = results;
            this.logger.info(`Analysis completed successfully. Requests: ${results.overall.processedConferencesCount}, Errors: ${results.errorLogCount}`);

            return results;

        } catch (error: any) {
            this.logger.error({ ...logContext, err: error, event: 'analysis_error_fatal' }, 'Fatal error during log analysis execution');
            results.status = 'Failed';
            results.errorMessage = `Fatal error during analysis: ${error.message}`;
            results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: ${error.message}`);

            this.latestResult = results;
            return results;
        }
    }

    getLatestAnalysisResult(): LogAnalysisResult | null {
        this.logger.debug('getLatestAnalysisResult called.');
        return this.latestResult;
    }
}