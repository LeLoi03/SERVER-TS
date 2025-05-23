// src/utils/logAnalysis/index.ts

// Import all handlers from child files
import * as taskLifecycle from './taskLifecycleHandlers';
import * as search from './searchHandlers';
import * as playwright from './playwrightHandlers';
import * as geminiApi from './geminiApiHandlers';
import * as batchProcessing from './batchProcessingHandlers';
import * as fileOutput from './fileOutputHandlers';
import * as validation from './validationHandlers';
import * as overallProcess from './overallProcessHandlers';

import { LogAnalysisResult, ConferenceAnalysisDetail } from '../../types';
export type LogEventHandler = (
  logEntry: any,
  results: LogAnalysisResult,
  confDetail: ConferenceAnalysisDetail | null,
  entryTimestampISO: string,
) => void;


export const eventHandlerMap: Record<string, LogEventHandler> = {

  // --- Task Lifecycle ---
  'task_start': taskLifecycle.handleTaskStart,
  'task_finish': taskLifecycle.handleTaskFinish,
  'task_unhandled_error': taskLifecycle.handleTaskUnhandledError,
  'task_skipped': taskLifecycle.handleTaskSkipped,
  'recrawl_detected': taskLifecycle.handleRecrawlDetected,


  // --- Search Events Group ---
  'search_failed_max_retries': search.handleSearchFailure,
  'search_ultimately_failed': search.handleSearchFailure,
  'search_ultimately_failed_unknown_post_loop': search.handleSearchFailure,
  'search_skip_all_keys_exhausted': search.handleSearchFailure,
  'search_skip_no_key': search.handleSearchFailure,
  'search_key_rotation_failed_after_quota': search.handleSearchFailure,
  'search_attempt_success': search.handleSearchSuccess,
  'search_attempt_no_items': search.handleSearchSuccess,
  'search_results_filtered_completed': search.handleSearchResultsFiltered,
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
  'api_keys_all_exhausted_status': search.handleAllApiKeysExhaustedInfo, // THÊM DÒNG NÀY
  'api_key_force_rotated_success_locked': search.handleApiKeyRotation,
  'api_key_force_rotated_fail_locked': search.handleApiKeyRotation,



  // --- Playwright Events Group ---
  'playwright_global_init_start': playwright.handlePlaywrightGlobalInitStart,
  'playwright_global_init_success': playwright.handlePlaywrightGlobalInitSuccess,
  'playwright_global_init_failed': playwright.handlePlaywrightGlobalInitFailed,
  'playwright_get_context_failed_not_initialized': playwright.handlePlaywrightGetContextFailed,
  'html_persistence_set_context_failed': playwright.handlePlaywrightGetContextFailed,
  'process_save_start': playwright.handleSaveHtmlConferenceStart,
  'process_save_skipped_no_links': playwright.handleSaveHtmlConferenceSkipped,
  'process_save_delegation_initiated': playwright.handleSaveHtmlConferenceSuccess,
  'process_save_delegation_initiation_failed': playwright.handleSaveHtmlConferenceFailed,
  'process_save_delegation_error': playwright.handleSaveHtmlConferenceFailed,
  'single_link_processing_start': playwright.handleLinkProcessingAttempt,
  'single_link_processing_success': playwright.handleLinkProcessingSuccess,
  'single_link_processing_failed_to_access_link': playwright.handleLinkProcessingFailed,
  'single_link_processing_unhandled_error': playwright.handleLinkProcessingFailed,
  'html_processing_failed': playwright.handleOtherPlaywrightFailure,
  'goto_failed': playwright.handleOtherPlaywrightFailure,
  'fetch_content_failed': playwright.handleOtherPlaywrightFailure,
  'unexpected_error': playwright.handleOtherPlaywrightFailure,


  // --- Gemini API Events Group ---

  // Gemini Final Failures
  'retry_failed_max_retries': geminiApi.handleGeminiFinalFailure,
  'retry_abort_non_retryable_error': geminiApi.handleGeminiFinalFailure,
  'retry_abort_failed_first_attempt': geminiApi.handleGeminiFinalFailure, // THÊM (nếu nó là final)

  'gemini_api_response_blocked': geminiApi.handleGeminiFinalFailure,
  'gemini_api_response_blocked_missing_body': geminiApi.handleGeminiFinalFailure,
  'retry_attempt_error_safety_blocked': geminiApi.handleGeminiFinalFailure,
  'retry_failed_max_retries_5xx_current_model': geminiApi.handleGeminiFinalFailure,
  'gemini_call_5xx_no_more_fallback_options': geminiApi.handleGeminiFinalFailure,
  'gemini_call_failed_no_more_options': geminiApi.handleGeminiFinalFailure,
  'gemini_call_unexpected_exit_after_attempts': geminiApi.handleGeminiFinalFailure,
  'gemini_orchestration_fallback_failed_after_retries': geminiApi.handleGeminiFinalFailure,
  'retry_internal_rate_limit_first_attempt_fail_single_shot': geminiApi.handleGeminiFinalFailure,
  'gemini_public_method_orchestration_failed': geminiApi.handleGeminiFinalFailure, // THÊM (cần logic kiểm tra trong handler)
  
  
  // Gemini Setup, Init, Config Failures
  'gemini_service_genai_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_service_not_initialized': geminiApi.handleGeminiSetupFailure,
  'gemini_service_genai_not_ready': geminiApi.handleGeminiSetupFailure,
  'gemini_call_limiter_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_call_missing_apitypeconfig': geminiApi.handleGeminiSetupFailure,
  'gemini_call_missing_model_config': geminiApi.handleGeminiSetupFailure,
  'gemini_api_model_missing_before_generate': geminiApi.handleGeminiSetupFailure,
  'non_cached_setup_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_public_method_unhandled_error': geminiApi.handleGeminiSetupFailure,
  'gemini_call_model_prep_orchestration_failed': geminiApi.handleGeminiSetupFailure,
  'model_orchestration_critical_failure_final_check': geminiApi.handleGeminiSetupFailure,
  'gemini_client_manager_no_genai_instance': geminiApi.handleGeminiSetupFailure,
  'gemini_client_manager_no_cache_manager_instance': geminiApi.handleGeminiSetupFailure,
  'cache_manager_create_failed': geminiApi.handleGeminiSetupFailure,
  'cache_manager_init_failed_no_apikey': geminiApi.handleGeminiSetupFailure,
  'cache_manager_init_skipped_no_genai': geminiApi.handleGeminiSetupFailure,
  'cache_map_load_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_service_async_init_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_service_lazy_init_attempt': geminiApi.handleGeminiSetupFailure,
  'gemini_service_critically_uninitialized': geminiApi.handleGeminiSetupFailure,
  'gemini_model_list_empty_or_missing': geminiApi.handleGeminiSetupFailure,
  'gemini_service_config_error': geminiApi.handleGeminiSetupFailure,
  'gemini_service_no_clients_initialized': geminiApi.handleGeminiSetupFailure,
  'gemini_key_selection_unhandled_api_type': geminiApi.handleGeminiSetupFailure,
  'gemini_key_selection_no_keys_available': geminiApi.handleGeminiSetupFailure,
  'gemini_key_selection_index_out_of_bounds': geminiApi.handleGeminiSetupFailure,
  'rate_limiter_creation_invalid_object': geminiApi.handleGeminiSetupFailure,
  'rate_limiter_creation_exception': geminiApi.handleGeminiSetupFailure,
  'gemini_call_preparation_failed_for_model': geminiApi.handleGeminiSetupFailure,
  'gemini_orchestration_primary_prep_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_orchestration_fallback_prep_failed': geminiApi.handleGeminiSetupFailure,
  'gemini_orchestration_logic_error': geminiApi.handleGeminiSetupFailure, // THÊM



  // Gemini Service Initialization Lifecycle (Informational)
  'gemini_service_async_init_start': geminiApi.handleServiceInitLifecycle,
  'gemini_service_async_init_complete': geminiApi.handleServiceInitLifecycle,
  'gemini_client_init_start': geminiApi.handleServiceInitLifecycle,
  'gemini_client_genai_init_success': geminiApi.handleServiceInitLifecycle,
  'gemini_client_cache_manager_init_success': geminiApi.handleServiceInitLifecycle,
  'rate_limiter_init_success': geminiApi.handleServiceInitLifecycle,
  'rate_limiter_create_attempt': geminiApi.handleServiceInitLifecycle,
  'rate_limiter_create_success': geminiApi.handleServiceInitLifecycle,


  // Gemini Success (various points of success)
  'gemini_api_attempt_success': geminiApi.handleGeminiSuccess,
  'gemini_public_method_finish': geminiApi.handleGeminiSuccess,
  'gemini_orchestration_primary_success': geminiApi.handleOrchestrationEvent,
  'gemini_orchestration_fallback_success': geminiApi.handleOrchestrationEvent,

  // Gemini Cache Specifics
  'cache_setup_use_success': geminiApi.handleGeminiCacheHit,
  'cache_context_hit_inmemory': geminiApi.handleGeminiCacheHit,
  'cache_model_from_cache_success': geminiApi.handleGeminiCacheHit,
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
  'gemini_call_no_cache_available_or_setup_failed': geminiApi.handleCacheContextCreationFailed,

  // Cache Invalidation / Removal
  'retry_cache_invalidate': geminiApi.handleCacheContextInvalidation,
  'cache_persistent_entry_remove_start': geminiApi.handleCacheContextInvalidation,
  'cache_inmemory_entry_remove': geminiApi.handleCacheContextInvalidation,

  // Cache Context Retrieval Failures (from manager.get())
  'cache_context_retrieval_failed_not_found_in_manager': geminiApi.handleCacheContextRetrievalFailure,
  'cache_context_retrieval_failed_exception': geminiApi.handleCacheContextRetrievalFailure,

  // Cache Map File (gemini_cache_map.json)
  'cache_map_load_attempt': geminiApi.handleCacheMapPersistence,
  'cache_map_load_success': geminiApi.handleCacheMapPersistence,
  'cache_map_write_attempt': geminiApi.handleCacheMapPersistence,
  'cache_map_write_success': geminiApi.handleCacheMapPersistence,
  'cache_map_write_failed': geminiApi.handleCacheMapPersistence,

  // Cache Decision Logic
  'cache_context_attempt_setup_for_call': geminiApi.handleCacheDecision,
  'gemini_call_cache_disabled': geminiApi.handleCacheDecision,

  // Gemini Call & Retry Stats
  'gemini_call_start': geminiApi.handleGeminiCallStart,
  'initial_attempt_start': geminiApi.handleRetryAttemptStart,
  'retry_attempt_start': geminiApi.handleRetryAttemptStart,
  

  // Gemini Intermediate Errors & Limits (during retry loop, not final for the model yet)
  'retry_wait_before_next': geminiApi.handleRateLimitWait,
  'retry_internal_rate_limit_wait': geminiApi.handleRateLimitWait,
  'json_clean_parse_failed': geminiApi.handleGeminiIntermediateError,
  'json_clean_structure_not_found': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_cache': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_429': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_5xx': geminiApi.handleGeminiIntermediateError,
  'retry_attempt_error_unknown': geminiApi.handleGeminiIntermediateError,
  'retry_loop_exit_unexpected': geminiApi.handleGeminiIntermediateError,
  'gemini_api_generate_content_failed': geminiApi.handleGeminiIntermediateError,

  'json_clean_parse_failed_after_clean_for_extract': geminiApi.handleGeminiIntermediateError, // THÊM (hoặc handleResponseProcessing)
  'json_clean_structure_not_found_after_clean_for_extract': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_parse_failed_after_clean_for_cfp': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_structure_not_found_after_clean_for_cfp': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_parse_failed_after_clean_for_determine': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_structure_not_found_after_clean_for_determine': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_final_invalid_for_extract': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_final_invalid_for_cfp': geminiApi.handleGeminiIntermediateError, // THÊM
  'json_clean_final_invalid_for_determine': geminiApi.handleGeminiIntermediateError, // THÊM


  // --- Gemini Orchestration, Fallback, Model Prep (Informational & Decisions) ---
  'gemini_orchestration_primary_start': geminiApi.handleOrchestrationEvent,
  'gemini_orchestration_no_primary_model': geminiApi.handleOrchestrationEvent,
  'gemini_orchestration_primary_failed': geminiApi.handleOrchestrationEvent, // <<<< THAY ĐỔI MAPPING
  'gemini_call_no_fallback_configured': geminiApi.handleOrchestrationEvent,
  'gemini_orchestration_fallback_start': geminiApi.handleOrchestrationEvent,
  'gemini_call_primary_failed_non_5xx_checking_fallback': geminiApi.handleOrchestrationEvent,
  'gemini_call_5xx_switching_to_fallback': geminiApi.handleOrchestrationEvent,
  'model_preparation_complete': geminiApi.handleModelPreparation,

  // --- Gemini Configuration & Few-Shot Prep (Informational & Decisions) ---
  'gemini_fewshot_allowed_but_no_config_data_for_non_tuned': geminiApi.handleFewShotPrep,
  'gemini_fewshot_disabled_for_non_tuned_by_config': geminiApi.handleFewShotPrep,
  'few_shot_prep_start': geminiApi.handleFewShotPrep,
  'few_shot_prep_success': geminiApi.handleFewShotPrep,
  'few_shot_prep_missing_or_empty_input_value': geminiApi.handleFewShotPrep,
  'few_shot_prep_missing_or_empty_output_value_for_input': geminiApi.handleFewShotPrep,
  'few_shot_prep_empty_result_after_processing': geminiApi.handleFewShotPrep,
  'few_shot_prep_odd_parts_count': geminiApi.handleFewShotPrep,
  'few_shot_prep_failed': geminiApi.handleFewShotPrep,

  // --- Gemini Request Payload Logging ---
  'gemini_api_request_payload_logged': geminiApi.handleRequestPayloadLog,
  'gemini_api_request_payload_log_failed': geminiApi.handleRequestPayloadLog,

  // --- Gemini Generate Content Internals (model.generateContent() lifecycle) ---
  'gemini_api_generate_start': geminiApi.handleGenerateContentInternal,
  'gemini_api_generate_success': geminiApi.handleGenerateContentInternal,

  // --- Gemini Response Processing (From ResponseHandler & GeminiApiService) ---
  'gemini_api_response_markdown_stripped': geminiApi.handleResponseProcessing,
  'gemini_api_response_valid_json': geminiApi.handleResponseProcessing,
  'gemini_api_response_invalid_json': geminiApi.handleResponseProcessing,
  'json_clean_success': geminiApi.handleResponseProcessing,
  'gemini_api_response_empty_after_processing': geminiApi.handleResponseProcessing,
  'gemini_api_response_trailing_comma_fixed': geminiApi.handleResponseProcessing,
  'response_file_write_success': geminiApi.handleResponseProcessing,
  'response_file_write_failed': geminiApi.handleResponseProcessing,


  // --- Batch Processing Events Group ---
  'batch_task_start_execution': batchProcessing.handleBatchTaskCreate,
  'batch_task_create_delegation_start': batchProcessing.handleBatchTaskCreate,
  'batch_task_execution_failed': batchProcessing.handleBatchRejectionOrLogicFailure,
  'batch_processing_abort_no_main_text': batchProcessing.handleBatchRejectionOrLogicFailure,
  'conference_link_processor_link_missing_for_update': batchProcessing.handleBatchRejectionOrLogicFailure,
  'conference_link_processor_update_link_failed': batchProcessing.handleBatchRejectionOrLogicFailure,
  'save_batch_determine_api_call_failed': batchProcessing.handleBatchApiFailure,
  'batch_extract_api_call_failed': batchProcessing.handleBatchApiFailure,
  'batch_cfp_api_call_failed': batchProcessing.handleBatchApiFailure,
  'save_batch_process_determine_call_failed': batchProcessing.handleBatchApiFailure,
  'save_batch_process_determine_failed_invalid': batchProcessing.handleBatchApiFailure,
  'save_batch_api_response_parse_failed': batchProcessing.handleBatchApiFailure,
  'batch_parallel_final_apis_both_failed': batchProcessing.handleBatchApiFailure,
  'batch_dir_create_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_failed_missing_path': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_read_content_warn_non_critical': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_write_file_failed': batchProcessing.handleBatchFileSystemFailure,
  'save_batch_aggregate_content_end': batchProcessing.handleBatchAggregationEnd,
  'batch_task_finish_success': batchProcessing.handleBatchFinishSuccess,


  // --- File Output (JSONL, CSV) ---
  'append_final_record_success': fileOutput.handleJsonlWriteSuccess,
  'append_final_record_failed': fileOutput.handleJsonlWriteFailed,
  'csv_write_record_success': fileOutput.handleCsvWriteSuccess,
  'csv_record_processed_for_writing': fileOutput.handleCsvProcessingEvent,
  'csv_stream_collect_success': fileOutput.handleCsvProcessingEvent,
  'csv_stream_collect_failed': fileOutput.handleCsvProcessingEvent,
  'csv_generation_failed_or_empty': fileOutput.handleCsvProcessingEvent,
  'csv_generation_empty_but_file_exists': fileOutput.handleCsvProcessingEvent,
  'csv_generation_pipeline_failed': fileOutput.handleCsvProcessingEvent,

  // Validation & Normalization
  'validation_warning': validation.handleValidationWarning,
  'normalization_applied': validation.handleNormalizationApplied,

  // --- Overall Process ---
  'crawl_orchestrator_start': overallProcess.handleCrawlStart,
  'processing_finished_successfully': overallProcess.handleControllerProcessingFinished,
  'processing_failed_in_controller': overallProcess.handleControllerProcessingFinished,
};