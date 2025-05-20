// src/utils/logAnalysis/geminiApiHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { OverallAnalysis } from '../../types/logAnalysis.types'; // Đảm bảo đường dẫn đúng

const ensureOverallAnalysis = (results: any): OverallAnalysis => {
    if (!results.overall) {
        results.overall = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            totalConferencesInput: 0,
            processedConferencesCount: 0,
            completedTasks: 0,
            failedOrCrashedTasks: 0,
            processingTasks: 0,
            skippedTasks: 0,
            successfulExtractions: 0,
        };
    }
    return results.overall as OverallAnalysis;
};

// --- Final Failures ---
// Events: 'retry_failed_max_retries', 'retry_abort_non_retryable', 'gemini_api_response_blocked', 'retry_attempt_error_safety_blocked'
export const handleGeminiFinalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const error = logEntry.finalError || logEntry.err || logEntry.reason || logEntry.msg || `Unknown final failure`;
    const event = logEntry.event;
    const failureMsg = typeof error === 'string' ? error : (error as Error)?.message || `Gemini API call failed (${event})`;
    const errorKey = normalizeErrorKey(failureMsg);

    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    results.geminiApi.failedCalls++;

    const isSafetyBlock = event === 'gemini_api_response_blocked' ||
                          event === 'retry_attempt_error_safety_blocked' ||
                          (typeof error === 'object' && (error as any)?.finishReason === 'SAFETY') ||
                          (typeof error === 'object' && (error as any)?.blockReason); // blockReason cũng có thể từ promptFeedback

    if (isSafetyBlock) {
        results.geminiApi.blockedBySafety++;
    }

    if (confDetail) {
        const apiTypeFromLog = logEntry.apiType; // Ưu tiên lấy từ logEntry trực tiếp
        if (apiTypeFromLog === 'determine') confDetail.steps.gemini_determine_success = false;
        else if (apiTypeFromLog === 'extract') confDetail.steps.gemini_extract_success = false;
        else if (apiTypeFromLog === 'cfp') confDetail.steps.gemini_cfp_success = false;

        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, failureMsg, errorKey); // Truyền failureMsg đã chuẩn hóa
    }
};

// --- Setup & Critical Initialization Failures ---
// Events:
// 'gemini_service_genai_init_failed', 'gemini_service_not_initialized', 'gemini_service_genai_not_ready',
// 'gemini_call_limiter_init_failed', 'gemini_call_missing_apiconfig', 'gemini_call_missing_model_config',
// 'gemini_api_model_missing_before_generate', 'non_cached_setup_failed', 'gemini_public_method_unhandled_error',
// 'gemini_call_model_prep_orchestration_failed', 'model_orchestration_critical_failure',
// 'gemini_client_manager_no_genai_instance', 'gemini_client_manager_no_cache_manager_instance',
// 'cache_manager_create_failed', 'cache_manager_init_failed_no_apikey', 'cache_manager_init_skipped_no_genai',
// 'cache_map_load_failed' (được coi là lỗi init nghiêm trọng)
export const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const error = logEntry.err || logEntry.reason || logEntry.detail || logEntry.msg || `Gemini setup/init failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Gemini setup/init failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);

    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    const event = logEntry.event;
    const serviceInitFailureEvents = [
        'gemini_service_genai_init_failed', 'gemini_service_not_initialized', 'gemini_service_genai_not_ready',
        'gemini_client_manager_no_genai_instance', 'cache_manager_create_failed',
        'cache_manager_init_failed_no_apikey', 'cache_manager_init_skipped_no_genai',
        'cache_map_load_failed'
    ];

    if (serviceInitFailureEvents.includes(event)) {
        results.geminiApi.serviceInitializationFailures = (results.geminiApi.serviceInitializationFailures || 0) + 1;
    } else {
        // Các lỗi setup khác liên quan đến chuẩn bị cho một cuộc gọi API cụ thể hoặc lỗi public method
        results.geminiApi.apiCallSetupFailures = (results.geminiApi.apiCallSetupFailures || 0) + 1;
    }

    results.geminiApi.failedCalls++; // Lỗi setup nghiêm trọng cũng tính là failed call

    if (confDetail) {
        const apiTypeFromLog = logEntry.apiType;
        if (apiTypeFromLog === 'determine') confDetail.steps.gemini_determine_success = false;
        else if (apiTypeFromLog === 'extract') confDetail.steps.gemini_extract_success = false;
        else if (apiTypeFromLog === 'cfp') confDetail.steps.gemini_cfp_success = false;

        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, errorMsg, errorKey);
    }
};

// --- Successful API Call ---
// Event: 'gemini_api_attempt_success'
export const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overallStats = ensureOverallAnalysis(results);
    results.geminiApi.successfulCalls++;

    // 'tokens' là key bạn dùng trong log, có thể là logEntry.tokens hoặc logEntry.metaData.totalTokenCount
    const tokenCount = logEntry.tokens || logEntry.metaData?.totalTokenCount;
    if (tokenCount) {
        results.geminiApi.totalTokens += Number(tokenCount) || 0;
    }

    if (confDetail) {
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? false; // usingCache nên có trong 'gemini_api_attempt_success'

        if (apiType === 'determine') {
            if (confDetail.steps.gemini_determine_success !== false) {
                confDetail.steps.gemini_determine_success = true;
            }
            // Cache status được set bởi handleGeminiCacheHit hoặc ở đây nếu cache không được dùng
            if (confDetail.steps.gemini_determine_cache_used === null) {
                confDetail.steps.gemini_determine_cache_used = usingCache;
            }
        } else if (apiType === 'extract') {
            if (confDetail.steps.gemini_extract_success !== false) {
                confDetail.steps.gemini_extract_success = true;
                overallStats.successfulExtractions = (overallStats.successfulExtractions || 0) + 1;
            }
            if (confDetail.steps.gemini_extract_cache_used === null) {
                confDetail.steps.gemini_extract_cache_used = usingCache;
            }
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) {
            if (confDetail.steps.gemini_cfp_success !== false) {
                confDetail.steps.gemini_cfp_success = true;
            }
            if (confDetail.steps.gemini_cfp_cache_used === null) {
                confDetail.steps.gemini_cfp_cache_used = usingCache;
            }
        }
    }
};

// --- Cache Specific Handlers ---
// Event: 'cache_setup_use_success', 'cache_context_hit_inmemory'
export const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheContextHits = (results.geminiApi.cacheContextHits || 0) + 1;

    if (confDetail) {
        // 'apiType' nên có trong context của các event này
        const apiType = logEntry.apiType;
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_cache_used = true;
        } else if (apiType === 'extract') {
            confDetail.steps.gemini_extract_cache_used = true;
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_cache_used')) {
            confDetail.steps.gemini_cfp_cache_used = true;
        }
    }
};

// Event: 'cache_context_get_or_create_start', ('cache_context_create_attempt' nếu vẫn dùng)
export const handleCacheContextCreateStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheContextAttempts = (results.geminiApi.cacheContextAttempts || 0) + 1;
};

// Event: 'cache_context_create_success', 'cache_context_retrieval_success'
export const handleCacheContextCreationSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheContextCreationSuccess = (results.geminiApi.cacheContextCreationSuccess || 0) + 1;
};

// Events:
// 'cache_context_create_failed', 'cache_context_create_failed_invalid_model',
// 'cache_context_create_failed_permission', 'cache_context_create_failed_invalid_response',
// 'cache_context_setup_failed_no_manager', 'cache_context_logic_unhandled_error',
// 'gemini_call_cache_setup_failed', 'gemini_call_model_from_cache_failed'
export const handleCacheContextCreationFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheContextCreationFailed = (results.geminiApi.cacheContextCreationFailed || 0) + 1;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context operation failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Cache context operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
};

// Events: 'retry_cache_invalidate', 'cache_persistent_entry_remove_start', 'cache_inmemory_entry_remove'
export const handleCacheContextInvalidation: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheContextInvalidations = (results.geminiApi.cacheContextInvalidations || 0) + 1;
};

// Events: 'cache_context_retrieval_failed_not_found_in_manager', 'cache_context_retrieval_failed_exception'
export const handleCacheContextRetrievalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheContextRetrievalFailures = (results.geminiApi.cacheContextRetrievalFailures || 0) + 1;
    // Khi không lấy được cache từ manager (dù có tên trong map), có thể coi đây là một dạng invalidation
    // hoặc một dạng creation failed (vì phải tạo mới). Tùy theo cách bạn muốn phân tích.
    // Giả sử nó dẫn đến việc phải tạo cache mới, có thể tăng counter creation failed hoặc một counter riêng.
    // Hoặc nếu nó chỉ đơn giản là "không tìm thấy" và không thử tạo lại, thì là retrieval failure.
    // Dựa theo logic getOrCreateContextCache, nếu retrieval fail, nó sẽ cố gắng tạo mới.
    // Nên có thể không cần tăng cacheContextInvalidations ở đây, mà để handleCacheContextCreationFailed xử lý nếu tạo mới thất bại.
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context retrieval failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Cache context retrieval failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
};

// Event: 'cache_map_load_failed'
export const handleCacheMapLoadFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheMapLoadFailures = (results.geminiApi.cacheMapLoadFailures || 0) + 1;
    if (results.geminiApi.hasOwnProperty('cacheMapLoadSuccess')) { // Kiểm tra xem key có tồn tại không
        results.geminiApi.cacheMapLoadSuccess = false; // Ghi nhận trạng thái load thất bại
    }
    // Lỗi này được coi là serviceInitializationFailure trong handleGeminiSetupFailure
};

// Event: 'cache_map_write_success'
export const handleCacheMapWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheMapWriteSuccessCount = (results.geminiApi.cacheMapWriteSuccessCount || 0) + 1; // Đổi tên để tránh nhầm lẫn với boolean status
};

// Event: 'cache_map_write_failed'
export const handleCacheMapWriteFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.cacheMapWriteFailures = (results.geminiApi.cacheMapWriteFailures || 0) + 1;
};

// Event: 'cache_manager_create_failed', 'cache_manager_init_failed_no_apikey', 'cache_manager_init_skipped_no_genai'
export const handleCacheManagerCreateFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Đã được xử lý bởi handleGeminiSetupFailure nếu event được map tới đó.
    // Nếu muốn có counter riêng ở đây, bạn có thể thêm.
    // results.geminiApi.cacheManagerCreateFailures = (results.geminiApi.cacheManagerCreateFailures || 0) + 1;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache manager init failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Cache manager init failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    // Lỗi này cũng được coi là serviceInitializationFailure trong handleGeminiSetupFailure
};


// --- Call & Retry Stats ---
// Event: 'gemini_call_start'
export const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.totalCalls++;

    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName; // modelName của model đang được gọi

    if (apiType) {
        results.geminiApi.callsByType[apiType] = (results.geminiApi.callsByType[apiType] || 0) + 1;
    }
    if (modelName) {
        results.geminiApi.callsByModel[modelName] = (results.geminiApi.callsByModel[modelName] || 0) + 1;
    }

    if (confDetail) {
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_attempted = true;
        } else if (apiType === 'extract') {
            confDetail.steps.gemini_extract_attempted = true;
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_attempted')) {
            confDetail.steps.gemini_cfp_attempted = true;
        }
    }
};

// Event: 'retry_attempt_start'
export const handleRetryAttemptStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.totalRetries = (results.geminiApi.totalRetries || 0) + 1;

    // apiType và modelName nên có trong context của 'retry_attempt_start'
    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName;

    if (apiType) {
        results.geminiApi.retriesByType[apiType] = (results.geminiApi.retriesByType[apiType] || 0) + 1;
    }
    if (modelName) {
        results.geminiApi.retriesByModel[modelName] = (results.geminiApi.retriesByModel[modelName] || 0) + 1;
    }
};

// --- Intermediate Errors & Limits ---
// Events: 'retry_wait_before_next', 'retry_internal_rate_limit_wait'
export const handleRateLimitWait: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.rateLimitWaits = (results.geminiApi.rateLimitWaits || 0) + 1;
};

// Events:
// 'json_clean_parse_failed', 'json_clean_structure_not_found', (Các lỗi JSON cleaning)
// 'retry_attempt_error_cache', 'retry_attempt_error_429', 'retry_attempt_error_5xx',
// 'retry_attempt_error_unknown', 'retry_loop_exit_unexpected',
// 'gemini_api_generate_content_failed' (Lỗi khi gọi model.generateContent)
export const handleGeminiIntermediateError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.geminiApi.intermediateErrors = (results.geminiApi.intermediateErrors || 0) + 1;

    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini intermediate error (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Gemini intermediate error (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
};