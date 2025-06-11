// src/utils/logAnalysis/geminiHandlers/index.ts (FINAL & VERIFIED VERSION)

/**
 * This file serves as the single entry point for all Gemini-related log event handlers.
 * It aggregates handlers from different modules into a single map, which is then
 * used by the main log analysis dispatcher. This approach promotes modularity and
 * separation of concerns.
 */

import { LogEventHandler } from '../index';
import {
    handleGeminiCallStart,
    handleGeminiSuccess,
    handleGeminiFinalFailure,
} from './apiLifecycle.handlers';
import {
    handleGeminiCacheHit,
    handleCacheContextCreateStart,
    handleCacheContextCreationSuccess,
    handleCacheContextCreationFailed,
    handleCacheContextInvalidation,
    handleCacheContextRetrievalFailure,
    handleCacheMapPersistence,
    handleCacheDecision,
} from './cache.handlers';
import {
    handleGeminiSetupFailure,
    handleServiceInitLifecycle,
    handleFewShotPrep,
    handleRequestPayloadLog,
} from './configAndSetup.handlers';
import {
    handleOrchestrationEvent,
    handleModelPreparation,
} from './orchestration.handlers';
import {
    handleRetryAttemptStart,
    handleRateLimitWait,
    handleGeminiIntermediateError,
} from './retry.handlers';
import {
    handleGenerateContentInternal,
    handleResponseProcessing,
} from './response.handlers';

export const geminiEventHandlers: { [key: string]: LogEventHandler } = {
    // --- Gemini Final Failures ---
    'retry_failed_max_retries': handleGeminiFinalFailure,
    'retry_abort_non_retryable_error': handleGeminiFinalFailure,
    'retry_abort_failed_first_attempt': handleGeminiFinalFailure,
    'gemini_api_response_blocked': handleGeminiFinalFailure, // Also handled by response handler, but final failure here
    'gemini_api_response_blocked_missing_body': handleGeminiFinalFailure, // Also handled by response handler
    'retry_attempt_error_safety_blocked': handleGeminiFinalFailure,
    'retry_failed_max_retries_5xx_current_model': handleGeminiFinalFailure,
    'gemini_call_5xx_no_more_fallback_options': handleGeminiFinalFailure,
    'gemini_call_failed_no_more_options': handleGeminiFinalFailure,
    'gemini_call_unexpected_exit_after_attempts': handleGeminiFinalFailure,
    'gemini_orchestration_fallback_failed_after_retries': handleGeminiFinalFailure, // Also handled by orchestration, but final failure here
    'retry_internal_rate_limit_first_attempt_fail_single_shot': handleGeminiFinalFailure,
    'gemini_public_method_orchestration_failed': handleGeminiFinalFailure,

    // --- Gemini Setup, Init, Config Failures ---
    'gemini_service_genai_init_failed': handleGeminiSetupFailure,
    'gemini_service_not_initialized': handleGeminiSetupFailure,
    'gemini_service_genai_not_ready': handleGeminiSetupFailure,
    'gemini_call_limiter_init_failed': handleGeminiSetupFailure,
    'gemini_call_missing_apitypeconfig': handleGeminiSetupFailure,
    'gemini_call_missing_model_config': handleGeminiSetupFailure,
    'gemini_api_model_missing_before_generate': handleGeminiSetupFailure,
    'non_cached_setup_failed': handleGeminiSetupFailure,
    'gemini_public_method_unhandled_error': handleGeminiSetupFailure,
    'gemini_call_model_prep_orchestration_failed': handleGeminiSetupFailure,
    'model_orchestration_critical_failure_final_check': handleGeminiSetupFailure,
    'gemini_client_manager_no_genai_instance': handleGeminiSetupFailure,
    'gemini_client_manager_no_cache_manager_instance': handleGeminiSetupFailure,
    'cache_manager_create_failed': handleGeminiSetupFailure,
    'cache_manager_init_failed_no_apikey': handleGeminiSetupFailure,
    'cache_manager_init_skipped_no_genai': handleGeminiSetupFailure,
    'cache_map_load_failed': handleGeminiSetupFailure,
    'gemini_service_async_init_failed': handleGeminiSetupFailure,
    'gemini_service_lazy_init_attempt': handleGeminiSetupFailure,
    'gemini_service_critically_uninitialized': handleGeminiSetupFailure,
    'gemini_model_list_empty_or_missing': handleGeminiSetupFailure,
    'gemini_service_config_error': handleGeminiSetupFailure,
    'gemini_service_no_clients_initialized': handleGeminiSetupFailure,
    'gemini_key_selection_unhandled_api_type': handleGeminiSetupFailure,
    'gemini_key_selection_no_keys_available': handleGeminiSetupFailure,
    'gemini_key_selection_index_out_of_bounds': handleGeminiSetupFailure,
    'rate_limiter_creation_invalid_object': handleGeminiSetupFailure,
    'rate_limiter_creation_exception': handleGeminiSetupFailure,
    'gemini_call_preparation_failed_for_model': handleGeminiSetupFailure,
    'gemini_orchestration_primary_prep_failed': handleGeminiSetupFailure,
    'gemini_orchestration_fallback_prep_failed': handleGeminiSetupFailure,
    'gemini_orchestration_logic_error': handleGeminiSetupFailure,

    // --- Gemini Service Initialization Lifecycle (Informational) ---
    'gemini_service_async_init_start': handleServiceInitLifecycle,
    'gemini_service_async_init_complete': handleServiceInitLifecycle,
    'gemini_client_init_start': handleServiceInitLifecycle,
    'gemini_client_genai_init_success': handleServiceInitLifecycle,
    'gemini_client_cache_manager_init_success': handleServiceInitLifecycle,
    'rate_limiter_init_success': handleServiceInitLifecycle,
    'rate_limiter_create_attempt': handleServiceInitLifecycle,
    'rate_limiter_create_success': handleServiceInitLifecycle,

    // --- Gemini Success ---
    'gemini_api_attempt_success': handleGeminiSuccess,
    'gemini_public_method_finish': handleGeminiSuccess,
    // Orchestration success events are handled by handleOrchestrationEvent
    'gemini_orchestration_primary_success': handleOrchestrationEvent,
    'gemini_orchestration_fallback_success': handleOrchestrationEvent,

    // --- Gemini Cache Specifics ---
    'cache_setup_use_success': handleGeminiCacheHit,
    'cache_context_hit_inmemory': handleGeminiCacheHit,
    'cache_model_from_cache_success': handleGeminiCacheHit,
    'gemini_call_cache_hit': handleGeminiCacheHit, // Added for completeness
    'cache_context_get_or_create_start': handleCacheContextCreateStart,
    'cache_context_create_success': handleCacheContextCreationSuccess,
    'cache_context_retrieval_success': handleCacheContextCreationSuccess,
    'cache_context_create_failed': handleCacheContextCreationFailed,
    'cache_context_create_failed_invalid_model': handleCacheContextCreationFailed,
    'cache_context_create_failed_permission': handleCacheContextCreationFailed,
    'cache_context_create_failed_invalid_response': handleCacheContextCreationFailed,
    'cache_context_setup_failed_no_manager': handleCacheContextCreationFailed,
    'cache_context_logic_unhandled_error': handleCacheContextCreationFailed,
    'gemini_call_cache_setup_failed': handleCacheContextCreationFailed,
    'gemini_call_model_from_cache_failed': handleCacheContextCreationFailed,
    'gemini_call_no_cache_available_or_setup_failed': handleCacheContextCreationFailed,
    'cache_context_get_or_create_failed': handleCacheContextCreationFailed, // Added for completeness
    'cache_context_retrieval_failed_not_found_in_manager': handleCacheContextRetrievalFailure,
    'cache_context_retrieval_failed_exception': handleCacheContextRetrievalFailure,
    'cache_context_retrieval_failed': handleCacheContextRetrievalFailure, // Added for completeness
    'retry_cache_invalidate': handleCacheContextInvalidation,
    'cache_persistent_entry_remove_start': handleCacheContextInvalidation,
    'cache_inmemory_entry_remove': handleCacheContextInvalidation,
    'cache_context_invalidate_success': handleCacheContextInvalidation, // Added for completeness
    'cache_map_load_attempt': handleCacheMapPersistence,
    'cache_map_load_success': handleCacheMapPersistence,
    'cache_map_write_attempt': handleCacheMapPersistence,
    'cache_map_write_success': handleCacheMapPersistence,
    'cache_map_write_failed': handleCacheMapPersistence,
    'cache_context_attempt_setup_for_call': handleCacheDecision,
    'gemini_call_cache_disabled': handleCacheDecision,

    // --- Gemini Call & Retry Stats ---
    'gemini_call_start': handleGeminiCallStart,
    'gemini_public_method_start': handleGeminiCallStart, // Added for completeness
    'initial_attempt_start': handleRetryAttemptStart,
    'retry_attempt_start': handleRetryAttemptStart,

    // --- Gemini Intermediate Errors & Limits ---
    'retry_wait_before_next': handleRateLimitWait,
    'retry_internal_rate_limit_wait': handleRateLimitWait,
    'rate_limiter_wait_start': handleRateLimitWait, // Added for completeness
    'json_clean_parse_failed': handleGeminiIntermediateError,
    'json_clean_structure_not_found': handleGeminiIntermediateError,
    'retry_attempt_error_cache': handleGeminiIntermediateError,
    'retry_attempt_error_429': handleGeminiIntermediateError,
    'retry_attempt_error_5xx': handleGeminiIntermediateError,
    'retry_attempt_error_unknown': handleGeminiIntermediateError,
    'retry_loop_exit_unexpected': handleGeminiIntermediateError,
    'gemini_api_generate_content_failed': handleGeminiIntermediateError,
    'json_clean_parse_failed_after_clean_for_extract': handleGeminiIntermediateError,
    'json_clean_structure_not_found_after_clean_for_extract': handleGeminiIntermediateError,
    'json_clean_parse_failed_after_clean_for_cfp': handleGeminiIntermediateError,
    'json_clean_structure_not_found_after_clean_for_cfp': handleGeminiIntermediateError,
    'json_clean_parse_failed_after_clean_for_determine': handleGeminiIntermediateError,
    'json_clean_structure_not_found_after_clean_for_determine': handleGeminiIntermediateError,
    'json_clean_final_invalid_for_extract': handleGeminiIntermediateError,
    'json_clean_final_invalid_for_cfp': handleGeminiIntermediateError,
    'json_clean_final_invalid_for_determine': handleGeminiIntermediateError,

    // --- Gemini Orchestration, Fallback, Model Prep ---
    'gemini_orchestration_primary_start': handleOrchestrationEvent,
    'gemini_orchestration_no_primary_model': handleOrchestrationEvent,
    'gemini_orchestration_primary_failed': handleOrchestrationEvent,
    'gemini_call_no_fallback_configured': handleOrchestrationEvent,
    'gemini_orchestration_fallback_start': handleOrchestrationEvent,
    'gemini_call_attempting_fallback_model': handleOrchestrationEvent, // Added for completeness
    'gemini_orchestration_no_fallback_model': handleOrchestrationEvent, // Added for completeness
    'gemini_call_primary_failed_non_5xx_checking_fallback': handleOrchestrationEvent,
    'gemini_call_5xx_switching_to_fallback': handleOrchestrationEvent,
    'model_preparation_complete': handleModelPreparation,
    'model_preparation_attempt': handleModelPreparation, // Added for completeness

    // --- Gemini Configuration & Few-Shot Prep ---
    'gemini_fewshot_allowed_but_no_config_data_for_non_tuned': handleFewShotPrep,
    'gemini_fewshot_disabled_for_non_tuned_by_config': handleFewShotPrep,
    'few_shot_prep_start': handleFewShotPrep,
    'few_shot_prep_success': handleFewShotPrep,
    'few_shot_prep_missing_or_empty_input_value': handleFewShotPrep,
    'few_shot_prep_missing_or_empty_output_value_for_input': handleFewShotPrep,
    'few_shot_prep_empty_result_after_processing': handleFewShotPrep,
    'few_shot_prep_odd_parts_count': handleFewShotPrep,
    'few_shot_prep_failed': handleFewShotPrep,

    // --- Gemini Request Payload Logging ---
    'gemini_api_request_payload_logged': handleRequestPayloadLog,
    'gemini_api_request_payload_log_failed': handleRequestPayloadLog,

    // --- Gemini Generate Content Internals ---
    'gemini_api_generate_start': handleGenerateContentInternal,
    'gemini_api_generate_success': handleGenerateContentInternal,

    // --- Gemini Response Processing ---
    'gemini_api_response_markdown_stripped': handleResponseProcessing,
    'gemini_api_response_valid_json': handleResponseProcessing,
    'gemini_api_response_invalid_json': handleResponseProcessing,
    'json_clean_success': handleResponseProcessing,
    'gemini_api_response_empty_after_processing': handleResponseProcessing,
    'gemini_api_response_trailing_comma_fixed': handleResponseProcessing,
    'response_file_write_success': handleResponseProcessing,
    'response_file_write_failed': handleResponseProcessing,
};