// src/utils/logAnalysis/taskLifecycleHandlers.ts

import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { OverallAnalysis, getInitialOverallAnalysis, LogAnalysisResult, ConferenceAnalysisDetail, LogError as AnalysisLogError, LogErrorContext } from '../../types'; // Thêm LogErrorContext

const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};

export const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {

        confDetail.crawlType = logEntry.crawlType; // Xác định crawl type là 'crawl' hya 'update' từ log crawlType.

        // Chỉ tăng processedConferencesCount nếu đây là lần đầu task này được "start" trong lần phân tích này
        // Điều này tránh việc đếm nhiều lần nếu có nhiều event 'task_start' cho cùng một conference (ít khả năng)
        if (confDetail.status === 'unknown' || !confDetail.status) {
            overall.processedConferencesCount = (overall.processedConferencesCount || 0) + 1;
        }

        const previousStatus = confDetail.status;

        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }

        if (previousStatus === 'unknown' || previousStatus === 'skipped' || !previousStatus) {
            confDetail.status = 'processing';
            // Logic ở đây là nếu trạng thái trước đó KHÔNG phải là 'processing', thì tăng processingTasks.
            // Điều kiện `previousStatus !== 'processing'` là luôn đúng nếu `previousStatus` là 'unknown', 'skipped' hoặc undefined.
            // Do đó, bỏ qua kiểm tra này không thay đổi luồng, nó chỉ làm code tường minh hơn.
            overall.processingTasks = (overall.processingTasks || 0) + 1;

            if (previousStatus === 'skipped' && overall.skippedTasks && overall.skippedTasks > 0) {
                overall.skippedTasks--;
            }
        }
    } else {
        // Nếu không có confDetail, có thể là một task không xác định, vẫn có thể đếm là đã xử lý
        overall.processedConferencesCount = (overall.processedConferencesCount || 0) + 1;
    }
};

export const handleTaskFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const previousStatus = confDetail.status; // Lưu lại status trước khi quyết định cuối cùng
        confDetail.endTime = entryTimestampISO; // Luôn đặt endTime

        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        // Nếu task đã bị skip bởi một event trước đó, không thay đổi status ở đây.
        if (previousStatus === 'skipped') {
            // Logic ở đây là nếu previousStatus là 'skipped', và bạn muốn giảm processingTasks nếu nó đang ở đó.
            // Điều kiện `previousStatus !== 'processing'` là luôn đúng vì `previousStatus` là 'skipped'.
            // Do đó, bỏ qua kiểm tra này không thay đổi luồng.
            // Tuy nhiên, logic này vẫn có vẻ lạ: nếu nó skipped, nó không nên ở processing ngay từ đầu.
            // Giữ nguyên để không thay đổi logic bạn muốn.
            // if (previousStatus !== 'processing' && overall.processingTasks && overall.processingTasks > 0) {
            //     overall.processingTasks--;
            // }
            // Vẫn giữ nguyên khối if này, nhưng bỏ điều kiện thừa để hết lỗi của TS.
            // Nếu `previousStatus` là 'skipped', thì `overall.processingTasks` KHÔNG NÊN > 0 nữa.
            // Đoạn code này có thể là một phần logic để bảo vệ lỗi nếu trạng thái bị set sai.
            if (overall.processingTasks && overall.processingTasks > 0) {
                 overall.processingTasks--;
            }
            return;
        }

        let isSuccessBasedOnSteps = true;
        let stepFailureReason = "";

        // Kiểm tra các bước quan trọng
        if (confDetail.steps.search_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Search step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.html_save_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "HTML saving step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.gemini_determine_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Gemini determine step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.gemini_extract_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Gemini extract step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.hasOwnProperty('gemini_cfp_success') && confDetail.steps.gemini_cfp_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Gemini CFP step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.html_save_success !== 'skipped' && confDetail.steps.link_processing_attempted_count > 0 && confDetail.steps.link_processing_success_count === 0) { isSuccessBasedOnSteps = false; stepFailureReason = "All link processing attempts failed."; }

        // Chỉ coi là có lỗi nghiêm trọng nếu có lỗi CHƯA được phục hồi
        const hasUnrecoveredError = confDetail.errors.some((err: AnalysisLogError) => !err.isRecovered);

        // Quyết định status cuối cùng
        if (isSuccessBasedOnSteps && !hasUnrecoveredError) {
            confDetail.status = 'completed';
        } else {
            confDetail.status = 'failed';
            // Thêm lỗi vào confDetail nếu stepFailureReason có giá trị và chưa có lỗi tương tự (chưa được phục hồi)
            if (stepFailureReason && !confDetail.errors.some(e => e.message.includes(stepFailureReason.substring(0, 20)) && !e.isRecovered)) {
                addConferenceError(
                    confDetail,
                    entryTimestampISO,
                    stepFailureReason, // errorSource là string
                    { // options
                        defaultMessage: stepFailureReason,
                        keyPrefix: 'task_finish_step_check',
                        sourceService: 'TaskLifecycleHandler', // Hoặc service log 'task_finish'
                        errorType: 'Logic',
                        // Bỏ các trường không có trong LogErrorContext và thêm vào additionalDetails nếu cần
                        additionalDetails: {
                            reason: stepFailureReason
                        }
                    }
                );
            }
        }

        // Cập nhật overall counters dựa trên sự thay đổi status
        if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus) {
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
            if (confDetail.status === 'completed') {
                overall.completedTasks = (overall.completedTasks || 0) + 1;
            } else if (confDetail.status === 'failed') {
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
        } else if (previousStatus === 'failed' && confDetail.status === 'completed') {
            // Chuyển từ failed sang completed (ví dụ: re-crawl thành công)
            if (overall.failedOrCrashedTasks && overall.failedOrCrashedTasks > 0) {
                overall.failedOrCrashedTasks--;
            }
            overall.completedTasks = (overall.completedTasks || 0) + 1;
        } else if (previousStatus === 'completed' && confDetail.status === 'failed') {
            // Chuyển từ completed sang failed (ít khả năng, nhưng có thể do re-crawl thất bại)
            if (overall.completedTasks && overall.completedTasks > 0) {
                overall.completedTasks--;
            }
            overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
        }
        // Không cần xử lý nếu status không đổi (ví dụ: failed -> failed)
    }
};

export const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const errorSource = logEntry.err || logEntry; // Truyền toàn bộ logEntry nếu err không có
    const defaultMessage = `Task failed due to unhandled error (${logEntry.event || 'unknown_event'})`;

    // Thêm lỗi vào aggregated errors
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;


    if (confDetail) {
        const previousStatus = confDetail.status;

        const errorContext: LogErrorContext = {
            phase: 'primary_execution', // Lỗi không xử lý thường là trong quá trình thực thi chính
            // Chỉ sử dụng các trường đã định nghĩa trong LogErrorContext
        };

        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'task_unhandled',
                sourceService: logEntry.service || 'UnknownService',
                errorType: 'Unknown', // Hoặc 'Logic' nếu biết rõ hơn
                context: errorContext,
                // Thêm các chi tiết khác vào additionalDetails
                additionalDetails: {
                    event: logEntry.event,
                    originalLogContext: logEntry.context // Lưu lại context gốc nếu cần
                }
            }
        );

        confDetail.status = 'failed';
        if (!confDetail.endTime) {
            confDetail.endTime = entryTimestampISO;
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

        // Cập nhật overall counters
        if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus) {
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
            overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
        } else if (previousStatus === 'completed') {
            if (overall.completedTasks && overall.completedTasks > 0) {
                overall.completedTasks--;
            }
            overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
        }
    } else {
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
    }
};


export const handleTaskSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const skipReason = logEntry.reason || "Task skipped";

    if (confDetail) {
        const previousStatus = confDetail.status;
        confDetail.status = 'skipped';
        if (!confDetail.startTime) confDetail.startTime = entryTimestampISO;
        if (!confDetail.endTime) confDetail.endTime = entryTimestampISO;


        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        const errorContext: LogErrorContext = {
            phase: 'setup', // Thường là lỗi/quyết định trong giai đoạn setup hoặc kiểm tra ban đầu
            // Chỉ sử dụng các trường đã định nghĩa trong LogErrorContext
        };

        // Thêm "lỗi" skip vào confDetail để có lý do
        addConferenceError(
            confDetail,
            entryTimestampISO,
            skipReason,
            {
                defaultMessage: skipReason,
                keyPrefix: 'task_skipped',
                sourceService: logEntry.service || 'UnknownService',
                errorType: 'Logic', // Coi việc skip là một quyết định logic
                context: errorContext,
                // Thêm lý do skip vào additionalDetails
                additionalDetails: {
                    reason: logEntry.reason,
                    originalLogContext: logEntry.context // Lưu lại context gốc nếu cần
                }
            }
        );

        // Cập nhật overall counters
        if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus) {
            if (overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
        } else if (previousStatus === 'completed') {
            if (overall.completedTasks && overall.completedTasks > 0) {
                overall.completedTasks--;
            }
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
        } else if (previousStatus === 'failed') {
            if (overall.failedOrCrashedTasks && overall.failedOrCrashedTasks > 0) {
                overall.failedOrCrashedTasks--;
            }
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
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