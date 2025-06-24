// src/utils/logAnalysis/playwrightHandlers/linkProcessing.handlers.ts

/**
 * Handles events related to processing individual links within a conference task.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey } from '../utils';

export const handleLinkProcessingAttempt: LogEventHandler = (logEntry, results, confDetail) => {
    results.playwright.linkProcessing.totalLinksAttempted++;
    if (confDetail) {
        confDetail.steps.link_processing_attempted_count = (confDetail.steps.link_processing_attempted_count || 0) + 1;
    }
};

export const handleLinkProcessingSuccess: LogEventHandler = (logEntry, results, confDetail) => {
    results.playwright.linkProcessing.successfulAccess++;
    if (confDetail) {
        confDetail.steps.link_processing_success_count = (confDetail.steps.link_processing_success_count || 0) + 1;
    }
};

export const handleLinkProcessingFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.linkProcessing.failedAccess++;

    const errorSource = logEntry.err || logEntry;
    const errorKey = normalizeErrorKey(errorSource);
    const linkErrorKey = `link_access_err_${errorKey}`;
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
    }
};

export const handleLinkRedirectDetected: LogEventHandler = (logEntry, results) => {
    results.playwright.linkProcessing.redirects++;
};

export const handleOtherPlaywrightFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.otherFailures = (results.playwright.otherFailures || 0) + 1;

    const errorSource = logEntry.err || logEntry;
    const errorKey = normalizeErrorKey(errorSource);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;

    if (confDetail) {
        if (!confDetail.steps.link_processing_failed_details) {
            confDetail.steps.link_processing_failed_details = [];
        }
        confDetail.steps.link_processing_failed_details.push({
            timestamp: entryTimestampISO,
            url: logEntry.finalAttemptedUrl || logEntry.originalUrl || logEntry.url,
            error: errorKey,
            event: logEntry.event
        });
    }
};