import { JournalLogEventHandler } from './index';
import { normalizeErrorKey } from './helpers';

export const handleApiKeyManagerInitError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.apiKeyManager.initializationErrors = (results.apiKeyManager.initializationErrors || 0) + 1;
    // This is critical for Google Search functionality
    results.errorsAggregated[normalizeErrorKey('apikey_manager_init_failed')] = (results.errorsAggregated[normalizeErrorKey('apikey_manager_init_failed')] || 0) + 1;
};

export const handleApiKeyManagerInitSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.apiKeyManager.keysInitialized = logEntry.keyCount || 0;
};

export const handleApiKeyUsageLimitReached: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.apiKeyManager.rotationsDueToUsage = (results.apiKeyManager.rotationsDueToUsage || 0) + 1;
};

export const handleApiKeyRotationDelayStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};

export const handleApiKeyRotationDelayEnd: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};

export const handleApiKeyProvided: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This event occurs for every key provision.
    // results.apiKeyManager.totalRequestsMade can be taken from crawl_summary or incremented here if summary is not reliable.
    // For now, relying on summary.
};

export const handleApiKeyForceRotateSkipped: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational, means all keys were already exhausted when a force rotate was attempted.
};

export const handleApiKeyRotationStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // If reason is 'Error (e.g., 429)', it's handled by image_search_quota_error which increments rotationsDueToError.
    // This handler can catch general rotation starts.
    // If logEntry.reason indicates it's forced due to an error, it's already counted.
    // If it's a normal rotation (usage limit), it's already counted by handleApiKeyUsageLimitReached.
    // This event is mostly for context.
};

export const handleApiKeyRotationFailedExhausted: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.apiKeyManager.rotationsFailedExhausted = (results.apiKeyManager.rotationsFailedExhausted || 0) + 1;
    results.apiKeyManager.totalKeysExhaustedReported = (results.apiKeyManager.totalKeysExhaustedReported || 0) + 1; // Explicit report of exhaustion
};

export const handleApiKeyRotationSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};

export const handleUnexpectedNoKey: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.apiKeyManager.initializationErrors = (results.apiKeyManager.initializationErrors || 0) + 1; // Treat as a setup/logic error
    results.errorsAggregated[normalizeErrorKey('apikey_manager_unexpected_no_key')] = (results.errorsAggregated[normalizeErrorKey('apikey_manager_unexpected_no_key')] || 0) + 1;
};