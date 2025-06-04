// src/utils/logAnalysisJournal/journalAnalysisMerger.utils.ts
import {
    JournalOverallAnalysis,
    PlaywrightJournalAnalysis,
    ApiKeyManagerJournalAnalysis,
    GoogleSearchJournalAnalysis,
    BioxbioAnalysis,
    ScimagoJournalAnalysis,
    JournalFileOutputAnalysis
} from '../../types/logAnalysisJournal/logAnalysisJournal.types'; // Điều chỉnh đường dẫn nếu cần

/**
 * Helper function to merge error details objects.
 * This can be a shared utility if used in multiple merger functions.
 */
function mergeErrorDetails(
    target: { [key: string]: { count: number; messages: string[] } },
    source: { [key: string]: { count: number; messages: string[] } }
): void {
    for (const key in source) {
        if (target[key]) {
            target[key].count += source[key].count;
            const combinedMessages = [...new Set([...target[key].messages, ...source[key].messages])];
            target[key].messages = combinedMessages.slice(0, 10); // Keep a limited number of unique messages
        } else {
            target[key] = { ...source[key] }; // Clone if it doesn't exist
        }
    }
}

export function mergeOverallJournalAnalysis(target: JournalOverallAnalysis, source: JournalOverallAnalysis, sourceDataSource?: 'scimago' | 'client' | string): void {
    target.totalRequestsAnalyzed += 1; // Each valid single request analysis contributes 1
    if (sourceDataSource === 'scimago') target.dataSourceCounts.scimago++;
    else if (sourceDataSource === 'client') target.dataSourceCounts.client++;
    else target.dataSourceCounts.unknown++;

    target.totalJournalsInput += source.totalJournalsInput;
    target.totalJournalsProcessed += source.totalJournalsProcessed;
    target.totalJournalsFailed += source.totalJournalsFailed;
    target.totalJournalsSkipped += source.totalJournalsSkipped;
    target.processedJournalsWithBioxbioSuccess += source.processedJournalsWithBioxbioSuccess;
    target.processedJournalsWithScimagoDetailsSuccess += source.processedJournalsWithScimagoDetailsSuccess;
    target.processedJournalsWithImageSearchSuccess += source.processedJournalsWithImageSearchSuccess;
}

export function mergePlaywrightJournalAnalysis(target: PlaywrightJournalAnalysis, source: PlaywrightJournalAnalysis): void {
    if (source.browserLaunchTimeMs) target.browserLaunchTimeMs = (target.browserLaunchTimeMs || 0) + source.browserLaunchTimeMs;
    if (source.browserLaunchSuccess) target.browserLaunchSuccess = true; // If any source succeeded, mark as true
    if (source.contextCreateTimeMs) target.contextCreateTimeMs = (target.contextCreateTimeMs || 0) + source.contextCreateTimeMs;
    if (source.contextCreateSuccess) target.contextCreateSuccess = true;
    if (source.pagesCreateTimeMs) target.pagesCreateTimeMs = (target.pagesCreateTimeMs || 0) + source.pagesCreateTimeMs;
    if (source.pagesCreateSuccess) target.pagesCreateSuccess = true;
    target.totalErrors += source.totalErrors;
    mergeErrorDetails(target.errorDetails, source.errorDetails);
}

export function mergeApiKeyManagerJournalAnalysis(target: ApiKeyManagerJournalAnalysis, source: ApiKeyManagerJournalAnalysis): void {
    target.keysInitialized = Math.max(target.keysInitialized, source.keysInitialized);
    target.initializationErrors += source.initializationErrors;
    target.rotationsDueToUsage += source.rotationsDueToUsage;
    target.rotationsDueToError += source.rotationsDueToError;
    target.rotationsFailedExhausted += source.rotationsFailedExhausted;
    target.totalKeysExhaustedReported += source.totalKeysExhaustedReported;
    target.totalRequestsMade += source.totalRequestsMade;
}

export function mergeGoogleSearchJournalAnalysis(target: GoogleSearchJournalAnalysis, source: GoogleSearchJournalAnalysis): void {
    target.totalSearchesAttempted += source.totalSearchesAttempted;
    target.totalSearchesSucceeded += source.totalSearchesSucceeded;
    target.totalSearchesFailedAfterRetries += source.totalSearchesFailedAfterRetries;
    target.totalSearchesSkippedNoCreds += source.totalSearchesSkippedNoCreds;
    target.totalSearchesWithResults += source.totalSearchesWithResults;
    target.totalQuotaErrorsEncountered += source.totalQuotaErrorsEncountered;
    mergeErrorDetails(target.apiErrors, source.apiErrors);
}

export function mergeBioxbioAnalysis(target: BioxbioAnalysis, source: BioxbioAnalysis): void {
    target.totalFetchesAttempted += source.totalFetchesAttempted;
    target.totalFetchesSucceeded += source.totalFetchesSucceeded;
    target.totalFetchesFailed += source.totalFetchesFailed;
    target.cacheHits += source.cacheHits;
    target.cacheMisses += source.cacheMisses;
    target.totalErrors += source.totalErrors;
    mergeErrorDetails(target.errorDetails, source.errorDetails);
}

export function mergeScimagoJournalAnalysis(target: ScimagoJournalAnalysis, source: ScimagoJournalAnalysis): void {
    target.scimagoListPagesProcessed += source.scimagoListPagesProcessed;
    target.scimagoListPagesFailed += source.scimagoListPagesFailed;
    target.scimagoDetailPagesAttempted += source.scimagoDetailPagesAttempted;
    target.scimagoDetailPagesSucceeded += source.scimagoDetailPagesSucceeded;
    target.scimagoDetailPagesFailed += source.scimagoDetailPagesFailed;
    target.scimagoDetailPagesSkippedNullUrl += source.scimagoDetailPagesSkippedNullUrl;
    target.lastPageNumberDeterminations += source.lastPageNumberDeterminations;
    target.lastPageNumberFailures += source.lastPageNumberFailures;
    target.totalErrors += source.totalErrors;
    mergeErrorDetails(target.errorDetails, source.errorDetails);
}

export function mergeJournalFileOutputAnalysis(target: JournalFileOutputAnalysis, source: JournalFileOutputAnalysis): void {
    target.jsonlRecordsAttempted += source.jsonlRecordsAttempted;
    target.jsonlRecordsSuccessfullyWritten += source.jsonlRecordsSuccessfullyWritten;
    target.jsonlWriteErrors += source.jsonlWriteErrors;
    if (source.outputFileInitialized) target.outputFileInitialized = true;
    if (source.outputFileInitFailed) target.outputFileInitFailed = true; // If any source failed init, mark as failed
    target.clientCsvParseAttempts += source.clientCsvParseAttempts;
    target.clientCsvParseSuccess += source.clientCsvParseSuccess;
    target.clientCsvParseFailed += source.clientCsvParseFailed;
}