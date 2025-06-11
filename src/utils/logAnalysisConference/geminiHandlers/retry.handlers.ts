// src/utils/logAnalysis/geminiHandlers/retry.handlers.ts

/**
 * Handles events that occur during the retry loop of an API call,
 * such as retry attempts, intermediate errors, and rate limit waits.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../helpers';
import { ensureGeminiApiAnalysis, updateModelUsageStats } from './helpers';

/**
 * Handles the start of a retry attempt.
 */
export const handleRetryAttemptStart: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);

    if (logEntry.event === 'retry_attempt_start' && logEntry.attempt > 1) {
        geminiApi.totalRetries++;
        const apiType = logEntry.apiType;
        const modelName = logEntry.modelName || logEntry.modelBeingRetried;

        if (apiType) geminiApi.retriesByType[apiType] = (geminiApi.retriesByType[apiType] || 0) + 1;
        if (modelName) geminiApi.retriesByModel[modelName] = (geminiApi.retriesByModel[modelName] || 0) + 1;

        updateModelUsageStats(logEntry, geminiApi, 'retry');
    }
};

/**
 * Handles events indicating a wait due to rate limiting.
 */
export const handleRateLimitWait: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.rateLimitWaits++;
};

/**
 * Handles intermediate errors that occur within the retry loop but may be recovered from.
 */
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
                sourceService: 'GeminiApiService',
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