// src/client/utils/eventHandlers/index.ts

// Import tất cả các handler từ các file con
import * as taskLifecycle from './taskLifecycleHandlers';
import * as search from './searchHandlers';
import * as playwright from './playwrightHandlers';
import * as geminiApi from './geminiApiHandlers';
import * as batchProcessing from './batchProcessingHandlers';
import * as fileOutput from './fileOutputHandlers';
import * as validation from './validationHandlers';
import * as overallProcess from './overallProcessHandlers';

import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis.types';
export type LogEventHandler = (
  logEntry: any,
  results: LogAnalysisResult,
  confDetail: ConferenceAnalysisDetail | null,
  entryTimestampISO: string,
  logContext: object
) => void;


// Tạo eventHandlerMap bằng cách gom tất cả các handler đã export
export const eventHandlerMap: Record<string, LogEventHandler> = {

  // --- Task Lifecycle ---
  'task_start': taskLifecycle.handleTaskStart,
  // 'task_crawl_stage_finish': taskLifecycle.handleTaskFinish, // Bỏ alias này nếu không dùng
  'task_finish': taskLifecycle.handleTaskFinish, // Event chính từ ConferenceProcessor
  'task_unhandled_error': taskLifecycle.handleTaskUnhandledError,
  // 'task_skipped': taskLifecycle.handleTaskSkipped, // Thêm nếu bạn có event này

  // --- Search Events Group ---
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


  // --- Playwright Events Group ---
  // Playwright Global Setup
  'playwright_global_init_start': playwright.handlePlaywrightGlobalInitStart,
  'playwright_global_init_success': playwright.handlePlaywrightGlobalInitSuccess,
  'playwright_global_init_failed': playwright.handlePlaywrightGlobalInitFailed,
  'playwright_get_context_failed_not_initialized': playwright.handlePlaywrightGetContextFailed,
  'html_persistence_set_context_failed': playwright.handlePlaywrightGetContextFailed,

  // HTML Saving per Conference (từ HtmlPersistenceService.processSaveFlow)
  'process_save_start': playwright.handleSaveHtmlConferenceStart,
  'process_save_skipped_no_links': playwright.handleSaveHtmlConferenceSkipped,
  'process_save_delegation_initiated': playwright.handleSaveHtmlConferenceSuccess,
  'process_save_delegation_initiation_failed': playwright.handleSaveHtmlConferenceFailed,
  'process_save_delegation_error': playwright.handleSaveHtmlConferenceFailed,

  // Link Processing (từ ConferenceLinkProcessorService.processInitialLinkForSave)
  'single_link_processing_start': playwright.handleLinkProcessingAttempt,
  'link_access_final_success': playwright.handleLinkProcessingSuccess,
  'single_link_processing_failed_to_access_link': playwright.handleLinkProcessingFailed,
  'single_link_processing_unhandled_error': playwright.handleLinkProcessingFailed, // Lỗi chung khi xử lý 1 link
  // 'redirect_detected': playwright.handleLinkRedirectDetected, // Giữ lại nếu bạn có log event này

  // Lỗi từ PageContentExtractorService liên quan đến Playwright
  'html_processing_failed': playwright.handleOtherPlaywrightFailure, // Khi page null hoặc closed
  'goto_failed': playwright.handleOtherPlaywrightFailure, // Lỗi page.goto()
  'fetch_content_failed': playwright.handleOtherPlaywrightFailure, // Lỗi page.content()
  'unexpected_error': playwright.handleOtherPlaywrightFailure, // Lỗi chung trong PageContentExtractorService


  // --- Gemini API Events Group ---
  // Gemini Final Failures
  'retry_failed_max_retries': geminiApi.handleGeminiFinalFailure,
  'retry_abort_non_retryable': geminiApi.handleGeminiFinalFailure,
  'gemini_api_response_blocked': geminiApi.handleGeminiFinalFailure, // Event từ callGeminiAPI
  'retry_attempt_error_safety_blocked': geminiApi.handleGeminiFinalFailure, // Event từ executeWithRetry

  // Gemini Setup & Critical Init Failures
  'gemini_service_genai_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_service_not_initialized': geminiApi.handleGeminiSetupFailure,
  'gemini_service_genai_not_ready': geminiApi.handleGeminiSetupFailure, // Thêm từ ensureInitialized
  'gemini_call_limiter_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_call_missing_apiconfig': geminiApi.handleGeminiSetupFailure, // Lỗi thiếu config API Type
  'gemini_call_missing_model_config': geminiApi.handleGeminiSetupFailure, // Lỗi thiếu config model name(s)
  'gemini_api_model_undefined': geminiApi.handleGeminiSetupFailure,
  'non_cached_setup_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_public_method_unhandled_error': geminiApi.handleGeminiSetupFailure, // Lỗi chung ở public method
  // 'gemini_call_invalid_apitype': geminiApi.handleGeminiSetupFailure, // Nếu còn dùng

  // Gemini Success
  'gemini_api_attempt_success': geminiApi.handleGeminiSuccess,

  // Gemini Cache Specifics
  'cache_setup_use_success': geminiApi.handleGeminiCacheHit,
  'cache_create_start': geminiApi.handleCacheContextCreateStart, // Tạo context cache
  'cache_create_success': geminiApi.handleCacheContextCreationSuccess, // Tạo context cache thành công

  'cache_create_failed': geminiApi.handleCacheContextCreationFailed,
  'cache_create_invalid_model_error': geminiApi.handleCacheContextCreationFailed,
  'cache_setup_get_or_create_failed': geminiApi.handleCacheContextCreationFailed,
  'cache_manager_unavailable_early': geminiApi.handleCacheContextCreationFailed,
  'cache_logic_outer_exception': geminiApi.handleCacheContextCreationFailed,
  'cache_setup_getmodel_failed': geminiApi.handleCacheContextCreationFailed,

  'cache_create_failed_invalid_object': geminiApi.handleCacheContextInvalidation,
  'cache_invalidate': geminiApi.handleCacheContextInvalidation, // Event explicit
  'retry_cache_invalidate': geminiApi.handleCacheContextInvalidation, // Từ retry loop

  'cache_retrieval_failed_not_found': geminiApi.handleCacheContextRetrievalFailure,
  'cache_retrieval_failed_exception': geminiApi.handleCacheContextRetrievalFailure,

  'cache_load_failed': geminiApi.handleCacheMapLoadFailure, // Load file map
  'cache_write_success': geminiApi.handleCacheMapWriteSuccess, // Ghi file map (event name này cần phân biệt nguồn gốc trong log service)
  'cache_write_failed': geminiApi.handleCacheMapWriteFailure, // Ghi file map
  'cache_manager_create_failed': geminiApi.handleCacheManagerCreateFailure,

  // Gemini Call & Retry Stats
  'gemini_call_start': geminiApi.handleGeminiCallStart,
  'retry_attempt_start': geminiApi.handleRetryAttemptStart,

  // Gemini Intermediate Errors & Limits
  'retry_wait_before_next': geminiApi.handleRateLimitWait,
  'retry_internal_rate_limit_wait': geminiApi.handleRateLimitWait,

  // Gemini Intermediate Errors (JSON parsing errors có thể coi là intermediate)
  'json_clean_parse_failed': geminiApi.handleGeminiIntermediateError, // Lỗi parse JSON từ response
  'json_clean_structure_not_found': geminiApi.handleGeminiIntermediateError, // Không tìm thấy JSON

  'retry_attempt_error_cache': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_429': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_5xx': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_unknown': geminiApi.handleGeminiIntermediateError,
  'retry_loop_exit_unexpected': geminiApi.handleGeminiIntermediateError,
  'gemini_api_generate_failed': geminiApi.handleGeminiIntermediateError,
  // 'retry_genai_not_init': geminiApi.handleGeminiIntermediateError, // Nếu còn dùng


  // --- Batch Processing Events Group ---
  'batch_task_create': batchProcessing.handleBatchTaskCreate,
  'batch_task_create_delegation_start': batchProcessing.handleBatchTaskCreate, // Map vào cùng handler

  'save_batch_unhandled_error_or_rethrown': batchProcessing.handleBatchRejectionOrLogicFailure,
  'batch_processing_abort_no_main_text': batchProcessing.handleBatchRejectionOrLogicFailure,
  'conference_link_processor_link_missing_for_update': batchProcessing.handleBatchRejectionOrLogicFailure,
  'conference_link_processor_update_link_failed': batchProcessing.handleBatchRejectionOrLogicFailure,

  'save_batch_determine_api_call_failed': batchProcessing.handleBatchApiFailure,
  'save_batch_extract_api_call_failed': batchProcessing.handleBatchApiFailure,
  'save_batch_cfp_api_call_failed': batchProcessing.handleBatchApiFailure, // Mới
  'save_batch_process_determine_call_failed': batchProcessing.handleBatchApiFailure,
  'save_batch_process_determine_failed_invalid': batchProcessing.handleBatchApiFailure,
  'save_batch_api_response_parse_failed': batchProcessing.handleBatchApiFailure, // Mới
  'save_batch_parallel_final_apis_both_failed': batchProcessing.handleBatchApiFailure, // Mới

  'save_batch_dir_create_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_failed_missing_path': batchProcessing.handleBatchFileSystemFailure, // Mới
  'save_batch_read_content_warn_non_critical': batchProcessing.handleBatchFileSystemFailure, // Map warning vào đây để đếm FS operations, nhưng không tăng failedBatches
  'save_batch_write_file_failed': batchProcessing.handleBatchFileSystemFailure,

  'save_batch_aggregate_content_end': batchProcessing.handleBatchAggregationEnd,
  'save_batch_finish_success': batchProcessing.handleBatchFinishSuccess,


  // --- File Output (JSONL, CSV) ---
  'append_final_record_success': fileOutput.handleJsonlWriteSuccess,
  'append_final_record_failed': fileOutput.handleJsonlWriteFailed,

  // Event từ CrawlOrchestratorService sau khi ResultProcessingService hoàn thành
  'csv_write_record_success': fileOutput.handleCsvWriteSuccess,
  // 'csv_write_record_failed' // Sẽ được log bởi Orchestrator nếu có cách xác định lỗi cho từng record CSV
  // Hiện tại, lỗi CSV được xử lý ở mức pipeline/file.

  // Events từ ResultProcessingService (nội bộ) hoặc Orchestrator (tổng thể CSV)
  // được xử lý bởi một handler chung để cập nhật trạng thái file CSV.
  'csv_record_processed_for_writing': fileOutput.handleCsvProcessingEvent, // Từ ResultProcessingService
  'csv_stream_collect_success': fileOutput.handleCsvProcessingEvent,     // Từ ResultProcessingService
  'csv_stream_collect_failed': fileOutput.handleCsvProcessingEvent,      // Từ ResultProcessingService
  'csv_generation_failed_or_empty': fileOutput.handleCsvProcessingEvent, // Từ CrawlOrchestratorService
  'csv_generation_empty_but_file_exists': fileOutput.handleCsvProcessingEvent, // Từ CrawlOrchestratorService
  'csv_generation_pipeline_failed': fileOutput.handleCsvProcessingEvent, // Từ CrawlOrchestratorService (khi bắt lỗi từ ResultProcessing)

  // Validation & Normalization
  'validation_warning': validation.handleValidationWarning,
  'normalization_applied': validation.handleNormalizationApplied,

  // --- Overall Process ---
  // Event từ CrawlOrchestratorService
  'crawl_start': overallProcess.handleCrawlStart,

  // Events từ Controller (hoặc service cao nhất kết thúc tiến trình)
  'processing_finished_successfully': overallProcess.handleControllerProcessingFinished,
  'processing_failed_in_controller': overallProcess.handleControllerProcessingFinished,

};