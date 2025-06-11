// src/utils/logAnalysis/searchHandlers/apiKey.handlers.ts

/**
 * Handles events related to Google Search API key management.
 */

import { LogEventHandler } from '../index';

export const handleApiKeyProvided: LogEventHandler = (logEntry, results) => {
    results.googleSearch.apiKeysProvidedCount = (results.googleSearch.apiKeysProvidedCount || 0) + 1;
};

export const handleApiKeyUsageLimitReached: LogEventHandler = (logEntry, results) => {
    results.googleSearch.apiKeyLimitsReached = (results.googleSearch.apiKeyLimitsReached || 0) + 1;
    const keyIndex = logEntry.keyIndex;
    if (keyIndex !== undefined) {
        if (!results.googleSearch.keySpecificLimitsReached) {
            results.googleSearch.keySpecificLimitsReached = {};
        }
        results.googleSearch.keySpecificLimitsReached[`key_${keyIndex}`] = (results.googleSearch.keySpecificLimitsReached[`key_${keyIndex}`] || 0) + 1;
    }
};

export const handleApiKeyRotation: LogEventHandler = (logEntry, results) => {
    const event = logEntry.event;
    if (event === 'api_key_force_rotated_success_locked') {
        results.googleSearch.apiKeyRotationsSuccess = (results.googleSearch.apiKeyRotationsSuccess || 0) + 1;
    } else if (event === 'api_key_force_rotated_fail_locked') {
        results.googleSearch.apiKeyRotationsFailed = (results.googleSearch.apiKeyRotationsFailed || 0) + 1;
    }
};

export const handleAllApiKeysExhaustedInfo: LogEventHandler = (logEntry, results) => {
    const event = logEntry.event;
    if (event === 'api_keys_all_exhausted_checked_locked') {
        results.googleSearch.allKeysExhaustedEvents_GetNextKey = (results.googleSearch.allKeysExhaustedEvents_GetNextKey || 0) + 1;
    } else if (event === 'api_keys_all_exhausted_status') {
        results.googleSearch.allKeysExhaustedEvents_StatusCheck = (results.googleSearch.allKeysExhaustedEvents_StatusCheck || 0) + 1;
    }
};