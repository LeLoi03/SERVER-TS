// src/utils/logAnalysis/processingSteps.ts
import fs from 'fs';
import readline from 'readline';
import { LogAnalysisResult, ConferenceAnalysisDetail, ReadLogResult, RequestLogData, FilteredData } from '../../types/logAnalysis.types'; // Đảm bảo types đã được cập nhật
import {
    createConferenceKey,      // Đảm bảo helper này nhận requestId
    initializeConferenceDetail, // Đảm bảo helper này nhận requestId
    addConferenceError,
    doesRequestOverlapFilter
} from './helpers'; // Đảm bảo helpers đã được cập nhật

import { eventHandlerMap } from './index'; // Giả sử index.ts export eventHandlerMap
// import { Logger } from 'pino'; // Bỏ comment nếu dùng logger

// --- Step 1: readAndGroupLogs ---
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

// --- Step 2: filterRequests ---
export const filterRequests = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    requestIdFilter?: string
    // baseLogger?: Logger
): FilteredData => {
    // const logger = baseLogger?.child({ function: 'filterRequests' }) || console;
    // logger.info({ event: 'filter_start', filterStartMillis, filterEndMillis, requestIdFilter }, 'Starting: Filtering requests');

    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    if (requestIdFilter) {
        // logger.info({ event: 'filter_mode_requestId', targetRequestId: requestIdFilter }, `Filtering for specific requestId: ${requestIdFilter}`);
        const requestInfo = allRequestsData.get(requestIdFilter);
        if (requestInfo) {
            const overlapsTimeFilter = doesRequestOverlapFilter(
                requestInfo.startTime,
                requestInfo.endTime,
                filterStartMillis,
                filterEndMillis,
                requestIdFilter //, logger
            );

            if (filterStartMillis === null && filterEndMillis === null) {
                filteredRequests.set(requestIdFilter, requestInfo);
                analysisStartMillis = requestInfo.startTime;
                analysisEndMillis = requestInfo.endTime;
            } else if (overlapsTimeFilter) {
                filteredRequests.set(requestIdFilter, requestInfo);
                analysisStartMillis = requestInfo.startTime;
                analysisEndMillis = requestInfo.endTime;
            } else {
                // logger.info({event: 'filter_requestId_found_but_outside_time_filter', requestIdFilter, reqStart: requestInfo.startTime, reqEnd: requestInfo.endTime}, "RequestId found but outside specified time filter.")
            }
        } else {
            // logger.warn({ event: 'filter_requestId_not_found', targetRequestId: requestIdFilter }, `Specified requestId for filtering not found.`);
        }
    } else {
        // logger.info({ event: 'filter_mode_time_range' }, `Filtering by time range for all requests.`);
        for (const [requestId, requestInfo] of allRequestsData.entries()) {
            const includeRequest = doesRequestOverlapFilter(
                requestInfo.startTime,
                requestInfo.endTime,
                filterStartMillis,
                filterEndMillis,
                requestId //, logger
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
    }

    // logger.info({ event: 'filter_end', totalRequestsOriginal: allRequestsData.size, includedRequestsCount: filteredRequests.size, finalAnalysisStartMillis: analysisStartMillis, finalAnalysisEndMillis: analysisEndMillis }, 'Finished: Filtering requests');
    return { filteredRequests, analysisStartMillis, analysisEndMillis };
};

// --- Step 3: processLogEntry ---
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }
    // baseLoggerForEntry: Logger
): void => {
    const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
    const entryTimestampISO = !isNaN(entryTimeMillis) ? new Date(entryTimeMillis).toISOString() : new Date().toISOString() + '_INVALID_TIME';
    // const entrySpecificLogger = baseLoggerForEntry.child({ /* ... */ });

    if (typeof logEntry.level === 'number') {
        if (logEntry.level >= 50) results.errorLogCount++;
        if (logEntry.level >= 60) results.fatalLogCount++;
    }

    const eventName = logEntry.event as string | undefined;
    const contextFields = logEntry.context || {};
    const acronym = contextFields.acronym || contextFields.conferenceAcronym || logEntry.acronym || logEntry.conferenceAcronym;
    const title = contextFields.title || contextFields.conferenceTitle || logEntry.title || logEntry.conferenceTitle;
    const currentRequestId = logEntry.requestId; // <<< Lấy requestId từ log entry

    // <<< MODIFIED: createConferenceKey now includes requestId >>>
    const compositeKey = createConferenceKey(currentRequestId, acronym, title);
    let confDetail: ConferenceAnalysisDetail | null = null;

    if (compositeKey) {
        if (!results.conferenceAnalysis[compositeKey]) {
            // <<< MODIFIED: initializeConferenceDetail now includes requestId >>>
            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(currentRequestId, acronym!, title!);
            // entrySpecificLogger.trace({ compositeKey }, 'Initialized new conference detail');
        }
        confDetail = results.conferenceAnalysis[compositeKey];
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    } else if (acronym && (eventName?.startsWith('task_') || eventName?.includes('conference') || eventName?.includes('gemini') || eventName?.includes('save_') || eventName?.includes('csv_'))) {
        // entrySpecificLogger.warn({ logEvent: eventName, acronym, requestId: currentRequestId }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
    } else if (eventName && !compositeKey && !acronym) {
        // entrySpecificLogger.trace({ logEvent: eventName, requestId: currentRequestId }, 'Log entry event without acronym or title.');
    }

    if (eventName && eventHandlerMap[eventName]) {
        const handler = eventHandlerMap[eventName];
        try {
            handler(logEntry, results, confDetail, entryTimestampISO);
        } catch (handlerError: any) {
            // entrySpecificLogger.error({ /* ... */ }, `Error executing handler for event: ${eventName}`);
            if (confDetail) {
                addConferenceError(confDetail, entryTimestampISO, handlerError, `Internal error processing event ${eventName}`);
            }
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on requestId '${currentRequestId}': ${handlerError.message}`);
        }
    } else if (eventName) {
        // entrySpecificLogger.trace({ eventName, requestId: currentRequestId }, `No specific handler registered for event: ${eventName}`);
    }
};

// --- Step 4: calculateFinalMetrics ---
export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData> // <<< NEW PARAMETER
    // baseLogger: Logger
): void => {
    // const logger = baseLogger.child({ function: 'calculateFinalMetrics' });
    // logger.info({ event: 'final_calc_start' }, "Performing final calculations on analyzed data");

    // --- Calculate Overall Duration (for the set of analyzed requests) ---
    // This logic is correct: overall start/end/duration reflects the scope of the analysis.
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.conferenceAnalysis).length > 0) {
        // This fallback might still be useful if, for some reason, analysisStart/EndMillis are null
        // but there are conference details (e.g., if filtering was very restrictive and only left partial data).
        let minConfStart: number | null = null;
        let maxConfEnd: number | null = null;

        Object.values(results.conferenceAnalysis).forEach(detail => {
            const detailEndTimeMillis = detail.endTime ? new Date(detail.endTime).getTime() : null;
            // <<< MODIFIED: Use requestId from detail to create key for conferenceLastTimestamp >>>
            const confKeyForTimestamp = createConferenceKey(detail.requestId, detail.acronym, detail.title);
            const lastSeenTime = confKeyForTimestamp ? conferenceLastTimestamp[confKeyForTimestamp] ?? null : null;
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


    // --- Populate Per-Request Timings into results.requests ---
    // results.analyzedRequestIds should have been populated by LogAnalysisService from filteredRequests.keys()
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        if (requestData && requestData.startTime !== null && requestData.endTime !== null) {
            results.requests[reqId] = {
                startTime: new Date(requestData.startTime).toISOString(),
                endTime: new Date(requestData.endTime).toISOString(),
                durationSeconds: Math.round((requestData.endTime - requestData.startTime) / 1000),
            };
        } else if (requestData) { // startTime or endTime might be null if request had only one log entry
            results.requests[reqId] = {
                startTime: requestData.startTime ? new Date(requestData.startTime).toISOString() : null,
                endTime: requestData.endTime ? new Date(requestData.endTime).toISOString() : null,
                durationSeconds: 0, // Or null, depending on preference for incomplete data
            };
        }
        else {
            // This case implies reqId is in analyzedRequestIds but not in filteredRequestsData, which shouldn't happen.
            results.requests[reqId] = {
                startTime: null,
                endTime: null,
                durationSeconds: null,
            };
            // logger.warn({ event: 'final_calc_missing_request_data', requestId: reqId }, 'Request ID in analyzedRequestIds not found in filteredRequestsData.');
        }
    }

    // --- Finalize Conference Details and Counts ---
    let stillProcessingCount = 0;
    const processedCompositeKeys = Object.keys(results.conferenceAnalysis);
    // results.overall.processedConferencesCount is typically incremented by task_start handlers

    processedCompositeKeys.forEach(key => { // key here is `${requestId}-${acronym}-${title}`
        const detail = results.conferenceAnalysis[key];

        if (!detail.durationSeconds && detail.startTime && detail.endTime) {
            try {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis) && endMillis >= startMillis) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                }
            } catch (e) { /* ignore date parsing errors */ }
        }

        if (detail.status === 'processing' || detail.status === 'unknown' || detail.status === 'processed_ok') {
            if (!detail.endTime) {
                stillProcessingCount++;
            }
        }
    });

    results.overall.processingTasks = stillProcessingCount;

    // --- Calculate Derived Stats ---
    results.geminiApi.cacheContextMisses = Math.max(0, results.geminiApi.cacheContextAttempts - results.geminiApi.cacheContextHits);

    if (results.fileOutput.csvFileGenerated === false &&
        (results.fileOutput.csvPipelineFailures > 0 /* || other orchestrator flags if needed */)) {
        Object.values(results.conferenceAnalysis).forEach(detail => {
            if (detail.jsonlWriteSuccess === true &&
                detail.status !== 'completed' &&
                detail.status !== 'failed' &&
                detail.status !== 'skipped') {

                const oldStatus = detail.status; // Capture old status before changing
                detail.status = 'failed';
                detail.csvWriteSuccess = false;

                if (!detail.endTime) {
                    // <<< MODIFIED: Use requestId from detail to create key for conferenceLastTimestamp >>>
                    const confKeyForTimestamp = createConferenceKey(detail.requestId, detail.acronym, detail.title);
                    const lastTimestamp = confKeyForTimestamp ? conferenceLastTimestamp[confKeyForTimestamp] : null;
                    detail.endTime = lastTimestamp ? new Date(lastTimestamp).toISOString() : (results.overall.endTime || new Date().toISOString());
                }
                addConferenceError(detail, detail.endTime!, "CSV generation pipeline failed.", "csv_pipeline_failure");

                // Only increment failedOrCrashedTasks if it wasn't already considered failed/crashed
                // This check might be overly simplistic; specific handlers should ideally manage these counts.
                // However, this handles a global CSV failure impacting previously "ok" tasks.
                results.overall.failedOrCrashedTasks = (results.overall.failedOrCrashedTasks || 0) + 1;
                // If it was 'processing' or 'unknown', decrement that count if it was contributing
                if ((oldStatus === 'processing' || oldStatus === 'unknown' || oldStatus === 'processed_ok') && !detail.endTime) { // If it was counted in stillProcessingCount
                    // This logic is tricky as stillProcessingCount is calculated based on current state.
                    // Better to let handlers update completed/failed counts directly.
                    // The `processingTasks` will be recalculated correctly based on the new 'failed' status.
                }
            }
        });
        // Recalculate processingTasks after potential status changes due to CSV failure
        let newStillProcessingCount = 0;
        Object.values(results.conferenceAnalysis).forEach(d => {
            if ((d.status === 'processing' || d.status === 'unknown' || d.status === 'processed_ok') && !d.endTime) {
                newStillProcessingCount++;
            }
        });
        results.overall.processingTasks = newStillProcessingCount;
    }

    // logger.info({
    //     event: 'final_calc_end',
    //     completed_final: results.overall.completedTasks,
    //     failed_final: results.overall.failedOrCrashedTasks,
    //     skipped_final: results.overall.skippedTasks,
    //     still_processing_final: results.overall.processingTasks,
    //     processed_conferences_total: results.overall.processedConferencesCount
    // }, "Finished final calculations.");
};