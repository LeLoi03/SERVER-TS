import fs from 'fs';
import path from 'path';
import readline from 'readline';
// Đảm bảo đường dẫn import logger và types là chính xác
import { logger } from '../conference/11_utils'; // Giả định đường dẫn đúng
import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis'; // Giả định đường dẫn đúng
// import { title } from 'process'; // Không cần import này nữa

// --- Helper function: Normalize Error Key ---
const normalizeErrorKey = (error: any): string => {
    let message = 'Unknown Error Structure';
    if (error && typeof error === 'object') {
        message = error.message || error.reason || error.details || JSON.stringify(error);
    } else if (error) {
        message = String(error);
    }
    return message.substring(0, 150).replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
};

// --- Helper function: Create Composite Key ---
const createConferenceKey = (acronym?: string | null, title?: string | null): string | null => {
    if (acronym && typeof acronym === 'string' && acronym.trim() !== '' &&
        title && typeof title === 'string' && title.trim() !== '') {
        // Chỉ tạo key nếu cả acronym và title hợp lệ và không rỗng
        return `${acronym.trim()} - ${title.trim()}`;
    }
    // Trả về null nếu thiếu thông tin để tạo key duy nhất đáng tin cậy
    return null;
};


// --- Helper function: Initialize Conference Detail ---
// Vẫn nhận acronym và title riêng biệt để lưu vào detail object
const initializeConferenceDetail = (acronym: string, title: string): ConferenceAnalysisDetail => ({
    title: title,
    acronym: acronym,
    status: 'unknown', // Initial status
    startTime: null,
    endTime: null,
    durationSeconds: null,
    steps: {
        search_attempted: false,
        search_success: null,
        search_attempts_count: 0,
        search_results_count: null,
        search_filtered_count: null,
        html_save_attempted: false,
        link_processing_failed: [],
        html_save_success: null,
        link_processing_attempted: 0,
        link_processing_success: 0,
        gemini_determine_attempted: false,
        gemini_determine_success: null,
        gemini_determine_cache_used: null,
        gemini_extract_attempted: false,
        gemini_extract_success: null,
        gemini_extract_cache_used: null,
    },
    errors: [],
    finalResultPreview: undefined,
});

// --- Helper function: Add Error to Conference Detail ---
const addConferenceError = (
    detail: ConferenceAnalysisDetail,
    timestamp: string,
    errorSource: any,
    defaultMsg: string
) => {
    const normError = normalizeErrorKey(errorSource || defaultMsg);
    detail.errors.push({
        timestamp: timestamp,
        message: normError,
        details: errorSource ? JSON.stringify(errorSource, Object.getOwnPropertyNames(errorSource)) : undefined
    });
};


interface RequestLogData {
    logs: any[];
    startTime: number | null;
    endTime: number | null;
}

// --- Core Log Analysis Function ---
export const performLogAnalysis = async (
    filterStartTime?: Date | number,
    filterEndTime?: Date | number
): Promise<LogAnalysisResult> => {
    const logFilePath = path.join(__dirname, '../../logs/app.log'); // !!! KIỂM TRA LẠI ĐƯỜNG DẪN NÀY !!!
    const logContext = { filePath: logFilePath, function: 'performLogAnalysis' };
    logger.info({ ...logContext, event: 'analysis_start', filterStartTime, filterEndTime }, 'Starting log analysis execution');

    const results: LogAnalysisResult = {
        // ... (các trường khác giữ nguyên cấu trúc) ...
        analysisTimestamp: new Date().toISOString(),
        logFilePath: logFilePath,
        totalLogEntries: 0,
        parsedLogEntries: 0,
        parseErrors: 0,
        errorLogCount: 0,
        fatalLogCount: 0,
        overall: {
            startTime: null, endTime: null, durationSeconds: null, totalConferencesInput: 0,
            processedConferencesCount: 0, completedTasks: 0, failedOrCrashedTasks: 0, successfulExtractions: 0
        },
        googleSearch: {
            totalRequests: 0, successfulSearches: 0, failedSearches: 0, skippedSearches: 0, quotaErrors: 0, keyUsage: {}, errorsByType: {}
        },
        playwright: {
            setupSuccess: null, setupError: null, htmlSaveAttempts: 0, successfulSaves: 0, failedSaves: 0, linkProcessing: { totalLinksAttempted: 0, successfulAccess: 0, failedAccess: 0, redirects: 0 }, errorsByType: {}
        },
        geminiApi: {
            totalCalls: 0, callsByType: {}, callsByModel: {}, successfulCalls: 0, failedCalls: 0, retriesByType: {}, retriesByModel: {}, cacheAttempts: 0, cacheHits: 0, cacheMisses: 0, cacheCreationSuccess: 0, cacheCreationFailed: 0, cacheInvalidations: 0, blockedBySafety: 0, totalTokens: 0, errorsByType: {}, rateLimitWaits: 0
        },
        batchProcessing: {
            totalBatchesAttempted: 0, successfulBatches: 0, failedBatches: 0, aggregatedResultsCount: null
        },
        errorsAggregated: {},
        logProcessingErrors: [],
        // Key của conferenceAnalysis giờ sẽ là "acronym - title"
        conferenceAnalysis: {}, // Kiểu: { [compositeKey: string]: ConferenceAnalysisDetail }
    };

    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    // --- Convert filter times to milliseconds ---
    const filterStartMillis = filterStartTime ? new Date(filterStartTime).getTime() : null;
    const filterEndMillis = filterEndTime ? new Date(filterEndTime).getTime() : null;

    if (filterStartMillis && filterEndMillis && filterStartMillis > filterEndMillis) {
        logger.warn({ ...logContext, event: 'analysis_warning_invalid_filter_range' }, 'Filter start time is after filter end time.');
        // Decide how to handle: return empty results, ignore filter, swap times?
        // For now, we'll proceed, but the filter might yield no results.
    }

    try {
        if (!fs.existsSync(logFilePath)) {
            logger.error({ ...logContext, event: 'analysis_error_file_not_found' }, 'Log file not found.');
            throw new Error(`Log file not found at ${logFilePath}`);
        }

        const fileStream = fs.createReadStream(logFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        // --- PHASE 1: Read all logs, Group by RequestID, Find Request Timestamps ---
        logger.info({ ...logContext, event: 'analysis_phase1_start' }, 'Starting Phase 1: Grouping logs by requestId');
        for await (const line of rl) {
            totalEntries++;
            if (!line.trim()) continue;

            try {
                const logEntry = JSON.parse(line);
                parsedEntries++;
                const entryTimeMillis = new Date(logEntry.time).getTime();
                const requestId = logEntry.requestId;

                if (requestId && typeof requestId === 'string' && !isNaN(entryTimeMillis)) {
                    if (!requestsData.has(requestId)) {
                        requestsData.set(requestId, { logs: [], startTime: null, endTime: null });
                    }
                    const requestInfo = requestsData.get(requestId)!;
                    requestInfo.logs.push(logEntry);
                    requestInfo.startTime = Math.min(entryTimeMillis, requestInfo.startTime ?? entryTimeMillis);
                    requestInfo.endTime = Math.max(entryTimeMillis, requestInfo.endTime ?? entryTimeMillis);
                }
                // Note: Logs without a requestId are currently ignored for filtering/analysis.
                // You could collect them separately if needed.

            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
                // Log error but continue processing other lines
                logger.warn({ event: 'analysis_parse_error_phase1', lineNum: totalEntries, err: parseError, originalLine: line }, "Error parsing log line during phase 1");
            }
        }
        logger.info({ ...logContext, event: 'analysis_phase1_end', totalEntries, parsedEntries, requestIdsFound: requestsData.size, parseErrors: parseErrorsCount }, 'Finished Phase 1');

        results.totalLogEntries = totalEntries;
        results.parsedLogEntries = parsedEntries;
        results.parseErrors = parseErrorsCount;
        results.logProcessingErrors.push(...tempLogProcessingErrors);

        // --- PHASE 2: Filter Requests and Analyze ---
        logger.info({ ...logContext, event: 'analysis_phase2_start' }, 'Starting Phase 2: Filtering and Analyzing Requests');
        let analysisStartMillis: number | null = null;
        let analysisEndMillis: number | null = null;
        // Key của conferenceLastTimestamp giờ sẽ là "acronym - title"
        const conferenceLastTimestamp: { [compositeKey: string]: number } = {};

        for (const [requestId, requestInfo] of requestsData.entries()) {
            const reqStartMillis = requestInfo.startTime;
            const reqEndMillis = requestInfo.endTime;

            // --- Filtering Logic ---
            let includeRequest = true; // Include by default if no filters
            if (filterStartMillis !== null && filterEndMillis !== null) {
                // --- Overlap Check ---
                // Include if the request's time range overlaps with the filter's time range.
                // Requires the request to have both start and end times.
                if (reqStartMillis !== null && reqEndMillis !== null) {
                    includeRequest = (reqStartMillis <= filterEndMillis) && (reqEndMillis >= filterStartMillis);
                } else {
                    // How to handle requests with only one timestamp (or parse errors)?
                    // Option 1: Exclude them if filtering is active.
                    // Option 2: Include if *either* start or end (if available) is within range.
                    // Let's exclude for now if filtering is strict.
                    includeRequest = false;
                    logger.debug({ ...logContext, event: 'filter_exclude_incomplete_timestamp', requestId }, 'Excluding request from filtered analysis due to missing start/end time.');
                }

                // --- Alternative: Start Time Check (Simpler, as discussed) ---
                /*
                if (reqStartMillis !== null) {
                    includeRequest = (reqStartMillis >= filterStartMillis) && (reqStartMillis <= filterEndMillis);
                } else {
                    includeRequest = false; // Exclude if start time is unknown and filtering by start
                }
                */
            } else if (filterStartMillis !== null) { // Only start filter
                includeRequest = reqStartMillis !== null && reqStartMillis >= filterStartMillis;
            } else if (filterEndMillis !== null) { // Only end filter
                // Filter by end time might be less common, but possible
                includeRequest = reqEndMillis !== null && reqEndMillis <= filterEndMillis;
            }
            // --- End Filtering Logic ---


            if (includeRequest) {
                logger.debug({ ...logContext, event: 'analysis_processing_request', requestId, logCount: requestInfo.logs.length }, 'Analyzing logs for included request');

                // Update overall analysis time range based on included requests
                if (reqStartMillis !== null) {
                    analysisStartMillis = Math.min(reqStartMillis, analysisStartMillis ?? reqStartMillis);
                }
                if (reqEndMillis !== null) {
                    analysisEndMillis = Math.max(reqEndMillis, analysisEndMillis ?? reqEndMillis);
                }

                // --- MAIN LOG PROCESSING LOOP ---
                for (const logEntry of requestInfo.logs) {
                    // All the logic from the original `for await...` loop's body goes here,
                    // operating on the 'results' object.

                    const entryTimeMillis = new Date(logEntry.time).getTime();
                    const entryTimestampISO = new Date(entryTimeMillis).toISOString();

                    // Update overall counts (error/fatal) based *only* on included logs
                    if (logEntry.level >= 50) results.errorLogCount++; // pino level: ERROR
                    if (logEntry.level >= 60) results.fatalLogCount++; // pino level: FATAL

                    const msg = logEntry.msg || '';
                    const context = logEntry;
                    const event = context.event;
                    const route = context.route;
                    const error = context.err || context.reason;


                    // --- Lấy acronym và title từ log entry ---
                    const acronym = context.acronym || context.conferenceAcronym;
                    const title = context.title || context.conferenceTitle;

                    // --- Tạo composite key và lấy conference detail ---
                    const compositeKey = createConferenceKey(acronym, title);
                    let confDetail: ConferenceAnalysisDetail | null = null;

                    if (compositeKey) { // Chỉ xử lý nếu có key hợp lệ (có cả acronym và title)
                        if (!results.conferenceAnalysis[compositeKey]) {
                            // Khởi tạo nếu chưa tồn tại, truyền acronym và title gốc
                            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(acronym!, title!); // Đã check null/undefined trong createConferenceKey
                        }
                        confDetail = results.conferenceAnalysis[compositeKey];

                        if (!isNaN(entryTimeMillis)) {
                            // Track last timestamp cho composite key này
                            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
                        }
                    } else if (acronym && (event?.startsWith('task_') || event?.includes('conference'))) {
                        // Ghi log cảnh báo nếu một event quan trọng liên quan đến conference thiếu title
                        logger.warn({ ...logContext, event: 'analysis_missing_title_for_key', logEvent: event, acronym: acronym, requestId: requestId }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
                    }


                    // --- Event-Based Analysis (Các case bên trong giữ nguyên logic) ---
                    // Quan trọng: Mọi thao tác với `confDetail` phải nằm trong khối `if (confDetail)`
                    // hoặc `if (compositeKey)` để đảm bảo nó chỉ thực thi khi có key hợp lệ.

                    // 1. Overall Process & Task Lifecycle
                    // 1. Overall Process & Task Lifecycle
                    switch (event) {
                        case 'crawl_start':
                            if (!results.overall.startTime) results.overall.startTime = context.startTime ?? entryTimestampISO;
                            if (context.totalConferences && results.overall.totalConferencesInput !== null) {
                                // Cần xem xét lại logic đếm totalConferencesInput, có thể chỉ đếm 1 lần?
                                // Hoặc đếm số lượng conference keys duy nhất được tạo?
                                // Tạm thời giữ nguyên logic cũ: đếm số lần log 'crawl_start' có totalConferences
                                results.overall.totalConferencesInput++;
                            }
                            break;
                        case 'task_start':
                            if (confDetail) { // Chỉ thực hiện nếu confDetail tồn tại (có compositeKey)
                                if (!confDetail.startTime) confDetail.startTime = entryTimestampISO;
                                confDetail.status = 'processing';
                            }
                            break;
                        case 'task_unhandled_error':
                        case 'process_predefined_links_failed':
                            if (confDetail) { // Chỉ thực hiện nếu confDetail tồn tại
                                confDetail.status = 'failed';
                                addConferenceError(confDetail, entryTimestampISO, error, msg || `Task failed (${event})`);
                            }
                            // Lỗi này vẫn nên được tổng hợp ngay cả khi không có confDetail
                            results.errorsAggregated[normalizeErrorKey(error || msg)] = (results.errorsAggregated[normalizeErrorKey(error || msg)] || 0) + 1;
                            break;
                        case 'task_finish':
                            if (confDetail) { // Chỉ thực hiện nếu confDetail tồn tại
                                confDetail.endTime = entryTimestampISO;
                                if (confDetail.status === 'processing') {
                                    confDetail.status = context.status === false ? 'failed' : 'completed'; // Sửa lại logic: status false là failed
                                }
                                if (confDetail.status === 'failed') {
                                    const failureReason = error || (context.status === false ? 'Task finished with status=false' : 'Task inferred failure at finish');
                                    addConferenceError(confDetail, entryTimestampISO, error, msg || failureReason);
                                    // Thêm lỗi vào tổng hợp chỉ khi task thực sự fail và có confDetail
                                    results.errorsAggregated[normalizeErrorKey(failureReason)] = (results.errorsAggregated[normalizeErrorKey(failureReason)] || 0) + 1;
                                }
                                if (confDetail.startTime) {
                                    const startMillis = new Date(confDetail.startTime).getTime();
                                    if (!isNaN(startMillis) && !isNaN(entryTimeMillis)) {
                                        confDetail.durationSeconds = Math.round((entryTimeMillis - startMillis) / 1000);
                                    }
                                }
                            }
                            break;
                        // ... các case lifecycle khác ...
                    }

                    // 2. Google Search Specific Events
                    switch (event) {
                        case 'search_attempt':
                            results.googleSearch.totalRequests++;
                            if (context.keyIndex !== undefined) {
                                results.googleSearch.keyUsage[`key_${context.keyIndex}`] = (results.googleSearch.keyUsage[`key_${context.keyIndex}`] || 0) + 1;
                            }
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                confDetail.steps.search_attempted = true;
                                confDetail.steps.search_attempts_count++;
                            }
                            break;
                        case 'search_success':
                            results.googleSearch.successfulSearches++;
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                confDetail.steps.search_success = true;
                                confDetail.steps.search_results_count = context.resultsCount ?? null;
                            }
                            break;
                        case 'search_results_filtered':
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                confDetail.steps.search_filtered_count = context.filteredResults ?? null;
                            }
                            break;
                        case 'search_failed_max_retries':
                        case 'search_ultimately_failed':
                            results.googleSearch.failedSearches++;
                            const failErrorKey = normalizeErrorKey(error || msg);
                            results.googleSearch.errorsByType[failErrorKey] = (results.googleSearch.errorsByType[failErrorKey] || 0) + 1;
                            results.errorsAggregated[failErrorKey] = (results.errorsAggregated[failErrorKey] || 0) + 1;
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                confDetail.steps.search_success = false;
                                addConferenceError(confDetail, entryTimestampISO, error, msg || 'Search ultimately failed');
                            }
                            break;
                        case 'search_attempt_failed':
                            const searchError = context.err;
                            const isQuotaError = searchError?.details?.status === 429 || searchError?.details?.googleErrorCode === 429 || searchError?.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'quotaExceeded');
                            if (isQuotaError) results.googleSearch.quotaErrors++;
                            const attemptErrorKey = normalizeErrorKey(searchError || msg);
                            results.googleSearch.errorsByType[attemptErrorKey] = (results.googleSearch.errorsByType[attemptErrorKey] || 0) + 1;
                            // Không cần addConferenceError ở đây vì đây là lỗi trung gian
                            break;
                        case 'search_skip_all_keys_exhausted':
                        case 'search_skip_no_key':
                            results.googleSearch.skippedSearches++;
                            const skipErrorKey = normalizeErrorKey(msg);
                            results.googleSearch.errorsByType[skipErrorKey] = (results.googleSearch.errorsByType[skipErrorKey] || 0) + 1;
                            results.errorsAggregated[skipErrorKey] = (results.errorsAggregated[skipErrorKey] || 0) + 1; // Coi skip là lỗi nghiêm trọng
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                confDetail.steps.search_success = false;
                                addConferenceError(confDetail, entryTimestampISO, null, msg);
                            }
                            break;
                    }

                    // 3. Playwright Specific Events
                    switch (event) {
                        case 'playwright_setup_start': break; // Placeholder if needed
                        case 'playwright_setup_success': results.playwright.setupSuccess = true; break;
                        case 'playwright_setup_failed':
                            results.playwright.setupError = true;
                            const setupErrorKey = normalizeErrorKey(error || msg);
                            results.playwright.errorsByType[setupErrorKey] = (results.playwright.errorsByType[setupErrorKey] || 0) + 1;
                            results.errorsAggregated[setupErrorKey] = (results.errorsAggregated[setupErrorKey] || 0) + 1;
                            // Lỗi setup không gắn với conference cụ thể
                            break;
                        case 'save_html_start':
                            results.playwright.htmlSaveAttempts++;
                            if (confDetail) confDetail.steps.html_save_attempted = true;
                            break;
                        case 'save_html_step_completed':
                            results.playwright.successfulSaves++;
                            if (confDetail) confDetail.steps.html_save_success = true;
                            break;
                        case 'save_html_failed':
                            results.playwright.failedSaves++;
                            const saveErrorKey = normalizeErrorKey(error || msg);
                            results.playwright.errorsByType[saveErrorKey] = (results.playwright.errorsByType[saveErrorKey] || 0) + 1;
                            if (confDetail) {
                                confDetail.steps.html_save_success = false;
                                addConferenceError(confDetail, entryTimestampISO, error, msg || 'Save HTML step failed');
                            }
                            results.errorsAggregated[saveErrorKey] = (results.errorsAggregated[saveErrorKey] || 0) + 1;
                            break;
                        case 'link_access_attempt':
                            results.playwright.linkProcessing.totalLinksAttempted++;
                            if (confDetail) confDetail.steps.link_processing_attempted++;
                            break;
                        case 'link_access_success':
                            results.playwright.linkProcessing.successfulAccess++;
                            if (confDetail) confDetail.steps.link_processing_success++;
                            break;
                        case 'link_access_failed':
                            results.playwright.linkProcessing.failedAccess++;
                            const linkAccessErrorKey = normalizeErrorKey(error || msg);
                            results.playwright.errorsByType[linkAccessErrorKey] = (results.playwright.errorsByType[linkAccessErrorKey] || 0) + 1;
                            if (confDetail) {
                                confDetail.steps.link_processing_failed?.push({
                                    timestamp: entryTimestampISO,
                                    details: `Link access failed: ${context.url || msg}`
                                });
                            }
                            // Lỗi truy cập link có thể không phải lỗi nghiêm trọng của cả task
                            break;
                        case 'redirect_detected':
                            results.playwright.linkProcessing.redirects++;
                            break;
                        case 'page_close_failed':
                        case 'dom_clean_failed':
                        case 'content_fetch_failed':
                            const otherPwErrorKey = normalizeErrorKey(error || msg);
                            results.playwright.errorsByType[otherPwErrorKey] = (results.playwright.errorsByType[otherPwErrorKey] || 0) + 1;
                            if (confDetail) { addConferenceError(confDetail, entryTimestampISO, error, msg || `Playwright operation failed (${event})`); }
                            // Quyết định xem có nên coi là lỗi nghiêm trọng không
                            // results.errorsAggregated[otherPwErrorKey] = (results.errorsAggregated[otherPwErrorKey] || 0) + 1;
                            break;

                    }

                    // 4. Gemini API Specific Events
                    const apiType = context.apiType; // 'determine' or 'extract'

                    switch (event) {
                        // Cache Events
                        case 'cache_create_start': results.geminiApi.cacheAttempts++; break;
                        case 'cache_setup_use_success':
                            results.geminiApi.cacheHits++;
                            if (confDetail && apiType === 'determine') confDetail.steps.gemini_determine_cache_used = true;
                            if (confDetail && apiType === 'extract') confDetail.steps.gemini_extract_cache_used = true;
                            break;
                        case 'retry_failed_max_retries':
                            results.geminiApi.failedCalls++;
                            const retryFailErrorKey = normalizeErrorKey(context.finalError || error || msg);
                            results.geminiApi.errorsByType[retryFailErrorKey] = (results.geminiApi.errorsByType[retryFailErrorKey] || 0) + 1;
                            results.errorsAggregated[retryFailErrorKey] = (results.errorsAggregated[retryFailErrorKey] || 0) + 1;
                            if (confDetail && apiType) { // Chỉ cập nhật nếu có confDetail và apiType
                                if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                                if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                                addConferenceError(confDetail, entryTimestampISO, context.finalError || error, msg || 'Gemini API call failed after max retries');
                            }
                            break;
                        case 'retry_abort_non_retryable':
                            const abortError = context.finalError || error || msg;
                            const abortErrorKey = normalizeErrorKey(abortError);
                            results.geminiApi.errorsByType[abortErrorKey] = (results.geminiApi.errorsByType[abortErrorKey] || 0) + 1;
                            const isSafetyBlock = (typeof abortError === 'string' && abortError.includes('SAFETY')) || (typeof abortError === 'object' && abortError?.finishReason === 'SAFETY');
                            if (!isSafetyBlock) {
                                results.geminiApi.failedCalls++;
                                results.errorsAggregated[abortErrorKey] = (results.errorsAggregated[abortErrorKey] || 0) + 1;
                            }
                            if (confDetail && apiType) { // Chỉ cập nhật nếu có confDetail và apiType
                                if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                                if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                                addConferenceError(confDetail, entryTimestampISO, abortError, msg || 'Gemini API call aborted (non-retryable)');
                            }
                            break;
                        case 'gemini_call_start':
                            results.geminiApi.totalCalls++;
                            if (apiType) results.geminiApi.callsByType[apiType] = (results.geminiApi.callsByType[apiType] || 0) + 1;
                            if (context.modelName) results.geminiApi.callsByModel[context.modelName] = (results.geminiApi.callsByModel[context.modelName] || 0) + 1;
                            if (confDetail && apiType === 'determine') confDetail.steps.gemini_determine_attempted = true;
                            if (confDetail && apiType === 'extract') confDetail.steps.gemini_extract_attempted = true;
                            break;
                        case 'gemini_api_attempt_success':
                            results.geminiApi.successfulCalls++;
                            if (context.metaData?.totalTokenCount) results.geminiApi.totalTokens += Number(context.metaData.totalTokenCount) || 0;
                            if (confDetail && apiType) { // Chỉ cập nhật nếu có confDetail và apiType
                                if (apiType === 'determine' && confDetail.steps.gemini_determine_success !== false) {
                                    confDetail.steps.gemini_determine_success = true;
                                    if (confDetail.steps.gemini_determine_cache_used === null) confDetail.steps.gemini_determine_cache_used = context.usingCache ?? false;
                                }
                                if (apiType === 'extract' && confDetail.steps.gemini_extract_success !== false) {
                                    confDetail.steps.gemini_extract_success = true;
                                    if (confDetail.steps.gemini_extract_cache_used === null) confDetail.steps.gemini_extract_cache_used = context.usingCache ?? false;
                                }
                            }
                            break;
                        case 'gemini_api_response_blocked':
                        case 'retry_attempt_error_safety_blocked':
                            results.geminiApi.failedCalls++;
                            results.geminiApi.blockedBySafety++;
                            const blockError = error || context.blockReason || msg || 'Request blocked by safety settings';
                            const blockErrorKey = normalizeErrorKey(blockError);
                            results.geminiApi.errorsByType[blockErrorKey] = (results.geminiApi.errorsByType[blockErrorKey] || 0) + 1;
                            results.errorsAggregated[blockErrorKey] = (results.errorsAggregated[blockErrorKey] || 0) + 1;
                            if (confDetail && apiType) { // Chỉ cập nhật nếu có confDetail và apiType
                                if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                                if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                                addConferenceError(confDetail, entryTimestampISO, blockError, msg || 'Request blocked by safety settings');
                            }
                            break;
                        // Other Gemini errors caught during retry attempts (intermediate)
                        case 'retry_attempt_error_cache':
                        case 'retry_attempt_error_429':
                        case 'retry_attempt_error_5xx':
                        case 'retry_attempt_error_unknown':
                            const intermediateErrorKey = normalizeErrorKey(error || msg);
                            results.geminiApi.errorsByType[intermediateErrorKey] = (results.geminiApi.errorsByType[intermediateErrorKey] || 0) + 1;
                            // Don't count towards failedCalls or errorsAggregated unless it's the final error
                            break;
                        // Errors outside retry
                        case 'gemini_call_limiter_init_failed':
                        case 'gemini_call_invalid_apitype':
                        case 'non_cached_setup_failed':
                            results.geminiApi.failedCalls++;
                            const setupFailErrorKey = normalizeErrorKey(error || msg);
                            results.geminiApi.errorsByType[setupFailErrorKey] = (results.geminiApi.errorsByType[setupFailErrorKey] || 0) + 1;
                            results.errorsAggregated[setupFailErrorKey] = (results.errorsAggregated[setupFailErrorKey] || 0) + 1;
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                // Nếu có apiType, đánh dấu bước cụ thể thất bại
                                if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                                if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                                addConferenceError(confDetail, entryTimestampISO, error, msg || `Gemini setup/call failed (${event})`);
                            }
                            break;
                    }


                    // 5. Batch Processing Events
                    switch (event) {
                        case 'batch_task_create': results.batchProcessing.totalBatchesAttempted++; break;
                        case 'batch_aggregation_item_success': results.batchProcessing.successfulBatches++; break;
                        case 'batch_aggregation_item_failed_logic':
                        case 'batch_aggregation_item_failed_nodata':
                            results.batchProcessing.failedBatches++;
                            break; // Logic/no-data failures might not be critical errors
                        case 'batch_aggregation_item_failed_rejected':
                            results.batchProcessing.failedBatches++;
                            const batchRejectError = error || 'Batch promise rejected';
                            const batchRejectErrorKey = normalizeErrorKey(batchRejectError);
                            results.errorsAggregated[batchRejectErrorKey] = (results.errorsAggregated[batchRejectErrorKey] || 0) + 1;
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail (log lỗi batch có chứa acronym/title)
                                addConferenceError(confDetail, entryTimestampISO, error, 'Batch processing step failed (rejected)');
                            }
                            break;
                        case 'save_batch_dir_create_failed': // Lỗi hệ thống, không gắn với conf cụ thể
                        case 'save_batch_read_content_failed': // Lỗi hệ thống
                        case 'save_batch_write_file_failed': // Lỗi hệ thống
                            const fsError = error || msg || `Save batch FS operation failed (${event})`;
                            const fsErrorKey = normalizeErrorKey(fsError);
                            results.errorsAggregated[fsErrorKey] = (results.errorsAggregated[fsErrorKey] || 0) + 1;
                            // Không add vào conference detail cụ thể
                            break;
                        case 'save_batch_determine_api_call_failed':
                        case 'save_batch_extract_api_call_failed':
                        case 'save_batch_process_determine_call_failed':
                        case 'save_batch_process_determine_failed_invalid':
                            const saveBatchApiError = error || msg || `Save batch step failed (${event})`;
                            const saveBatchApiErrorKey = normalizeErrorKey(saveBatchApiError);
                            results.errorsAggregated[saveBatchApiErrorKey] = (results.errorsAggregated[saveBatchApiErrorKey] || 0) + 1;
                            if (confDetail) { // Chỉ cập nhật nếu có confDetail
                                addConferenceError(confDetail, entryTimestampISO, error, msg || `Save batch step failed (${event})`);
                                if (event.includes('determine')) confDetail.steps.gemini_determine_success = false;
                                if (event.includes('extract')) confDetail.steps.gemini_extract_success = false;
                            }
                            break;
                    }


                    // 6. Final Result Preview Logging
                    // Cần lấy cả acronym và title từ context.results[0] hoặc preview
                    if (route === '/crawl-conferences' && event === 'crawl_conference_result' && context.results && Array.isArray(context.results) && context.results.length > 0) {
                        const result = context.results[0];
                        const resultAcronym = result?.acronym;
                        const resultTitle = result?.title;
                        const resultCompositeKey = createConferenceKey(resultAcronym, resultTitle);

                        if (resultCompositeKey && results.conferenceAnalysis[resultCompositeKey]) {
                            results.conferenceAnalysis[resultCompositeKey].finalResultPreview = result;
                        } else if (resultAcronym || resultTitle) {
                            logger.warn({ requestId: logEntry.requestId, acronym: resultAcronym, title: resultTitle, event: 'crawl_conference_result' }, "Found crawl_conference_result but no matching analysis entry OR missing info for composite key");
                        }
                    }
                    else if (route === '/crawl-conferences' && event === 'crawl_end_success' && context.resultsPreview && Array.isArray(context.resultsPreview)) {
                        context.resultsPreview.forEach((preview: any) => {
                            const previewAcronym = preview?.acronym;
                            const previewTitle = preview?.title;
                            const previewCompositeKey = createConferenceKey(previewAcronym, previewTitle);

                            if (previewCompositeKey && results.conferenceAnalysis[previewCompositeKey]) {
                                if (!results.conferenceAnalysis[previewCompositeKey].finalResultPreview) {
                                    results.conferenceAnalysis[previewCompositeKey].finalResultPreview = preview;
                                }
                            } else if (previewAcronym || previewTitle) {
                                logger.warn({ requestId: logEntry.requestId, acronym: previewAcronym, title: previewTitle, event: 'crawl_end_success_preview' }, "Found preview in crawl_end_success but no matching analysis entry OR missing info for composite key");
                            }
                        });
                    }

                } // --- End loop through logs for the current request ---
            } // --- End if(includeRequest) ---
        } // --- End loop through all requests ---
        logger.info({ event: 'analysis_phase2_end' }, 'Finished Phase 2: Analysis');

        // --- Final Calculations & Adjustments (Operate on filtered data) ---
        logger.info({ event: 'analysis_final_calculations_start' }, "Performing final calculations on analyzed data");

        // Calculate overall duration based on the analyzed request range
        if (analysisStartMillis && analysisEndMillis) {
            // Use the earliest/latest timestamps *from the analyzed requests*
            results.overall.startTime = new Date(analysisStartMillis).toISOString();
            results.overall.endTime = new Date(analysisEndMillis).toISOString();
            results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
        } else if (Object.keys(results.conferenceAnalysis).length > 0) {
            // Fallback if analysisStart/End somehow weren't set but we processed conferences
            // Find min/max from conference details
            let minConfStart: number | null = null;
            let maxConfEnd: number | null = null;
            Object.values(results.conferenceAnalysis).forEach(detail => {
                if (detail.startTime) {
                    const startMs = new Date(detail.startTime).getTime();
                    if (!isNaN(startMs)) minConfStart = Math.min(startMs, minConfStart ?? startMs);
                }
                if (detail.endTime) {
                    const endMs = new Date(detail.endTime).getTime();
                    if (!isNaN(endMs)) maxConfEnd = Math.max(endMs, maxConfEnd ?? endMs);
                }
            });
            if (minConfStart) results.overall.startTime = new Date(minConfStart).toISOString();
            if (maxConfEnd) results.overall.endTime = new Date(maxConfEnd).toISOString();
            if (minConfStart && maxConfEnd) {
                results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
            }
        }


        // Finalize conference details and counts based on analyzed data
        let completionSuccessCount = 0;
        let completionFailCount = 0;
        let extractionSuccessCount = 0;

        const processedAcronyms = Object.keys(results.conferenceAnalysis);
        results.overall.processedConferencesCount = processedAcronyms.length; // Count of conferences *touched* in the analyzed requests

        // Lặp qua các composite keys
        const processedCompositeKeys = Object.keys(results.conferenceAnalysis);
        results.overall.processedConferencesCount = processedCompositeKeys.length; // Đếm số lượng key duy nhất

        processedCompositeKeys.forEach(key => { // 'key' is the compositeKey
            const detail = results.conferenceAnalysis[key];

            if (!detail.startTime && detail.status === 'unknown') return;

            // Sử dụng composite key để lấy last timestamp
            const lastSeenTimeMillis = conferenceLastTimestamp[key] ?? analysisEndMillis;
            if (!detail.endTime && lastSeenTimeMillis) {
                detail.endTime = new Date(lastSeenTimeMillis).toISOString();
                if (detail.startTime) {
                    const startMillis = new Date(detail.startTime).getTime();
                    if (!isNaN(startMillis)) {
                        detail.durationSeconds = Math.round((lastSeenTimeMillis - startMillis) / 1000);
                    }
                }
                if (detail.status === 'processing' || detail.status === 'unknown') {
                    detail.status = 'failed';
                    const inferredErrorMsg = `Task did not finish cleanly (inferred from analyzed log range ending at ${detail.endTime})`;
                    addConferenceError(detail, detail.endTime, null, inferredErrorMsg);
                }
            } else if (!detail.startTime && detail.endTime) {
                detail.status = 'unknown';
                addConferenceError(detail, detail.endTime, null, 'Task end log found without start log within analyzed range');
            }

            if (detail.status === 'completed') {
                completionSuccessCount++;
            } else if (detail.status === 'failed') {
                completionFailCount++;
            }

            if (detail.steps.gemini_extract_success === true) {
                extractionSuccessCount++;
            }
        });

        results.overall.completedTasks = completionSuccessCount;
        results.overall.failedOrCrashedTasks = completionFailCount;
        results.overall.successfulExtractions = extractionSuccessCount;

        results.geminiApi.cacheMisses = Math.max(0, results.geminiApi.cacheAttempts - results.geminiApi.cacheHits);

        logger.info({
            event: 'analysis_finish_success',
            filter: { start: filterStartTime, end: filterEndTime },
            analysisRange: { start: results.overall.startTime, end: results.overall.endTime },
            requestsAnalyzed: Array.from(requestsData.keys()).filter(reqId => { // Re-filter just for logging count
                const r = requestsData.get(reqId)!;
                let include = true;
                if (filterStartMillis !== null && filterEndMillis !== null) {
                    if (r.startTime !== null && r.endTime !== null) {
                        include = (r.startTime <= filterEndMillis) && (r.endTime >= filterStartMillis);
                    } else { include = false; }
                } else if (filterStartMillis !== null) { include = r.startTime !== null && r.startTime >= filterStartMillis; }
                else if (filterEndMillis !== null) { include = r.endTime !== null && r.endTime <= filterEndMillis; }
                return include;
            }).length,
            parsed: results.parsedLogEntries,
            total: results.totalLogEntries,
            errorsInAnalysis: results.errorLogCount,
            fatalInAnalysis: results.fatalLogCount,
            parseErrors: results.parseErrors,
            conferencesProcessed: results.overall.processedConferencesCount,
            tasksCompleted: results.overall.completedTasks,
            tasksFailedOrCrashed: results.overall.failedOrCrashedTasks,
            successfulExtractions: results.overall.successfulExtractions
        }, `Log analysis execution completed successfully.`);

        return results;

    } catch (error: any) {
        // Catch errors during file reading or initial stream setup
        logger.error({ ...logContext, err: error, event: 'analysis_error_fatal' }, 'Fatal error during log analysis execution');
        results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: ${error.message}`);
        // Return potentially partial results
        return results;
    }
};