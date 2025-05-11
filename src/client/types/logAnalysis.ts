// ../types/logAnalysis.ts

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
    title: string;
    acronym: string;
    status: 'unknown' | 'processing' | 'completed' | 'failed'; // Status reflects final outcome *if known* within the analysis window
    startTime: string | null;
    endTime: string | null; // Set ONLY when status becomes 'completed' or 'failed' definitively within the window
    durationSeconds: number | null;
    crawlEndTime?: string | null; // Optional: Track when the crawl/save phase finished
    crawlSucceededWithoutError?: boolean | null; // Optional: Track if crawl phase had errors
    jsonlWriteSuccess?: boolean | null; // Track if the specific jsonl write event was seen
    csvWriteSuccess?: boolean | null; // Track if the specific CSV write event was seen
    steps: { // Theo dõi các bước chính
        search_attempted: boolean;
        search_success: boolean | null;
        search_attempts_count: number;
        search_results_count: number | null;
        search_filtered_count: number | null;
        html_save_attempted: boolean;
        html_save_success: boolean | null; // Có thể cần logic phức tạp hơn để xác định chính xác
        link_processing_attempted: number;
        link_processing_success: number;
        link_processing_failed: Array<{ timestamp: string; details?: any }>;

        gemini_determine_attempted: boolean;
        gemini_determine_success: boolean | null;
        gemini_determine_cache_used: boolean | null;
        gemini_extract_attempted: boolean;
        gemini_extract_success: boolean | null;
        gemini_extract_cache_used: boolean | null;
    };
    errors: Array<{ timestamp: string; message: string; details?: any }>; // Lưu lỗi cụ thể của conference này

    validationIssues?: { field: string; value: any; action: string; timestamp: string }[];


    finalResult?: any; // Lưu kết quả cuối cùng nếu có log 'crawlConferences finished successfully'
}


export interface ValidationStats {
    totalValidationWarnings: number;
    warningsByField: { [field: string]: number }; // Đếm số lượng cảnh báo theo từng trường (field)
    totalNormalizationsApplied: number; // Đếm số lần chuẩn hóa được áp dụng (nếu bạn log event này)
    normalizationsByField: { [field: string]: number }; // Đếm số lần chuẩn hóa theo trường (nếu log)
    // Có thể thêm các số liệu khác nếu cần (ví dụ: errors vs warnings)
}


/** Cấu trúc kết quả phân tích log tổng thể và chi tiết theo conference */
export interface LogAnalysisResult {
    analysisTimestamp: string;
    logFilePath: string;

    // +++ ADDED PROPERTIES +++
    /** The overall status of the analysis execution itself. */
    status?: 'Completed' | 'Failed' | 'Processing'; // Added 'Processing' as a potential intermediate state
    /** A top-level error message if the analysis failed catastrophically (e.g., file not found, fatal error). */
    errorMessage?: string;
    // ++++++++++++++++++++++++


    totalLogEntries: number;
    parsedLogEntries: number;
    parseErrors: number;
    errorLogCount: number; // Tổng số log >= ERROR
    fatalLogCount: number; // Tổng số log >= FATAL

    // --- Tổng hợp chung (vẫn giữ để có cái nhìn tổng quan) ---
    overall: {
        startTime: string | null;
        endTime: string | null;
        durationSeconds: number | null;
        totalConferencesInput: number;
        processedConferencesCount: number; // Conferences touched within the analysis window
        completedTasks: number;           // Status = 'completed'
        failedOrCrashedTasks: number;     // Status = 'failed'
        processingTasks: number;          // Status = 'processing' or 'unknown' but started
        successfulExtractions: number;    // Based on gemini_extract_success = true
    };
    googleSearch: {
        totalRequests: number;
        successfulSearches: number; // Tổng số event search_success
        failedSearches: number; // Tổng số event search_ultimately_failed
        skippedSearches: number;
        quotaErrors: number;
        keyUsage: { [key: string]: number };
        errorsByType: { [key: string]: number }; // Lỗi tổng hợp của Google Search
        attemptIssues: number; // Tổng số các vấn đề trong các attempt
        attemptIssueDetails: Record<string, number>; // Chi tiết các loại vấn_đề_attempt
        quotaErrorsEncountered: number;
        malformedResultItems: number;
        successfulSearchesWithNoItems: number; // Search thành công nhưng không có item nào
        apiKeyLimitsReached: number; // Tổng số lần key đạt giới hạn
        keySpecificLimitsReached: Record<string, number>; // Số lần đạt giới hạn cho từng key cụ thể
        apiKeysProvidedCount: number; // Số lần key được cấp phát (từ ApiKeyManager)
        allKeysExhaustedEvents_GetNextKey: number; // Số lần getNextKey báo hết key
        allKeysExhaustedEvents_StatusCheck: number; // Số lần check trạng thái báo hết key
        apiKeyRotationsSuccess: number;
        apiKeyRotationsFailed: number;
    };
    playwright: {
        setupSuccess: boolean | null;
        setupError: boolean | null;
        htmlSaveAttempts: number; // Tổng số event save_html_start
        successfulSaves: number; // Tổng số event save_html_step_completed (cần xem xét lại độ chính xác)
        failedSaves: number; // Tổng số event save_html_failed
        linkProcessing: {
            totalLinksAttempted: number;
            successfulAccess: number;
            failedAccess: number;
            redirects: number;
        };
        errorsByType: { [key: string]: number }; // Lỗi tổng hợp của Playwright
    };
    geminiApi: {
        totalCalls: number;
        callsByType: { [apiType: string]: number };
        callsByModel: { [modelName: string]: number };
        successfulCalls: number;
        failedCalls: number;
        retriesByType: { [apiType: string]: number };
        retriesByModel: { [apiType: string]: number };
        cacheAttempts: number;
        cacheHits: number;
        cacheMisses: number;
        cacheCreationSuccess: number;
        cacheCreationFailed: number;
        cacheInvalidations: number;
        blockedBySafety: number;
        totalTokens: number; // Có thể tính tổng token nếu log có thông tin
        errorsByType: { [key: string]: number }; // Lỗi tổng hợp của Gemini
        rateLimitWaits: number;
    };
    batchProcessing: {
        totalBatchesAttempted: number;
        successfulBatches: number;
        failedBatches: number;
        aggregatedResultsCount: number | null;
    };
    errorsAggregated: { [key: string]: number }; // Tổng hợp tất cả các lỗi cuối cùng (task failed, api failed, etc.)
    logProcessingErrors: string[]; // Lỗi khi parse dòng log

    // --- Phân tích chi tiết theo từng Conference ---
    conferenceAnalysis: {
        [combined: string]: ConferenceAnalysisDetail;
    };
    // --- THÊM TRƯỜNG MỚI ---
    validationStats: ValidationStats;
    // -----------------------

}