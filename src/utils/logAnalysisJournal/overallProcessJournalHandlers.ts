// src/utils/logAnalysisJournal/overallProcessJournalHandlers.ts
import { JournalLogEventHandler } from './index';
import { addJournalError, createJournalKey, initializeJournalAnalysisDetail } from './helpers';

export const handleCrawlJournalsInitStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.overall.startTime = results.overall.startTime || entryTimestampISO;
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && !results.requests[batchRequestId]) {
        results.requests[batchRequestId] = {
            batchRequestId,
            startTime: entryTimestampISO,
            endTime: null,
            durationSeconds: null,
            status: 'Processing',
            dataSource: logEntry.dataSource, // Capture dataSource early
            jsonlFilePath: logEntry.outputFile,
            errorMessages: [],
        };
        if (!results.analyzedRequestIds.includes(batchRequestId)) {
            results.analyzedRequestIds.push(batchRequestId);
            results.overall.totalRequestsAnalyzed++;
            if (logEntry.dataSource === 'scimago') results.overall.dataSourceCounts.scimago++;
            else if (logEntry.dataSource === 'client') results.overall.dataSourceCounts.client++;
            else results.overall.dataSourceCounts.unknown++;
        }
    }
    results.fileOutput.outputFileInitialized = false; // Will be true on prepare_output_file_success
};

export const handleCrawlJournalsSummary: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.overall.endTime = entryTimestampISO;
    if (results.overall.startTime) {
        results.overall.durationSeconds = Math.round((new Date(entryTimestampISO).getTime() - new Date(results.overall.startTime).getTime()) / 1000);
    }

    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        const reqSummary = results.requests[batchRequestId];
        reqSummary.endTime = entryTimestampISO;
        if (reqSummary.startTime) {
            reqSummary.durationSeconds = Math.round((new Date(entryTimestampISO).getTime() - new Date(reqSummary.startTime).getTime()) / 1000);
        }
        // Update overall counts from summary if not already captured by individual task handlers
        // This acts as a fallback or final count.
        results.overall.totalJournalsInput = (results.overall.totalJournalsInput || 0) + (logEntry.totalTasksDefined || 0);
        results.overall.totalJournalsProcessed = (results.overall.totalJournalsProcessed || 0) + (logEntry.journalsProcessedAndSaved || 0);

        reqSummary.totalJournalsInputForRequest = logEntry.totalTasksDefined;
        reqSummary.processedJournalsCountForRequest = logEntry.journalsProcessedAndSaved;
        reqSummary.failedJournalsCountForRequest = (logEntry.totalTasksDefined || 0) - (logEntry.journalsProcessedAndSaved || 0); // Approximation

        if (logEntry.journalsProcessedAndSaved > 0 && results.fileOutput.outputFileInitialized) {
            reqSummary.jsonlFileGenerated = true;
        }
    }

    results.apiKeyManager.totalRequestsMade = (results.apiKeyManager.totalRequestsMade || 0) + (logEntry.totalGoogleApiRequests || 0);
    if (logEntry.keysExhausted) {
        results.apiKeyManager.totalKeysExhaustedReported = (results.apiKeyManager.totalKeysExhaustedReported || 0) + 1;
    }
    results.googleSearch.totalSearchesFailedAfterRetries = (results.googleSearch.totalSearchesFailedAfterRetries || 0) + (logEntry.imageSearchesFailed || 0);
    // Note: imageSearchesSkipped is handled by specific skip events
};

export const handleCrawlJournalsEnd: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This event might be redundant if crawl_summary is always present and marks the true end.
    // If it can occur later, it might update endTime.
    if (!results.overall.endTime) {
        results.overall.endTime = entryTimestampISO;
    }
    const batchRequestId = logEntry.batchRequestId;
     if (batchRequestId && results.requests[batchRequestId] && !results.requests[batchRequestId].endTime) {
        results.requests[batchRequestId].endTime = entryTimestampISO;
        // Recalculate duration if needed
    }
};

export const handleCrawlJournalsFatalError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.status = 'Failed';
    results.errorMessage = results.errorMessage ? `${results.errorMessage}; ${logEntry.err?.message || 'Fatal error'}` : (logEntry.err?.message || 'Fatal error');
    results.fatalLogCount++;

    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed';
        results.requests[batchRequestId].endTime = entryTimestampISO;
        if (!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Fatal: ${logEntry.err?.message || 'Unknown fatal error'}`);
    }

    // If a specific journal was being processed, mark it as failed.
    // This requires context (journalTitle, sourceId) in the fatal error log, which might not always be there.
    const journalTitle = logEntry.journalTitle || logEntry.context?.journalTitle;
    const sourceId = logEntry.sourceId || logEntry.context?.sourceId;
    if (batchRequestId && journalTitle) {
        const journalKey = createJournalKey(batchRequestId, journalTitle, sourceId);
        if (journalKey && results.journalAnalysis[journalKey]) {
            const journalDetail = results.journalAnalysis[journalKey];
            if (journalDetail.status !== 'failed') {
                 journalDetail.status = 'failed';
                 journalDetail.endTime = entryTimestampISO;
                 addJournalError(journalDetail, entryTimestampISO, logEntry.err || 'Fatal error during its processing', {
                    keyPrefix: 'journal_fatal_context',
                    errorType: 'Unknown', // Or more specific if err object has info
                    sourceService: logEntry.service || 'crawlJournals',
                 });
            }
        }
    }
};

export const handleControllerProcessingFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.status = 'Failed'; // Overall analysis status
    const batchRequestId = logEntry.batchRequestId;
    const errorMessage = logEntry.err?.message || 'Processing failed in controller';
    results.errorMessage = results.errorMessage ? `${results.errorMessage}; Controller: ${errorMessage}` : `Controller: ${errorMessage}`;


    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed';
        results.requests[batchRequestId].endTime = entryTimestampISO;
         if (!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(errorMessage);
    } else if (batchRequestId) { // Request might not have been initialized if error is very early
        results.requests[batchRequestId] = {
            batchRequestId,
            startTime: null, // May not have started
            endTime: entryTimestampISO,
            durationSeconds: null,
            status: 'Failed',
            dataSource: undefined,
            errorMessages: [errorMessage],
        };
        if (!results.analyzedRequestIds.includes(batchRequestId)) {
            results.analyzedRequestIds.push(batchRequestId);
            results.overall.totalRequestsAnalyzed++;
        }
    }
};