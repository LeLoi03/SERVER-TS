// src/services/logAnalysisJournal.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import fs from 'fs';

import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import {
    initializeJournalLogAnalysisResult,
    readAndGroupJournalLogs,
    filterJournalRequests,
    processJournalLogEntry,
    calculateJournalFinalMetrics
} from '../utils/logAnalysisJournal/logProcessingJournal.utils'; // Đảm bảo đúng đường dẫn
import { JournalLogAnalysisResult, JournalRequestLogData } from '../types/logAnalysisJournal/logAnalysisJournal.types'; // Đảm bảo đúng đường dẫn
import { Logger } from 'pino';

const MAIN_LOG_FILE_NAME = 'app.log'; // Hoặc tên file log chính của bạn

@singleton()
export class LogAnalysisJournalService {
    private currentAnalysisResult: JournalLogAnalysisResult | null = null;
    private readonly journalLogFilePath: string; // Đổi tên cho rõ ràng
    private readonly serviceLogger: Logger; // Đổi tên baseLogger thành serviceLogger
    private analysisInProgress: boolean = false;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        // Lấy đường dẫn file log journal từ ConfigService
        this.journalLogFilePath = this.configService.journalLogFilePath;
        // Lấy logger loại 'journal' từ LoggingService
        this.serviceLogger = this.loggingService.getLogger('journal', { service: 'LogAnalysisJournalService' });
        this.serviceLogger.info(`Journal log analysis service initialized. Log file path: ${this.journalLogFilePath}`);
    }

    /**
     * Performs a new log analysis for journals and updates the cached result.
     * @param filterStartTime Optional start time (Unix ms) for filtering logs.
     * @param filterEndTime Optional end time (Unix ms) for filtering logs.
     * @param filterRequestId Optional specific batchRequestId to analyze.
     * @returns The new analysis result.
     * @throws Error if log file not found or no data found.
     */
    public async performJournalAnalysisAndUpdate(
        filterStartTime?: number,
        filterEndTime?: number,
        filterRequestId?: string
    ): Promise<JournalLogAnalysisResult> {
        if (this.analysisInProgress) {
            this.serviceLogger.warn('Analysis already in progress. Returning current result or waiting for completion might be needed.');
            if (this.currentAnalysisResult) return this.currentAnalysisResult;
            throw new Error("Analysis is already in progress and no previous result is available.");
        }


        this.analysisInProgress = true;
        // Tạo child logger cho operation cụ thể này
        const analysisLogger = this.serviceLogger.child({
            operation: 'performJournalAnalysisAndUpdateJournal',
            filterStartTime,
            filterEndTime,
            filterRequestId
        });
        analysisLogger.info('Starting new journal log analysis.');

        const results = initializeJournalLogAnalysisResult(this.journalLogFilePath, filterRequestId);

        try {
            if (!fs.existsSync(this.journalLogFilePath)) { // Sử dụng journalLogFilePath
                results.status = 'Failed';
                results.errorMessage = `Journal log file not found at ${this.journalLogFilePath}`;
                analysisLogger.error(results.errorMessage);
                // Không throw lỗi ở đây nữa, để finally xử lý và trả về results
                this.currentAnalysisResult = results; // Cập nhật kết quả hiện tại dù lỗi
                return results; // Trả về results với status Failed
            }

            const { requestsData, totalEntries, parsedEntries, parseErrors, logProcessingErrors: readLogErrors } =
                await readAndGroupJournalLogs(this.journalLogFilePath); // Sử dụng journalLogFilePath


            results.totalLogEntries = totalEntries;
            results.parsedLogEntries = parsedEntries;
            results.parseErrors = parseErrors;
            results.logProcessingErrors.push(...readLogErrors);

            if (requestsData.size === 0 && parsedEntries > 0) {
                results.status = 'Completed'; // Parsed logs, but no requests with batchRequestId
                results.errorMessage = 'No journal requests with batchRequestId found in logs.';
                analysisLogger.warn(results.errorMessage);
                this.currentAnalysisResult = results;
                return results;
            }
            if (requestsData.size === 0 && parsedEntries === 0 && totalEntries > 0) {
                results.status = 'Failed';
                results.errorMessage = 'Logs found but could not parse any valid JSON entries.';
                analysisLogger.error(results.errorMessage);
                this.currentAnalysisResult = results;
                return results;
            }
            if (totalEntries === 0) {
                results.status = 'Completed';
                results.errorMessage = 'Log file is empty.';
                analysisLogger.warn(results.errorMessage);
                this.currentAnalysisResult = results;
                return results;
            }


            const { filteredRequests, analysisStartMillis, analysisEndMillis } =
                filterJournalRequests(
                    requestsData,
                    filterStartTime || null,
                    filterEndTime || null,
                    filterRequestId
                );

            if (filteredRequests.size === 0) {
                results.status = 'Completed';
                results.errorMessage = 'No journal log data found for the selected period or requestId.';
                analysisLogger.warn(results.errorMessage);
                this.currentAnalysisResult = results;
                // Do not throw error here, just return the result with message
                return results;
            }

            results.analyzedRequestIds = Array.from(filteredRequests.keys());
            const journalLastTimestamp: { [compositeKey: string]: number } = {};

            for (const [batchRequestId, requestLogData] of filteredRequests.entries()) {
                // Initialize request summary (will be populated further in calculateFinalMetrics)
                results.requests[batchRequestId] = {
                    batchRequestId,
                    startTime: requestLogData.startTime ? new Date(requestLogData.startTime).toISOString() : null,
                    endTime: requestLogData.endTime ? new Date(requestLogData.endTime).toISOString() : null,
                    durationSeconds: (requestLogData.startTime && requestLogData.endTime) ? Math.round((requestLogData.endTime - requestLogData.startTime) / 1000) : null,
                    status: 'Processing', // Initial status
                    dataSource: requestLogData.dataSource,
                    errorMessages: [],
                };

                for (const logEntry of requestLogData.logs) {
                    try {
                        processJournalLogEntry(logEntry, results, journalLastTimestamp);
                    } catch (processingError: any) {
                        results.logProcessingErrors.push(`Error processing log entry for ${batchRequestId}: ${processingError.message}`);
                        analysisLogger.error({ err: processingError, entry: logEntry }, "Error during single log entry processing for journal.");
                    }
                }
            }

            calculateJournalFinalMetrics(results, journalLastTimestamp, analysisStartMillis, analysisEndMillis, filteredRequests);

            if (results.analyzedRequestIds.length > 0 && results.status === 'Processing') {
                // If after all calculations, it's still 'Processing', it likely means some tasks are ongoing
                // or final status determination logic needs refinement. For now, we'll let it be.
                // Or, if all requests are 'Processing', then overall is 'Processing'.
                // If some are completed/failed, calculateFinalMetrics should set a more definitive status.
            } else if (results.analyzedRequestIds.length > 0 && results.status !== 'Failed') {
                results.status = results.status === 'Processing' ? 'Completed' : results.status; // Default to completed if not failed and was processing
            }


            analysisLogger.info({
                finalStatus: results.status,
                requestsAnalyzed: results.analyzedRequestIds.length,
                journalsFound: Object.keys(results.journalAnalysis).length
            }, 'Journal log analysis processing complete.');

        } catch (error: any) {
            analysisLogger.error({ err: error }, 'Error during journal log analysis execution.');
            results.status = 'Failed';
            results.errorMessage = results.errorMessage || error.message || 'An unexpected error occurred during journal analysis.';
            // Do not re-throw here if we want to return the partial 'results' object
        } finally {
            this.analysisInProgress = false;
        }

        this.currentAnalysisResult = results;
        if (results.errorMessage && results.analyzedRequestIds.length === 0 && results.status !== 'Failed') {
            // If there's an error message like "No log data found", but it's not a "Failed" status,
            // it's more like a "Completed with no data" scenario.
            // The controller will handle the 404 based on errorMessage.
        } else if (results.status === 'Failed' && !results.errorMessage?.includes('Log file not found')) {
            // If it failed for reasons other than "file not found", it's a general processing failure.
            // The controller will handle this as a 500 or other appropriate error.
        }

        return results;
    }

    /**
     * Retrieves the last analysis result without performing a new one.
     * @returns The cached analysis result or null if none exists.
     */
    public getLatestCachedAnalysis(): JournalLogAnalysisResult | null {
        if (!this.currentAnalysisResult && !this.analysisInProgress) {
            this.serviceLogger.info("No cached journal analysis result found. Triggering a new analysis by default.");
            // Optionally, trigger a new analysis here if no cache and not in progress
            // this.performAnalysisAndUpdate().catch(err => this.baseLogger.error({err}, "Default analysis trigger failed"));
            // For now, just return null, let controller decide to call performAnalysisAndUpdate
        }
        return this.currentAnalysisResult;
    }
}