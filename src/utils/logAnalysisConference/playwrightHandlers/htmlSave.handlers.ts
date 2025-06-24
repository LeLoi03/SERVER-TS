// src/utils/logAnalysis/playwrightHandlers/htmlSave.handlers.ts

/**
 * Handles events specific to the lifecycle of saving HTML content for a conference.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../utils';

export const handleSaveHtmlConferenceStart: LogEventHandler = (logEntry, results, confDetail) => {
    results.playwright.htmlSaveAttempts++;
    if (confDetail) confDetail.steps.html_save_attempted = true;
};

export const handleSaveHtmlConferenceSkipped: LogEventHandler = (logEntry, results, confDetail) => {
    results.playwright.skippedSaves = (results.playwright.skippedSaves || 0) + 1;
    if (confDetail) {
        confDetail.steps.html_save_success = 'skipped';
    }
};

export const handleSaveHtmlConferenceSuccess: LogEventHandler = (logEntry, results, confDetail) => {
    results.playwright.successfulSaveInitiations++;
    if (confDetail && confDetail.steps.html_save_success !== false) {
        confDetail.steps.html_save_success = true;
    }
};

export const handleSaveHtmlConferenceFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.failedSaves++;

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
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'html_save_failed',
                sourceService: logEntry.service || 'Playwright',
                errorType: 'FileSystem',
                context: {
                    phase: 'primary_execution',
                    ...logEntry.context
                }
            }
        );
    }
};