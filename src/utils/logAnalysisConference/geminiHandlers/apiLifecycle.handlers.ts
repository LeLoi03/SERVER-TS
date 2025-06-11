// src/utils/logAnalysis/geminiHandlers/apiLifecycle.handlers.ts

/**
 * Handles core API call lifecycle events: start, success, and final failure.
 * These handlers are responsible for tracking the overall state of API operations.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../helpers';
import { LogError } from '../../../types/logAnalysis';
import { ensureGeminiApiAnalysis, ensureOverallAnalysis, updateModelUsageStats } from './helpers';

/**
 * Handles the start of a Gemini API operation (e.g., extractInformation).
 * This is the entry point for counting total operations.
 */
export const handleGeminiCallStart: LogEventHandler = (logEntry, results, confDetail) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.totalCalls++;
    const apiType = logEntry.apiType;
    if (apiType) {
        geminiApi.callsByType[apiType] = (geminiApi.callsByType[apiType] || 0) + 1;
    }

    if (confDetail) {
        if (apiType === 'determine') confDetail.steps.gemini_determine_attempted = true;
        else if (apiType === 'extract') confDetail.steps.gemini_extract_attempted = true;
        else if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_attempted')) {
            confDetail.steps.gemini_cfp_attempted = true;
        }
    }
};

/**
 * Handles successful completion of a Gemini API operation.
 */
export const handleGeminiSuccess: LogEventHandler = (logEntry, results, confDetail) => {
    const overall = ensureOverallAnalysis(results);
    const geminiApi = ensureGeminiApiAnalysis(results);

    if (logEntry.event === 'gemini_public_method_finish') {
        geminiApi.successfulCalls++;
        geminiApi.responseProcessingStats.publicMethodFinishes++;

        if (confDetail && logEntry.isFallbackSuccess === true) {
            confDetail.errors.forEach((err: LogError) => {
                if ((err.context?.phase === 'primary_execution' || err.context?.phase === 'sdk_call' || err.context?.phase === 'response_processing' ) && !err.isRecovered) {
                    err.isRecovered = true;
                }
            });
        }
    }

    if (logEntry.event === 'gemini_api_attempt_success') {
        updateModelUsageStats(logEntry, geminiApi, 'success_attempt');
    }

    if (confDetail && (logEntry.event === 'gemini_public_method_finish' || logEntry.event === 'gemini_api_attempt_success')) {
        const apiType = logEntry.apiType;
        const usingCache = logEntry.usingCache ?? logEntry.usingCacheActual ?? false;

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

/**
 * Handles the final failure of a Gemini API operation, after all retries and fallbacks.
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
        geminiApi.failedCalls++;
    }

    const isSafetyBlockReason = (typeof errorSource === 'object' && errorSource !== null &&
        ((errorSource as any).finishReason === 'SAFETY' || (errorSource as any).blockReason || String(errorSource).toLowerCase().includes("safety")));
    const isSafetyBlockEvent = event === 'gemini_api_response_blocked' ||
        event === 'retry_attempt_error_safety_blocked' ||
        event === 'gemini_api_response_blocked_missing_body';

    if (isSafetyBlockEvent || isSafetyBlockReason) {
        geminiApi.blockedBySafety++;
    }

    if (modelIdentifier) {
        updateModelUsageStats(logEntry, geminiApi, 'failure_attempt');
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
                errorCode: (errorSource as any)?.code || (logEntry.finalError as any)?.name,
                keyPrefix: `gemini_final_${apiType || 'unknown'}`,
                sourceService: 'GeminiApiOrchestratorService',
                errorType: isSafetyBlockEvent || isSafetyBlockReason ? 'SafetyBlock' : 'ThirdPartyAPI',
                context: {
                    phase: logEntry.phase || 'api_call',
                    modelIdentifier: modelIdentifier,
                    apiType: apiType
                }
            }
        );
    }
};