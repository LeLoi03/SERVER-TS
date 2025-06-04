// src/utils/logAnalysisJournal/helpers.ts
import {
    JournalLogAnalysisResult,
    JournalAnalysisDetail,
    JournalAnalysisDetailSteps,
    LogError,
    LogErrorContext,
    JournalRequestLogData,
    JournalReadLogResult,
    JournalFilteredData,
    JournalOverallAnalysis,
    PlaywrightJournalAnalysis,
    ApiKeyManagerJournalAnalysis,
    GoogleSearchJournalAnalysis,
    BioxbioAnalysis,
    ScimagoJournalAnalysis,
    JournalFileOutputAnalysis
} from '../../types/logAnalysisJournal/logAnalysisJournal.types';
import fsSync from 'fs'; // Sử dụng fsSync cho existsSync
import readline from 'readline';
import { LogEntry } from '../../types/logAnalysis';


// Hàm helper mới hoặc cải tiến để lấy JournalAnalysisDetail
export const findOrCreateJournalDetail = (
    logEntry: any,
    results: JournalLogAnalysisResult,
    entryTimestampISO: string // Thêm entryTimestampISO để có thể dùng cho initializeJournalAnalysisDetail
): JournalAnalysisDetail | null => {
    const batchRequestId = logEntry.batchRequestId;

    // Ưu tiên các trường cụ thể từ context của log entry
    let journalTitle = logEntry.journalTitle // Thường dùng trong task-specific logs
                      || logEntry.title // Dùng trong googleSearch, scimagojr detail logs
                      || (logEntry.context && (logEntry.context.journalTitle || logEntry.context.title))
                      || (logEntry.row && (logEntry.row.Title || logEntry.row.journalName)); // Từ CSVRow hoặc TableRowData

    // Nếu không có title rõ ràng, và là event từ scimagojr.ts liên quan đến URL cụ thể
    // thì không nên tạo mới detail ở đây, mà nên để handler của scimagojr.ts tìm detail đã có bằng URL.
    // Hàm này chủ yếu dùng cho các event đã có context title.

    const sourceId = logEntry.sourceId
                     || (logEntry.context && logEntry.context.sourceId)
                     || (logEntry.row && logEntry.row.Sourceid);

    if (!batchRequestId || !journalTitle) {
        // console.warn("findOrCreateJournalDetail: Cannot get/create journal detail: missing batchRequestId or journalTitle", { batchRequestId, journalTitle, event: logEntry.event });
        return null;
    }

    const journalKey = createJournalKey(batchRequestId, journalTitle, sourceId);
    if (!journalKey) {
        // console.warn("findOrCreateJournalDetail: Could not create journal key", { batchRequestId, journalTitle, sourceId, event: logEntry.event });
        return null;
    }

    if (!results.journalAnalysis[journalKey]) {
        // console.log(`findOrCreateJournalDetail: Initializing new detail for key: ${journalKey}`, logEntry);
        const dataSource = logEntry.dataSource // from crawlJournals
                         || (logEntry.context && logEntry.context.dataSource)
                         || (results.requests[batchRequestId] && results.requests[batchRequestId].dataSource)
                         || (logEntry.process === 'scimago' ? 'scimago' : (logEntry.process === 'csv' ? 'client' : 'unknown'));

        const originalInput = logEntry.url // Thường cho scimago page/detail
                            || logEntry.journalUrl // Cho scimago detail
                            || (logEntry.row ? `CSVRow_idx:${logEntry.rowIndex}` : undefined); // Cho client data

        results.journalAnalysis[journalKey] = initializeJournalAnalysisDetail(
            batchRequestId,
            journalTitle,
            dataSource,
            sourceId,
            originalInput
        );
        // Gán startTime nếu detail vừa được tạo và event có timestamp
        if (results.journalAnalysis[journalKey].status === 'unknown' && !results.journalAnalysis[journalKey].startTime && entryTimestampISO) {
            results.journalAnalysis[journalKey].startTime = entryTimestampISO;
            results.journalAnalysis[journalKey].status = 'processing';
        }
    }
    return results.journalAnalysis[journalKey];
};



export const normalizeErrorKey = (error: any): string => {
    let message = 'Unknown Error Structure';
    if (error && typeof error === 'object') {
        message = error.message || error.msg || error.reason || error.details || JSON.stringify(error);
    } else if (error) {
        message = String(error);
    }
    return message.substring(0, 150).replace(/\s+/g, ' ').trim().toLowerCase();
};

export const createJournalKey = (batchRequestId: string, journalTitle: string | undefined, sourceId?: string | undefined): string | null => {
    if (!batchRequestId || typeof batchRequestId !== 'string' || batchRequestId.trim() === '') {
        return null;
    }
    const titlePart = (journalTitle || 'unknown_title').trim().toLowerCase();
    const idPart = (sourceId || 'no_id').trim().toLowerCase();

    if (titlePart === 'unknown_title' && idPart === 'no_id') return null;

    // Prioritize title, but include sourceId if available for more uniqueness, especially if title is generic
    return `${batchRequestId.trim()} - ${titlePart}${sourceId ? ` (${idPart})` : ''}`;
};


export const getInitialJournalAnalysisDetailSteps = (): JournalAnalysisDetailSteps => ({
    scimago_page_processed: undefined, // Will be set to true/false for scimago source
    bioxbio_attempted: false,
    bioxbio_success: null,
    bioxbio_cache_used: null,
    scimago_details_attempted: false,
    scimago_details_success: null,
    image_search_attempted: false,
    image_search_success: null,
    image_search_key_rotated_due_to_error: undefined,
    jsonl_write_success: null,
});

export const initializeJournalAnalysisDetail = (
    batchRequestId: string,
    journalTitle: string,
    dataSource: 'scimago' | 'client' | 'unknown',
    sourceId?: string,
    originalInput?: string
): JournalAnalysisDetail => ({
    batchRequestId,
    journalTitle,
    sourceId,
    dataSource,
    originalInput,
    status: 'unknown',
    startTime: null,
    endTime: null,
    durationSeconds: null,
    steps: getInitialJournalAnalysisDetailSteps(),
    errors: [],
    finalResultPreview: undefined,
    finalResult: undefined,
});

export const addJournalError = (
    detail: JournalAnalysisDetail,
    timestamp: string,
    errorSource: any,
    options?: {
        defaultMessage?: string;
        errorCode?: string;
        keyPrefix?: string;
        sourceService?: string;
        errorType?: LogError['errorType'];
        context?: LogErrorContext;
        additionalDetails?: Record<string, any>;
    }
): void => {
    let extractedMessage: string;
    let extractedErrorCode: string | undefined = options?.errorCode;
    let extractedDetails: any = {};
    let finalSourceService: string | undefined = options?.sourceService;
    let finalErrorType: LogError['errorType'] | undefined = options?.errorType;

    if (typeof errorSource === 'string') {
        extractedMessage = errorSource;
    } else if (errorSource instanceof Error) {
        extractedMessage = errorSource.message;
        if (!extractedDetails.name) extractedDetails.name = errorSource.name;
        if (!extractedDetails.stack) extractedDetails.stack = errorSource.stack?.substring(0, 500);
        if (!extractedErrorCode && (errorSource as any).code) extractedErrorCode = String((errorSource as any).code);
    } else if (errorSource && typeof errorSource === 'object') {
        extractedMessage = errorSource.message || errorSource.msg || errorSource.reason || errorSource.detail || options?.defaultMessage || 'Unknown error object';
        if (!extractedErrorCode) extractedErrorCode = errorSource.errorCode || errorSource.code || errorSource.error_code;
        if (!finalSourceService) finalSourceService = errorSource.service || errorSource.sourceService;
        if (!finalErrorType) finalErrorType = errorSource.errorType || errorSource.type;

        const commonKeys = ['message', 'msg', 'reason', 'detail', 'errorCode', 'code', 'error_code', 'service', 'sourceService', 'errorType', 'type', 'timestamp', 'level', 'event', 'err'];
        for (const key in errorSource) {
            if (Object.prototype.hasOwnProperty.call(errorSource, key) && !commonKeys.includes(key)) {
                if (key === 'err' && errorSource.err && typeof errorSource.err === 'object') { // Special handling for pino's err object
                    if (errorSource.err.message && !extractedMessage.includes(errorSource.err.message)) extractedMessage += ` - ${errorSource.err.message}`;
                    if (errorSource.err.stack && !extractedDetails.stack) extractedDetails.stack = errorSource.err.stack.substring(0,500);
                    if (errorSource.err.code && !extractedErrorCode) extractedErrorCode = errorSource.err.code;
                    for(const errKey in errorSource.err){
                        if (Object.prototype.hasOwnProperty.call(errorSource.err, errKey) && !commonKeys.includes(errKey) && !extractedDetails[errKey]) {
                             extractedDetails[errKey] = errorSource.err[errKey];
                        }
                    }
                } else {
                    extractedDetails[key] = errorSource[key];
                }
            }
        }
    } else {
        extractedMessage = options?.defaultMessage || 'Unknown error source';
    }

    if (options?.additionalDetails) {
        extractedDetails = { ...extractedDetails, ...options.additionalDetails };
    }

    const keyPrefix = options?.keyPrefix ? `${options.keyPrefix}_` : '';
    const keyBase = extractedErrorCode || extractedMessage;
    const normalizedKey = keyPrefix + normalizeErrorKey(keyBase);

    const errorEntry: LogError = {
        timestamp: timestamp,
        message: extractedMessage,
        key: normalizedKey,
        details: Object.keys(extractedDetails).length > 0 ? extractedDetails : undefined,
        errorCode: extractedErrorCode,
        sourceService: finalSourceService,
        errorType: finalErrorType || 'Unknown',
        isRecovered: false,
        context: options?.context,
    };

    if (!detail.errors) {
        detail.errors = [];
    }
    detail.errors.push(errorEntry);
};


export const getInitialOverallJournalAnalysis = (): JournalOverallAnalysis => ({
    startTime: null,
    endTime: null,
    durationSeconds: null,
    totalRequestsAnalyzed: 0,
    dataSourceCounts: { scimago: 0, client: 0, unknown: 0 },
    totalJournalsInput: 0,
    totalJournalsProcessed: 0,
    totalJournalsFailed: 0,
    totalJournalsSkipped: 0,
    processedJournalsWithBioxbioSuccess: 0,
    processedJournalsWithScimagoDetailsSuccess: 0,
    processedJournalsWithImageSearchSuccess: 0,
});

export const getInitialPlaywrightJournalAnalysis = (): PlaywrightJournalAnalysis => ({
    browserLaunchTimeMs: undefined,
    browserLaunchSuccess: undefined,
    contextCreateTimeMs: undefined,
    contextCreateSuccess: undefined,
    pagesCreateTimeMs: undefined,
    pagesCreateSuccess: undefined,
    totalErrors: 0,
    errorDetails: {},
});

export const getInitialApiKeyManagerJournalAnalysis = (): ApiKeyManagerJournalAnalysis => ({
    keysInitialized: 0,
    initializationErrors: 0,
    rotationsDueToUsage: 0,
    rotationsDueToError: 0,
    rotationsFailedExhausted: 0,
    totalKeysExhaustedReported: 0,
    totalRequestsMade: 0,
});

export const getInitialGoogleSearchJournalAnalysis = (): GoogleSearchJournalAnalysis => ({
    totalSearchesAttempted: 0,
    totalSearchesSucceeded: 0,
    totalSearchesFailedAfterRetries: 0,
    totalSearchesSkippedNoCreds: 0,
    totalSearchesWithResults: 0,
    totalQuotaErrorsEncountered: 0,
    apiErrors: {},
});

export const getInitialBioxbioAnalysis = (): BioxbioAnalysis => ({
    totalFetchesAttempted: 0,
    totalFetchesSucceeded: 0,
    totalFetchesFailed: 0,
    cacheHits: 0,
    cacheMisses: 0,
    totalErrors: 0,
    errorDetails: {},
});

export const getInitialScimagoJournalAnalysis = (): ScimagoJournalAnalysis => ({
    scimagoListPagesProcessed: 0,
    scimagoListPagesFailed: 0,
    scimagoDetailPagesAttempted: 0,
    scimagoDetailPagesSucceeded: 0,
    scimagoDetailPagesFailed: 0,
    scimagoDetailPagesSkippedNullUrl: 0,
    lastPageNumberDeterminations: 0,
    lastPageNumberFailures: 0,
    totalErrors: 0,
    errorDetails: {},
});

export const getInitialJournalFileOutputAnalysis = (): JournalFileOutputAnalysis => ({
    jsonlRecordsAttempted: 0,
    jsonlRecordsSuccessfullyWritten: 0,
    jsonlWriteErrors: 0,
    outputFileInitialized: null,
    outputFileInitFailed: null,
    clientCsvParseAttempts: 0,
    clientCsvParseSuccess: 0,
    clientCsvParseFailed: 0,
});


export const initializeJournalLogAnalysisResult = (
    logFilePath?: string, // logFilePath giờ là optional
    filterRequestId?: string
): JournalLogAnalysisResult => {
    return {
        analysisTimestamp: new Date().toISOString(),
        logFilePath: logFilePath, // Sẽ là undefined khi tổng hợp
        status: 'Processing',
        errorMessage: undefined,
        filterRequestId: filterRequestId,
        analyzedRequestIds: [],
        requests: {},
        totalLogEntries: 0,
        parsedLogEntries: 0,
        parseErrors: 0,
        errorLogCount: 0,
        fatalLogCount: 0,
        overall: getInitialOverallJournalAnalysis(),
        playwright: getInitialPlaywrightJournalAnalysis(),
        apiKeyManager: getInitialApiKeyManagerJournalAnalysis(),
        googleSearch: getInitialGoogleSearchJournalAnalysis(),
        bioxbio: getInitialBioxbioAnalysis(),
        scimago: getInitialScimagoJournalAnalysis(),
        fileOutput: getInitialJournalFileOutputAnalysis(),
        errorsAggregated: {},
        logProcessingErrors: [],
        journalAnalysis: {},
    };
};


// --- CẬP NHẬT readAndGroupJournalLogs ---
/**
 * Reads a single journal log file (expected to contain logs for only one batchRequestId)
 * and groups them.
 * @param logFilePath Path to the specific request's log file.
 * @param expectedBatchRequestId The batchRequestId expected to be in this log file.
 */
export const readAndGroupJournalLogs = async (
    logFilePath: string,
    expectedBatchRequestId: string // Bắt buộc phải có ID của request mà file này thuộc về
): Promise<JournalReadLogResult> => { // Sử dụng JournalReadLogResult
    const requestsData = new Map<string, JournalRequestLogData>(); // Sử dụng JournalRequestLogData
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!expectedBatchRequestId) {
        tempLogProcessingErrors.push("CRITICAL: readAndGroupJournalLogs called without an expectedBatchRequestId.");
        return { requestsData, totalEntries, parsedEntries, parseErrors: parseErrorsCount, logProcessingErrors: tempLogProcessingErrors };
    }

    if (!fsSync.existsSync(logFilePath)) {
        tempLogProcessingErrors.push(`Log file not found at ${logFilePath} for request ${expectedBatchRequestId}`);
        return { requestsData, totalEntries, parsedEntries, parseErrors: parseErrorsCount, logProcessingErrors: tempLogProcessingErrors };
    }

    const fileStream = fsSync.createReadStream(logFilePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    // Khởi tạo JournalRequestLogData cho expectedBatchRequestId
    // Đảm bảo JournalRequestLogData có trường dataSource
    const requestInfo: JournalRequestLogData = {
        logs: [],
        startTime: null,
        endTime: null,
        dataSource: undefined // Sẽ được cập nhật nếu tìm thấy trong log
    };
    requestsData.set(expectedBatchRequestId, requestInfo);
    let dataSourceFound: ('scimago' | 'client' | string | undefined) = undefined;

    try {
        for await (const line of rl) {
            totalEntries++;
            if (!line.trim()) continue;

            try {
                const logEntry = JSON.parse(line) as LogEntry; // Sử dụng LogEntry đã import
                parsedEntries++;
                const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;

                if (logEntry.batchRequestId && logEntry.batchRequestId !== expectedBatchRequestId) {
                    tempLogProcessingErrors.push(
                        `Line ${totalEntries}: Mismatched batchRequestId. Expected '${expectedBatchRequestId}', found '${logEntry.batchRequestId}' in file ${logFilePath}.`
                    );
                    continue;
                }

                if (!isNaN(entryTimeMillis)) {
                    requestInfo.logs.push(logEntry);

                    if (requestInfo.startTime === null || entryTimeMillis < requestInfo.startTime) {
                        requestInfo.startTime = entryTimeMillis;
                    }
                    if (requestInfo.endTime === null || entryTimeMillis > requestInfo.endTime) {
                        requestInfo.endTime = entryTimeMillis;
                    }

                    // Cố gắng tìm dataSource từ log entry, ưu tiên entry đầu tiên có thông tin này
                    if (!dataSourceFound && logEntry.dataSource) {
                        dataSourceFound = logEntry.dataSource as ('scimago' | 'client' | string);
                    }
                } else {
                    tempLogProcessingErrors.push(`Line ${totalEntries}: Invalid or missing time field in ${logFilePath}`);
                }
            } catch (parseError: any) {
                parseErrorsCount++;
                tempLogProcessingErrors.push(`Line ${totalEntries} in ${logFilePath}: ${parseError.message}`);
            }
        }
    } catch (readError: any) {
        tempLogProcessingErrors.push(`Error reading file ${logFilePath}: ${readError.message}`);
    }

    // Gán dataSource đã tìm thấy vào requestInfo
    if (dataSourceFound) {
        requestInfo.dataSource = dataSourceFound;
    } else if (requestInfo.logs.length > 0) {
        // Nếu không tìm thấy ở entry đầu, thử tìm trong các entry khác (ít hiệu quả hơn)
        for (const entry of requestInfo.logs) {
            if (entry.dataSource) {
                requestInfo.dataSource = entry.dataSource as ('scimago' | 'client' | string);
                break;
            }
        }
        if (!requestInfo.dataSource) {
             tempLogProcessingErrors.push(`DataSource not found in logs for request ${expectedBatchRequestId} in file ${logFilePath}.`);
        }
    }


    if (requestInfo.logs.length === 0 && totalEntries > 0) {
        tempLogProcessingErrors.push(`No valid log entries processed for request ${expectedBatchRequestId} in file ${logFilePath}, though ${totalEntries} lines were read.`);
    }

    return {
        requestsData,
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};

export const doesRequestOverlapFilter = (
    reqStartMillis: number | null,
    reqEndMillis: number | null,
    filterStartMillisFromUser: number | null, // Đổi tên để rõ ràng
    filterEndMillisFromUser: number | null,   // Đổi tên để rõ ràng
    batchRequestId: string
): boolean => {
    // Nếu không có filter thời gian từ người dùng, coi như luôn chồng lấn (bao gồm request)
    if (filterStartMillisFromUser === null && filterEndMillisFromUser === null) {
        return true;
    }

    // Nếu request không có startTime hoặc endTime, không thể xác định chồng lấn nếu có filter
    // (trừ khi filter cũng là null, đã xử lý ở trên)
    if (reqStartMillis === null || reqEndMillis === null) {
        return false;
    }

    // Điều kiện chồng lấn chuẩn:
    // (Request bắt đầu TRƯỚC KHI Filter kết thúc) VÀ (Request kết thúc SAU KHI Filter bắt đầu)
    const overlaps =
        (filterEndMillisFromUser === null || reqStartMillis <= filterEndMillisFromUser) &&
        (filterStartMillisFromUser === null || reqEndMillis >= filterStartMillisFromUser);

    return overlaps;
};

export const filterJournalRequests = (
    allRequestsData: Map<string, JournalRequestLogData>, // Sử dụng JournalRequestLogData
    filterStartMillisFromUser: number | null, // Tham số filter từ người dùng
    filterEndMillisFromUser: number | null,   // Tham số filter từ người dùng
    batchRequestIdFilter?: string
): JournalFilteredData => { // Sử dụng JournalFilteredData
    const filteredRequestsOutput = new Map<string, JournalRequestLogData>(); // Sử dụng JournalRequestLogData

    // Biến để theo dõi min/max start/end time của các *request được chọn*,
    // dùng khi người dùng không cung cấp filter.
    let minActualRequestStartTime: number | null = null;
    let maxActualRequestEndTime: number | null = null;

    const processSingleRequest = (batchRequestId: string, requestInfo: JournalRequestLogData) => {
        const includeThisRequest = doesRequestOverlapFilter(
            requestInfo.startTime,
            requestInfo.endTime,
            filterStartMillisFromUser,
            filterEndMillisFromUser,
            batchRequestId
        );

        if (includeThisRequest) {
            filteredRequestsOutput.set(batchRequestId, requestInfo); // Lấy toàn bộ request

            // Cập nhật min/max start/end time thực tế từ các request được chọn.
            if (requestInfo.startTime !== null) {
                if (minActualRequestStartTime === null || requestInfo.startTime < minActualRequestStartTime) {
                    minActualRequestStartTime = requestInfo.startTime;
                }
            }
            if (requestInfo.endTime !== null) {
                // Sửa lỗi logic: phải là > maxActualRequestEndTime
                if (maxActualRequestEndTime === null || requestInfo.endTime > maxActualRequestEndTime) {
                    maxActualRequestEndTime = requestInfo.endTime;
                }
            }
        }
    };

    if (batchRequestIdFilter) {
        const requestInfo = allRequestsData.get(batchRequestIdFilter);
        if (requestInfo) {
            processSingleRequest(batchRequestIdFilter, requestInfo);
        }
    } else {
        for (const [batchRequestId, requestInfo] of allRequestsData.entries()) {
            // Không cần kiểm tra requestInfo.startTime/endTime !== null ở đây nữa
            // vì doesRequestOverlapFilter sẽ xử lý trường hợp đó.
            processSingleRequest(batchRequestId, requestInfo);
        }
    }

    // Xác định analysisStartMillis và analysisEndMillis cho kết quả trả về.
    // Đây sẽ là khoảng thời gian được sử dụng bởi calculateJournalFinalMetrics để đặt
    // results.overall.startTime và results.overall.endTime.
    let finalAnalysisStartMillis: number | null;
    let finalAnalysisEndMillis: number | null;

    if (filterStartMillisFromUser !== null || filterEndMillisFromUser !== null) {
        // Nếu người dùng CÓ cung cấp filter, thì khoảng thời gian phân tích TỔNG THỂ
        // (overall.startTime/endTime) sẽ phản ánh đúng filter của người dùng.
        finalAnalysisStartMillis = filterStartMillisFromUser;
        finalAnalysisEndMillis = filterEndMillisFromUser;
    } else {
        // Nếu người dùng KHÔNG cung cấp filter, thì khoảng thời gian phân tích TỔNG THỂ
        // sẽ là min/max thực tế của các request được chọn.
        finalAnalysisStartMillis = minActualRequestStartTime;
        finalAnalysisEndMillis = maxActualRequestEndTime;
    }

    return {
        filteredRequests: filteredRequestsOutput,
        analysisStartMillis: finalAnalysisStartMillis,
        analysisEndMillis: finalAnalysisEndMillis
    };
};