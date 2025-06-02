import { JournalLogEventHandler } from './index';
import { addJournalError, normalizeErrorKey, findOrCreateJournalDetail } from './helpers';
import { JournalAnalysisDetail } from '../../types/logAnalysisJournal/logAnalysisJournal.types';


const addScimagoErrorToStats = (results: import('../../types/logAnalysisJournal/logAnalysisJournal.types').JournalLogAnalysisResult, errorKeySuffix: string, errorMessage: string, logEntryService?: string) => {
    results.scimago.totalErrors = (results.scimago.totalErrors || 0) + 1;
    const key = normalizeErrorKey(`scimago_${errorKeySuffix}_${errorMessage}`);
    results.scimago.errorDetails[key] = results.scimago.errorDetails[key] || { count: 0, messages: [] };
    results.scimago.errorDetails[key].count++;
    if (errorMessage && results.scimago.errorDetails[key].messages.length < 5) {
        results.scimago.errorDetails[key].messages.push(errorMessage.substring(0, 200));
    }
};

// --- Scimago List Page Processing (from processPage in scimagojr.ts) ---
export const handleProcessPageStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Start of processing a Scimago page listing multiple journals
    // Not tied to a specific journalDetail yet.
};

export const handleProcessPageSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.scimagoListPagesProcessed = (results.scimago.scimagoListPagesProcessed || 0) + 1;
    // If logEntry.url is available, and we track Scimago list URLs, we can mark this URL as processed.
    // For now, just counting.
};

export const handleProcessPageFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.scimagoListPagesFailed = (results.scimago.scimagoListPagesFailed || 0) + 1;
    const message = logEntry.err?.message || 'Scimago processPage failed';
    addScimagoErrorToStats(results, 'process_page', message, logEntry.service);
    // This error affects a whole page of journals, potentially.
    // It's a batch-level issue rather than a single journal issue.
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Scimago list page failed: ${logEntry.url} - ${message}`);
    }
};

export const handleProcessPageFinish: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // End of processing a Scimago list page.
};


// --- Scimago Detail Page Processing (from fetchDetails in scimagojr.ts) ---
export const handleFetchDetailsSkipNullUrl: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.scimagoDetailPagesSkippedNullUrl = (results.scimago.scimagoDetailPagesSkippedNullUrl || 0) + 1;
};

export const handleFetchDetailsStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.scimagoDetailPagesAttempted = (results.scimago.scimagoDetailPagesAttempted || 0) + 1;
    // Sử dụng findOrCreateJournalDetail. logEntry từ fetchDetails thường có 'journalUrl' và 'function' context.
    // Title có thể không có trực tiếp trong logEntry này, mà phải được suy ra từ journalUrl hoặc từ journalDetail đã có.
    // findOrCreateJournalDetail sẽ cố gắng tìm title nếu có, nếu không thì không tạo mới.
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.scimago_details_attempted = true;
        // Nếu journalDetail mới được tạo và originalInput chưa có, gán journalUrl
        if (!journalDetail.originalInput && logEntry.journalUrl) {
            journalDetail.originalInput = logEntry.journalUrl;
        }
    } else {
        // console.warn("handleFetchDetailsStart: Could not find/create journal detail for Scimago details fetch.", logEntry);
    }
};


export const handleFetchDetailsSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.scimagoDetailPagesSucceeded = (results.scimago.scimagoDetailPagesSucceeded || 0) + 1;
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.scimago_details_success = true;
        results.overall.processedJournalsWithScimagoDetailsSuccess = (results.overall.processedJournalsWithScimagoDetailsSuccess || 0) + 1;
        if (logEntry.detailCount === 0) {
             addJournalError(journalDetail, entryTimestampISO, 'Scimago details fetched successfully but no data was extracted.', {
                keyPrefix: 'scimago_details_empty_data', errorType: 'Validation', sourceService: 'scimagojr',
                context: { step: 'scimago_details_eval', journalUrl: logEntry.journalUrl, journalTitle: journalDetail.journalTitle }
            });
        }
    } else {
        // console.warn("handleFetchDetailsSuccess: Could not find/create journal detail.", logEntry);
    }
};

export const handleFetchDetailsFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.scimagoDetailPagesFailed = (results.scimago.scimagoDetailPagesFailed || 0) + 1;
    const message = logEntry.err?.message || 'Scimago fetchDetails failed';
    addScimagoErrorToStats(results, 'fetch_details', message, logEntry.service);

    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        journalDetail.steps.scimago_details_success = false;
        addJournalError(journalDetail, entryTimestampISO, message, {
            keyPrefix: 'scimago_details_fail', errorType: 'Playwright', sourceService: 'scimagojr',
            context: { step: 'scimago_details_fetch', journalUrl: logEntry.journalUrl, originalError: logEntry.err, journalTitle: journalDetail.journalTitle }
        });
    } else {
        // console.warn("handleFetchDetailsFailed: Could not find/create journal detail.", logEntry);
    }
};
export const handleFetchDetailsWarnEmpty: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail && journalDetail.steps.scimago_details_success === true) {
        addJournalError(journalDetail, entryTimestampISO, 'Scimago details fetched successfully but no data was extracted (warn_empty event).', {
            keyPrefix: 'scimago_details_empty_data_warn', errorType: 'Validation', sourceService: 'scimagojr',
            context: { step: 'scimago_details_eval_warn', journalUrl: logEntry.journalUrl, journalTitle: journalDetail.journalTitle }
        });
    }
};



export const handleFetchDetailsFinish: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // End of fetchDetails attempt for one journal.
};


// --- Scimago Last Page Number (from getLastPageNumber in scimagojr.ts) ---
export const handleGetLastPageStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.lastPageNumberDeterminations = (results.scimago.lastPageNumberDeterminations || 0) + 1;
};
export const handleScimagoLastPageFound: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This is from crawlJournals, after getLastPageNumber succeeded.
    // The actual success of getLastPageNumber is handleGetLastPageSuccess.
};


export const handleGetLastPageSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational, actual page count is in logEntry.pageCount
};

export const handleGetLastPageFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.scimago.lastPageNumberFailures = (results.scimago.lastPageNumberFailures || 0) + 1;
    const message = logEntry.err?.message || 'Scimago getLastPageNumber failed';
    addScimagoErrorToStats(results, 'get_last_page', message, logEntry.service);
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
         if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Scimago: Failed to get last page number - ${message}`);
    }
};
export const handleGetLastPageFinish: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // End of getLastPageNumber attempt.
};

// --- Events from crawlJournals related to Scimago journal row processing ---
export const handleScimagoRowCsvParsed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // This event is within processTabScimago, after parsing the CSV string from a table row.
    // The journalDetail should be available via the context (journalName, scimagoLink).
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        // Can add a step like `journalDetail.steps.scimago_row_csv_parsed = true;` if needed.
    }
};

export const handleScimagoRowCsvParseFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    const journalDetail = findOrCreateJournalDetail(logEntry, results, entryTimestampISO);
    if (journalDetail) {
        addJournalError(journalDetail, entryTimestampISO, logEntry.err || 'Failed to parse CSV data from Scimago row string.', {
            keyPrefix: 'scimago_row_csv_parse_fail', errorType: 'Validation', sourceService: 'crawlJournals', // service là crawlJournals vì event này log từ processTabScimago
            context: { step: 'scimago_task_csv_parse', rawCsv: logEntry.rawCsv, journalTitle: journalDetail.journalTitle }
        });
    }
    // Lỗi này cũng nên được tính vào thống kê chung của Scimago
    addScimagoErrorToStats(results, 'row_csv_parse', logEntry.err?.message || 'parse_failed', 'crawlJournals');
};