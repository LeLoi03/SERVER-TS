// src/client/utils/eventHandlers/playwrightHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';

// --- Global Playwright Setup ---
export const handlePlaywrightGlobalInitStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.setupAttempts = (results.playwright.setupAttempts || 0) + 1;
};

export const handlePlaywrightGlobalInitSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.setupSuccess = true;
    results.playwright.setupError = false; // Explicitly set to false
};

export const handlePlaywrightGlobalInitFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.setupSuccess = false;
    results.playwright.setupError = true;

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = 'Playwright global initialization failed';

    const errorKey = normalizeErrorKey(errorSource); // Vẫn dùng errorSource để normalize cho aggregation
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    // Nếu có confDetail, add error vào đó. Nếu không, lỗi này là lỗi global và không gắn với một conference cụ thể.
    // Lỗi setup global thường không gắn với một confDetail cụ thể, nhưng nếu bạn muốn ghi nhận, hãy cân nhắc.
    // Hiện tại, không có confDetail ở đây nên không gọi addConferenceError.
};

export const handlePlaywrightGetContextFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.contextErrors = (results.playwright.contextErrors || 0) + 1;

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = 'Playwright get context failed';

    const errorKey = normalizeErrorKey(errorSource);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    // Lỗi get context cũng thường là lỗi global hoặc lỗi giai đoạn setup đầu tiên,
    // và có thể không gắn với một confDetail cụ thể tại thời điểm này.
    // Nếu confDetail tồn tại và có ý nghĩa khi ghi lỗi này, bạn có thể thêm vào.
    // Ví dụ: nếu đây là lần đầu tiên get context cho một task cụ thể.
    if (confDetail) {
        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'playwright_context_fail',
                sourceService: logEntry.service || 'Playwright',
                errorType: 'Configuration', // Hoặc 'Logic' nếu do logic sai
                context: {
                    phase: 'setup', // Lỗi xảy ra trong giai đoạn thiết lập môi trường Playwright
                    ...logEntry.context // Bảo toàn context gốc nếu có
                }
            }
        );
    }
};


// --- HTML Saving for a Conference Task ---
export const handleSaveHtmlConferenceStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.htmlSaveAttempts++;
    if (confDetail) confDetail.steps.html_save_attempted = true;
};

export const handleSaveHtmlConferenceSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.skippedSaves = (results.playwright.skippedSaves || 0) + 1;
    if (confDetail) {
        confDetail.steps.html_save_success = 'skipped';
        // Không addConferenceError vì đây là skip có chủ đích và có thể không phải là "lỗi" theo nghĩa tiêu cực.
        // Nếu bạn muốn ghi nhận lý do skip, bạn có thể dùng addConferenceError với errorType: 'Logic'
        // addConferenceError(
        //     confDetail,
        //     entryTimestampISO,
        //     logEntry.reason || 'HTML save skipped',
        //     {
        //         defaultMessage: 'HTML save skipped for conference',
        //         keyPrefix: 'html_save_skipped',
        //         sourceService: logEntry.service || 'Playwright',
        //         errorType: 'Logic', // Đây là một quyết định logic
        //         context: { phase: 'primary_execution', reason: logEntry.reason }
        //     }
        // );
    }
};

export const handleSaveHtmlConferenceSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.successfulSaveInitiations++;
    if (confDetail && confDetail.steps.html_save_success !== false) {
        confDetail.steps.html_save_success = true;
    }
};

export const handleSaveHtmlConferenceFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.failedSaves++;

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = `Save HTML for conference failed (${logEntry.event})`;

    const errorKey = normalizeErrorKey(errorSource);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.steps.html_save_success = false;
        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource, // Truyền trực tiếp errorSource
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'html_save_failed', // Tiền tố rõ ràng
                sourceService: logEntry.service || 'Playwright',
                errorType: 'FileSystem', // Giả định là lỗi ghi file hoặc tương tác FS
                context: {
                    phase: 'primary_execution', // Lỗi trong quá trình thực thi lưu HTML
                    ...logEntry.context // Bảo toàn context gốc
                }
            }
        );
    }
};


// --- Individual Link Processing ---
export const handleLinkProcessingAttempt: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.linkProcessing.totalLinksAttempted++;
    if (confDetail) {
        confDetail.steps.link_processing_attempted_count = (confDetail.steps.link_processing_attempted_count || 0) + 1;
    }
};

export const handleLinkProcessingSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.linkProcessing.successfulAccess++;
    if (confDetail) {
        confDetail.steps.link_processing_success_count = (confDetail.steps.link_processing_success_count || 0) + 1;
    }
};

export const handleLinkProcessingFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.linkProcessing.failedAccess++;

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    // Thông điệp mặc định có thể bao gồm URL để dễ nhận biết hơn
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = `Link processing failed for URL: ${logEntry.finalAttemptedUrl || logEntry.originalUrl || 'N/A'}`;

    const errorKey = normalizeErrorKey(errorSource); // Dùng errorSource để normalize
    const linkErrorKey = `link_access_err_${errorKey}`; // Vẫn giữ linkErrorKey để phân loại trong Playwright stats
    results.playwright.errorsByType[linkErrorKey] = (results.playwright.errorsByType[linkErrorKey] || 0) + 1;

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

        // addConferenceError(
        //     confDetail,
        //     entryTimestampISO,
        //     errorSource, // Truyền trực tiếp errorSource
        //     {
        //         defaultMessage: defaultMessage,
        //         keyPrefix: 'link_access_failed',
        //         sourceService: logEntry.service || 'ConferenceLinkProcessor',
        //         errorType: 'Network', // Giả định là lỗi mạng hoặc không truy cập được
        //         context: {
        //             phase: 'primary_execution',
        //             url: logEntry.finalAttemptedUrl || logEntry.originalUrl, // Thêm URL vào context
        //             event: logEntry.event, // Thêm event vào context
        //             ...logEntry.context // Bảo toàn context gốc
        //         }
        //     }
        // );
    }
};

export const handleLinkRedirectDetected: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.linkProcessing.redirects++;
};

// --- Other/Generic Playwright Failures ---
export const handleOtherPlaywrightFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.otherFailures = (results.playwright.otherFailures || 0) + 1;

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = `Generic Playwright operation failed (${logEntry.event})`;

    const errorKey = normalizeErrorKey(errorSource);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;

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

        // addConferenceError(
        //     confDetail,
        //     entryTimestampISO,
        //     errorSource, // Truyền trực tiếp errorSource
        //     {
        //         defaultMessage: defaultMessage,
        //         keyPrefix: 'playwright_generic_failure',
        //         sourceService: logEntry.service || 'Playwright',
        //         errorType: 'Unknown', // Hoặc xác định cụ thể hơn nếu event cho phép
        //         context: {
        //             phase: 'primary_execution',
        //             event: logEntry.event, // Thêm event vào context
        //             ...logEntry.context // Bảo toàn context gốc
        //         }
        //     }
        // );
    }
};