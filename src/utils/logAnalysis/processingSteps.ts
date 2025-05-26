// src/utils/logAnalysis/processingSteps.ts
import {
    LogAnalysisResult,
    ConferenceAnalysisDetail,
    RequestLogData,
    RequestTimings,
} from '../../types/logAnalysis';
import {
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError,

} from './helpers';
import { normalizeErrorKey } from './helpers';
import { eventHandlerMap } from './index';


// --- processLogEntry giữ nguyên ---
export const processLogEntry = (
    logEntry: any,
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }
): void => {
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
            // Khi conference được khởi tạo lần đầu, nếu nó thuộc request đang được phân tích,
            // thì tăng processedConferencesCount.
            // Cần đảm bảo results.analyzedRequestIds đã được điền trước khi processLogEntry chạy,
            // hoặc kiểm tra này phải được thực hiện ở nơi khác (ví dụ: cuối calculateFinalMetrics).
            // Hiện tại, overall.processedConferencesCount được cập nhật trong handleTaskStart
            // và calculateFinalMetrics (STAGE 3) sẽ đếm lại chính xác.
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
                addConferenceError(
                    confDetail,
                    entryTimestampISO,
                    handlerError,
                    {
                        defaultMessage: `Internal error processing event ${eventName}`,
                        keyPrefix: 'handler_internal_error',
                        sourceService: 'LogAnalysisProcessor',
                        errorType: 'Logic',
                        context: {
                            phase: 'response_processing',
                            eventName: eventName,
                            ...logEntry.context
                        }
                    }
                );
            }
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on batchRequestId '${currentRequestId}': ${handlerError.message}`);
        }
    }
};


export const calculateFinalMetrics = (
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData>
): void => {

    // STAGE 0: Calculate Overall Start/End Time.
    // Duration will be recalculated later based on sum of request durations.
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        // Initial duration based on overall span, will be overwritten
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
            // Initial duration based on conference span, will be overwritten
            results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
        } else {
            results.overall.durationSeconds = 0;
        }
    } else {
        results.overall.durationSeconds = 0; // Default if no other info
    }


    // --- STAGE 1: Determine/Update status for each conference (stuck tasks) and then initialize request timings ---
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        let currentRequestTimings: RequestTimings = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            status: 'Unknown',
            originalRequestId: results.requests[reqId]?.originalRequestId,
            csvOutputStreamFailed: false,
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
            const requestEndTimeMillis = new Date(requestEndTimeISO).getTime();

            conferencesForThisRequest.forEach(conf => {
                if (!conf.endTime && (conf.status === 'processing' || conf.status === 'processed_ok')) {
                    const confKeyForTimestamp = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
                    const lastLogTimeForThisConferenceMillis = confKeyForTimestamp ? conferenceLastTimestamp[confKeyForTimestamp] : null;
                    const confStartTimeMillis = conf.startTime ? new Date(conf.startTime).getTime() : null;

                    let isConsideredStuck = true;

                    if (lastLogTimeForThisConferenceMillis !== null) {
                        if (confStartTimeMillis !== null && lastLogTimeForThisConferenceMillis <= confStartTimeMillis) {
                            isConsideredStuck = false;
                        } else {
                            const MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS = 3000;
                            if ((requestEndTimeMillis - lastLogTimeForThisConferenceMillis) < MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS) {
                                isConsideredStuck = false;
                            }
                        }
                    }

                    if (isConsideredStuck) {
                        conf.status = 'failed';
                        let failureTimestampMillis = requestEndTimeMillis;
                        if (lastLogTimeForThisConferenceMillis !== null) {
                            failureTimestampMillis = Math.max(failureTimestampMillis, lastLogTimeForThisConferenceMillis);
                        }
                        conf.endTime = new Date(failureTimestampMillis).toISOString();

                        addConferenceError(
                            conf,
                            conf.endTime,
                            "Conference did not complete (stuck in processing/processed_ok) before its parent request finished.",
                            {
                                defaultMessage: "Conference task considered stuck or incomplete as parent request ended.",
                                keyPrefix: 'task_stuck_or_incomplete',
                                sourceService: 'FinalMetricsCalculation',
                                errorType: 'Logic',
                                context: {
                                    phase: 'response_processing',
                                    stuckReason: "Parent request ended while task active. Task had prior activity but no final status log.",
                                    conferenceStartTime: conf.startTime,
                                    conferenceLastSeenLogTime: lastLogTimeForThisConferenceMillis ? new Date(lastLogTimeForThisConferenceMillis).toISOString() : null,
                                    parentRequestEndTime: requestEndTimeISO,
                                    timeDiffLastConfLogAndReqEndMs: lastLogTimeForThisConferenceMillis ? (requestEndTimeMillis - lastLogTimeForThisConferenceMillis) : null
                                }
                            }
                        );
                    }
                }
            });
        }
        results.requests[reqId] = {
            ...(results.requests[reqId] || {}),
            startTime: currentRequestTimings.startTime,
            endTime: currentRequestTimings.endTime,
            durationSeconds: currentRequestTimings.durationSeconds,
            originalRequestId: currentRequestTimings.originalRequestId,
            // csvOutputStreamFailed will be set by handleCsvProcessingEvent if needed
            // status, totalConferencesInputForRequest and processedConferencesCountForRequest will be updated in STAGE 3
        };
    }

    // --- NEW: RECALCULATE OVERALL DURATION BASED ON SUM OF ANALYZED REQUEST DURATIONS ---
    // This overwrites the initial overall.durationSeconds calculated in STAGE 0.
    // This must be done *after* individual request durations are calculated and stored in STAGE 1.
    let summedRequestDurations = 0;
    for (const reqId of results.analyzedRequestIds) {
        const requestTimings = results.requests[reqId];
        if (requestTimings && typeof requestTimings.durationSeconds === 'number') {
            summedRequestDurations += requestTimings.durationSeconds;
        }
    }
    results.overall.durationSeconds = summedRequestDurations;
    // --- END NEW SECTION ---


    // --- STAGE 2: Finalize Conference Details (duration, status based on sub-steps, and request-level CSV failures) ---
    Object.values(results.conferenceAnalysis).forEach(detail => {
        if (!results.analyzedRequestIds.includes(detail.batchRequestId)) {
            return;
        }

        let isCriticallyFailedInternally = false;
        let criticalFailureReason = "";
        let criticalFailureEventKey = "";

        if (detail.steps) {
            if (detail.steps.gemini_extract_attempted && detail.steps.gemini_extract_success === false) {
                isCriticallyFailedInternally = true;
                criticalFailureReason = "Gemini extract failed";
                criticalFailureEventKey = "gemini_extract_failed";
            }

            if (!isCriticallyFailedInternally &&
                detail.steps.link_processing_attempted_count > 0 &&
                detail.steps.link_processing_success_count === 0 &&
                detail.status !== 'failed' && detail.status !== 'skipped') {
                isCriticallyFailedInternally = true;
                criticalFailureReason = "All link processing attempts failed";
                criticalFailureEventKey = "all_links_failed";
            }
        }

        if (isCriticallyFailedInternally && detail.status !== 'failed' && detail.status !== 'skipped') {
            const oldStatus = detail.status;
            detail.status = 'failed';

            const failureTimestamp = detail.endTime ||
                (results.requests[detail.batchRequestId]?.endTime) ||
                results.overall.endTime ||
                new Date().toISOString();

            if (!detail.endTime || (detail.endTime && new Date(failureTimestamp).getTime() > new Date(detail.endTime).getTime())) {
                detail.endTime = failureTimestamp;
            }

            addConferenceError(
                detail,
                failureTimestamp,
                `Task marked as failed in final metrics due to: ${criticalFailureReason}.`,
                {
                    defaultMessage: `Conference task status overridden to failed. Original status: ${oldStatus}.`,
                    keyPrefix: `final_metric_override_${normalizeErrorKey(criticalFailureEventKey)}`,
                    sourceService: 'FinalMetricsCalculation',
                    errorType: 'Logic',
                    context: {
                        phase: 'response_processing',
                        reason: criticalFailureReason,
                        originalStatus: oldStatus,
                        eventKey: criticalFailureEventKey
                    }
                }
            );
        }

        const requestInfo = results.requests[detail.batchRequestId]; // Changed from requestData to requestInfo for clarity
        if (requestInfo && requestInfo.csvOutputStreamFailed === true) {
            if (detail.csvWriteSuccess !== true && detail.status !== 'failed' && detail.status !== 'skipped') {
                const oldConfStatus = detail.status;
                detail.status = 'failed';
                detail.csvWriteSuccess = false;

                const csvFailureTimestamp = detail.endTime ||
                    requestInfo.endTime ||
                    results.overall.endTime ||
                    new Date().toISOString();

                if (!detail.endTime || (detail.endTime && new Date(csvFailureTimestamp).getTime() > new Date(detail.endTime).getTime())) {
                    detail.endTime = csvFailureTimestamp;
                }

                addConferenceError(
                    detail,
                    csvFailureTimestamp,
                    `Conference failed due to CSV output stream failure for its parent request (ID: ${detail.batchRequestId}).`,
                    {
                        defaultMessage: "CSV output stream failed for the request this conference belongs to.",
                        keyPrefix: "request_csv_stream_failure_override_conf",
                        sourceService: 'FinalMetricsCalculation',
                        errorType: 'FileSystem',
                        context: {
                            phase: 'response_processing',
                            csvErrorSource: "request_output_stream",
                            originalStatus: oldConfStatus,
                            parentRequestId: detail.batchRequestId
                        }
                    }
                );
            } else if (detail.status === 'failed' && detail.csvWriteSuccess !== false) {
                detail.csvWriteSuccess = false;
            }
        }

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
    });


    // --- STAGE 3: Recalculate Overall Counts & Update Request Statuses AND Conference Counts ---
    results.overall.completedTasks = 0;
    results.overall.failedOrCrashedTasks = 0;
    results.overall.skippedTasks = 0;
    results.overall.processingTasks = 0;

    const uniqueConferenceKeysInAnalysis = new Set<string>();

    Object.values(results.conferenceAnalysis).forEach(conf => {
        if (results.analyzedRequestIds.includes(conf.batchRequestId)) {
            const confKey = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
            if (confKey) uniqueConferenceKeysInAnalysis.add(confKey);

            if (conf.status === 'completed') {
                results.overall.completedTasks++;
            } else if (conf.status === 'failed') {
                results.overall.failedOrCrashedTasks++;
            } else if (conf.status === 'skipped') {
                results.overall.skippedTasks++;
            } else if (conf.status === 'processing' || conf.status === 'processed_ok') {
                results.overall.processingTasks++;
            }
        }
    });
    results.overall.processedConferencesCount = uniqueConferenceKeysInAnalysis.size;


    for (const reqId of results.analyzedRequestIds) {
        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        const requestTimings = results.requests[reqId];
        if (!requestTimings) continue;

        let currentReqProcessedConferences = 0;
        let currentReqTotalInputConferences = 0;

        let numProcessing = 0, numFailed = 0, numCompleted = 0, numSkipped = 0, numProcessedOk = 0;

        for (const conf of conferencesForThisRequest) {
            currentReqTotalInputConferences++;
            if (conf.status === 'completed') {
                numCompleted++;
                currentReqProcessedConferences++;
            } else if (conf.status === 'processed_ok') {
                numProcessedOk++;
                currentReqProcessedConferences++;
            } else if (conf.status === 'processing') {
                numProcessing++;
            } else if (conf.status === 'failed') {
                numFailed++;
            } else if (conf.status === 'skipped') {
                numSkipped++;
            }
        }

        requestTimings.totalConferencesInputForRequest = currentReqTotalInputConferences;
        requestTimings.processedConferencesCountForRequest = currentReqProcessedConferences;

        if (conferencesForThisRequest.length === 0) {
            const requestDataFromFiltered = filteredRequestsData.get(reqId); // Renamed to avoid conflict
            if (requestDataFromFiltered && Array.isArray(requestDataFromFiltered.logs) && requestDataFromFiltered.logs.length > 0) {
                requestTimings.status = 'Completed';
            } else {
                requestTimings.status = 'NoData';
            }
        } else {
            const totalTasksInRequest = conferencesForThisRequest.length;
            const FAILED_THRESHOLD_PERCENT = 0.15;

            if (numProcessing > 0 || numProcessedOk > 0) {
                requestTimings.status = 'Processing';
            } else {
                if (numFailed === totalTasksInRequest) {
                    requestTimings.status = 'Failed';
                } else if (numFailed > 0) {
                    if ((numFailed / totalTasksInRequest) > FAILED_THRESHOLD_PERCENT) {
                        requestTimings.status = 'CompletedWithErrors';
                    } else {
                        if ((numCompleted + numSkipped) === (totalTasksInRequest - numFailed)) { // numProcessedOk is 0 here
                            requestTimings.status = 'Completed';
                        } else {
                            requestTimings.status = 'CompletedWithErrors';
                        }
                    }
                } else if (numCompleted === totalTasksInRequest || (numCompleted + numSkipped) === totalTasksInRequest && totalTasksInRequest > 0) { // numProcessedOk is 0 here
                    requestTimings.status = 'Completed';
                } else if (numSkipped === totalTasksInRequest && totalTasksInRequest > 0) {
                    requestTimings.status = 'Skipped';
                } else if (numCompleted > 0 || numSkipped > 0) { // numProcessedOk is 0 here
                    requestTimings.status = 'PartiallyCompleted';
                } else {
                    requestTimings.status = 'Unknown';
                }
            }
        }
    }


    if (results.geminiApi) {
        results.geminiApi.cacheContextMisses = Math.max(0, (results.geminiApi.cacheContextAttempts || 0) - (results.geminiApi.cacheContextHits || 0));
    }

    // --- STAGE 4: Determine final overall analysis status (Dựa trên request statuses đã chốt) ---
    if (results.analyzedRequestIds.length > 0) {
        const requestStatuses = results.analyzedRequestIds.map(id => results.requests[id]?.status);

        if (requestStatuses.some(s => s === 'Processing')) {
            results.status = 'Processing';
        } else if (requestStatuses.every(s => s === 'Failed')) {
            results.status = 'Failed';
        } else if (requestStatuses.some(s => s === 'Failed' || s === 'CompletedWithErrors')) {
            results.status = 'CompletedWithErrors';
        } else if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'PartiallyCompleted' || s === 'NoData' || s === 'Unknown')) {
            if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'NoData')) {
                results.status = 'Completed';
            } else if (requestStatuses.some(s => s === 'PartiallyCompleted')) {
                results.status = 'PartiallyCompleted';
            } else if (requestStatuses.some(s => s === 'Unknown') && !requestStatuses.some(s => s === 'Completed' || s === 'Skipped' || s === 'PartiallyCompleted')) {
                results.status = 'Unknown';
            }
            else {
                results.status = 'Completed';
            }
        } else {
            results.status = 'Unknown';
        }
    } else {
        results.status = "NoRequestsAnalyzed";
    }
};