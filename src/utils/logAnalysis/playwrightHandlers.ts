// src/client/utils/eventHandlers/playwrightHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';

// --- Global Playwright Setup ---
export const handlePlaywrightGlobalInitStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupAttempts = (results.playwright.setupAttempts || 0) + 1;
};

export const handlePlaywrightGlobalInitSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupSuccess = true;
    results.playwright.setupError = false; // Explicitly set to false
};

export const handlePlaywrightGlobalInitFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupSuccess = false;
    results.playwright.setupError = true;
    const error = logEntry.err?.message || logEntry.err || logEntry.msg || 'Playwright global initialization failed';
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
};

export const handlePlaywrightGetContextFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Có thể gộp vào setupError hoặc một counter riêng
    results.playwright.contextErrors = (results.playwright.contextErrors || 0) + 1;
    const error = logEntry.err?.message || logEntry.err || logEntry.msg || 'Playwright get context failed';
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
};


// --- HTML Saving for a Conference Task ---
export const handleSaveHtmlConferenceStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.htmlSaveAttempts++; // Tổng số conference được thử lưu HTML
    if (confDetail) confDetail.steps.html_save_attempted = true;
};

export const handleSaveHtmlConferenceSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.skippedSaves = (results.playwright.skippedSaves || 0) + 1;
    if (confDetail) {
        confDetail.steps.html_save_success = 'skipped'; // Hoặc false và thêm lý do
        // Không addConferenceError vì đây là skip có chủ đích
    }
};

export const handleSaveHtmlConferenceSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event này được gọi khi việc *khởi tạo* lưu batch thành công (process_save_delegation_initiated)
    results.playwright.successfulSaves++; // Đếm số conference mà việc lưu HTML được bắt đầu thành công
    if (confDetail && confDetail.steps.html_save_success !== false) {
        confDetail.steps.html_save_success = true;
    }
};

export const handleSaveHtmlConferenceFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Bao gồm các lỗi từ 'process_save_delegation_initiation_failed', 'process_save_delegation_error'
    results.playwright.failedSaves++;
    const error = logEntry.err?.message || logEntry.err || logEntry.msg || `Save HTML for conference failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        confDetail.steps.html_save_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};


// --- Individual Link Processing ---
export const handleLinkProcessingAttempt: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.totalLinksAttempted++;
    if (confDetail) {
        // Nếu muốn theo dõi số link attempt cho từng conference, cần thêm confDetail.steps.link_processing_attempted_count
        confDetail.steps.link_processing_attempted_count = (confDetail.steps.link_processing_attempted_count || 0) + 1;
    }
};

export const handleLinkProcessingSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Được gọi bởi event 'link_access_final_success' từ ConferenceLinkProcessorService
    results.playwright.linkProcessing.successfulAccess++;
    if (confDetail) {
         confDetail.steps.link_processing_success_count = (confDetail.steps.link_processing_success_count || 0) + 1;
    }
};

export const handleLinkProcessingFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Được gọi bởi 'single_link_processing_failed_to_access_link' hoặc 'single_link_processing_unhandled_error'
    results.playwright.linkProcessing.failedAccess++;
    const error = logEntry.err?.message || logEntry.err || logEntry.msg || `Link processing failed: ${logEntry.finalAttemptedUrl || logEntry.originalUrl || 'N/A'}`;
    const errorKey = normalizeErrorKey(error);

    // Phân loại lỗi chi tiết hơn cho link processing
    const linkErrorKey = `link_access_err_${errorKey}`;
    results.playwright.errorsByType[linkErrorKey] = (results.playwright.errorsByType[linkErrorKey] || 0) + 1;
    // Không nhất thiết phải add vào errorsAggregated nếu đã có lỗi ở cấp conference

    if (confDetail) {
        if (!confDetail.steps.link_processing_failed_details) {
            confDetail.steps.link_processing_failed_details = [];
        }
        confDetail.steps.link_processing_failed_details.push({
            timestamp: entryTimestampISO,
            url: logEntry.finalAttemptedUrl || logEntry.originalUrl,
            error: errorKey,
            event: logEntry.event
        });
        // Có thể đánh dấu bước link_processing chung của conference là false nếu có bất kỳ link nào fail
        // confDetail.steps.all_links_processed_successfully = false;
    }
};

export const handleLinkRedirectDetected: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.redirects++;
    // Thêm thông tin redirect vào confDetail nếu cần
};

// --- Other/Generic Playwright Failures ---
export const handleOtherPlaywrightFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.otherFailures = (results.playwright.otherFailures || 0) + 1;
    const error = logEntry.err?.message || logEntry.err || logEntry.msg || `Generic Playwright operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1; // Các lỗi này thường là nghiêm trọng
    if (confDetail) {
        // Quyết định xem có nên đánh dấu một bước cụ thể là false hay chỉ addConferenceError
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};