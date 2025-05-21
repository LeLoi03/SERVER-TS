// src/utils/logAnalysis/helper.ts
import {
    ConferenceAnalysisDetail,
    LogAnalysisResult,
    OverallAnalysis,        // Import các kiểu con nếu cần
    GoogleSearchAnalysis,
    PlaywrightAnalysis,
    GeminiApiAnalysis,
    BatchProcessingAnalysis,
    FileOutputAnalysis,
    ValidationStats,
    RequestTimings // Thêm RequestTimings nếu chưa có
} from '../../types/logAnalysis.types'; // Đảm bảo đường dẫn chính xác

// --- Các helper function khác (normalizeErrorKey, createConferenceKey, initializeConferenceDetail, addConferenceError, doesRequestOverlapFilter) giữ nguyên ---

// --- Helper function: Initialize Log Analysis Result Structure ---

// Sử dụng các hàm getInitial... từ file types để đảm bảo tính nhất quán
// Nếu bạn chưa có các hàm này trong file types, bạn có thể định nghĩa chúng ở đây
// hoặc import từ nơi bạn đã định nghĩa (ví dụ: getInitialGeminiApiAnalysis từ logAnalysis.types.ts)

// Giả sử các hàm này đã được export từ logAnalysis.types.ts
import {
    getInitialOverallAnalysis,
    getInitialGoogleSearchAnalysis,
    getInitialPlaywrightAnalysis,
    getInitialGeminiApiAnalysis, // Quan trọng: hàm này cần được định nghĩa và export
    getInitialBatchProcessingAnalysis,
    getInitialFileOutputAnalysis,
    getInitialValidationStats
} from '../../types/logAnalysis.types';


export const normalizeErrorKey = (error: any): string => {
    let message = 'Unknown Error Structure';
    if (error && typeof error === 'object') {
        message = error.message || error.reason || error.details || JSON.stringify(error);
    } else if (error) {
        message = String(error);
    }
    return message.substring(0, 150).replace(/\s+/g, ' ').trim();
};

export const createConferenceKey = (batchRequestId: string, acronym: string, title: string): string | null => {
    if (!batchRequestId || typeof batchRequestId !== 'string' || batchRequestId.trim() === '') {
        return null;
    }
    if (acronym && typeof acronym === 'string' && acronym.trim() !== '' &&
        title && typeof title === 'string' && title.trim() !== '') {
        return `${batchRequestId.trim()} - ${acronym.trim()} - ${title.trim()}`;
    }
    return null;
};

export const initializeConferenceDetail = (batchRequestId: string, acronym: string, title: string): ConferenceAnalysisDetail => ({
    batchRequestId: batchRequestId,
    originalRequestId: undefined,
    title: title,
    acronym: acronym,
    status: 'unknown',
    startTime: null,
    endTime: null,
    durationSeconds: null,
    crawlEndTime: null,
    crawlSucceededWithoutError: null,
    jsonlWriteSuccess: null,
    csvWriteSuccess: null,
    steps: {
        search_attempted: false,
        search_success: null,
        search_attempts_count: 0,
        search_results_count: null,
        search_filtered_count: null,
        html_save_attempted: false,
        html_save_success: null,
        link_processing_attempted_count: 0,
        link_processing_success_count: 0,
        link_processing_failed_details: [],
        gemini_determine_attempted: false,
        gemini_determine_success: null,
        gemini_determine_cache_used: null,
        gemini_extract_attempted: false,
        gemini_extract_success: null,
        gemini_extract_cache_used: null,
        gemini_cfp_attempted: false,
        gemini_cfp_success: null,
        gemini_cfp_cache_used: null,
    },
    errors: [],
    dataQualityInsights: [],
    finalResultPreview: undefined, // Sửa lỗi type ở đây, finalResultPreview có thể là any
    finalResult: undefined,
});

export const addConferenceError = (
    detail: ConferenceAnalysisDetail,
    timestamp: string,
    errorSource: any,
    defaultMsgOrErrorCode: string,
    detailsObject?: Record<string, any>
) => {
    let errorMessage: string;
    let errorCode: string | undefined = undefined; // Khai báo rõ ràng type

    if (typeof errorSource === 'string') {
        errorMessage = errorSource;
    } else if (errorSource instanceof Error) {
        errorMessage = errorSource.message;
    } else {
        errorMessage = defaultMsgOrErrorCode;
    }

    if (!errorMessage.includes(' ') && defaultMsgOrErrorCode.includes('_')) {
        errorCode = defaultMsgOrErrorCode;
        if (errorMessage === defaultMsgOrErrorCode) {
            errorMessage = `Error code: ${errorCode}`;
        }
    } else if (errorMessage !== defaultMsgOrErrorCode && defaultMsgOrErrorCode.includes('_')) {
        errorCode = defaultMsgOrErrorCode;
    }

    let finalDetails: any = detailsObject || {};

    if (errorSource && typeof errorSource === 'object' && !(errorSource instanceof Error) && !detailsObject) {
        try {
            finalDetails = JSON.parse(JSON.stringify(errorSource, Object.getOwnPropertyNames(errorSource)));
        } catch (e) {
            finalDetails = { rawErrorSource: String(errorSource) };
        }
    } else if (errorSource instanceof Error && !detailsObject) {
        finalDetails = {
            name: errorSource.name,
            // message: errorSource.message, // Đã có ở errorMessage
            stack: errorSource.stack?.substring(0, 500),
        };
    }

    // Sửa lỗi type ở đây: `detail.errors` mong đợi một object có `errorCode` tùy chọn.
    const errorEntry: { timestamp: string; message: string; errorCode?: string; details?: any } = {
        timestamp: timestamp,
        message: errorMessage,
        details: Object.keys(finalDetails).length > 0 ? finalDetails : undefined,
    };
    if (errorCode) {
        errorEntry.errorCode = errorCode;
    }
    detail.errors.push(errorEntry);
};


export const initializeLogAnalysisResult = (logFilePath: string, filterRequestId?: string): LogAnalysisResult => {
    // Gọi các hàm khởi tạo chi tiết
    const overall = getInitialOverallAnalysis();
    const googleSearch = getInitialGoogleSearchAnalysis();
    const playwright = getInitialPlaywrightAnalysis();
    const geminiApi = getInitialGeminiApiAnalysis(); // <-- SỬ DỤNG HÀM KHỞI TẠO MỚI CHO GEMINI
    const batchProcessing = getInitialBatchProcessingAnalysis();
    const fileOutput = getInitialFileOutputAnalysis();
    const validationStats = getInitialValidationStats();

    return {
        analysisTimestamp: new Date().toISOString(),
        logFilePath: logFilePath,
        status: 'Processing',
        errorMessage: undefined,
        filterRequestId: filterRequestId,
        analyzedRequestIds: [],
        requests: {}, // Khởi tạo rỗng, sẽ được điền sau
        totalLogEntries: 0,
        parsedLogEntries: 0,
        parseErrors: 0,
        errorLogCount: 0,
        fatalLogCount: 0,

        // Gán các phần đã khởi tạo
        overall: overall,
        googleSearch: googleSearch,
        playwright: playwright,
        geminiApi: geminiApi, // <-- GÁN OBJECT GEMINI ĐÃ KHỞI TẠO ĐẦY ĐỦ
        batchProcessing: batchProcessing,
        fileOutput: fileOutput,
        validationStats: validationStats,

        errorsAggregated: {},
        logProcessingErrors: [],
        conferenceAnalysis: {},
    };
};

export const doesRequestOverlapFilter = (
    reqStartMillis: number | null,
    reqEndMillis: number | null,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    batchRequestId: string
): boolean => {
    // const logContext = { function: 'doesRequestOverlapFilter', batchRequestId }; // Gỡ comment nếu cần log

    if (filterStartMillis === null && filterEndMillis === null) {
        return true;
    }

    if (reqStartMillis === null || reqEndMillis === null) {
        return false;
    }

    const overlaps = (filterEndMillis === null || reqStartMillis <= filterEndMillis) &&
        (filterStartMillis === null || reqEndMillis >= filterStartMillis);

    return overlaps;
};