// src/utils/logAnalysis/geminiHandlers/cache.handlers.ts

/**
 * This module centralizes all event handlers related to caching logic,
 * including cache hits, context management, and persistence.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey } from '../utils';
import { ensureGeminiApiAnalysis } from './helpers';

export const handleGeminiCacheHit: LogEventHandler = (logEntry, results, confDetail) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
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

export const handleCacheContextCreateStart: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextAttempts++;
};

export const handleCacheContextCreationSuccess: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'cache_context_create_success') {
        geminiApi.cacheContextCreationSuccess++;
    } else if (logEntry.event === 'cache_context_retrieval_success') {
        geminiApi.cacheContextRetrievalSuccess++;
    }
};

export const handleCacheContextCreationFailed: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextCreationFailed++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context operation failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as any)?.message || `Cache context operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;

    if (logEntry.event === 'gemini_call_cache_setup_failed' || logEntry.event === 'gemini_call_model_from_cache_failed' || logEntry.event === 'gemini_call_no_cache_available_or_setup_failed') {
        geminiApi.apiCallSetupFailures++;
    }
};

export const handleCacheContextInvalidation: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextInvalidations++;
};

export const handleCacheContextRetrievalFailure: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    geminiApi.cacheContextRetrievalFailures++;
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Cache context retrieval failed (${logEntry.event})`;
    const errorMsg = typeof error === 'string' ? error : (error as any)?.message || `Cache context retrieval failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(errorMsg);
    geminiApi.errorsByType[errorKey] = (geminiApi.errorsByType[errorKey] || 0) + 1;
};

export const handleCacheMapPersistence: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    const event = logEntry.event;
    if (event === 'cache_map_load_attempt') geminiApi.cacheMapLoadAttempts++;
    else if (event === 'cache_map_load_success') {
        geminiApi.cacheMapLoadSuccess = true;
        if (geminiApi.cacheMapLoadAttempts === 0) geminiApi.cacheMapLoadAttempts = 1;
    }
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

export const handleCacheDecision: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'cache_context_attempt_setup_for_call') {
        geminiApi.cacheDecisionStats.cacheUsageAttempts++;
    } else if (logEntry.event === 'gemini_call_cache_disabled') {
        geminiApi.cacheDecisionStats.cacheExplicitlyDisabled++;
    }
};