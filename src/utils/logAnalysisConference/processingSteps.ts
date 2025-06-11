// src/utils/logAnalysis/processingSteps.ts

import { ConferenceLogAnalysisResult, RequestLogData, ConferenceAnalysisDetail } from '../../types/logAnalysis';
import { createConferenceKey, initializeConferenceDetail, addConferenceError } from './helpers';
import { eventHandlerMap } from './index';
import { finalizeConference } from './finalizers/conference.finalizer';
import { finalizeRequest } from './finalizers/request.finalizer';
import { finalizeOverallAnalysis } from './finalizers/overall.finalizer';

/**
 * Processes a single log entry and updates the analysis results.
 * This function's structure remains unchanged.
 */
export const processLogEntry = (
    logEntry: any,
    results: ConferenceLogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }
): void => {
    // --- LOGIC CỦA HÀM NÀY GIỮ NGUYÊN 100% ---
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
                addConferenceError(
                    confDetail,
                    entryTimestampISO,
                    handlerError,
                    {
                        defaultMessage: `Internal error processing event ${eventName}`,
                        keyPrefix: 'handler_internal_error',
                        sourceService: 'LogAnalysisProcessor',
                        errorType: 'Logic',
                        context: { phase: 'response_processing', eventName: eventName, ...logEntry.context }
                    }
                );
            }
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on batchRequestId '${currentRequestId}': ${handlerError.message}`);
        }
    }
};

/**
 * Orchestrates the final calculation of all metrics after log processing is complete.
 * It delegates the complex logic to specialized finalizer modules.
 */
export const calculateFinalMetrics = (
    results: ConferenceLogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData>
): void => {
    // --- ORCHESTRATOR ---

    // Step 0: Calculate initial overall start/end time (from original STAGE 0)
    // This provides a baseline before more accurate calculations are made.
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
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
    }

    // Step 1: Finalize each Conference
    // This must be done first, as request finalization depends on finalized conferences.
    for (const reqId of results.analyzedRequestIds) {
        const parentRequest = results.requests[reqId];
        if (!parentRequest) continue;

        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        for (const conference of conferencesForThisRequest) {
            const confKey = createConferenceKey(conference.batchRequestId, conference.acronym, conference.title);
            const lastTimestamp = confKey ? conferenceLastTimestamp[confKey] ?? null : null;
            
            finalizeConference(conference, { parentRequest, conferenceLastTimestamp: lastTimestamp });
        }
    }

    // Step 2: Finalize each Request
    // This uses the now-finalized conferences to determine the request's status.
    for (const reqId of results.analyzedRequestIds) {
        const request = results.requests[reqId];
        if (!request) continue;

        const childConferences = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);
        const requestLogData = filteredRequestsData.get(reqId);

        finalizeRequest(request, childConferences, requestLogData);
    }

    // Step 3: Finalize the Overall Analysis Result
    // This aggregates all finalized request and conference data into a top-level summary.
    finalizeOverallAnalysis(results);

    // Step 4: Final miscellaneous calculations
    if (results.geminiApi) {
        results.geminiApi.cacheContextMisses = Math.max(0, (results.geminiApi.cacheContextAttempts || 0) - (results.geminiApi.cacheContextHits || 0));
    }
};