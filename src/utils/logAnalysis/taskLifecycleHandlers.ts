import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { OverallAnalysis, ConferenceAnalysisDetail, LogAnalysisResult } from '../../types/logAnalysis.types';

const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => {
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

        // <<< LOGIC SỬA ĐỔI CHÍNH Ở ĐÂY >>>
        // Nếu trạng thái đã là 'failed' hoặc 'skipped' từ một sự kiện nghiêm trọng hơn,
        // thì không ghi đè nó bằng 'processed_ok' hoặc logic thất bại cấp thấp hơn.
        if (confDetail.status === 'failed' || confDetail.status === 'skipped') {
            // Trạng thái đã được đặt bởi một sự kiện khác (ví dụ: handleTaskUnhandledError, handleGeminiFinalFailure)
            // Không làm gì thêm với status, nó đã đúng rồi.
            // Đảm bảo endTime được cập nhật nếu có sự kiện task_finish sau đó.
            if (!confDetail.endTime) {
                confDetail.endTime = entryTimestampISO;
            }
        } else {
            // Chỉ cập nhật status nếu nó chưa phải 'failed' hoặc 'skipped'
            if (logEntry.success === false) {
                confDetail.status = 'failed';
                const errorMsg = logEntry.error_details || "Task logic indicated failure.";
                addConferenceError(confDetail, entryTimestampISO, errorMsg, normalizeErrorKey(errorMsg));
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            } else { // logEntry.success === true (hoặc undefined, coi là true cho block này)
                // Kiểm tra logic link processing
                if (confDetail.steps.link_processing_attempted_count > 0 &&
                    confDetail.steps.link_processing_success_count === 0) {
                    
                    confDetail.status = 'failed'; // Ghi đè thành failed nếu tất cả link processing thất bại
                    const errorMsg = "All link processing attempts failed despite task reporting overall success.";
                    addConferenceError(confDetail, entryTimestampISO, errorMsg, "all_links_failed_override");
                    // Tăng số lỗi tổng thể nếu nó chưa được tăng bởi lỗi khác
                    // (Lưu ý: Nếu một lỗi khác đã đặt nó thành 'failed' và tăng, thì sẽ không vào đây)
                    if (overall.failedOrCrashedTasks !== undefined) {
                        overall.failedOrCrashedTasks++;
                    } else {
                        overall.failedOrCrashedTasks = 1;
                    }
                } else {
                    confDetail.status = 'processed_ok'; // Trạng thái mặc định nếu không có lỗi cấp cao
                }
            }
        }
        // <<< KẾT THÚC LOGIC SỬA ĐỔI >>>

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
            // Nếu confDetail.status được chuyển từ 'processing' sang 'failed' trong `handleTaskFinish`
            // thì `failedOrCrashedTasks` đã được tăng ở trên.
            // Nếu nó đã là 'failed' từ trước, `failedOrCrashedTasks` cũng đã được tăng.
            // Không cần xử lý lại ở đây để tránh trùng lặp.
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
        // Luôn ghi đè trạng thái thành 'failed' vì đây là lỗi không xử lý
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