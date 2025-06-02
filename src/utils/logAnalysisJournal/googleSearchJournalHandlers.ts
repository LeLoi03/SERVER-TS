import { JournalLogEventHandler } from './index';
import { addJournalError, normalizeErrorKey, findOrCreateJournalDetail } from './helpers';


export const handleFetchGoogleImageStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This is the start of the public method in googleSearch.ts
    // totalSearchesAttempted is better incremented by image_search_start from performImageSearch context
};

export const handleFetchGoogleImageSkipMissingCreds: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.googleSearch.totalSearchesSkippedNoCreds = (results.googleSearch.totalSearchesSkippedNoCreds || 0) + 1;
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.image_search_attempted = true; // Attempt was made at higher level
        journalDetail.steps.image_search_success = false;
        addJournalError(journalDetail, entryTimestampISO, 'Google image search skipped: Missing API Key or CSE ID.', {
            keyPrefix: 'gsearch_skip_creds', errorType: 'API', sourceService: 'googleSearch',
            context: { step: 'image_search_setup', hasApiKey: logEntry.hasApiKey, hasCseId: logEntry.hasCseId }
        });
    }
};

export const handleFetchGoogleImageAttemptStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational about retry strategy, not a direct counter increment here.
};

export const handleGoogleApiRequestStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational for a single attempt within retryAsync
};

const addGoogleApiErrorToStats = (logEntry: any, results: import('../../types/logAnalysisJournal/logAnalysisJournal.types').JournalLogAnalysisResult, errorCode: string, errorMessage: string) => {
    const key = normalizeErrorKey(errorCode || errorMessage);
    results.googleSearch.apiErrors[key] = results.googleSearch.apiErrors[key] || { count: 0, messages: [] };
    results.googleSearch.apiErrors[key].count++;
    if (errorMessage && results.googleSearch.apiErrors[key].messages.length < 5) {
        results.googleSearch.apiErrors[key].messages.push(errorMessage.substring(0, 200));
    }
};

export const handleGoogleApiStructuredError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const err = logEntry.googleError || {};
    const code = String(err.code || logEntry.err?.statusCode || 'unknown_google_err');
    const message = err.message || logEntry.err?.message || 'Google API returned structured error';
    addGoogleApiErrorToStats(logEntry, results, code, message);

    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'gsearch_api_struct_err', errorCode: code, errorType: 'API', sourceService: 'googleSearch',
            context: { step: 'image_search_api_call', attempt: logEntry.attempt, apiError: err }
        });
    }
};

export const handleGoogleApiHttpError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const status = String(logEntry.status || logEntry.err?.statusCode || 'http_error');
    const message = logEntry.statusText || logEntry.err?.message || `Google API HTTP Error ${status}`;
    addGoogleApiErrorToStats(logEntry, results, status, message);

    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'gsearch_api_http_err', errorCode: status, errorType: 'API', sourceService: 'googleSearch',
            context: { step: 'image_search_api_call', attempt: logEntry.attempt, status: logEntry.status }
        });
    }
};

export const handleGoogleApiRequestSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Success for a single attempt within retryAsync
};

export const handleGoogleApiAxiosError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const status = String(logEntry.status || logEntry.code || 'axios_error'); // e.g. ECONNREFUSED might not have status
    const message = logEntry.message || 'Axios error during Google API request';
    addGoogleApiErrorToStats(logEntry, results, status, message);

    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'gsearch_api_axios_err', errorCode: status, errorType: 'Network', sourceService: 'googleSearch',
            context: { step: 'image_search_api_call', attempt: logEntry.attempt, axiosErrorCode: logEntry.code }
        });
    }
};

export const handleGoogleApiUnknownError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const message = logEntry.err?.message || 'Unknown error during Google API request';
    addGoogleApiErrorToStats(logEntry, results, 'unknown_api_err', message);

    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'gsearch_api_unknown_err', errorType: 'Unknown', sourceService: 'googleSearch',
            context: { step: 'image_search_api_call', attempt: logEntry.attempt, originalError: logEntry.err }
        });
    }
};

export const handleFetchGoogleImageApiOverallSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This is after retries, handled by image_search_success from performImageSearch context
};

export const handleFetchGoogleImageItemsFound: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This is after retries, handled by image_search_success(hasImage=true) from performImageSearch context
};

export const handleFetchGoogleImageNoItems: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This is after retries, handled by image_search_success(hasImage=false) from performImageSearch context
};

export const handleFetchGoogleImageFailedAfterRetries: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.googleSearch.totalSearchesFailedAfterRetries = (results.googleSearch.totalSearchesFailedAfterRetries || 0) + 1;
    const statusCode = String(logEntry.statusCode || 'N/A');
    const message = logEntry.err?.message || `Google image search failed after retries (Status: ${statusCode})`;
    addGoogleApiErrorToStats(logEntry, results, `failed_retries_${statusCode}`, message);

    // The image_search_failed handler (from journalTaskHandlers) will update the specific journalDetail.
};

export const handleFetchGoogleImageFinish: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Final outcome of one call to fetchGoogleImage.
    // Success/failure for the journal step is handled by image_search_success/failed.
};