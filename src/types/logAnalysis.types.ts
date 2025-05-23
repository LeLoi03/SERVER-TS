// // src/types/logAnalysis.types.ts

// /**
//  * Defines high-level health metrics related to Google Custom Search API key rotations and usage.
//  */
// export interface GoogleSearchHealthData {
//     /** The number of successful API key rotations. */
//     rotationsSuccess: number;
//     /** The number of failed API key rotations. */
//     rotationsFailed: number;
//     /** The total count of times all configured API keys were exhausted when attempting to get the next available key. */
//     allKeysExhaustedOnGetNextKey: number;
//     /** The total number of times maximum usage limits (across all keys) were reported as reached. */
//     maxUsageLimitsReachedTotal: number;
//     /** The number of successful search queries that returned no items (i.e., empty results). */
//     successfulSearchesWithNoItems: number;
// }

// /**
//  * Provides timing and status information for a specific batch request.
//  */
// export interface RequestTimings {
//     /** The start time of the request in ISO string format, or null if not available. */
//     startTime: string | null;
//     /** The end time of the request in ISO string format, or null if not available. */
//     endTime: string | null;
//     /** The duration of the request in seconds, or null if times are not available. */
//     durationSeconds: number | null;
//     /**
//      * The overall status of the request processing.
//      * - 'Completed': All tasks within the request finished successfully.
//      * - 'Failed': The request processing failed completely.
//      * - 'Processing': The request is still ongoing.
//      * - 'CompletedWithErrors': The request completed, but some sub-tasks had errors.
//      * - 'PartiallyCompleted': The request completed partially, some parts succeeded, others didn't start or were stopped without error.
//      * - 'Skipped': All tasks within the request were skipped (e.g., due to configuration).
//      * - 'NoData': No relevant log data found for this request ID.
//      * - 'Unknown': Status could not be determined.
//      */
//     status?:
//     | 'Completed'
//     | 'Failed'
//     | 'Processing'
//     | 'CompletedWithErrors'
//     | 'PartiallyCompleted'
//     | 'Skipped'
//     | 'NoData'
//     | 'Unknown';
//     /** Optional: The original ID provided for the request, if it was a re-crawl. */
//     originalRequestId?: string;
//     // processedConferencesInRequest?: number; // Optional: Number of conferences processed in this request
//     // conferenceKeys?: string[]; // Optional: List of conference identifiers processed
// }

// /**
//  * Aggregates all relevant log entries for a given batch request ID.
//  * This acts as a container for raw log data pertaining to a single request.
//  */
// export interface RequestLogData {
//     /** An array of raw log entries associated with this request.
//      *  Ideally, this would be `PinoLogEntry[]` if Pino logs have a consistent interface.
//      *  For now, `any[]` is used for flexibility.
//      */
//     logs: any[];
//     /** The earliest Unix timestamp (milliseconds) found for this request. */
//     startTime: number | null;
//     /** The latest Unix timestamp (milliseconds) found for this request. */
//     endTime: number | null;
// }

// /**
//  * Represents the overall result of reading and initially parsing log files.
//  */
// export interface ReadLogResult {
//     /** A Map where keys are `batchRequestId` and values are `RequestLogData` objects. */
//     requestsData: Map<string, RequestLogData>;
//     /** The total number of log entries read from the file(s). */
//     totalEntries: number;
//     /** The number of log entries successfully parsed. */
//     parsedEntries: number;
//     /** The number of errors encountered during log parsing. */
//     parseErrors: number;
//     /** An array of error messages encountered during the log processing (e.g., file read errors). */
//     logProcessingErrors: string[];
// }

// /**
//  * Represents data that has been filtered based on time range or request ID.
//  */
// export interface FilteredData {
//     /** A Map of requests that passed the filter criteria. */
//     filteredRequests: Map<string, RequestLogData>;
//     /** The start timestamp (milliseconds) of the analysis period, based on filters applied. */
//     analysisStartMillis: number | null;
//     /** The end timestamp (milliseconds) of the analysis period, based on filters applied. */
//     analysisEndMillis: number | null;
// }

// /**
//  * Provides an insight into data quality issues or transformations during processing.
//  * Used for logging and reporting potential data discrepancies.
//  */
// export interface DataQualityInsight {
//     /** ISO timestamp when the insight was generated. */
//     timestamp: string;
//     /** The name of the field affected by the insight (e.g., 'location', 'conferenceDates'). */
//     field: string;
//     /** Optional: The original value of the field before any changes or warnings. */
//     originalValue?: any;
//     /** The current value of the field (e.g., after normalization or the value causing the warning). */
//     currentValue: any;
//     /**
//      * The type of insight.
//      * - 'ValidationWarning': Data did not meet expected criteria, but was kept or loosely processed.
//      * - 'NormalizationApplied': Data was transformed or standardized.
//      * - 'DataCorrection': Data was actively corrected based on specific rules.
//      */
//     insightType: 'ValidationWarning' | 'NormalizationApplied' | 'DataCorrection';
//     /** Optional: Severity of the insight, primarily for 'ValidationWarning'. */
//     severity?: 'Low' | 'Medium' | 'High';
//     /** A detailed description of the insight. */
//     message: string;
//     /** Optional: Additional details about the insight. */
//     details?: {
//         /** E.g., "KeptAsIs", "NormalizedToDefault", "RemovedCharacters". */
//         actionTaken?: string;
//         /** The value after normalization, if `insightType` is 'NormalizationApplied'. */
//         normalizedTo?: any;
//         /** The specific rule that was violated, if applicable (e.g., "YEAR_REGEX", "VALID_CONTINENTS"). */
//         ruleViolated?: string;
//     };
// }

// /**
//  * Detailed analysis of the processing of a specific conference within a batch.
//  * Provides a granular view of each step of the crawl for a single conference.
//  */
// export interface ConferenceAnalysisDetail {
//     /** The batch request ID this conference belongs to. */
//     batchRequestId: string;
//     /** Optional: The original request ID if this conference was part of a re-crawl. */
//     originalRequestId?: string;
//     /** The title of the conference. */
//     title: string;
//     /** The acronym of the conference. */
//     acronym: string;
//     /** The status of this specific conference's processing. */
//     status: 'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped';
//     /** The start time of processing for this conference (ISO string), or null. */
//     startTime: string | null;
//     /** The end time of processing for this conference (ISO string), or null. */
//     endTime: string | null;
//     /** The duration of processing for this conference in seconds, or null. */
//     durationSeconds: number | null;
//     /** Optional: The end time of the overall crawling process for this conference (ISO string). */
//     crawlEndTime?: string | null;
//     /** Optional: Indicates if crawling succeeded without errors for this specific conference. */
//     crawlSucceededWithoutError?: boolean | null;
//     /** Optional: Indicates if writing to JSONL was successful for this conference. */
//     jsonlWriteSuccess?: boolean | null;
//     /** Optional: Indicates if writing to CSV was successful for this conference. */
//     csvWriteSuccess?: boolean | null;
//     /** Detailed breakdown of each step taken for this conference. */
//     steps: {
//         search_attempted: boolean;
//         search_success: boolean | null;
//         search_attempts_count: number;
//         search_results_count: number | null;
//         search_filtered_count: number | null;

//         html_save_attempted: boolean;
//         html_save_success: boolean | 'skipped' | null;
//         link_processing_attempted_count: number;
//         link_processing_success_count: number;
//         link_processing_failed_details: Array<{
//             timestamp: string; // ISO string
//             url?: string;
//             error?: string;
//             event?: string;
//         }>;

//         gemini_determine_attempted: boolean;
//         gemini_determine_success: boolean | null;
//         gemini_determine_cache_used: boolean | null;
//         gemini_extract_attempted: boolean;
//         gemini_extract_success: boolean | null;
//         gemini_extract_cache_used: boolean | null;
//         gemini_cfp_attempted?: boolean;
//         gemini_cfp_success?: boolean | null;
//         gemini_cfp_cache_used?: boolean | null;
//     };
//     /** An array of errors specifically encountered for this conference during its processing. */
//     errors: Array<{
//         timestamp: string;
//         message: string;
//         details?: any; // Consider a more specific type if known
//         errorCode?: string; // Specific error code (e.g., 'API_QUOTA_EXCEEDED')
//         sourceService?: string; // The service that originated the error (e.g., 'GoogleSearchService', 'GeminiApiService')
//         errorType?: 'DataParsing' | 'Network' | 'APIQuota' | 'Logic' | 'FileSystem' | 'Unknown'; // Categorization of the error
//     }>;
//     /** Optional: An array of data quality insights generated for this conference. */
//     dataQualityInsights?: DataQualityInsight[];
//     /** Optional: A preview of the final processed result for this conference. */
//     finalResultPreview?: any; // Consider a more specific type if schema is known
//     /** Optional: The full final processed result for this conference. */
//     finalResult?: any; // Consider a more specific type if schema is known
// }

// /**
//  * Comprehensive analysis of Playwright (web scraping) operations.
//  */
// export interface PlaywrightAnalysis {
//     /** Number of attempts to set up the Playwright browser. */
//     setupAttempts: number;
//     /** Whether Playwright setup was ultimately successful (null if not attempted/finished). */
//     setupSuccess: boolean | null;
//     /** Error message or boolean indicating setup failure. */
//     setupError: boolean | string | null;
//     /** Number of errors occurring within the browser context. */
//     contextErrors: number;
//     /** Total number of attempts to save HTML content. */
//     htmlSaveAttempts: number;
//     /** Number of times HTML save operations were successfully initiated. */
//     successfulSaveInitiations: number;
//     /** Number of HTML save operations that failed. */
//     failedSaves: number;
//     /** Number of HTML save operations that were skipped. */
//     skippedSaves: number;
//     /** Breakdown of link processing statistics. */
//     linkProcessing: {
//         /** Total number of links attempted to be accessed and processed. */
//         totalLinksAttempted: number;
//         /** Number of links successfully accessed. */
//         successfulAccess: number;
//         /** Number of links that failed to be accessed. */
//         failedAccess: number;
//         /** Number of redirects encountered during link access. */
//         redirects: number;
//     };
//     /** Count of other unclassified Playwright failures. */
//     otherFailures: number;
//     /** A map of error types to their counts, where keys are normalized error strings. */
//     errorsByType: { [normalizedErrorKey: string]: number };
// }

// /**
//  * Detailed analysis of Gemini API (or other AI API) interactions.
//  */
// export interface GeminiApiAnalysis {
//     // --- Call Stats ---
//     /** Total number of API calls made to Gemini. */
//     totalCalls: number;
//     /** Number of successful API calls. */
//     successfulCalls: number;
//     /** Number of failed API calls. */
//     failedCalls: number;
//     /** Breakdown of API calls by specific API type (e.g., 'extract', 'determine', 'cfp'). */
//     callsByType: { [apiType: string]: number };
//     /** Breakdown of API calls by model name (e.g., 'gemini-pro', 'my-tuned-model'). */
//     callsByModel: { [modelName: string]: number };

//     // --- Retry Stats ---
//     /** Total number of API call retries. */
//     totalRetries: number;
//     /** Breakdown of retries by API type. */
//     retriesByType: { [apiType: string]: number };
//     /** Breakdown of retries by model name. */
//     retriesByModel: { [modelName: string]: number };

//     // --- Model Usage by API Type and Crawl Model ---
//     /**
//      * Detailed breakdown of model usage, including calls, retries, successes, failures, tokens, and safety blocks,
//      * categorized by API type and then by specific model identifier (tuned/non-tuned).
//      */
//     modelUsageByApiType: {
//         [apiType: string]: { // e.g., 'extract', 'determine', 'cfp'
//             [modelIdentifier: string]: { // e.g., "gemini-pro (non-tuned)", "models/my-tuned-model (tuned)"
//                 calls: number;
//                 retries: number;
//                 successes: number;
//                 failures: number;
//                 tokens: number;
//                 safetyBlocks: number;
//             };
//         };
//     };

//     // --- Token Usage ---
//     /** Total number of tokens consumed across all Gemini API calls. */
//     totalTokens: number;

//     // --- Error & Limit Stats ---
//     /** Number of responses blocked due to safety filters. */
//     blockedBySafety: number;
//     /** Number of times the system had to wait due to rate limits. */
//     rateLimitWaits: number;
//     /** Number of intermediate errors that occurred during API calls but were potentially retried. */
//     intermediateErrors: number;
//     /** A map of error types to their counts, where keys are normalized error strings. */
//     errorsByType: { [normalizedErrorKey: string]: number };

//     // --- Service Initialization ---
//     /** Statistics related to the initialization of Gemini API services. */
//     serviceInitialization: {
//         /** Number of times service initialization was attempted. */
//         starts: number;
//         /** Number of times service initialization completed successfully. */
//         completes: number;
//         /** Number of times service initialization failed. */
//         failures: number;
//         /** Number of times lazy initialization was attempted. */
//         lazyAttempts: number;
//         /** Number of times a service was critically uninitialized when needed. */
//         criticallyUninitialized: number;
//     };
//     /** Number of failures specifically during API call setup (before actual `generateContent`). */
//     apiCallSetupFailures: number;

//     // --- Fallback Logic ---
//     /** Statistics on the usage and outcomes of fallback models. */
//     fallbackLogic: {
//         /** Number of times a fallback model was attempted. */
//         attemptsWithFallbackModel: number;
//         /** Number of times a request succeeded using a fallback model. */
//         successWithFallbackModel: number;
//         /** Number of primary model failures that led to fallback attempts. */
//         primaryModelFailuresLeadingToFallback: number;
//         /** Number of times fallback was needed but no fallback model was configured. */
//         noFallbackConfigured: number;
//         /** Number of times requests failed even after fallback attempts. */
//         failedAfterFallbackAttempts: number;
//     };

//     // --- Few-Shot Preparation ---
//     /** Statistics on the preparation of few-shot examples for API calls. */
//     fewShotPreparation: {
//         /** Number of attempts to prepare few-shot examples. */
//         attempts: number;
//         /** Number of successful few-shot preparations. */
//         successes: number;
//         /** Breakdown of few-shot preparation failures. */
//         failures: {
//             /** Number of failures due to an odd number of parts in history (e.g., user/model not alternating). */
//             oddPartsCount: number;
//             /** Number of failures due to other processing errors during few-shot preparation. */
//             processingError: number;
//         };
//         /** Breakdown of few-shot preparation warnings. */
//         warnings: {
//             /** Number of warnings due to missing input for an example. */
//             missingInput: number;
//             /** Number of warnings due to missing output for an example. */
//             missingOutput: number;
//             /** Number of warnings due to an empty generated result for an example. */
//             emptyResult: number;
//         };
//         /** Number of times few-shot was configured but no data was found. */
//         configuredButNoData: number;
//         /** Number of times few-shot was explicitly disabled by configuration. */
//         disabledByConfig: number;
//     };

//     // --- Request Payload Logging ---
//     /** Statistics on logging of API request payloads. */
//     requestPayloadLogging: {
//         /** Number of successful request payload logging operations. */
//         successes: number;
//         /** Number of failed request payload logging operations. */
//         failures: number;
//     };

//     // --- Generate Content (model.generateContent() calls) ---
//     /** Statistics on internal `model.generateContent()` calls. */
//     generateContentInternal: {
//         /** Total attempts to call `model.generateContent()`. */
//         attempts: number;
//         /** Number of successful `model.generateContent()` calls. */
//         successes: number;
//     };

//     // --- Cache Specifics ---
//     /** Number of times a cache hit occurred for context. */
//     cacheContextHits: number;
//     /** Number of attempts to get or create a cache context. */
//     cacheContextAttempts: number;
//     /** Number of cache context creation successes. */
//     cacheContextCreationSuccess: number;
//     /** Number of cache context misses. */
//     cacheContextMisses: number;
//     /** Number of cache context creation failures. */
//     cacheContextCreationFailed: number;
//     /** Number of times cache contexts were invalidated. */
//     cacheContextInvalidations: number;
//     /** Number of failures during cache context retrieval. */
//     cacheContextRetrievalFailures: number;
//     /** Number of attempts to load cache maps. */
//     cacheMapLoadAttempts: number;
//     /** Number of failures when loading cache maps. */
//     cacheMapLoadFailures: number;
//     /** Whether cache map loading was successful (null if not attempted/finished). */
//     cacheMapLoadSuccess?: boolean | null;
//     /** Number of attempts to write to cache maps. */
//     cacheMapWriteAttempts: number;
//     /** Number of failures during cache manager creation. */
//     cacheManagerCreateFailures: number;
//     /** Number of successful cache map write operations. */
//     cacheMapWriteSuccessCount: number;
//     /** Number of failed cache map write operations. */
//     cacheMapWriteFailures: number;

//     // --- Config Errors ---
//     /** Number of overall service initialization failures. */
//     serviceInitializationFailures: number;
//     /** Breakdown of configuration-related errors. */
//     configErrors: {
//         /** Number of times the required model list was missing in configuration. */
//         modelListMissing: number;
//     };
// }

// /**
//  * Comprehensive analysis of Google Search operations.
//  */
// export interface GoogleSearchAnalysis {
//     /** Total number of Google Search API requests made. */
//     totalRequests: number;
//     /** Number of successful search queries. */
//     successfulSearches: number;
//     /** Number of failed search queries. */
//     failedSearches: number;
//     /** Number of search queries that were skipped. */
//     skippedSearches: number;
//     /** Number of times general quota errors were encountered (can overlap with keySpecificLimitsReached). */
//     quotaErrors: number;
//     /** Breakdown of API key usage by key. */
//     keyUsage: { [apiKey: string]: number };
//     /** A map of error types to their counts, where keys are normalized error strings. */
//     errorsByType: { [normalizedErrorKey: string]: number };
//     /** Number of issues encountered during search attempts (e.g., malformed URLs). */
//     attemptIssues: number;
//     /** Detailed breakdown of specific attempt issues. */
//     attemptIssueDetails: Record<string, number>;
//     /** Number of times Google API key limits were explicitly reached. */
//     apiKeyLimitsReached: number;
//     /** Breakdown of limits reached for specific API keys. */
//     keySpecificLimitsReached: Record<string, number>;
//     /** Total number of API keys provided for Google Search. */
//     apiKeysProvidedCount: number;
//     /** Number of times all keys were exhausted when getting the next key. */
//     allKeysExhaustedEvents_GetNextKey: number;
//     /** Number of times all keys were exhausted during status checks. */
//     allKeysExhaustedEvents_StatusCheck: number;
//     /** Number of successful API key rotations. */
//     apiKeyRotationsSuccess: number;
//     /** Number of failed API key rotations. */
//     apiKeyRotationsFailed: number;
//     /** Number of successful searches that returned no items. */
//     successfulSearchesWithNoItems: number;
//     /** Number of times malformed result items were received from Google CSE. */
//     malformedResultItems: number;
// }

// /**
//  * Analysis of batch processing operations.
//  */
// export interface BatchProcessingAnalysis {
//     /** Total number of batches attempted. */
//     totalBatchesAttempted: number;
//     /** Number of batches that completed successfully. */
//     successfulBatches: number;
//     /** Number of batches that failed. */
//     failedBatches: number;
//     /** Number of failures related to API calls within batches. */
//     apiFailures: number;
//     /** Number of failures related to file system operations within batches. */
//     fileSystemFailures: number;
//     /** Number of times processing was rejected due to logic (e.g., invalid input). */
//     logicRejections: number;
//     /** Aggregated count of results across all processed batches (null if no results). */
//     aggregatedResultsCount: number | null;
//     /** Number of failures in the 'determineLinks' API stage. */
//     determineApiFailures: number;
//     /** Number of failures in the 'extractInfo' API stage. */
//     extractApiFailures: number;
//     /** Number of failures in the 'extractCfp' API stage. */
//     cfpApiFailures: number;
//     /** Number of times API responses failed to parse. */
//     apiResponseParseFailures: number;
// }

// /**
//  * Analysis of file output operations (JSONL and CSV).
//  */
// export interface FileOutputAnalysis {
//     /** Number of records successfully written to JSONL files. */
//     jsonlRecordsSuccessfullyWritten: number;
//     /** Number of errors encountered during JSONL file writes. */
//     jsonlWriteErrors: number;
//     /** Whether a CSV file was successfully generated (null if not attempted/finished). */
//     csvFileGenerated: boolean | null;
//     /** Number of records attempted to be written to CSV. */
//     csvRecordsAttempted: number;
//     /** Number of records successfully written to CSV. */
//     csvRecordsSuccessfullyWritten: number;
//     /** Number of errors encountered during CSV file writes. */
//     csvWriteErrors: number;
//     /** Number of successful CSV records that were "orphaned" (e.g., not linked to a full batch success). */
//     csvOrphanedSuccessRecords: number;
//     /** Number of failures in the overall CSV pipeline. */
//     csvPipelineFailures: number;
//     /** Optional: Other unclassified CSV-related errors. */
//     csvOtherErrors?: number;
// }

// /**
//  * Aggregated statistics on data validation and normalization.
//  */
// export interface ValidationStats {
//     // --- Validation Warnings ---
//     /** Total number of validation warnings recorded. */
//     totalValidationWarnings: number;
//     /** Breakdown of validation warnings by affected field name. */
//     warningsByField: { [fieldName: string]: number };
//     /** Breakdown of validation warnings by severity level. */
//     warningsBySeverity: {
//         Low: number;
//         Medium: number;
//         High: number;
//     };
//     /** Breakdown of validation warnings by their specific message/type. */
//     warningsByInsightMessage: { [message: string]: number };

//     // --- Normalizations ---
//     /** Total number of data normalizations applied. */
//     totalNormalizationsApplied: number;
//     /** Breakdown of normalizations by affected field name. */
//     normalizationsByField: { [fieldName: string]: number };
//     /** Breakdown of normalizations by the reason/message for normalization. */
//     normalizationsByReason: { [reasonMessage: string]: number };

//     // --- Data Corrections (Optional) ---
//     /** Optional: Total number of data corrections applied. */
//     totalDataCorrections?: number;
//     /** Optional: Breakdown of data corrections by affected field name. */
//     correctionsByField?: { [fieldName: string]: number };
// }

// /**
//  * Overall summary of the log analysis.
//  */
// export interface OverallAnalysis {
//     /** The start time of the analysis period (ISO string), or null. */
//     startTime: string | null;
//     /** The end time of the analysis period (ISO string), or null. */
//     endTime: string | null;
//     /** The total duration of the analysis period in seconds, or null. */
//     durationSeconds: number | null;
//     /** The total number of conferences initially fed as input. */
//     totalConferencesInput: number;
//     /** The total number of conferences that were processed to completion (regardless of internal errors). */
//     processedConferencesCount: number;
//     /** The number of tasks that fully completed successfully. */
//     completedTasks: number;
//     /** The number of tasks that failed or crashed. */
//     failedOrCrashedTasks: number;
//     /** The number of tasks currently in processing. */
//     processingTasks: number;
//     /** The number of tasks that were skipped entirely. */
//     skippedTasks: number;
//     /** The number of successful extractions performed by the AI models. */
//     successfulExtractions: number;
// }

// /**
//  * The comprehensive result structure for a complete log analysis operation.
//  * Aggregates all insights from various components of the crawl pipeline.
//  */
// export interface LogAnalysisResult {
//     /** ISO timestamp when this analysis was generated. */
//     analysisTimestamp: string;
//     /** The file path of the log file(s) that were analyzed. */
//     logFilePath: string;
//     /**
//      * The overall status of the analysis itself.
//      * - 'Completed': Analysis ran to completion.
//      * - 'Failed': Analysis process failed.
//      * - 'Processing': Analysis is still running.
//      * - 'CompletedWithErrors': Analysis completed, but encountered internal errors.
//      * - 'PartiallyCompleted': Analysis completed partially.
//      * - 'NoRequestsAnalyzed': No requests were found or analyzed based on filters.
//      * - 'Unknown': Status could not be determined.
//      */
//     status?:
//     | 'Completed'
//     | 'Failed'
//     | 'Processing'
//     | 'CompletedWithErrors'
//     | 'PartiallyCompleted'
//     | 'NoRequestsAnalyzed'
//     | 'Unknown';
//     /** Optional: An error message if the analysis itself failed. */
//     errorMessage?: string;
//     /** Optional: The specific request ID that was filtered for analysis. */
//     filterRequestId?: string;
//     /** An array of all batch request IDs that were included in this analysis. */
//     analyzedRequestIds: string[];

//     /** A dictionary of `RequestTimings` indexed by `batchRequestId`. */
//     requests: {
//         [batchRequestId: string]: RequestTimings;
//     };

//     /** Total number of raw log entries read. */
//     totalLogEntries: number;
//     /** Number of log entries successfully parsed. */
//     parsedLogEntries: number;
//     /** Number of errors encountered during log parsing. */
//     parseErrors: number;
//     /** Number of log entries classified as 'error' level. */
//     errorLogCount: number;
//     /** Number of log entries classified as 'fatal' level. */
//     fatalLogCount: number;

//     /** Analysis specific to Google Search operations. */
//     googleSearch: GoogleSearchAnalysis;
//     /** Analysis specific to Playwright (web scraping) operations. */
//     playwright: PlaywrightAnalysis;
//     /** Analysis specific to Gemini API interactions. */
//     geminiApi: GeminiApiAnalysis;
//     /** Analysis specific to batch processing operations. */
//     batchProcessing: BatchProcessingAnalysis;
//     /** Analysis specific to file output operations (JSONL, CSV). */
//     fileOutput: FileOutputAnalysis;
//     /** Aggregated statistics on data validation and normalization. */
//     validationStats: ValidationStats;

//     /** Overall summary statistics. */
//     overall: OverallAnalysis;

//     /** Aggregated counts of all unique error messages encountered, normalized. */
//     errorsAggregated: { [normalizedErrorKey: string]: number };
//     /** An array of general errors encountered during the log processing (e.g., file read errors). */
//     logProcessingErrors: string[];

//     /** A dictionary of `ConferenceAnalysisDetail` objects, indexed by a composite key (e.g., `batchRequestId-conferenceTitle`). */
//     conferenceAnalysis: {
//         [compositeKey: string]: ConferenceAnalysisDetail;
//     };
// }

// // --------------------- INITIALIZATION FUNCTIONS FOR ANALYSIS SUB-COMPONENTS ---------------------

// /**
//  * Initializes an empty `OverallAnalysis` object with default values.
//  * @returns {OverallAnalysis} A new `OverallAnalysis` instance.
//  */
// export const getInitialOverallAnalysis = (): OverallAnalysis => ({
//     startTime: null,
//     endTime: null,
//     durationSeconds: null,
//     totalConferencesInput: 0,
//     processedConferencesCount: 0,
//     completedTasks: 0,
//     failedOrCrashedTasks: 0,
//     processingTasks: 0,
//     skippedTasks: 0,
//     successfulExtractions: 0,
// });

// /**
//  * Initializes an empty `GoogleSearchAnalysis` object with default values.
//  * @returns {GoogleSearchAnalysis} A new `GoogleSearchAnalysis` instance.
//  */
// export const getInitialGoogleSearchAnalysis = (): GoogleSearchAnalysis => ({
//     totalRequests: 0,
//     successfulSearches: 0,
//     failedSearches: 0,
//     skippedSearches: 0,
//     quotaErrors: 0,
//     keyUsage: {},
//     errorsByType: {},
//     attemptIssues: 0,
//     attemptIssueDetails: {},
//     apiKeyLimitsReached: 0,
//     keySpecificLimitsReached: {},
//     apiKeysProvidedCount: 0,
//     allKeysExhaustedEvents_GetNextKey: 0,
//     allKeysExhaustedEvents_StatusCheck: 0,
//     apiKeyRotationsSuccess: 0,
//     apiKeyRotationsFailed: 0,
//     successfulSearchesWithNoItems: 0,
//     malformedResultItems: 0, // <-- Đã thêm trường này
// });

// /**
//  * Initializes an empty `PlaywrightAnalysis` object with default values.
//  * @returns {PlaywrightAnalysis} A new `PlaywrightAnalysis` instance.
//  */
// export const getInitialPlaywrightAnalysis = (): PlaywrightAnalysis => ({
//     setupAttempts: 0,
//     setupSuccess: null,
//     setupError: null,
//     contextErrors: 0,
//     htmlSaveAttempts: 0,
//     successfulSaveInitiations: 0,
//     failedSaves: 0,
//     skippedSaves: 0,
//     linkProcessing: {
//         totalLinksAttempted: 0,
//         successfulAccess: 0,
//         failedAccess: 0,
//         redirects: 0,
//     },
//     otherFailures: 0,
//     errorsByType: {},
// });

// /**
//  * Initializes an empty `GeminiApiAnalysis` object with default values.
//  * @returns {GeminiApiAnalysis} A new `GeminiApiAnalysis` instance.
//  */
// export const getInitialGeminiApiAnalysis = (): GeminiApiAnalysis => ({
//     totalCalls: 0,
//     successfulCalls: 0,
//     failedCalls: 0,
//     callsByType: {},
//     callsByModel: {},
//     totalRetries: 0,
//     retriesByType: {},
//     retriesByModel: {},
//     modelUsageByApiType: {},
//     totalTokens: 0,
//     blockedBySafety: 0,
//     rateLimitWaits: 0,
//     intermediateErrors: 0,
//     errorsByType: {},
//     serviceInitialization: {
//         starts: 0,
//         completes: 0,
//         failures: 0,
//         lazyAttempts: 0,
//         criticallyUninitialized: 0,
//     },
//     apiCallSetupFailures: 0,
//     fallbackLogic: {
//         attemptsWithFallbackModel: 0,
//         successWithFallbackModel: 0,
//         primaryModelFailuresLeadingToFallback: 0,
//         noFallbackConfigured: 0,
//         failedAfterFallbackAttempts: 0,
//     },
//     fewShotPreparation: {
//         attempts: 0,
//         successes: 0,
//         failures: { oddPartsCount: 0, processingError: 0 },
//         warnings: { missingInput: 0, missingOutput: 0, emptyResult: 0 },
//         configuredButNoData: 0,
//         disabledByConfig: 0,
//     },
//     requestPayloadLogging: { successes: 0, failures: 0 },
//     generateContentInternal: { attempts: 0, successes: 0 },
//     cacheContextHits: 0,
//     cacheContextAttempts: 0,
//     cacheContextMisses: 0,
//     cacheContextCreationSuccess: 0,
//     cacheContextCreationFailed: 0,
//     cacheContextInvalidations: 0,
//     cacheContextRetrievalFailures: 0,
//     cacheMapLoadAttempts: 0,
//     cacheMapLoadFailures: 0,
//     cacheMapLoadSuccess: null, // Default to null for initial state
//     cacheMapWriteAttempts: 0,
//     cacheManagerCreateFailures: 0,
//     cacheMapWriteSuccessCount: 0,
//     cacheMapWriteFailures: 0,
//     serviceInitializationFailures: 0,
//     configErrors: {
//         modelListMissing: 0,
//     },
// });

// /**
//  * Initializes an empty `BatchProcessingAnalysis` object with default values.
//  * @returns {BatchProcessingAnalysis} A new `BatchProcessingAnalysis` instance.
//  */
// export const getInitialBatchProcessingAnalysis = (): BatchProcessingAnalysis => ({
//     totalBatchesAttempted: 0,
//     successfulBatches: 0,
//     failedBatches: 0,
//     apiFailures: 0,
//     fileSystemFailures: 0,
//     logicRejections: 0,
//     aggregatedResultsCount: null,
//     determineApiFailures: 0,
//     extractApiFailures: 0,
//     cfpApiFailures: 0,
//     apiResponseParseFailures: 0,
// });

// /**
//  * Initializes an empty `FileOutputAnalysis` object with default values.
//  * @returns {FileOutputAnalysis} A new `FileOutputAnalysis` instance.
//  */
// export const getInitialFileOutputAnalysis = (): FileOutputAnalysis => ({
//     jsonlRecordsSuccessfullyWritten: 0,
//     jsonlWriteErrors: 0,
//     csvFileGenerated: null, // Default to null for initial state
//     csvRecordsAttempted: 0,
//     csvRecordsSuccessfullyWritten: 0,
//     csvWriteErrors: 0,
//     csvOrphanedSuccessRecords: 0,
//     csvPipelineFailures: 0,
//     // csvOtherErrors: 0, // Uncomment if you decide to use this field and want it initialized
// });

// /**
//  * Initializes an empty `ValidationStats` object with default values.
//  * @returns {ValidationStats} A new `ValidationStats` instance.
//  */
// export const getInitialValidationStats = (): ValidationStats => ({
//     totalValidationWarnings: 0,
//     warningsByField: {},
//     warningsBySeverity: {
//         Low: 0,
//         Medium: 0,
//         High: 0,
//     },
//     warningsByInsightMessage: {},
//     totalNormalizationsApplied: 0,
//     normalizationsByField: {},
//     normalizationsByReason: {},
//     // totalDataCorrections: 0, // Uncomment if you decide to use this field
//     // correctionsByField: {},  // Uncomment if you decide to use this field
// });

// /**
//  * Initializes a complete `LogAnalysisResult` object with default values for all its components.
//  * @param {string} logFilePath - The path to the log file being analyzed (defaults to "N/A").
//  * @returns {LogAnalysisResult} A new `LogAnalysisResult` instance.
//  */
// export const getInitialLogAnalysisResult = (logFilePath: string = "N/A"): LogAnalysisResult => ({
//     analysisTimestamp: new Date().toISOString(),
//     logFilePath: logFilePath,
//     status: 'Processing', // Initial status when analysis starts
//     errorMessage: undefined,
//     filterRequestId: undefined,
//     analyzedRequestIds: [],
//     requests: {},
//     totalLogEntries: 0,
//     parsedLogEntries: 0,
//     parseErrors: 0,
//     errorLogCount: 0,
//     fatalLogCount: 0,
//     googleSearch: getInitialGoogleSearchAnalysis(),
//     playwright: getInitialPlaywrightAnalysis(),
//     geminiApi: getInitialGeminiApiAnalysis(),
//     batchProcessing: getInitialBatchProcessingAnalysis(),
//     fileOutput: getInitialFileOutputAnalysis(),
//     validationStats: getInitialValidationStats(),
//     overall: getInitialOverallAnalysis(),
//     errorsAggregated: {},
//     logProcessingErrors: [],
//     conferenceAnalysis: {},
// });