import { JournalLogEventHandler } from './index';
import { addJournalError, normalizeErrorKey, findOrCreateJournalDetail } from './helpers';

// --- Scimago Mode Specific (from crawlJournals.ts) ---
export const handleScimagoModeProcessingStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].dataSource = 'scimago';
        results.requests[batchRequestId].totalJournalsInputForRequest = logEntry.urlCount; // Total Scimago URLs (pages)
        results.overall.totalJournalsInput += logEntry.urlCount || 0; // This is pages, not journals yet.
                                                                    // Actual journal count per page varies.
    }
};

export const handleScimagoModeBatchStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational: a batch of Scimago URLs started processing
};

export const handleScimagoModeBatchFinish: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational: a batch of Scimago URLs finished processing
    // logEntry.totalProcessed here is the cumulative count of individual journal items saved.
};

export const handleScimagoModeProcessingError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId;
    const message = logEntry.err?.message || 'Error during Scimago page processing loop.';
    if (batchRequestId && results.requests[batchRequestId]) {
        if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Scimago processing loop error: ${message}`);
        // Potentially mark request as CompletedWithErrors or Failed if this is severe
    }
    results.errorsAggregated[normalizeErrorKey(`scimago_loop_err_${message}`)] = (results.errorsAggregated[normalizeErrorKey(`scimago_loop_err_${message}`)] || 0) + 1;
};


// --- Client Mode Specific (from crawlJournals.ts and utils if parseCSVString logs events) ---
export const handleClientModeStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].dataSource = 'client';
    }
};

export const handleClientDataMissingError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId;
    const message = 'Client data source selected, but no data provided.';
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed';
        if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(message);
    }
    results.errorsAggregated[normalizeErrorKey('client_data_missing')] = (results.errorsAggregated[normalizeErrorKey('client_data_missing')] || 0) + 1;
    results.fileOutput.clientCsvParseFailed = (results.fileOutput.clientCsvParseFailed || 0) + 1; // Count as a parse failure
};

// Assuming parseCSVString in journal/utils.ts logs these:
export const handleParseCsvStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.clientCsvParseAttempts = (results.fileOutput.clientCsvParseAttempts || 0) + 1;
};
export const handleParseCsvSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.clientCsvParseSuccess = (results.fileOutput.clientCsvParseSuccess || 0) + 1;
    // logEntry.rowCount contains the number of CSV rows parsed
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].totalJournalsInputForRequest = logEntry.rowCount;
        results.overall.totalJournalsInput += logEntry.rowCount || 0;
    }
};
export const handleParseCsvFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.fileOutput.clientCsvParseFailed = (results.fileOutput.clientCsvParseFailed || 0) + 1;
    const batchRequestId = logEntry.batchRequestId;
    const message = logEntry.err?.message || 'Failed to parse client CSV string.';
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed'; // Parsing CSV is fundamental
         if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Client CSV parse failed: ${message}`);
    }
    results.errorsAggregated[normalizeErrorKey(`client_csv_parse_fail_${message}`)] = (results.errorsAggregated[normalizeErrorKey(`client_csv_parse_fail_${message}`)] || 0) + 1;
};
// This is from crawlJournals after a successful call to parseCSVString
export const handleClientDataParseOverallSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        // If parseCsvSuccess didn't set it (e.g., if parseCSVString doesn't log rowCount with batchRequestId)
        if (!results.requests[batchRequestId].totalJournalsInputForRequest) {
            results.requests[batchRequestId].totalJournalsInputForRequest = logEntry.rowCount;
            results.overall.totalJournalsInput += logEntry.rowCount || 0;
        }
    }
};


export const handleClientDataEmpty: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // CSV parsed but no records. This is not an error, but good to note.
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].totalJournalsInputForRequest = 0;
        // Status might become 'Completed' if no tasks were expected.
    }
};

export const handleClientModeBatchStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational: a batch of client CSV rows started processing
};

export const handleClientModeBatchFinish: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational: a batch of client CSV rows finished processing
    // logEntry.totalProcessed here is the cumulative count of individual journal items saved.
};

export const handleClientDataProcessingError: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId;
    const message = logEntry.err?.message || 'Error during client data processing loop.';
    if (batchRequestId && results.requests[batchRequestId]) {
         if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Client data processing loop error: ${message}`);
        // Potentially mark request as CompletedWithErrors or Failed
    }
    results.errorsAggregated[normalizeErrorKey(`client_loop_err_${message}`)] = (results.errorsAggregated[normalizeErrorKey(`client_loop_err_${message}`)] || 0) + 1;
};


// --- Events from crawlJournals related to Client CSV row processing (processTabCSV) ---
export const handleClientRowLinkGenerated: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational, journalDetail should be available via context (journalTitle, rowIndex)
};

export const handleClientRowLinkGenerationWarning: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Sử dụng findOrCreateJournalDetail thay vì getJournalDetailForScimago
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, `Scimago link generation warning: ${logEntry.reason}`, {
            keyPrefix: 'client_row_link_warn', errorType: 'Logic', sourceService: 'crawlJournals',
            context: { step: 'client_task_link_gen', reason: logEntry.reason, journalTitle: journalDetail.journalTitle }
        });
    }
};

export const handleClientRowLinkGenerationFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Sử dụng findOrCreateJournalDetail
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.status = 'skipped'; // Or 'failed' if link is essential
        results.overall.totalJournalsSkipped = (results.overall.totalJournalsSkipped || 0) + 1;
        addJournalError(journalDetail, entryTimestampISO, `Scimago link generation failed: ${logEntry.reason}. Skipping row.`, {
            keyPrefix: 'client_row_link_fail', errorType: 'Validation', sourceService: 'crawlJournals',
            context: { step: 'client_task_link_gen_fail', reason: logEntry.reason, journalTitle: journalDetail.journalTitle }
        });
    }
};

export const handleClientRowInitialDataPopulated: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};