import fs from 'fs';
import readline from 'readline';
// Loại bỏ import logger toàn cục
// import { logger } from '../../conference/11_utils';
import { LogAnalysisResult, ConferenceAnalysisDetail, ReadLogResult, RequestLogData, FilteredData } from '../types/logAnalysis';
import {
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError,
    doesRequestOverlapFilter
} from './helpers';

import { eventHandlerMap } from './eventHandlers';
import { Logger } from 'pino'; // Import Logger type

// --- Step 1: Read Log File and Group by Request ID ---
// Thêm tham số logger
export const readAndGroupLogs = async (logFilePath: string): Promise<ReadLogResult> => {
    const logContext = { filePath: logFilePath, function: 'readAndGroupLogs' };
    // logger.info({ ...logContext, event: 'read_group_start' }, 'Starting Phase 1: Reading and Grouping logs by requestId');

    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!fs.existsSync(logFilePath)) {
        // logger.error({ ...logContext, event: 'read_group_error_file_not_found' }, 'Log file not found.');
        // Ném lỗi để service biết rằng không thể tiếp tục
        throw new Error(`Log file not found at ${logFilePath}`);
    }

    const fileStream = fs.createReadStream(logFilePath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    try {
        for await (const line of rl) {
            totalEntries++;
            if (!line.trim()) continue;

            try {
                const logEntry = JSON.parse(line);
                parsedEntries++;
                // Kiểm tra logEntry.time trước khi tạo Date
                const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
                const requestId = logEntry.requestId;

                if (requestId && typeof requestId === 'string' && !isNaN(entryTimeMillis)) {
                    if (!requestsData.has(requestId)) {
                        requestsData.set(requestId, { logs: [], startTime: null, endTime: null });
                    }
                    const requestInfo = requestsData.get(requestId)!;
                    requestInfo.logs.push(logEntry);
                    // Update start/end times for the request
                    requestInfo.startTime = Math.min(entryTimeMillis, requestInfo.startTime ?? entryTimeMillis);
                    requestInfo.endTime = Math.max(entryTimeMillis, requestInfo.endTime ?? entryTimeMillis);
                } else {
                    // Log ở trace level để tránh quá nhiều log
                    // logger.trace({ event: 'read_group_skip_entry', lineNum: totalEntries, hasRequestId: !!requestId, hasValidTime: !isNaN(entryTimeMillis), lineStart: line.substring(0, 50) }, "Skipping log entry (missing requestId or invalid time)");
                }

            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
                // logger.warn({ event: 'read_group_parse_error', lineNum: totalEntries, err: parseError.message, originalLine: line.substring(0, 200) }, "Error parsing log line during phase 1");
            }
        }
    } catch (readError: any) { // Bắt lỗi cụ thể hơn nếu có thể
        // logger.error({ ...logContext, event: 'read_group_stream_error', err: readError.message, stack: readError.stack }, 'Error reading log file stream');
        // Ném lỗi để service biết rằng có vấn đề nghiêm trọng
        throw readError;
    } finally {
        // readline tự động đóng stream khi kết thúc hoặc có lỗi
        // Nhưng gọi close() tường minh cũng không hại gì nếu cần đảm bảo
        // fileStream.close(); // Có thể bỏ qua vì readline xử lý
    }


    // logger.info({ ...logContext, event: 'read_group_end', totalEntries, parsedEntries, requestIdsFound: requestsData.size, parseErrors: parseErrorsCount }, 'Finished Phase 1');

    return {
        requestsData,
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};

// --- Step 2: Filter Requests by Time ---
// Thêm tham số logger
export const filterRequestsByTime = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    // logger: Logger // Thêm logger
): FilteredData => {
    const logContext = { function: 'filterRequestsByTime' };
    // logger.info({ ...logContext, event: 'filter_start', filterStartMillis, filterEndMillis }, 'Starting Phase 2a: Filtering requests by time');

    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    for (const [requestId, requestInfo] of allRequestsData.entries()) {
        // Truyền logger vào hàm helper nếu nó cần log
        const includeRequest = doesRequestOverlapFilter(
            requestInfo.startTime,
            requestInfo.endTime,
            filterStartMillis,
            filterEndMillis,
            requestId,
            // logger // Truyền logger
        );

        if (includeRequest) {
            filteredRequests.set(requestId, requestInfo);
            // Update overall analysis time range based *only* on included requests
            if (requestInfo.startTime !== null) {
                analysisStartMillis = Math.min(requestInfo.startTime, analysisStartMillis ?? requestInfo.startTime);
            }
            if (requestInfo.endTime !== null) {
                analysisEndMillis = Math.max(requestInfo.endTime, analysisEndMillis ?? requestInfo.endTime);
            }
        }
    }

    // logger.info({ ...logContext, event: 'filter_end', totalRequests: allRequestsData.size, includedRequests: filteredRequests.size, analysisStartMillis, analysisEndMillis }, 'Finished Phase 2a: Filtering requests');
    return { filteredRequests, analysisStartMillis, analysisEndMillis };
};


// --- Step 3: Process Individual Log Entries ---
// This function modifies the 'results' and 'conferenceLastTimestamp' objects directly

/**
 * Processes a single log entry and updates the overall analysis results
 * and the specific conference details.
 *
 * IMPORTANT: This function modifies the 'results' object directly.
 * Final conference status ('completed'/'failed') is determined primarily
 * by csv_write_record_success/csv_write_record_failed events. Other errors
 * mark steps as failed but don't necessarily terminate the conference status prematurely.
 *
 * @param logEntry The parsed log entry object.
 * @param results The main LogAnalysisResult object to update.
 * @param conferenceLastTimestamp A map tracking the latest timestamp seen for each conference key.
 * @param logContextBase Base context object for logging within this function.
 * @param logger The logger instance from the service. // Thêm mô tả cho tham số logger
 */

// --- processLogEntry (REFACTORED) ---
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    logContextBase: object,
    logger: Logger // Thêm tham số logger
): void => {
    // --- Basic Log Entry Parsing ---
    // Kiểm tra logEntry.time trước khi tạo Date
    const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
    // Sử dụng thời gian hiện tại hoặc 0 nếu entryTimeMillis không hợp lệ, hoặc bỏ qua entry nếu thời gian là bắt buộc
    const entryTimestampISO = !isNaN(entryTimeMillis) ? new Date(entryTimeMillis).toISOString() : new Date().toISOString() + '_INVALID_TIME';

    const logContext = { ...logContextBase, requestId: logEntry.requestId, event: logEntry.event, time: entryTimestampISO };

    // Update overall error counts - Chỉ đếm nếu level hợp lệ
    if (typeof logEntry.level === 'number') {
        if (logEntry.level >= 50) results.errorLogCount++; // ERROR
        if (logEntry.level >= 60) results.fatalLogCount++; // FATAL
    } else if (logEntry.level !== undefined) {
        logger.trace({ ...logContext, level: logEntry.level }, 'Log entry has invalid level type');
    }


    const event = logEntry.event;

    // --- Conference Identification & Detail Retrieval ---
    const context = logEntry; // Use context directly for properties
    const acronym = context.acronym || context.conferenceAcronym;
    const title = context.title || context.conferenceTitle;
    const compositeKey = createConferenceKey(acronym, title);
    let confDetail: ConferenceAnalysisDetail | null = null;

    if (compositeKey) {
        if (!results.conferenceAnalysis[compositeKey]) {
            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(acronym!, title!);
            logger.trace({ ...logContext, event: 'conference_detail_init', compositeKey }, 'Initialized new conference detail');
        }
        confDetail = results.conferenceAnalysis[compositeKey];
        // Chỉ cập nhật timestamp nếu thời gian hợp lệ
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    } else if (acronym && (event?.startsWith('task_') || event?.includes('conference') || event?.includes('gemini') || event?.includes('save_') || event?.includes('csv_'))) {
        // Log cảnh báo nếu không tạo được compositeKey nhưng event có vẻ liên quan đến conference
        logger.warn({ ...logContext, event: 'analysis_missing_title_for_key', logEvent: event, acronym: acronym }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
        // Có thể muốn xử lý các log này theo cách khác hoặc bỏ qua nếu không có key
    } else if (event && !compositeKey && !acronym) {
        // Log trace cho các event không có acronym/title và không tạo được key
        logger.trace({ ...logContext, event: 'analysis_event_no_key', logEvent: event }, 'Log entry event without acronym or title.');
    }


    // ========================================================================
    // --- Event-Based Analysis Dispatcher ---
    // ========================================================================
    // Truyền logger vào event handler map nếu các handler cần nó
    const handler = eventHandlerMap[event]; // Find the handler function
    if (handler) {
        try {
            // Execute the specific handler, passing the logger
            handler(logEntry, results, confDetail, entryTimestampISO, logContext); // Truyền logger vào handler
        } catch (handlerError: any) {
            // Log error during specific handler execution
            logger.error({
                ...logContext,
                event: 'event_handler_error',
                handlerEvent: event, // Log which event caused the handler error
                err: handlerError.stack || handlerError.message || handlerError
            }, `Error executing handler for event: ${event}`);
            // Optionally add a generic error to the conference detail if possible
            if (confDetail) {
                // Truyền logger vào addConferenceError nếu nó cần
                addConferenceError(confDetail, entryTimestampISO, handlerError, `Internal error processing event ${event}`);
            }
            // Increment a general handler error counter if needed
            // results.overall.handlerErrors = (results.overall.handlerErrors || 0) + 1;
        }
    } else if (event) { // Only log if event exists but has no handler
        // Optional: Log events that don't have a specific handler
        // This can be noisy, consider logging at trace level or removing if not needed.
        // logger.trace({ ...logContext, event: 'unhandled_log_event' }, `No specific handler registered for event: ${event}`);
    }
    // --- End of Dispatcher ---

}; // --- End of processLogEntry ---


// --- Step 4: Calculate Final Metrics ---
// Thêm tham số logger
export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }, // Still useful for debugging/potential future use
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    // logger: Logger // Thêm logger
): void => {
    const logContext = { function: 'calculateFinalMetrics' };
    // logger.info({ ...logContext, event: 'final_calc_start' }, "Performing final calculations on analyzed data");

    // --- Calculate Overall Duration based on analyzed request range ---
    // (Keep existing logic for calculating results.overall start/end/duration based on analysisStart/EndMillis or fallback)
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.conferenceAnalysis).length > 0) {
        // Fallback logic remains the same
        let minConfStart: number | null = null;
        let maxConfEnd: number | null = null;
        Object.values(results.conferenceAnalysis).forEach(detail => {
            // Use detail.endTime if set, otherwise consider lastSeenTime *only if status is terminal*
            const detailEndTimeMillis = detail.endTime ? new Date(detail.endTime).getTime() : null;
            // Sử dụng conferenceLastTimestamp chỉ nếu compositeKey hợp lệ
            const compositeKey = createConferenceKey(detail.acronym, detail.title);
            const lastSeenTime = compositeKey ? conferenceLastTimestamp[compositeKey] ?? null : null;

            const consideredEndTime = detailEndTimeMillis ?? ((detail.status === 'completed' || detail.status === 'failed') ? lastSeenTime : null); // Only use lastSeen as fallback for terminal states

            if (detail.startTime) {
                const startMs = new Date(detail.startTime).getTime();
                if (!isNaN(startMs)) minConfStart = Math.min(startMs, minConfStart ?? startMs);
            }
            if (consideredEndTime !== null && !isNaN(consideredEndTime)) {
                maxConfEnd = Math.max(consideredEndTime, maxConfEnd ?? consideredEndTime);
            }
        });
        if (minConfStart !== null) results.overall.startTime = new Date(minConfStart).toISOString();
        if (maxConfEnd !== null) results.overall.endTime = new Date(maxConfEnd).toISOString();
        if (minConfStart !== null && maxConfEnd !== null) {
            results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
        }
    }


    // --- Finalize Conference Details and Counts ---
    let completionSuccessCount = 0;
    let completionFailCount = 0;
    let processingCount = 0; // Tasks still running or in unknown state at end of window
    let extractionSuccessCount = 0;

    const processedCompositeKeys = Object.keys(results.conferenceAnalysis);
    results.overall.processedConferencesCount = processedCompositeKeys.length;

    processedCompositeKeys.forEach(key => {
        const detail = results.conferenceAnalysis[key];

        // --- Categorize based on final observed status ---
        if (detail.status === 'completed') {
            completionSuccessCount++;
            if (detail.startTime && detail.endTime) {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis)) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                }
            } else if (!detail.startTime && detail.endTime) {
                addConferenceError(detail, detail.endTime, null, 'Task completed event found without start event within analyzed range');
            }
        } else if (detail.status === 'failed') {
            completionFailCount++;
            if (detail.startTime && detail.endTime) {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis)) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                }
            } else if (!detail.startTime && detail.endTime) {
                addConferenceError(detail, detail.endTime, null, 'Task failed event found without start event within analyzed range');
            }
        } else if (detail.status === 'processing' || detail.status === 'unknown') {
            // Task started but did not reach a terminal state (completed/failed)
            // within the analyzed log window.
            if (detail.startTime) { // Only count if it actually started
                // Check for critical failures *before* incrementing processingCount
                // to ensure tasks marked as failed here don't also increment processingCount.
                if (detail.steps.gemini_extract_attempted === true && detail.steps.gemini_extract_success === false) {
                    // logger.warn({ ...logContext, event: 'final_calc_mark_failed_critical_step', compositeKey: key, reason: 'Gemini extract failed' }, 'Marking processing task as failed due to critical step failure.');
                    detail.status = 'failed'; // Mark as failed
                    completionFailCount++; // Increment failed count
                    // DO NOT increment processingCount if marked as failed here
                } else {
                    // If not marked as failed by critical step, count as processing
                    processingCount++;
                    // logger.trace({ ...logContext, event: 'final_calc_task_processing', compositeKey: key, status: detail.status }, 'Task considered still processing at end of analysis window.');
                }
            } else {
                // Status is 'unknown' and no startTime - likely just initialized but never started processing within window. Ignore in counts.
                // logger.trace({ ...logContext, event: 'final_calc_task_ignored_not_started', compositeKey: key }, 'Task ignored (initialized but not started within window).');
            }
        } else {
            // logger.warn({ ...logContext, event: 'final_calc_unknown_status', compositeKey: key, status: detail.status }, 'Encountered unexpected final status for conference.');
        }

        if (detail.steps.gemini_extract_success === true) {
            extractionSuccessCount++;
        }
    });

    // --- Update Overall Results ---
    results.overall.completedTasks = completionSuccessCount;
    results.overall.failedOrCrashedTasks = completionFailCount;
    results.overall.processingTasks = processingCount; // Add the new count
    results.overall.successfulExtractions = extractionSuccessCount;

    // --- Calculate Derived Stats ---
    results.geminiApi.cacheMisses = Math.max(0, results.geminiApi.cacheAttempts - results.geminiApi.cacheHits);

    // logger.info({
    //     ...logContext,
    //     event: 'final_calc_end',
    //     completed: completionSuccessCount,
    //     failed: completionFailCount,
    //     processing: processingCount,
    //     processed: results.overall.processedConferencesCount
    // }, "Finished final calculations.");
};

// Bạn cũng cần kiểm tra các hàm trong './helpers' và './eventHandlers'
// để đảm bảo chúng cũng nhận logger nếu cần ghi log bên trong.
// Ví dụ:
// ใน helpers.ts:
// export const doesRequestOverlapFilter = (..., logger: Logger): boolean => { ... }
// export const addConferenceError = (..., logger: Logger): void => { ... }

// ใน eventHandlers.ts:
// eventHandlerMap = {
//    'some_event': (logEntry, results, confDetail, timestamp, logContext, logger: Logger) => { ... },
//    ...
// }