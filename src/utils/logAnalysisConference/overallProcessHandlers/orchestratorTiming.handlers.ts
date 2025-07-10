// src/utils/logAnalysis/overallProcessHandlers/orchestratorTiming.handlers.ts

import { LogEventHandler } from '../index';
import { RequestTimings } from '../../../types/logAnalysis';

/**
 * Helper function to get the request object, ensuring it exists.
 */
const ensureRequest = (results: any, batchRequestId: string): RequestTimings | null => {
    if (!batchRequestId) return null;
    if (!results.requests[batchRequestId]) {
        results.requests[batchRequestId] = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            errorMessages: [],
            status: 'Processing',
        };
    }
    return results.requests[batchRequestId];
};

/**
 * Handles the 'ORCHESTRATOR_START' event.
 * Calculates the time from request reception to the start of the main orchestration logic.
 */
export const handleOrchestratorStart: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId as string;
    const request = ensureRequest(results, batchRequestId);
    if (!request || !request.startTime) return;

    try {
        const orchestratorStartTime = new Date(entryTimestampISO).getTime();
        const requestStartTime = new Date(request.startTime).getTime();
        if (!isNaN(orchestratorStartTime) && !isNaN(requestStartTime)) {
            request.initializationDurationMs = orchestratorStartTime - requestStartTime;
        }
    } catch (e) { /* ignore date parsing errors */ }
};

/**
 * Handles events that have a simple duration in ms and belong to a request.
 * This is a generic handler for 'ALL_TASKS_QUEUED', 'ALL_TASKS_COMPLETED', 'FINAL_PROCESSING_END'.
 */
export const handleRequestDurationEvent: LogEventHandler = (logEntry, results, _confDetail) => {
    const batchRequestId = logEntry.batchRequestId as string;
    const durationMs = logEntry.durationMs as number;
    const event = logEntry.event as string;

    if (!batchRequestId || typeof durationMs !== 'number') return;

    const request = ensureRequest(results, batchRequestId);
    if (!request) return;

    switch (event) {
        case 'ALL_TASKS_QUEUED':
            request.taskQueueingDurationMs = durationMs;
            break;
        case 'ALL_TASKS_COMPLETED':
            request.allTasksCompletionDurationMs = durationMs;
            break;
        case 'FINAL_PROCESSING_END':
            request.finalProcessingDurationMs = durationMs;
            break;
        case 'ORCHESTRATOR_END':
            request.orchestratorDurationMs = durationMs;
            break;
    }
};

/**
 * Handles the 'REQUEST_COMPLETED' and 'REQUEST_COMPLETED_ASYNC' events.
 * This marks the final end time for a request.
 */
export const handleRequestCompleted: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const batchRequestId = logEntry.batchRequestId as string;
    const request = ensureRequest(results, batchRequestId);
    if (!request) return;

    request.endTime = entryTimestampISO;
    if (request.startTime) {
        try {
            const start = new Date(request.startTime).getTime();
            const end = new Date(request.endTime).getTime();
            if (!isNaN(start) && !isNaN(end)) {
                request.durationSeconds = Math.round((end - start) / 1000);
            }
        } catch (e) { /* ignore */ }
    }
};