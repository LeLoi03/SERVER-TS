// src/utils/logAnalysis/geminiHandlers/configAndSetup.handlers.ts

/**
 * Handles events related to service initialization, configuration,
 * and other setup tasks like few-shot preparation.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../helpers';
import { ensureGeminiApiAnalysis } from './helpers';

/**
 * Handles failures during the setup, initialization, or configuration phase.
 */
export const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const errorSource = logEntry.err || logEntry.reason || logEntry.detail || logEntry;
    const event = logEntry.event;
    const defaultMessage = `Gemini setup/init/config failed (${event})`;
    const apiType = logEntry.apiType as string | undefined;
    const modelForPrep = logEntry.modelForPrep || logEntry.modelName as string | undefined;

    const tempErrorMsg = typeof errorSource === 'string' ? errorSource : (errorSource as Error)?.message || defaultMessage;
    const errorKey = normalizeErrorKey(tempErrorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    const criticalInitFailures = [
        'gemini_service_critically_uninitialized',
        'gemini_service_no_clients_initialized',
        'gemini_service_config_error',
        'gemini_key_selection_no_keys_available'
    ];

    if (criticalInitFailures.includes(event)) {
        geminiApi.failedCalls++;
    }

    const serviceInitFailureEvents = [
        'gemini_service_async_init_failed', 'gemini_service_critically_uninitialized',
        'gemini_client_init_failed', 'gemini_service_config_error',
        'gemini_service_no_clients_initialized', 'cache_map_load_failed',
    ];
    if (serviceInitFailureEvents.includes(event)) {
        geminiApi.serviceInitialization.failures++;
        if (event === 'gemini_client_init_failed') geminiApi.serviceInitialization.clientInitFailures++;
        if (event === 'gemini_service_config_error') geminiApi.serviceInitialization.noApiKeysConfigured++;
        if (event === 'gemini_service_no_clients_initialized') geminiApi.serviceInitialization.noClientsInitializedOverall++;
        if (event === 'cache_map_load_failed') {
            geminiApi.cacheMapLoadFailures++;
            geminiApi.cacheMapLoadSuccess = false;
        }
        if (['gemini_service_critically_uninitialized', 'gemini_service_no_clients_initialized', 'gemini_service_config_error'].includes(event)) {
            geminiApi.failedCalls++;
        }
    } else if (event === 'gemini_service_lazy_init_attempt') {
        geminiApi.serviceInitialization.lazyAttempts++;
    }
    else if (event === 'gemini_key_selection_unhandled_api_type') geminiApi.apiKeyManagement.unhandledApiTypeSelections++;
    else if (event === 'gemini_key_selection_no_keys_available') {
        geminiApi.apiKeyManagement.noKeysAvailableSelections++;
        geminiApi.failedCalls++;
    }
    else if (event === 'gemini_key_selection_index_out_of_bounds') geminiApi.apiKeyManagement.indexOutOfBoundsSelections++;
    else if (event === 'rate_limiter_creation_invalid_object' || event === 'rate_limiter_creation_exception') {
        geminiApi.rateLimiterSetup.creationFailures++;
    }
    else if (event === 'gemini_model_list_empty_or_missing') {
        geminiApi.configErrors.modelListMissing++;
        geminiApi.apiCallSetupFailures++;
    } else if (event === 'gemini_call_missing_apitypeconfig') {
        geminiApi.configErrors.apiTypeConfigMissing++;
        geminiApi.apiCallSetupFailures++;
    }
    else if (event === 'gemini_orchestration_primary_prep_failed') {
        geminiApi.primaryModelStats.preparationFailures++;
        geminiApi.apiCallSetupFailures++;
    } else if (event === 'gemini_orchestration_fallback_prep_failed') {
        geminiApi.fallbackModelStats.preparationFailures++;
        geminiApi.apiCallSetupFailures++;
    } else if (event === 'non_cached_setup_failed' || event === 'gemini_api_model_missing_before_generate') {
        geminiApi.modelPreparationStats.failures++;
        geminiApi.apiCallSetupFailures++;
    } else if (event === 'model_orchestration_critical_failure_final_check') {
        geminiApi.modelPreparationStats.criticalFailures++;
        geminiApi.apiCallSetupFailures++;
    }
    else if (event === 'few_shot_prep_odd_parts_count' || event === 'few_shot_prep_failed') {
        geminiApi.apiCallSetupFailures++;
    }
    else if (event === 'gemini_public_method_unhandled_error') {
        geminiApi.apiCallSetupFailures++;
    }
    else {
        geminiApi.apiCallSetupFailures++;
    }

    if (confDetail) {
        if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
        else if (apiType === 'cfp') confDetail.steps.gemini_cfp_success = false;

        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: `gemini_setup_${event}`,
                sourceService: logEntry.service || 'GeminiSetup',
                errorType: 'Configuration',
                context: {
                    phase: 'setup',
                    apiType: apiType,
                    modelIdentifier: modelForPrep
                }
            }
        );
    }
};

/**
 * Handles informational events about the service lifecycle.
 */
export const handleServiceInitLifecycle: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;

    if (event === 'gemini_service_async_init_start') geminiApi.serviceInitialization.starts++;
    else if (event === 'gemini_service_async_init_complete') geminiApi.serviceInitialization.completes++;
    else if (event === 'gemini_client_init_start') geminiApi.serviceInitialization.clientInitAttempts++;
    else if (event === 'gemini_client_genai_init_success') geminiApi.serviceInitialization.clientGenAiSuccesses++;
    else if (event === 'gemini_client_cache_manager_init_success') geminiApi.serviceInitialization.clientCacheManagerSuccesses++;
    else if (event === 'rate_limiter_create_attempt') geminiApi.rateLimiterSetup.creationAttempts++;
    else if (event === 'rate_limiter_create_success') geminiApi.rateLimiterSetup.creationSuccesses++;
};

/**
 * Handles events related to few-shot example preparation.
 */
export const handleFewShotPrep: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const prepStats = geminiApi.fewShotPreparation;
    const event = logEntry.event;

    switch (event) {
        case 'few_shot_prep_start': prepStats.attempts++; break;
        case 'few_shot_prep_success': prepStats.successes++; break;
        case 'few_shot_prep_odd_parts_count':
            prepStats.failures.oddPartsCount++;
            break;
        case 'few_shot_prep_failed':
            prepStats.failures.processingError++;
            break;
        case 'few_shot_prep_missing_or_empty_input_value': prepStats.warnings.missingInput++; break;
        case 'few_shot_prep_missing_or_empty_output_value_for_input': prepStats.warnings.missingOutput++; break;
        case 'few_shot_prep_empty_result_after_processing': prepStats.warnings.emptyResult++; break;
        case 'gemini_fewshot_allowed_but_no_config_data_for_non_tuned': prepStats.configuredButNoData++; break;
        case 'gemini_fewshot_disabled_for_non_tuned_by_config': prepStats.disabledByConfig++; break;
    }
};

/**
 * Handles events related to logging request payloads.
 */
export const handleRequestPayloadLog: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'gemini_api_request_payload_logged') {
        geminiApi.requestPayloadLogging.successes++;
    } else if (logEntry.event === 'gemini_api_request_payload_log_failed') {
        geminiApi.requestPayloadLogging.failures++;
    }
};