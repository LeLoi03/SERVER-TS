// src/utils/logAnalysisJournal/journalTaskHandlers.ts
import { JournalLogEventHandler } from './index';
import { addJournalError, createJournalKey, initializeJournalAnalysisDetail } from './helpers';
import { JournalAnalysisDetail } from '../../types/logAnalysisJournal/logAnalysisJournal.types'; // For explicit typing

const ensureJournalDetail = (
    logEntry: any,
    results: import('../../types/logAnalysisJournal/logAnalysisJournal.types').JournalLogAnalysisResult,
    entryTimestampISO: string
): JournalAnalysisDetail | null => {
    const batchRequestId = logEntry.batchRequestId;
    // Try to get title from various common fields
    const journalTitle = logEntry.journalTitle // Preferred from crawlJournals task loggers
                        || logEntry.title // Common in googleSearch, scimagojr
                        || (logEntry.context && (logEntry.context.journalTitle || logEntry.context.title))
                        || (logEntry.row && (logEntry.row.Title || logEntry.row.journalName)); // From CSVRow or TableRowData if in context

    const sourceId = logEntry.sourceId
                     || (logEntry.context && logEntry.context.sourceId)
                     || (logEntry.row && logEntry.row.Sourceid);

    if (!batchRequestId || !journalTitle) {
        // console.warn("Cannot ensure journal detail: missing batchRequestId or journalTitle", logEntry);
        return null;
    }

    const journalKey = createJournalKey(batchRequestId, journalTitle, sourceId);
    if (!journalKey) return null;

    if (!results.journalAnalysis[journalKey]) {
        const dataSource = logEntry.dataSource // from crawlJournals
                         || (logEntry.context && logEntry.context.dataSource)
                         || (results.requests[batchRequestId] && results.requests[batchRequestId].dataSource) // from request summary
                         || 'unknown';
        const originalInput = logEntry.url || (logEntry.row ? JSON.stringify(logEntry.row).substring(0,100) : undefined);

        results.journalAnalysis[journalKey] = initializeJournalAnalysisDetail(
            batchRequestId,
            journalTitle,
            dataSource,
            sourceId,
            originalInput
        );
    }
    return results.journalAnalysis[journalKey];
};


export const handleJournalTaskStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        if (journalDetail.status === 'unknown' || !journalDetail.startTime) {
            journalDetail.startTime = entryTimestampISO;
            journalDetail.status = 'processing';

            const reqSummary = results.requests[journalDetail.batchRequestId];
            if (reqSummary) {
                // This count is for tasks *started*. Input count comes from summary or dataSource handlers.
            }
        }
        // Determine dataSource if not already set on journalDetail
        if (journalDetail.dataSource === 'unknown') {
            const processType = logEntry.process; // 'scimago' or 'csv' from crawlJournals task loggers
            if (processType === 'scimago') journalDetail.dataSource = 'scimago';
            else if (processType === 'csv') journalDetail.dataSource = 'client';
        }
    }
};

export const handleJournalTaskSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        // Only mark completed if JSONL write was also successful (or not attempted if that's a valid state)
        // The definitive 'completed' status is often tied to successful output.
        // Let's assume for now this event means all processing steps for the journal were successful *before* file write.
        // The final status will be confirmed by append_journal_to_file_success or calculateFinalMetrics.
        if (journalDetail.status !== 'failed' && journalDetail.status !== 'completed') {
             // If all critical steps are done, we can tentatively say 'processed_ok'
             // The 'completed' status will be set by JSONL write success.
             // For now, let's not change status here, let JSONL write or final metrics decide.
        }
        journalDetail.endTime = entryTimestampISO; // Update endTime as this is the end of its active processing
        if (journalDetail.startTime) {
            journalDetail.durationSeconds = Math.round((new Date(entryTimestampISO).getTime() - new Date(journalDetail.startTime).getTime()) / 1000);
        }

        // Check if all sub-steps that were attempted were successful
        let allStepsOk = true;
        if (journalDetail.steps.bioxbio_attempted && journalDetail.steps.bioxbio_success === false) allStepsOk = false;
        if (journalDetail.steps.scimago_details_attempted && journalDetail.steps.scimago_details_success === false) allStepsOk = false;
        if (journalDetail.steps.image_search_attempted && journalDetail.steps.image_search_success === false) allStepsOk = false;

        if (!allStepsOk && journalDetail.status !== 'failed') {
            // If a sub-step failed but the task is logged as "success", it's more like "completed_with_issues"
            // We'll let addJournalError in those sub-step failure handlers add the error.
            // The status will remain 'processing' or become 'failed' via those or final metrics.
        }
    }
};

export const handleJournalTaskFailedUnhandled: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        if (journalDetail.status !== 'failed') {
            journalDetail.status = 'failed';
            results.overall.totalJournalsFailed = (results.overall.totalJournalsFailed || 0) + 1;
        }
        journalDetail.endTime = entryTimestampISO;
        if (journalDetail.startTime) {
            journalDetail.durationSeconds = Math.round((new Date(entryTimestampISO).getTime() - new Date(journalDetail.startTime).getTime()) / 1000);
        }
        addJournalError(journalDetail, entryTimestampISO, logEntry.err || logEntry.message || 'Unhandled task failure', {
            keyPrefix: 'task_unhandled',
            errorType: 'Logic', // Or Unknown
            sourceService: logEntry.service || 'crawlJournals',
            context: { step: 'task_level', ...(logEntry.context || {}) }
        });
    }
};


// Handlers for image search events within a journal's task
export const handleImageSearchStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.image_search_attempted = true;
        results.googleSearch.totalSearchesAttempted = (results.googleSearch.totalSearchesAttempted || 0) + 1;
    }
};

export const handleImageSearchSkipped: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.image_search_attempted = true; // It was attempted, but then skipped
        journalDetail.steps.image_search_success = false; // Skipped is a form of failure for this step
        const reason = logEntry.event?.replace('image_search_skip_', ''); // e.g., 'exhausted', 'no_key'
        addJournalError(journalDetail, entryTimestampISO, `Image search skipped: ${reason}`, {
            keyPrefix: 'image_search_skip',
            errorType: 'Logic', // Or API if due to creds
            sourceService: logEntry.service || 'crawlJournals',
            context: { step: 'image_search_skipped', reason, ...(logEntry.context || {}) }
        });
        if (reason === 'no_cse_id' || reason === 'no_key') { // Assuming no_key implies no API key available from manager
            results.googleSearch.totalSearchesSkippedNoCreds = (results.googleSearch.totalSearchesSkippedNoCreds || 0) + 1;
        }
    }
};

export const handleImageSearchSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.image_search_success = true;
        results.googleSearch.totalSearchesSucceeded = (results.googleSearch.totalSearchesSucceeded || 0) + 1;
        if (logEntry.hasImage) {
            results.googleSearch.totalSearchesWithResults = (results.googleSearch.totalSearchesWithResults || 0) + 1;
            results.overall.processedJournalsWithImageSearchSuccess = (results.overall.processedJournalsWithImageSearchSuccess || 0) + 1;
        }
    }
};

export const handleImageSearchFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.image_search_success = false;
        // totalSearchesFailedAfterRetries is handled by the 'fetch_google_image_failed_after_retries' event from googleSearch.ts
        // This handler just records the failure for this specific journal.
        addJournalError(journalDetail, entryTimestampISO, logEntry.err || 'Image search failed', {
            keyPrefix: 'image_search_task_fail',
            errorType: 'API',
            sourceService: logEntry.service || 'crawlJournals',
            context: { step: 'image_search', ...(logEntry.context || {}) }
        });
    }
};

export const handleImageSearchQuotaError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = ensureJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.image_search_success = false; // Quota error is a failure for this attempt
        journalDetail.steps.image_search_key_rotated_due_to_error = true;
        results.googleSearch.totalQuotaErrorsEncountered = (results.googleSearch.totalQuotaErrorsEncountered || 0) + 1;
        results.apiKeyManager.rotationsDueToError = (results.apiKeyManager.rotationsDueToError || 0) + 1;

        addJournalError(journalDetail, entryTimestampISO, logEntry.err || `Image search quota error: ${logEntry.statusCode}`, {
            keyPrefix: 'image_search_quota',
            errorCode: String(logEntry.statusCode || '429'),
            errorType: 'API',
            sourceService: logEntry.service || 'crawlJournals',
            context: { step: 'image_search_quota', ...(logEntry.context || {}) }
        });
    }
};