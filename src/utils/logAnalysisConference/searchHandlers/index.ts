// src/utils/logAnalysis/searchHandlers/index.ts

/**
 * This file serves as the single entry point for all Google Search related log event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import {
    handleApiKeyProvided,
    handleApiKeyUsageLimitReached,
    handleApiKeyRotation,
    handleAllApiKeysExhaustedInfo,
} from './apiKey.handlers';
import {
    handleSearchAttempt,
    handleSearchSuccess,
    handleSearchFailure,
    handleSearchResultsFiltered,
} from './lifecycle.handlers';
import { handleSearchAttemptIssue } from './issues.handlers';

export const searchEventHandlers: { [key: string]: LogEventHandler } = {
    // Lifecycle
    'search_attempt_start': handleSearchAttempt,
    'search_attempt_success': handleSearchSuccess,
    'search_attempt_no_items': handleSearchSuccess,
    'search_failed_max_retries': handleSearchFailure,
    'search_ultimately_failed': handleSearchFailure,
    'search_ultimately_failed_unknown_post_loop': handleSearchFailure,
    'search_skip_all_keys_exhausted': handleSearchFailure,
    'search_skip_no_key': handleSearchFailure,
    'search_key_rotation_failed_after_quota': handleSearchFailure,
    'search_and_filter_completed': handleSearchResultsFiltered,

    // API Key Management
    'api_key_provided_locked': handleApiKeyProvided,
    'api_key_usage_limit_reached': handleApiKeyUsageLimitReached,
    'api_key_usage_limit_reached_locked': handleApiKeyUsageLimitReached,
    'api_key_force_rotated_success_locked': handleApiKeyRotation,
    'api_key_force_rotated_fail_locked': handleApiKeyRotation,
    'api_keys_all_exhausted_checked_locked': handleAllApiKeysExhaustedInfo,
    'api_keys_all_exhausted_status': handleAllApiKeysExhaustedInfo,

    // Attempt-level Issues
    'search_attempt_google_api_error_in_body': handleSearchAttemptIssue,
    'search_result_item_malformed': handleSearchAttemptIssue,
    'search_attempt_failed_google_processed': handleSearchAttemptIssue,
    'search_attempt_failed_http_error': handleSearchAttemptIssue,
    'search_attempt_failed_google_in_http_error': handleSearchAttemptIssue,
    'search_attempt_failed_network_timeout': handleSearchAttemptIssue,
    'search_attempt_failed_request_setup': handleSearchAttemptIssue,
    'search_attempt_failed_unexpected': handleSearchAttemptIssue,
    'search_attempt_failure_summary': handleSearchAttemptIssue,
    'search_quota_error_detected': handleSearchAttemptIssue,
};