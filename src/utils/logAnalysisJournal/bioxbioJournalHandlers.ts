import { JournalLogEventHandler } from './index';
import { addJournalError, normalizeErrorKey, findOrCreateJournalDetail } from './helpers';


const addBioxbioErrorToStats = (results: import('../../types/logAnalysisJournal/logAnalysisJournal.types').JournalLogAnalysisResult, errorKey: string, errorMessage: string) => {
    results.bioxbio.totalErrors = (results.bioxbio.totalErrors || 0) + 1;
    const key = normalizeErrorKey(errorKey);
    results.bioxbio.errorDetails[key] = results.bioxbio.errorDetails[key] || { count: 0, messages: [] };
    results.bioxbio.errorDetails[key].count++;
    if (errorMessage && results.bioxbio.errorDetails[key].messages.length < 5) {
        results.bioxbio.errorDetails[key].messages.push(errorMessage.substring(0, 200));
    }
};


export const handleBioxbioFetchStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This event can be logged by crawlJournals (general) or fetchBioxbioData (specific)
    // If it's from fetchBioxbioData, it has journalName
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.bioxbio_attempted = true;
        results.bioxbio.totalFetchesAttempted = (results.bioxbio.totalFetchesAttempted || 0) + 1;
    }
};

export const handleBioxbioCacheCheck: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};

export const handleBioxbioCacheHit: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.bioxbio.cacheHits = (results.bioxbio.cacheHits || 0) + 1;
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.bioxbio_attempted = true; // Implies an attempt was made that hit cache
        journalDetail.steps.bioxbio_success = true;
        journalDetail.steps.bioxbio_cache_used = true;
        results.bioxbio.totalFetchesSucceeded = (results.bioxbio.totalFetchesSucceeded || 0) + 1;
        results.overall.processedJournalsWithBioxbioSuccess = (results.overall.processedJournalsWithBioxbioSuccess || 0) + 1;
    }
};

export const handleBioxbioCacheMiss: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.bioxbio.cacheMisses = (results.bioxbio.cacheMisses || 0) + 1;
    // Attempt continues, no status change for journalDetail yet.
};

export const handleBioxbioGotoSearchFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const message = logEntry.errMessage || 'Bioxbio goto search failed';
    addBioxbioErrorToStats(results, 'goto_search_failed', message);
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'bioxbio_nav_search_fail', errorType: 'Playwright', sourceService: 'bioxbio',
            context: { step: 'bioxbio_nav_search', url: logEntry.url, attempt: logEntry.attempt }
        });
    }
};

export const handleBioxbioWaitSelectorTimeout: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This often means no results for the journal on Bioxbio.
    // fetchBioxbioData returns null in this case, leading to bioxbio_fetch_no_match_or_failure.
    const message = logEntry.errMessage || 'Bioxbio wait for search result selector timeout';
    addBioxbioErrorToStats(results, 'wait_selector_timeout_search', message);
    // No specific journal error here, as it's part of a retry loop. Final failure will be logged.
};

export const handleBioxbioRedirectUrlFailOrNotFound: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Journal not found on Bioxbio or link mismatch.
    // fetchBioxbioData returns null, leading to bioxbio_fetch_no_match_or_failure.
    const message = `Bioxbio redirect URL not found or mismatch. Reason: ${logEntry.reason || 'unknown'}`;
    addBioxbioErrorToStats(results, `redirect_url_${logEntry.reason || 'not_found'}`, message);
};

export const handleBioxbioGotoDetailsFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const message = logEntry.errMessage || 'Bioxbio goto details page failed';
    addBioxbioErrorToStats(results, 'goto_details_failed', message);
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'bioxbio_nav_details_fail', errorType: 'Playwright', sourceService: 'bioxbio',
            context: { step: 'bioxbio_nav_details', url: logEntry.url, attempt: logEntry.attempt }
        });
    }
};

export const handleBioxbioFetchSuccessEmptyData: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.bioxbio.totalFetchesSucceeded = (results.bioxbio.totalFetchesSucceeded || 0) + 1;
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.bioxbio_success = true; // Succeeded in fetching, but no data.
        journalDetail.steps.bioxbio_cache_used = false; // Was a live fetch
        results.overall.processedJournalsWithBioxbioSuccess = (results.overall.processedJournalsWithBioxbioSuccess || 0) + 1; // Count as success if process completed
    }
};

export const handleBioxbioFetchNoMatchOrFailure: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This event means the retryAsync loop in fetchBioxbioData returned null,
    // indicating no match or a non-recoverable issue before the final attempt.
    results.bioxbio.totalFetchesFailed = (results.bioxbio.totalFetchesFailed || 0) + 1;
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.bioxbio_success = false;
        journalDetail.steps.bioxbio_cache_used = false;
        addJournalError(journalDetail, entryTimestampISO, 'Bioxbio: Journal not found or failed to retrieve details.', {
            keyPrefix: 'bioxbio_no_match_final', errorType: 'ThirdParty', sourceService: 'bioxbio',
            context: { step: 'bioxbio_fetch_logic', cacheKey: logEntry.cacheKey }
        });
    }
};

export const handleBioxbioFetchFailedFinal: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This is the catch-all for retryAsync failing ultimately.
    results.bioxbio.totalFetchesFailed = (results.bioxbio.totalFetchesFailed || 0) + 1;
    const message = logEntry.errMessage || 'Bioxbio fetch failed after all retries.';
    addBioxbioErrorToStats(results, 'fetch_failed_final', message);

    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.bioxbio_success = false;
        journalDetail.steps.bioxbio_cache_used = false; // Failed live fetch
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'bioxbio_fetch_retries_failed', errorType: 'ThirdParty', sourceService: 'bioxbio',
            context: { step: 'bioxbio_fetch_retries', originalError: logEntry.stack }
        });
    }
};

export const handleBioxbioCacheSet: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Data was fetched successfully and cached.
    results.bioxbio.totalFetchesSucceeded = (results.bioxbio.totalFetchesSucceeded || 0) + 1;
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.bioxbio_success = true;
        journalDetail.steps.bioxbio_cache_used = false; // This was the fetch that populated the cache
        results.overall.processedJournalsWithBioxbioSuccess = (results.overall.processedJournalsWithBioxbioSuccess || 0) + 1;
    }
};

export const handleBioxbioFetchFinishOverall: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Marks the end of a fetchBioxbioData call for one journal.
    // Status of success/failure should already be set on journalDetail.
};

// Handle route_abort_error, route_continue_error, route_setup, route_cleanup if needed for deeper debugging.
// For now, they are mostly informational unless they cause a primary failure.