// src/services/journalLogAnalysis.service.ts
import 'reflect-metadata';
import { singleton, inject, delay } from 'tsyringe';
import fsPromises from 'fs/promises'; // Sử dụng fs.promises
import fsSync from 'fs'; // Sử dụng fsSync cho existsSync
import path from 'path'; // Thêm path
// readline không cần thiết ở đây nếu readAndGroupJournalLogs xử lý nó

import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import {
    initializeJournalLogAnalysisResult,
    readAndGroupJournalLogs, // Sẽ được cập nhật
    filterJournalRequests,
    processJournalLogEntry,
    calculateJournalFinalMetrics
} from '../utils/logAnalysisJournal/logProcessingJournal.utils'; // Đảm bảo đường dẫn đúng
import {
    JournalLogAnalysisResult,
    JournalRequestSummary,
    // Các kiểu chi tiết cho aggregation sẽ được xử lý bởi merger utils
} from '../types/logAnalysisJournal/logAnalysisJournal.types'; // Đảm bảo đường dẫn đúng
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils';
import { LogAnalysisCacheService } from './logAnalysisCache.service';
import { ReadLogResult } from '../types/logAnalysis'; // Import ReadLogResult

// Import module gộp tiện ích
import * as JournalAnalysisMerger from '../utils/logAnalysisJournal/journalAnalysisMerger.utils'; // Đảm bảo đường dẫn đúng

@singleton()
export class JournalLogAnalysisService {
    // private readonly journalLogFilePath: string; // Bỏ đi
    private readonly journalRequestLogBaseDir: string; // Thư mục chứa các file log theo request
    private readonly serviceLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(delay(() => LogAnalysisCacheService)) private cacheService: LogAnalysisCacheService
    ) {
        // this.journalLogFilePath = this.configService.journalLogFilePathForReading; // Bỏ đi
        this.journalRequestLogBaseDir = this.configService.appConfiguration.journalRequestLogDirectory;
        this.serviceLogger = this.loggingService.getLogger('app', { // Dùng app logger cho service này
            service: 'JournalLogAnalysisService'
        });
        this.serviceLogger.info(`Journal log analysis service initialized. Request log base dir: ${this.journalRequestLogBaseDir}`);

        if (!fsSync.existsSync(this.journalRequestLogBaseDir)) {
            this.serviceLogger.warn({ event: 'journal_request_log_dir_not_found_on_init', dirPath: this.journalRequestLogBaseDir }, `Journal request log directory not found: ${this.journalRequestLogBaseDir}. This directory should be created by LoggingService.`);
        }
    }

    public async performJournalAnalysisAndUpdate(
        filterStartTimeInput?: number, // Unix ms
        filterEndTimeInput?: number,   // Unix ms
        filterRequestId?: string // Đây sẽ là batchRequestId
    ): Promise<JournalLogAnalysisResult> {
        const logContext = {
            function: 'performJournalAnalysisAndUpdate',
            filterRequestId,
            filterStartTime: filterStartTimeInput ? new Date(filterStartTimeInput).toISOString() : undefined,
            filterEndTime: filterEndTimeInput ? new Date(filterEndTimeInput).toISOString() : undefined
        };
        const logger = this.serviceLogger.child(logContext);

        if (filterRequestId) {
            logger.info(`Analyzing specific journal request ID: ${filterRequestId}`);
            let analysisResult: JournalLogAnalysisResult | null = null;

            // Đường dẫn file log cụ thể cho request này
            const requestLogFilePath = this.configService.getRequestSpecificLogFilePath('journal', filterRequestId);

            if (this.configService.analysisCacheEnabled) {
                const cachedResult = await this.cacheService.readFromCache<JournalLogAnalysisResult>('journal', filterRequestId);
                if (cachedResult) {
                    if (!['Processing', 'Unknown'].includes(cachedResult.status || '')) {
                        logger.info(`Returning valid cached journal result for request ID: ${filterRequestId} with status: ${cachedResult.status}`);
                        cachedResult.logFilePath = requestLogFilePath; // Cập nhật logFilePath
                        cachedResult.analysisTimestamp = new Date().toISOString();
                        return cachedResult;
                    } else {
                        logger.info(`Cached journal result for ${filterRequestId} is '${cachedResult.status}'. Will perform live analysis.`);
                    }
                } else {
                    logger.info(`No cache found for journal request ${filterRequestId}. Performing live analysis.`);
                }
            } else {
                logger.info('Caching is disabled. Performing live analysis for journal request.');
            }

            // Phân tích live cho request ID cụ thể
            analysisResult = await this.analyzeJournalLiveLogsForRequest(
                filterRequestId, // Luôn truyền ID
                requestLogFilePath, // Truyền đường dẫn file log
                filterStartTimeInput,
                filterEndTimeInput
            );

            if (this.configService.analysisCacheEnabled &&
                analysisResult.status && !['Processing', 'Unknown'].includes(analysisResult.status)) {
                logger.info(`Caching live journal analysis result for ${filterRequestId} with status ${analysisResult.status}.`);
                await this.cacheService.writeToCache('journal', filterRequestId, analysisResult);
            }
            return analysisResult;

        } else { // Không có filterRequestId -> aggregation
            logger.info('Analyzing all journal requests (aggregation).');
            return this.aggregateAllJournalAnalyses(filterStartTimeInput, filterEndTimeInput);
        }
    }

    // Đổi tên và sửa đổi hàm này để phân tích một file log cụ thể của request
    private async analyzeJournalLiveLogsForRequest(
        batchRequestId: string, // Bắt buộc
        requestLogFilePath: string, // Đường dẫn file log của request
        filterStartTimeInput?: number,
        filterEndTimeInput?: number
    ): Promise<JournalLogAnalysisResult> {
        const logContext = { function: 'analyzeJournalLiveLogsForRequest', batchRequestId, requestLogFilePath };
        const logger = this.serviceLogger.child(logContext);
        logger.info('Performing live journal log analysis for a specific request.');

        // Sử dụng requestLogFilePath và batchRequestId khi khởi tạo
        const results = initializeJournalLogAnalysisResult(requestLogFilePath, batchRequestId);
        const filterStartMillis = filterStartTimeInput || null;
        const filterEndMillis = filterEndTimeInput || null;

        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            results.status = 'Failed';
            results.errorMessage = 'Invalid filter time range: Start time is after end time.';
            logger.warn(results.errorMessage);
            return results;
        }

        try {
            if (!fsSync.existsSync(requestLogFilePath)) {
                results.status = 'Failed'; // Hoặc 'NoRequestsAnalyzed'
                results.errorMessage = `Journal log file for request ${batchRequestId} not found: ${requestLogFilePath}.`;
                logger.error(results.errorMessage);
                return results;
            }

            // readAndGroupJournalLogs cần được gọi với đường dẫn file log của request
            // và batchRequestId để nó biết chỉ xử lý ID đó.
            const { requestsData, totalEntries, parsedEntries, parseErrors, logProcessingErrors: readLogErrors }: ReadLogResult =
                await readAndGroupJournalLogs(requestLogFilePath, batchRequestId);

            results.totalLogEntries = totalEntries;
            results.parsedLogEntries = parsedEntries;
            results.parseErrors = parseErrors;
            results.logProcessingErrors.push(...readLogErrors);

            // Các kiểm tra sớm về dữ liệu log
            if (requestsData.size === 0 && parsedEntries > 0) {
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `No journal request data found for ${batchRequestId} in its log file, though entries were parsed.`;
                logger.warn(results.errorMessage); return results;
            }
            if (requestsData.size === 0 && parsedEntries === 0 && totalEntries > 0) {
                results.status = 'Failed';
                results.errorMessage = `Log file for ${batchRequestId} found but could not parse any valid JSON entries.`;
                logger.error(results.errorMessage); return results;
            }
            if (totalEntries === 0) {
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `Log file for ${batchRequestId} is empty.`;
                logger.warn(results.errorMessage); return results;
            }


            const {
                filteredRequests, // Sẽ chỉ chứa 1 entry nếu readAndGroupJournalLogs hoạt động đúng
                analysisStartMillis: actualAnalysisStartMillis,
                analysisEndMillis: actualAnalysisEndMillis
            } = filterJournalRequests( // Hàm này vẫn dùng để lọc theo thời gian
                requestsData,
                filterStartMillis,
                filterEndMillis,
                batchRequestId // Luôn truyền batchRequestId
            );

            results.analyzedRequestIds = Array.from(filteredRequests.keys());

            if (!filteredRequests.has(batchRequestId) || filteredRequests.size === 0) {
                logger.warn(`Live journal analysis: Data for requested ID ${batchRequestId} not found in its log file or did not match time filters.`);
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `No journal log data found for request ID ${batchRequestId} in file ${requestLogFilePath} matching filters.`;
                return results;
            }

            const journalLastTimestamp: { [compositeKey: string]: number } = {}; // compositeKey có thể là journalName hoặc tương tự
            const requestLogData = filteredRequests.get(batchRequestId);

            if (requestLogData) {
                // Khởi tạo request summary cho batchRequestId này
                results.requests[batchRequestId] = {
                    batchRequestId,
                    startTime: requestLogData.startTime ? new Date(requestLogData.startTime).toISOString() : null,
                    endTime: requestLogData.endTime ? new Date(requestLogData.endTime).toISOString() : null,
                    durationSeconds: (requestLogData.startTime && requestLogData.endTime) ? Math.round((requestLogData.endTime - requestLogData.startTime) / 1000) : null,
                    status: 'Processing',
                    dataSource: requestLogData.dataSource, // dataSource nên được thêm vào RequestLogData bởi readAndGroupJournalLogs
                    errorMessages: [],
                    // Các trường count sẽ được cập nhật trong calculateJournalFinalMetrics
                };

                for (const logEntry of requestLogData.logs) {
                    processJournalLogEntry(logEntry, results, journalLastTimestamp);
                }
            }

            calculateJournalFinalMetrics(results, journalLastTimestamp, actualAnalysisStartMillis, actualAnalysisEndMillis, filteredRequests);

            logger.info(`Live journal analysis for ${batchRequestId} finished with status: ${results.status}, errorMessage: ${results.errorMessage}`);
            return results;

        } catch (error: any) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack } }, `Fatal error during live journal analysis for ${batchRequestId}: "${errorMessage}".`);
            results.status = 'Failed';
            results.errorMessage = results.errorMessage || `Fatal error during live journal analysis for ${batchRequestId}: "${errorMessage}".`;
            results.logProcessingErrors.push(`FATAL LIVE JOURNAL ANALYSIS ERROR for ${batchRequestId}: "${errorMessage}". Stack: ${errorStack}.`);
            return results;
        }
    }

    private async aggregateAllJournalAnalyses(
        filterStartTimeInput?: number,
        filterEndTimeInput?: number
    ): Promise<JournalLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregateAllJournalAnalyses' });
        logger.info('Aggregating analysis for all journal requests.');

        // aggregatedResults sẽ không có logFilePath chung nữa
        const aggregatedResults: JournalLogAnalysisResult = initializeJournalLogAnalysisResult(undefined);
        aggregatedResults.status = 'Processing';

        const filterStartMillis = filterStartTimeInput || null;
        const filterEndMillis = filterEndTimeInput || null;

        let cachedRequestIds: string[] = [];
        if (this.configService.analysisCacheEnabled) {
            cachedRequestIds = await this.cacheService.getAllCachedRequestIds('journal');
            logger.info(`Found ${cachedRequestIds.length} journal request IDs in cache.`);
        } else {
            logger.info('Caching is disabled, skipping cache ID retrieval for journal aggregation.');
        }

        let liveRequestIdsFromLogFiles: string[] = [];
        try {
            if (fsSync.existsSync(this.journalRequestLogBaseDir)) {
                const files = await fsPromises.readdir(this.journalRequestLogBaseDir);
                liveRequestIdsFromLogFiles = files
                    .filter(file => file.endsWith('.log'))
                    .map(file => path.basename(file, '.log'));
                logger.info(`Found ${liveRequestIdsFromLogFiles.length} journal request log files in ${this.journalRequestLogBaseDir}.`);
            } else {
                logger.warn(`Journal request log directory not found: ${this.journalRequestLogBaseDir}. No live request IDs will be discovered from files.`);
            }
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack } }, 'Error reading journal request log directory for ID discovery.');
        }

        const allUniqueRequestIds = Array.from(new Set([...cachedRequestIds, ...liveRequestIdsFromLogFiles]));
        logger.info(`Total unique journal request IDs to aggregate: ${allUniqueRequestIds.length}`);

        if (allUniqueRequestIds.length === 0) {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = 'No journal requests found in cache or log files for aggregation.';
            logger.warn(aggregatedResults.errorMessage);
            aggregatedResults.analysisTimestamp = new Date().toISOString();
            return aggregatedResults;
        }


        let overallMinStartTimeMs: number | null = null;
        let overallMaxEndTimeMs: number | null = null;
        let totalAggregatedDurationSeconds = 0;

        for (const reqId of allUniqueRequestIds) {
            const singleRequestAnalysis = await this.performJournalAnalysisAndUpdate(
                filterStartTimeInput, filterEndTimeInput, reqId
            );

            // Xử lý các request không hợp lệ hoặc không có dữ liệu
            if (singleRequestAnalysis.status === 'Failed' ||
                singleRequestAnalysis.status === 'NoRequestsAnalyzed' ||
                (singleRequestAnalysis.analyzedRequestIds.length === 0 && singleRequestAnalysis.filterRequestId === reqId)) {
                logger.warn(`Skipping full aggregation for journal request ${reqId} due to its status: ${singleRequestAnalysis.status} or no data found for it.`);
                if (!aggregatedResults.requests[reqId]) {
                    aggregatedResults.requests[reqId] = {
                        batchRequestId: reqId, startTime: null, endTime: null, durationSeconds: 0,
                        totalJournalsInputForRequest: 0, processedJournalsCountForRequest: 0,
                        status: singleRequestAnalysis.status || 'NotFoundInAggregation',
                        dataSource: undefined, // Hoặc lấy từ singleRequestAnalysis nếu có
                        errorMessages: singleRequestAnalysis.errorMessage ? [singleRequestAnalysis.errorMessage] : [],
                    } as JournalRequestSummary;
                } else {
                    aggregatedResults.requests[reqId].status = singleRequestAnalysis.status || 'NotFoundInAggregation';
                    if (singleRequestAnalysis.errorMessage && !aggregatedResults.requests[reqId].errorMessages?.includes(singleRequestAnalysis.errorMessage!)) {
                        aggregatedResults.requests[reqId].errorMessages = [...(aggregatedResults.requests[reqId].errorMessages || []), singleRequestAnalysis.errorMessage!];
                    }
                }
                if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                    aggregatedResults.analyzedRequestIds.push(reqId);
                }
                singleRequestAnalysis.logProcessingErrors.forEach(err_str => {
                    if (!aggregatedResults.logProcessingErrors.includes(err_str)) {
                        aggregatedResults.logProcessingErrors.push(err_str);
                    }
                });
                if (singleRequestAnalysis.errorMessage && !aggregatedResults.logProcessingErrors.some(e_str => e_str.includes(singleRequestAnalysis.errorMessage!))) {
                    aggregatedResults.logProcessingErrors.push(`Error for ${reqId}: ${singleRequestAnalysis.errorMessage}`);
                }
                continue;
            }

            if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                aggregatedResults.analyzedRequestIds.push(reqId);
            }

            if (singleRequestAnalysis.requests[reqId]) {
                aggregatedResults.requests[reqId] = singleRequestAnalysis.requests[reqId];
                const reqSummary = singleRequestAnalysis.requests[reqId];

                const reqStartTime = reqSummary.startTime;
                const reqEndTime = reqSummary.endTime;
                if (reqStartTime) {
                    const reqStartMs = new Date(reqStartTime).getTime();
                    if (overallMinStartTimeMs === null || reqStartMs < overallMinStartTimeMs) overallMinStartTimeMs = reqStartMs;
                }
                if (reqEndTime) {
                    const reqEndMs = new Date(reqEndTime).getTime();
                    if (overallMaxEndTimeMs === null || reqEndMs > overallMaxEndTimeMs) overallMaxEndTimeMs = reqEndMs;
                }
                if (typeof reqSummary.durationSeconds === 'number') {
                    totalAggregatedDurationSeconds += reqSummary.durationSeconds;
                }

                // Sử dụng merger functions
                JournalAnalysisMerger.mergeOverallJournalAnalysis(aggregatedResults.overall, singleRequestAnalysis.overall, reqSummary.dataSource);
                JournalAnalysisMerger.mergePlaywrightJournalAnalysis(aggregatedResults.playwright, singleRequestAnalysis.playwright);
                JournalAnalysisMerger.mergeApiKeyManagerJournalAnalysis(aggregatedResults.apiKeyManager, singleRequestAnalysis.apiKeyManager);
                JournalAnalysisMerger.mergeGoogleSearchJournalAnalysis(aggregatedResults.googleSearch, singleRequestAnalysis.googleSearch);
                JournalAnalysisMerger.mergeBioxbioAnalysis(aggregatedResults.bioxbio, singleRequestAnalysis.bioxbio);
                JournalAnalysisMerger.mergeScimagoJournalAnalysis(aggregatedResults.scimago, singleRequestAnalysis.scimago);
                JournalAnalysisMerger.mergeJournalFileOutputAnalysis(aggregatedResults.fileOutput, singleRequestAnalysis.fileOutput);

                for (const errKey in singleRequestAnalysis.errorsAggregated) {
                    aggregatedResults.errorsAggregated[errKey] = (aggregatedResults.errorsAggregated[errKey] || 0) + singleRequestAnalysis.errorsAggregated[errKey];
                }
                Object.assign(aggregatedResults.journalAnalysis, singleRequestAnalysis.journalAnalysis);

                aggregatedResults.errorLogCount += singleRequestAnalysis.errorLogCount;
                aggregatedResults.fatalLogCount += singleRequestAnalysis.fatalLogCount;
                singleRequestAnalysis.logProcessingErrors.forEach(err_str => {
                    if (!aggregatedResults.logProcessingErrors.includes(err_str)) {
                        aggregatedResults.logProcessingErrors.push(err_str);
                    }
                });

            } else {
                logger.warn(`No request data found in single analysis for journal request ${reqId}, though it was expected.`);
                if (!aggregatedResults.requests[reqId]) {
                    aggregatedResults.requests[reqId] = {
                        batchRequestId: reqId, startTime: null, endTime: null, durationSeconds: 0,
                        status: 'Unknown', dataSource: undefined, errorMessages: ['Data missing in aggregation step']
                    } as JournalRequestSummary;
                }
                if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                    aggregatedResults.analyzedRequestIds.push(reqId);
                }
            }
        }

        // Tính toán lại các trường tổng hợp cuối cùng nếu cần
        if (overallMinStartTimeMs) aggregatedResults.overall.startTime = new Date(overallMinStartTimeMs).toISOString();
        if (overallMaxEndTimeMs) aggregatedResults.overall.endTime = new Date(overallMaxEndTimeMs).toISOString();
        aggregatedResults.overall.durationSeconds = totalAggregatedDurationSeconds;

        // --- Logic xác định status và errorMessage tổng hợp cho aggregatedResults ---
        if (aggregatedResults.analyzedRequestIds.length > 0) {
            const requestStatuses = aggregatedResults.analyzedRequestIds.map(id => aggregatedResults.requests[id]?.status);
            const requestErrorMessagesMap = new Map<string, string[]>();
            aggregatedResults.analyzedRequestIds.forEach(id => {
                if (aggregatedResults.requests[id]?.errorMessages?.length) {
                    requestErrorMessagesMap.set(id, aggregatedResults.requests[id].errorMessages!);
                }
            });

            if (requestStatuses.some(s => s === 'Processing')) {
                aggregatedResults.status = 'Processing';
                aggregatedResults.errorMessage = 'One or more aggregated journal requests are still processing.';
            } else if (requestStatuses.every(s => s === 'Failed' || s === 'NotFoundInAggregation')) {
                aggregatedResults.status = 'Failed';
                aggregatedResults.errorMessage = 'All aggregated journal requests failed or were not found.';
            } else if (requestStatuses.some(s => s === 'Failed' || s === 'CompletedWithErrors' || s === 'NotFoundInAggregation')) {
                aggregatedResults.status = 'CompletedWithErrors';
                const problematicRequestIds = aggregatedResults.analyzedRequestIds.filter(id =>
                    ['Failed', 'CompletedWithErrors', 'NotFoundInAggregation'].includes(aggregatedResults.requests[id]?.status || '')
                );
                if (problematicRequestIds.length === 1) {
                    const problemReqId = problematicRequestIds[0];
                    const errorMsgs = requestErrorMessagesMap.get(problemReqId);
                    aggregatedResults.errorMessage = errorMsgs?.join('; ') || `Journal request ${problemReqId} had issues.`;
                } else {
                    const collectedErrorMessages: string[] = [];
                    let count = 0;
                    for (const reqId of problematicRequestIds) {
                        if (count >= 2) break;
                        const errorMsgs = requestErrorMessagesMap.get(reqId);
                        if (errorMsgs?.length) {
                            collectedErrorMessages.push(`Req ${reqId.slice(-6)}: ${errorMsgs[0]}`);
                            count++;
                        }
                    }
                    if (collectedErrorMessages.length > 0) {
                        aggregatedResults.errorMessage = `Multiple journal requests had issues. Examples: ${collectedErrorMessages.join('; ')}. Total problematic: ${problematicRequestIds.length}.`;
                    } else {
                        aggregatedResults.errorMessage = `${problematicRequestIds.length} journal requests completed with errors, failed, or were not found.`;
                    }
                }
            } else if (requestStatuses.every(s => ['Completed', 'Skipped', 'PartiallyCompleted', 'NoData', 'Unknown', 'NoRequestsAnalyzed'].includes(s || ''))) {
                if (requestStatuses.some(s => s === 'PartiallyCompleted')) {
                    aggregatedResults.status = 'PartiallyCompleted';
                    aggregatedResults.errorMessage = 'Some aggregated journal requests were only partially completed.';
                } else if (requestStatuses.some(s => s === 'Unknown')) {
                    aggregatedResults.status = 'Unknown';
                    aggregatedResults.errorMessage = 'The status of some aggregated journal requests could not be determined.';
                } else if (requestStatuses.every(s => ['Completed', 'Skipped', 'NoData', 'NoRequestsAnalyzed'].includes(s || ''))) {
                    aggregatedResults.status = 'Completed';
                    if (requestStatuses.some(s => s === 'Skipped' || s === 'NoData' || s === 'NoRequestsAnalyzed')) {
                        aggregatedResults.errorMessage = 'All journal requests processed; some were skipped, had no data, or were not analyzed individually.';
                    }
                } else {
                    aggregatedResults.status = 'Completed';
                }
            } else {
                aggregatedResults.status = 'Unknown';
                aggregatedResults.errorMessage = "The overall status of aggregated journal requests could not be determined due to an unexpected combination of request statuses.";
            }
        } else {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = aggregatedResults.errorMessage || "No processable journal requests found after attempting aggregation.";
        }

        if ((aggregatedResults.status === 'Failed' || aggregatedResults.status === 'CompletedWithErrors') && !aggregatedResults.errorMessage) {
            if (aggregatedResults.overall.totalJournalsFailed > 0) { // Sử dụng một metric tổng hợp của journal
                aggregatedResults.errorMessage = `Aggregation completed with ${aggregatedResults.overall.totalJournalsFailed} failed journal processing tasks.`;
            } else {
                aggregatedResults.errorMessage = `Aggregation finished with status ${aggregatedResults.status}, but no specific error message was generated.`;
            }
        }
        if (aggregatedResults.status === 'Completed' && aggregatedResults.overall.totalJournalsFailed > 0) {
            aggregatedResults.status = 'CompletedWithErrors';
            if (!aggregatedResults.errorMessage) {
                aggregatedResults.errorMessage = `Aggregation completed, but ${aggregatedResults.overall.totalJournalsFailed} journal processing tasks failed.`;
            }
        }
        if (aggregatedResults.status === 'Completed' && aggregatedResults.overall.totalJournalsFailed === 0 /* && không có lỗi processing nào khác */) {
            const hasRequestLevelErrors = aggregatedResults.analyzedRequestIds.some(id => {
                const requestSummary = aggregatedResults.requests[id]; // Lấy ra một lần
                return requestSummary && requestSummary.errorMessages && requestSummary.errorMessages.length > 0;
            });

            if (!hasRequestLevelErrors) {
                aggregatedResults.errorMessage = undefined;
            } else if (!aggregatedResults.errorMessage) {
                aggregatedResults.status = 'CompletedWithErrors';
                aggregatedResults.errorMessage = "Some journal requests within the aggregation completed but had internal processing issues.";
            }
        }
        // --- Kết thúc logic xác định status và errorMessage tổng hợp ---

        aggregatedResults.analysisTimestamp = new Date().toISOString();
        logger.info(`Journal aggregation finished with overall status: ${aggregatedResults.status}, errorMessage: ${aggregatedResults.errorMessage}`);
        return aggregatedResults;
    }
}