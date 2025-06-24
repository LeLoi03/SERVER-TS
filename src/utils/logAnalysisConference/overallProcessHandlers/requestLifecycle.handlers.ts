// src/utils/logAnalysis/overallProcessHandlers/requestLifecycle.handlers.ts

/**
 * Handles events related to the lifecycle of a specific processing request.
 */

import { LogEventHandler } from '../index';
import { createConferenceKey } from '../utils';
import { ensureOverallAnalysis } from './helpers';

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
            if (requestDescription && !results.requests[currentBatchRequestId].description) {
                results.requests[currentBatchRequestId].description = requestDescription;
            }
            if (!results.requests[currentBatchRequestId].startTime || new Date(requestStartTime) < new Date(results.requests[currentBatchRequestId].startTime!)) {
                 results.requests[currentBatchRequestId].startTime = requestStartTime;
            }
        }

        const overall = ensureOverallAnalysis(results);
        if (!overall.startTime || new Date(requestStartTime) < new Date(overall.startTime)) {
            overall.startTime = requestStartTime;
        }
    }
};

export const handleControllerProcessingFinished: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentBatchRequestId = logEntry.batchRequestId as string | undefined;

    if (currentBatchRequestId && !results.requests[currentBatchRequestId]) {
        results.requests[currentBatchRequestId] = {
            startTime: null, endTime: null, durationSeconds: null, errorMessages: [],
        };
    }
    
    const requestTimingForCurrentBatch = currentBatchRequestId ? results.requests[currentBatchRequestId] : undefined;

    if (logEntry.event === 'processing_finished_successfully') {
        overall.endTime = logEntry.context?.operationEndTime || entryTimestampISO;
        const controllerContext = logEntry.context || {};
        const processedDataFromController = controllerContext.processedResults;

        if (requestTimingForCurrentBatch && controllerContext.operationEndTime) {
            requestTimingForCurrentBatch.endTime = controllerContext.operationEndTime;
            if (!requestTimingForCurrentBatch.status || requestTimingForCurrentBatch.status === 'Processing') {
                requestTimingForCurrentBatch.status = 'Completed';
            }
        }

        if (processedDataFromController && Array.isArray(processedDataFromController) && currentBatchRequestId) {
            let foundOriginalIdForOverallRequest: string | undefined = undefined;
            processedDataFromController.forEach((resultItem: any) => {
                const acronym = resultItem.conference_acronym || resultItem.acronym;
                const title = resultItem.conference_title || resultItem.title;
                const compositeKey = createConferenceKey(currentBatchRequestId, acronym, title);

                if (compositeKey && results.conferenceAnalysis[compositeKey]) {
                    const detailToUpdate = results.conferenceAnalysis[compositeKey];
                    detailToUpdate.finalResult = resultItem;
                    if (resultItem.original_request_id && !detailToUpdate.originalRequestId) {
                        detailToUpdate.originalRequestId = resultItem.original_request_id;
                    }
                    if (resultItem.original_request_id && !foundOriginalIdForOverallRequest) {
                        foundOriginalIdForOverallRequest = resultItem.original_request_id;
                    }
                }
            });
            if (foundOriginalIdForOverallRequest && requestTimingForCurrentBatch && !requestTimingForCurrentBatch.originalRequestId) {
                requestTimingForCurrentBatch.originalRequestId = foundOriginalIdForOverallRequest;
            }
        }
    } else if (logEntry.event === 'processing_failed_in_controller' || logEntry.event === 'processing_failed_in_controller_scope') {
        results.errorMessage = logEntry.err?.message || logEntry.err || logEntry.msg || "Processing failed at controller level";
        overall.endTime = logEntry.context?.operationEndTime || entryTimestampISO;
        const controllerContext = logEntry.context || {};

        if (requestTimingForCurrentBatch) {
            if (controllerContext.operationEndTime) {
                requestTimingForCurrentBatch.endTime = controllerContext.operationEndTime;
            }
            requestTimingForCurrentBatch.status = 'Failed';
            if (results.errorMessage && !requestTimingForCurrentBatch.errorMessages.includes(results.errorMessage)) {
                 requestTimingForCurrentBatch.errorMessages.push(results.errorMessage);
            }
        }
    }
};