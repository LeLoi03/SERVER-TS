// src/client/utils/eventHandlers/geminiApiHandlers.ts
import { LogEventHandler } from './index'; // Hoặc từ './index'
import { normalizeErrorKey, addConferenceError } from './helpers'; // Import trực tiếp

// --- Final Failures ---
export const handleGeminiFinalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.context?.finalError || logEntry.err || logEntry.reason || logEntry.msg;
    const event = logEntry.event;
    const failureMsg = error || `Gemini API call failed (${event})`; // Giữ nguyên
    const errorKey = normalizeErrorKey(failureMsg);

    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1; // Lỗi final nên aggregate

    results.geminiApi.failedCalls++; // Tất cả các lỗi final đều được tính là failedCalls

    const isSafetyBlock = event.includes('safety') || event.includes('blocked') || (typeof error === 'object' && error?.finishReason === 'SAFETY') || event === 'gemini_api_response_blocked';
    if (isSafetyBlock) {
        results.geminiApi.blockedBySafety++;
    }
    // else: các loại failedCalls khác đã được tính ở trên

    if (confDetail) {
        const apiTypeFromLog = logEntry.apiType || logEntry.context?.apiType;
        if (apiTypeFromLog === 'determine') confDetail.steps.gemini_determine_success = false;
        if (apiTypeFromLog === 'extract') confDetail.steps.gemini_extract_success = false;
        if (apiTypeFromLog === 'cfp') confDetail.steps.gemini_cfp_success = false; // Thêm nếu có

        confDetail.status = 'failed'; // Mark conference as failed
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

// --- Setup & Critical Initialization Failures ---
export const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini setup/call failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);

    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1; // Lỗi setup nghiêm trọng

    // Phân loại lỗi setup
    const event = logEntry.event;
    if (event === 'gemini_service_genai_init_failed' || event === 'gemini_service_not_initialized') {
        results.geminiApi.serviceInitializationFailures = (results.geminiApi.serviceInitializationFailures || 0) + 1;
    } else {
        // Các lỗi setup khác liên quan đến chuẩn bị cho một cuộc gọi API cụ thể
        results.geminiApi.apiCallSetupFailures = (results.geminiApi.apiCallSetupFailures || 0) + 1;
    }

    // Lỗi setup nghiêm trọng cũng nên được tính vào failedCalls nếu nó ngăn cản toàn bộ quá trình
    results.geminiApi.failedCalls++;

    if (confDetail) {
        const apiTypeFromLog = logEntry.apiType || logEntry.context?.apiType;
        if (apiTypeFromLog === 'determine') confDetail.steps.gemini_determine_success = false;
        if (apiTypeFromLog === 'extract') confDetail.steps.gemini_extract_success = false;
        if (apiTypeFromLog === 'cfp') confDetail.steps.gemini_cfp_success = false; // Thêm nếu có

        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

// --- Successful API Call ---
export const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.successfulCalls++;

    if (logEntry.tokens) { // Nên là logEntry.metaData.totalTokenCount hoặc tương tự từ response
        results.geminiApi.totalTokens += Number(logEntry.tokens) || 0;
    } else if (logEntry.metaData?.totalTokenCount) { // Thường thì token nằm trong metaData
         results.geminiApi.totalTokens += Number(logEntry.metaData.totalTokenCount) || 0;
    }


    if (confDetail) {
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? false;

        if (apiType === 'determine') {
            if (confDetail.steps.gemini_determine_success !== false) { // Chỉ set true nếu chưa bị set false
                confDetail.steps.gemini_determine_success = true;
            }
            if (confDetail.steps.gemini_determine_cache_used === null) { // Chỉ set cache status nếu chưa được set
                confDetail.steps.gemini_determine_cache_used = usingCache;
            }
        } else if (apiType === 'extract') {
            if (confDetail.steps.gemini_extract_success !== false) {
                confDetail.steps.gemini_extract_success = true;
            }
            if (confDetail.steps.gemini_extract_cache_used === null) {
                confDetail.steps.gemini_extract_cache_used = usingCache;
            }
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) { // Thêm nếu có
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
export const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_setup_use_success'
    results.geminiApi.cacheContextHits = (results.geminiApi.cacheContextHits || 0) + 1;

    if (confDetail) {
        const apiType = logEntry.apiType; // apiType nên có trong logEntry của 'cache_setup_use_success'
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_cache_used = true;
        } else if (apiType === 'extract') {
            confDetail.steps.gemini_extract_cache_used = true;
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_cache_used')) { // Thêm nếu có
            confDetail.steps.gemini_cfp_cache_used = true;
        }
    }
};

export const handleCacheContextCreateStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_create_start' (for context cache)
    results.geminiApi.cacheContextAttempts = (results.geminiApi.cacheContextAttempts || 0) + 1;
};

export const handleCacheContextCreationSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_create_success' (for context cache from getOrCreateContextCache)
    results.geminiApi.cacheContextCreationSuccess = (results.geminiApi.cacheContextCreationSuccess || 0) + 1;
};

export const handleCacheContextCreationFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'cache_create_failed', 'cache_create_invalid_model_error',
    // 'cache_setup_get_or_create_failed', 'cache_manager_unavailable_early',
    // 'cache_logic_outer_exception', 'cache_setup_getmodel_failed'
    results.geminiApi.cacheContextCreationFailed = (results.geminiApi.cacheContextCreationFailed || 0) + 1;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context creation/setup failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    // Không aggregate vào results.errorsAggregated trừ khi đây là lỗi nghiêm trọng dừng cả task
};

export const handleCacheContextInvalidation: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'cache_create_failed_invalid_object', 'cache_invalidate', 'retry_cache_invalidate'
    results.geminiApi.cacheContextInvalidations = (results.geminiApi.cacheContextInvalidations || 0) + 1;
};

export const handleCacheContextRetrievalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'cache_retrieval_failed_not_found', 'cache_retrieval_failed_exception'
    results.geminiApi.cacheContextRetrievalFailures = (results.geminiApi.cacheContextRetrievalFailures || 0) + 1;
    // Có thể coi đây là một dạng cache invalidation hoặc creation failed tùy theo logic
    results.geminiApi.cacheContextInvalidations = (results.geminiApi.cacheContextInvalidations || 0) + 1; // Hoặc tăng một counter riêng
};


export const handleCacheMapLoadFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_load_failed' (for cache map file)
    results.geminiApi.cacheMapLoadFailures = (results.geminiApi.cacheMapLoadFailures || 0) + 1;
    results.geminiApi.cacheMapLoadSuccess = false;
    // Đây là lỗi setup, có thể ảnh hưởng toàn cục
    results.geminiApi.serviceInitializationFailures = (results.geminiApi.serviceInitializationFailures || 0) + 1;
};

export const handleCacheMapWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_write_success' (for cache map file from saveCacheNameMap)
    results.geminiApi.cacheMapWriteSuccess = (results.geminiApi.cacheMapWriteSuccess || 0) + 1;
};

export const handleCacheMapWriteFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_write_failed' (for cache map file)
    results.geminiApi.cacheMapWriteFailures = (results.geminiApi.cacheMapWriteFailures || 0) + 1;
    // Lỗi này có thể không nghiêm trọng bằng load failure nhưng vẫn cần theo dõi
};

export const handleCacheManagerCreateFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'cache_manager_create_failed'
    results.geminiApi.cacheManagerCreateFailures = (results.geminiApi.cacheManagerCreateFailures || 0) + 1;
    results.geminiApi.serviceInitializationFailures = (results.geminiApi.serviceInitializationFailures || 0) + 1;
};


// --- Call & Retry Stats ---
export const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'gemini_call_start'
    results.geminiApi.totalCalls++;

    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName;

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
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_attempted')) { // Thêm nếu có
            confDetail.steps.gemini_cfp_attempted = true;
        }
    }
};

export const handleRetryAttemptStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'retry_attempt_start'
    results.geminiApi.totalRetries = (results.geminiApi.totalRetries || 0) + 1;

    const apiType = logEntry.apiType; // Cần đảm bảo logEntry của 'retry_attempt_start' có apiType và modelName
    const modelName = logEntry.modelName;

    if (apiType) {
        results.geminiApi.retriesByType[apiType] = (results.geminiApi.retriesByType[apiType] || 0) + 1;
    }
    if (modelName) {
        results.geminiApi.retriesByModel[modelName] = (results.geminiApi.retriesByModel[modelName] || 0) + 1;
    }
};

// --- Intermediate Errors & Limits ---
export const handleRateLimitWait: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'retry_wait_before_next', 'retry_internal_rate_limit_wait'
    results.geminiApi.rateLimitWaits++;
};

export const handleGeminiIntermediateError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'retry_attempt_error_cache', 'retry_attempt_error_429', 'retry_attempt_error_5xx',
    // 'retry_attempt_error_unknown', 'retry_loop_exit_unexpected', 'gemini_api_generate_failed', 'retry_genai_not_init'
    results.geminiApi.intermediateErrors = (results.geminiApi.intermediateErrors || 0) + 1;

    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini intermediate error (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    // Không aggregate vào results.errorsAggregated vì đây là lỗi trung gian, có thể được retry
};