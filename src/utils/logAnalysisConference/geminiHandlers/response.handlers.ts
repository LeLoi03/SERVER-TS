// src/utils/logAnalysis/geminiHandlers/response.handlers.ts

/**
 * Handles events related to processing the response from the Gemini API,
 * including JSON validation, cleaning, and safety blocks.
 */

import { LogEventHandler } from '../index';
import { addConferenceError } from '../utils';
import { ensureGeminiApiAnalysis } from './helpers';

/**
 * Handles the lifecycle of the internal `generateContent` call.
 */
export const handleGenerateContentInternal: LogEventHandler = (logEntry, results) => {
    const geminiApi = ensureGeminiApiAnalysis(results);
    if (logEntry.event === 'gemini_api_generate_start') {
        geminiApi.generateContentInternal.attempts++;
    } else if (logEntry.event === 'gemini_api_generate_success') {
        geminiApi.generateContentInternal.successes++;
    }
};

/**
 * Handles various events that occur during the processing of the API response.
 */
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
                sourceService: "GeminiResponseHandlerService",
                errorType: "FileSystem",
                context: { phase: 'response_processing' }
            });
        }
    }
};