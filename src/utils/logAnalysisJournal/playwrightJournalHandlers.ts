import { JournalLogEventHandler } from './index';
import { addJournalError, normalizeErrorKey } from './helpers'; // Assuming helpers.ts is in the same directory or adjust path

// --- Browser Lifecycle ---
let browserLaunchStartTime: number | null = null;
export const handleBrowserLaunchStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    browserLaunchStartTime = new Date(entryTimestampISO).getTime();
    results.playwright.browserLaunchSuccess = undefined; // Reset for this attempt
};

export const handleBrowserLaunchSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.browserLaunchSuccess = true;
    if (browserLaunchStartTime) {
        results.playwright.browserLaunchTimeMs = new Date(entryTimestampISO).getTime() - browserLaunchStartTime;
        browserLaunchStartTime = null;
    }
};

export const handleBrowserLaunchFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.browserLaunchSuccess = false;
    if (browserLaunchStartTime) {
        results.playwright.browserLaunchTimeMs = new Date(entryTimestampISO).getTime() - browserLaunchStartTime;
        browserLaunchStartTime = null;
    }
    results.playwright.totalErrors = (results.playwright.totalErrors || 0) + 1;
    const errKey = normalizeErrorKey(logEntry.err || 'browser_launch_failed');
    results.playwright.errorDetails[errKey] = results.playwright.errorDetails[errKey] || { count: 0, messages: [] };
    results.playwright.errorDetails[errKey].count++;
    if (logEntry.err?.message && results.playwright.errorDetails[errKey].messages.length < 5) {
        results.playwright.errorDetails[errKey].messages.push(logEntry.err.message);
    }
    // This is a critical failure for the batch
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed';
         if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Playwright: Browser launch failed - ${logEntry.err?.message || 'Unknown error'}`);
    }
};

// --- Context Lifecycle ---
let contextCreateStartTime: number | null = null;
export const handleContextCreateStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    contextCreateStartTime = new Date(entryTimestampISO).getTime();
    results.playwright.contextCreateSuccess = undefined;
};

export const handleContextCreateSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.contextCreateSuccess = true;
    if (contextCreateStartTime) {
        results.playwright.contextCreateTimeMs = new Date(entryTimestampISO).getTime() - contextCreateStartTime;
        contextCreateStartTime = null;
    }
};

export const handleContextCreateFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.contextCreateSuccess = false;
    if (contextCreateStartTime) {
        results.playwright.contextCreateTimeMs = new Date(entryTimestampISO).getTime() - contextCreateStartTime;
        contextCreateStartTime = null;
    }
    results.playwright.totalErrors = (results.playwright.totalErrors || 0) + 1;
    const errKey = normalizeErrorKey(logEntry.err || 'context_create_failed');
    results.playwright.errorDetails[errKey] = results.playwright.errorDetails[errKey] || { count: 0, messages: [] };
    results.playwright.errorDetails[errKey].count++;
     if (logEntry.err?.message && results.playwright.errorDetails[errKey].messages.length < 5) {
        results.playwright.errorDetails[errKey].messages.push(logEntry.err.message);
    }
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed';
        if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Playwright: Context creation failed - ${logEntry.err?.message || 'Unknown error'}`);
    }
};

// --- Pages Lifecycle ---
let pagesCreateStartTime: number | null = null;
export const handlePagesCreateStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    pagesCreateStartTime = new Date(entryTimestampISO).getTime();
    results.playwright.pagesCreateSuccess = undefined;
};

export const handlePagesCreateSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.pagesCreateSuccess = true;
    if (pagesCreateStartTime) {
        results.playwright.pagesCreateTimeMs = new Date(entryTimestampISO).getTime() - pagesCreateStartTime;
        pagesCreateStartTime = null;
    }
};

export const handlePagesCreateFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.pagesCreateSuccess = false;
    if (pagesCreateStartTime) {
        results.playwright.pagesCreateTimeMs = new Date(entryTimestampISO).getTime() - pagesCreateStartTime;
        pagesCreateStartTime = null;
    }
    results.playwright.totalErrors = (results.playwright.totalErrors || 0) + 1;
    const errKey = normalizeErrorKey(logEntry.err || 'pages_create_failed');
    results.playwright.errorDetails[errKey] = results.playwright.errorDetails[errKey] || { count: 0, messages: [] };
    results.playwright.errorDetails[errKey].count++;
    if (logEntry.err?.message && results.playwright.errorDetails[errKey].messages.length < 5) {
        results.playwright.errorDetails[errKey].messages.push(logEntry.err.message);
    }
    const batchRequestId = logEntry.batchRequestId;
    if (batchRequestId && results.requests[batchRequestId]) {
        results.requests[batchRequestId].status = 'Failed';
        if(!results.requests[batchRequestId].errorMessages) results.requests[batchRequestId].errorMessages = [];
        results.requests[batchRequestId].errorMessages!.push(`Playwright: Page creation failed - ${logEntry.err?.message || 'Unknown error'}`);
    }
};

// --- Browser Close ---
export const handleBrowserCloseStart: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};
export const handleBrowserCloseSuccess: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};
export const handleBrowserCloseFailed: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    results.playwright.totalErrors = (results.playwright.totalErrors || 0) + 1;
    const errKey = normalizeErrorKey(logEntry.err || 'browser_close_failed');
    results.playwright.errorDetails[errKey] = results.playwright.errorDetails[errKey] || { count: 0, messages: [] };
    results.playwright.errorDetails[errKey].count++;
    if (logEntry.err?.message && results.playwright.errorDetails[errKey].messages.length < 5) {
        results.playwright.errorDetails[errKey].messages.push(logEntry.err.message);
    }
};
export const handleBrowserCloseSkipped: JournalLogEventHandler = (logEntry, results, _journalDetail, entryTimestampISO) => {
    // Informational
};