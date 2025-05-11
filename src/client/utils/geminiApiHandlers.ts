// src/client/utils/eventHandlers/geminiApiHandlers.ts
import { LogEventHandler } from './commonHandlers';
import { normalizeErrorKey, addConferenceError } from './helpers';

export const handleGeminiFinalFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.context?.finalError || logEntry.err || logEntry.reason || logEntry.msg;
    const event = logEntry.event;
    const failureMsg = error || `Gemini API call failed (${event})`;
    const errorKey = normalizeErrorKey(failureMsg);

    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    const isSafetyBlock = event.includes('safety') || event.includes('blocked') || (typeof error === 'object' && error?.finishReason === 'SAFETY');
    if (isSafetyBlock) {
        results.geminiApi.blockedBySafety++;
        // Optionally count as failed call too: results.geminiApi.failedCalls++;
    } else {
        results.geminiApi.failedCalls++; // Count non-safety final failures
    }

    if (confDetail) {
        const apiType = logEntry.context?.apiType; // 'determine' or 'extract'
        if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
        if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;

        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;

        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

export const handleGeminiSetupFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.failedCalls++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini setup/call failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        const apiType = logEntry.context?.apiType;
        if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
        if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};


export const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.successfulCalls++;

    // CORRECTED: Access 'tokens' directly from logEntry root
    if (logEntry.tokens) {
        results.geminiApi.totalTokens += Number(logEntry.tokens) || 0;
    }

    if (confDetail) {
        // CORRECTED: Access 'apiType' and 'usingCache' directly from logEntry root
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? false; // Default to false if undefined

        if (apiType === 'determine' && confDetail.steps.gemini_determine_success !== false) {
            confDetail.steps.gemini_determine_success = true;
            // Set cache status ONLY if not already set by cache_hit event
            if (confDetail.steps.gemini_determine_cache_used === null) {
                confDetail.steps.gemini_determine_cache_used = usingCache;
            }
            // logger.trace({ ...logContext, event: 'analysis_gemini_determine_marked_success', usingCache }, 'Marked Gemini determine step as successful.');
        }
        if (apiType === 'extract' && confDetail.steps.gemini_extract_success !== false) {
            confDetail.steps.gemini_extract_success = true;
            if (confDetail.steps.gemini_extract_cache_used === null) {
                confDetail.steps.gemini_extract_cache_used = usingCache;
            }
            // logger.trace({ ...logContext, event: 'analysis_gemini_extract_marked_success', usingCache }, 'Marked Gemini extract step as successful.');
        }
    }
};

export const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheHits++;
    if (confDetail) {
        // CORRECTED: Access 'apiType' directly from logEntry root
        const apiType = logEntry.apiType;
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_cache_used = true;
            // logger.trace({ ...logContext, event: 'analysis_gemini_determine_cache_hit' }, 'Marked Gemini determine step as using cache (cache hit event).');
        }
        if (apiType === 'extract') {
            confDetail.steps.gemini_extract_cache_used = true;
            // logger.trace({ ...logContext, event: 'analysis_gemini_extract_cache_hit' }, 'Marked Gemini extract step as using cache (cache hit event).');
        }
    }
};


export const handleCacheWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheCreationSuccess++;
};


export const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.totalCalls++;

    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName;

    if (apiType) results.geminiApi.callsByType[apiType] = (results.geminiApi.callsByType[apiType] || 0) + 1;
    if (modelName) results.geminiApi.callsByModel[modelName] = (results.geminiApi.callsByModel[modelName] || 0) + 1;

    if (confDetail) {
        if (apiType === 'determine') {
            confDetail.steps.gemini_determine_attempted = true;
        }
        if (apiType === 'extract') {
            confDetail.steps.gemini_extract_attempted = true;
        }
    }
};


export const handlRetriesGeminiCall: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {

    const apiType = logEntry.apiType;
    const modelName = logEntry.modelName;

    if (apiType) results.geminiApi.retriesByType[apiType] = (results.geminiApi.retriesByType[apiType] || 0) + 1;
    if (modelName) results.geminiApi.retriesByModel[modelName] = (results.geminiApi.retriesByModel[modelName] || 0) + 1;
};




export const handleCacheCreateStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheAttempts++;
};

export const handleCacheWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheCreationFailed++;
};

export const handleCacheInvalidate: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.cacheInvalidations++;
};

export const handleRateLimitWait: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.geminiApi.rateLimitWaits++;
};

export const handleGeminiIntermediateError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Gemini retry attempt failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.geminiApi.errorsByType[errorKey] = (results.geminiApi.errorsByType[errorKey] || 0) + 1;
};

