// src/utils/logAnalysis/searchHandlers/lifecycle.handlers.ts

/**
 * Handles core search lifecycle events: attempts, successes, and failures.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../utils';

export const handleSearchAttempt: LogEventHandler = (logEntry, results, confDetail) => {
    results.googleSearch.totalRequests++; // Total attempts
    if (logEntry.keyIndex !== undefined) {
        results.googleSearch.keyUsage[`key_${logEntry.keyIndex}`] = (results.googleSearch.keyUsage[`key_${logEntry.keyIndex}`] || 0) + 1;
    }
    if (confDetail) {
        confDetail.steps.search_attempted = true;
        confDetail.steps.search_attempts_count++;
    }
};

export const handleSearchSuccess: LogEventHandler = (logEntry, results, confDetail) => {
    results.googleSearch.successfulSearches++;
    if (confDetail) {
        if (confDetail.steps.search_success !== false) {
            confDetail.steps.search_success = true;
        }
        confDetail.steps.search_results_count = logEntry.resultsCount ?? null;
        if (logEntry.resultsCount === 0 && logEntry.event === 'search_attempt_no_items') {
            results.googleSearch.successfulSearchesWithNoItems = (results.googleSearch.successfulSearchesWithNoItems || 0) + 1;
        }
    }
};

export const handleSearchFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg;
    const event = logEntry.event;
    const defaultMsg = (event === 'search_skip_all_keys_exhausted' || event === 'search_skip_no_key' || event === 'search_key_rotation_failed_after_quota')
        ? `Search skipped or critical failure (${event})`
        : 'Search ultimately failed';
    const failureMsg = error || defaultMsg;
    const errorKey = normalizeErrorKey(failureMsg);

    if (event === 'search_skip_all_keys_exhausted' || event === 'search_skip_no_key') {
        results.googleSearch.skippedSearches++;
    } else {
        results.googleSearch.failedSearches++;
        if (event === 'search_key_rotation_failed_after_quota') {
            results.googleSearch.errorsByType['key_rotation_failed_critical'] = (results.googleSearch.errorsByType['key_rotation_failed_critical'] || 0) + 1;
        }
    }

    results.googleSearch.errorsByType[errorKey] = (results.googleSearch.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.steps.search_success = false;
        addConferenceError(confDetail, entryTimestampISO, error, failureMsg);
    }
};

export const handleSearchResultsFiltered: LogEventHandler = (logEntry, results, confDetail) => {
    if (confDetail) {
        // Giữ nguyên logic cũ
        confDetail.steps.search_filtered_count = logEntry.filteredResultsCount ?? null;
        
        // <<<< THÊM LOGIC MỚI >>>>
        // Lưu lại số lượng link sau khi đã áp dụng giới hạn
        confDetail.steps.search_limited_count = logEntry.limitedResultsCount ?? null;
    }
};