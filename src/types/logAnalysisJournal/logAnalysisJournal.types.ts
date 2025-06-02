// src/types/logAnalysisJournal.types.ts
import { Writable } from 'stream';

// --- Basic Log Error Structure ---
export interface LogErrorContext {
    phase?: 'initialization' | 'processing' | 'api_call' | 'response_processing' | 'file_output' | 'cleanup';
    step?: string; // e.g., 'bioxbio_fetch', 'scimago_details', 'image_search'
    [key: string]: any;
}

export interface LogError {
    timestamp: string;
    message: string;
    key: string; // Normalized error key for aggregation
    details?: any;
    errorCode?: string;
    sourceService?: string;
    errorType?: 'Network' | 'API' | 'Playwright' | 'FileSystem' | 'Validation' | 'Logic' | 'Cache' | 'Unknown' | 'ThirdParty';
    isRecovered: boolean;
    context?: LogErrorContext;
}

// --- Journal Specific Analysis Detail ---
export interface JournalAnalysisDetailSteps {
    // Scimago page processing (for dataSource='scimago')
    scimago_page_processed?: boolean | null; // True if processPage for the Scimago page containing this journal (or its URL) succeeded

    // Bioxbio
    bioxbio_attempted: boolean;
    bioxbio_success: boolean | null;
    bioxbio_cache_used: boolean | null;

    // Scimago Details (specific journal page)
    scimago_details_attempted: boolean;
    scimago_details_success: boolean | null;

    // Image Search (Google)
    image_search_attempted: boolean;
    image_search_success: boolean | null;
    image_search_key_rotated_due_to_error?: boolean;

    // Output
    jsonl_write_success: boolean | null;
}

export interface JournalAnalysisDetail {
    batchRequestId: string;
    journalTitle: string; // Primary identifier
    sourceId?: string; // Secondary identifier, if available
    dataSource: 'scimago' | 'client' | 'unknown';
    originalInput?: string; // URL for scimago, or part of CSV row for client

    status: 'unknown' | 'processing' | 'completed' | 'failed' | 'skipped';
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;

    steps: JournalAnalysisDetailSteps;
    errors: LogError[];
    finalResultPreview?: Partial<any>; // Preview of the final JSONL object
    finalResult?: any; // Full final JSONL object (optional, could be large)
}

// --- Per-Request Summary ---
export interface JournalRequestSummary {
    batchRequestId: string;
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    status: 'Unknown' | 'Processing' | 'Completed' | 'CompletedWithErrors' | 'Failed' | 'NoData' | 'PartiallyCompleted' | 'Skipped';
    dataSource?: 'scimago' | 'client';
    totalJournalsInputForRequest?: number; // Total Scimago URLs or CSV rows for this batch
    processedJournalsCountForRequest?: number; // Journals successfully written to JSONL
    failedJournalsCountForRequest?: number;
    jsonlFileGenerated?: boolean; // True if the main JSONL output file was created
    jsonlFilePath?: string;
    errorMessages?: string[]; // Key error messages for this request
}

// --- Aggregated Statistics for Sub-systems ---
export interface JournalOverallAnalysis {
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    totalRequestsAnalyzed: number;
    dataSourceCounts: {
        scimago: number;
        client: number;
        unknown: number;
    };
    totalJournalsInput: number; // Sum of totalJournalsInputForRequest across all analyzed requests
    totalJournalsProcessed: number; // Sum of processedJournalsCountForRequest
    totalJournalsFailed: number;
    totalJournalsSkipped: number; // If any explicit skip logic is added
    processedJournalsWithBioxbioSuccess: number;
    processedJournalsWithScimagoDetailsSuccess: number;
    processedJournalsWithImageSearchSuccess: number;
}

export interface PlaywrightJournalAnalysis {
    browserLaunchTimeMs?: number;
    browserLaunchSuccess?: boolean;
    contextCreateTimeMs?: number;
    contextCreateSuccess?: boolean;
    pagesCreateTimeMs?: number;
    pagesCreateSuccess?: boolean;
    totalErrors: number;
    errorDetails: { [key: string]: { count: number; messages: string[] } };
}

export interface ApiKeyManagerJournalAnalysis {
    keysInitialized: number;
    initializationErrors: number;
    rotationsDueToUsage: number;
    rotationsDueToError: number; // Specifically for image search quota errors
    rotationsFailedExhausted: number;
    totalKeysExhaustedReported: number; // Count of 'all_keys_exhausted' events
    totalRequestsMade: number; // Sum of ApiKeyManager.getTotalRequests() from summaries
}

export interface GoogleSearchJournalAnalysis {
    totalSearchesAttempted: number;
    totalSearchesSucceeded: number; // Got a 2xx response, even if no items
    totalSearchesFailedAfterRetries: number; // Failed after all retries
    totalSearchesSkippedNoCreds: number;
    totalSearchesWithResults: number; // Found imageLink
    totalQuotaErrorsEncountered: number; // Count of 429/403 errors leading to key rotation
    apiErrors: { [key: string]: { count: number; messages: string[] } }; // e.g., '403', '429', '500'
}

export interface BioxbioAnalysis {
    totalFetchesAttempted: number;
    totalFetchesSucceeded: number; // Got data (even if empty array)
    totalFetchesFailed: number; // Failed after retries or no match
    cacheHits: number;
    cacheMisses: number;
    totalErrors: number; // Errors during the fetch process (navigation, evaluation)
    errorDetails: { [key: string]: { count: number; messages: string[] } };
}

export interface ScimagoJournalAnalysis {
    // For Scimago pages (listing multiple journals)
    scimagoListPagesProcessed: number;
    scimagoListPagesFailed: number;
    // For individual Scimago journal detail pages
    scimagoDetailPagesAttempted: number;
    scimagoDetailPagesSucceeded: number;
    scimagoDetailPagesFailed: number;
    scimagoDetailPagesSkippedNullUrl: number;
    lastPageNumberDeterminations: number;
    lastPageNumberFailures: number;
    totalErrors: number; // General errors in scimagojr.ts functions
    errorDetails: { [key: string]: { count: number; messages: string[] } };
}

export interface JournalFileOutputAnalysis {
    jsonlRecordsAttempted: number; // Based on append_journal_to_file_start
    jsonlRecordsSuccessfullyWritten: number;
    jsonlWriteErrors: number;
    outputFileInitialized: boolean | null; // From prepare_output_file_success
    outputFileInitFailed: boolean | null;
    clientCsvParseAttempts: number;
    clientCsvParseSuccess: number;
    clientCsvParseFailed: number;
}

// --- Main Log Analysis Result Structure for Journals ---
export interface JournalLogAnalysisResult {
    analysisTimestamp: string;
    logFilePath: string;
    status: 'Processing' | 'Completed' | 'CompletedWithErrors' | 'Failed' | 'NoRequestsAnalyzed' | 'PartiallyCompleted' | 'Unknown';
    errorMessage?: string;
    filterRequestId?: string; // If analysis was filtered to a single batchRequestId
    analyzedRequestIds: string[];
    requests: { [batchRequestId: string]: JournalRequestSummary };

    totalLogEntries: number;
    parsedLogEntries: number;
    parseErrors: number;
    errorLogCount: number; // pino level >= 50
    fatalLogCount: number; // pino level >= 60

    // Aggregated statistics
    overall: JournalOverallAnalysis;
    playwright: PlaywrightJournalAnalysis;
    apiKeyManager: ApiKeyManagerJournalAnalysis; // For Google Search keys
    googleSearch: GoogleSearchJournalAnalysis; // For image search
    bioxbio: BioxbioAnalysis;
    scimago: ScimagoJournalAnalysis;
    fileOutput: JournalFileOutputAnalysis;

    errorsAggregated: { [normalizedErrorKey: string]: number };
    logProcessingErrors: string[]; // Errors from the log analysis process itself
    journalAnalysis: { [compositeKey: string]: JournalAnalysisDetail }; // Key: batchRequestId-journalTitle
}


// --- For readAndGroupLogs ---
export interface JournalRequestLogData {
    logs: any[];
    startTime: number | null;
    endTime: number | null;
    dataSource?: 'scimago' | 'client'; // To be populated early
}

export interface JournalReadLogResult {
    requestsData: Map<string, JournalRequestLogData>;
    totalEntries: number;
    parsedEntries: number;
    parseErrors: number;
    logProcessingErrors: string[];
}

export interface JournalFilteredData {
    filteredRequests: Map<string, JournalRequestLogData>;
    analysisStartMillis: number | null;
    analysisEndMillis: number | null;
}

// For pino.destination
export interface PinoFileDestination extends Writable {
  flushSync(): void;
}