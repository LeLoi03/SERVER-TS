import fs from 'fs';
import readline from 'readline';
import { logger } from '../../conference/11_utils';
import { LogAnalysisResult, ConferenceAnalysisDetail, ReadLogResult, RequestLogData, FilteredData } from '../types/logAnalysis';
import {
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError,
    doesRequestOverlapFilter
} from './helpers';

import { eventHandlerMap } from './eventHandlers';



// --- Step 1: Read Log File and Group by Request ID ---
export const readAndGroupLogs = async (logFilePath: string): Promise<ReadLogResult> => {
    const logContext = { filePath: logFilePath, function: 'readAndGroupLogs' };
    logger.info({ ...logContext, event: 'read_group_start' }, 'Starting Phase 1: Reading and Grouping logs by requestId');

    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!fs.existsSync(logFilePath)) {
        logger.error({ ...logContext, event: 'read_group_error_file_not_found' }, 'Log file not found.');
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
                const entryTimeMillis = new Date(logEntry.time).getTime();
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
                    logger.trace({ event: 'read_group_skip_entry', lineNum: totalEntries, hasRequestId: !!requestId, hasValidTime: !isNaN(entryTimeMillis) }, "Skipping log entry (missing requestId or invalid time)");
                }

            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
                logger.warn({ event: 'read_group_parse_error', lineNum: totalEntries, err: parseError, originalLine: line.substring(0, 200) }, "Error parsing log line during phase 1");
            }
        }
    } catch (readError) {
        logger.error({ ...logContext, event: 'read_group_stream_error', err: readError }, 'Error reading log file stream');
        // Re-throw or handle as needed, maybe return partial results?
        throw readError; // Re-throw for now
    } finally {
        // Ensure stream is closed, though readline usually handles this
        fileStream.close();
    }


    logger.info({ ...logContext, event: 'read_group_end', totalEntries, parsedEntries, requestIdsFound: requestsData.size, parseErrors: parseErrorsCount }, 'Finished Phase 1');

    return {
        requestsData,
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};

// --- Step 2: Filter Requests by Time ---
export const filterRequestsByTime = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillis: number | null,
    filterEndMillis: number | null
): FilteredData => {
    const logContext = { function: 'filterRequestsByTime' };
    logger.info({ ...logContext, event: 'filter_start', filterStartMillis, filterEndMillis }, 'Starting Phase 2a: Filtering requests by time');

    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    for (const [requestId, requestInfo] of allRequestsData.entries()) {
        const includeRequest = doesRequestOverlapFilter(
            requestInfo.startTime,
            requestInfo.endTime,
            filterStartMillis,
            filterEndMillis,
            requestId
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

    logger.info({ ...logContext, event: 'filter_end', totalRequests: allRequestsData.size, includedRequests: filteredRequests.size, analysisStartMillis, analysisEndMillis }, 'Finished Phase 2a: Filtering requests');
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
 */

// --- processLogEntry (REFACTORED) ---
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    logContextBase: object
): void => {
    // --- Basic Log Entry Parsing ---
    const entryTimeMillis = new Date(logEntry.time).getTime();
    const entryTimestampISO = new Date(entryTimeMillis).toISOString();
    const logContext = { ...logContextBase, requestId: logEntry.requestId, event: logEntry.event, time: entryTimestampISO };

    // Update overall error counts
    if (logEntry.level >= 50) results.errorLogCount++; // ERROR
    if (logEntry.level >= 60) results.fatalLogCount++; // FATAL

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
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    } else if (acronym && (event?.startsWith('task_') || event?.includes('conference') || event?.includes('gemini') || event?.includes('save_') || event?.includes('csv_'))) {
        logger.warn({ ...logContext, event: 'analysis_missing_title_for_key', logEvent: event, acronym: acronym }, 'Log entry with acronym is missing title, cannot reliably track conference details.');
    }

    // ========================================================================
    // --- Event-Based Analysis Dispatcher --- <--- REPLACED SWITCH STATEMENT
    // ========================================================================
    const handler = eventHandlerMap[event]; // Find the handler function
    if (handler) {
        try {
            // Execute the specific handler
            handler(logEntry, results, confDetail, entryTimestampISO, logContext);
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
                addConferenceError(confDetail, entryTimestampISO, handlerError, `Internal error processing event ${event}`);
            }
            // Increment a general handler error counter if needed
            // results.overall.handlerErrors = (results.overall.handlerErrors || 0) + 1;
        }
    } else if (event) { // Only log if event exists but has no handler
        // Optional: Log events that don't have a specific handler
        // This can be noisy, consider logging at trace level or removing if not needed.
        logger.trace({ ...logContext, event: 'unhandled_log_event' }, `No specific handler registered for event: ${event}`);
    }
    // --- End of Dispatcher ---

}; // --- End of processLogEntry ---


export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }, // Still useful for debugging/potential future use
    analysisStartMillis: number | null,
    analysisEndMillis: number | null
): void => {
    const logContext = { function: 'calculateFinalMetrics' };
    logger.info({ ...logContext, event: 'final_calc_start' }, "Performing final calculations on analyzed data");

    // --- Calculate Overall Duration based on analyzed request range ---
    // (Keep existing logic for calculating results.overall start/end/duration based on analysisStart/EndMillis or fallback)
    if (analysisStartMillis && analysisEndMillis) {
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
            const lastSeenTime = conferenceLastTimestamp[createConferenceKey(detail.acronym, detail.title) ?? ''] ?? null;
            const consideredEndTime = detailEndTimeMillis ?? ((detail.status === 'completed' || detail.status === 'failed') ? lastSeenTime : null); // Only use lastSeen as fallback for terminal states

            if (detail.startTime) {
                const startMs = new Date(detail.startTime).getTime();
                if (!isNaN(startMs)) minConfStart = Math.min(startMs, minConfStart ?? startMs);
            }
            if (consideredEndTime && !isNaN(consideredEndTime)) {
                maxConfEnd = Math.max(consideredEndTime, maxConfEnd ?? consideredEndTime);
            }
        });
        if (minConfStart) results.overall.startTime = new Date(minConfStart).toISOString();
        if (maxConfEnd) results.overall.endTime = new Date(maxConfEnd).toISOString();
        if (minConfStart && maxConfEnd) {
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
            // Duration calculation for completed tasks
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
            // Duration calculation for failed tasks (if endTime was set by the failure event)
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
                processingCount++;
                // DO NOT set endTime or durationSeconds. Leave them null.
                // DO NOT change status to 'failed'.
                logger.trace({ ...logContext, event: 'final_calc_task_processing', compositeKey: key, status: detail.status }, 'Task considered still processing at end of analysis window.');
            } else {
                // Status is 'unknown' and no startTime - likely just initialized but never started processing within window. Ignore in counts.
                logger.trace({ ...logContext, event: 'final_calc_task_ignored_not_started', compositeKey: key }, 'Task ignored (initialized but not started within window).');
            }
        } else {
            // Should not happen with defined statuses
            logger.warn({ ...logContext, event: 'final_calc_unknown_status', compositeKey: key, status: detail.status }, 'Encountered unexpected final status for conference.');
        }

        // Count successful *extractions* independently
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

    logger.info({
        ...logContext,
        event: 'final_calc_end',
        completed: completionSuccessCount,
        failed: completionFailCount,
        processing: processingCount,
        processed: results.overall.processedConferencesCount
    }, "Finished final calculations.");
};