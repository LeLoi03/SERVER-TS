// src/utils/logAnalysisJournal/fileOutputJournalHandlers.ts
import { JournalLogEventHandler } from './index';
import { addJournalError, createJournalKey, normalizeErrorKey } from './helpers'; // Assuming helpers are in the same dir or adjust path

export const handlePrepareOutputStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // General info, not tied to a specific journal
};
export const handlePrepareOutputDirSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // General info
};
export const handlePrepareOutputFileStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // General info
};
export const handlePrepareOutputFileSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.outputFileInitialized = true;
    results.fileOutput.outputFileInitFailed = false;
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].jsonlFileGenerated = true; // Tentative, confirmed by actual writes
        results.requests[batchRequestId].jsonlFilePath = logEntry.path;
    }
};
export const handlePrepareOutputFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.outputFileInitFailed = true;
    results.fileOutput.outputFileInitialized = false;
    const batchRequestId = logEntry.batchRequestId;
     if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].jsonlFileGenerated = false;
        if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Output prep failed: ${logEntry.err?.message || 'Unknown error'}`);
    }
    // This is a critical error for the batch
    results.errorsAggregated[normalizeErrorKey(logEntry.err || 'prepare_output_failed')] = (results.errorsAggregated[normalizeErrorKey(logEntry.err || 'prepare_output_failed')] || 0) + 1;
};


// ASSUMING these events are added to appendJournalToFile in journal/utils.ts
export const handleAppendJournalStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.jsonlRecordsAttempted = (results.fileOutput.jsonlRecordsAttempted || 0) + 1;
    // No specific journal action here, journal detail should already exist
};

export const handleAppendJournalSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.jsonlRecordsSuccessfullyWritten = (results.fileOutput.jsonlRecordsSuccessfullyWritten || 0) + 1;

    const batchRequestId = logEntry.batchRequestId;
    const journalTitle = logEntry.journalTitle || (logEntry.context && logEntry.context.journalTitle);
    const sourceId = logEntry.sourceId || (logEntry.context && logEntry.context.sourceId);

    if (batchRequestId && journalTitle) {
        const journalKey = createJournalKey(batchRequestId, journalTitle, sourceId);
        if (journalKey && results.journalAnalysis[journalKey]) {
            const journalDetail = results.journalAnalysis[journalKey];
            journalDetail.steps.jsonl_write_success = true;

            // If all prior steps were successful or not applicable, and JSONL is written, then task is completed.
            let priorStepsOk = true;
            if (journalDetail.steps.bioxbio_attempted && journalDetail.steps.bioxbio_success === false) priorStepsOk = false;
            if (journalDetail.steps.scimago_details_attempted && journalDetail.steps.scimago_details_success === false) priorStepsOk = false;
            if (journalDetail.steps.image_search_attempted && journalDetail.steps.image_search_success === false) priorStepsOk = false;

            if (priorStepsOk && journalDetail.status !== 'failed') {
                if (journalDetail.status !== 'completed') {
                    journalDetail.status = 'completed';
                    results.overall.totalJournalsProcessed = (results.overall.totalJournalsProcessed || 0) + 1;
                    const reqSummary = results.requests[batchRequestId];
                    if (reqSummary) {
                        reqSummary.processedJournalsCountForRequest = (reqSummary.processedJournalsCountForRequest || 0) + 1;
                    }
                }
            } else if (!priorStepsOk && journalDetail.status !== 'failed') {
                // Task completed with errors if JSONL was written despite prior step failures
                journalDetail.status = 'failed'; // Or a new status like 'completed_with_issues'
                results.overall.totalJournalsFailed = (results.overall.totalJournalsFailed || 0) + 1;
                 const reqSummary = results.requests[batchRequestId];
                 if (reqSummary) {
                    reqSummary.failedJournalsCountForRequest = (reqSummary.failedJournalsCountForRequest || 0) + 1;
                 }
                addJournalError(journalDetail, entryTimestampISO, "JSONL written, but prior critical step failed.", {
                    keyPrefix: 'jsonl_write_with_prior_errors',
                    errorType: 'Logic',
                    sourceService: logEntry.service || 'FileOutput',
                    context: { step: 'jsonl_write_final_check', priorSteps: journalDetail.steps }
                });
            }
            // Ensure endTime is set
            if (!journalDetail.endTime) journalDetail.endTime = entryTimestampISO;
            if (journalDetail.startTime && journalDetail.endTime && !journalDetail.durationSeconds) {
                 journalDetail.durationSeconds = Math.round((new Date(journalDetail.endTime).getTime() - new Date(journalDetail.startTime).getTime()) / 1000);
            }
        }
    }
};

export const handleAppendJournalFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.jsonlWriteErrors = (results.fileOutput.jsonlWriteErrors || 0) + 1;
    results.errorsAggregated[normalizeErrorKey(logEntry.err || 'append_journal_failed')] = (results.errorsAggregated[normalizeErrorKey(logEntry.err || 'append_journal_failed')] || 0) + 1;

    const batchRequestId = logEntry.batchRequestId;
    const journalTitle = logEntry.journalTitle || (logEntry.context && logEntry.context.journalTitle);
    const sourceId = logEntry.sourceId || (logEntry.context && logEntry.context.sourceId);

    if (batchRequestId && journalTitle) {
        const journalKey = createJournalKey(batchRequestId, journalTitle, sourceId);
        if (journalKey && results.journalAnalysis[journalKey]) {
            const journalDetail = results.journalAnalysis[journalKey];
            journalDetail.steps.jsonl_write_success = false;
            if (journalDetail.status !== 'failed') {
                journalDetail.status = 'failed';
                results.overall.totalJournalsFailed = (results.overall.totalJournalsFailed || 0) + 1;
                const reqSummary = results.requests[batchRequestId];
                if (reqSummary) {
                    reqSummary.failedJournalsCountForRequest = (reqSummary.failedJournalsCountForRequest || 0) + 1;
                }
            }
            if (!journalDetail.endTime) journalDetail.endTime = entryTimestampISO;
             if (journalDetail.startTime && journalDetail.endTime && !journalDetail.durationSeconds) {
                 journalDetail.durationSeconds = Math.round((new Date(journalDetail.endTime).getTime() - new Date(journalDetail.startTime).getTime()) / 1000);
            }
            addJournalError(journalDetail, entryTimestampISO, logEntry.err || 'Failed to append journal to file', {
                keyPrefix: 'jsonl_write_fail',
                errorType: 'FileSystem',
                sourceService: logEntry.service || 'FileOutput',
                context: { step: 'jsonl_write', filePath: logEntry.filePath, ...(logEntry.context || {}) }
            });
        }
    }
};