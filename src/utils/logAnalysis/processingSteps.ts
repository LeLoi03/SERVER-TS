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
} from '../../types/logAnalysis.types'; // Đảm bảo các type này chính xác
import {
    createConferenceKey,
    initializeConferenceDetail, // Giả sử hàm này có logic đúng
    addConferenceError,
    doesRequestOverlapFilter
} from './helpers'; // Giả sử helpers đúng

import { eventHandlerMap } from './index'; // Giả sử index.ts exports eventHandlerMap

// --- Step 1: readAndGroupLogs --- (Giữ nguyên như bạn cung cấp)
export const readAndGroupLogs = async (logFilePath: string): Promise<ReadLogResult> => {
    // ... (code của bạn) ...
    const requestsData = new Map<string, RequestLogData>();
    let totalEntries = 0;
    let parsedEntries = 0;
    let parseErrorsCount = 0;
    const tempLogProcessingErrors: string[] = [];

    if (!fs.existsSync(logFilePath)) {
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
                const batchRequestId = logEntry.batchRequestId;

                if (batchRequestId && typeof batchRequestId === 'string' && !isNaN(entryTimeMillis)) {
                    if (!requestsData.has(batchRequestId)) {
                        requestsData.set(batchRequestId, { logs: [], startTime: null, endTime: null });
                    }
                    const requestInfo = requestsData.get(batchRequestId)!;
                    requestInfo.logs.push(logEntry);

                    // Ensure startTime and endTime are numbers before Math.min/max
                    const currentStartTime = requestInfo.startTime;
                    const currentEndTime = requestInfo.endTime;

                    requestInfo.startTime = (currentStartTime === null || isNaN(currentStartTime))
                        ? entryTimeMillis
                        : Math.min(entryTimeMillis, currentStartTime);

                    requestInfo.endTime = (currentEndTime === null || isNaN(currentEndTime))
                        ? entryTimeMillis
                        : Math.max(entryTimeMillis, currentEndTime);

                }
            } catch (parseError: any) {
                parseErrorsCount++;
                const errorMsg = `Line ${totalEntries}: ${parseError.message}`;
                tempLogProcessingErrors.push(errorMsg);
            }
        }
    } catch (readError: any) {
        throw readError;
    }

    return {
        requestsData,
        totalEntries,
        parsedEntries,
        parseErrors: parseErrorsCount,
        logProcessingErrors: tempLogProcessingErrors,
    };
};

// --- Step 2: filterRequests --- (Giữ nguyên như bạn cung cấp)
export const filterRequests = (
    allRequestsData: Map<string, RequestLogData>,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    batchRequestIdFilter?: string
): FilteredData => {
    // ... (code của bạn) ...
    const filteredRequests = new Map<string, RequestLogData>();
    let analysisStartMillis: number | null = null;
    let analysisEndMillis: number | null = null;

    if (batchRequestIdFilter) {
        const requestInfo = allRequestsData.get(batchRequestIdFilter);
        if (requestInfo && requestInfo.startTime !== null && requestInfo.endTime !== null) { // Check for non-null times
            const overlapsTimeFilter = (filterStartMillis === null && filterEndMillis === null) ||
                doesRequestOverlapFilter(
                    requestInfo.startTime,
                    requestInfo.endTime,
                    filterStartMillis,
                    filterEndMillis,
                    batchRequestIdFilter
                );

            if (overlapsTimeFilter) {
                filteredRequests.set(batchRequestIdFilter, requestInfo);
                analysisStartMillis = requestInfo.startTime;
                analysisEndMillis = requestInfo.endTime;
            }
        }
    } else {
        for (const [batchRequestId, requestInfo] of allRequestsData.entries()) {
            if (requestInfo.startTime !== null && requestInfo.endTime !== null) { // Check for non-null times
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

// --- Step 3: processLogEntry --- (Giữ nguyên như bạn cung cấp)
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }
): void => {
    // ... (code của bạn) ...
    const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
    const entryTimestampISO = !isNaN(entryTimeMillis) ? new Date(entryTimeMillis).toISOString() : new Date().toISOString() + '_INVALID_TIME';

    if (typeof logEntry.level === 'number') {
        if (logEntry.level >= 50) results.errorLogCount++;
        if (logEntry.level >= 60) results.fatalLogCount++;
    }

    const eventName = logEntry.event as string | undefined;
    const contextFields = logEntry.context || {};
    const acronym = contextFields.acronym || contextFields.conferenceAcronym || logEntry.acronym || logEntry.conferenceAcronym;
    const title = contextFields.title || contextFields.conferenceTitle || logEntry.title || logEntry.conferenceTitle;
    const currentRequestId = logEntry.batchRequestId;

    const compositeKey = createConferenceKey(currentRequestId, acronym, title);
    let confDetail: ConferenceAnalysisDetail | null = null;

    if (compositeKey) {
        if (!results.conferenceAnalysis[compositeKey]) {
            results.conferenceAnalysis[compositeKey] = initializeConferenceDetail(currentRequestId, acronym!, title!);
        }
        confDetail = results.conferenceAnalysis[compositeKey];
        if (!isNaN(entryTimeMillis)) {
            conferenceLastTimestamp[compositeKey] = Math.max(entryTimeMillis, conferenceLastTimestamp[compositeKey] ?? 0);
        }
    }

    if (eventName && eventHandlerMap[eventName]) {
        const handler = eventHandlerMap[eventName];
        try {
            handler(logEntry, results, confDetail, entryTimestampISO);
        } catch (handlerError: any) {
            if (confDetail) {
                addConferenceError(confDetail, entryTimestampISO, handlerError, `Internal error processing event ${eventName}`);
            }
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on batchRequestId '${currentRequestId}': ${handlerError.message}`);
        }
    }
};

// --- Step 4: calculateFinalMetrics --- (Cập nhật theo Phương án 3)
export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData>
): void => {

    // STAGE 0: Calculate Overall Duration
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.conferenceAnalysis).length > 0) {
        let minConfStart: number | null = null;
        let maxConfEnd: number | null = null;
        Object.values(results.conferenceAnalysis).forEach(detail => {
            const detailEndTimeMillis = detail.endTime ? new Date(detail.endTime).getTime() : null;
            const confKeyForOverallTimestamp = createConferenceKey(detail.batchRequestId, detail.acronym, detail.title);
            const lastSeenTimeForOverall = confKeyForOverallTimestamp ? conferenceLastTimestamp[confKeyForOverallTimestamp] ?? null : null;
            const consideredEndTime = detailEndTimeMillis ?? ((detail.status === 'completed' || detail.status === 'failed' || detail.status === 'skipped') ? lastSeenTimeForOverall : null);

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


    // --- STAGE 1: Determine/Update status for each conference and then for each request ---
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        let currentRequestTimings: RequestTimings = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            status: 'Unknown',
            originalRequestId: results.requests[reqId]?.originalRequestId,
        };

        if (requestData && requestData.startTime !== null && requestData.endTime !== null) {
            currentRequestTimings.startTime = new Date(requestData.startTime).toISOString();
            currentRequestTimings.endTime = new Date(requestData.endTime).toISOString();
            currentRequestTimings.durationSeconds = Math.round((requestData.endTime - requestData.startTime) / 1000);
        } else if (requestData) {
            currentRequestTimings.startTime = requestData.startTime ? new Date(requestData.startTime).toISOString() : null;
            currentRequestTimings.endTime = requestData.endTime ? new Date(requestData.endTime).toISOString() : null;
            currentRequestTimings.durationSeconds = (requestData.startTime && requestData.endTime) ? Math.round((requestData.endTime - requestData.startTime) / 1000) : (requestData.startTime || requestData.endTime ? 0 : null);
        }

        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        if (conferencesForThisRequest.length > 0 && !currentRequestTimings.originalRequestId) {
            for (const conf of conferencesForThisRequest) {
                if (conf.originalRequestId) {
                    currentRequestTimings.originalRequestId = conf.originalRequestId;
                    break;
                }
                if (!currentRequestTimings.originalRequestId && conf.finalResult?.originalRequestId) {
                    currentRequestTimings.originalRequestId = conf.finalResult.originalRequestId;
                }
            }
        }

        const requestEndTimeISO = currentRequestTimings.endTime;
        if (requestEndTimeISO) {
            conferencesForThisRequest.forEach(conf => {
                if (!conf.endTime && (conf.status === 'processing' || conf.status === 'unknown' || conf.status === 'processed_ok')) {
                    conf.status = 'failed';
                    const confKeyForTimestampStuck = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
                    // FIX 1: Check for null key
                    const lastSeenTimeForConf = confKeyForTimestampStuck ? conferenceLastTimestamp[confKeyForTimestampStuck] : null;
                    conf.endTime = lastSeenTimeForConf ? new Date(lastSeenTimeForConf).toISOString() : requestEndTimeISO;
                    addConferenceError(conf, conf.endTime, "Conference did not complete before its parent request finished.", "task_stuck_or_incomplete", { stuckReason: "Parent request ended" });
                }
            });
        }

        if (conferencesForThisRequest.length === 0) {
            if (requestData && Array.isArray(requestData.logs) && requestData.logs.length > 0) {
                currentRequestTimings.status = 'Completed';
            } else {
                currentRequestTimings.status = 'NoData';
            }
        } else {
            let numProcessing = 0;
            let numFailed = 0;
            let numCompleted = 0;
            let numSkipped = 0;

            for (const conf of conferencesForThisRequest) {
                if (conf.status === 'processing' || ((conf.status === 'unknown' || conf.status === 'processed_ok') && !conf.endTime)) {
                    numProcessing++;
                }
                if (conf.status === 'failed') {
                    numFailed++;
                }
                if (conf.status === 'completed') {
                    numCompleted++;
                }
                if (conf.status === 'skipped') {
                    numSkipped++;
                }
            }

            const totalTasksInRequest = conferencesForThisRequest.length;

            if (numProcessing > 0) {
                currentRequestTimings.status = 'Processing';
            } else {
                if (numFailed === totalTasksInRequest && totalTasksInRequest > 0) { // Ensure not 0/0
                    currentRequestTimings.status = 'Failed';
                } else if (numFailed > 0) {
                    currentRequestTimings.status = 'CompletedWithErrors';
                } else if (numCompleted === totalTasksInRequest || (numCompleted + numSkipped) === totalTasksInRequest && totalTasksInRequest > 0) {
                    currentRequestTimings.status = 'Completed';
                } else if (numCompleted > 0 || numSkipped > 0) {
                    currentRequestTimings.status = 'PartiallyCompleted';
                } else if (totalTasksInRequest > 0 && numSkipped === totalTasksInRequest) {
                     currentRequestTimings.status = 'Skipped';
                }
                else {
                    currentRequestTimings.status = 'Unknown';
                }
            }
        }
        results.requests[reqId] = {
            ...(results.requests[reqId] || {}),
            ...currentRequestTimings
        };
    }

    // --- STAGE 2: Finalize Conference Details (duration, status if affected by CSV) ---
    Object.values(results.conferenceAnalysis).forEach(detail => {
        if (!detail.durationSeconds && detail.startTime && detail.endTime) {
            try {
                const startMillis = new Date(detail.startTime).getTime();
                const endMillis = new Date(detail.endTime).getTime();
                if (!isNaN(startMillis) && !isNaN(endMillis) && endMillis >= startMillis) {
                    detail.durationSeconds = Math.round((endMillis - startMillis) / 1000);
                } else {
                    detail.durationSeconds = 0;
                }
            } catch (e) { detail.durationSeconds = 0; }
        }
    });

    if (results.fileOutput &&
        results.fileOutput.csvFileGenerated === false &&
        (
            (results.fileOutput.csvPipelineFailures || 0) > 0 || // FIX 2: Handle undefined
            (results.fileOutput.csvOtherErrors || 0) > 0      // FIX 2: Handle undefined
        )
    ) {
        Object.values(results.conferenceAnalysis).forEach(detail => {
            if (!results.analyzedRequestIds.includes(detail.batchRequestId)) return;

            const oldConfStatus = detail.status;
            if (detail.jsonlWriteSuccess === true && oldConfStatus !== 'failed' && oldConfStatus !== 'skipped') {
                detail.status = 'failed';
                detail.csvWriteSuccess = false;

                if (!detail.endTime) {
                    const confKeyForTimestampCsv = createConferenceKey(detail.batchRequestId, detail.acronym, detail.title);
                    // FIX 1: Check for null key
                    const lastTimestamp = confKeyForTimestampCsv ? conferenceLastTimestamp[confKeyForTimestampCsv] : null;
                    detail.endTime = lastTimestamp ? new Date(lastTimestamp).toISOString() : (results.requests[detail.batchRequestId]?.endTime || results.overall.endTime || new Date().toISOString());
                }
                addConferenceError(detail, detail.endTime!, "CSV generation pipeline failed for this conference.", "csv_pipeline_failure_conf", { csvErrorSource: "pipeline_or_other" });

                const affectedReqId = detail.batchRequestId;
                if (results.requests[affectedReqId]) {
                    const currentReqStatus = results.requests[affectedReqId].status;
                    if (currentReqStatus !== 'Failed' && currentReqStatus !== 'CompletedWithErrors' && currentReqStatus !== 'Processing') {
                         results.requests[affectedReqId].status = 'CompletedWithErrors';
                    }
                }
            }
        });
    }

    // --- STAGE 3: Recalculate Overall Counts ---
    let finalOverallCompletedTasks = 0;
    let finalOverallFailedTasks = 0;
    let finalOverallSkippedTasks = 0;
    let finalOverallProcessingTasks = 0;
    const uniqueConferenceKeysInAnalysis = new Set<string>();

    Object.values(results.conferenceAnalysis).forEach(conf => {
        if (results.analyzedRequestIds.includes(conf.batchRequestId)) {
            const confKey = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
            if (confKey) uniqueConferenceKeysInAnalysis.add(confKey);

            if (conf.status === 'completed') {
                finalOverallCompletedTasks++;
            } else if (conf.status === 'failed') {
                finalOverallFailedTasks++;
            } else if (conf.status === 'skipped') {
                finalOverallSkippedTasks++;
            }

            if (conf.status === 'processing' || ((conf.status === 'unknown' || conf.status === 'processed_ok') && !conf.endTime)) {
                finalOverallProcessingTasks++;
            }
        }
    });

    results.overall.completedTasks = finalOverallCompletedTasks;
    results.overall.failedOrCrashedTasks = finalOverallFailedTasks;
    results.overall.skippedTasks = finalOverallSkippedTasks; // Đảm bảo đây là number
    results.overall.processingTasks = finalOverallProcessingTasks;
    results.overall.processedConferencesCount = uniqueConferenceKeysInAnalysis.size;

    if (results.geminiApi) {
        results.geminiApi.cacheContextMisses = Math.max(0, (results.geminiApi.cacheContextAttempts || 0) - (results.geminiApi.cacheContextHits || 0));
    }

    // --- STAGE 4: Determine final overall analysis status ---
    if (results.analyzedRequestIds.length > 0) {
        const requestStatuses = results.analyzedRequestIds.map(id => results.requests[id]?.status);

        if (requestStatuses.some(s => s === 'Processing')) {
            results.status = 'Processing';
        } else if (requestStatuses.every(s => s === 'Failed')) {
            results.status = 'Failed';
        } else if (requestStatuses.some(s => s === 'Failed' || s === 'CompletedWithErrors')) {
            results.status = 'CompletedWithErrors';
        } else if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'PartiallyCompleted' || s === 'NoData')) {
            if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'NoData')) {
                 results.status = 'Completed';
            } else if (requestStatuses.some(s => s === 'PartiallyCompleted')){ // Cần else if để tránh ghi đè Completed
                 results.status = 'PartiallyCompleted';
            } else { // Trường hợp này chỉ còn lại một số request là Completed, một số là Skipped
                 results.status = 'Completed'; // Vẫn có thể coi là completed nếu chỉ có completed và skipped
            }
        } else {
            results.status = 'Unknown';
        }
    } else {
        results.status = "NoRequestsAnalyzed";
    }
};