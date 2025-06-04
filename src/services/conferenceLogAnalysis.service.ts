
// src/services/conferenceLogAnalysis.service.ts
import 'reflect-metadata';
import { singleton, inject, delay } from 'tsyringe';
import fs from 'fs/promises'; // Sử dụng fs.promises
import fsSync from 'fs'; // Sử dụng fsSync cho existsSync
import path from 'path'; // Thêm path
import readline from 'readline';
import {
    ConferenceLogAnalysisResult,
    ReadLogResult,
    FilteredData,
    RequestTimings,
    OverallAnalysis,
    GoogleSearchAnalysis,
    PlaywrightAnalysis,
    GeminiApiAnalysis,
    BatchProcessingAnalysis,
    FileOutputAnalysis,
    ValidationStats,
    ConferenceAnalysisDetail,
} from '../types/logAnalysis';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils';

import {
    readAndGroupConferenceLogs, // Hàm này sẽ cần được điều chỉnh hoặc thay thế logic đọc file
    filterRequests, // Hàm này có thể vẫn hữu ích nếu readAndGroupConferenceLogs trả về cấu trúc tương tự
    processLogEntry,
    calculateFinalMetrics
} from '../utils/logAnalysisConference/logProcessing.utils';
import { createConferenceKey } from '../utils/logAnalysisConference/helpers';
import { LogAnalysisCacheService } from './logAnalysisCache.service';
import { getInitialLogAnalysisResult } from '../types/logAnalysis/initializers';

import * as ConferenceAnalysisMerger from '../utils/logAnalysisConference/conferenceAnalysisMerger.utils';

interface SaveEventLogEntry {
    time: string;
    level: number;
    event?: 'CONFERENCE_SAVE_EVENT_RECORDED' | string;
    details?: {
        batchRequestId: string;
        acronym: string;
        title: string;
        recordedStatus: 'SAVED_TO_DATABASE' | string;
        clientTimestamp: string;
    };
}

@singleton()
export class ConferenceLogAnalysisService {
    private readonly serviceLogger: Logger;
    // private readonly conferenceLogFilePath: string; // Bỏ đi
    private readonly saveConferenceEventsLogFilePath: string;
    private readonly conferenceRequestLogBaseDir: string; // Thư mục chứa các file log theo request

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(delay(() => LogAnalysisCacheService)) private cacheService: LogAnalysisCacheService
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { // Dùng app logger cho service này
            service: 'ConferenceLogAnalysisService'
        });
        // this.conferenceLogFilePath = this.configService.conferenceLogFilePathForReading; // Bỏ đi
        this.saveConferenceEventsLogFilePath = this.configService.getSaveConferenceEventLogFilePath();
        this.conferenceRequestLogBaseDir = this.configService.appConfiguration.conferenceRequestLogDirectory;

        this.serviceLogger.info({
            event: 'conference_log_analysis_init_success',
            conferenceRequestLogBaseDir: this.conferenceRequestLogBaseDir,
            saveConferenceEventsLogFilePath: this.saveConferenceEventsLogFilePath
        }, `ConferenceLogAnalysisService initialized.`);

        // Không cần kiểm tra file log conference chung nữa
        if (!fsSync.existsSync(this.conferenceRequestLogBaseDir)) {
            this.serviceLogger.warn({ event: 'conference_request_log_dir_not_found_on_init', dirPath: this.conferenceRequestLogBaseDir }, `Conference request log directory not found: ${this.conferenceRequestLogBaseDir}. This directory should be created by LoggingService.`);
        }
        if (!fsSync.existsSync(this.saveConferenceEventsLogFilePath)) {
            this.serviceLogger.warn({ event: 'save_events_log_file_not_found_on_init', logFilePath: this.saveConferenceEventsLogFilePath }, `Save events log file not found. Persisted save statuses might be missing.`);
        }
    }

    private async readConferenceSaveEvents(): Promise<Map<string, NonNullable<SaveEventLogEntry['details']>>> {
        const saveEventsMap = new Map<string, NonNullable<SaveEventLogEntry['details']>>();
        const logContext = { function: 'readConferenceSaveEvents', logFilePath: this.saveConferenceEventsLogFilePath };
        const logger = this.serviceLogger.child(logContext);

        if (!fsSync.existsSync(this.saveConferenceEventsLogFilePath)) {
            logger.warn({ event: 'save_event_log_not_found' }, 'Save event log file not found.');
            return saveEventsMap;
        }

        logger.debug({ event: 'read_save_events_start' }, 'Starting to read conference save events log.');
        let lineCount = 0;
        let parsedCount = 0;

        const fileStream = fsSync.createReadStream(this.saveConferenceEventsLogFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        try {
            for await (const line of rl) {
                lineCount++;
                if (!line.trim()) continue;
                try {
                    const logEntry = JSON.parse(line) as SaveEventLogEntry;
                    if (logEntry.event === 'CONFERENCE_SAVE_EVENT_RECORDED' && logEntry.details?.batchRequestId && logEntry.details?.acronym && logEntry.details?.title) {
                        const { batchRequestId, acronym, title } = logEntry.details;
                        const key = createConferenceKey(batchRequestId, acronym, title);
                        if (key) {
                            saveEventsMap.set(key, logEntry.details);
                            parsedCount++;
                        }
                    }
                } catch (parseError) {
                    logger.warn({ event: 'parse_save_event_line_error', lineNumber: lineCount, error: getErrorMessageAndStack(parseError).message }, `Failed to parse line from save event log.`);
                }
            }
            logger.debug({ event: 'read_save_events_finish', totalLines: lineCount, parsedEvents: parsedCount }, `Finished reading save events log.`);
        } catch (readError) {
            const { message, stack } = getErrorMessageAndStack(readError);
            logger.error({ event: 'read_save_events_file_error', err: { message, stack } }, `Error reading save events log file: ${message}`);
        }
        return saveEventsMap;
    }

    async performConferenceAnalysisAndUpdate(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number,
        filterRequestId?: string // Đây sẽ là batchRequestId
    ): Promise<ConferenceLogAnalysisResult> {
        const logContext = {
            function: 'performConferenceAnalysisAndUpdate',
            filterRequestId,
            filterStartTime: filterStartTimeInput ? new Date(filterStartTimeInput).toISOString() : undefined,
            filterEndTime: filterEndTimeInput ? new Date(filterEndTimeInput).toISOString() : undefined
        };
        const logger = this.serviceLogger.child(logContext);

        // --- XÁC ĐỊNH XEM CÓ FILTER THỜI GIAN ĐƯỢC ÁP DỤNG KHÔNG ---
        const hasTimeFilter = filterStartTimeInput !== undefined || filterEndTimeInput !== undefined;

        if (filterRequestId) {
            // --- XỬ LÝ CHO MỘT REQUEST ID CỤ THỂ ---
            logger.info(`Analyzing specific conference request ID: ${filterRequestId}${hasTimeFilter ? ' WITH time filter.' : '.'}`);
            const requestLogFilePath = this.configService.getRequestSpecificLogFilePath('conference', filterRequestId);
            let analysisResult: ConferenceLogAnalysisResult;

            // --- LOGIC ĐỌC CACHE ĐƯỢC SỬA ĐỔI ---
            if (this.configService.analysisCacheEnabled && !hasTimeFilter) { // <<<< THAY ĐỔI Ở ĐÂY: Chỉ đọc cache nếu KHÔNG có filter thời gian
                logger.debug(`Attempting to read from cache for ${filterRequestId} as no time filter is applied.`);
                const cachedResult = await this.cacheService.readFromCache<ConferenceLogAnalysisResult>('conference', filterRequestId);
                if (cachedResult) {
                    if (cachedResult.status && !['Processing', 'Unknown'].includes(cachedResult.status)) {
                        logger.info(`Valid cached conference result found for request ID: ${filterRequestId} with status: ${cachedResult.status}. Decorating with latest save events.`);
                        cachedResult.logFilePath = requestLogFilePath;
                        cachedResult.analysisTimestamp = new Date().toISOString();

                        // *** TRANG TRÍ KẾT QUẢ CACHE VỚI SAVE EVENTS MỚI NHẤT ***
                        const latestSaveEventsMap = await this.readConferenceSaveEvents();
                        logger.debug({ cachedKeys: Object.keys(cachedResult.conferenceAnalysis).length, saveEventKeys: latestSaveEventsMap.size }, `Decorating cached result. Number of conference details in cache: ${Object.keys(cachedResult.conferenceAnalysis).length}. Number of save events found: ${latestSaveEventsMap.size}`);

                        let updatedCount = 0;
                        Object.values(cachedResult.conferenceAnalysis).forEach(detail => {
                            const key = createConferenceKey(detail.batchRequestId, detail.acronym, detail.title);
                            if (!key) {
                                logger.warn({ detail }, "Could not create key for conference detail during cache decoration. Skipping save status update for this entry.");
                                return;
                            }
                            const savedEventDetails = latestSaveEventsMap.get(key);
                            if (savedEventDetails) {
                                // Chỉ cập nhật nếu có sự thay đổi hoặc chưa có, để tránh ghi log không cần thiết
                                if (detail.persistedSaveStatus !== savedEventDetails.recordedStatus || detail.persistedSaveTimestamp !== savedEventDetails.clientTimestamp) {
                                    detail.persistedSaveStatus = savedEventDetails.recordedStatus;
                                    detail.persistedSaveTimestamp = savedEventDetails.clientTimestamp;
                                    updatedCount++;
                                }
                            } else {
                                // Nếu không tìm thấy trong save events mới nhất,
                                // và trước đó nó có trạng thái save, thì xóa đi.
                                if (detail.persistedSaveStatus) {
                                    detail.persistedSaveStatus = undefined;
                                    detail.persistedSaveTimestamp = undefined;
                                    updatedCount++;
                                }
                            }
                        });
                        if (updatedCount > 0) {
                            logger.info(`Decorated ${updatedCount} conference details in cached result with latest save statuses for ${filterRequestId}.`);
                        }

                        // QUAN TRỌNG: KHÔNG GHI LẠI `cachedResult` ĐÃ ĐƯỢC TRANG TRÍ NÀY VÀO CACHE
                        // Vì cache nên lưu trữ kết quả "gốc" của việc phân tích log request.
                        // Việc "trang trí" này là cho lần trả về hiện tại.
                        return cachedResult;
                    } else {
                        // Cache tồn tại nhưng không hợp lệ (ví dụ: đang Processing), cần phân tích live.
                        logger.info(`Cached result for ${filterRequestId} is '${cachedResult.status}'. Will perform live analysis.`);
                    }
                } else {
                    // Không tìm thấy cache.
                    logger.info(`No cache found for ${filterRequestId}. Performing live analysis.`);
                }
            } else if (hasTimeFilter) {
                logger.info(`Time filter is active. Skipping cache read for ${filterRequestId}. Performing live analysis.`);
            } else { // Caching is disabled
                logger.info('Caching is disabled. Performing live analysis for conference request.');
            }

            // Nếu không có cache hợp lệ, hoặc caching bị tắt, hoặc CÓ TIME FILTER -> Phân tích live
            analysisResult = await this.analyzeLiveLogsForRequest(
                filterRequestId,
                requestLogFilePath,
                filterStartTimeInput,
                filterEndTimeInput
            );


            // --- LOGIC GHI CACHE ĐƯỢC SỬA ĐỔI ---
            // Chỉ ghi vào cache nếu kết quả này được tạo ra MÀ KHÔNG CÓ filter thời gian.
            // Điều này đảm bảo cache luôn chứa phiên bản "đầy đủ" của request.
            if (this.configService.analysisCacheEnabled && !hasTimeFilter && // <<<< THAY ĐỔI Ở ĐÂY
                analysisResult.status && !['Processing', 'Unknown'].includes(analysisResult.status)) {
                logger.info(`Caching live analysis result (generated without time filter) for ${filterRequestId} with status ${analysisResult.status}.`);
                await this.cacheService.writeToCache('conference', filterRequestId, analysisResult);
            } else if (this.configService.analysisCacheEnabled && hasTimeFilter) {
                logger.info(`Live analysis result for ${filterRequestId} was generated WITH a time filter. Skipping cache write.`);
            }
            return analysisResult;

          } else {
            // --- XỬ LÝ CHO TRƯỜNG HỢP TỔNG HỢP (KHÔNG CÓ filterRequestId) ---
            // Khi tổng hợp, chúng ta sẽ gọi lại performConferenceAnalysisAndUpdate cho từng request ID.
            // Logic ở trên (bao gồm cả việc bỏ qua cache nếu có time filter) sẽ được áp dụng cho mỗi request đó.
            logger.info(`Aggregating all conference requests${hasTimeFilter ? ' WITH time filter.' : '.'}`);
            return this.aggregateAllConferenceAnalyses(filterStartTimeInput, filterEndTimeInput);
        }
    }

    // Đổi tên và sửa đổi hàm này để phân tích một file log cụ thể của request
    private async analyzeLiveLogsForRequest(
        batchRequestId: string, // Bắt buộc
        requestLogFilePath: string, // Đường dẫn file log của request
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logContext = { function: 'analyzeLiveLogsForRequest', batchRequestId, requestLogFilePath };
        const logger = this.serviceLogger.child(logContext);
        logger.info('Performing live log analysis for a specific conference request.');

        const results: ConferenceLogAnalysisResult = getInitialLogAnalysisResult(requestLogFilePath); // Sử dụng đường dẫn file log của request
        results.filterRequestId = batchRequestId; // Đặt filterRequestId là batchRequestId đang xử lý

        const filterStartMillis = filterStartTimeInput ? new Date(filterStartTimeInput).getTime() : null;
        const filterEndMillis = filterEndTimeInput ? new Date(filterEndTimeInput).getTime() : null;

        if (filterStartMillis !== null && filterEndMillis !== null && filterStartMillis > filterEndMillis) {
            results.status = 'Failed';
            results.errorMessage = 'Invalid filter time range: Start time is after end time.';
            logger.warn(results.errorMessage);
            return results;
        }

        try {
            if (!fsSync.existsSync(requestLogFilePath)) {
                results.status = 'Failed'; // Hoặc 'NoRequestsAnalyzed' nếu file không tồn tại có nghĩa là request chưa chạy/log
                results.errorMessage = `Conference log file for request ${batchRequestId} not found: ${requestLogFilePath}.`;
                logger.error(results.errorMessage);
                return results;
            }

            const conferenceSaveEventsMap = await this.readConferenceSaveEvents();
            // readAndGroupConferenceLogs cần được gọi với đường dẫn file log của request
            // Và nó chỉ nên trả về dữ liệu cho request đó (vì file chỉ chứa log của request đó)
            const readResult: ReadLogResult = await readAndGroupConferenceLogs(requestLogFilePath, batchRequestId); // Truyền batchRequestId để hàm này biết chỉ xử lý ID đó

            results.totalLogEntries = readResult.totalEntries;
            results.parsedLogEntries = readResult.parsedEntries;
            results.parseErrors = readResult.parseErrors;
            results.logProcessingErrors.push(...readResult.logProcessingErrors);

            // filterRequests giờ sẽ hoạt động trên dữ liệu của một request duy nhất
            // Nếu readAndGroupConferenceLogs đã lọc sẵn theo batchRequestId, thì filterRequests ở đây
            // chủ yếu là để áp dụng filterStartTime/EndTime.
            const {
                filteredRequests, // Sẽ chỉ chứa 1 entry nếu readAndGroupConferenceLogs hoạt động đúng
                analysisStartMillis: actualAnalysisStartMillis,
                analysisEndMillis: actualAnalysisEndMillis
            }: FilteredData = filterRequests(
                readResult.requestsData,
                filterStartMillis,
                filterEndMillis,
                batchRequestId // Luôn truyền batchRequestId
            );

            results.analyzedRequestIds = Array.from(filteredRequests.keys());

            // Kiểm tra xem request ID mong muốn có thực sự được tìm thấy không
            if (!filteredRequests.has(batchRequestId) || filteredRequests.size === 0) {
                logger.warn(`Live analysis: Data for requested ID ${batchRequestId} not found in its log file or did not match time filters.`);
                results.status = 'NoRequestsAnalyzed';
                results.errorMessage = `No conference log data found for request ID ${batchRequestId} in file ${requestLogFilePath} matching filters.`;
                return results;
            }

            const conferenceLastTimestamp: { [compositeKey: string]: number } = {};
            // Lặp qua request duy nhất (nếu có)
            const requestInfo = filteredRequests.get(batchRequestId);
            if (requestInfo) {
                for (const logEntry of requestInfo.logs) {
                    processLogEntry(logEntry, results, conferenceLastTimestamp);
                }
            }

            Object.entries(results.conferenceAnalysis).forEach(([confKey, detail]) => {
                const savedEventDetails = conferenceSaveEventsMap.get(confKey);
                if (savedEventDetails) {
                    detail.persistedSaveStatus = savedEventDetails.recordedStatus;
                    detail.persistedSaveTimestamp = savedEventDetails.clientTimestamp;
                }
            });

            calculateFinalMetrics(results, conferenceLastTimestamp, actualAnalysisStartMillis, actualAnalysisEndMillis, filteredRequests);

            logger.info(`Live conference analysis for ${batchRequestId} finished with status: ${results.status}, errorMessage: ${results.errorMessage}`);
            return results;

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack } }, `Fatal error during live conference log analysis for ${batchRequestId}: "${errorMessage}".`);
            results.status = 'Failed';
            results.errorMessage = `Fatal error during live analysis for ${batchRequestId}: "${errorMessage}".`;
            results.logProcessingErrors.push(`FATAL LIVE ANALYSIS ERROR for ${batchRequestId}: "${errorMessage}". Stack: ${errorStack}.`);
            return results;
        }
    }

    private async aggregateAllConferenceAnalyses(
        filterStartTimeInput?: Date | number,
        filterEndTimeInput?: Date | number
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregateAllConferenceAnalyses' });
        logger.info('Aggregating analysis for all conference requests.');

        // aggregatedResults sẽ không có logFilePath chung nữa, hoặc có thể là null/undefined
        const aggregatedResults: ConferenceLogAnalysisResult = getInitialLogAnalysisResult(undefined);
        aggregatedResults.status = 'Processing';

        const filterStartMillis = filterStartTimeInput ? new Date(filterStartTimeInput).getTime() : null;
        const filterEndMillis = filterEndTimeInput ? new Date(filterEndTimeInput).getTime() : null;

        let cachedRequestIds: string[] = [];
        if (this.configService.analysisCacheEnabled) {
            cachedRequestIds = await this.cacheService.getAllCachedRequestIds('conference');
            logger.info(`Found ${cachedRequestIds.length} conference request IDs in cache.`);
        } else {
            logger.info('Caching is disabled, skipping cache ID retrieval for conference aggregation.');
        }

        let liveRequestIdsFromLogFiles: string[] = [];
        try {
            if (fsSync.existsSync(this.conferenceRequestLogBaseDir)) {
                const files = await fs.readdir(this.conferenceRequestLogBaseDir);
                liveRequestIdsFromLogFiles = files
                    .filter(file => file.endsWith('.log')) // Chỉ lấy file .log
                    .map(file => path.basename(file, '.log')); // Lấy tên file không có .log
                logger.info(`Found ${liveRequestIdsFromLogFiles.length} conference request log files in ${this.conferenceRequestLogBaseDir}.`);

                // Nếu có filter thời gian, cần lọc các request ID này dựa trên thời gian sửa đổi file
                // Hoặc, tốt hơn là để performConferenceAnalysisAndUpdate xử lý việc lọc theo thời gian khi phân tích từng file.
                // Ở đây chỉ lấy danh sách ID.
            } else {
                logger.warn(`Conference request log directory not found: ${this.conferenceRequestLogBaseDir}. No live request IDs will be discovered from files.`);
            }
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack } }, 'Error reading conference request log directory for ID discovery.');
        }

        const allUniqueRequestIds = Array.from(new Set([...cachedRequestIds, ...liveRequestIdsFromLogFiles]));
        logger.info(`Total unique conference request IDs to aggregate: ${allUniqueRequestIds.length}`);

        if (allUniqueRequestIds.length === 0) {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = 'No conference requests found in cache or log files for aggregation.';
            logger.warn(aggregatedResults.errorMessage);
            aggregatedResults.analysisTimestamp = new Date().toISOString();
            return aggregatedResults;
        }

        // Quan trọng: performConferenceAnalysisAndUpdate(filterStartTimeInput, filterEndTimeInput, reqId)
        // sẽ tự động gọi analyzeLiveLogsForRequest với đường dẫn file log đúng cho reqId đó.

        let overallMinStartTimeMs: number | null = null;
        let overallMaxEndTimeMs: number | null = null;
        let totalAggregatedDurationSeconds = 0;


        for (const reqId of allUniqueRequestIds) {
            // performConferenceAnalysisAndUpdate sẽ xử lý việc đọc cache hoặc phân tích live cho reqId này
            const singleRequestAnalysis = await this.performConferenceAnalysisAndUpdate(
                filterStartTimeInput, filterEndTimeInput, reqId
            );

            if (singleRequestAnalysis.status === 'Failed' ||
                singleRequestAnalysis.status === 'NoRequestsAnalyzed' ||
                (singleRequestAnalysis.analyzedRequestIds.length === 0 && singleRequestAnalysis.filterRequestId === reqId)) {
                logger.warn(`Skipping full aggregation for conference ${reqId} due to its status: ${singleRequestAnalysis.status} or no data found for it.`);
                if (!aggregatedResults.requests[reqId]) {
                    aggregatedResults.requests[reqId] = {
                        startTime: null, endTime: null, durationSeconds: 0,
                        totalConferencesInputForRequest: 0, processedConferencesCountForRequest: 0,
                        status: singleRequestAnalysis.status || 'NotFoundInAggregation',
                        errorMessages: singleRequestAnalysis.errorMessage ? [singleRequestAnalysis.errorMessage] : [],
                    } as RequestTimings;
                } else {
                    aggregatedResults.requests[reqId].status = singleRequestAnalysis.status || 'NotFoundInAggregation';
                    if (singleRequestAnalysis.errorMessage && !aggregatedResults.requests[reqId].errorMessages?.includes(singleRequestAnalysis.errorMessage!)) {
                        aggregatedResults.requests[reqId].errorMessages = [...(aggregatedResults.requests[reqId].errorMessages || []), singleRequestAnalysis.errorMessage!];
                    }
                }
                if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                    aggregatedResults.analyzedRequestIds.push(reqId);
                }
                aggregatedResults.logProcessingErrors.push(...singleRequestAnalysis.logProcessingErrors);
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
                const reqStartTime = singleRequestAnalysis.requests[reqId].startTime;
                const reqEndTime = singleRequestAnalysis.requests[reqId].endTime;
                if (reqStartTime) {
                    const reqStartMs = new Date(reqStartTime).getTime();
                    if (overallMinStartTimeMs === null || reqStartMs < overallMinStartTimeMs) overallMinStartTimeMs = reqStartMs;
                }
                if (reqEndTime) {
                    const reqEndMs = new Date(reqEndTime).getTime();
                    if (overallMaxEndTimeMs === null || reqEndMs > overallMaxEndTimeMs) overallMaxEndTimeMs = reqEndMs;
                }
                if (typeof singleRequestAnalysis.requests[reqId].durationSeconds === 'number') {
                    totalAggregatedDurationSeconds += singleRequestAnalysis.requests[reqId].durationSeconds as number;
                }
            } else {
                logger.warn(`No request timing data found in single analysis for conference ${reqId}, though it was expected.`);
                if (!aggregatedResults.requests[reqId]) {
                    aggregatedResults.requests[reqId] = {
                        startTime: null, endTime: null, durationSeconds: 0,
                        totalConferencesInputForRequest: 0, processedConferencesCountForRequest: 0,
                        status: 'Unknown', errorMessages: []
                    } as RequestTimings;
                }
            }

            aggregatedResults.errorLogCount += singleRequestAnalysis.errorLogCount;
            aggregatedResults.fatalLogCount += singleRequestAnalysis.fatalLogCount;

            ConferenceAnalysisMerger.mergeOverallAnalysisCounters(aggregatedResults.overall, singleRequestAnalysis.overall);
            ConferenceAnalysisMerger.mergeGoogleSearchAnalysis(aggregatedResults.googleSearch, singleRequestAnalysis.googleSearch);
            ConferenceAnalysisMerger.mergePlaywrightAnalysis(aggregatedResults.playwright, singleRequestAnalysis.playwright);
            ConferenceAnalysisMerger.mergeGeminiApiAnalysis(aggregatedResults.geminiApi, singleRequestAnalysis.geminiApi);
            ConferenceAnalysisMerger.mergeBatchProcessingAnalysis(aggregatedResults.batchProcessing, singleRequestAnalysis.batchProcessing);
            ConferenceAnalysisMerger.mergeFileOutputAnalysis(aggregatedResults.fileOutput, singleRequestAnalysis.fileOutput);
            ConferenceAnalysisMerger.mergeValidationStats(aggregatedResults.validationStats, singleRequestAnalysis.validationStats);

            for (const key in singleRequestAnalysis.errorsAggregated) {
                aggregatedResults.errorsAggregated[key] = (aggregatedResults.errorsAggregated[key] || 0) + singleRequestAnalysis.errorsAggregated[key];
            }
            singleRequestAnalysis.logProcessingErrors.forEach(err_str => {
                if (!aggregatedResults.logProcessingErrors.includes(err_str)) {
                    aggregatedResults.logProcessingErrors.push(err_str);
                }
            });
            Object.assign(aggregatedResults.conferenceAnalysis, singleRequestAnalysis.conferenceAnalysis);
        }

        aggregatedResults.overall.processedConferencesCount = Object.keys(aggregatedResults.conferenceAnalysis).length;
        if (overallMinStartTimeMs) aggregatedResults.overall.startTime = new Date(overallMinStartTimeMs).toISOString();
        if (overallMaxEndTimeMs) aggregatedResults.overall.endTime = new Date(overallMaxEndTimeMs).toISOString();
        aggregatedResults.overall.durationSeconds = totalAggregatedDurationSeconds;

        // --- Logic xác định status và errorMessage tổng hợp cho aggregatedResults ---
        // (Đây là logic tương tự STAGE 4 của calculateFinalMetrics, nhưng áp dụng cho kết quả tổng hợp)
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
                aggregatedResults.errorMessage = 'One or more aggregated requests are still processing.';
            } else if (requestStatuses.every(s => s === 'Failed' || s === 'NotFoundInAggregation')) {
                aggregatedResults.status = 'Failed';
                aggregatedResults.errorMessage = 'All aggregated requests failed or were not found.';
            } else if (requestStatuses.some(s => s === 'Failed' || s === 'CompletedWithErrors' || s === 'NotFoundInAggregation')) {
                aggregatedResults.status = 'CompletedWithErrors';
                const problematicRequestIds = aggregatedResults.analyzedRequestIds.filter(id =>
                    ['Failed', 'CompletedWithErrors', 'NotFoundInAggregation'].includes(aggregatedResults.requests[id]?.status || '')
                );
                if (problematicRequestIds.length === 1) {
                    const problemReqId = problematicRequestIds[0];
                    const errorMsgs = requestErrorMessagesMap.get(problemReqId);
                    aggregatedResults.errorMessage = errorMsgs?.join('; ') || `Request ${problemReqId} had issues.`;
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
                        aggregatedResults.errorMessage = `Multiple requests had issues. Examples: ${collectedErrorMessages.join('; ')}. Total problematic: ${problematicRequestIds.length}.`;
                    } else {
                        aggregatedResults.errorMessage = `${problematicRequestIds.length} requests completed with errors, failed, or were not found.`;
                    }
                }
            } else if (requestStatuses.every(s => ['Completed', 'Skipped', 'PartiallyCompleted', 'NoData', 'Unknown', 'NoRequestsAnalyzed'].includes(s || ''))) {
                if (requestStatuses.some(s => s === 'PartiallyCompleted')) {
                    aggregatedResults.status = 'PartiallyCompleted';
                    aggregatedResults.errorMessage = 'Some aggregated requests were only partially completed.';
                } else if (requestStatuses.some(s => s === 'Unknown')) {
                    aggregatedResults.status = 'Unknown';
                    aggregatedResults.errorMessage = 'The status of some aggregated requests could not be determined.';
                } else if (requestStatuses.every(s => ['Completed', 'Skipped', 'NoData', 'NoRequestsAnalyzed'].includes(s || ''))) {
                    aggregatedResults.status = 'Completed';
                    if (requestStatuses.some(s => s === 'Skipped' || s === 'NoData' || s === 'NoRequestsAnalyzed')) {
                        aggregatedResults.errorMessage = 'All requests processed; some were skipped, had no data, or were not analyzed individually.';
                    }
                } else {
                    aggregatedResults.status = 'Completed';
                }
            } else {
                aggregatedResults.status = 'Unknown';
                aggregatedResults.errorMessage = "The overall status of aggregated requests could not be determined due to an unexpected combination of request statuses.";
            }
        } else {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = aggregatedResults.errorMessage || "No processable conference requests found after attempting aggregation.";
        }

        if ((aggregatedResults.status === 'Failed' || aggregatedResults.status === 'CompletedWithErrors') && !aggregatedResults.errorMessage) {
            if (aggregatedResults.overall.failedOrCrashedTasks > 0) {
                aggregatedResults.errorMessage = `Aggregation completed with ${aggregatedResults.overall.failedOrCrashedTasks} failed/crashed conference tasks.`;
            } else {
                aggregatedResults.errorMessage = `Aggregation finished with status ${aggregatedResults.status}, but no specific error message was generated.`;
            }
        }
        if (aggregatedResults.status === 'Completed' && aggregatedResults.overall.failedOrCrashedTasks > 0) {
            aggregatedResults.status = 'CompletedWithErrors';
            if (!aggregatedResults.errorMessage) {
                aggregatedResults.errorMessage = `Aggregation completed, but ${aggregatedResults.overall.failedOrCrashedTasks} conference tasks failed or crashed.`;
            }
        }
        if (aggregatedResults.status === 'Completed' && aggregatedResults.overall.failedOrCrashedTasks === 0 && aggregatedResults.overall.processingTasks === 0) {
            const hasRequestLevelErrors = aggregatedResults.analyzedRequestIds.some(id => aggregatedResults.requests[id]?.errorMessages?.length > 0);
            if (!hasRequestLevelErrors) {
                aggregatedResults.errorMessage = undefined;
            } else if (!aggregatedResults.errorMessage) {
                aggregatedResults.status = 'CompletedWithErrors';
                aggregatedResults.errorMessage = "Some requests within the aggregation completed but had internal processing issues.";
            }
        }
        // --- Kết thúc logic xác định status và errorMessage tổng hợp ---

        aggregatedResults.analysisTimestamp = new Date().toISOString();
        logger.info(`Conference aggregation finished with overall status: ${aggregatedResults.status}, errorMessage: ${aggregatedResults.errorMessage}`);
        return aggregatedResults;
    }
}