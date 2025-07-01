// src/utils/logAnalysis/finalizers/request.finalizer.ts

import { ConferenceAnalysisDetail, RequestLogData, RequestTimings } from '../../../types/logAnalysis';

export function finalizeRequest(
    request: RequestTimings,
    childConferences: ConferenceAnalysisDetail[],
    requestLogData: RequestLogData | undefined
): void {
    if (requestLogData && requestLogData.startTime !== null && requestLogData.endTime !== null) {
        request.startTime = new Date(requestLogData.startTime).toISOString();
        request.endTime = new Date(requestLogData.endTime).toISOString();
        request.durationSeconds = Math.round((requestLogData.endTime - requestLogData.startTime) / 1000);
    }

    // Logic 2: Set description and originalRequestId from pre-processed raw data
    if (requestLogData?.description) {
        request.description = requestLogData.description;
    }
    if (requestLogData?.originalRequestId) {
        request.originalRequestId = requestLogData.originalRequestId;
    }

    // Logic 3: Aggregate error messages from child conferences
    const requestErrorMessages = new Set<string>();
    childConferences.forEach(conf => {
        if (conf.errors && conf.errors.length > 0) {
            requestErrorMessages.add(`Conference '${conf.acronym}': ${conf.errors[0].message}`);
        }
    });
    request.errorMessages = Array.from(requestErrorMessages).slice(0, 5);

    // Logic 4: Calculate conference counts for this request
    let numCompleted = 0, numProcessedOk = 0, numProcessing = 0, numFailed = 0, numSkipped = 0;
    let processedConferencesCount = 0;

    for (const conf of childConferences) {
        if (conf.status === 'completed') { numCompleted++; processedConferencesCount++; }
        else if (conf.status === 'processed_ok') { numProcessedOk++; processedConferencesCount++; }
        else if (conf.status === 'processing') { numProcessing++; }
        else if (conf.status === 'failed') { numFailed++; }
        else if (conf.status === 'skipped') { numSkipped++; }
    }
    request.totalConferencesInputForRequest = childConferences.length;
    request.processedConferencesCountForRequest = processedConferencesCount;

    // Logic 5: Determine final request status
    if (childConferences.length === 0) {
        request.status = (requestLogData && Array.isArray(requestLogData.logs) && requestLogData.logs.length > 0) ? 'Completed' : 'NoData';
    } else {
        const totalTasks = childConferences.length;

        if (numProcessing > 0 || numProcessedOk > 0) {
            request.status = 'Processing';
        } else if (numFailed === totalTasks) {
            request.status = 'Failed';
        } else if (numFailed > 0) {
            request.status = 'CompletedWithErrors';
        } else if (numCompleted === totalTasks || (numCompleted + numSkipped) === totalTasks) {
            request.status = 'Completed';
        } else if (numSkipped === totalTasks) {
            request.status = 'Skipped';
        } else if (numCompleted > 0 || numSkipped > 0) {
            request.status = 'PartiallyCompleted';
        } else {
            request.status = 'Unknown';
        }
    }

    // Logic 6: Recalculate request timing from children if needed
    if (!request.startTime || !request.endTime) {
        if (childConferences.length > 0) {
            let minStartTime: number | null = null;
            let maxEndTime: number | null = null;
            childConferences.forEach(conf => {
                if (conf.startTime) minStartTime = Math.min(new Date(conf.startTime).getTime(), minStartTime ?? Infinity);
                if (conf.endTime) maxEndTime = Math.max(new Date(conf.endTime).getTime(), maxEndTime ?? -Infinity);
            });
            if (minStartTime) request.startTime = new Date(minStartTime).toISOString();
            if (maxEndTime) request.endTime = new Date(maxEndTime).toISOString();
            if (minStartTime && maxEndTime) {
                request.durationSeconds = Math.round((maxEndTime - minStartTime) / 1000);
            }
        }
    }
}