// src/utils/logAnalysis/taskLifecycleHandlers.ts

import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { OverallAnalysis, getInitialOverallAnalysis, LogAnalysisResult, ConferenceAnalysisDetail, LogError as AnalysisLogError, LogErrorContext } from '../../types/logAnalysis';

const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};

export const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        confDetail.crawlType = logEntry.crawlType;

        const previousStatus = confDetail.status;

        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }

        // Quan trọng: Chỉ set là 'processing' nếu nó thực sự bắt đầu.
        // Nếu nó đã failed hoặc completed bởi một event trước đó (ít xảy ra cho task_start), thì không ghi đè.
        if (previousStatus === 'unknown' || previousStatus === 'skipped' || !previousStatus) {
            confDetail.status = 'processing'; // <--- ĐÚNG: Khởi chạy là processing

            // Cập nhật counters
            // if (previousStatus !== 'processing') { // Chỉ tăng nếu nó chưa phải là processing
            overall.processingTasks = (overall.processingTasks || 0) + 1;
            if (previousStatus === 'skipped' && overall.skippedTasks && overall.skippedTasks > 0) {
                overall.skippedTasks--;
            }
            // Nếu nó là 'unknown' và đây là lần đầu tiên thấy, tăng processedConferencesCount
            if (previousStatus === 'unknown' || !previousStatus) {
                // Đã chuyển logic này vào processLogEntry khi initializeConferenceDetail được gọi lần đầu
                // nhưng để an toàn, có thể kiểm tra lại ở đây nếu confDetail vừa được tạo và chuyển sang processing
            }
            // }
        }
    } else {
        // overall.processedConferencesCount nên được xử lý khi conference được khởi tạo lần đầu
        // trong processLogEntry để tránh đếm sai.
    }
};

export const handleTaskFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const previousStatus = confDetail.status;
        confDetail.endTime = entryTimestampISO; // Luôn đặt endTime khi task_finish được gọi

        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        if (previousStatus === 'skipped') {
            // Nếu đã skip, không làm gì ở đây, giữ nguyên status skipped.
            // Cần đảm bảo counters đã được điều chỉnh đúng khi skip.
            // Nếu nó đang là processing và bị skip, processingTasks phải giảm.
            // Logic này nên nằm trong handleTaskSkipped.
            return;
        }
        if (previousStatus === 'completed' || previousStatus === 'failed') {
            // Nếu đã ở trạng thái cuối cùng, không nên xử lý lại bởi task_finish trừ khi có logic re-process.
            // Hiện tại, giả sử task_finish chỉ xảy ra một lần để đưa task vào trạng thái chờ ghi file hoặc failed.
            // return; // Cân nhắc nếu task_finish có thể được gọi nhiều lần với ý nghĩa khác nhau.
        }


        let isSuccessBasedOnSteps = true;
        let stepFailureReason = "";

        // Kiểm tra các bước chung
        if (confDetail.steps.search_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Search step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.html_save_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "HTML saving step failed."; }

        // Kiểm tra các bước Gemini tùy thuộc vào crawlType
        if (confDetail.crawlType === 'crawl') { // Chỉ kiểm tra determine nếu là 'crawl'
            if (isSuccessBasedOnSteps && confDetail.steps.gemini_determine_success === false) {
                isSuccessBasedOnSteps = false;
                stepFailureReason = "Gemini determine step failed (crawl type).";
            }
        }
        // Các bước extract và cfp có thể chung cho cả 'crawl' và 'update' (tùy theo logic của bạn)
        // Nếu chúng cũng khác nhau, bạn cần thêm điều kiện tương tự.
        // Ví dụ, nếu 'update' chỉ có extract và cfp:
        if (isSuccessBasedOnSteps && confDetail.steps.gemini_extract_success === false) {
            isSuccessBasedOnSteps = false;
            stepFailureReason = "Gemini extract step failed.";
        }
        if (isSuccessBasedOnSteps && confDetail.steps.hasOwnProperty('gemini_cfp_success') && confDetail.steps.gemini_cfp_success === false) {
            isSuccessBasedOnSteps = false;
            stepFailureReason = "Gemini CFP step failed.";
        }


        if (isSuccessBasedOnSteps &&
            confDetail.steps.html_save_success !== 'skipped' &&
            confDetail.steps.link_processing_attempted_count > 0 &&
            confDetail.steps.link_processing_success_count === 0) {
            isSuccessBasedOnSteps = false;
            stepFailureReason = "All link processing attempts failed.";
        }

        const hasUnrecoveredError = confDetail.errors.some((err: AnalysisLogError) => !err.isRecovered);

        let newStatus: ConferenceAnalysisDetail['status'];

        if (isSuccessBasedOnSteps && !hasUnrecoveredError) {
            newStatus = 'processed_ok';
        } else {
            newStatus = 'failed';
            if (stepFailureReason && !confDetail.errors.some(e => e.message.includes(stepFailureReason.substring(0, 20)) && !e.isRecovered)) {
                addConferenceError(
                    confDetail,
                    entryTimestampISO,
                    stepFailureReason,
                    {
                        defaultMessage: stepFailureReason,
                        keyPrefix: 'task_finish_step_check',
                        sourceService: 'TaskLifecycleHandler',
                        errorType: 'Logic',
                        additionalDetails: { reason: stepFailureReason, crawlType: confDetail.crawlType } // Thêm crawlType vào context lỗi
                    }
                );
            }
        }

        // Chỉ cập nhật status và counters nếu status thực sự thay đổi
        if (confDetail.status !== newStatus) {
            confDetail.status = newStatus;

            // Cập nhật overall counters dựa trên sự thay đổi status
            if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus) {
                if (overall.processingTasks && overall.processingTasks > 0) {
                    overall.processingTasks--;
                }
                // Không tăng completedTasks hay failedOrCrashedTasks ở đây nữa,
                // vì 'processed_ok' không phải là trạng thái cuối cùng.
                // Việc tăng failedOrCrashedTasks sẽ xảy ra nếu newStatus là 'failed'.
                if (newStatus === 'failed') {
                    overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
                }
            } else if (previousStatus === 'failed' && (newStatus === 'processed_ok')) {
                // Chuyển từ failed sang trạng thái thành công hơn
                if (overall.failedOrCrashedTasks && overall.failedOrCrashedTasks > 0) {
                    overall.failedOrCrashedTasks--;
                }
                // Nếu là 'completed' thì handleCsvWriteSuccess sẽ xử lý completedTasks.
                // Nếu là 'processed_ok', nó chưa phải completed.
            } else if (previousStatus === 'completed' && newStatus === 'failed') {
                // Chuyển từ completed sang failed
                if (overall.completedTasks && overall.completedTasks > 0) {
                    overall.completedTasks--;
                }
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
            // Các trường hợp khác (ví dụ: processed_ok -> failed) sẽ được xử lý bởi các handler khác (như lỗi ghi CSV)
        }
    }
};

export const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = `Task failed due to unhandled error (${logEntry.event || 'unknown_event'})`;

    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail) {
        const previousStatus = confDetail.status;

        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'task_unhandled',
                sourceService: logEntry.service || 'UnknownService',
                errorType: 'Unknown',
                context: { phase: 'primary_execution', ...logEntry.context },
                additionalDetails: { event: logEntry.event }
            }
        );

        if (confDetail.status !== 'failed') { // Chỉ thay đổi nếu chưa phải là failed
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
            if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus || previousStatus === 'processed_ok') {
                if (previousStatus === 'processing' && overall.processingTasks && overall.processingTasks > 0) {
                    overall.processingTasks--;
                }
                // Nếu là processed_ok, nó không nằm trong processingTasks, nhưng cũng chưa failed.
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            } else if (previousStatus === 'completed') {
                if (overall.completedTasks && overall.completedTasks > 0) {
                    overall.completedTasks--;
                }
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
            // Nếu previousStatus là 'skipped', và giờ thành 'failed'
            else if (previousStatus === 'skipped') {
                if (overall.skippedTasks && overall.skippedTasks > 0) {
                    overall.skippedTasks--;
                }
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
        }
    } else {
        // Lỗi không gắn với conference cụ thể, chỉ tăng số lỗi chung
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
    }
};


export const handleTaskSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const skipReason = logEntry.reason || "Task skipped";

    if (confDetail) {
        const previousStatus = confDetail.status;

        if (previousStatus === 'skipped') return; // Đã skip rồi, không xử lý lại

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

        addConferenceError(
            confDetail,
            entryTimestampISO,
            skipReason,
            {
                defaultMessage: skipReason,
                keyPrefix: 'task_skipped',
                sourceService: logEntry.service || 'UnknownService',
                errorType: 'Logic',
                context: { phase: 'setup', ...logEntry.context },
                additionalDetails: { reason: logEntry.reason }
            }
        );

        // Cập nhật overall counters
        if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus || previousStatus === 'processed_ok') {
            if (previousStatus === 'processing' && overall.processingTasks && overall.processingTasks > 0) {
                overall.processingTasks--;
            }
            // Nếu là unknown/processed_ok, nó không ở processingTasks, nhưng giờ chuyển sang skipped
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

// handleRecrawlDetected giữ nguyên
export const handleRecrawlDetected: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const originalRequestId = logEntry.originalRequestId as string | undefined;
    if (confDetail && originalRequestId) {
        if (!confDetail.originalRequestId) {
            confDetail.originalRequestId = originalRequestId;
        }
    }
};