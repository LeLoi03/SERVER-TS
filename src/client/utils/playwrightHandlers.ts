// src/client/utils/eventHandlers/playwrightHandlers.ts
import { LogEventHandler } from './commonHandlers';
import { normalizeErrorKey, addConferenceError } from './helpers';


export const handlePlaywrightSetupFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupSuccess = false;
    results.playwright.setupError = true;
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'Playwright setup failed';
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
};

export const handleSaveHtmlFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.failedSaves++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'Save HTML step failed';
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        confDetail.steps.html_save_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey); // Use normalized key or original error
    }
};

export const handleLinkAccessFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.failedAccess++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Link access failed: ${logEntry.context?.url || 'N/A'}`;
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    if (confDetail) {
        confDetail.steps.link_processing_failed?.push({
            timestamp: entryTimestampISO,
            details: errorKey // Store normalized key or short message
        });
    }
};

export const handleOtherPlaywrightFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Playwright operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    // Decide if aggregation is needed
    // results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};


export const handlePlaywrightSetupSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.setupSuccess = true;
    results.playwright.setupError = null;
};

export const handleSaveHtmlFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.successfulSaves++;
    if (confDetail && confDetail.steps.html_save_success !== false) {
        confDetail.steps.html_save_success = true;
        // logger.trace({ ...logContext, event: 'analysis_html_save_marked_success' }, 'Marked HTML save step as successful based on save_html_finish.');
    }
};

export const handleLinkAccessSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.successfulAccess++;
    if (confDetail) confDetail.steps.link_processing_success++;
};


export const handleSaveHtmlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.htmlSaveAttempts++;
    if (confDetail) confDetail.steps.html_save_attempted = true;
};

export const handleLinkAccessAttempt: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.totalLinksAttempted++;
    if (confDetail) confDetail.steps.link_processing_attempted++;
};

export const handleRedirect: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.playwright.linkProcessing.redirects++;
};