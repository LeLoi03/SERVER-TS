// src/services/conferenceLogAnalysis/analysisAggregator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../../logging.service';
import { ConferenceLogAnalysisResult, RequestTimings } from '../../../types/logAnalysis';
import { getInitialLogAnalysisResult } from '../../../types/logAnalysis/initializers';
import * as ConferenceAnalysisMerger from '../../../utils/logAnalysisConference/conferenceAnalysisMerger.utils';

// Một kiểu hàm để lấy kết quả phân tích cho một ID.
// Điều này giúp tách biệt Aggregator khỏi việc biết cách lấy dữ liệu (cache hay live).
type AnalysisFetcher = (requestId: string) => Promise<ConferenceLogAnalysisResult>;

@singleton()
export class ConferenceAnalysisAggregatorService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'ConferenceAnalysisAggregatorService' });
    }

    /**
     * Tổng hợp kết quả phân tích từ nhiều request.
     * Đây là logic được chuyển từ `aggregateAllConferenceAnalyses` cũ.
     */
    async aggregate(
        requestIds: string[],
        analysisFetcher: AnalysisFetcher
    ): Promise<ConferenceLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregate' });
        logger.info(`Aggregating analysis for ${requestIds.length} conference requests.`);

        const aggregatedResults: ConferenceLogAnalysisResult = getInitialLogAnalysisResult(undefined);
        aggregatedResults.status = 'Processing';

        if (requestIds.length === 0) {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = 'No conference requests found for aggregation.';
            logger.warn(aggregatedResults.errorMessage);
            aggregatedResults.analysisTimestamp = new Date().toISOString();
            return aggregatedResults;
        }

        let overallMinStartTimeMs: number | null = null;
        let overallMaxEndTimeMs: number | null = null;
        let totalAggregatedDurationSeconds = 0;

        for (const reqId of requestIds) {
            // Sử dụng hàm fetcher được truyền vào để lấy kết quả phân tích
            const singleRequestAnalysis = await analysisFetcher(reqId);

            // // --- TOÀN BỘ LOGIC MERGE VÀ XỬ LÝ LỖI TỪ HÀM GỐC ĐƯỢC GIỮ NGUYÊN ---
            // if (singleRequestAnalysis.status === 'Failed' ||
            //     singleRequestAnalysis.status === 'NoRequestsAnalyzed' ||
            //     (singleRequestAnalysis.analyzedRequestIds.length === 0 && singleRequestAnalysis.filterRequestId === reqId)) {
            //     logger.warn(`Skipping full aggregation for conference ${reqId} due to its status: ${singleRequestAnalysis.status} or no data found for it.`);
            //     if (!aggregatedResults.requests[reqId]) {
            //         aggregatedResults.requests[reqId] = {
            //             startTime: null, endTime: null, durationSeconds: 0,
            //             totalConferencesInputForRequest: 0, processedConferencesCountForRequest: 0,
            //             status: singleRequestAnalysis.status || 'NotFoundInAggregation',
            //             errorMessages: singleRequestAnalysis.errorMessage ? [singleRequestAnalysis.errorMessage] : [],
            //         } as RequestTimings;
            //     } else {
            //         aggregatedResults.requests[reqId].status = singleRequestAnalysis.status || 'NotFoundInAggregation';
            //         if (singleRequestAnalysis.errorMessage && !aggregatedResults.requests[reqId].errorMessages?.includes(singleRequestAnalysis.errorMessage!)) {
            //             aggregatedResults.requests[reqId].errorMessages = [...(aggregatedResults.requests[reqId].errorMessages || []), singleRequestAnalysis.errorMessage!];
            //         }
            //     }
            //     if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
            //         aggregatedResults.analyzedRequestIds.push(reqId);
            //     }
            //     aggregatedResults.logProcessingErrors.push(...singleRequestAnalysis.logProcessingErrors);
            //     if (singleRequestAnalysis.errorMessage && !aggregatedResults.logProcessingErrors.some(e_str => e_str.includes(singleRequestAnalysis.errorMessage!))) {
            //         aggregatedResults.logProcessingErrors.push(`Error for ${reqId}: ${singleRequestAnalysis.errorMessage}`);
            //     }
            //     continue;
            // }

            // BÂY GIỜ, TẤT CẢ CÁC REQUEST, KỂ CẢ 'Failed', SẼ ĐI QUA LUỒNG NÀY

            // Xử lý trường hợp không tìm thấy dữ liệu cho request
            if (singleRequestAnalysis.status === 'NoRequestsAnalyzed' || singleRequestAnalysis.analyzedRequestIds.length === 0) {
                logger.warn(`No data found for conference request ${reqId}. Marking as 'NotFoundInAggregation'.`);
                if (!aggregatedResults.requests[reqId]) {
                    aggregatedResults.requests[reqId] = {
                        startTime: null, endTime: null, durationSeconds: 0,
                        totalConferencesInputForRequest: 0, processedConferencesCountForRequest: 0,
                        status: 'NotFoundInAggregation',
                        errorMessages: singleRequestAnalysis.errorMessage ? [singleRequestAnalysis.errorMessage] : [],
                    } as RequestTimings;
                }
                if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                    aggregatedResults.analyzedRequestIds.push(reqId);
                }
                continue; // Vẫn giữ continue cho trường hợp này vì thực sự không có gì để merge
            }

            // Luồng merge chuẩn
            if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                aggregatedResults.analyzedRequestIds.push(reqId);
            }

            // Lấy dữ liệu request đầy đủ, kể cả khi nó 'Failed'
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
            // Quan trọng: Merge cả conferenceAnalysis của request lỗi
            Object.assign(aggregatedResults.conferenceAnalysis, singleRequestAnalysis.conferenceAnalysis);
        }

        aggregatedResults.overall.processedConferencesCount = Object.keys(aggregatedResults.conferenceAnalysis).length;
        if (overallMinStartTimeMs) aggregatedResults.overall.startTime = new Date(overallMinStartTimeMs).toISOString();
        if (overallMaxEndTimeMs) aggregatedResults.overall.endTime = new Date(overallMaxEndTimeMs).toISOString();
        aggregatedResults.overall.durationSeconds = totalAggregatedDurationSeconds;

        // --- Logic xác định status và errorMessage tổng hợp (giữ nguyên) ---
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
        logger.info(`Conference aggregation finished with overall status: ${aggregatedResults.status}`);
        return aggregatedResults;
    }
}