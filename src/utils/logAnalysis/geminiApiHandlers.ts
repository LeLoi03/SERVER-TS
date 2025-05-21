// src/utils/logAnalysis/geminiApiHandlers.ts
import { LogEventHandler } from './index'; // Giả sử index.ts export LogEventHandler và LogAnalysisResults
import { normalizeErrorKey, addConferenceError } from './helpers';
import {
    OverallAnalysis,
    GeminiApiAnalysis,
    ConferenceAnalysisDetail,
    LogAnalysisResult, // Sử dụng LogAnalysisResult thay vì any cho results
} from '../../types/logAnalysis.types';

// --- Helper Utilities ---

const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => {
    // Hàm này đã có, đảm bảo nó hoạt động đúng với LogAnalysisResult
    if (!results.overall) {
        // Khởi tạo nếu chưa có, giả sử bạn có hàm getInitialOverallAnalysis
        // results.overall = getInitialOverallAnalysis();
        // Hoặc khởi tạo trực tiếp
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

// Trong geminiApiHandlers.ts

const ensureNestedObject = (obj: any, path: string[], defaultValueFactory: () => any = () => ({})): any => {
    if (!obj || typeof obj !== 'object') {
        // console.error("ensureNestedObject called with non-object or null initial object for path:", path);
        // Hoặc throw lỗi, hoặc trả về một object rỗng mới để tránh lỗi lan truyền
        // Tùy thuộc vào bạn muốn xử lý thế nào. Nếu obj là results.geminiApi, thì nó PHẢI là object.
        // Nếu là results.geminiApi.modelUsageByApiType, nó cũng phải là object.
        // Trường hợp này rất có thể là results.geminiApi.modelUsageByApiType chưa phải là object.
        return defaultValueFactory(); // Cẩn thận với việc này, nó có thể che giấu lỗi gốc
    }

    let current = obj;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (i === path.length - 1) { // Key cuối cùng trong path
            if (current[key] === undefined) {
                current[key] = defaultValueFactory();
            }
        } else { // Key trung gian
            if (current[key] === undefined || typeof current[key] !== 'object' || current[key] === null) {
                current[key] = {}; // Luôn tạo object rỗng cho key trung gian nếu chưa tồn tại hoặc không phải object
            }
        }
        current = current[key];
    }
    return current; // Trả về giá trị ở cấp độ cuối cùng của path
};

const ensureModelUsageStatsEntry = (results: LogAnalysisResult, apiType: string, modelIdentifier: string) => {
    // results.geminiApi.modelUsageByApiType PHẢI là một object ở đây.
    // Path sẽ là [apiType, modelIdentifier]
    // Nếu results.geminiApi.modelUsageByApiType là {},
    // ensureNestedObject sẽ tạo:
    // {}.determine = {}  (nếu apiType là 'determine')
    // {}.determine[modelIdentifier] = defaultValueFactory()

    return ensureNestedObject(
        results.geminiApi.modelUsageByApiType, // obj đầu vào
        [apiType, modelIdentifier],            // path
        () => ({ calls: 0, retries: 0, successes: 0, failures: 0, tokens: 0, safetyBlocks: 0 })
    );
};

const updateModelUsageStats = (
    logEntry: any,
    results: LogAnalysisResult,
    updateType: 'call' | 'retry' | 'success' | 'failure'
) => {
    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName; // Model thực sự được sử dụng
    const crawlModel = logEntry.crawlModel; // 'tuned' hoặc 'non-tuned'

    if (!apiType || !modelName || !crawlModel) {
        // console.warn(`[LogAnalysis] Missing apiType, modelName, or crawlModel for model usage stats. Event: ${logEntry.event}, Acronym: ${logEntry.acronym || 'N/A'}`);
        return;
    }

    const modelIdentifier = `${modelName} (${crawlModel})`;
    const stats = ensureModelUsageStatsEntry(results, apiType, modelIdentifier);

    switch (updateType) {
        case 'call':
            stats.calls++;
            break;
        case 'retry':
            stats.retries++;
            break;
        case 'success':
            stats.successes++;
            const tokenCount = logEntry.tokens || logEntry.metaData?.totalTokenCount;
            if (tokenCount) {
                stats.tokens += Number(tokenCount) || 0;
            }
            break;
        case 'failure':
            stats.failures++;
            const errorForSafetyCheck = logEntry.finalError || logEntry.err || logEntry.reason || logEntry.msg;
            const isSafetyBlockEvent = logEntry.event === 'gemini_api_response_blocked' || logEntry.event === 'retry_attempt_error_safety_blocked';
            const isSafetyBlockReason = (typeof errorForSafetyCheck === 'object' && errorForSafetyCheck !== null &&
                                        ((errorForSafetyCheck as any).finishReason === 'SAFETY' || (errorForSafetyCheck as any).blockReason));
            if (isSafetyBlockEvent || isSafetyBlockReason) {
                stats.safetyBlocks++;
            }
            break;
    }
};

// --- Event Handlers ---

// Gemini Final Failures
export const handleGeminiFinalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const error = logEntry.finalError || logEntry.err || logEntry.reason || logEntry.msg || `Unknown final failure`;
    const event = logEntry.event;
    const failureMsg = typeof error === 'string' ? error : (error as Error)?.message || `Gemini API call failed (${event})`;
    const errorKey = normalizeErrorKey(failureMsg);

    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    geminiApi.failedCalls++;

    const isSafetyBlockEvent = event === 'gemini_api_response_blocked' || event === 'retry_attempt_error_safety_blocked';
    const isSafetyBlockReason = (typeof error === 'object' && error !== null &&
                                ((error as any).finishReason === 'SAFETY' || (error as any).blockReason));
    if (isSafetyBlockEvent || isSafetyBlockReason) {
        geminiApi.blockedBySafety++;
    }

    updateModelUsageStats(logEntry, results, 'failure');

    const fallbackLogicStats = ensureNestedObject(geminiApi, ['fallbackLogic']);
    if (event === 'gemini_call_5xx_no_more_fallback_options' ||
        event === 'gemini_call_failed_no_more_options' ||
        event === 'gemini_call_unexpected_exit_after_attempts') {
        fallbackLogicStats.failedAfterFallbackAttempts++;
    }

    if (confDetail) {
        const apiTypeFromLog = logEntry.apiType;
        if (apiTypeFromLog === 'determine') confDetail.steps.gemini_determine_success = false;
        else if (apiTypeFromLog === 'extract') confDetail.steps.gemini_extract_success = false;
        else if (apiTypeFromLog === 'cfp') confDetail.steps.gemini_cfp_success = false;
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, failureMsg, errorKey);
    }
};

// Gemini Setup & Critical Initialization Failures
export const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const error = logEntry.err || logEntry.reason || logEntry.detail || logEntry.msg || `Gemini setup/init failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Gemini setup/init failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);

    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    const event = logEntry.event;
    const initStats = ensureNestedObject(geminiApi, ['serviceInitialization']);
    const configStats = ensureNestedObject(geminiApi, ['configErrors']);

    const serviceInitEvents = [
        'gemini_service_genai_init_failed', 'gemini_service_not_initialized', 'gemini_service_genai_not_ready',
        'gemini_client_manager_no_genai_instance', 'gemini_client_manager_no_cache_manager_instance', // Added this
        'cache_manager_create_failed', 'cache_manager_init_failed_no_apikey',
        'cache_manager_init_skipped_no_genai', 'cache_map_load_failed',
        'gemini_service_async_init_failed'
    ];

    if (serviceInitEvents.includes(event)) {
        initStats.failures++;
        if (event === 'cache_map_load_failed') {
            geminiApi.cacheMapLoadSuccess = false;
        }
    } else if (event === 'gemini_service_critically_uninitialized') {
        initStats.criticallyUninitialized++;
        initStats.failures++; // Also a service init failure
    } else if (event === 'gemini_service_lazy_init_attempt') {
        initStats.lazyAttempts++;
    } else if (event === 'gemini_model_list_empty_or_missing') {
        geminiApi.apiCallSetupFailures++;
        configStats.modelListMissing++;
    } else if (event === 'few_shot_prep_odd_parts_count' || event === 'few_shot_prep_failed') {
        // These are handled by handleFewShotPrep, but also count as apiCallSetupFailures.
        // The specific counting for fewShotPrep will be in its own handler.
        geminiApi.apiCallSetupFailures++;
    } else {
        // General API call setup failures
        geminiApi.apiCallSetupFailures++;
    }

    // If a setup failure can be attributed to a specific call attempt (has apiType, modelName, crawlModel)
    // it should also count as a failed call for that model.
    if (logEntry.apiType && logEntry.modelName && logEntry.crawlModel) {
        updateModelUsageStats(logEntry, results, 'failure');
        geminiApi.failedCalls++; // Count as a general failed call too.
    } else if (serviceInitEvents.includes(event) || event === 'gemini_service_critically_uninitialized') {
        // Critical service-wide setup failures might not be tied to a specific API call/model yet,
        // but they prevent any calls from succeeding.
        // No model-specific update here, but it contributes to overall service health.
    }


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

// Gemini Service Initialization Lifecycle
export const handleServiceInitLifecycle: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const initStats = ensureNestedObject(results.geminiApi, ['serviceInitialization']);
    if (logEntry.event === 'gemini_service_async_init_start') {
        initStats.starts++;
    } else if (logEntry.event === 'gemini_service_async_init_complete') {
        initStats.completes++;
    }
};

// Gemini Success
export const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    ensureOverallAnalysis(results);
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;

    geminiApi.successfulCalls++;
    const tokenCount = logEntry.tokens || logEntry.metaData?.totalTokenCount;
    if (tokenCount) {
        geminiApi.totalTokens += Number(tokenCount) || 0;
    }

    updateModelUsageStats(logEntry, results, 'success');

    if (logEntry.event === 'gemini_call_success_with_model' && logEntry.isFallback === true) {
        ensureNestedObject(geminiApi, ['fallbackLogic']).successWithFallbackModel++;
    }

    if (confDetail) {
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? logEntry.usingCacheActual ?? false;

        if (apiType === 'determine') {
            if (confDetail.steps.gemini_determine_success !== false) confDetail.steps.gemini_determine_success = true;
            if (confDetail.steps.gemini_determine_cache_used === null) confDetail.steps.gemini_determine_cache_used = usingCache;
        } else if (apiType === 'extract') {
            if (confDetail.steps.gemini_extract_success !== false) {
                confDetail.steps.gemini_extract_success = true;
                results.overall.successfulExtractions = (results.overall.successfulExtractions || 0) + 1;
            }
            if (confDetail.steps.gemini_extract_cache_used === null) confDetail.steps.gemini_extract_cache_used = usingCache;
        } else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) {
            if (confDetail.steps.gemini_cfp_success !== false) confDetail.steps.gemini_cfp_success = true;
            if (confDetail.steps.gemini_cfp_cache_used === null) confDetail.steps.gemini_cfp_cache_used = usingCache;
        }
    }
};

// Gemini Cache Specifics
export const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheContextHits++;

    if (confDetail) {
        const apiType = logEntry.apiType;
        if (apiType === 'determine') confDetail.steps.gemini_determine_cache_used = true;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_cache_used = true;
        else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_cache_used')) {
            confDetail.steps.gemini_cfp_cache_used = true;
        }
    }
};

export const handleCacheContextCreateStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheContextAttempts++;
};

export const handleCacheContextCreationSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheContextCreationSuccess++;
};

export const handleCacheContextCreationFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheContextCreationFailed++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context operation failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Cache context operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
    // This could also be considered an apiCallSetupFailure if it happens during a call prep
    if (logEntry.event === 'gemini_call_cache_setup_failed' || logEntry.event === 'gemini_call_model_from_cache_failed' || logEntry.event === 'gemini_call_no_cache_available_or_setup_failed') {
        geminiApi.apiCallSetupFailures++;
    }
};

export const handleCacheContextInvalidation: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheContextInvalidations++;
};

export const handleCacheContextRetrievalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheContextRetrievalFailures++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context retrieval failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Cache context retrieval failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
};

export const handleCacheMapWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheMapWriteSuccessCount++;
};

export const handleCacheMapWriteFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.cacheMapWriteFailures++;
    geminiApi.errorsByType['cache_map_write_failed'] = (geminiApi.errorsByType['cache_map_write_failed'] || 0) + 1;
};

// Gemini Call & Retry Stats
export const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.totalCalls++;

    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName; // Model chung

    if (apiType) {
        geminiApi.callsByType[apiType] = (geminiApi.callsByType[apiType] || 0) + 1;
    }
    if (modelName) {
        geminiApi.callsByModel[modelName] = (geminiApi.callsByModel[modelName] || 0) + 1;
    }
    updateModelUsageStats(logEntry, results, 'call');

    if (confDetail) {
        if (apiType === 'determine') confDetail.steps.gemini_determine_attempted = true;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_attempted = true;
        else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_attempted')) {
            confDetail.steps.gemini_cfp_attempted = true;
        }
    }
};

export const handleRetryAttemptStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.totalRetries++;

    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName; // Model đang được retry

    if (apiType) {
        geminiApi.retriesByType[apiType] = (geminiApi.retriesByType[apiType] || 0) + 1;
    }
    if (modelName) {
        geminiApi.retriesByModel[modelName] = (geminiApi.retriesByModel[modelName] || 0) + 1;
    }
    updateModelUsageStats(logEntry, results, 'retry');
};

// Gemini Intermediate Errors & Limits
export const handleRateLimitWait: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.rateLimitWaits++;
};

export const handleGeminiIntermediateError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const geminiApi = ensureNestedObject(results, ['geminiApi']) as GeminiApiAnalysis;
    geminiApi.intermediateErrors++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini intermediate error (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as Error)?.message || `Gemini intermediate error (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
};

// Gemini Fallback Logic
export const handleFallbackLogic: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const fallbackStats = ensureNestedObject(results.geminiApi, ['fallbackLogic']);
    const event = logEntry.event;

    if (event === 'gemini_call_attempting_fallback_model') {
        fallbackStats.attemptsWithFallbackModel++;
    } else if (event === 'gemini_call_no_fallback_configured') {
        fallbackStats.noFallbackConfigured++;
    } else if (event === 'gemini_call_primary_failed_non_5xx_checking_fallback' || event === 'gemini_call_5xx_switching_to_fallback') {
        fallbackStats.primaryModelFailuresLeadingToFallback++;
    }
};

// Gemini Configuration & Few-Shot Prep
export const handleFewShotPrep: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const prepStats = ensureNestedObject(results.geminiApi, ['fewShotPreparation']);
    const failures = ensureNestedObject(prepStats, ['failures']);
    const warnings = ensureNestedObject(prepStats, ['warnings']);
    const event = logEntry.event;

    switch (event) {
        case 'few_shot_prep_start': prepStats.attempts++; break;
        case 'few_shot_prep_success': prepStats.successes++; break;
        case 'few_shot_prep_odd_parts_count':
            failures.oddPartsCount++;
            // This is also a setup failure for the call
            handleGeminiSetupFailure(logEntry, results, confDetail, entryTimestampISO);
            break;
        case 'few_shot_prep_failed':
            failures.processingError++;
            handleGeminiSetupFailure(logEntry, results, confDetail, entryTimestampISO);
            break;
        case 'few_shot_prep_missing_or_empty_input_value': warnings.missingInput++; break;
        case 'few_shot_prep_missing_or_empty_output_value_for_input': warnings.missingOutput++; break;
        case 'few_shot_prep_empty_result_after_processing': warnings.emptyResult++; break;
        case 'gemini_fewshot_allowed_but_no_config_data_for_non_tuned': prepStats.configuredButNoData++; break;
        case 'gemini_fewshot_disabled_for_non_tuned_by_config': prepStats.disabledByConfig++; break;
    }
};

// Gemini Request Payload Logging
export const handleRequestPayloadLog: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const logStats = ensureNestedObject(results.geminiApi, ['requestPayloadLogging']);
    if (logEntry.event === 'gemini_api_request_payload_logged') {
        logStats.successes++;
    } else if (logEntry.event === 'gemini_api_request_payload_log_failed') {
        logStats.failures++;
    }
};

// Gemini Generate Content Internals
export const handleGenerateContentInternal: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const genStats = ensureNestedObject(results.geminiApi, ['generateContentInternal']);
    if (logEntry.event === 'gemini_api_generate_start') {
        genStats.attempts++;
    } else if (logEntry.event === 'gemini_api_generate_success') {
        genStats.successes++;
    }
};