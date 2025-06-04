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
import fsSync from 'fs'; // Sử dụng fsSync cho existsSync
import readline from 'readline';
import {
    ReadLogResult,
    RequestLogData,
    FilteredData,
    LogEntry
} from '../../types/logAnalysis';

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



// --- CẬP NHẬT readAndGroupConferenceLogs ---
/**
 * Reads a single conference log file (expected to contain logs for only one batchRequestId)
 * and groups them.
 * @param logFilePath Path to the specific request's log file.
 * @param expectedBatchRequestId The batchRequestId expected to be in this log file.
 *                               This is used for validation and as the key in the returned map.
 */
export const readAndGroupConferenceLogs = async (
    logFilePath: string,
    expectedBatchRequestId: string // Bắt buộc phải có ID của request mà file này thuộc về
): Promise<ReadLogResult> => {
    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!expectedBatchRequestId) {
        // Đây là một lỗi logic nếu hàm này được gọi mà không có expectedBatchRequestId
        // trong kiến trúc mới.
        tempLogProcessingErrors.push("CRITICAL: readAndGroupConferenceLogs called without an expectedBatchRequestId.");
        return {
            requestsData,
            totalEntries,
            parsedEntries,
            parseErrors: parseErrorsCount,
            logProcessingErrors: tempLogProcessingErrors,
        };
    }

    if (!fsSync.existsSync(logFilePath)) {
        tempLogProcessingErrors.push(`Log file not found at ${logFilePath} for request ${expectedBatchRequestId}`);
        // Trả về kết quả rỗng nhưng có lỗi, để service phân tích biết file không tồn tại
        return {
            requestsData, // Rỗng
            totalEntries: 0,
            parsedEntries: 0,
            parseErrors: 0,
            logProcessingErrors: tempLogProcessingErrors,
        };
    }

    const fileStream = fsSync.createReadStream(logFilePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    let requestInfo: RequestLogData = { logs: [], startTime: null, endTime: null };
    // Vì file này chỉ cho một request, chúng ta có thể đặt nó vào map ngay từ đầu
    requestsData.set(expectedBatchRequestId, requestInfo);

    try {
        for await (const line of rl) {
            totalEntries++;
            if (!line.trim()) continue;

            try {
                const logEntry = JSON.parse(line) as LogEntry; // Đảm bảo LogEntry có trường 'time' và 'batchRequestId' (optional)
                parsedEntries++;
                const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;

                // Kiểm tra xem batchRequestId trong log entry (nếu có) có khớp với expectedBatchRequestId không
                // Logger của request đã tự động thêm batchRequestId vào base, nên nó sẽ có ở đây.
                if (logEntry.batchRequestId && logEntry.batchRequestId !== expectedBatchRequestId) {
                    tempLogProcessingErrors.push(
                        `Line ${totalEntries}: Mismatched batchRequestId. Expected '${expectedBatchRequestId}', found '${logEntry.batchRequestId}' in file ${logFilePath}.`
                    );
                    continue; // Bỏ qua entry này nếu không khớp
                }
                // Nếu logEntry không có batchRequestId, ta giả định nó thuộc về expectedBatchRequestId
                // vì đây là file log riêng của request đó.

                if (!isNaN(entryTimeMillis)) {
                    requestInfo.logs.push(logEntry);

                    if (requestInfo.startTime === null || entryTimeMillis < requestInfo.startTime) {
                        requestInfo.startTime = entryTimeMillis;
                    }
                    if (requestInfo.endTime === null || entryTimeMillis > requestInfo.endTime) {
                        requestInfo.endTime = entryTimeMillis;
                    }
                } else {
                    tempLogProcessingErrors.push(`Line ${totalEntries}: Invalid or missing time field.`);
                }
            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries} in ${logFilePath}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
            }
        }
    } catch (readError: any) {
        // Ném lỗi đọc file để service phân tích có thể bắt và xử lý
        tempLogProcessingErrors.push(`Error reading file ${logFilePath}: ${readError.message}`);
        // throw readError; // Hoặc chỉ ghi lỗi và trả về dữ liệu đã parse được
    }

    // Nếu không có entry nào được parse thành công cho request này, nhưng file có nội dung
    if (requestInfo.logs.length === 0 && totalEntries > 0) {
        tempLogProcessingErrors.push(`No valid log entries processed for request ${expectedBatchRequestId} in file ${logFilePath}, though ${totalEntries} lines were read.`);
        // Không xóa requestInfo khỏi requestsData, để service phân tích biết đã cố đọc file này
    }


    return {
        requestsData, // Sẽ chỉ chứa một entry với key là expectedBatchRequestId
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};


// --- filterRequests giữ nguyên ---
// Hàm này vẫn hữu ích để lọc theo thời gian cho dữ liệu của một request cụ thể
// hoặc khi tổng hợp (mặc dù khi tổng hợp, việc lọc thời gian có thể được xử lý bởi
// việc chỉ phân tích các request có file log được sửa đổi trong khoảng thời gian đó,
// hoặc để `analyzeLiveLogsForRequest` tự lọc).
export const filterRequests = (
    allRequestsData: Map<string, RequestLogData>, // Trong trường hợp phân tích đơn lẻ, map này chỉ có 1 entry
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    batchRequestIdFilter?: string // Khi phân tích đơn lẻ, đây sẽ là ID của request đó
): FilteredData => {
    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    const targetRequestId = batchRequestIdFilter;

    if (targetRequestId) {
        const requestInfo = allRequestsData.get(targetRequestId);
        if (requestInfo) { // Không cần kiểm tra startTime/endTime ở đây vì chúng ta muốn lấy requestInfo dù có log hay không
            // Việc lọc theo thời gian sẽ áp dụng cho các log *bên trong* requestInfo này sau đó,
            // hoặc để quyết định có nên xử lý requestInfo này không.
            // Ở đây, chúng ta chỉ cần lấy requestInfo nếu ID khớp.
            // Việc requestInfo.startTime/endTime có null hay không sẽ được xử lý bởi doesRequestOverlapFilter.

            const overlapsTimeFilter = doesRequestOverlapFilter(
                requestInfo.startTime, // startTime và endTime của request
                requestInfo.endTime,
                filterStartMillis,     // filter của người dùng
                filterEndMillis,
                targetRequestId
            );

            if (overlapsTimeFilter) {
                filteredRequests.set(targetRequestId, requestInfo);
                // analysisStartMillis/EndMillis nên là thời gian thực tế của request này nếu nó được chọn
                analysisStartMillis = requestInfo.startTime;
                analysisEndMillis = requestInfo.endTime;
            }
        }
    } else { // Trường hợp tổng hợp (không nên xảy ra nếu `readAndGroupConferenceLogs` chỉ trả về 1 request)
        // Tuy nhiên, giữ lại logic này nếu `filterRequests` có thể được gọi với nhiều request
        for (const [batchRequestId, requestInfo] of allRequestsData.entries()) {
            if (requestInfo.startTime !== null && requestInfo.endTime !== null) {
                const includeRequest = doesRequestOverlapFilter(
                    requestInfo.startTime,
                    requestInfo.endTime,
                    filterStartMillis,
                    filterEndMillis,
                    batchRequestId
                );

                if (includeRequest) {
                    filteredRequests.set(batchRequestId, requestInfo);
                    if (requestInfo.startTime !== null) {
                        analysisStartMillis = Math.min(requestInfo.startTime, analysisStartMillis ?? requestInfo.startTime);
                    }
                    if (requestInfo.endTime !== null) {
                        analysisEndMillis = Math.max(requestInfo.endTime, analysisEndMillis ?? requestInfo.endTime);
                    }
                }
            }
        }
    }
    return { filteredRequests, analysisStartMillis, analysisEndMillis };
};