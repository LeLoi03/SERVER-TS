// src/services/logAnalysis/journal/analysisAggregator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../../logging.service';
import { JournalLogAnalysisResult, JournalRequestSummary } from '../../../types/logAnalysisJournal/logAnalysisJournal.types';
import { initializeJournalLogAnalysisResult } from '../../../utils/logAnalysisJournal/logProcessingJournal.utils';
import * as JournalAnalysisMerger from '../../../utils/logAnalysisJournal/journalAnalysisMerger.utils';

type AnalysisFetcher = (requestId: string) => Promise<JournalLogAnalysisResult>;

@singleton()
export class JournalAnalysisAggregatorService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'JournalAnalysisAggregatorService' });
    }

    async aggregate(
        requestIds: string[],
        analysisFetcher: AnalysisFetcher
    ): Promise<JournalLogAnalysisResult> {
        const logger = this.serviceLogger.child({ function: 'aggregate' });
        logger.info(`Aggregating analysis for ${requestIds.length} journal requests.`);

        const aggregatedResults: JournalLogAnalysisResult = initializeJournalLogAnalysisResult(undefined);
        aggregatedResults.status = 'Processing';

        if (requestIds.length === 0) {
            aggregatedResults.status = 'NoRequestsAnalyzed';
            aggregatedResults.errorMessage = 'No journal requests found for aggregation.';
            logger.warn(aggregatedResults.errorMessage);
            aggregatedResults.analysisTimestamp = new Date().toISOString();
            return aggregatedResults;
        }

        let overallMinStartTimeMs: number | null = null;
        let overallMaxEndTimeMs: number | null = null;
        let totalAggregatedDurationSeconds = 0;

        for (const reqId of requestIds) {
            const singleRequestAnalysis = await analysisFetcher(reqId);

            // --- BẮT ĐẦU SỬA ĐỔI ---

            // Xử lý trường hợp không tìm thấy dữ liệu cho request một cách riêng biệt
            if (singleRequestAnalysis.status === 'NoRequestsAnalyzed' || singleRequestAnalysis.analyzedRequestIds.length === 0) {
                logger.warn(`No data found for journal request ${reqId}. Marking as 'NotFoundInAggregation'.`);
                if (!aggregatedResults.requests[reqId]) {
                    aggregatedResults.requests[reqId] = {
                        batchRequestId: reqId, startTime: null, endTime: null, durationSeconds: 0,
                        status: 'NotFoundInAggregation',
                        dataSource: singleRequestAnalysis.requests[reqId]?.dataSource,
                        errorMessages: singleRequestAnalysis.errorMessage ? [singleRequestAnalysis.errorMessage] : [],
                    } as JournalRequestSummary;
                }
                if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                    aggregatedResults.analyzedRequestIds.push(reqId);
                }
                continue; // Vẫn giữ continue cho trường hợp này vì thực sự không có gì để merge
            }

            // --- KẾT THÚC SỬA ĐỔI ---


            // Luồng merge chuẩn cho TẤT CẢ các request có dữ liệu (kể cả 'Failed')
            if (!aggregatedResults.analyzedRequestIds.includes(reqId)) {
                aggregatedResults.analyzedRequestIds.push(reqId);
            }

            if (singleRequestAnalysis.requests[reqId]) {
                // Gán toàn bộ object request chi tiết, không tạo object rỗng nữa
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

                // Merge tất cả các phần dữ liệu chi tiết
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
                // Quan trọng: Merge cả journalAnalysis của request lỗi
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
            }
        }

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
            if (aggregatedResults.overall.totalJournalsFailed > 0) {
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
        if (aggregatedResults.status === 'Completed' && aggregatedResults.overall.totalJournalsFailed === 0) {
            const hasRequestLevelErrors = aggregatedResults.analyzedRequestIds.some(id => {
                const requestSummary = aggregatedResults.requests[id];
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
        logger.info(`Journal aggregation finished with overall status: ${aggregatedResults.status}`);
        return aggregatedResults;
    }
}