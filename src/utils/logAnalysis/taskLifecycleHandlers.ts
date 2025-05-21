// src/utils/logAnalysis/taskLifecycleHandlers.ts
import { LogEventHandler } from './index'; // Đảm bảo LogEventHandler được export từ index.ts
import { normalizeErrorKey, addConferenceError } from './helpers';
import { OverallAnalysis, ConferenceAnalysisDetail, LogAnalysisResult } from '../../types/logAnalysis.types'; // Thêm LogAnalysisResult và ConferenceAnalysisDetail

// Khởi tạo overall analysis trong results nếu chưa có
const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => { // Sửa any thành LogAnalysisResult
    if (!results.overall) {
        results.overall = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            totalConferencesInput: 0,
            processedConferencesCount: 0,
            completedTasks: 0,
            failedOrCrashedTasks: 0,
            processingTasks: 0,
            skippedTasks: 0,
            successfulExtractions: 0,
        };
    }
    return results.overall as OverallAnalysis;
};


export const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    overall.processedConferencesCount = (overall.processedConferencesCount || 0) + 1;

    if (confDetail) {
        const previousStatus = confDetail.status;

        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }

        // Nếu event logEntry cho task_start cũng chứa originalRequestId, bạn có thể xử lý ở đây:
        // if (logEntry.originalRequestId && !confDetail.originalRequestId) {
        //     confDetail.originalRequestId = logEntry.originalRequestId;
        // }

        if (previousStatus === 'unknown' || previousStatus === 'skipped') {
            confDetail.status = 'processing';
            overall.processingTasks = (overall.processingTasks || 0) + 1;
            if (previousStatus === 'skipped' && overall.skippedTasks && overall.skippedTasks > 0) {
                overall.skippedTasks--;
            }
        }
    }
};

export const handleTaskFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing';

        if (confDetail.status !== 'failed' && confDetail.status !== 'skipped') {
            confDetail.endTime = entryTimestampISO;
            if (logEntry.success === true) {
                confDetail.status = 'processed_ok';
            } else if (logEntry.success === false) {
                confDetail.status = 'failed';
                const errorMsg = logEntry.error_details || "Task logic indicated failure.";
                addConferenceError(confDetail, entryTimestampISO, errorMsg, normalizeErrorKey(errorMsg));
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
        } else if (confDetail.status === 'failed' || confDetail.status === 'skipped') {
            if (!confDetail.endTime) {
                confDetail.endTime = entryTimestampISO;
            }
        }

        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        if (wasProcessing && confDetail.endTime) {
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
        }
    }
};

export const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Task failed due to unhandled error (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing';
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;

        if (confDetail.startTime && confDetail.endTime) {
             try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                 if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        if (wasProcessing) {
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
        }
    } else {
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
    }
};

export const handleTaskSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing';
        confDetail.status = 'skipped';
        confDetail.startTime = confDetail.startTime || entryTimestampISO;
        confDetail.endTime = entryTimestampISO;
        overall.skippedTasks = (overall.skippedTasks || 0) + 1;

        if (confDetail.startTime && confDetail.endTime) {
             try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                 if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        if (wasProcessing && overall.processingTasks && overall.processingTasks > 0) {
            overall.processingTasks--;
        }
    } else {
        overall.skippedTasks = (overall.skippedTasks || 0) + 1;
    }
};

// <<< THÊM HANDLER MỚI >>>
export const handleRecrawlDetected: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const originalRequestId = logEntry.originalRequestId as string | undefined;
    // const currentBatchRequestId = logEntry.batchRequestId as string | undefined; // Có thể dùng để debug

    if (confDetail && originalRequestId) {
        // Gán originalRequestId vào ConferenceAnalysisDetail nếu nó được cung cấp qua event này.
        // Đây là nơi chính để lấy thông tin này cho từng conference.
        if (!confDetail.originalRequestId) { // Chỉ gán nếu chưa có, tránh ghi đè không cần thiết
            confDetail.originalRequestId = originalRequestId;
        }
        // console.log(`RECRAWL_DETECTED: Conf: ${confDetail.acronym}, Original Req: ${originalRequestId}, Current Req: ${confDetail.batchRequestId}`);
    }
    // Không cần else if cho results.requests[currentBatchRequestId] ở đây,
    // vì `calculateFinalMetrics` sẽ tổng hợp originalRequestId cho request từ các conferences của nó.
};