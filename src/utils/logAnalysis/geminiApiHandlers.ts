// src/utils/logAnalysis/geminiApiHandlers.ts

import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers'; // Giả sử có ensureConferenceDetail
import { LogError, LogAnalysisResult, OverallAnalysis, GeminiApiAnalysis, getInitialOverallAnalysis, getInitialGeminiApiAnalysis, ConferenceAnalysisDetail } from '../../types';

const ensureGeminiApiAnalysis = (results: LogAnalysisResult): GeminiApiAnalysis => {
    if (!results.geminiApi) {
        results.geminiApi = getInitialGeminiApiAnalysis();
    }
    return results.geminiApi;
};

const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall;
};

const ensureNestedObject = (obj: any, path: string[], defaultValueFactory: () => any = () => ({})): any => {
    if (!obj || typeof obj !== 'object') {
        if (path.length > 0 && path[0] === 'geminiApi' && (!obj || typeof obj !== 'object')) {
            obj = {};
        } else {
            return defaultValueFactory();
        }
    }
    let current = obj;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (i === path.length - 1) {
            if (current[key] === undefined) {
                current[key] = defaultValueFactory();
            }
        } else {
            if (current[key] === undefined || typeof current[key] !== 'object' || current[key] === null) {
                current[key] = {};
            }
        }
        current = current[key];
    }
    return current;
};

const ensureModelUsageStatsEntry = (geminiApi: GeminiApiAnalysis, apiType: string, modelIdentifier: string) => {
    return ensureNestedObject(
        geminiApi.modelUsageByApiType,
        [apiType, modelIdentifier],
        () => ({ calls: 0, retries: 0, successes: 0, failures: 0, tokens: 0, safetyBlocks: 0 })
    );
};

// Hàm này sẽ được gọi cẩn thận hơn để tránh double counting failures/successes ở mức model
const updateModelUsageStats = (
    logEntry: any,
    geminiApi: GeminiApiAnalysis,
    updateType: 'call' | 'retry' | 'success_attempt' | 'failure_attempt' // 'success_attempt' và 'failure_attempt' cho model cụ thể
) => {
    const apiType = logEntry.apiType;
    // Ưu tiên model context từ các event cấp thấp hơn nếu có
    const modelName = logEntry.modelUsed || logEntry.modelBeingRetried || logEntry.modelName || logEntry.primaryModelNameSpecified || logEntry.modelForPrep || logEntry.generationModelName;
    const crawlModel = logEntry.crawlModel || logEntry.crawlModelUsed || logEntry.initialCrawlModelType || logEntry.effectiveCrawlModelType;

    if (!apiType || !modelName || !crawlModel) {
        // console.warn("updateModelUsageStats: Missing apiType, modelName, or crawlModel", logEntry);
        return;
    }

    const modelIdentifier = `${modelName} (${crawlModel})`;
    const stats = ensureModelUsageStatsEntry(geminiApi, apiType, modelIdentifier);

    switch (updateType) {
        case 'call': // Một model cụ thể được chọn để gọi (lần đầu cho model đó trong một phase)
            stats.calls++;
            break;
        case 'retry': // Một lần retry cho model cụ thể
            stats.retries++;
            break;
        case 'success_attempt': // Một attempt của model cụ thể thành công
            stats.successes++;
            const tokenCount = logEntry.tokens || logEntry.metaData?.totalTokenCount;
            if (tokenCount) {
                stats.tokens += Number(tokenCount) || 0;
                geminiApi.totalTokens += Number(tokenCount) || 0; // Tổng token chung
            }
            break;
        case 'failure_attempt': // Một attempt của model cụ thể thất bại (sau tất cả retry của nó)
            stats.failures++;
            const errorForSafetyCheck = logEntry.finalError || logEntry.err || logEntry.reason || logEntry.msg || logEntry.errorDetails;
            const isSafetyBlockEvent = logEntry.event === 'gemini_api_response_blocked' || logEntry.event === 'retry_attempt_error_safety_blocked';
            const isSafetyBlockReason = (typeof errorForSafetyCheck === 'object' && errorForSafetyCheck !== null &&
                ((errorForSafetyCheck as any).finishReason === 'SAFETY' || (errorForSafetyCheck as any).blockReason || String(errorForSafetyCheck).toLowerCase().includes("safety")));
            if (isSafetyBlockEvent || isSafetyBlockReason) {
                stats.safetyBlocks++;
                // geminiApi.blockedBySafety sẽ được tăng bởi handler của event safety block cụ thể
            }
            break;
    }
};

// --- Main Handlers ---

/**
 * Xử lý các lỗi cuối cùng của một "API call operation".
 */
export const handleGeminiFinalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const errorSource = logEntry.finalError || logEntry.err || logEntry.errorDetails || logEntry;
    const event = logEntry.event;
    const defaultMessage = `Gemini API call failed (${event})`;
    const apiType = logEntry.apiType as string | undefined;
    const modelUsed = logEntry.modelUsed || logEntry.modelName || logEntry.modelBeingRetried as string | undefined;
    const crawlModel = logEntry.crawlModel || logEntry.crawlModelUsed as string | undefined;
    const modelIdentifier = modelUsed && crawlModel ? `${modelUsed} (${crawlModel})` : undefined;

    // Thêm lỗi vào aggregated errors
    const tempErrorMsg = typeof errorSource === 'string' ? errorSource : (errorSource as Error)?.message || defaultMessage;
    const errorKey = normalizeErrorKey(tempErrorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;


    const isOverallOperationFailureEvent = [
        'gemini_call_failed_no_more_options',
        'gemini_call_5xx_no_more_fallback_options',
        'gemini_call_unexpected_exit_after_attempts',
    ].includes(event);

    if (isOverallOperationFailureEvent) {
        geminiApi.failedCalls++; // KEY EVENT for failedCalls
    }

    const isSafetyBlockReason = (typeof errorSource === 'object' && errorSource !== null &&
        ((errorSource as any).finishReason === 'SAFETY' || (errorSource as any).blockReason || String(errorSource).toLowerCase().includes("safety")));
    const isSafetyBlockEvent = event === 'gemini_api_response_blocked' ||
        event === 'retry_attempt_error_safety_blocked' ||
        event === 'gemini_api_response_blocked_missing_body';

    if (isSafetyBlockEvent || isSafetyBlockReason) {
        geminiApi.blockedBySafety++;
    }

    // Cập nhật thất bại cho model cụ thể đã gây ra lỗi cuối cùng này
    if (modelIdentifier) {
        updateModelUsageStats(logEntry, geminiApi, 'failure_attempt');
    }

    if (confDetail) {
        if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
        else if (apiType === 'cfp') confDetail.steps.gemini_cfp_success = false;

        // Không đặt confDetail.status = 'failed' ở đây.
        // handleTaskFinish sẽ quyết định status cuối cùng dựa trên các steps và errors.
        // Chỉ thêm lỗi vào confDetail.errors.
        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                errorCode: (errorSource as any)?.code || (logEntry.finalError as any)?.name, // Lấy code nếu có
                keyPrefix: `gemini_final_${apiType || 'unknown'}`,
                sourceService: 'GeminiApiOrchestratorService', // Hoặc RetryHandler tùy event
                errorType: isSafetyBlockEvent || isSafetyBlockReason ? 'SafetyBlock' : 'ThirdPartyAPI',
                context: {
                    phase: logEntry.phase || 'api_call',
                    modelIdentifier: modelIdentifier,
                    apiType: apiType
                }
            }
        );
        // confDetail.endTime sẽ được đặt bởi handleTaskFinish hoặc handleTaskUnhandledError
    }
};


/**
 * Xử lý các lỗi liên quan đến setup, init, config.
 */
export const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const errorSource = logEntry.err || logEntry.reason || logEntry.detail || logEntry;
    const event = logEntry.event;
    const defaultMessage = `Gemini setup/init/config failed (${event})`;
    const apiType = logEntry.apiType as string | undefined;
    const modelForPrep = logEntry.modelForPrep || logEntry.modelName as string | undefined;

    // Thêm lỗi vào aggregated errors
    const tempErrorMsg = typeof errorSource === 'string' ? errorSource : (errorSource as Error)?.message || defaultMessage;
    const errorKey = normalizeErrorKey(tempErrorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;


    const criticalInitFailures = [
        'gemini_service_critically_uninitialized',
        'gemini_service_no_clients_initialized',
        'gemini_service_config_error', // No API keys
        'gemini_key_selection_no_keys_available' // No key for a call
    ];

    if (criticalInitFailures.includes(event)) {
        geminiApi.failedCalls++; // Coi như toàn bộ operation thất bại
    }

    // Lỗi Service Initialization
    const serviceInitFailureEvents = [
        'gemini_service_async_init_failed', 'gemini_service_critically_uninitialized',
        'gemini_client_init_failed', // Event này nên được log bởi ClientManager khi một key cụ thể init thất bại
        'gemini_service_config_error', // No API keys
        'gemini_service_no_clients_initialized', // All clients failed to init
        'cache_map_load_failed',
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
        // Nếu lỗi init service nghiêm trọng, có thể coi là failedCall
        if (['gemini_service_critically_uninitialized', 'gemini_service_no_clients_initialized', 'gemini_service_config_error'].includes(event)) {
            geminiApi.failedCalls++; // Coi như toàn bộ operation thất bại
        }
    } else if (event === 'gemini_service_lazy_init_attempt') {
        geminiApi.serviceInitialization.lazyAttempts++;
    }

    // Lỗi API Key Management
    else if (event === 'gemini_key_selection_unhandled_api_type') geminiApi.apiKeyManagement.unhandledApiTypeSelections++;
    else if (event === 'gemini_key_selection_no_keys_available') {
        geminiApi.apiKeyManagement.noKeysAvailableSelections++;
        geminiApi.failedCalls++; // Không có key để gọi -> failedCall
    }
    else if (event === 'gemini_key_selection_index_out_of_bounds') geminiApi.apiKeyManagement.indexOutOfBoundsSelections++;

    // Lỗi Rate Limiter Setup
    else if (event === 'rate_limiter_creation_invalid_object' || event === 'rate_limiter_creation_exception') {
        geminiApi.rateLimiterSetup.creationFailures++;
    }

    // Lỗi Config Model/API Type
    else if (event === 'gemini_model_list_empty_or_missing') {
        geminiApi.configErrors.modelListMissing++;
        geminiApi.apiCallSetupFailures++;
        // Nếu lỗi này xảy ra trong một public method, nó sẽ dẫn đến failedCall cho method đó
        // GeminiApiService nên log một event final failure nếu điều này xảy ra.
        // Hoặc, nếu nó được bắt và log bởi Orchestrator là không thể tiến hành, thì Orchestrator log final failure.
    } else if (event === 'gemini_call_missing_apitypeconfig') {
        geminiApi.configErrors.apiTypeConfigMissing++;
        geminiApi.apiCallSetupFailures++;
    }

    // Lỗi Model Preparation (từ ModelOrchestrator hoặc ApiOrchestrator khi gọi prepareForApiCall)
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

    // Lỗi Few-Shot Prep (đã được xử lý riêng trong handleFewShotPrep, nhưng nếu nó là setup failure thì cũng tính)
    else if (event === 'few_shot_prep_odd_parts_count' || event === 'few_shot_prep_failed') {
        geminiApi.apiCallSetupFailures++; // handleFewShotPrep sẽ cập nhật chi tiết
    }

    // Lỗi chung không xác định trong public method (coi là setup/logic failure của method đó)
    else if (event === 'gemini_public_method_unhandled_error') {
        geminiApi.apiCallSetupFailures++;
        // `failedCalls` sẽ được tăng bởi event `gemini_call_failed_no_more_options` nếu Orchestrator log nó
    }
    else {
        geminiApi.apiCallSetupFailures++; // Bộ đếm chung cho các lỗi setup khác
    }

    // Không gọi updateModelUsageStats(..., 'failure_attempt') ở đây trừ khi lỗi setup này
    // trực tiếp gắn với một model cụ thể và ngăn nó được gọi.
    // Ví dụ: 'gemini_orchestration_primary_prep_failed' đã tăng preparationFailures cho primary.

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
                errorType: 'Configuration', // Hoặc 'Logic' tùy event
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
 * Xử lý các event thông tin về lifecycle của service.
 */
export const handleServiceInitLifecycle: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
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
 * Xử lý các event báo hiệu thành công của một "API call operation" hoặc một attempt.
 * `geminiApi.successfulCalls` chỉ được tăng bởi event chủ đạo.
 */

/**
 * Xử lý các event báo hiệu thành công của một "API call operation" hoặc một attempt.
 */
export const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const geminiApi = ensureGeminiApiAnalysis(results);

    // KEY EVENT for geminiApi.successfulCalls
    if (logEntry.event === 'gemini_public_method_finish') {
        geminiApi.successfulCalls++;
        geminiApi.responseProcessingStats.publicMethodFinishes++;

        if (confDetail && logEntry.isFallbackSuccess === true) {
            confDetail.errors.forEach((err: LogError) => {
                if ((err.context?.phase === 'primary_execution' || err.context?.phase === 'sdk_call') && !err.isRecovered) {
                    // Chỉ đánh dấu isRecovered nếu lỗi đó thực sự là của primary model attempt
                    // và không phải là lỗi setup chung chung.
                    // Có thể cần kiểm tra thêm err.key hoặc err.sourceService
                    err.isRecovered = true;
                }
            });
        }
    }

    if (logEntry.event === 'gemini_api_attempt_success') {
        updateModelUsageStats(logEntry, geminiApi, 'success_attempt');
    }

    // Cập nhật confDetail.steps
    // Điều này nên xảy ra cho cả gemini_public_method_finish (kết quả cuối cùng)
    // và gemini_api_attempt_success (kết quả của một attempt, có thể là primary hoặc fallback)
    // để đảm bảo step được đánh dấu success ngay khi có attempt thành công.
    if (confDetail && (logEntry.event === 'gemini_public_method_finish' || logEntry.event === 'gemini_api_attempt_success')) {
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? logEntry.usingCacheActual ?? false;
        // modelUsed sẽ cho biết model nào đã thành công (primary hay fallback)
        // const modelSuccessfullyUsed = logEntry.modelUsed;

        if (apiType === 'determine') {
            if (confDetail.steps.gemini_determine_success !== true) confDetail.steps.gemini_determine_success = true;
            if (confDetail.steps.gemini_determine_cache_used === null && usingCache !== undefined) confDetail.steps.gemini_determine_cache_used = usingCache;
        } else if (apiType === 'extract') {
            if (confDetail.steps.gemini_extract_success !== true) {
                confDetail.steps.gemini_extract_success = true;
                overall.successfulExtractions = (overall.successfulExtractions || 0) + 1;
            }
            if (confDetail.steps.gemini_extract_cache_used === null && usingCache !== undefined) confDetail.steps.gemini_extract_cache_used = usingCache;
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) {
            if (confDetail.steps.gemini_cfp_success !== true) confDetail.steps.gemini_cfp_success = true;
            if (confDetail.steps.gemini_cfp_cache_used === null && usingCache !== undefined) confDetail.steps.gemini_cfp_cache_used = usingCache;
        }
    }
};


// --- Cache Handlers ---
export const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextHits++; // Cache được sử dụng thành công

    if (confDetail) {
        // ... (cập nhật confDetail.steps.xxx_cache_used = true)
        const apiType = logEntry.apiType;
        if (apiType === 'determine') confDetail.steps.gemini_determine_cache_used = true;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_cache_used = true;
        else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_cache_used')) {
            confDetail.steps.gemini_cfp_cache_used = true;
        }
    }
};

export const handleCacheContextCreateStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextAttempts++; // Thử get hoặc create
};

export const handleCacheContextCreationSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'cache_context_create_success') { // Cache mới được tạo
        geminiApi.cacheContextCreationSuccess++;
    } else if (logEntry.event === 'cache_context_retrieval_success') { // Cache đã tồn tại và được lấy thành công
        geminiApi.cacheContextRetrievalSuccess++;
    }
};

export const handleCacheContextCreationFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextCreationFailed++; // Thất bại trong getOrCreateContext
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context operation failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as any)?.message || `Cache context operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;

    if (logEntry.event === 'gemini_call_cache_setup_failed' || logEntry.event === 'gemini_call_model_from_cache_failed' || logEntry.event === 'gemini_call_no_cache_available_or_setup_failed') {
        geminiApi.apiCallSetupFailures++; // Lỗi setup cache cho một call cụ thể
    }
};

export const handleCacheContextInvalidation: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextInvalidations++;
};

export const handleCacheContextRetrievalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextRetrievalFailures++; // Thất bại khi cố gắng lấy cache đã tồn tại bằng manager.get()
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context retrieval failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as any)?.message || `Cache context retrieval failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
};

export const handleCacheMapPersistence: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;
    if (event === 'cache_map_load_attempt') geminiApi.cacheMapLoadAttempts++;
    else if (event === 'cache_map_load_success') {
        geminiApi.cacheMapLoadSuccess = true;
        if (geminiApi.cacheMapLoadAttempts === 0) geminiApi.cacheMapLoadAttempts = 1; // Đảm bảo attempt được đếm
    }
    // cache_map_load_failed đã được xử lý trong handleGeminiSetupFailure
    else if (event === 'cache_map_write_attempt') geminiApi.cacheMapWriteAttempts++;
    else if (event === 'cache_map_write_success') {
        geminiApi.cacheMapWriteSuccessCount++;
        if (geminiApi.cacheMapWriteAttempts === 0) geminiApi.cacheMapWriteAttempts = 1;
    } else if (event === 'cache_map_write_failed') {
        geminiApi.cacheMapWriteFailures++;
        geminiApi.errorsByType['cache_map_write_failed'] = (geminiApi.errorsByType['cache_map_write_failed'] || 0) + 1;
        if (geminiApi.cacheMapWriteAttempts === 0) geminiApi.cacheMapWriteAttempts = 1;
    }
};

export const handleCacheDecision: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'cache_context_attempt_setup_for_call') { // shouldUseCache = true
        geminiApi.cacheDecisionStats.cacheUsageAttempts++;
    } else if (logEntry.event === 'gemini_call_cache_disabled') { // shouldUseCache = false
        geminiApi.cacheDecisionStats.cacheExplicitlyDisabled++;
    }
};


// --- Call Lifecycle & Retry Stats ---
/**
 * Xử lý khi một "API call operation" (ví dụ: extractInformation) bắt đầu.
 * Đây là nơi `geminiApi.totalCalls` (tổng số operation) được tăng.
 */
export const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.totalCalls++;
    const apiType = logEntry.apiType;
    if (apiType) {
        geminiApi.callsByType[apiType] = (geminiApi.callsByType[apiType] || 0) + 1;
    }
    // callsByModel sẽ được cập nhật bởi updateModelUsageStats khi model thực sự được gọi

    // Không gọi updateModelUsageStats ở đây cho primary model,
    // nó sẽ được gọi bởi handleOrchestrationEvent khi 'gemini_orchestration_primary_start'

    if (confDetail) {
        // ... (cập nhật confDetail.steps.xxx_attempted = true)
        if (apiType === 'determine') confDetail.steps.gemini_determine_attempted = true;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_attempted = true;
        else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_attempted')) {
            confDetail.steps.gemini_cfp_attempted = true;
        }
    }
};

/**
 * Xử lý các attempt trong vòng lặp retry.
 */
export const handleRetryAttemptStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);

    // `initial_attempt_start` là lần thử đầu tiên cho một model (primary hoặc fallback)
    // `retry_attempt_start` là các lần thử > 1
    if (logEntry.event === 'retry_attempt_start' && logEntry.attempt > 1) {
        geminiApi.totalRetries++;
        const apiType = logEntry.apiType;
        const modelName = logEntry.modelName || logEntry.modelBeingRetried; // modelBeingRetried từ RetryHandler

        if (apiType) geminiApi.retriesByType[apiType] = (geminiApi.retriesByType[apiType] || 0) + 1;
        if (modelName) geminiApi.retriesByModel[modelName] = (geminiApi.retriesByModel[modelName] || 0) + 1;

        // Cập nhật số lần retry cho model cụ thể trong modelUsageByApiType
        updateModelUsageStats(logEntry, geminiApi, 'retry');
    }
};

// --- Intermediate States & Errors ---
export const handleRateLimitWait: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.rateLimitWaits++;
};

export const handleGeminiIntermediateError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.intermediateErrors++;
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = `Gemini intermediate error (${logEntry.event})`;
    const tempErrorMsg = typeof errorSource === 'string' ? errorSource : (errorSource as Error)?.message || defaultMessage;
    const errorKey = normalizeErrorKey(tempErrorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;

    if (logEntry.event === 'json_clean_parse_failed' || logEntry.event === 'json_clean_structure_not_found') {
        geminiApi.responseProcessingStats.jsonValidationFailedInternal++;
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, errorSource, {
                defaultMessage,
                keyPrefix: 'gemini_intermediate_json',
                sourceService: 'GeminiApiService', // Hoặc ResponseHandler
                errorType: 'DataParsing',
                context: { phase: 'response_processing', apiType: logEntry.apiType, modelIdentifier: logEntry.modelUsed }
            });
        }
    } else if (confDetail && logEntry.event === 'gemini_api_generate_content_failed') {
        addConferenceError(confDetail, entryTimestampISO, errorSource, {
            defaultMessage,
            keyPrefix: 'gemini_intermediate_sdk',
            sourceService: 'GeminiSdkExecutorService',
            errorType: 'ThirdPartyAPI',
            context: { phase: 'sdk_call', apiType: logEntry.apiType, modelIdentifier: logEntry.modelUsed }
        });
    }
};

// --- Orchestration, Fallback, Model Prep ---
/**
 * Xử lý các event liên quan đến luồng điều phối primary/fallback.
 * Đây là nơi cập nhật `primaryModelStats` và `fallbackModelStats`.
 */
export const handleOrchestrationEvent: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;
    const apiType = logEntry.apiType;

    // Lấy model identifiers một cách an toàn
    const primaryModelNameFromLog = logEntry.primaryModelNameSpecified || logEntry.modelName || logEntry.modelUsed;
    const initialCrawlModelFromLog = logEntry.initialCrawlModelType || logEntry.crawlModel;
    const primaryModelId = primaryModelNameFromLog && initialCrawlModelFromLog
        ? `${primaryModelNameFromLog} (${initialCrawlModelFromLog})`
        : undefined;

    const fallbackModelNameFromLog = logEntry.fallbackModelNameSpecified || logEntry.modelName || logEntry.modelUsed;
    const fallbackCrawlModelFromLog = logEntry.fallbackEffectiveCrawlModelType || logEntry.crawlModel;
    const fallbackModelId = fallbackModelNameFromLog && fallbackCrawlModelFromLog
        ? `${fallbackModelNameFromLog} (${fallbackCrawlModelFromLog})`
        : undefined;


    if (event === 'gemini_orchestration_primary_start') {
        geminiApi.primaryModelStats.attempts++;
        // logEntry cho updateModelUsageStats cần modelName và crawlModel của primary
        const primaryCallLogEntry = {
            ...logEntry,
            modelName: primaryModelNameFromLog, // Đảm bảo modelName là của primary
            crawlModel: initialCrawlModelFromLog // Đảm bảo crawlModel là của primary
        };
        updateModelUsageStats(primaryCallLogEntry, geminiApi, 'call');
    } else if (event === 'gemini_orchestration_no_primary_model') {
        geminiApi.primaryModelStats.skippedOrNotConfigured++;
    } else if (event === 'gemini_orchestration_primary_success') {
        geminiApi.primaryModelStats.successes++;
        // updateModelUsageStats(..., 'success_attempt') cho primary đã được gọi bởi handleGeminiSuccess
        // từ event 'gemini_api_attempt_success' của SdkExecutor.
    } else if (event === 'gemini_orchestration_primary_failed') {
        geminiApi.primaryModelStats.failures++;
        // Không cần tăng fallbackLogic.primaryModelFailuresLeadingToFallback nữa.
        // Việc này được ngầm hiểu khi fallbackModelStats.attempts > 0.
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.errorDetails || "Primary model execution failed", {
                defaultMessage: "Primary model execution failed",
                keyPrefix: "gemini_primary_exec",
                sourceService: "GeminiApiOrchestratorService",
                errorType: (logEntry.errorDetails as any)?.errorType || "ThirdPartyAPI", // Lấy errorType từ errorDetails nếu có
                context: { phase: 'primary_execution', modelIdentifier: primaryModelId, apiType }
            });
        }
        // updateModelUsageStats(..., 'failure_attempt') cho primary sẽ được gọi bởi handleGeminiFinalFailure
        // nếu đây là lỗi cuối cùng của primary model (ví dụ, không có fallback hoặc fallback cũng thất bại).
    }
    // Các event 'gemini_orchestration_primary_prep_failed' và 'gemini_orchestration_fallback_prep_failed'
    // đã được xử lý trong handleGeminiSetupFailure, nơi chúng tăng
    // primaryModelStats.preparationFailures hoặc fallbackModelStats.preparationFailures.

    else if (event === 'gemini_orchestration_fallback_start' || event === 'gemini_call_attempting_fallback_model') {
        geminiApi.fallbackModelStats.attempts++;
        // Không cần tăng fallbackLogic.attemptsWithFallbackModel nữa.
        const fallbackCallLogEntry = {
            ...logEntry,
            modelName: fallbackModelNameFromLog, // Đảm bảo modelName là của fallback
            crawlModel: fallbackCrawlModelFromLog // Đảm bảo crawlModel là của fallback
        };
        updateModelUsageStats(fallbackCallLogEntry, geminiApi, 'call');
    } else if (event === 'gemini_orchestration_no_fallback_model' || event === 'gemini_call_no_fallback_configured') {
        geminiApi.fallbackModelStats.notConfiguredWhenNeeded++;
        // Không cần tăng fallbackLogic.noFallbackConfigured nữa.
    } else if (event === 'gemini_orchestration_fallback_success') {
        geminiApi.fallbackModelStats.successes++;
        // Không cần tăng fallbackLogic.successWithFallbackModel nữa.
    } else if (event === 'gemini_orchestration_fallback_failed_after_retries') {
        geminiApi.fallbackModelStats.failures++;
        // Không cần tăng fallbackLogic.failedAfterFallbackAttempts nữa.
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.errorDetails || "Fallback model execution failed after retries", {
                defaultMessage: "Fallback model execution failed after retries",
                keyPrefix: "gemini_fallback_exec",
                sourceService: "GeminiApiOrchestratorService",
                errorType: (logEntry.errorDetails as any)?.errorType || "ThirdPartyAPI",
                context: { phase: 'fallback_execution', modelIdentifier: fallbackModelId, apiType }
            });
        }
        // updateModelUsageStats(..., 'failure_attempt') cho fallback sẽ được gọi bởi handleGeminiFinalFailure.
    }
    // Các event 'gemini_call_primary_failed_non_5xx_checking_fallback' và 'gemini_call_5xx_switching_to_fallback'
    // là các event thông tin, không cần tăng bộ đếm nào ở đây nữa vì primaryModelStats.failures đã được ghi nhận.
    // Chúng chỉ ra quyết định logic chuyển sang fallback.
    // else if (event === 'gemini_call_primary_failed_non_5xx_checking_fallback' || event === 'gemini_call_5xx_switching_to_fallback') {
    //     // Không cần tăng fallbackLogic.primaryModelFailuresLeadingToFallback++;
    // }
};

/**
 * Xử lý các event liên quan đến việc chuẩn bị model từ ModelOrchestrator.
 */
export const handleModelPreparation: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;
    if (event === 'model_preparation_attempt') { // Giả sử có event này
        geminiApi.modelPreparationStats.attempts++;
    } else if (event === 'model_preparation_complete') {
        geminiApi.modelPreparationStats.successes++;
        if (!logEntry.isAttemptAlreadyCounted) { // Cần cờ này từ service nếu không có event attempt riêng
            geminiApi.modelPreparationStats.attempts++;
        }
    }
    // Lỗi đã được handle bởi handleGeminiSetupFailure
};

// --- Configuration & Few-Shot Prep ---
export const handleFewShotPrep: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const prepStats = geminiApi.fewShotPreparation;
    const event = logEntry.event;

    switch (event) {
        case 'few_shot_prep_start': prepStats.attempts++; break;
        case 'few_shot_prep_success': prepStats.successes++; break;
        case 'few_shot_prep_odd_parts_count':
            prepStats.failures.oddPartsCount++;
            // Lỗi này cũng là một setup failure, đã được map vào handleGeminiSetupFailure
            break;
        case 'few_shot_prep_failed':
            prepStats.failures.processingError++;
            // Lỗi này cũng là một setup failure, đã được map vào handleGeminiSetupFailure
            break;
        case 'few_shot_prep_missing_or_empty_input_value': prepStats.warnings.missingInput++; break;
        case 'few_shot_prep_missing_or_empty_output_value_for_input': prepStats.warnings.missingOutput++; break;
        case 'few_shot_prep_empty_result_after_processing': prepStats.warnings.emptyResult++; break;
        case 'gemini_fewshot_allowed_but_no_config_data_for_non_tuned': prepStats.configuredButNoData++; break;
        case 'gemini_fewshot_disabled_for_non_tuned_by_config': prepStats.disabledByConfig++; break;
    }
};

// --- Request Payload Logging ---
export const handleRequestPayloadLog: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'gemini_api_request_payload_logged') {
        geminiApi.requestPayloadLogging.successes++;
    } else if (logEntry.event === 'gemini_api_request_payload_log_failed') {
        geminiApi.requestPayloadLogging.failures++;
    }
};

// --- Generate Content Internals (model.generateContent() lifecycle) ---
export const handleGenerateContentInternal: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'gemini_api_generate_start') {
        geminiApi.generateContentInternal.attempts++;
    } else if (logEntry.event === 'gemini_api_generate_success') {
        geminiApi.generateContentInternal.successes++;
    }
    // gemini_api_generate_content_failed được xử lý bởi handleGeminiIntermediateError
};

// --- Response Processing ---
export const handleResponseProcessing: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const stats = geminiApi.responseProcessingStats;
    const event = logEntry.event;


    if (event === 'gemini_api_response_markdown_stripped') stats.markdownStripped++;
    else if (event === 'gemini_api_response_valid_json') stats.jsonValidationsSucceededInternal++;
    else if (event === 'gemini_api_response_invalid_json') {
        stats.jsonValidationFailedInternal++;
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.err || "Invalid JSON response from Gemini", {
                defaultMessage: "Invalid JSON response from Gemini",
                keyPrefix: "gemini_response_invalid_json",
                sourceService: "GeminiResponseHandlerService",
                errorType: "DataParsing",
                context: { phase: 'response_processing', apiType: logEntry.apiType, modelIdentifier: logEntry.modelUsed }
            });
        }
    }
    else if (event === 'json_clean_success') stats.jsonCleaningSuccessesPublic++;
    else if (event === 'gemini_api_response_empty_after_processing') stats.emptyAfterProcessingInternal++;
    else if (event === 'gemini_api_response_trailing_comma_fixed') stats.trailingCommasFixed++;
    else if (event === 'gemini_api_response_blocked' || event === 'gemini_api_response_blocked_missing_body') {
        stats.blockedBySafetyInResponseHandler++;
        // Lỗi này cũng sẽ được handleGeminiFinalFailure xử lý cho bộ đếm tổng thể
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.blockReason || "Response blocked by safety settings", {
                defaultMessage: "Response blocked by safety settings",
                keyPrefix: "gemini_response_safety_block",
                sourceService: "GeminiResponseHandlerService",
                errorType: "SafetyBlock",
                context: { phase: 'response_processing', apiType: logEntry.apiType, modelIdentifier: logEntry.modelUsed }
            });
        }
    }
    else if (event === 'response_file_write_success') stats.responseFileWrites++;
    else if (event === 'response_file_write_failed') {
        stats.responseFileWriteFailures++;
        geminiApi.errorsByType['response_file_write_failed'] = (geminiApi.errorsByType['response_file_write_failed'] || 0) + 1;
        if (confDetail) {
            addConferenceError(confDetail, entryTimestampISO, logEntry.err || "Failed to write response to file", {
                defaultMessage: "Failed to write response to file",
                keyPrefix: "gemini_response_file_write",
                sourceService: "GeminiResponseHandlerService", // Hoặc SdkExecutor
                errorType: "FileSystem",
                context: { phase: 'response_processing' }
            });
        }
    }
};