// src/client/utils/eventHandlers/searchHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers'; // Import trực tiếp

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

// NEW: Handler for Search related warnings or non-critical errors within attempts
export const handleSearchAttemptIssue: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const event = logEntry.event;
    const error = logEntry.err || logEntry.msg;
    const details = logEntry.details;

    results.googleSearch.attemptIssues = (results.googleSearch.attemptIssues || 0) + 1;
    const issueKey = `${event}${error ? ':' + normalizeErrorKey(error) : ''}`;
    results.googleSearch.attemptIssueDetails[issueKey] = (results.googleSearch.attemptIssueDetails[issueKey] || 0) + 1;

    if (event === 'search_quota_error_detected') {
        results.googleSearch.quotaErrorsEncountered = (results.googleSearch.quotaErrorsEncountered || 0) + 1;
    }
    if (event === 'search_result_item_malformed') {
        results.googleSearch.malformedResultItems = (results.googleSearch.malformedResultItems || 0) + 1;
    }
    // Log chi tiết hơn vào confDetail nếu cần
};

export const handleSearchSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
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

export const handleSearchResultsFiltered: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    if (confDetail) {
        confDetail.steps.search_filtered_count = logEntry.filteredResultsCount ?? null;
    }
};


export const handleSearchAttempt: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.googleSearch.totalRequests++; // Tổng số attempts
    if (logEntry.keyIndex !== undefined) {
        // `keyIndex` là 0-based từ GoogleSearchService
        results.googleSearch.keyUsage[`key_${logEntry.keyIndex}`] = (results.googleSearch.keyUsage[`key_${logEntry.keyIndex}`] || 0) + 1;
    }
    if (confDetail) {
        confDetail.steps.search_attempted = true;
        confDetail.steps.search_attempts_count++;
    }
};

// NEW: Handlers for ApiKeyManager events
export const handleApiKeyUsageLimitReached: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.googleSearch.apiKeyLimitsReached = (results.googleSearch.apiKeyLimitsReached || 0) + 1;
    const keyIndex = logEntry.keyIndex; // 0-based
    if (keyIndex !== undefined) {
        // Initialize if not exists
        if (!results.googleSearch.keySpecificLimitsReached) {
            results.googleSearch.keySpecificLimitsReached = {};
        }
        results.googleSearch.keySpecificLimitsReached[`key_${keyIndex}`] = (results.googleSearch.keySpecificLimitsReached[`key_${keyIndex}`] || 0) + 1;
    }
};

export const handleApiKeyProvided: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.googleSearch.apiKeysProvidedCount = (results.googleSearch.apiKeysProvidedCount || 0) + 1;
    // Không cập nhật keyUsage ở đây để tránh đếm kép với handleSearchAttempt
};

export const handleAllApiKeysExhaustedInfo: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Phân biệt giữa 'api_keys_all_exhausted_checked' (khi getNextKey không tìm thấy)
    // và 'api_keys_all_exhausted_status' (khi gọi hàm areAllKeysExhausted)
    if (logEntry.event === 'api_keys_all_exhausted_checked') {
        results.googleSearch.allKeysExhaustedEvents_GetNextKey = (results.googleSearch.allKeysExhaustedEvents_GetNextKey || 0) + 1;
    } else if (logEntry.event === 'api_keys_all_exhausted_status') {
        results.googleSearch.allKeysExhaustedEvents_StatusCheck = (results.googleSearch.allKeysExhaustedEvents_StatusCheck || 0) + 1;
    }
};

export const handleApiKeyRotation: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const event = logEntry.event;
    if (event === 'api_key_force_rotated_success') {
        results.googleSearch.apiKeyRotationsSuccess = (results.googleSearch.apiKeyRotationsSuccess || 0) + 1;
    } else if (event === 'api_key_force_rotated_fail') {
        results.googleSearch.apiKeyRotationsFailed = (results.googleSearch.apiKeyRotationsFailed || 0) + 1;
    }
};
