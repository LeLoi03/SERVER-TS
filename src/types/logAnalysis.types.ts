// src/types/logAnalysis.types.ts

export interface GoogleSearchHealthData {
  rotationsSuccess: number;
  rotationsFailed: number;
  allKeysExhaustedOnGetNextKey: number;
  maxUsageLimitsReachedTotal: number;
  successfulSearchesWithNoItems: number;
}

export interface RequestTimings {
    startTime: string | null;
    endTime: string | null;
    durationSeconds: number | null;
    status?:
    | 'Completed'
    | 'Failed'
    | 'Processing'
    | 'CompletedWithErrors' // << THÊM MỚI: Cho request có lỗi nhưng không hoàn toàn thất bại
    | 'PartiallyCompleted'  // << THÊM MỚI: Cho request hoàn thành một phần, không lỗi
    | 'Skipped'             // << THÊM MỚI: Cho request mà tất cả task con đều skipped
    | 'NoData'              // << THÊM MỚI: Cho request không có log hoặc task
    | 'Unknown';
    originalRequestId?: string;
    // Tùy chọn:
    // processedConferencesInRequest?: number;
    // conferenceKeys?: string[];
}

export interface RequestLogData {
    logs: any[]; // Nên là kiểu cụ thể hơn nếu có thể, ví dụ: PinoLogEntry[]
    startTime: number | null; // Unix timestamp (milliseconds)
    endTime: number | null;   // Unix timestamp (milliseconds)
}

export interface ReadLogResult {
    requestsData: Map<string, RequestLogData>; // Key là batchRequestId
    totalEntries: number;
    parsedEntries: number;
    parseErrors: number;
    logProcessingErrors: string[];
}

export interface FilteredData {
    filteredRequests: Map<string, RequestLogData>; // Key là batchRequestId
    analysisStartMillis: number | null;
    analysisEndMillis: number | null;
}


export interface DataQualityInsight {
    timestamp: string;    // ISO string
    field: string;        // Trường bị ảnh hưởng
    originalValue?: any;  // Giá trị gốc trước khi thay đổi/warning
    currentValue: any;    // Giá trị hiện tại (sau khi normalized, hoặc giá trị gây warning)
    insightType: 'ValidationWarning' | 'NormalizationApplied' | 'DataCorrection'; // Loại insight
    severity?: 'Low' | 'Medium' | 'High'; // Mức độ nghiêm trọng (chủ yếu cho Warning)
    message: string;      // Mô tả chi tiết
    details?: {
        actionTaken?: string;  // Ví dụ: "KeptAsIs", "NormalizedToDefault"
        normalizedTo?: any;    // Giá trị sau khi normalize (nếu insightType là NormalizationApplied)
        ruleViolated?: string; // Ví dụ: "YEAR_REGEX", "VALID_CONTINENTS"
        // Có thể thêm các chi tiết khác nếu cần
    }
}

/** Thông tin chi tiết về quá trình xử lý một conference cụ thể */
export interface ConferenceAnalysisDetail {
    batchRequestId: string;
    originalRequestId?: string;
    title: string;
    acronym: string;
    status: 'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped';
    startTime: string | null; // ISO string
    endTime: string | null;   // ISO string
    durationSeconds: number | null;
    crawlEndTime?: string | null; // ISO string
    crawlSucceededWithoutError?: boolean | null;
    jsonlWriteSuccess?: boolean | null;
    csvWriteSuccess?: boolean | null;
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
    errors: Array<{
        timestamp: string;
        message: string;
        details?: any;
        errorCode?: string; // Giữ nguyên
        sourceService?: string; // << BỔ SUNG: Service nào gây ra lỗi (nếu có)
        errorType?: 'DataParsing' | 'Network' | 'APIQuota' | 'Logic' | 'FileSystem' | 'Unknown'; // << BỔ SUNG: Phân loại lỗi
    }>;

    dataQualityInsights?: DataQualityInsight[]; // Sử dụng DataQualityInsight[] ở đây


    // Bỏ `validationIssues` riêng lẻ, đã được gộp vào `dataQualityInsights`

    finalResultPreview?: any; // Giữ nguyên
    finalResult?: any;        // Giữ nguyên
}

export interface PlaywrightAnalysis {
    // ... (giữ nguyên)
    setupAttempts: number;
    setupSuccess: boolean | null;
    setupError: boolean | string | null;
    contextErrors: number;
    htmlSaveAttempts: number;
    successfulSaveInitiations: number;
    failedSaves: number;
    skippedSaves: number;
    linkProcessing: {
        totalLinksAttempted: number;
        successfulAccess: number;
        failedAccess: number;
        redirects: number;
    };
    otherFailures: number;
    errorsByType: { [normalizedErrorKey: string]: number };
}


// Interface GeminiApiAnalysis đã được cập nhật chi tiết
export interface GeminiApiAnalysis {
    // --- Call Stats ---
    totalCalls: number;
    successfulCalls: number;
    failedCalls: number;

    callsByType: { [apiType: string]: number };
    callsByModel: { [modelName: string]: number }; // Model chung, không phân biệt tuned/non-tuned

    // --- Retry Stats ---
    totalRetries: number;
    retriesByType: { [apiType: string]: number };
    retriesByModel: { [modelName: string]: number }; // Model chung

    // --- Model Usage by API Type and Crawl Model ---
    modelUsageByApiType: {
        [apiType: string]: { // 'extract', 'determine', 'cfp'
            [modelIdentifier: string]: { // e.g., "gemini-pro (non-tuned)", "models/my-tuned-model (tuned)"
                calls: number;
                retries: number;
                successes: number;
                failures: number;
                tokens: number;
                safetyBlocks: number;
            };
        };
    };

    // --- Token Usage ---
    totalTokens: number;

    // --- Error & Limit Stats ---
    blockedBySafety: number;
    rateLimitWaits: number;
    intermediateErrors: number;
    errorsByType: { [normalizedErrorKey: string]: number };

    // --- Service Initialization ---
    serviceInitialization: {
        starts: number;
        completes: number;
        failures: number;
        lazyAttempts: number;
        criticallyUninitialized: number;
    };
    apiCallSetupFailures: number;

    // --- Fallback Logic ---
    fallbackLogic: {
        attemptsWithFallbackModel: number;
        successWithFallbackModel: number;
        primaryModelFailuresLeadingToFallback: number;
        noFallbackConfigured: number;
        failedAfterFallbackAttempts: number;
    };

    // --- Few-Shot Preparation ---
    fewShotPreparation: {
        attempts: number;
        successes: number;
        failures: {
            oddPartsCount: number;
            processingError: number;
        };
        warnings: {
            missingInput: number;
            missingOutput: number;
            emptyResult: number;
        };
        configuredButNoData: number;
        disabledByConfig: number;
    };

    // --- Request Payload Logging ---
    requestPayloadLogging: {
        successes: number;
        failures: number;
    };

    // --- Generate Content (model.generateContent() calls) ---
    generateContentInternal: {
        attempts: number;
        successes: number;
    };

    // --- Cache Specifics ---
    cacheContextHits: number;
    cacheContextAttempts: number; // getOrCreate
    cacheContextCreationSuccess: number;
    cacheContextMisses: number;
    cacheContextCreationFailed: number;
    cacheContextInvalidations: number;
    cacheContextRetrievalFailures: number;
    cacheMapLoadAttempts: number;
    cacheMapLoadFailures: number;
    cacheMapLoadSuccess?: boolean | null; // Có thể là null nếu chưa có event load
    cacheMapWriteAttempts: number;
    cacheManagerCreateFailures: number;
    cacheMapWriteSuccessCount: number;
    cacheMapWriteFailures: number;
    // cacheManagerCreateFailures đã được tính trong serviceInitialization.failures hoặc apiCallSetupFailures

    // --- Config Errors ---
    serviceInitializationFailures: number;
    configErrors: {
        modelListMissing: number;
        // Lỗi từ fewShotPreparation.failures cũng có thể được coi là config error
    };
}



export interface GoogleSearchAnalysis {
    // ... (giữ nguyên)
    totalRequests: number;
    successfulSearches: number;
    failedSearches: number;
    skippedSearches: number;
    quotaErrors: number;
    keyUsage: { [apiKey: string]: number };
    errorsByType: { [normalizedErrorKey: string]: number };
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
    // ... (giữ nguyên)
    totalBatchesAttempted: number;
    successfulBatches: number;
    failedBatches: number;
    apiFailures: number;
    fileSystemFailures: number;
    logicRejections: number;
    aggregatedResultsCount: number | null;
    determineApiFailures: number;
    extractApiFailures: number;
    cfpApiFailures: number;
    apiResponseParseFailures: number;
}

export interface FileOutputAnalysis {
    // ... (giữ nguyên, nhưng có thể thêm `csvOtherErrors` nếu bạn dùng nó trong logic)
    jsonlRecordsSuccessfullyWritten: number;
    jsonlWriteErrors: number;
    csvFileGenerated: boolean | null;
    csvRecordsAttempted: number;
    csvRecordsSuccessfullyWritten: number;
    csvWriteErrors: number;
    csvOrphanedSuccessRecords: number;
    csvPipelineFailures: number;
    csvOtherErrors?: number; // << THÊM MỚI (tùy chọn, nếu bạn sử dụng)
}

export interface OverallAnalysis {
    startTime: string | null; // ISO string
    endTime: string | null;   // ISO string
    durationSeconds: number | null;
    totalConferencesInput: number;
    processedConferencesCount: number;
    completedTasks: number;
    failedOrCrashedTasks: number;
    processingTasks: number;
    skippedTasks: number; // << Đảm bảo có, vì 'skipped' là một status của conference
    successfulExtractions: number;
}

export interface ValidationStats {
    // Các trường cho Validation Warnings
    totalValidationWarnings: number;
    warningsByField: { [fieldName: string]: number };
    warningsBySeverity: { // << BỔ SUNG: Đếm warning theo mức độ nghiêm trọng
        Low: number;
        Medium: number;
        High: number;
    };
    warningsByInsightMessage: { [message: string]: number }; // << BỔ SUNG: Đếm các loại warning cụ thể

    // Các trường cho Normalizations
    totalNormalizationsApplied: number;
    normalizationsByField: { [fieldName: string]: number };
    normalizationsByReason: { [reasonMessage: string]: number }; // << BỔ SUNG: Đếm normalization theo lý do (ví dụ: "empty_value")

    // Có thể thêm các trường cho DataCorrections nếu có
    totalDataCorrections?: number;
    correctionsByField?: { [fieldName: string]: number };
}

/** Cấu trúc kết quả phân tích log tổng thể và chi tiết theo conference */
export interface LogAnalysisResult {
    analysisTimestamp: string; // ISO string
    logFilePath: string;
    status?:
    | 'Completed'
    | 'Failed'
    | 'Processing'
    | 'CompletedWithErrors' // << THÊM MỚI: Cho trạng thái tổng thể của việc phân tích
    | 'PartiallyCompleted'  // << THÊM MỚI: Cho trạng thái tổng thể của việc phân tích
    | 'NoRequestsAnalyzed'  // << THÊM MỚI: Nếu không có request nào được phân tích
    | 'Unknown';
    errorMessage?: string;

    filterRequestId?: string;
    analyzedRequestIds: string[];

    requests: {
        [batchRequestId: string]: RequestTimings; // Sử dụng RequestTimings đã được cập nhật
    };

    totalLogEntries: number;
    parsedLogEntries: number;
    parseErrors: number;
    errorLogCount: number;
    fatalLogCount: number;

    googleSearch: GoogleSearchAnalysis;
    playwright: PlaywrightAnalysis;
    geminiApi: GeminiApiAnalysis;
    batchProcessing: BatchProcessingAnalysis;
    fileOutput: FileOutputAnalysis;
    validationStats: ValidationStats;

    overall: OverallAnalysis;

    errorsAggregated: { [normalizedErrorKey: string]: number };
    logProcessingErrors: string[];

    conferenceAnalysis: {
        [compositeKeyIncludingBatchRequestId: string]: ConferenceAnalysisDetail;
    };
}

// Hàm khởi tạo giá trị ban đầu cho từng phần của analysis
export const getInitialOverallAnalysis = (): OverallAnalysis => ({
    startTime: null,
    endTime: null,
    durationSeconds: null,
    totalConferencesInput: 0,
    processedConferencesCount: 0,
    completedTasks: 0,
    failedOrCrashedTasks: 0,
    processingTasks: 0,
    skippedTasks: 0,
    successfulExtractions: 0,
});

export const getInitialGoogleSearchAnalysis = (): GoogleSearchAnalysis => ({
    totalRequests: 0,
    successfulSearches: 0,
    failedSearches: 0,
    skippedSearches: 0,
    quotaErrors: 0,
    keyUsage: {},
    errorsByType: {},
    attemptIssues: 0,
    attemptIssueDetails: {},
    quotaErrorsEncountered: 0,
    malformedResultItems: 0,
    successfulSearchesWithNoItems: 0,
    apiKeyLimitsReached: 0,
    keySpecificLimitsReached: {},
    apiKeysProvidedCount: 0,
    allKeysExhaustedEvents_GetNextKey: 0,
    allKeysExhaustedEvents_StatusCheck: 0,
    apiKeyRotationsSuccess: 0,
    apiKeyRotationsFailed: 0,
});

export const getInitialPlaywrightAnalysis = (): PlaywrightAnalysis => ({
    setupAttempts: 0,
    setupSuccess: null,
    setupError: null,
    contextErrors: 0,
    htmlSaveAttempts: 0,
    successfulSaveInitiations: 0,
    failedSaves: 0,
    skippedSaves: 0,
    linkProcessing: {
        totalLinksAttempted: 0,
        successfulAccess: 0,
        failedAccess: 0,
        redirects: 0,
    },
    otherFailures: 0,
    errorsByType: {},
});

export const getInitialGeminiApiAnalysis = (): GeminiApiAnalysis => ({
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    callsByType: {},
    callsByModel: {},
    totalRetries: 0,
    retriesByType: {},
    retriesByModel: {},
    modelUsageByApiType: {},
    totalTokens: 0,
    blockedBySafety: 0,
    rateLimitWaits: 0,
    intermediateErrors: 0,
    errorsByType: {},
    serviceInitialization: {
        starts: 0,
        completes: 0,
        failures: 0,
        lazyAttempts: 0,
        criticallyUninitialized: 0,
    },
    apiCallSetupFailures: 0,
    fallbackLogic: {
        attemptsWithFallbackModel: 0,
        successWithFallbackModel: 0,
        primaryModelFailuresLeadingToFallback: 0,
        noFallbackConfigured: 0,
        failedAfterFallbackAttempts: 0,
    },
    fewShotPreparation: {
        attempts: 0,
        successes: 0,
        failures: { oddPartsCount: 0, processingError: 0 },
        warnings: { missingInput: 0, missingOutput: 0, emptyResult: 0 },
        configuredButNoData: 0,
        disabledByConfig: 0,
    },
    requestPayloadLogging: { successes: 0, failures: 0 },
    generateContentInternal: { attempts: 0, successes: 0 },
    cacheContextHits: 0,
    cacheContextAttempts: 0,
    cacheContextMisses: 0,
    cacheContextCreationSuccess: 0,
    cacheContextCreationFailed: 0,
    cacheContextInvalidations: 0,
    cacheContextRetrievalFailures: 0,
    cacheMapLoadAttempts: 0,
    cacheMapLoadFailures: 0,
    cacheMapWriteAttempts: 0,
    cacheMapLoadSuccess: null,
    cacheManagerCreateFailures: 0,
    cacheMapWriteSuccessCount: 0,
    cacheMapWriteFailures: 0,
    serviceInitializationFailures: 0,
    configErrors: {
        modelListMissing: 0,
    },
});

export const getInitialBatchProcessingAnalysis = (): BatchProcessingAnalysis => ({
    totalBatchesAttempted: 0,
    successfulBatches: 0,
    failedBatches: 0,
    apiFailures: 0,
    fileSystemFailures: 0,
    logicRejections: 0,
    aggregatedResultsCount: null,
    determineApiFailures: 0,
    extractApiFailures: 0,
    cfpApiFailures: 0,
    apiResponseParseFailures: 0,
});

export const getInitialFileOutputAnalysis = (): FileOutputAnalysis => ({
    jsonlRecordsSuccessfullyWritten: 0,
    jsonlWriteErrors: 0,
    csvFileGenerated: null,
    csvRecordsAttempted: 0,
    csvRecordsSuccessfullyWritten: 0,
    csvWriteErrors: 0,
    csvOrphanedSuccessRecords: 0,
    csvPipelineFailures: 0,
});

export const getInitialValidationStats = (): ValidationStats => ({
    // Validation Warnings
    totalValidationWarnings: 0,
    warningsByField: {},
    warningsBySeverity: { // Khởi tạo các mức độ nghiêm trọng
        Low: 0,
        Medium: 0,
        High: 0,
    },
    warningsByInsightMessage: {},

    // Normalizations
    totalNormalizationsApplied: 0,
    normalizationsByField: {},
    normalizationsByReason: {},

    // Data Corrections (khởi tạo nếu bạn quyết định sử dụng chúng)
    // totalDataCorrections: 0, // Bỏ comment nếu dùng
    // correctionsByField: {},    // Bỏ comment nếu dùng
});
export interface ValidationStats {
    // Các trường cho Validation Warnings
    totalValidationWarnings: number;
    warningsByField: { [fieldName: string]: number };
    warningsBySeverity: { // << BỔ SUNG: Đếm warning theo mức độ nghiêm trọng
        Low: number;
        Medium: number;
        High: number;
    };
    warningsByInsightMessage: { [message: string]: number }; // << BỔ SUNG: Đếm các loại warning cụ thể

    // Các trường cho Normalizations
    totalNormalizationsApplied: number;
    normalizationsByField: { [fieldName: string]: number };
    normalizationsByReason: { [reasonMessage: string]: number }; // << BỔ SUNG: Đếm normalization theo lý do (ví dụ: "empty_value")

    // Có thể thêm các trường cho DataCorrections nếu có
    totalDataCorrections?: number;
    correctionsByField?: { [fieldName: string]: number };
}

// Hàm khởi tạo cho toàn bộ LogAnalysisResult
export const getInitialLogAnalysisResult = (logFilePath: string = "N/A"): LogAnalysisResult => ({
    analysisTimestamp: new Date().toISOString(),
    logFilePath: logFilePath,
    status: 'Processing', // Mặc định khi bắt đầu
    errorMessage: undefined,
    filterRequestId: undefined,
    analyzedRequestIds: [],
    requests: {},
    totalLogEntries: 0,
    parsedLogEntries: 0,
    parseErrors: 0,
    errorLogCount: 0,
    fatalLogCount: 0,
    googleSearch: getInitialGoogleSearchAnalysis(),
    playwright: getInitialPlaywrightAnalysis(),
    geminiApi: getInitialGeminiApiAnalysis(),
    batchProcessing: getInitialBatchProcessingAnalysis(),
    fileOutput: getInitialFileOutputAnalysis(),
    validationStats: getInitialValidationStats(),
    overall: getInitialOverallAnalysis(),
    errorsAggregated: {},
    logProcessingErrors: [],
    conferenceAnalysis: {},
});