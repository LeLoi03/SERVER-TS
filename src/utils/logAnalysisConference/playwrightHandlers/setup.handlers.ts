// src/utils/logAnalysis/playwrightHandlers/setup.handlers.ts

/**
 * Handles events related to the global setup and initialization of Playwright.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../utils';

export const handlePlaywrightGlobalInitStart: LogEventHandler = (logEntry, results) => {
    results.playwright.setupAttempts = (results.playwright.setupAttempts || 0) + 1;
};

export const handlePlaywrightGlobalInitSuccess: LogEventHandler = (logEntry, results) => {
    results.playwright.setupSuccess = true;
    results.playwright.setupError = false;
};

export const handlePlaywrightGlobalInitFailed: LogEventHandler = (logEntry, results) => {
    results.playwright.setupSuccess = false;
    results.playwright.setupError = true;

    const errorSource = logEntry.err || logEntry;
    const errorKey = normalizeErrorKey(errorSource);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
};

export const handlePlaywrightGetContextFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.playwright.contextErrors = (results.playwright.contextErrors || 0) + 1;

    const errorSource = logEntry.err || logEntry;
    const defaultMessage = 'Playwright get context failed';
    const errorKey = normalizeErrorKey(errorSource);
    results.playwright.errorsByType[errorKey] = (results.playwright.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'playwright_context_fail',
                sourceService: logEntry.service || 'Playwright',
                errorType: 'Configuration',
                context: {
                    phase: 'setup',
                    ...logEntry.context
                }
            }
        );
    }
};