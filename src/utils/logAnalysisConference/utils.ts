// src/utils/logAnalysis/helpers.ts
import { ConferenceLogAnalysisResult, ConferenceAnalysisDetail, LogError, LogErrorContext } from '../../types/logAnalysis'; // Thêm ConferenceCrawlType
// --- Các helper function khác (normalizeErrorKey, createConferenceKey, addConferenceError, doesRequestOverlapFilter) giữ nguyên ---

// Giả sử các hàm này đã được export từ logAnalysis.types.ts hoặc types/index.ts
import {
    getInitialOverallAnalysis,
    getInitialGoogleSearchAnalysis,
    getInitialPlaywrightAnalysis,
    getInitialGeminiApiAnalysis,
    getInitialBatchProcessingAnalysis,
    getInitialFileOutputAnalysis,
    getInitialValidationStats
} from '../../types/logAnalysis'; // Đảm bảo đường dẫn này đúng

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
    crawlType: 'crawl', // Hoặc 'crawl' nếu đó là mặc định phổ biến nhất và type là ConferenceCrawlType (không phải ConferenceCrawlType | null)
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
    // Thêm các trường mới với giá trị mặc định
    persistedSaveStatus: undefined,
    persistedSaveTimestamp: undefined,
    steps: {
        search_attempted: false,
        search_success: null,
        search_attempts_count: 0,
        search_results_count: null,
        search_limited_count: null,
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
    timings: {}, // Khởi tạo là một object rỗng
    errors: [],
    dataQualityInsights: [],
    finalResultPreview: undefined,
    finalResult: undefined,
});



export const addConferenceError = (
    detail: ConferenceAnalysisDetail,
    timestamp: string,
    errorSource: any, // Có thể là string, Error object, hoặc object log gốc
    // Các tham số sau là tùy chọn và cung cấp thêm thông tin nếu errorSource không đủ
    options?: {
        defaultMessage?: string; // Thông điệp mặc định nếu không trích xuất được từ errorSource
        errorCode?: string;      // Mã lỗi cụ thể
        keyPrefix?: string;      // Tiền tố cho normalized key
        sourceService?: string;
        errorType?: LogError['errorType'];
        context?: LogErrorContext;
        // isRecovered?: boolean; // isRecovered nên được cập nhật bởi logic bên ngoài addConferenceError
        additionalDetails?: Record<string, any>; // Chi tiết bổ sung muốn ghi đè hoặc thêm vào
    }
): void => {
    let extractedMessage: string;
    let extractedErrorCode: string | undefined = options?.errorCode;
    let extractedDetails: any = {};
    let finalSourceService: string | undefined = options?.sourceService;
    let finalErrorType: LogError['errorType'] | undefined = options?.errorType;

    // 1. Trích xuất thông tin từ errorSource
    if (typeof errorSource === 'string') {
        extractedMessage = errorSource;
    } else if (errorSource instanceof Error) {
        extractedMessage = errorSource.message;
        if (!extractedDetails.name) extractedDetails.name = errorSource.name;
        if (!extractedDetails.stack) extractedDetails.stack = errorSource.stack?.substring(0, 500);
        // Cố gắng lấy errorCode từ các thuộc tính phổ biến của Error object (nếu có)
        if (!extractedErrorCode && (errorSource as any).code) extractedErrorCode = String((errorSource as any).code);
        if (!extractedErrorCode && (errorSource as any).errno) extractedErrorCode = String((errorSource as any).errno);
    } else if (errorSource && typeof errorSource === 'object') {
        // Nếu errorSource là một object (ví dụ: từ log entry)
        extractedMessage = errorSource.message || errorSource.msg || errorSource.reason || errorSource.detail || options?.defaultMessage || 'Unknown error object';
        if (!extractedErrorCode) extractedErrorCode = errorSource.errorCode || errorSource.code || errorSource.error_code;
        if (!finalSourceService) finalSourceService = errorSource.service || errorSource.sourceService;
        if (!finalErrorType) finalErrorType = errorSource.errorType || errorSource.type;

        // Sao chép các thuộc tính của errorSource vào details, trừ các trường đã xử lý
        const commonKeys = ['message', 'msg', 'reason', 'detail', 'errorCode', 'code', 'error_code', 'service', 'sourceService', 'errorType', 'type', 'timestamp', 'level', 'event'];
        for (const key in errorSource) {
            if (Object.prototype.hasOwnProperty.call(errorSource, key) && !commonKeys.includes(key)) {
                extractedDetails[key] = errorSource[key];
            }
        }
    } else {
        extractedMessage = options?.defaultMessage || 'Unknown error source';
    }

    // Ghi đè hoặc bổ sung details từ options.additionalDetails
    if (options?.additionalDetails) {
        extractedDetails = { ...extractedDetails, ...options.additionalDetails };
    }

    // 2. Tạo normalized key
    const keyPrefix = options?.keyPrefix ? `${options.keyPrefix}_` : '';
    const keyBase = extractedErrorCode || extractedMessage;
    const normalizedKey = keyPrefix + normalizeErrorKey(keyBase);

    // 3. Tạo error entry
    const errorEntry: LogError = {
        timestamp: timestamp,
        message: extractedMessage,
        key: normalizedKey,
        details: Object.keys(extractedDetails).length > 0 ? extractedDetails : undefined,
        errorCode: extractedErrorCode,
        sourceService: finalSourceService,
        errorType: finalErrorType || 'Unknown',
        isRecovered: false, // Mặc định lỗi mới là chưa được phục hồi
        context: options?.context,
    };

    // 4. Thêm vào mảng errors của ConferenceAnalysisDetail
    if (!detail.errors) {
        detail.errors = [];
    }

    // Tùy chọn: Tránh thêm lỗi hoàn toàn giống hệt nhau (cùng key, cùng message, cùng timestamp)
    // if (detail.errors.some(e => e.key === errorEntry.key && e.message === errorEntry.message && e.timestamp === errorEntry.timestamp)) {
    //     return;
    // }

    detail.errors.push(errorEntry);
};


// --- CẬP NHẬT initializeConferenceLogAnalysisResult ---
export const initializeConferenceLogAnalysisResult = (
    logFilePath?: string, // logFilePath giờ là optional
    filterRequestId?: string
): ConferenceLogAnalysisResult => {
    const overall = getInitialOverallAnalysis();
    const googleSearch = getInitialGoogleSearchAnalysis();
    const playwright = getInitialPlaywrightAnalysis();
    const geminiApi = getInitialGeminiApiAnalysis();
    const batchProcessing = getInitialBatchProcessingAnalysis();
    const fileOutput = getInitialFileOutputAnalysis();
    const validationStats = getInitialValidationStats();

    return {
        analysisTimestamp: new Date().toISOString(),
        logFilePath: logFilePath, // Sẽ là undefined khi tổng hợp, hoặc đường dẫn file cụ thể khi phân tích đơn lẻ
        status: 'Processing',
        errorMessage: undefined,
        filterRequestId: filterRequestId,
        analyzedRequestIds: [],
        requests: {},
        totalLogEntries: 0,
        parsedLogEntries: 0,
        parseErrors: 0, // Nên là number
        errorLogCount: 0,
        fatalLogCount: 0,
        overall: overall,
        googleSearch: googleSearch,
        playwright: playwright,
        geminiApi: geminiApi,
        batchProcessing: batchProcessing,
        fileOutput: fileOutput,
        validationStats: validationStats,
        errorsAggregated: {},
        logProcessingErrors: [],
        conferenceAnalysis: {},
    };
};