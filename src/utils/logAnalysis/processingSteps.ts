// src/utils/logAnalysis/processingSteps.ts
import fs from 'fs';
import readline from 'readline';
import {
    LogAnalysisResult,
    ConferenceAnalysisDetail,
    ReadLogResult,
    RequestLogData,
    FilteredData,
    RequestTimings // Ensure this is imported for currentRequestTimings
} from '../../types/logAnalysis.types';
import {
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError,
    doesRequestOverlapFilter
} from './helpers'; // Assuming helpers are correctly defined

import { eventHandlerMap } from './index'; // Assuming index.ts exports eventHandlerMap correctly
// import { Logger, pino } from 'pino'; // Example if you were using pino

// const baseLogger = pino({ level: 'info' }); // Example: Initialize a base logger if used

// --- Step 1: readAndGroupLogs ---
export const readAndGroupLogs = async (logFilePath: string): Promise<ReadLogResult> => {
    // const logger = baseLogger.child({ function: 'readAndGroupLogs', filePath: logFilePath });
    // logger.info({ event: 'read_group_start' }, 'Starting Phase 1: Reading and Grouping logs by batchRequestId');

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
                const batchRequestId = logEntry.batchRequestId; // Assuming 'batchRequestId' is the correct field

                if (batchRequestId && typeof batchRequestId === 'string' && !isNaN(entryTimeMillis)) {
                    if (!requestsData.has(batchRequestId)) {
                        requestsData.set(batchRequestId, { logs: [], startTime: null, endTime: null });
                    }
                    const requestInfo = requestsData.get(batchRequestId)!;
                    requestInfo.logs.push(logEntry);
                    requestInfo.startTime = Math.min(entryTimeMillis, requestInfo.startTime ?? entryTimeMillis);
                    requestInfo.endTime = Math.max(entryTimeMillis, requestInfo.endTime ?? entryTimeMillis);
                } else {
                    // logger.trace({ event: 'read_group_skip_entry', lineNum: totalEntries, hasRequestId: !!batchRequestId, hasValidTime: !isNaN(entryTimeMillis), lineStart: line.substring(0, 50) }, "Skipping log entry (missing batchRequestId or invalid time)");
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

    // logger.info({ event: 'read_group_end', totalEntries, parsedEntries, batchRequestIdsFound: requestsData.size, parseErrors: parseErrorsCount }, 'Finished Phase 1');

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
    batchRequestIdFilter?: string
    // baseLoggerParam?: Logger // Renamed to avoid conflict with global baseLogger
): FilteredData => {
    // const logger = baseLoggerParam?.child({ function: 'filterRequests' }) || baseLogger.child({ function: 'filterRequests' });
    // logger.info({ event: 'filter_start', filterStartMillis, filterEndMillis, batchRequestIdFilter }, 'Starting: Filtering requests');

    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    if (batchRequestIdFilter) {
        // logger.info({ event: 'filter_mode_batchRequestId', targetRequestId: batchRequestIdFilter }, `Filtering for specific batchRequestId: ${batchRequestIdFilter}`);
        const requestInfo = allRequestsData.get(batchRequestIdFilter);
        if (requestInfo) {
            // Apply time filter only if one is active, otherwise include if batchRequestId matches
            const overlapsTimeFilter = (filterStartMillis === null && filterEndMillis === null) ||
                doesRequestOverlapFilter(
                    requestInfo.startTime,
                    requestInfo.endTime,
                    filterStartMillis,
                    filterEndMillis,
                    batchRequestIdFilter //, logger
                );

            if (overlapsTimeFilter) {
                filteredRequests.set(batchRequestIdFilter, requestInfo);
                analysisStartMillis = requestInfo.startTime;
                analysisEndMillis = requestInfo.endTime;
            } else {
                // logger.info({event: 'filter_batchRequestId_found_but_outside_time_filter', batchRequestIdFilter, reqStart: requestInfo.startTime, reqEnd: requestInfo.endTime}, "RequestId found but outside specified time filter.")
            }
        } else {
            // logger.warn({ event: 'filter_batchRequestId_not_found', targetRequestId: batchRequestIdFilter }, `Specified batchRequestId for filtering not found.`);
        }
    } else {
        // logger.info({ event: 'filter_mode_time_range' }, `Filtering by time range for all requests.`);
        for (const [batchRequestId, requestInfo] of allRequestsData.entries()) {
            const includeRequest = doesRequestOverlapFilter(
                requestInfo.startTime,
                requestInfo.endTime,
                filterStartMillis,
                filterEndMillis,
                batchRequestId //, logger
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

    // logger.info({ event: 'filter_end', totalRequestsOriginal: allRequestsData.size, includedRequestsCount: filteredRequests.size, finalAnalysisStartMillis: analysisStartMillis, finalAnalysisEndMillis: analysisEndMillis }, 'Finished: Filtering requests');
    return { filteredRequests, analysisStartMillis, analysisEndMillis };
};

// --- Step 3: processLogEntry ---
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }
    // baseLoggerForEntry?: Logger // Renamed to avoid conflict
): void => {
    const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
    const entryTimestampISO = !isNaN(entryTimeMillis) ? new Date(entryTimeMillis).toISOString() : new Date().toISOString() + '_INVALID_TIME';
    // const entrySpecificLogger = baseLoggerForEntry?.child({ event: logEntry.event, time: entryTimestampISO }) || baseLogger.child({ event: logEntry.event, time: entryTimestampISO });

    if (typeof logEntry.level === 'number') {
        if (logEntry.level >= 50) results.errorLogCount++; // pino: error, fatal
        if (logEntry.level >= 60) results.fatalLogCount++; // pino: fatal
    }

    const eventName = logEntry.event as string | undefined;
    const contextFields = logEntry.context || {};
    const acronym = contextFields.acronym || contextFields.conferenceAcronym || logEntry.acronym || logEntry.conferenceAcronym;
    const title = contextFields.title || contextFields.conferenceTitle || logEntry.title || logEntry.conferenceTitle;
    const currentRequestId = logEntry.batchRequestId; // This is the batchRequestId from the log entry

    // The `batchRequestId` field in `ConferenceAnalysisDetail` should store this `currentRequestId`.
    // `createConferenceKey` uses `currentRequestId` to form the unique key.
    const compositeKey = createConferenceKey(currentRequestId, acronym, title);
    let confDetail: ConferenceAnalysisDetail | null = null;

    if (compositeKey) {
        if (!results.conferenceAnalysis[compositeKey]) {
            // `initializeConferenceDetail` should correctly set `detail.batchRequestId = currentRequestId`
            // (assuming its `batchRequestId` parameter maps to `detail.batchRequestId` field).
            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(currentRequestId, acronym!, title!);
            // entrySpecificLogger.trace({ compositeKey, batchRequestId: currentRequestId }, 'Initialized new conference detail');
        }
        confDetail = results.conferenceAnalysis[compositeKey];
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    } else if (acronym && (eventName?.startsWith('task_') || eventName?.includes('conference') || eventName?.includes('gemini') || eventName?.includes('save_') || eventName?.includes('csv_'))) {
        // entrySpecificLogger.warn({ logEvent: eventName, acronym, batchRequestId: currentRequestId }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
    } else if (eventName && !compositeKey && !acronym) {
        // entrySpecificLogger.trace({ logEvent: eventName, batchRequestId: currentRequestId }, 'Log entry event without acronym or title.');
    }

    if (eventName && eventHandlerMap[eventName]) {
        const handler = eventHandlerMap[eventName];
        try {
            // Handler updates results and confDetail
            handler(logEntry, results, confDetail, entryTimestampISO);
        } catch (handlerError: any) {
            // entrySpecificLogger.error({ err: handlerError, eventName, batchRequestId: currentRequestId, confAcronym: confDetail?.acronym }, `Error executing handler for event: ${eventName}`);
            if (confDetail) {
                addConferenceError(confDetail, entryTimestampISO, handlerError, `Internal error processing event ${eventName}`);
            }
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on batchRequestId '${currentRequestId}': ${handlerError.message}`);
        }
    } else if (eventName) {
        // entrySpecificLogger.trace({ eventName, batchRequestId: currentRequestId }, `No specific handler registered for event: ${eventName}`);
    }
};


// --- Step 4: calculateFinalMetrics ---
export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData>
    // baseLoggerParam?: Logger // Renamed
): void => {
    // const logger = baseLoggerParam?.child({ function: 'calculateFinalMetrics' }) || baseLogger.child({ function: 'calculateFinalMetrics' });
    // logger.info({ event: 'final_calc_start' }, "Performing final calculations on analyzed data");

    // --- Calculate Overall Duration (for the set of analyzed requests) ---
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.conferenceAnalysis).length > 0) {
        let minConfStart: number | null = null;
        let maxConfEnd: number | null = null;
        Object.values(results.conferenceAnalysis).forEach(detail => {
            const detailEndTimeMillis = detail.endTime ? new Date(detail.endTime).getTime() : null;
            // Use detail.batchRequestId here as it should hold the batchRequestId for that conference task
            const confKeyForTimestamp = createConferenceKey(detail.batchRequestId, detail.acronym, detail.title);
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

    // --- Populate Per-Request Timings AND STATUS ---
    // results.analyzedRequestIds should have been populated by LogAnalysisService from filteredRequests.keys()
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        let currentRequestTimings: RequestTimings = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            status: 'Unknown', // Default status
        };

        if (requestData && requestData.startTime !== null && requestData.endTime !== null) {
            currentRequestTimings.startTime = new Date(requestData.startTime).toISOString();
            currentRequestTimings.endTime = new Date(requestData.endTime).toISOString();
            currentRequestTimings.durationSeconds = Math.round((requestData.endTime - requestData.startTime) / 1000);
        } else if (requestData) { // startTime or endTime might be null if request had only one log entry
            currentRequestTimings.startTime = requestData.startTime ? new Date(requestData.startTime).toISOString() : null;
            currentRequestTimings.endTime = requestData.endTime ? new Date(requestData.endTime).toISOString() : null;
            // durationSeconds remains null or 0 if only one timestamp; prefer null for partial data
            currentRequestTimings.durationSeconds = (requestData.startTime && requestData.endTime) ? Math.round((requestData.endTime - requestData.startTime) / 1000) : null;
            if (currentRequestTimings.durationSeconds === null && (requestData.startTime || requestData.endTime)) {
                 currentRequestTimings.durationSeconds = 0; // If only one time, duration is 0
            }
        }
        // else: requestData is undefined, timings remain null, status 'Unknown' initially

        // Determine status for this reqId
        // `cd.batchRequestId` refers to the `batchRequestId` stored within the ConferenceAnalysisDetail
        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        if (conferencesForThisRequest.length === 0) {
            // If no conference tasks, base status on whether logs existed for this request ID.
            if (requestData && Array.isArray(requestData.logs) && requestData.logs.length > 0) {
                currentRequestTimings.status = 'Completed'; // Request had logs but no tasks, assume it ran and completed.
            } else {
                currentRequestTimings.status = 'Unknown';
            }
        } else {
            let isProcessing = false;
            let hasFailed = false;
            let allCompletedOrSkipped = true;

            for (const conf of conferencesForThisRequest) {
                if (conf.status === 'processing' || ((conf.status === 'unknown' || conf.status === 'processed_ok') && !conf.endTime)) {
                    isProcessing = true;
                    // If any task is actively processing, the overall request is processing.
                    // No need to check further for this loop if `isProcessing` is the highest priority.
                    break;
                }
                if (conf.status === 'failed') {
                    hasFailed = true;
                }
                if (conf.status !== 'completed' && conf.status !== 'skipped') {
                    allCompletedOrSkipped = false;
                }
            }

            if (isProcessing) {
                currentRequestTimings.status = 'Processing';
            } else if (hasFailed) {
                // If not processing, but at least one task failed, the request is considered Failed.
                // This covers scenarios where some tasks might have completed, but one or more failed.
                currentRequestTimings.status = 'Failed';
            } else if (allCompletedOrSkipped) {
                // If not processing and no tasks failed, and all tasks are either completed or skipped.
                currentRequestTimings.status = 'Completed';
            }
            // Add 'PartiallyCompleted' if needed:
            // else if (conferencesForThisRequest.some(c => c.status === 'completed') && !allCompletedOrSkipped && !hasFailed && !isProcessing) {
            //    currentRequestTimings.status = 'PartiallyCompleted';
            // }
            else {
                // Catch-all for other states (e.g., all 'unknown' with endTimes, mix of 'unknown' and 'processed_ok' with endTimes)
                currentRequestTimings.status = 'Unknown';
            }
        }
        results.requests[reqId] = currentRequestTimings;
    }

     // --- Finalize Conference Details and Counts ---
    let stillProcessingOverallCount = 0;
    const processedCompositeKeys = Object.keys(results.conferenceAnalysis);

    processedCompositeKeys.forEach(key => {
        const detail = results.conferenceAnalysis[key];

        if (!detail.durationSeconds && detail.startTime && detail.endTime) {
            try {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis) && endMillis >= startMillis) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                } else {
                    detail.durationSeconds = 0;
                }
            } catch (e) {
                detail.durationSeconds = 0;
            }
        }

        if (detail.status === 'processing' ||
            ((detail.status === 'unknown' || detail.status === 'processed_ok') && !detail.endTime)) {
            stillProcessingOverallCount++;
        }
    });
    results.overall.processingTasks = stillProcessingOverallCount;

    if (results.geminiApi) {
        results.geminiApi.cacheContextMisses = Math.max(0, (results.geminiApi.cacheContextAttempts || 0) - (results.geminiApi.cacheContextHits || 0));
    }

    // --- CSV Failure Impact on Conference Tasks and their Parent Requests ---
    if (results.fileOutput && results.fileOutput.csvFileGenerated === false &&
        (results.fileOutput.csvPipelineFailures > 0)) {

        Object.values(results.conferenceAnalysis).forEach(detail => {
            // Capture the status *before* deciding to change it.
            const oldStatus = detail.status; // Type: 'unknown' | 'processing' | 'processed_ok' | 'completed' | 'failed' | 'skipped'

            // Condition for a task to be affected by CSV failure:
            // 1. Its JSONL was successfully written (meaning it got to that stage).
            // 2. It's not already in a 'failed' or 'skipped' state (those are terminal for other reasons).
            if (detail.jsonlWriteSuccess === true &&
                oldStatus !== 'failed' &&
                oldStatus !== 'skipped') {

                // Now that we are inside, if oldStatus was 'completed', 'processed_ok', 'processing', or 'unknown',
                // we mark it as 'failed' due to the CSV issue.
                detail.status = 'failed';
                detail.csvWriteSuccess = false;

                if (!detail.endTime) {
                    const confKeyForTimestamp = createConferenceKey(detail.batchRequestId, detail.acronym, detail.title);
                    const lastTimestamp = confKeyForTimestamp ? conferenceLastTimestamp[confKeyForTimestamp] : null;
                    detail.endTime = lastTimestamp ? new Date(lastTimestamp).toISOString() : (results.overall.endTime || new Date().toISOString());
                }
                addConferenceError(detail, detail.endTime!, "CSV generation pipeline failed for this conference.", "csv_pipeline_failure_conf");

                // Adjust overall counts based on the oldStatus
                if (oldStatus === 'completed') {
                    results.overall.completedTasks = Math.max(0, (results.overall.completedTasks || 0) - 1);
                } else if (oldStatus === 'processing' || oldStatus === 'unknown' || oldStatus === 'processed_ok') {
                    // If it was contributing to processingTasks, it's no longer doing so.
                    // This will be reflected when processingTasks is recalculated.
                    // No direct decrement here as `stillProcessingOverallCount` is calculated based on current statuses.
                }
                // Increment failed tasks regardless of its previous state (unless it was already failed/skipped)
                results.overall.failedOrCrashedTasks = (results.overall.failedOrCrashedTasks || 0) + 1;


                const affectedReqId = detail.batchRequestId;
                if (results.requests[affectedReqId] && results.requests[affectedReqId].status !== 'Failed') {
                    results.requests[affectedReqId].status = 'Failed';
                }
            }
        });

        // Recalculate processingTasks for overall summary after potential status changes due to CSV failure
        let newStillProcessingCountAfterCsv = 0;
        Object.values(results.conferenceAnalysis).forEach(d => {
            if ((d.status === 'processing' || ((d.status === 'unknown' || d.status === 'processed_ok') && !d.endTime))) {
                newStillProcessingCountAfterCsv++;
            }
        });
        results.overall.processingTasks = newStillProcessingCountAfterCsv;
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