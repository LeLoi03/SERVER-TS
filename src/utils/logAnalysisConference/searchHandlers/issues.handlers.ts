// src/utils/logAnalysis/searchHandlers/issues.handlers.ts

/**
 * Handles non-critical issues and warnings that occur during a search attempt.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey } from '../utils';

export const handleSearchAttemptIssue: LogEventHandler = (logEntry, results) => {
    const event = logEntry.event;
    const error = logEntry.err || logEntry.msg;

    results.googleSearch.attemptIssues = (results.googleSearch.attemptIssues || 0) + 1;
    const issueKey = `${event}${error ? ':' + normalizeErrorKey(error) : ''}`;
    results.googleSearch.attemptIssueDetails[issueKey] = (results.googleSearch.attemptIssueDetails[issueKey] || 0) + 1;

    if (event === 'search_quota_error_detected' || event === 'search_quota_error_detected_forcing_rotation') {
        results.googleSearch.quotaErrors = (results.googleSearch.quotaErrors || 0) + 1;
    }

    if (event === 'search_result_item_malformed') {
        results.googleSearch.malformedResultItems = (results.googleSearch.malformedResultItems || 0) + 1;
    }
};