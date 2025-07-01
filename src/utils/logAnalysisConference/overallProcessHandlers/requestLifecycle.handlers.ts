/**
 * @fileoverview Handles events related to the lifecycle of a specific processing request,
 * from creation to completion or failure.
 */

import { LogEventHandler } from '../index';
import { createConferenceKey } from '../utils';
import { ensureOverallAnalysis } from './helpers';

/**
 * Handles the 'received_request' event.
 * Initializes the analysis object for a new request ID.
 */
export const handleReceivedRequest: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const currentBatchRequestId = logEntry.batchRequestId as string | undefined;
    const requestDescription = logEntry.requestDescription as string | undefined;
    const requestStartTime = entryTimestampISO;

    if (currentBatchRequestId) {
        if (!results.requests[currentBatchRequestId]) {
            results.requests[currentBatchRequestId] = {
                startTime: requestStartTime,
                endTime: null,
                durationSeconds: null,
                errorMessages: [],
                description: requestDescription,
                status: 'Processing',
            };
        } else {
            // Update description if it was missing before
            if (requestDescription && !results.requests[currentBatchRequestId].description) {
                results.requests[currentBatchRequestId].description = requestDescription;
            }
            // Ensure the earliest start time is recorded
            if (!results.requests[currentBatchRequestId].startTime || new Date(requestStartTime) < new Date(results.requests[currentBatchRequestId].startTime!)) {
                 results.requests[currentBatchRequestId].startTime = requestStartTime;
            }
        }

        const overall = ensureOverallAnalysis(results);
        // Ensure the overall start time is the earliest of all requests
        if (!overall.startTime || new Date(requestStartTime) < new Date(overall.startTime)) {
            overall.startTime = requestStartTime;
        }
    }
};

/**
 * Handles the final events from the controller: 'processing_finished_successfully' or 'processing_failed_in_controller'.
 * This is a critical handler that updates the final status of a request and its child conferences.
 */
export const handleControllerProcessingFinished: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentBatchRequestId = logEntry.batchRequestId as string | undefined;

    if (!currentBatchRequestId) return; // Cannot proceed without a request ID

    // Ensure the request object exists
    if (!results.requests[currentBatchRequestId]) {
        results.requests[currentBatchRequestId] = {
            startTime: null, endTime: null, durationSeconds: null, errorMessages: [],
        };
    }
    
    const requestTimingForCurrentBatch = results.requests[currentBatchRequestId];
    const controllerContext = logEntry.context || {};

    if (logEntry.event === 'processing_finished_successfully') {
        // --- HANDLE SUCCESSFUL COMPLETION ---

        // 1. Update request timing and status
        requestTimingForCurrentBatch.endTime = controllerContext.operationEndTime || entryTimestampISO;
        if (!requestTimingForCurrentBatch.status || requestTimingForCurrentBatch.status === 'Processing') {
            requestTimingForCurrentBatch.status = 'Completed'; // Tentative status, finalizer will confirm
        }
        if (requestTimingForCurrentBatch.startTime && requestTimingForCurrentBatch.endTime) {
            try {
                const start = new Date(requestTimingForCurrentBatch.startTime).getTime();
                const end = new Date(requestTimingForCurrentBatch.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    requestTimingForCurrentBatch.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch(e) { /* ignore */ }
        }

        // 2. Update overall end time if this request finished last
        if (requestTimingForCurrentBatch.endTime) {
            if (!overall.endTime || new Date(requestTimingForCurrentBatch.endTime) > new Date(overall.endTime)) {
                overall.endTime = requestTimingForCurrentBatch.endTime;
            }
        }

        // 3. Propagate completion status to child conferences
        const processedDataFromController = controllerContext.processedResults;
        if (processedDataFromController && Array.isArray(processedDataFromController)) {
            processedDataFromController.forEach((resultItem: any) => {
                const acronym = resultItem.acronym;
                const title = resultItem.title;
                if (!acronym || !title) return;

                const compositeKey = createConferenceKey(currentBatchRequestId, acronym, title);

                if (compositeKey && results.conferenceAnalysis[compositeKey]) {
                    const confDetail = results.conferenceAnalysis[compositeKey];
                    
                    // Assign the final processed data
                    confDetail.finalResult = resultItem;

                    // **CRITICAL LOGIC**: If a conference was waiting in 'processed_ok',
                    // this event confirms its successful completion.
                    if (confDetail.status === 'processed_ok' || confDetail.status === 'processing') {
                        const previousStatus = confDetail.status;
                        confDetail.status = 'completed';
                        
                        // Update overall counters
                        if (previousStatus === 'processing' && overall.processingTasks > 0) {
                            overall.processingTasks--;
                        }
                        overall.completedTasks = (overall.completedTasks || 0) + 1;

                        // Ensure conference end time is set
                        if (!confDetail.endTime) {
                            confDetail.endTime = requestTimingForCurrentBatch.endTime;
                        }
                    }
                }
            });
        }
    } else if (logEntry.event === 'processing_failed_in_controller' || logEntry.event === 'processing_failed_in_controller_scope') {
        // --- HANDLE FAILED COMPLETION ---
        const errorMessage = logEntry.err?.message || logEntry.err || logEntry.msg || "Processing failed at controller level";
        
        // 1. Update request timing and status
        requestTimingForCurrentBatch.endTime = controllerContext.operationEndTime || entryTimestampISO;
        requestTimingForCurrentBatch.status = 'Failed';
        if (!requestTimingForCurrentBatch.errorMessages.includes(errorMessage)) {
             requestTimingForCurrentBatch.errorMessages.push(errorMessage);
        }

        // 2. Update overall end time
        if (requestTimingForCurrentBatch.endTime) {
            if (!overall.endTime || new Date(requestTimingForCurrentBatch.endTime) > new Date(overall.endTime)) {
                overall.endTime = requestTimingForCurrentBatch.endTime;
            }
        }
    }
};