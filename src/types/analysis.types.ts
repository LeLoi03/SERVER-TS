// src/types/analysis.types.ts
import { RequestTimings, LogError } from './common.types';
import { GoogleSearchAnalysis } from './search.types';
import { GeminiApiAnalysis } from './gemini.types';
import { PlaywrightAnalysis } from './playwright.types';
import { BatchProcessingAnalysis } from './batchProcessing.types';
import { FileOutputAnalysis } from './fileOutput.types';
import { ValidationStats, DataQualityInsight } from './validation.types';

/**
 * Overall summary of the log analysis.
 */
export interface OverallAnalysis {
    /** The start time of the analysis period (ISO string), or null. */
    startTime: string | null;
    /** The end time of the analysis period (ISO string), or null. */
    endTime: string | null;
    /** The total duration of the analysis period in seconds, or null. */
    durationSeconds: number | null;
    /** The total number of conferences initially fed as input. */
    totalConferencesInput: number;
    /** The total number of conferences that were processed to completion (regardless of internal errors). */
    processedConferencesCount: number;
    /** The number of tasks that fully completed successfully. */
    completedTasks: number;
    /** The number of tasks that failed or crashed. */
    failedOrCrashedTasks: number;
    /** The number of tasks currently in processing. */
    processingTasks: number;
    /** The number of tasks that were skipped entirely. */
    skippedTasks: number;
    /** The number of successful extractions performed by the AI models. */
    successfulExtractions: number;
}


export type ConferenceCrawlType = 'crawl' | 'update'; // Đảm bảo type này tồn tại


/**
 * Detailed analysis of the processing of a specific conference within a batch.
 * Provides a granular view of each step of the crawl for a single conference.
 */
export interface ConferenceAnalysisDetail {
    /** The batch request ID this conference belongs to. */
    batchRequestId: string;
    /** Optional: The original request ID if this conference was part of a re-crawl. */
    originalRequestId?: string;
    /** Crawl Type */
    crawlType: ConferenceCrawlType;
    persistedSaveStatus?: 'SAVED_TO_DATABASE' | string; // Trạng thái lưu trữ bền vững
    persistedSaveTimestamp?: string; // Thời điểm ghi nhận lưu trữ bền vững (từ clientTimestamp)
    /** The title of the conference. */
    title: string;
    /** The acronym of the conference. */
    acronym: string;
    /** The status of this specific conference's processing. */
    status: 'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped';
    /** The start time of processing for this conference (ISO string), or null. */
    startTime: string | null;
    /** The end time of processing for this conference (ISO string), or null. */
    endTime: string | null;
    /** The duration of processing for this conference in seconds, or null. */
    durationSeconds: number | null;
    /** Optional: The end time of the overall crawling process for this conference (ISO string). */
    crawlEndTime?: string | null;
    /** Optional: Indicates if crawling succeeded without errors for this specific conference. */
    crawlSucceededWithoutError?: boolean | null;
    /** Optional: Indicates if writing to JSONL was successful for this conference. */
    jsonlWriteSuccess?: boolean | null;
    /** Optional: Indicates if writing to CSV was successful for this conference. */
    csvWriteSuccess?: boolean | null;
    /** Detailed breakdown of each step taken for this conference. */
    steps: {
        search_attempted: boolean;
        search_success: boolean | null;
        search_attempts_count: number;
        search_results_count: number | null;
        search_filtered_count: number | null;

        html_save_attempted: boolean;
        html_save_success: boolean | 'skipped' | null;
        link_processing_attempted_count: number;
        link_processing_success_count: number;
        link_processing_failed_details: Array<{
            timestamp: string; // ISO string
            url?: string;
            error?: string;
            event?: string;
        }>;

        gemini_determine_attempted: boolean;
        gemini_determine_success: boolean | null;
        gemini_determine_cache_used: boolean | null;
        gemini_extract_attempted: boolean;
        gemini_extract_success: boolean | null;
        gemini_extract_cache_used: boolean | null;
        gemini_cfp_attempted?: boolean;
        gemini_cfp_success?: boolean | null;
        gemini_cfp_cache_used?: boolean | null;
    };
    /** An array of errors specifically encountered for this conference during its processing. */
    errors: LogError[];
    /** Optional: An array of data quality insights generated for this conference. */
    dataQualityInsights?: DataQualityInsight[];
    /** Optional: A preview of the final processed result for this conference. */
    finalResultPreview?: any; // Consider a more specific type if schema is known
    /** Optional: The full final processed result for this conference. */
    finalResult?: any; // Consider a more specific type if schema is known
}

/**
 * The comprehensive result structure for a complete log analysis operation.
 * Aggregates all insights from various components of the crawl pipeline.
 */
export interface LogAnalysisResult {
    /** ISO timestamp when this analysis was generated. */
    analysisTimestamp: string;
    /** The file path of the log file(s) that were analyzed. */
    logFilePath: string;
    /**
     * The overall status of the analysis itself.
     * - 'Completed': Analysis ran to completion. (All task completed)
     * - 'Failed': Analysis process failed. (All task falied).
     * - 'Processing': Analysis is still running. 
     * - 'CompletedWithErrors': Analysis completed, but encountered internal errors.
     * - 'PartiallyCompleted': Analysis completed partially.
     * - 'NoRequestsAnalyzed': No requests were found or analyzed based on filters.
     * - 'Unknown': Status could not be determined.
     */
    status?:
    | 'Completed'
    | 'Failed'
    | 'Processing'
    | 'CompletedWithErrors'
    | 'PartiallyCompleted'
    | 'NoRequestsAnalyzed'
    | 'Unknown';
    /** Optional: An error message if the analysis itself failed. */
    errorMessage?: string;
    /** Optional: The specific request ID that was filtered for analysis. */
    filterRequestId?: string;
    /** An array of all batch request IDs that were included in this analysis. */
    analyzedRequestIds: string[];

    /** A dictionary of `RequestTimings` indexed by `batchRequestId`. */
    requests: {
        [batchRequestId: string]: RequestTimings;
    };

    /** Total number of raw log entries read. */
    totalLogEntries: number;
    /** Number of log entries successfully parsed. */
    parsedLogEntries: number;
    /** Number of errors encountered during log parsing. */
    parseErrors: number;
    /** Number of log entries classified as 'error' level. */
    errorLogCount: number;
    /** Number of log entries classified as 'fatal' level. */
    fatalLogCount: number;

    /** Analysis specific to Google Search operations. */
    googleSearch: GoogleSearchAnalysis;
    /** Analysis specific to Playwright (web scraping) operations. */
    playwright: PlaywrightAnalysis;
    /** Analysis specific to Gemini API interactions. */
    geminiApi: GeminiApiAnalysis;
    /** Analysis specific to batch processing operations. */
    batchProcessing: BatchProcessingAnalysis;
    /** Analysis specific to file output operations (JSONL, CSV). */
    fileOutput: FileOutputAnalysis;
    /** Aggregated statistics on data validation and normalization. */
    validationStats: ValidationStats;

    /** Overall summary statistics. */
    overall: OverallAnalysis;

    /** Aggregated counts of all unique error messages encountered, normalized. */
    errorsAggregated: { [normalizedErrorKey: string]: number };
    /** An array of general errors encountered during the log processing (e.g., file read errors). */
    logProcessingErrors: string[];

    /** A dictionary of `ConferenceAnalysisDetail` objects, indexed by a composite key (e.g., `batchRequestId-conferenceTitle`). */
    conferenceAnalysis: {
        [compositeKey: string]: ConferenceAnalysisDetail;
    };
}