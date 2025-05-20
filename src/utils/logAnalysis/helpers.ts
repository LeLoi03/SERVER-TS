// src/utils/logAnalysis/helper.ts
import { ConferenceAnalysisDetail, LogAnalysisResult } from '../../types/logAnalysis.types';

// --- Helper function: Normalize Error Key ---
export const normalizeErrorKey = (error: any): string => {
    let message = 'Unknown Error Structure';
    if (error && typeof error === 'object') {
        message = error.message || error.reason || error.details || JSON.stringify(error);
    } else if (error) {
        message = String(error);
    }
    // Limit length, replace numbers, normalize whitespace
    return message.substring(0, 150).replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
};

// --- Helper function: Create Composite Key ---
export const createConferenceKey = (batchRequestId: string, acronym: string, title: string): string | null => {
    if (!batchRequestId || typeof batchRequestId !== 'string' || batchRequestId.trim() === '') {
        // logger.warn('Attempted to create conference key without a valid batchRequestId.'); // Ghi log nếu cần
        return null; // Request ID là bắt buộc
    }
    if (acronym && typeof acronym === 'string' && acronym.trim() !== '' &&
        title && typeof title === 'string' && title.trim() !== '') {
        return `${batchRequestId.trim()} - ${acronym.trim()} - ${title.trim()}`;
    }
    return null;
};

// --- Helper function: Initialize Conference Detail ---

export const initializeConferenceDetail = (batchRequestId: string, acronym: string, title: string): ConferenceAnalysisDetail => ({
    batchRequestId: batchRequestId, // <<< NEW

    title: title,
    acronym: acronym,
    status: 'unknown', // Initial status
    startTime: null,
    endTime: null,
    durationSeconds: null,
    crawlEndTime: null, // Thêm mới hoặc đảm bảo có
    crawlSucceededWithoutError: null, // Thêm mới hoặc đảm bảo có
    jsonlWriteSuccess: null, // Thêm mới hoặc đảm bảo có
    csvWriteSuccess: null, // Thêm mới hoặc đảm bảo có
    steps: {
        search_attempted: false,
        search_success: null,
        search_attempts_count: 0,
        search_results_count: null,
        search_filtered_count: null,

        // --- Playwright Step Details ---
        html_save_attempted: false,
        html_save_success: null, // 'skipped' là một giá trị hợp lệ
        link_processing_attempted_count: 0, // Đổi tên từ link_processing_attempted
        link_processing_success_count: 0,   // Đổi tên từ link_processing_success
        link_processing_failed_details: [], // Khởi tạo là mảng rỗng

        // --- Gemini Step Details ---
        gemini_determine_attempted: false,
        gemini_determine_success: null,
        gemini_determine_cache_used: null,
        gemini_extract_attempted: false,
        gemini_extract_success: null,
        gemini_extract_cache_used: null,
        // Thêm cho CFP nếu có
        gemini_cfp_attempted: false, // Khởi tạo nếu luôn có, hoặc để undefined nếu tùy chọn
        gemini_cfp_success: null,
        gemini_cfp_cache_used: null,
    },
    errors: [],
    validationIssues: [], // Khởi tạo là mảng rỗng
    finalResult: undefined, // Giữ nguyên
});

// --- Helper function: Add Error to Conference Detail ---
export const addConferenceError = (
    detail: ConferenceAnalysisDetail,
    timestamp: string,
    errorSource: any,
    defaultMsg: string
) => {
    const normError = normalizeErrorKey(errorSource || defaultMsg);
    detail.errors.push({
        timestamp: timestamp,
        message: normError,
        // Include more details if available, handling potential circular references
        details: errorSource ? JSON.stringify(errorSource, Object.getOwnPropertyNames(errorSource), 2) : undefined
    });
    // Optionally log the error addition
    // logger.debug({ event: 'add_conference_error', acronym: detail.acronym, title: detail.title, error: normError }, "Added error to conference detail");
};

// --- Helper function: Initialize Log Analysis Result Structure ---

export const initializeLogAnalysisResult = (logFilePath: string, filterRequestId?: string): LogAnalysisResult => ({ // <<< Add filterRequestId
    analysisTimestamp: new Date().toISOString(),
    logFilePath: logFilePath,
    status: 'Processing', // Trạng thái ban đầu khi bắt đầu phân tích
    errorMessage: undefined, // Chưa có lỗi ban đầu

    filterRequestId: filterRequestId, // <<< NEW
    analyzedRequestIds: [],           // <<< NEW

    requests: {}, // <<< NEW INITIALIZATION


    totalLogEntries: 0,
    parsedLogEntries: 0,
    parseErrors: 0,
    errorLogCount: 0,
    fatalLogCount: 0,

    overall: {
        startTime: null,
        endTime: null,
        durationSeconds: null,
        totalConferencesInput: 0,
        processedConferencesCount: 0,
        completedTasks: 0,
        failedOrCrashedTasks: 0,
        processingTasks: 0,
        skippedTasks: 0, // Đảm bảo có
        successfulExtractions: 0,
    },
    googleSearch: {
        totalRequests: 0,
        successfulSearches: 0,
        failedSearches: 0,
        skippedSearches: 0,
        quotaErrors: 0, // Giữ lại nếu vẫn dùng, hoặc loại bỏ nếu đã thay thế hoàn toàn
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
    },
    playwright: {
        // --- Global ---
        setupAttempts: 0, // Thêm mới
        setupSuccess: null,
        setupError: null, // Có thể là boolean hoặc message lỗi
        contextErrors: 0, // Thêm mới
        // --- HTML Saving ---
        htmlSaveAttempts: 0,
        successfulSaves: 0,
        failedSaves: 0,
        skippedSaves: 0, // Thêm mới
        // --- Link Processing ---
        linkProcessing: {
            totalLinksAttempted: 0,
            successfulAccess: 0,
            failedAccess: 0,
            redirects: 0,
        },
        // --- Other ---
        otherFailures: 0, // Thêm mới
        errorsByType: {},
    },
    geminiApi: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        callsByType: {},
        callsByModel: {},
        totalRetries: 0, // Thêm mới
        retriesByType: {},
        retriesByModel: {},
        totalTokens: 0,
        cacheContextAttempts: 0, // Đổi tên từ cacheAttempts
        cacheContextHits: 0,     // Đổi tên từ cacheHits
        cacheContextMisses: 0,     // Đổi tên từ cacheHits

        // cacheContextMisses đã bị loại bỏ, sẽ tính toán sau
        cacheContextCreationSuccess: 0, // Đổi tên từ cacheCreationSuccess
        cacheContextCreationFailed: 0,  // Đổi tên từ cacheCreationFailed
        cacheContextInvalidations: 0,   // Đổi tên từ cacheInvalidations
        cacheContextRetrievalFailures: 0, // Thêm mới
        cacheMapLoadAttempts: 0, // Thêm mới
        cacheMapLoadSuccess: null, // Thêm mới
        cacheMapLoadFailures: 0, // Thêm mới
        cacheMapWriteAttempts: 0, // Thêm mới
        cacheMapWriteSuccessCount: 0, // Thêm mới
        cacheMapWriteFailures: 0, // Thêm mới
        cacheManagerCreateFailures: 0, // Thêm mới
        blockedBySafety: 0,
        rateLimitWaits: 0,
        intermediateErrors: 0, // Thêm mới
        errorsByType: {},
        serviceInitializationFailures: 0, // Thêm mới
        apiCallSetupFailures: 0, // Thêm mới
    },
    batchProcessing: {
        totalBatchesAttempted: 0,
        successfulBatches: 0,
        failedBatches: 0,
        apiFailures: 0, // Thêm mới
        fileSystemFailures: 0, // Thêm mới
        logicRejections: 0, // Thêm mới
        aggregatedResultsCount: null,
        determineApiFailures: 0, // Thêm mới
        extractApiFailures: 0, // Thêm mới
        cfpApiFailures: 0, // Thêm mới
        apiResponseParseFailures: 0, // Thêm mới
    },
    fileOutput: { // Thêm mục này
        jsonlRecordsSuccessfullyWritten: 0,
        jsonlWriteErrors: 0,
        csvFileGenerated: null,
        csvRecordsAttempted: 0,
        csvRecordsSuccessfullyWritten: 0,
        csvWriteErrors: 0,
        csvOrphanedSuccessRecords: 0,
        csvPipelineFailures: 0,
    },
    validationStats: {
        totalValidationWarnings: 0,
        warningsByField: {},
        totalNormalizationsApplied: 0,
        normalizationsByField: {},
    },
    errorsAggregated: {},
    logProcessingErrors: [],
    conferenceAnalysis: {},
});


// --- Helper function: Check if request overlaps with filter range ---
export const doesRequestOverlapFilter = (
    reqStartMillis: number | null,
    reqEndMillis: number | null,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    batchRequestId: string // For logging context
): boolean => {
    const logContext = { function: 'doesRequestOverlapFilter', batchRequestId };

    if (filterStartMillis === null && filterEndMillis === null) {
        return true; // No filter applied
    }

    if (reqStartMillis === null || reqEndMillis === null) {
        // If strict filtering is needed, exclude requests without a full time range
        // logger.debug({ ...logContext, event: 'filter_exclude_incomplete_timestamp' }, 'Excluding request from filtered analysis due to missing start/end time.');
        return false;
    }

    // --- Overlap Check ---
    // Request range: [reqStartMillis, reqEndMillis]
    // Filter range:  [filterStartMillis, filterEndMillis]
    // Overlap exists if reqStart <= filterEnd AND reqEnd >= filterStart
    const overlaps = (filterEndMillis === null || reqStartMillis <= filterEndMillis) &&
        (filterStartMillis === null || reqEndMillis >= filterStartMillis);

    // --- Alternative: Start Time Check (Simpler, if only filtering by start time is desired) ---
    /*
    let overlaps = true;
    if (filterStartMillis !== null && reqStartMillis < filterStartMillis) {
        overlaps = false;
    }
    if (filterEndMillis !== null && reqStartMillis > filterEndMillis) {
        overlaps = false;
    }
    */

    if (!overlaps) {
        // logger.trace({ ...logContext, event: 'filter_exclude_no_overlap', reqStartMillis, reqEndMillis, filterStartMillis, filterEndMillis }, 'Excluding request: time range does not overlap with filter.');
    }

    return overlaps;
};