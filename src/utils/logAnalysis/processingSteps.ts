// src/client/utils/processingSteps.ts
import fs from 'fs';
import readline from 'readline';
import { LogAnalysisResult, ConferenceAnalysisDetail, ReadLogResult, RequestLogData, FilteredData } from '../../types/logAnalysis.types';
import {
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError, // Đảm bảo hàm này không tự log mà trả về object lỗi hoặc để processLogEntry log
    doesRequestOverlapFilter
} from './helpers';

// Import eventHandlerMap từ vị trí mới của nó (thường là từ eventHandlers/index.ts)
import { eventHandlerMap } from './index';
// import { Logger } from 'pino';

// --- Step 1: readAndGroupLogs (Giữ nguyên, đã có tham số logger) ---
export const readAndGroupLogs = async (logFilePath: string): Promise<ReadLogResult> => {
    // const logger = baseLogger.child({ function: 'readAndGroupLogs', filePath: logFilePath });
    // logger.info({ event: 'read_group_start' }, 'Starting Phase 1: Reading and Grouping logs by requestId');

    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!fs.existsSync(logFilePath)) {
        // logger.error({ event: 'read_group_error_file_not_found' }, 'Log file not found.');
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
                const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
                const requestId = logEntry.requestId;

                if (requestId && typeof requestId === 'string' && !isNaN(entryTimeMillis)) {
                    if (!requestsData.has(requestId)) {
                        requestsData.set(requestId, { logs: [], startTime: null, endTime: null });
                    }
                    const requestInfo = requestsData.get(requestId)!;
                    requestInfo.logs.push(logEntry);
                    requestInfo.startTime = Math.min(entryTimeMillis, requestInfo.startTime ?? entryTimeMillis);
                    requestInfo.endTime = Math.max(entryTimeMillis, requestInfo.endTime ?? entryTimeMillis);
                } else {
                    // logger.trace({ event: 'read_group_skip_entry', lineNum: totalEntries, hasRequestId: !!requestId, hasValidTime: !isNaN(entryTimeMillis), lineStart: line.substring(0, 50) }, "Skipping log entry (missing requestId or invalid time)");
                }

            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
                // logger.warn({ event: 'read_group_parse_error', lineNum: totalEntries, err: parseError.message, originalLine: line.substring(0, 200) }, "Error parsing log line during phase 1");
            }
        }
    } catch (readError: any) {
        // logger.error({ event: 'read_group_stream_error', err: readError.message, stack: readError.stack }, 'Error reading log file stream');
        throw readError;
    }

    // logger.info({ event: 'read_group_end', totalEntries, parsedEntries, requestIdsFound: requestsData.size, parseErrors: parseErrorsCount }, 'Finished Phase 1');

    return {
        requestsData,
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};

// --- Step 2: filterRequestsByTime (Giữ nguyên, đã có tham số logger) ---
export const filterRequestsByTime = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    // baseLogger: Logger
): FilteredData => {
    // const logger = baseLogger.child({ function: 'filterRequestsByTime' });
    // logger.info({ event: 'filter_start', filterStartMillis, filterEndMillis }, 'Starting Phase 2a: Filtering requests by time');

    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    for (const [requestId, requestInfo] of allRequestsData.entries()) {
        const includeRequest = doesRequestOverlapFilter(
            requestInfo.startTime,
            requestInfo.endTime,
            filterStartMillis,
            filterEndMillis,
            requestId,
        );

        if (includeRequest) {
            filteredRequests.set(requestId, requestInfo);
            if (requestInfo.startTime !== null) {
                analysisStartMillis = Math.min(requestInfo.startTime, analysisStartMillis ?? requestInfo.startTime);
            }
            if (requestInfo.endTime !== null) {
                analysisEndMillis = Math.max(requestInfo.endTime, analysisEndMillis ?? requestInfo.endTime);
            }
        }
    }

    // logger.info({ event: 'filter_end', totalRequests: allRequestsData.size, includedRequests: filteredRequests.size, analysisStartMillis, analysisEndMillis }, 'Finished Phase 2a: Filtering requests');
    return { filteredRequests, analysisStartMillis, analysisEndMillis };
};


// --- Step 3: processLogEntry (ĐÃ ĐIỀU CHỈNH) ---
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    // logContextBase: object, // Sẽ được tạo bên trong từ logger
    // baseLoggerForEntry: Logger // Logger được truyền vào, có thể là logger của request cụ thể
): void => {
    const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
    const entryTimestampISO = !isNaN(entryTimeMillis) ? new Date(entryTimeMillis).toISOString() : new Date().toISOString() + '_INVALID_TIME';

    // Tạo logger cụ thể cho log entry này, dựa trên baseLoggerForEntry
    // baseLoggerForEntry thường là logger đã có context của requestId
    // const entrySpecificLogger = baseLoggerForEntry.child({
    //     event_being_processed: logEntry.event, // log context cho event đang xử lý
    //     entry_timestamp_iso: entryTimestampISO
    // });
    // const logContextForHandler = { // Context để truyền vào handler
    //     requestId: logEntry.requestId,
    //     event: logEntry.event,
    //     time: entryTimestampISO,
    //     // Thêm các trường từ logEntry.context vào đây nếu handler cần
    //     ...(logEntry.context || {})
    // };


    // Update overall error counts
    if (typeof logEntry.level === 'number') {
        if (logEntry.level >= 50) results.errorLogCount++;
        if (logEntry.level >= 60) results.fatalLogCount++;
    } else if (logEntry.level !== undefined) {
        // entrySpecificLogger.trace({ level_value: logEntry.level }, 'Log entry has invalid level type');
    }

    const eventName = logEntry.event as string | undefined; // Tên event từ log entry

    // Conference Identification
    // Ưu tiên lấy từ logEntry.context nếu có, sau đó mới đến logEntry trực tiếp
    const contextFields = logEntry.context || {};
    const acronym = contextFields.acronym || contextFields.conferenceAcronym || logEntry.acronym || logEntry.conferenceAcronym;
    const title = contextFields.title || contextFields.conferenceTitle || logEntry.title || logEntry.conferenceTitle;
    const compositeKey = createConferenceKey(acronym, title);
    let confDetail: ConferenceAnalysisDetail | null = null;

    if (compositeKey) {
        if (!results.conferenceAnalysis[compositeKey]) {
            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(acronym!, title!);
            // entrySpecificLogger.trace({ compositeKey }, 'Initialized new conference detail');
        }
        confDetail = results.conferenceAnalysis[compositeKey];
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    } else if (acronym && (eventName?.startsWith('task_') || eventName?.includes('conference') || eventName?.includes('gemini') || eventName?.includes('save_') || eventName?.includes('csv_'))) {
        // entrySpecificLogger.warn({ logEvent: eventName, acronym }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
    } else if (eventName && !compositeKey && !acronym) {
        // entrySpecificLogger.trace({ logEvent: eventName }, 'Log entry event without acronym or title.');
    }

    // --- Event-Based Analysis Dispatcher ---
    if (eventName && eventHandlerMap[eventName]) {
        const handler = eventHandlerMap[eventName];
        try {
            // Truyền logContextForHandler chứa các trường đã được chuẩn hóa từ logEntry.context
            // Handler sẽ sử dụng logger riêng của nó nếu cần log, hoặc chúng ta có thể truyền entrySpecificLogger
            handler(logEntry, results, confDetail, entryTimestampISO);
        } catch (handlerError: any) {
            // entrySpecificLogger.error({
            //     handler_event_name: eventName,
            //     err_message: handlerError.message,
            //     err_stack: handlerError.stack
            // }, `Error executing handler for event: ${eventName}`);
            if (confDetail) {
                // addConferenceError không nên tự log, chỉ tạo object lỗi
                addConferenceError(confDetail, entryTimestampISO, handlerError, `Internal error processing event ${eventName}`);
            }
            // Ghi nhận lỗi xử lý handler vào một mục chung nếu cần
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on requestId '${logEntry.requestId}': ${handlerError.message}`);
        }
    } else if (eventName) {
        // entrySpecificLogger.trace(`No specific handler registered for event: ${eventName}`);
    }
};


// --- Step 4: calculateFinalMetrics (Giữ nguyên, đã có tham số logger) ---
export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    // baseLogger: Logger
): void => {
    // const logger = baseLogger.child({ function: 'calculateFinalMetrics' });
    // logger.info({ event: 'final_calc_start' }, "Performing final calculations on analyzed data");

    // --- Calculate Overall Duration ---
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.conferenceAnalysis).length > 0) {
        let minConfStart: number | null = null;
        let maxConfEnd: number | null = null;
        Object.values(results.conferenceAnalysis).forEach(detail => {
            const detailEndTimeMillis = detail.endTime ? new Date(detail.endTime).getTime() : null;
            const compositeKey = createConferenceKey(detail.acronym, detail.title);
            const lastSeenTime = compositeKey ? conferenceLastTimestamp[compositeKey] ?? null : null;
            const consideredEndTime = detailEndTimeMillis ?? ((detail.status === 'completed' || detail.status === 'failed' || detail.status === 'skipped') ? lastSeenTime : null);

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
        if (minConfStart !== null && maxConfEnd !== null && maxConfEnd >= minConfStart) {
            results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
        } else {
            results.overall.durationSeconds = 0;
        }
    }

    // --- Finalize Conference Details and Counts ---
    // Logic trong này phần lớn dựa vào trạng thái cuối cùng của confDetail
    // đã được set bởi các handler.
    // Cần xem xét lại cách tính processingCount.
    let completionSuccessCount = 0; // Sẽ được tăng bởi handler csv_write_success
    let completionFailCount = 0;    // Sẽ được tăng bởi các handler lỗi khác nhau
    let stillProcessingCount = 0;
    // let extractionSuccessCount = 0; // Sẽ được tăng bởi gemini_api_response (extract success)

    const processedCompositeKeys = Object.keys(results.conferenceAnalysis);
    // results.overall.processedConferencesCount đã được tăng bởi handleTaskStart

    processedCompositeKeys.forEach(key => {
        const detail = results.conferenceAnalysis[key];

        // Tính durationSeconds cho từng conference nếu chưa có và có thể tính
        if (!detail.durationSeconds && detail.startTime && detail.endTime) {
            try {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis) && endMillis >= startMillis) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        // Trạng thái 'completed' và 'failed' đã được set bởi các handler tương ứng.
        // (ví dụ: handleCsvWriteSuccess set 'completed', handleTaskUnhandledError set 'failed')
        // Logic ở đây chủ yếu là đếm.

        if (detail.status === 'completed') {
            // completionSuccessCount đã được tăng bởi handleCsvWriteSuccess
        } else if (detail.status === 'failed') {
            // completionFailCount đã được tăng bởi các handler lỗi
        } else if (detail.status === 'processing' || detail.status === 'unknown' || detail.status === 'processed_ok') {
            // Nếu status là 'processing', 'unknown' hoặc 'processed_ok' (chưa ra CSV)
            // và không có endTime, thì coi là đang xử lý.
            if (!detail.endTime) {
                stillProcessingCount++;
                // logger.trace({ event: 'final_calc_task_still_processing', compositeKey: key, status: detail.status }, 'Task considered still actively processing at end of analysis window (no endTime).');
            } else {
                // Có endTime nhưng không phải completed/failed/skipped (ví dụ 'processed_ok')
                // Có thể coi là một dạng "chưa hoàn tất" nhưng không hẳn là "đang xử lý".
                // Quyết định cách đếm những trường hợp này.
                // Hiện tại, nếu có endTime thì không tính vào stillProcessingCount.
            }
        } else if (detail.status === 'skipped') {
            // Đã được xử lý bởi handleTaskSkipped
        }

        // extractionSuccessCount đã được tăng bởi gemini handler.
    });

    // results.overall.completedTasks nên là tổng số conference đã thực sự hoàn thành (CSV success).
    // Nó sẽ được cập nhật bởi handleCsvWriteSuccess.
    // Tương tự cho failedOrCrashedTasks, đã được cập nhật bởi các handler lỗi.
    // Và successfulExtractions từ gemini handler.

    results.overall.processingTasks = stillProcessingCount; // Cập nhật processingTasks ở đây

    // --- Calculate Derived Stats ---
    results.geminiApi.cacheContextMisses = Math.max(0, results.geminiApi.cacheContextAttempts - results.geminiApi.cacheContextHits);

    if (results.fileOutput.csvFileGenerated === false &&
        (results.fileOutput.csvPipelineFailures > 0 /* một cờ khác từ orchestrator nếu cần */ )) {
        Object.values(results.conferenceAnalysis).forEach(detail => {
            // Nếu conference đã ghi JSONL thành công, và chưa được đánh dấu là completed/failed
            // thì giờ nó sẽ bị coi là failed do pipeline CSV lỗi.
            if (detail.jsonlWriteSuccess === true &&
                detail.status !== 'completed' &&
                detail.status !== 'failed' &&
                detail.status !== 'skipped') {

                const oldStatusWasNotFailed = detail.status;
                detail.status = 'failed';
                detail.csvWriteSuccess = false; // Ghi nhận CSV thất bại
                if (!detail.endTime) { // Set endTime nếu chưa có
                    // Cố gắng lấy timestamp cuối cùng của conference nếu có
                    const confKey = createConferenceKey(detail.acronym, detail.title);
                    const lastTimestamp = confKey ? conferenceLastTimestamp[confKey] : null;
                    detail.endTime = lastTimestamp ? new Date(lastTimestamp).toISOString() : results.overall.endTime;
                }
                addConferenceError(detail, detail.endTime!, "CSV generation pipeline failed.", "csv_pipeline_failure");

                if (oldStatusWasNotFailed) {
                    results.overall.failedOrCrashedTasks = (results.overall.failedOrCrashedTasks || 0) + 1;
                }
            }
        });
    }

    // logger.info({
    //     event: 'final_calc_end',
    //     // Các counter này nên phản ánh giá trị đã được cập nhật bởi các handler
    //     completed_final: results.overall.completedTasks,
    //     failed_final: results.overall.failedOrCrashedTasks,
    //     skipped_final: results.overall.skippedTasks,
    //     still_processing_final: results.overall.processingTasks,
    //     processed_conferences_total: results.overall.processedConferencesCount
    // }, "Finished final calculations.");
};