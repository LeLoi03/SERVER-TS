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

        // Ensure endTime is set if it hasn't been.
        if (!confDetail.endTime) {
            confDetail.endTime = entryTimestampISO;
        }

        // Only update status if it's not already definitively set to 'failed' or 'skipped'
        // by a more critical event (like unhandled error or explicit skip).
        if (confDetail.status !== 'failed' && confDetail.status !== 'skipped') {
            if (logEntry.success === false) {
                confDetail.status = 'failed';
                const errorMsg = logEntry.error_details || "Task logic indicated failure.";
                addConferenceError(confDetail, entryTimestampISO, errorMsg, normalizeErrorKey(errorMsg));
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            } else { // logEntry.success === true (or undefined, treat as true for this block)
                // <<< LOGIC SỬA ĐỔI ĐỂ KIỂM TRA LINK PROCESSING >>>
                // Even if task_finish event reports success, check sub-step consistency
                if (confDetail.steps.link_processing_attempted_count > 0 &&
                    confDetail.steps.link_processing_success_count === 0) {
                    
                    confDetail.status = 'failed'; // Override to failed due to all link processing attempts failing
                    const errorMsg = "All link processing attempts failed despite task reporting overall success.";
                    // Sử dụng một mã lỗi cụ thể cho trường hợp này
                    addConferenceError(confDetail, entryTimestampISO, errorMsg, "all_links_failed_override");
                    
                    // Quyết định xem có nên tăng overall.failedOrCrashedTasks ở đây không.
                    // Hiện tại, logic chung là chỉ tăng khi logEntry.success === false.
                    // Việc conference này bị đánh dấu 'failed' sẽ được phản ánh trong thống kê chi tiết.
                } else {
                    confDetail.status = 'processed_ok';
                }
                // <<< KẾT THÚC LOGIC SỬA ĐỔI >>>
            }
        } else if (confDetail.status === 'failed') {
            // If status was already 'failed' (e.g., by handleTaskUnhandledError),
            // ensure overall.failedOrCrashedTasks reflects this if task_finish also says success:false.
            // This part primarily ensures that if a task_finish with success:false comes for an already failed task,
            // the counter isn't missed if not already incremented.
            // However, handleTaskUnhandledError already increments this.
            // If task_finish comes with success:false and status was already 'failed', we assume
            // the counter was handled by the event that first set it to 'failed'.
            // If logEntry.success === false, and confDetail.status was already 'failed'
            // (e.g. by handleTaskUnhandledError), overall.failedOrCrashedTasks
            // would have been incremented by handleTaskUnhandledError.
            // No double increment needed.
        }
        // No specific action for confDetail.status === 'skipped' here, as its final state is already set.

        // Calculate duration if possible
        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        // Update processing task count based on the fact that it's finishing
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
        confDetail.endTime = entryTimestampISO; // Set endTime on failure
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
        // If confDetail doesn't exist for some reason, still count the error at an overall level
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
    }
};

export const handleTaskSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing';
        confDetail.status = 'skipped';
        if (!confDetail.startTime) confDetail.startTime = entryTimestampISO; // Set startTime if not already set
        confDetail.endTime = entryTimestampISO; // Set endTime on skip
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

export const handleRecrawlDetected: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const originalRequestId = logEntry.originalRequestId as string | undefined;

    if (confDetail && originalRequestId) {
        if (!confDetail.originalRequestId) { 
            confDetail.originalRequestId = originalRequestId;
        }
    }
};