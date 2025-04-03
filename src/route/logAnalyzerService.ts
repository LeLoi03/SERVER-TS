import fs from 'fs';
import path from 'path';
import readline from 'readline';
// Đảm bảo đường dẫn import logger và types là chính xác
import { logger } from '../conference/11_utils';
import { LogAnalysisResult, ConferenceAnalysisDetail } from '../types/logAnalysis';

// --- Helper function: Normalize Error Key ---
const normalizeErrorKey = (error: any): string => {
    let message = 'Unknown Error Structure';
    if (error && typeof error === 'object') {
        // Ưu tiên message, reason (từ Promise rejection), hoặc details
        message = error.message || error.reason || error.details || JSON.stringify(error);
    } else if (error) {
        message = String(error);
    }
    // Chuẩn hóa: giới hạn độ dài, thay số bằng N, loại bỏ khoảng trắng thừa
    return message.substring(0, 150).replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
};

// --- Helper function: Initialize Conference Detail ---
const initializeConferenceDetail = (acronym: string): ConferenceAnalysisDetail => ({
    acronym: acronym,
    status: 'unknown', // Initial status
    startTime: null,
    endTime: null,
    durationSeconds: null,
    steps: {
        search_attempted: false,
        search_success: null, // null: not attempted, true: success, false: failed/skipped
        search_attempts_count: 0,
        search_results_count: null,
        search_filtered_count: null,
        html_save_attempted: false,
        html_save_success: null, // null: not attempted, true: success, false: failed
        link_processing_attempted: 0,
        link_processing_success: 0,
        // Gemini steps
        gemini_determine_attempted: false,
        gemini_determine_success: null,
        gemini_determine_cache_used: null,
        gemini_extract_attempted: false,
        gemini_extract_success: null,
        gemini_extract_cache_used: null,
    },
    errors: [], // Array of { timestamp: string, message: string, details?: any }
    finalResultPreview: undefined, // Store final result preview if available
});

// --- Helper function: Add Error to Conference Detail ---
// Di chuyển ra ngoài để tránh khai báo lại trong vòng lặp
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
        // Optional: Include raw error details if needed for debugging later
        details: errorSource ? JSON.stringify(errorSource, Object.getOwnPropertyNames(errorSource)) : undefined
    });
};


// --- Core Log Analysis Function ---
// --- Core Log Analysis Function (Đã sửa đổi) ---
export const performLogAnalysis = async (
    filterStartTime?: string | Date, // Thêm tham số
    filterEndTime?: string | Date    // Thêm tham số
): Promise<LogAnalysisResult> => {
    const logFilePath = path.join(__dirname, '../../logs/app.log'); // !!! KIỂM TRA LẠI ĐƯỜNG DẪN NÀY !!!
    const logContext = { filePath: logFilePath, function: 'performLogAnalysis' };
    logger.info({ ...logContext, event: 'analysis_start', filterStartTime, filterEndTime }, 'Starting log analysis execution');

    // --- Chuyển đổi và xác thực thời gian lọc ---
    let startMillis: number | null = null;
    let endMillis: number | null = null;
    let filterStartISO: string | undefined = undefined;
    let filterEndISO: string | undefined = undefined;

    if (filterStartTime) {
        const startDate = filterStartTime instanceof Date ? filterStartTime : new Date(filterStartTime);
        if (!isNaN(startDate.getTime())) {
            startMillis = startDate.getTime();
            filterStartISO = startDate.toISOString();
        } else {
            logger.warn({ ...logContext, event: 'analysis_invalid_filter', filterStartTime }, "Invalid start time provided, ignoring.");
        }
    }
    if (filterEndTime) {
        const endDate = filterEndTime instanceof Date ? filterEndTime : new Date(filterEndTime);
        if (!isNaN(endDate.getTime())) {
            endMillis = endDate.getTime();
            filterEndISO = endDate.toISOString();
        } else {
            logger.warn({ ...logContext, event: 'analysis_invalid_filter', filterEndTime }, "Invalid end time provided, ignoring.");
        }
    }

    // --- Initialize Results Structure ---
    const results: LogAnalysisResult = {
        analysisTimestamp: new Date().toISOString(),
        logFilePath: logFilePath,
        filterStartTime: filterStartISO, // Lưu lại bộ lọc
        filterEndTime: filterEndISO,     // Lưu lại bộ lọc
        totalLogEntriesInFile: 0,
        parsedLogEntriesInFile: 0,
        processedEntriesInRange: 0, // Bắt đầu bằng 0
        parseErrors: 0,
        errorLogCount: 0,
        fatalLogCount: 0,
        overall: { startTime: null, endTime: null, durationSeconds: null, totalConferencesInput: null, processedConferencesCount: 0, completedTasks: 0, failedOrCrashedTasks: 0, successfulExtractions: 0 },
        googleSearch: { totalRequests: 0, successfulSearches: 0, failedSearches: 0, skippedSearches: 0, quotaErrors: 0, keyUsage: {}, errorsByType: {} },
        playwright: { setupSuccess: null, setupError: null, htmlSaveAttempts: 0, successfulSaves: 0, failedSaves: 0, linkProcessing: { totalLinksAttempted: 0, successfulAccess: 0, failedAccess: 0, redirects: 0 }, errorsByType: {} },
        geminiApi: { totalCalls: 0, callsByType: {}, callsByModel: {}, successfulCalls: 0, failedCalls: 0, retriesByType: {}, retriesByModel: {}, cacheAttempts: 0, cacheHits: 0, cacheMisses: 0, cacheCreationSuccess: 0, cacheCreationFailed: 0, cacheInvalidations: 0, blockedBySafety: 0, totalTokens: 0, errorsByType: {}, rateLimitWaits: 0 },
        batchProcessing: { totalBatchesAttempted: 0, successfulBatches: 0, failedBatches: 0, aggregatedResultsCount: null },
        errorsAggregated: {},
        logProcessingErrors: [],
        conferenceAnalysis: {},
    };  


    try {
        if (!fs.existsSync(logFilePath)) {
            logger.error({ ...logContext, event: 'analysis_error_file_not_found' }, 'Log file not found.');
            throw new Error(`Log file not found at ${logFilePath}`);
        }

        const fileStream = fs.createReadStream(logFilePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        // Timestamp cho log đầu tiên và cuối cùng *trong khoảng lọc*
        let firstTimestampInRangeMillis: number | null = null;
        let lastTimestampInRangeMillis: number | null = null;
        // Timestamp cuối cùng của từng conference *trong khoảng lọc*
        const conferenceLastTimestampInRange: { [acronym: string]: number } = {};

        // --- MAIN LOG PROCESSING LOOP ---
        for await (const line of rl) {
            results.totalLogEntriesInFile++; // Luôn đếm tổng số dòng đọc được từ file
            if (!line.trim()) continue;

            let logEntry: any;
            try {
                logEntry = JSON.parse(line);
                results.parsedLogEntriesInFile++; // Đếm dòng parse thành công (trước khi lọc)

                // --- BƯỚC LỌC THỜI GIAN ---
                if (!logEntry.time) {
                    // Bỏ qua log không có timestamp nếu đang lọc
                    if (startMillis !== null || endMillis !== null) {
                        continue;
                    }
                    // Nếu không lọc, có thể vẫn xử lý hoặc báo lỗi
                }

                const entryTimeMillis = new Date(logEntry.time).getTime();
                if (isNaN(entryTimeMillis)) {
                     // Bỏ qua log có timestamp không hợp lệ nếu đang lọc
                    if (startMillis !== null || endMillis !== null) {
                        continue;
                    }
                    // Nếu không lọc, có thể vẫn xử lý hoặc báo lỗi
                }

                // Áp dụng bộ lọc thời gian
                if (startMillis !== null && entryTimeMillis < startMillis) {
                    continue; // Log quá sớm
                }
                if (endMillis !== null && entryTimeMillis > endMillis) {
                    continue; // Log quá muộn
                }
                
                const entryTimeMillis = new Date(logEntry.time).getTime();
                const entryTimestampISO = new Date(entryTimeMillis).toISOString();

                // Update overall timestamps and counts
                if (!isNaN(entryTimeMillis)) {
                    firstTimestampMillis = Math.min(entryTimeMillis, firstTimestampMillis ?? entryTimeMillis);
                    lastTimestampMillis = Math.max(entryTimeMillis, lastTimestampMillis ?? entryTimeMillis);
                }
                if (logEntry.level >= 50) results.errorLogCount++;
                if (logEntry.level >= 60) results.fatalLogCount++;

                // Extract key context fields
                const msg = logEntry.msg || '';
                const context = logEntry;
                const event = context.event;
                const route = context.route;
                const acronym = context.acronym || context.conferenceAcronym; // Prefer 'acronym' if present
                const error = context.err || context.reason; // Error object or rejection reason

                // Get or initialize conference detail object
                let confDetail: ConferenceAnalysisDetail | null = null;
                if (acronym && typeof acronym === 'string' && acronym.trim() !== '') {
                    if (!results.conferenceAnalysis[acronym]) {
                        results.conferenceAnalysis[acronym] = initializeConferenceDetail(acronym);
                    }
                    confDetail = results.conferenceAnalysis[acronym];
                    // Update last known timestamp for this conference
                    if (!isNaN(entryTimeMillis)) {
                        conferenceLastTimestamp[acronym] = Math.max(entryTimeMillis, conferenceLastTimestamp[acronym] ?? 0);
                    }
                }

                // --- Event-Based Analysis ---
                // Note: Updates happen to both `results` (overall) and `confDetail` (specific)

                // 1. Overall Process & Task Lifecycle
                switch (event) {
                    case 'crawl_start':
                        results.overall.startTime = context.startTime ?? entryTimestampISO;
                        results.overall.totalConferencesInput = context.totalConferences ?? null;
                        break;
                    case 'task_start':
                        if (confDetail) {
                            confDetail.startTime = entryTimestampISO;
                            confDetail.status = 'processing';
                        }
                        break;
                    case 'task_unhandled_error':
                    case 'process_predefined_links_failed':
                        if (confDetail) {
                            confDetail.status = 'failed'; // Mark as failed immediately
                            addConferenceError(confDetail, entryTimestampISO, error, msg || `Task failed (${event})`);
                            // Add to aggregated errors as this is a direct task failure cause
                            results.errorsAggregated[normalizeErrorKey(error || msg)] = (results.errorsAggregated[normalizeErrorKey(error || msg)] || 0) + 1;
                        }
                        break;
                    case 'task_finish':
                        if (confDetail) {
                            confDetail.endTime = entryTimestampISO;
                            // Only update status if it was 'processing' to avoid overwriting an earlier failure
                            if (confDetail.status === 'processing') {
                                confDetail.status = context.status ? 'completed' : 'failed';
                            }
                            // If status ended up as failed, ensure an error is logged for it
                            if (confDetail.status === 'failed') {
                                addConferenceError(confDetail, entryTimestampISO, error, msg || 'Task finished with status=false');
                                // Add to aggregated errors
                                results.errorsAggregated[normalizeErrorKey(error || msg || 'Task finished with status=false')] = (results.errorsAggregated[normalizeErrorKey(error || msg || 'Task finished with status=false')] || 0) + 1;
                            }
                            // Calculate duration now that we have start and end
                            if (confDetail.startTime) {
                                const startMillis = new Date(confDetail.startTime).getTime();
                                if (!isNaN(startMillis) && !isNaN(entryTimeMillis)) {
                                    confDetail.durationSeconds = Math.round((entryTimeMillis - startMillis) / 1000);
                                }
                            }
                        }
                        break;
                }

                // 2. Google Search Specific Events
                switch (event) {
                    case 'search_attempt':
                        results.googleSearch.totalRequests++;
                        if (context.keyIndex !== undefined) {
                            results.googleSearch.keyUsage[`key_${context.keyIndex}`] = (results.googleSearch.keyUsage[`key_${context.keyIndex}`] || 0) + 1;
                        }
                        if (confDetail) {
                            confDetail.steps.search_attempted = true;
                            confDetail.steps.search_attempts_count++;
                        }
                        break;
                    case 'search_success':
                        results.googleSearch.successfulSearches++;
                        if (confDetail) {
                            confDetail.steps.search_success = true;
                            confDetail.steps.search_results_count = context.resultsCount ?? null;
                        }
                        break;
                    case 'search_results_filtered': // Assuming this log is after successful search
                        if (confDetail) {
                            confDetail.steps.search_filtered_count = context.filteredResults ?? null;
                        }
                        break;
                    case 'search_failed_max_retries':
                    case 'search_ultimately_failed':
                        results.googleSearch.failedSearches++;
                        const failErrorKey = normalizeErrorKey(error || msg);
                        results.googleSearch.errorsByType[failErrorKey] = (results.googleSearch.errorsByType[failErrorKey] || 0) + 1;
                        results.errorsAggregated[failErrorKey] = (results.errorsAggregated[failErrorKey] || 0) + 1; // Critical failure
                        if (confDetail) {
                            confDetail.steps.search_success = false;
                            addConferenceError(confDetail, entryTimestampISO, error, msg);
                            // Don't set confDetail.status='failed' here, let task_finish decide
                        }
                        break;
                    case 'search_attempt_failed': // Intermediate failure
                        const searchError = context.err;
                        const isQuotaError = searchError?.details?.status === 429 || searchError?.details?.googleErrorCode === 429 || searchError?.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'quotaExceeded');
                        if (isQuotaError) results.googleSearch.quotaErrors++;
                        const attemptErrorKey = normalizeErrorKey(searchError || msg);
                        results.googleSearch.errorsByType[attemptErrorKey] = (results.googleSearch.errorsByType[attemptErrorKey] || 0) + 1;
                        break;
                    case 'search_skip_all_keys_exhausted':
                    case 'search_skip_no_key':
                        results.googleSearch.skippedSearches++;
                        const skipErrorKey = normalizeErrorKey(msg);
                        results.googleSearch.errorsByType[skipErrorKey] = (results.googleSearch.errorsByType[skipErrorKey] || 0) + 1;
                        results.errorsAggregated[skipErrorKey] = (results.errorsAggregated[skipErrorKey] || 0) + 1; // Treat skipping as critical failure
                        if (confDetail) {
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
                        results.errorsAggregated[setupErrorKey] = (results.errorsAggregated[setupErrorKey] || 0) + 1; // Setup failure is critical
                        break;
                    case 'save_html_start':
                        // This event in crawl_conference indicates the intention to save for a conference
                        results.playwright.htmlSaveAttempts++; // Count overall attempts triggered
                        if (confDetail) confDetail.steps.html_save_attempted = true;
                        break;
                    case 'save_html_step_completed':
                        // This event in crawl_conference marks the successful completion of the saveHTMLContent function call
                        // We might need more granular logs from *within* saveHTMLContent if needed
                        results.playwright.successfulSaves++; // Increment overall count
                        if (confDetail) confDetail.steps.html_save_success = true;
                        break;
                    case 'save_html_failed':
                        // This event in crawl_conference marks the failure of the saveHTMLContent function call
                        results.playwright.failedSaves++;
                        const saveErrorKey = normalizeErrorKey(error || msg);
                        results.playwright.errorsByType[saveErrorKey] = (results.playwright.errorsByType[saveErrorKey] || 0) + 1;
                        if (confDetail) {
                            confDetail.steps.html_save_success = false;
                            addConferenceError(confDetail, entryTimestampISO, error, msg);
                        }
                        // Add to aggregated if save step failure means task failure
                        // results.errorsAggregated[saveErrorKey] = (results.errorsAggregated[saveErrorKey] || 0) + 1;
                        break;
                    case 'link_access_attempt': // From within saveHTMLContent
                        results.playwright.linkProcessing.totalLinksAttempted++;
                        if (confDetail) confDetail.steps.link_processing_attempted++;
                        break;
                    case 'link_access_success': // From within saveHTMLContent
                        results.playwright.linkProcessing.successfulAccess++;
                        if (confDetail) confDetail.steps.link_processing_success++;
                        break;
                    case 'link_access_failed': // From within saveHTMLContent
                        results.playwright.linkProcessing.failedAccess++;
                        const linkAccessErrorKey = normalizeErrorKey(error || msg);
                        results.playwright.errorsByType[linkAccessErrorKey] = (results.playwright.errorsByType[linkAccessErrorKey] || 0) + 1;
                        // Optionally log link-specific errors to confDetail if needed:
                        // if (confDetail) { addConferenceError(confDetail, entryTimestampISO, error, `Link access failed: ${context.url || msg}`); }
                        break;
                    case 'redirect_detected': // From within saveHTMLContent
                        results.playwright.linkProcessing.redirects++;
                        break;
                    // Catch other potential PW errors if function context is available
                    case 'page_close_failed': // Example specific error event
                    case 'dom_clean_failed':
                    case 'content_fetch_failed':
                        const otherPwErrorKey = normalizeErrorKey(error || msg);
                        results.playwright.errorsByType[otherPwErrorKey] = (results.playwright.errorsByType[otherPwErrorKey] || 0) + 1;
                        // Only add to confDetail if it's likely to cause task failure
                        // if (confDetail) { addConferenceError(confDetail, entryTimestampISO, error, msg); }
                        break;
                }

                // 4. Gemini API Specific Events
                const apiType = context.apiType; // 'determine' or 'extract' often present in Gemini logs

                switch (event) {
                    // Cache Events
                    case 'cache_get_or_create_start': break; // Informational
                    case 'cache_reuse_in_memory': break; // Informational
                    case 'cache_persistent_retrieve_start': break; // Informational
                    case 'cache_persistent_retrieve_success': break; // Informational
                    case 'cache_persistent_retrieve_invalid': break; // Informational
                    case 'cache_persistent_retrieve_not_found_or_denied': break; // Informational
                    case 'cache_persistent_retrieve_failed': break; // Informational
                    case 'cache_create_start': results.geminiApi.cacheAttempts++; break; // Count creation attempt as cache attempt
                    case 'cache_create_success': results.geminiApi.cacheCreationSuccess++; break;
                    case 'cache_create_failed':
                    case 'cache_create_failed_invalid_object':
                    case 'cache_create_invalid_model_error':
                        results.geminiApi.cacheCreationFailed++;
                        const cacheCreateErrorKey = normalizeErrorKey(error || msg);
                        results.geminiApi.errorsByType[cacheCreateErrorKey] = (results.geminiApi.errorsByType[cacheCreateErrorKey] || 0) + 1;
                        break;
                    case 'cache_setup_attempt_use': results.geminiApi.cacheAttempts++; break; // Count attempt to use as attempt
                    case 'cache_setup_use_success': results.geminiApi.cacheHits++; break; // Successful use is a hit
                    case 'retry_cache_invalidate': // Cache invalidated during retry
                    case 'gemini_api_generate_invalidate_cache': // Cache invalidated after generate error
                        results.geminiApi.cacheInvalidations++;
                        break;
                    // Retry Events
                    case 'retry_loop_start': break; // Informational
                    case 'retry_attempt_start': break; // Informational
                    case 'retry_internal_rate_limit_wait': results.geminiApi.rateLimitWaits++; break;
                    case 'retry_wait_before_next':
                        if (context.modelName) results.geminiApi.retriesByModel[context.modelName] = (results.geminiApi.retriesByModel[context.modelName] || 0) + 1;
                        if (apiType) results.geminiApi.retriesByType[apiType] = (results.geminiApi.retriesByType[apiType] || 0) + 1;
                        break;
                    case 'retry_failed_max_retries':
                        results.geminiApi.failedCalls++;
                        const retryFailErrorKey = normalizeErrorKey(context.finalError || error || msg);
                        results.geminiApi.errorsByType[retryFailErrorKey] = (results.geminiApi.errorsByType[retryFailErrorKey] || 0) + 1;
                        results.errorsAggregated[retryFailErrorKey] = (results.errorsAggregated[retryFailErrorKey] || 0) + 1; // Critical failure
                        if (confDetail && apiType) { // Check if context includes apiType
                            if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                            if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                            addConferenceError(confDetail, entryTimestampISO, context.finalError || error, msg);
                        }
                        break;
                    case 'retry_abort_non_retryable': // Non-retryable error like safety block
                        // failedCalls is incremented by the specific error handler below (e.g., safety_blocked)
                        // Need to ensure this error is captured correctly
                        const abortErrorKey = normalizeErrorKey(context.finalError || error || msg);
                        results.geminiApi.errorsByType[abortErrorKey] = (results.geminiApi.errorsByType[abortErrorKey] || 0) + 1;
                        // results.errorsAggregated[abortErrorKey] = (results.errorsAggregated[abortErrorKey] || 0) + 1; // Should be caught by specific block event
                        if (confDetail && apiType) {
                            if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                            if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                            addConferenceError(confDetail, entryTimestampISO, context.finalError || error, msg);
                        }
                        break;
                    // Core API Call Events
                    case 'gemini_call_start':
                        results.geminiApi.totalCalls++;
                        if (apiType) results.geminiApi.callsByType[apiType] = (results.geminiApi.callsByType[apiType] || 0) + 1;
                        if (context.modelName) results.geminiApi.callsByModel[context.modelName] = (results.geminiApi.callsByModel[context.modelName] || 0) + 1;
                        if (confDetail && apiType === 'determine') confDetail.steps.gemini_determine_attempted = true;
                        if (confDetail && apiType === 'extract') { // Chỉ xử lý khi là API extract và có confDetail
                            switch (event) {
                                case 'gemini_api_attempt_success':
                                    confDetail.steps.gemini_extract_success = true;
                                    confDetail.steps.gemini_extract_cache_used = context.usingCache ?? null;
                                    break;
                                case 'retry_failed_max_retries':
                                case 'retry_abort_non_retryable':
                                    // Kiểm tra lại xem lỗi này có đúng là của extract không (apiType nên có trong context)
                                    confDetail.steps.gemini_extract_success = false;
                                    // Lỗi đã được thêm vào confDetail.errors ở phần xử lý event chung
                                    break;
                                case 'gemini_api_response_blocked':
                                case 'retry_attempt_error_safety_blocked':
                                    confDetail.steps.gemini_extract_success = false;
                                    // Lỗi đã được thêm vào confDetail.errors ở phần xử lý event chung
                                    break;
                                // Quan trọng: Cần đảm bảo không có event nào khác ghi đè true/false này
                                // Nếu determine thất bại trước đó, gemini_extract_attempted sẽ là false
                                // và gemini_extract_success sẽ không bao giờ được set thành true/false từ các event này
                            }
                        }
                        
                        // Xử lý trường hợp determine thất bại khiến extract không chạy
                        if (confDetail && event === 'save_batch_process_determine_failed_invalid') {
                            // Nếu determine thất bại, chắc chắn extract không thành công
                            // Đảm bảo extract_attempted là false (nếu chưa chạy)
                            confDetail.steps.gemini_extract_attempted = false;
                            confDetail.steps.gemini_extract_success = null; // Hoặc false nếu muốn coi là thất bại
                        }

                        break;
                    case 'gemini_api_attempt_success': // Success within a retry attempt (final success)
                        results.geminiApi.successfulCalls++;
                        if (context.metaData?.totalTokenCount) results.geminiApi.totalTokens += Number(context.metaData.totalTokenCount) || 0;
                        if (confDetail && apiType) {
                            if (apiType === 'determine') {
                                confDetail.steps.gemini_determine_success = true;
                                confDetail.steps.gemini_determine_cache_used = context.usingCache ?? null;
                            }
                            if (apiType === 'extract') {
                                confDetail.steps.gemini_extract_success = true;
                                confDetail.steps.gemini_extract_cache_used = context.usingCache ?? null;
                            }
                        }
                        break;
                    case 'gemini_api_response_blocked':
                    case 'retry_attempt_error_safety_blocked': // Can be caught in retry or directly
                        results.geminiApi.failedCalls++; // Counts as a failed call
                        results.geminiApi.blockedBySafety++;
                        const blockErrorKey = normalizeErrorKey(error || context.blockReason || msg);
                        results.geminiApi.errorsByType[blockErrorKey] = (results.geminiApi.errorsByType[blockErrorKey] || 0) + 1;
                        results.errorsAggregated[blockErrorKey] = (results.errorsAggregated[blockErrorKey] || 0) + 1; // Critical
                        if (confDetail && apiType) {
                            if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                            if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                            addConferenceError(confDetail, entryTimestampISO, error || context.blockReason, msg || 'Request blocked by safety settings');
                        }
                        break;
                    // Other Gemini errors caught during retry attempts
                    case 'retry_attempt_error_cache':
                    case 'retry_attempt_error_429':
                    case 'retry_attempt_error_5xx':
                    case 'retry_attempt_error_unknown':
                        const intermediateErrorKey = normalizeErrorKey(error || msg);
                        results.geminiApi.errorsByType[intermediateErrorKey] = (results.geminiApi.errorsByType[intermediateErrorKey] || 0) + 1;
                        // Don't count towards failedCalls or errorsAggregated unless it's the final error (handled by retry_failed_max_retries)
                        break;
                    // Errors outside retry (less likely with robust retry)
                    case 'gemini_call_limiter_init_failed':
                    case 'gemini_call_invalid_apitype':
                    case 'non_cached_setup_failed':
                        const setupFailErrorKey = normalizeErrorKey(error || msg);
                        results.geminiApi.errorsByType[setupFailErrorKey] = (results.geminiApi.errorsByType[setupFailErrorKey] || 0) + 1;
                        results.errorsAggregated[setupFailErrorKey] = (results.errorsAggregated[setupFailErrorKey] || 0) + 1; // Setup failures are critical
                        if (confDetail && apiType) {
                            if (apiType === 'determine') confDetail.steps.gemini_determine_success = false;
                            if (apiType === 'extract') confDetail.steps.gemini_extract_success = false;
                            addConferenceError(confDetail, entryTimestampISO, error, msg);
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
                        const batchRejectErrorKey = normalizeErrorKey(error || 'Batch promise rejected');
                        results.errorsAggregated[batchRejectErrorKey] = (results.errorsAggregated[batchRejectErrorKey] || 0) + 1; // Batch rejection is critical
                        // Add error to conference detail *if* the log includes the acronym
                        if (confDetail) {
                            addConferenceError(confDetail, entryTimestampISO, error, 'Batch processing step failed (rejected)');
                            // Might indicate the conference task failed overall
                            // confDetail.status = 'failed'; // Let task_finish decide
                        }
                        break;
                    case 'batch_aggregation_finished':
                        results.batchProcessing.aggregatedResultsCount = context.aggregatedCount ?? null;
                        // Optional: Cross-check counts if needed
                        // if (context.successfulBatches !== results.batchProcessing.successfulBatches) { logger.warn(...) }
                        break;
                    // Errors within saveBatchToFile (before aggregation)
                    case 'save_batch_dir_create_failed':
                    case 'save_batch_read_content_failed':
                    case 'save_batch_write_file_failed':
                    case 'save_batch_determine_api_call_failed':
                    case 'save_batch_extract_api_call_failed':
                    case 'save_batch_process_determine_call_failed':
                    case 'save_batch_process_determine_failed_invalid':
                        const saveBatchErrorKey = normalizeErrorKey(error || msg);
                        results.errorsAggregated[saveBatchErrorKey] = (results.errorsAggregated[saveBatchErrorKey] || 0) + 1; // Treat these as critical
                        if (confDetail) {
                            addConferenceError(confDetail, entryTimestampISO, error, msg);
                        }
                        break;
                }

                // // 6. Final Result Preview Logging (If Applicable)
                // // Assuming 'crawl_conference_result' is the event for final preview log
                // if (route === '/crawl-conferences' && context.resultsPreview && context.resultsPreview.length === 1) {
                //     const resultAcronym = context.resultsPreview[0]?.acronym;
                //     if (resultAcronym && results.conferenceAnalysis[resultAcronym]) {
                //         results.conferenceAnalysis[resultAcronym].finalResultPreview = context.resultsPreview[0];
                //     }
                // }

                // 6. Final Result Preview Logging (If Applicable)
                // Adjust to get result preview for each conference instead of just the first one

                if (route === '/crawl-conferences' && context.resultsPreview && context.resultsPreview.length > 0) {
                    context.resultsPreview.forEach((preview: any) => {
                        const resultAcronym = preview?.acronym;

                        if (resultAcronym && results.conferenceAnalysis) {
                            const conferenceAnalysisEntry = results.conferenceAnalysis[resultAcronym];

                            if (conferenceAnalysisEntry) {
                                conferenceAnalysisEntry.finalResultPreview = preview;
                            } else {
                                console.warn(`Conference analysis entry not found for acronym: ${resultAcronym}`);
                            }
                        } else {
                            console.warn("results.conferenceAnalysis is undefined");
                        }
                    });
                }


            } catch (parseError: any) {
                results.parseErrors++;
                const errorMsg = `Line ${results.totalLogEntries}: ${parseError.message}`;
                results.logProcessingErrors.push(errorMsg);
                logger.error({ event: 'analysis_parse_error', lineNum: results.totalLogEntries, err: parseError, originalLine: line }, "Error parsing log line");
            }
        } // --- END OF LOG PROCESSING LOOP ---

        // --- Final Calculations & Adjustments ---
        logger.info({ event: 'analysis_final_calculations_start' }, "Performing final calculations");

        // Calculate overall duration
        if (firstTimestampMillis && lastTimestampMillis) {
            results.overall.startTime = results.overall.startTime ?? new Date(firstTimestampMillis).toISOString();
            results.overall.endTime = new Date(lastTimestampMillis).toISOString(); // Always use the latest timestamp found
            results.overall.durationSeconds = Math.round((lastTimestampMillis - firstTimestampMillis) / 1000);
        }

        // Finalize conference details and counts
        let completionSuccessCount = 0; // Đếm task hoàn thành (không crash)
        let completionFailCount = 0;    // Đếm task thất bại/crash
        let extractionSuccessCount = 0; // Đếm task có extract thành công


        const processedAcronyms = Object.keys(results.conferenceAnalysis);
        results.overall.processedConferencesCount = processedAcronyms.length;

        processedAcronyms.forEach(acronym => {
            const detail = results.conferenceAnalysis[acronym];

            // Skip if task never started
            if (!detail.startTime) return;

            // Infer end time and status if task didn't finish cleanly
            if (!detail.endTime && lastTimestampMillis) {
                let taskEndTimeMillis = conferenceLastTimestamp[acronym] || lastTimestampMillis;
                detail.endTime = new Date(taskEndTimeMillis).toISOString();
                const startMillis = new Date(detail.startTime!).getTime();
                if (!isNaN(startMillis)) {
                    detail.durationSeconds = Math.round((taskEndTimeMillis - startMillis) / 1000);
                }
                if (detail.status === 'processing' || detail.status === 'unknown') {
                    detail.status = 'failed'; // Mark as failed (completion failure)
                    const inferredErrorMsg = 'Task did not finish cleanly (inferred from log end)';
                    addConferenceError(detail, detail.endTime, null, inferredErrorMsg);
                    results.errorsAggregated[normalizeErrorKey(inferredErrorMsg)] = (results.errorsAggregated[normalizeErrorKey(inferredErrorMsg)] || 0) + 1;
                }
            }

            // Count task completion status
            if (detail.status === 'completed') {
                completionSuccessCount++;
            } else if (detail.status === 'failed') {
                completionFailCount++;
            }
            // else: should not happen due to inference logic

            // Count extraction success outcome
            if (detail.steps.gemini_extract_success === true) {
                extractionSuccessCount++;
            }
        });

        // Gán kết quả cuối cùng vào results.overall
        results.overall.completedTasks = completionSuccessCount;
        results.overall.failedOrCrashedTasks = completionFailCount;
        results.overall.successfulExtractions = extractionSuccessCount; // Thống kê mới

        // Calculate final cache misses
        results.geminiApi.cacheMisses = Math.max(0, results.geminiApi.cacheAttempts - results.geminiApi.cacheHits);
        
        logger.info({
            event: 'analysis_finish_success',
            parsed: results.parsedLogEntries,
            total: results.totalLogEntries,
            errors: results.errorLogCount,
            parseErrors: results.parseErrors,
            conferencesProcessed: results.overall.processedConferencesCount,
            tasksCompleted: results.overall.completedTasks, // Tên mới/rõ nghĩa
            tasksFailedOrCrashed: results.overall.failedOrCrashedTasks, // Tên mới/rõ nghĩa
            successfulExtractions: results.overall.successfulExtractions // Chỉ số mới
        }, `Log analysis execution completed successfully.`);

        return results;

    } catch (error: any) {
        // Catch errors during file reading or stream setup
        logger.error({ ...logContext, err: error, event: 'analysis_error_fatal' }, 'Fatal error during log analysis execution');
        results.logProcessingErrors.push(`FATAL ANALYSIS ERROR: ${error.message}`);
        // Return partial results if possible
        return results;
        // OR: throw error; // Rethrow if the caller should handle this
    }
};