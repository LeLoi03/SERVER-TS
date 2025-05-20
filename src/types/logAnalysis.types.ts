// src/types/logAnalysis.types.ts


export interface RequestTimings {
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    // Tùy chọn: có thể thêm số lượng conference được xử lý trong request này
    // processedConferencesInRequest?: number;
    // Hoặc danh sách các key của conference thuộc request này
    // conferenceKeys?: string[];
}


export interface RequestLogData {
    logs: any[];
    startTime: number | null;
    endTime: number | null;
}

export interface ReadLogResult {
    requestsData: Map<string, RequestLogData>;
    totalEntries: number;
    parsedEntries: number;
    parseErrors: number;
    logProcessingErrors: string[];
}

export interface FilteredData {
    filteredRequests: Map<string, RequestLogData>;
    analysisStartMillis: number | null;
    analysisEndMillis: number | null;
}

/** Thông tin chi tiết về quá trình xử lý một conference cụ thể */
export interface ConferenceAnalysisDetail {

    batchRequestId: string; // <<< NEW: Để dễ dàng truy cập batchRequestId
    title: string;
    acronym: string;
    status: 'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped';
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    crawlEndTime?: string | null;
    crawlSucceededWithoutError?: boolean | null;
    jsonlWriteSuccess?: boolean | null;
    csvWriteSuccess?: boolean | null;
    steps: {
        search_attempted: boolean;
        search_success: boolean | null;
        search_attempts_count: number;
        search_results_count: number | null;
        search_filtered_count: number | null;

        // --- Playwright Step Details for Conference ---
        html_save_attempted: boolean; // True if 'process_save_start' (was save_html_conference_start) seen for this conference
        html_save_success: boolean | 'skipped' | null; // True if 'process_save_delegation_initiated' (was save_html_conference_success) seen
        // 'skipped' if 'process_save_skipped_no_links' seen
        link_processing_attempted_count: number; // Total 'single_link_processing_start' (was link_processing_attempt) for this conference
        link_processing_success_count: number; // Total 'link_access_final_success' (was link_processing_success) for this conference
        link_processing_failed_details: Array<{ // Details from 'single_link_processing_failed_to_access_link' or 'unhandled_error'
            timestamp: string;
            url?: string;
            error?: string; // Normalized error key
            event?: string; // Original event name for context
        }>;
        // --- End Playwright Step Details ---

        gemini_determine_attempted: boolean;
        gemini_determine_success: boolean | null;
        gemini_determine_cache_used: boolean | null; // true nếu 'cache_setup_use_success' cho 'determine'
        gemini_extract_attempted: boolean;
        gemini_extract_success: boolean | null;
        gemini_extract_cache_used: boolean | null; // true nếu 'cache_setup_use_success' cho 'extract'
        // Thêm cho CFP nếu bạn có API type 'cfp' và theo dõi riêng ở conference level
        gemini_cfp_attempted?: boolean;
        gemini_cfp_success?: boolean | null;
        gemini_cfp_cache_used?: boolean | null;
    };
    errors: Array<{ timestamp: string; message: string; details?: any }>;
    validationIssues?: Array<{ // Giữ nguyên từ handler
        field: string;
        value: any;        // Giá trị không hợp lệ ban đầu
        action: string;    // 'normalized' hoặc 'logged_only'
        normalizedTo?: any; // Giá trị sau khi normalize (nếu action là 'normalized')
        timestamp: string;
    }>;
    finalResultPreview?: any; // Renamed from finalResult for clarity
    finalResult?: any; // The actual final result object from 'processing_finished_successfully'
}

export interface PlaywrightAnalysis {

    // --- Global Playwright Stats ---
    setupAttempts: number; // Number of times global Playwright initialization was attempted
    setupSuccess: boolean | null; // Final status of global Playwright initialization
    setupError: boolean | string | null; // True if global init ever failed
    contextErrors: number; // Errors getting browser context
    // --- End Global Playwright Stats ---

    // --- HTML Saving Stats (Aggregated across all conferences) ---
    htmlSaveAttempts: number; // Total conferences for which HTML saving was attempted ('process_save_start')
    successfulSaves: number; // Total conferences where HTML saving was successfully initiated ('process_save_delegation_initiated')
    failedSaves: number; // Total conferences where HTML saving initiation failed
    skippedSaves: number; // Total conferences where HTML saving was skipped ('process_save_skipped_no_links')
    // --- End HTML Saving Stats ---

    // --- Link Processing Stats (Aggregated across all links in all conferences) ---
    linkProcessing: {
        totalLinksAttempted: number; // Total 'single_link_processing_start' events
        successfulAccess: number; // Total 'link_access_final_success' events
        failedAccess: number; // Total 'single_link_processing_failed_to_access_link' or 'unhandled_error' for links
        redirects: number; // Total 'link_redirect_detected' events
    };
    // --- End Link Processing Stats ---

    otherFailures: number; // Count of generic Playwright failures
    errorsByType: { [key: string]: number }; // Aggregated errors for Playwright operations by normalized keyF
}
export interface GeminiApiAnalysis {
    // --- Call Stats ---
    totalCalls: number;                 // Counter for 'gemini_call_start'
    successfulCalls: number;            // Counter for 'gemini_api_attempt_success'
    failedCalls: number;                // Counter for final failures (safety, max_retries, non_retryable, serious setup)

    callsByType: { [apiType: string]: number }; // From 'gemini_call_start'
    callsByModel: { [modelName: string]: number };// From 'gemini_call_start'

    // --- Retry Stats ---
    totalRetries: number;               // Sum of all 'retry_attempt_start' events
    retriesByType: { [apiType: string]: number }; // From 'retry_attempt_start'
    retriesByModel: { [modelName: string]: number };// From 'retry_attempt_start'

    // --- Token Usage ---
    totalTokens: number;                // Sum from 'gemini_api_attempt_success'

    // --- Cache Specific Stats ---
    cacheContextAttempts: number;       // Attempts to create a new cache context ('cache_create_start')
    cacheContextHits: number;           // Successful use of existing cache ('cache_setup_use_success')
    cacheContextMisses: number;      // Calculated: totalCalls (for cacheable types) - cacheContextHits
    cacheContextCreationSuccess: number;// Successful creation of new cache context ('cache_create_success')
    cacheContextCreationFailed: number; // Failures to create new cache context (various 'cache_create_failed_*' events)
    cacheContextInvalidations: number;  // Times a cache context was invalidated/removed ('cache_invalidate', 'retry_cache_invalidate', 'cache_create_failed_invalid_object')
    cacheContextRetrievalFailures: number; // Failures to retrieve a known cache context from storage ('cache_retrieval_failed_*')

    cacheMapLoadAttempts: number;       // Attempts to load cache map file (implicit, once per run)
    cacheMapLoadSuccess: boolean | null;// Status of loading cache map file
    cacheMapLoadFailures: number;       // Failures loading cache map file ('cache_load_failed')
    cacheMapWriteAttempts: number;      // Attempts to write cache map file
    cacheMapWriteSuccessCount: number;       // Successful writes of cache map ('cache_write_success' for map)
    cacheMapWriteFailures: number;      // Failures writing cache map ('cache_write_failed' for map)

    cacheManagerCreateFailures: number; // Failures to create GoogleAICacheManager ('cache_manager_create_failed')

    // --- Error & Limit Stats ---
    blockedBySafety: number;            // Final failures due to safety ('gemini_api_response_blocked', 'retry_attempt_error_safety_blocked')
    rateLimitWaits: number;             // Times waited due to rate limits ('retry_wait_before_next', 'retry_internal_rate_limit_wait')
    intermediateErrors: number;         // Total intermediate, retryable errors (sum of various 'retry_attempt_error_*' not leading to final failure)
    errorsByType: { [normalizedErrorKey: string]: number }; // Detailed breakdown of intermediate and setup errors by normalized key

    // --- Setup Failures (Critical for service operation) ---
    serviceInitializationFailures: number; // Failures in GeminiApiService constructor or init() (e.g., GenAI init, CacheManager init)
    apiCallSetupFailures: number;       // Failures preparing for an API call (missing config, model undefined, limiter init failed, non_cached_setup_failed)
}

export interface GoogleSearchAnalysis {

    totalRequests: number;
    successfulSearches: number;
    failedSearches: number;
    skippedSearches: number; // Searches skipped due to no keys or all keys exhausted before loop
    quotaErrors: number; // Deprecated or refine: use quotaErrorsEncountered
    keyUsage: { [key: string]: number };
    errorsByType: { [key: string]: number };
    attemptIssues: number;
    attemptIssueDetails: Record<string, number>;
    quotaErrorsEncountered: number;
    malformedResultItems: number;
    successfulSearchesWithNoItems: number;
    apiKeyLimitsReached: number;
    keySpecificLimitsReached: Record<string, number>;
    apiKeysProvidedCount: number;
    allKeysExhaustedEvents_GetNextKey: number;
    allKeysExhaustedEvents_StatusCheck: number;
    apiKeyRotationsSuccess: number;
    apiKeyRotationsFailed: number;
}

export interface BatchProcessingAnalysis {
    totalBatchesAttempted: number;       // Từ 'batch_task_create'
    successfulBatches: number;           // Từ 'save_batch_finish_success'
    failedBatches: number;               // Từ 'save_batch_unhandled_error_or_rethrown' và các lỗi API/FS nghiêm trọng khác
    // Thêm các breakdown lỗi nếu cần:
    apiFailures: number;                 // Tổng các 'save_batch_*_api_call_failed', 'save_batch_api_response_parse_failed'
    fileSystemFailures: number;          // Tổng các 'save_batch_dir_create_failed', 'save_batch_read_content_failed', 'save_batch_write_file_failed'
    logicRejections: number;             // Từ 'batch_processing_abort_no_main_text'
    aggregatedResultsCount: number | null; // Từ 'save_batch_aggregate_content_end' (nếu có context.aggregatedCount)
    // Hoặc chi tiết hơn
    determineApiFailures: number;
    extractApiFailures: number;
    cfpApiFailures: number; // Mới
    apiResponseParseFailures: number; // Mới
}


export interface FileOutputAnalysis {
    jsonlRecordsSuccessfullyWritten: number;
    jsonlWriteErrors: number;
    csvFileGenerated: boolean | null; // true, false, hoặc null nếu chưa xử lý
    csvRecordsAttempted: number;      // Tổng số record JSONL được ResultProcessingService đọc và cố gắng xử lý cho CSV
    csvRecordsSuccessfullyWritten: number; // Số record CSV được ghi thành công VÀ có confDetail
    csvWriteErrors: number;           // Số record CSV ghi lỗi (nếu CrawlOrchestrator log event này)
    csvOrphanedSuccessRecords: number;// Số record CSV ghi thành công nhưng không tìm thấy confDetail
    csvPipelineFailures: number;      // Số lần toàn bộ pipeline tạo CSV thất bại
}


export interface OverallAnalysis {
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    totalConferencesInput: number;
    processedConferencesCount: number;
    completedTasks: number;
    failedOrCrashedTasks: number;
    processingTasks: number;
    skippedTasks?: number; // Added for conferences explicitly skipped
    successfulExtractions: number;
}
export interface ValidationStats {
    totalValidationWarnings: number;
    warningsByField: { [fieldName: string]: number };
    totalNormalizationsApplied: number;
    normalizationsByField: { [fieldName: string]: number };
}

/** Cấu trúc kết quả phân tích log tổng thể và chi tiết theo conference */
export interface LogAnalysisResult {
    analysisTimestamp: string;
    logFilePath: string;
    status?: 'Completed' | 'Failed' | 'Processing';
    errorMessage?: string;

    filterRequestId?: string; // <<< NEW: The specific batchRequestId used for filtering, if any
    analyzedRequestIds: string[]; // <<< NEW: List of all batchRequestIds included in this analysis output
    
    // <<< NEW SECTION for per-request timings >>>
    requests: {
        [batchRequestId: string]: RequestTimings;
    };

    totalLogEntries: number;
    parsedLogEntries: number;
    parseErrors: number;
    errorLogCount: number;
    fatalLogCount: number;

    googleSearch: GoogleSearchAnalysis;
    playwright: PlaywrightAnalysis;
    geminiApi: GeminiApiAnalysis; // Sử dụng interface mới
    batchProcessing: BatchProcessingAnalysis; // Đảm bảo interface này được cập nhật
    fileOutput: FileOutputAnalysis; // Thêm trường này
    validationStats: ValidationStats;

    overall: OverallAnalysis;

    errorsAggregated: { [key: string]: number };
    logProcessingErrors: string[];

    conferenceAnalysis: {
        // Key sẽ là: `${batchRequestId}-${acronym}-${title}`
        [compositeKeyIncludingRequestId: string]: ConferenceAnalysisDetail;
    };
}