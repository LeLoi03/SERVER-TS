// src/client/utils/eventHandlers/index.ts
import { LogEventHandler as LogEventHandlerType } from './commonHandlers'; // Đổi tên để tránh xung đột nếu cần

// Import tất cả các handler từ các file con
import * as taskLifecycle from './taskLifecycleHandlers';
import * as search from './searchHandlers';
import * as playwright from './playwrightHandlers';
import * as geminiApi from './geminiApiHandlers';
import * as batchProcessing from './batchProcessingHandlers';
import * as fileOutput from './fileOutputHandlers';
import * as validation from './validationHandlers';
import * as overallProcess from './overallProcessHandlers';

// Định nghĩa lại LogEventHandler ở đây nếu không muốn file commonHandlers.ts
// export type LogEventHandler = LogEventHandlerType; // Nếu đã import từ commonHandlers
// Hoặc định nghĩa lại:
import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis';
export type LogEventHandler = (
    logEntry: any,
    results: LogAnalysisResult,
    confDetail: ConferenceAnalysisDetail | null,
    entryTimestampISO: string,
    logContext: object
) => void;


// Tạo eventHandlerMap bằng cách gom tất cả các handler đã export
export const eventHandlerMap: Record<string, LogEventHandler> = {
    // Task Lifecycle
    'task_start': taskLifecycle.handleTaskStart,
    'task_crawl_stage_finish': taskLifecycle.handleTaskCrawlStageFinish,
    'task_finish': taskLifecycle.handleTaskCrawlStageFinish, // Alias
    'task_unhandled_error': taskLifecycle.handleTaskUnhandledError,

    // Search & ApiKeyManager
    'search_failed_max_retries': search.handleSearchFailure,
    'search_ultimately_failed': search.handleSearchFailure,
    'search_ultimately_failed_unknown_post_loop': search.handleSearchFailure,
    'search_skip_all_keys_exhausted': search.handleSearchFailure,
    'search_skip_no_key': search.handleSearchFailure,
    'search_key_rotation_failed_after_quota': search.handleSearchFailure,
    'search_attempt_success': search.handleSearchSuccess,
    'search_attempt_no_items': search.handleSearchSuccess,
    'search_results_filtered': search.handleSearchResultsFiltered,
    'search_attempt_start': search.handleSearchAttempt,
    'search_attempt_google_api_error_in_body': search.handleSearchAttemptIssue,
    'search_result_item_malformed': search.handleSearchAttemptIssue,
    'search_attempt_failed_google_processed': search.handleSearchAttemptIssue,
    'search_attempt_failed_http_error': search.handleSearchAttemptIssue,
    'search_attempt_failed_google_in_http_error': search.handleSearchAttemptIssue,
    'search_attempt_failed_network_timeout': search.handleSearchAttemptIssue,
    'search_attempt_failed_request_setup': search.handleSearchAttemptIssue,
    'search_attempt_failed_unexpected': search.handleSearchAttemptIssue,
    'search_attempt_failure_summary': search.handleSearchAttemptIssue,
    'search_quota_error_detected': search.handleSearchAttemptIssue,
    'api_key_usage_limit_reached': search.handleApiKeyUsageLimitReached,
    'api_key_provided': search.handleApiKeyProvided,
    'api_keys_all_exhausted_checked': search.handleAllApiKeysExhaustedInfo,
    'api_keys_all_exhausted_status': search.handleAllApiKeysExhaustedInfo,
    'api_key_force_rotated_success': search.handleApiKeyRotation,
    'api_key_force_rotated_fail': search.handleApiKeyRotation,

    // Playwright
    'playwright_setup_failed': playwright.handlePlaywrightSetupFailed,
    'playwright_setup_success': playwright.handlePlaywrightSetupSuccess,
    'save_html_start': playwright.handleSaveHtmlStart,
    'save_html_finish_failed': playwright.handleSaveHtmlFailed,
    'save_html_unhandled_error': playwright.handleSaveHtmlFailed,
    'save_html_skipped_no_links': playwright.handleSaveHtmlFailed,
    'save_html_finish': playwright.handleSaveHtmlFinish,
    'link_access_failed': playwright.handleLinkAccessFailed,
    'link_processing_failed_skip': playwright.handleLinkAccessFailed,
    'link_access_success': playwright.handleLinkAccessSuccess,
    'link_access_attempt': playwright.handleLinkAccessAttempt,
    'node_traverse_or_save_failed': playwright.handleOtherPlaywrightFailure,
    'page_close_failed': playwright.handleOtherPlaywrightFailure,
    'dom_clean_failed': playwright.handleOtherPlaywrightFailure,
    'content_fetch_failed': playwright.handleOtherPlaywrightFailure,
    'link_loop_unhandled_error': playwright.handleOtherPlaywrightFailure,
    'redirect_detected': playwright.handleRedirect,

    // Gemini API & Cache
    'cache_create_start': geminiApi.handleCacheCreateStart,
    'cache_setup_use_success': geminiApi.handleGeminiCacheHit,
    'cache_write_success': geminiApi.handleCacheWriteSuccess,
    'cache_write_failed': geminiApi.handleCacheWriteFailed,
    'cache_manager_create_failed': geminiApi.handleCacheWriteFailed,
    'cache_create_failed': geminiApi.handleCacheWriteFailed,
    'cache_create_invalid_model_error': geminiApi.handleCacheWriteFailed,
    'cache_setup_get_or_create_failed': geminiApi.handleCacheWriteFailed,
    'cache_create_failed_invalid_object': geminiApi.handleCacheInvalidate,
    'cache_load_failed': geminiApi.handleCacheInvalidate,
    'cache_invalidate': geminiApi.handleCacheInvalidate,
    'retry_failed_max_retries': geminiApi.handleGeminiFinalFailure,
    'retry_abort_non_retryable': geminiApi.handleGeminiFinalFailure,
    'gemini_api_response_blocked': geminiApi.handleGeminiFinalFailure,
    'retry_attempt_error_safety_blocked': geminiApi.handleGeminiFinalFailure,
    'gemini_call_limiter_init_failed': geminiApi.handleGeminiSetupFailure,
    'gemini_call_invalid_apitype': geminiApi.handleGeminiSetupFailure,
    'non_cached_setup_failed': geminiApi.handleGeminiSetupFailure,
    'gemini_api_attempt_success': geminiApi.handleGeminiSuccess,
    'gemini_call_start': geminiApi.handleGeminiCallStart,
    'retry_attempt_start': geminiApi.handlRetriesGeminiCall,
    'retry_wait_before_next': geminiApi.handleRateLimitWait,
    'retry_genai_not_init': geminiApi.handleGeminiIntermediateError,
    'retry_attempt_error_cache': geminiApi.handleGeminiIntermediateError,
    'retry_attempt_error_429': geminiApi.handleGeminiIntermediateError,
    'retry_attempt_error_5xx': geminiApi.handleGeminiIntermediateError,
    'retry_attempt_error_unknown': geminiApi.handleGeminiIntermediateError,
    'retry_loop_exit_unexpected': geminiApi.handleGeminiIntermediateError,

    // Batch Processing
    'save_batch_unhandled_error_or_rethrown': batchProcessing.handleBatchRejection,
    'save_batch_missing_determine_path': batchProcessing.handleSaveBatchApiFailure,
    'save_batch_read_determine_failed': batchProcessing.handleSaveBatchApiFailure,
    'save_batch_determine_api_call_failed': batchProcessing.handleSaveBatchApiFailure,
    'save_batch_extract_api_call_failed': batchProcessing.handleSaveBatchApiFailure,
    'save_batch_process_determine_call_failed': batchProcessing.handleSaveBatchApiFailure,
    'save_batch_process_determine_failed_invalid': batchProcessing.handleSaveBatchApiFailure,
    'save_batch_dir_create_failed': batchProcessing.handleSaveBatchFsFailure,
    'save_batch_read_content_failed': batchProcessing.handleSaveBatchFsFailure,
    'save_batch_write_file_failed': batchProcessing.handleSaveBatchFsFailure,
    'batch_task_create': batchProcessing.handleBatchTaskCreate,
    'save_batch_aggregate_content_end': batchProcessing.handleBatchAggregationEnd,
    'save_batch_finish_success': batchProcessing.handleSaveBatchFinishSuccess,

    // File Output (CSV, JSONL)
    'save_batch_append_success': fileOutput.handleJsonlWriteSuccess,
    'save_batch_append_failed': fileOutput.handleJsonlWriteFailed,
    'csv_write_record_success': fileOutput.handleCsvWriteSuccess,
    'csv_write_record_failed': fileOutput.handleCsvWriteFailed,

    // Overall Process
    'crawl_start': overallProcess.handleCrawlStart,
    'processing_finished_successfully': overallProcess.handleCrawlEndSuccess,

    // Validation & Normalization
    'validation_warning': validation.handleValidationWarning,
    'normalization_applied': validation.handleNormalizationApplied,

    // Service Init Events (Optional)
    // ...
};

// Export các type hoặc interface cần thiết khác nếu có
// export { LogAnalysisResult, ConferenceAnalysisDetail, ValidationStats } from '../../types/logAnalysis';