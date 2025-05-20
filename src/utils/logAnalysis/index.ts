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
  // 'fetch_content_failed': playwright.handleOtherPlaywrightFailure, // Lỗi page.content()
  'unexpected_error': playwright.handleOtherPlaywrightFailure, // Lỗi chung trong PageContentExtractorService


  // --- Gemini API Events Group ---
  // Gemini Final Failures
  'retry_failed_max_retries': geminiApi.handleGeminiFinalFailure,
  'retry_abort_non_retryable': geminiApi.handleGeminiFinalFailure,
  'gemini_api_response_blocked': geminiApi.handleGeminiFinalFailure, // Giữ nguyên, event này vẫn tồn tại
  'retry_attempt_error_safety_blocked': geminiApi.handleGeminiFinalFailure, // Giữ nguyên

  // Gemini Setup & Critical Init Failures
  'gemini_service_genai_init_failed': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  'gemini_service_not_initialized': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  'gemini_service_genai_not_ready': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  'gemini_call_limiter_init_failed': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  'gemini_call_missing_apiconfig': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  'gemini_call_missing_model_config': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  // 'gemini_api_model_undefined': geminiApi.handleGeminiSetupFailure, // Đã đổi tên thành 'gemini_api_model_missing_before_generate' hoặc được xử lý bởi 'non_cached_setup_failed'
  'gemini_api_model_missing_before_generate': geminiApi.handleGeminiSetupFailure, // (MỚI) Event khi model bị undefined ngay trước khi gọi generateContent
  'non_cached_setup_failed': geminiApi.handleGeminiSetupFailure, // Giữ nguyên (lỗi khi getGenerativeModel không cache)
  'gemini_public_method_unhandled_error': geminiApi.handleGeminiSetupFailure, // Giữ nguyên
  'gemini_call_model_prep_orchestration_failed': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi từ model orchestrator nếu không chuẩn bị được model
  'model_orchestration_critical_failure': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi nghiêm trọng khi model orchestrator không tạo được model
  'gemini_client_manager_no_genai_instance': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi từ ClientManager nếu genAI instance null
  'gemini_client_manager_no_cache_manager_instance': geminiApi.handleGeminiSetupFailure, // (MỚI) Lỗi từ ClientManager nếu cacheManager instance null (có thể coi là setup failure nếu cache quan trọng)


  // Gemini Success
  'gemini_api_attempt_success': geminiApi.handleGeminiSuccess, // Giữ nguyên

  // Gemini Cache Specifics
  // Cache Context (Semantic Cache)
  'cache_setup_use_success': geminiApi.handleGeminiCacheHit, // Giữ nguyên (Khi sử dụng cached context thành công)
  'cache_context_hit_inmemory': geminiApi.handleGeminiCacheHit, // (MỚI/CHI TIẾT HƠN) Khi tìm thấy cache trong memory map của ContextCacheService

  'cache_context_get_or_create_start': geminiApi.handleCacheContextCreateStart, // (MỚI) Bắt đầu quá trình get hoặc create context cache
  'cache_context_create_attempt': geminiApi.handleCacheContextCreateStart, // (Đã có, có thể gộp với event trên hoặc giữ riêng nếu ý nghĩa khác) - dùng 'cache_context_get_or_create_start' có vẻ bao quát hơn

  'cache_context_create_success': geminiApi.handleCacheContextCreationSuccess, // (SỬA EVENT) Tạo context cache thành công
  'cache_context_retrieval_success': geminiApi.handleCacheContextCreationSuccess, // (SỬA EVENT) Lấy context cache từ manager thành công (coi như một dạng "creation" thành công cho lần dùng đó)

  'cache_context_create_failed': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT)
  'cache_context_create_failed_invalid_model': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT)
  'cache_context_create_failed_permission': geminiApi.handleCacheContextCreationFailed, // (MỚI)
  'cache_context_create_failed_invalid_response': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT)
  'cache_context_setup_failed_no_manager': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT)
  'cache_context_logic_unhandled_error': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT)
  'gemini_call_cache_setup_failed': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT) Lỗi nghiêm trọng khi setup cache cho một API call
  'gemini_call_model_from_cache_failed': geminiApi.handleCacheContextCreationFailed, // (SỬA EVENT) Lỗi khi lấy model từ cached content đã có

  // Cache Invalidation / Removal
  'retry_cache_invalidate': geminiApi.handleCacheContextInvalidation, // Giữ nguyên (Từ retry loop)
  'cache_persistent_entry_remove_start': geminiApi.handleCacheContextInvalidation, // (MỚI) Bắt đầu xóa entry khỏi persistent map
  'cache_inmemory_entry_remove': geminiApi.handleCacheContextInvalidation, // (MỚI) Xóa entry khỏi in-memory cache

  // Cache Context Retrieval Failures (từ manager)
  'cache_context_retrieval_failed_not_found_in_manager': geminiApi.handleCacheContextRetrievalFailure, // (SỬA EVENT)
  'cache_context_retrieval_failed_exception': geminiApi.handleCacheContextRetrievalFailure, // (SỬA EVENT)

  // Cache Map File (gemini_cache_map.json)
  'cache_map_load_failed': geminiApi.handleCacheMapLoadFailure, // (SỬA EVENT)
  'cache_map_write_success': geminiApi.handleCacheMapWriteSuccess, // (SỬA EVENT)
  'cache_map_write_failed': geminiApi.handleCacheMapWriteFailure, // (SỬA EVENT)

  // Cache Manager (SDK's GoogleAICacheManager)
  'cache_manager_init_failed_no_apikey': geminiApi.handleCacheManagerCreateFailure, // (MỚI) Từ ClientManager
  'cache_manager_create_failed': geminiApi.handleCacheManagerCreateFailure, // Giữ nguyên (Từ ClientManager)
  'cache_manager_init_skipped_no_genai': geminiApi.handleCacheManagerCreateFailure, // (MỚI) Từ ClientManager, có thể coi là một dạng init failure nếu cache manager là thiết yếu.

  // Gemini Call & Retry Stats
  'gemini_call_start': geminiApi.handleGeminiCallStart, // Giữ nguyên
  'retry_attempt_start': geminiApi.handleRetryAttemptStart, // (SỬA EVENT) (Đã có trong file handler của bạn, đảm bảo tên event khớp)

  // Gemini Intermediate Errors & Limits
  'retry_wait_before_next': geminiApi.handleRateLimitWait, // Giữ nguyên
  'retry_internal_rate_limit_wait': geminiApi.handleRateLimitWait, // Gi মানে

  // Gemini Intermediate Errors
  'json_clean_parse_failed': geminiApi.handleGeminiIntermediateError, // (MỚI/Đã có trong file handlers)
  'json_clean_structure_not_found': geminiApi.handleGeminiIntermediateError, // (MỚI/Đã có trong file handlers)

  'retry_attempt_error_cache': geminiApi.handleGeminiIntermediateError, // Giữ nguyên
  'retry_attempt_error_429': geminiApi.handleGeminiIntermediateError, // Giữ nguyên
  'retry_attempt_error_5xx': geminiApi.handleGeminiIntermediateError, // Giữ nguyên
  'retry_attempt_error_unknown': geminiApi.handleGeminiIntermediateError, // Giữ nguyên
  'retry_loop_exit_unexpected': geminiApi.handleGeminiIntermediateError, // Giữ nguyên
  'gemini_api_generate_content_failed': geminiApi.handleGeminiIntermediateError, // (SỬA EVENT) Lỗi từ model.generateContent()
  // 'gemini_api_generate_failed': geminiApi.handleGeminiIntermediateError, // Tên cũ, đã đổi thành gemini_api_generate_content_failed
  // 'retry_genai_not_init': geminiApi.handleGeminiIntermediateError, // Đã được xử lý bởi 'gemini_service_genai_not_ready' hoặc các lỗi setup khác

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
  'crawl_start': overallProcess.handleCrawlStart,

  // Events từ Controller (hoặc service cao nhất kết thúc tiến trình)
  'processing_finished_successfully': overallProcess.handleControllerProcessingFinished,
  'processing_failed_in_controller': overallProcess.handleControllerProcessingFinished,

};