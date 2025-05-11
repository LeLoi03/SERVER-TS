// src/client/utils/eventHandlers/taskLifecycleHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { OverallAnalysis, ConferenceAnalysisDetail } from '../../types/logAnalysis.types'; // Import thêm ConferenceAnalysisDetail nếu cần truy cập sâu

// Khởi tạo overall analysis trong results nếu chưa có
const ensureOverallAnalysis = (results: any): OverallAnalysis => {
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


export const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const overall = ensureOverallAnalysis(results);
    overall.processedConferencesCount = (overall.processedConferencesCount || 0) + 1;

    if (confDetail) {
        const previousStatus = confDetail.status; // Lưu trạng thái cũ

        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }

        if (previousStatus === 'unknown' || previousStatus === 'skipped') {
            confDetail.status = 'processing';
            overall.processingTasks = (overall.processingTasks || 0) + 1;

            // Nếu trạng thái TRƯỚC ĐÓ là 'skipped', thì giảm counter skipped
            if (previousStatus === 'skipped' && overall.skippedTasks && overall.skippedTasks > 0) {
                overall.skippedTasks--;
            }
        }
    }
};

export const handleTaskFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing'; // Kiểm tra xem nó có đang processing không

        // Chỉ cập nhật endTime và status nếu chưa bị set là 'failed' bởi 'task_unhandled_error'
        // hoặc các lỗi nghiêm trọng khác đã set status.
        if (confDetail.status !== 'failed' && confDetail.status !== 'skipped') { // Thêm điều kiện !== 'skipped'
            confDetail.endTime = entryTimestampISO;
            if (logEntry.context?.success === true) {
                // Status có thể là 'processed_ok' để phân biệt với 'completed' cuối cùng từ CSV
                confDetail.status = 'processed_ok'; // Ví dụ: Đã xử lý xong các bước nội bộ
            } else if (logEntry.context?.success === false) {
                confDetail.status = 'failed'; // Lỗi logic trong task
                const errorMsg = logEntry.context?.error_details || "Task logic indicated failure.";
                addConferenceError(confDetail, entryTimestampISO, errorMsg, normalizeErrorKey(errorMsg));
                // Lỗi logic làm task fail, tăng failedOrCrashedTasks
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
        } else if (confDetail.status === 'failed' || confDetail.status === 'skipped') {
            // Nếu đã là 'failed' hoặc 'skipped', chỉ cập nhật endTime nếu chưa có
            // để tính duration cho các task bị lỗi/skip sớm.
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

        // Giảm processingTasks nếu nó TRƯỚC ĐÓ đang là 'processing' và bây giờ đã có endTime
        // (nghĩa là nó không còn "đang xử lý" nữa)
        if (wasProcessing && confDetail.endTime) {
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
        }
    }
};

export const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const overall = ensureOverallAnalysis(results);
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Task failed due to unhandled error (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;


    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing'; // Kiểm tra trước khi thay đổi status

        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1; // Tăng ở đây khi có lỗi unhandled

        if (confDetail.startTime && confDetail.endTime) {
             try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                 if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        if (wasProcessing) { // Nếu nó đang là processing trước khi bị lỗi
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
        }
    } else { // Nếu không có confDetail nhưng vẫn là unhandled error liên quan đến task
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
    }
};

export const handleTaskSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const wasProcessing = confDetail.status === 'processing'; // Lưu trạng thái cũ

        confDetail.status = 'skipped';
        // Nếu task được skip, nó cũng có startTime (nếu đã được log) và endTime (là lúc skip)
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

        // Nếu TRƯỚC ĐÓ nó đang được tính là processing, thì giảm processingTasks
        if (wasProcessing && overall.processingTasks && overall.processingTasks > 0) {
            overall.processingTasks--;
        }
    } else {
        // Nếu event 'task_skipped' được log mà không có confDetail (ví dụ, skip ở mức cao hơn)
        overall.skippedTasks = (overall.skippedTasks || 0) + 1;
    }
};