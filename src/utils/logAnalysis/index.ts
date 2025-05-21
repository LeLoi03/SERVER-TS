// src/utils/logAnalysis/index.ts

// Import tất cả các handler từ các file con
import * as taskLifecycle from './taskLifecycleHandlers';
import * as search from './searchHandlers';
import * as playwright from './playwrightHandlers';
import * as geminiApi from './geminiApiHandlers';
import * as batchProcessing from './batchProcessingHandlers';
import * as fileOutput from './fileOutputHandlers';
import * as validation from './validationHandlers';
import * as overallProcess from './overallProcessHandlers';

import { LogAnalysisResult, ConferenceAnalysisDetail } from '../../types/logAnalysis.types';
export type LogEventHandler = (
  logEntry: any,
  results: LogAnalysisResult,
  confDetail: ConferenceAnalysisDetail | null,
  entryTimestampISO: string,
  // logContext: object
) => void;


// Tạo eventHandlerMap bằng cách gom tất cả các handler đã export
export const eventHandlerMap: Record<string, LogEventHandler> = {

  // --- Task Lifecycle ---
  'task_start': taskLifecycle.handleTaskStart,
  // 'task_crawl_stage_finish': taskLifecycle.handleTaskFinish, // Bỏ alias này nếu không dùng
  'task_finish': taskLifecycle.handleTaskFinish, // Event chính từ ConferenceProcessor
  'task_unhandled_error': taskLifecycle.handleTaskUnhandledError,
  'task_skipped': taskLifecycle.handleTaskSkipped, // Thêm nếu bạn có event này
  'recrawl_detected': taskLifecycle.handleRecrawlDetected, // <<< THÊM MỚI


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
  'api_key_provided_locked': search.handleApiKeyProvided,
  'api_key_usage_limit_reached_locked': search.handleApiKeyUsageLimitReached,
  'api_keys_all_exhausted_checked_locked': search.handleAllApiKeysExhaustedInfo,
  'api_key_force_rotated_success_locked': search.handleApiKeyRotation,
  'api_key_force_rotated_fail_locked': search.handleApiKeyRotation,


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
  'single_link_processing_success': playwright.handleLinkProcessingSuccess, // SỬA Ở ĐÂY
  'single_link_processing_failed_to_access_link': playwright.handleLinkProcessingFailed,
  'single_link_processing_unhandled_error': playwright.handleLinkProcessingFailed, // Lỗi chung khi xử lý 1 link
  // 'redirect_detected': playwright.handleLinkRedirectDetected, // Giữ lại nếu bạn có log event này

  // Lỗi từ PageContentExtractorService liên quan đến Playwright
  'html_processing_failed': playwright.handleOtherPlaywrightFailure, // Khi page null hoặc closed
  'goto_failed': playwright.handleOtherPlaywrightFailure, // Lỗi page.goto()
  'fetch_content_failed': playwright.handleOtherPlaywrightFailure, // Lỗi page.content()
  'unexpected_error': playwright.handleOtherPlaywrightFailure, // Lỗi chung trong PageContentExtractorService


  // --- Gemini API Events Group ---

  // Gemini Final Failures (Thất bại cuối cùng của một nỗ lực gọi API)
  'retry_failed_max_retries': geminiApi.handleGeminiFinalFailure,
  'retry_abort_non_retryable': geminiApi.handleGeminiFinalFailure,
  'gemini_api_response_blocked': geminiApi.handleGeminiFinalFailure,
  'retry_attempt_error_safety_blocked': geminiApi.handleGeminiFinalFailure,
  'retry_failed_max_retries_5xx_current_model': geminiApi.handleGeminiFinalFailure, // (MỚI) Lỗi 5xx cuối cùng cho model hiện tại
  'gemini_call_5xx_no_more_fallback_options': geminiApi.handleGeminiFinalFailure, // (MỚI) Hết lựa chọn fallback sau lỗi 5xx
  'gemini_call_failed_no_more_options': geminiApi.handleGeminiFinalFailure, // (MỚI) Thất bại chung, không còn lựa chọn fallback
  'gemini_call_unexpected_exit_after_attempts': geminiApi.handleGeminiFinalFailure, // (MỚI) Lỗi không mong muốn khi thoát vòng lặp gọi API

  // Gemini Setup & Critical Init Failures
  'gemini_service_genai_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_service_not_initialized': geminiApi.handleGeminiSetupFailure,
  'gemini_service_genai_not_ready': geminiApi.handleGeminiSetupFailure,
  'gemini_call_limiter_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_call_missing_apiconfig': geminiApi.handleGeminiSetupFailure,
  'gemini_call_missing_model_config': geminiApi.handleGeminiSetupFailure,
  'gemini_api_model_missing_before_generate': geminiApi.handleGeminiSetupFailure,
  'non_cached_setup_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_public_method_unhandled_error': geminiApi.handleGeminiSetupFailure, // Coi là setup failure cho method đó
  'gemini_call_model_prep_orchestration_failed': geminiApi.handleGeminiSetupFailure,
  'model_orchestration_critical_failure': geminiApi.handleGeminiSetupFailure,
  'gemini_client_manager_no_genai_instance': geminiApi.handleGeminiSetupFailure,
  'gemini_client_manager_no_cache_manager_instance': geminiApi.handleGeminiSetupFailure,
  'cache_manager_create_failed': geminiApi.handleGeminiSetupFailure,
  'cache_manager_init_failed_no_apikey': geminiApi.handleGeminiSetupFailure,
  'cache_manager_init_skipped_no_genai': geminiApi.handleGeminiSetupFailure,
  'cache_map_load_failed': geminiApi.handleGeminiSetupFailure, // Đồng thời cũng là lỗi init service
  'gemini_service_async_init_failed': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi init bất đồng bộ
  'gemini_service_lazy_init_attempt': geminiApi.handleGeminiSetupFailure, // (MỚI) Khi cố gắng lazy init
  'gemini_service_critically_uninitialized': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi nghiêm trọng khi service chưa init
  'gemini_model_list_empty_or_missing': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi config model list
  'few_shot_prep_odd_parts_count': geminiApi.handleFewShotPrep, // (MỚI) Lỗi config few-shot, cũng là một dạng setup failure
  'few_shot_prep_failed': geminiApi.handleFewShotPrep, // (MỚI) Lỗi xử lý few-shot, cũng là một dạng setup failure

  // Gemini Service Initialization Lifecycle (Thông tin)
  'gemini_service_async_init_start': geminiApi.handleServiceInitLifecycle, // (MỚI)
  'gemini_service_async_init_complete': geminiApi.handleServiceInitLifecycle, // (MỚI)

  // Gemini Success
  'gemini_api_attempt_success': geminiApi.handleGeminiSuccess, // Thành công của một attempt (sau retry loop của attempt đó)
  'gemini_call_success_with_model': geminiApi.handleGeminiSuccess, // (MỚI) Thành công của toàn bộ callGeminiAPI (primary hoặc fallback)

  // Gemini Cache Specifics
  'cache_setup_use_success': geminiApi.handleGeminiCacheHit,
  'cache_context_hit_inmemory': geminiApi.handleGeminiCacheHit,
  'cache_model_from_cache_success': geminiApi.handleGeminiCacheHit, // (MỚI) Chi tiết hơn cache hit
  'cache_context_get_or_create_start': geminiApi.handleCacheContextCreateStart,
  'cache_context_create_success': geminiApi.handleCacheContextCreationSuccess,
  'cache_context_retrieval_success': geminiApi.handleCacheContextCreationSuccess,
  'cache_context_create_failed': geminiApi.handleCacheContextCreationFailed,
  'cache_context_create_failed_invalid_model': geminiApi.handleCacheContextCreationFailed,
  'cache_context_create_failed_permission': geminiApi.handleCacheContextCreationFailed,
  'cache_context_create_failed_invalid_response': geminiApi.handleCacheContextCreationFailed,
  'cache_context_setup_failed_no_manager': geminiApi.handleCacheContextCreationFailed,
  'cache_context_logic_unhandled_error': geminiApi.handleCacheContextCreationFailed,
  'gemini_call_cache_setup_failed': geminiApi.handleCacheContextCreationFailed,
  'gemini_call_model_from_cache_failed': geminiApi.handleCacheContextCreationFailed,
  'gemini_call_no_cache_available_or_setup_failed': geminiApi.handleCacheContextCreationFailed, // (MỚI) Khi cache được yêu cầu nhưng không dùng được cho call

  // Cache Invalidation / Removal
  'retry_cache_invalidate': geminiApi.handleCacheContextInvalidation,
  'cache_persistent_entry_remove_start': geminiApi.handleCacheContextInvalidation,
  'cache_inmemory_entry_remove': geminiApi.handleCacheContextInvalidation,

  // Cache Context Retrieval Failures (từ manager)
  'cache_context_retrieval_failed_not_found_in_manager': geminiApi.handleCacheContextRetrievalFailure,
  'cache_context_retrieval_failed_exception': geminiApi.handleCacheContextRetrievalFailure,

  // Cache Map File (gemini_cache_map.json)
  // 'cache_map_load_failed' đã được map ở Setup Failures
  'cache_map_write_success': geminiApi.handleCacheMapWriteSuccess,
  'cache_map_write_failed': geminiApi.handleCacheMapWriteFailure,

  // Gemini Call & Retry Stats
  'gemini_call_start': geminiApi.handleGeminiCallStart, // Bắt đầu một cuộc gọi API (có thể là primary hoặc fallback)
  'retry_attempt_start': geminiApi.handleRetryAttemptStart, // Bắt đầu một lần thử trong vòng lặp retry

  // Gemini Intermediate Errors & Limits (Lỗi trong quá trình retry, chưa phải final)
  'retry_wait_before_next': geminiApi.handleRateLimitWait,
  'retry_internal_rate_limit_wait': geminiApi.handleRateLimitWait,
  'json_clean_parse_failed': geminiApi.handleGeminiIntermediateError,
  'json_clean_structure_not_found': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_cache': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_429': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_5xx': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_unknown': geminiApi.handleGeminiIntermediateError,
  'retry_loop_exit_unexpected': geminiApi.handleGeminiIntermediateError,
  'gemini_api_generate_content_failed': geminiApi.handleGeminiIntermediateError, // Lỗi từ model.generateContent()

  // --- Gemini Fallback Logic (Thông tin & Quyết định) ---
  'gemini_call_no_fallback_configured': geminiApi.handleFallbackLogic, // (MỚI)
  'gemini_call_attempting_fallback_model': geminiApi.handleFallbackLogic, // (MỚI)
  'gemini_call_attempting_primary_model': geminiApi.handleFallbackLogic, // (MỚI) (Có thể không cần hành động nhiều)
  'gemini_call_5xx_switching_to_fallback': geminiApi.handleFallbackLogic, // (MỚI)
  'gemini_call_primary_failed_non_5xx_checking_fallback': geminiApi.handleFallbackLogic, // (MỚI)

  // --- Gemini Configuration & Few-Shot Prep (Thông tin & Quyết định) ---
  'gemini_fewshot_allowed_but_no_config_data_for_non_tuned': geminiApi.handleFewShotPrep, // (MỚI)
  'gemini_fewshot_disabled_for_non_tuned_by_config': geminiApi.handleFewShotPrep, // (MỚI)
  'few_shot_prep_start': geminiApi.handleFewShotPrep, // (MỚI)
  'few_shot_prep_success': geminiApi.handleFewShotPrep, // (MỚI)
  'few_shot_prep_missing_or_empty_input_value': geminiApi.handleFewShotPrep, // (MỚI WARNING)
  'few_shot_prep_missing_or_empty_output_value_for_input': geminiApi.handleFewShotPrep, // (MỚI WARNING)
  'few_shot_prep_empty_result_after_processing': geminiApi.handleFewShotPrep, // (MỚI WARNING)
  // 'few_shot_prep_odd_parts_count', 'few_shot_prep_failed' đã được map ở Setup Failures

  // --- Gemini Request Payload Logging ---
  'gemini_api_request_payload_logged': geminiApi.handleRequestPayloadLog, // (MỚI)
  'gemini_api_request_payload_log_failed': geminiApi.handleRequestPayloadLog, // (MỚI)

  // --- Gemini Generate Content Internals (model.generateContent() lifecycle) ---
  'gemini_api_generate_start': geminiApi.handleGenerateContentInternal, // (MỚI)
  'gemini_api_generate_success': geminiApi.handleGenerateContentInternal, // (MỚI) (Khác với gemini_api_attempt_success)


  // --- Batch Processing Events Group ---
  'batch_task_start_execution': batchProcessing.handleBatchTaskCreate,
  'batch_task_create_delegation_start': batchProcessing.handleBatchTaskCreate, // Map vào cùng handler

  'batch_task_execution_failed': batchProcessing.handleBatchRejectionOrLogicFailure,
  'batch_processing_abort_no_main_text': batchProcessing.handleBatchRejectionOrLogicFailure,
  'conference_link_processor_link_missing_for_update': batchProcessing.handleBatchRejectionOrLogicFailure,
  'conference_link_processor_update_link_failed': batchProcessing.handleBatchRejectionOrLogicFailure,

  'save_batch_determine_api_call_failed': batchProcessing.handleBatchApiFailure,
  'batch_extract_api_call_failed': batchProcessing.handleBatchApiFailure,
  'batch_cfp_api_call_failed': batchProcessing.handleBatchApiFailure, // Mới
  'save_batch_process_determine_call_failed': batchProcessing.handleBatchApiFailure,
  'save_batch_process_determine_failed_invalid': batchProcessing.handleBatchApiFailure,
  'save_batch_api_response_parse_failed': batchProcessing.handleBatchApiFailure, // Mới
  'batch_parallel_final_apis_both_failed': batchProcessing.handleBatchApiFailure, // Mới

  'batch_dir_create_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_failed_missing_path': batchProcessing.handleBatchFileSystemFailure, // Mới
  'save_batch_read_content_warn_non_critical': batchProcessing.handleBatchFileSystemFailure, // Map warning vào đây để đếm FS operations, nhưng không tăng failedBatches
  'save_batch_write_file_failed': batchProcessing.handleBatchFileSystemFailure,

  'save_batch_aggregate_content_end': batchProcessing.handleBatchAggregationEnd,
  'batch_task_finish_success': batchProcessing.handleBatchFinishSuccess,


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
  'crawl_orchestrator_start': overallProcess.handleCrawlStart,

  // Events từ Controller (hoặc service cao nhất kết thúc tiến trình)
  'processing_finished_successfully': overallProcess.handleControllerProcessingFinished, // Handler này cũng có thể cập nhật originalRequestId
  'processing_failed_in_controller': overallProcess.handleControllerProcessingFinished,

};