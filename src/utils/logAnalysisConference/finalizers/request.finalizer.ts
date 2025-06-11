// src/utils/logAnalysis/finalizers/request.finalizer.ts

/**
 * @fileoverview Contains logic to finalize a single RequestTimings object.
 * This includes calculating its status based on child conferences, aggregating
 * error messages, and recalculating its timing information if necessary.
 */

import { ConferenceAnalysisDetail, RequestLogData, RequestTimings } from '../../../types/logAnalysis';

/**
 * Finalizes a single request's details based on its child conferences.
 * This function MUTATES the request object passed to it.
 *
 * @param request The request object to finalize.
 * @param childConferences An array of all conferences belonging to this request.
 * @param requestLogData Raw log data for the request, used for initial timing.
 */
export function finalizeRequest(
    request: RequestTimings,
    childConferences: ConferenceAnalysisDetail[],
    requestLogData: RequestLogData | undefined
): void {
    // Logic 1: Set initial timing from raw request data (from original STAGE 1)
    if (requestLogData && requestLogData.startTime !== null && requestLogData.endTime !== null) {
        request.startTime = new Date(requestLogData.startTime).toISOString();
        request.endTime = new Date(requestLogData.endTime).toISOString();
        request.durationSeconds = Math.round((requestLogData.endTime - requestLogData.startTime) / 1000);
    } else if (requestLogData) {
        request.startTime = requestLogData.startTime ? new Date(requestLogData.startTime).toISOString() : null;
        request.endTime = requestLogData.endTime ? new Date(requestLogData.endTime).toISOString() : null;
        request.durationSeconds = (requestLogData.startTime && requestLogData.endTime) ? Math.round((requestLogData.endTime - requestLogData.startTime) / 1000) : (requestLogData.startTime || requestLogData.endTime ? 0 : null);
    }

    // Logic 2: Find originalRequestId from children if missing (from original STAGE 1)
    if (childConferences.length > 0 && !request.originalRequestId) {
        for (const conf of childConferences) {
            if (conf.originalRequestId) {
                request.originalRequestId = conf.originalRequestId;
                break;
            }
            if (!request.originalRequestId && conf.finalResult?.originalRequestId) {
                request.originalRequestId = conf.finalResult.originalRequestId;
            }
        }
    }

    // Logic 3: Aggregate error messages from child conferences (from original STAGE 1)
    const requestErrorMessages = new Set<string>();
    childConferences.forEach(conf => {
        if (conf.errors && conf.errors.length > 0) {
            requestErrorMessages.add(`Conference '${conf.acronym}': ${conf.errors[0].message}`);
        }
    });
    request.errorMessages = Array.from(requestErrorMessages).slice(0, 5);

    // Logic 4: Calculate conference counts for this request (from original STAGE 3)
    let numProcessing = 0, numFailed = 0, numCompleted = 0, numSkipped = 0, numProcessedOk = 0;
    let processedConferencesCount = 0;

    for (const conf of childConferences) {
        if (conf.status === 'completed') {
            numCompleted++;
            processedConferencesCount++;
        } else if (conf.status === 'processed_ok') {
            numProcessedOk++;
            processedConferencesCount++;
        } else if (conf.status === 'processing') {
            numProcessing++;
        } else if (conf.status === 'failed') {
            numFailed++;
        } else if (conf.status === 'skipped') {
            numSkipped++;
        }
    }
    request.totalConferencesInputForRequest = childConferences.length;
    request.processedConferencesCountForRequest = processedConferencesCount;

    // Logic 5: Determine final request status (from original STAGE 3)
    if (childConferences.length === 0) {
        if (requestLogData && Array.isArray(requestLogData.logs) && requestLogData.logs.length > 0) {
            request.status = 'Completed';
        } else {
            request.status = 'NoData';
        }
    } else {
        const totalTasksInRequest = childConferences.length;
        const FAILED_THRESHOLD_PERCENT = 0.15;

        if (numProcessing > 0 || numProcessedOk > 0) {
            request.status = 'Processing';
        } else {
            if (numFailed === totalTasksInRequest) {
                request.status = 'Failed';
            } else if (numFailed > 0) {
                if ((numFailed / totalTasksInRequest) > FAILED_THRESHOLD_PERCENT) {
                    request.status = 'CompletedWithErrors';
                } else {
                    if ((numCompleted + numSkipped) === (totalTasksInRequest - numFailed)) {
                        request.status = 'Completed';
                    } else {
                        request.status = 'CompletedWithErrors';
                    }
                }
            } else if (numCompleted === totalTasksInRequest || (numCompleted + numSkipped) === totalTasksInRequest && totalTasksInRequest > 0) {
                request.status = 'Completed';
            } else if (numSkipped === totalTasksInRequest && totalTasksInRequest > 0) {
                request.status = 'Skipped';
            } else if (numCompleted > 0 || numSkipped > 0) {
                request.status = 'PartiallyCompleted';
            } else {
                request.status = 'Unknown';
            }
        }
    }

    // Logic 6: Recalculate request timing from children if needed (from original STAGE 3.5)
    if (request.startTime === null || request.endTime === null) {
        if (childConferences.length > 0) {
            let minStartTime: number | null = null;
            let maxEndTime: number | null = null;

            childConferences.forEach(conf => {
                if (conf.startTime) {
                    const startMs = new Date(conf.startTime).getTime();
                    if (!isNaN(startMs)) minStartTime = Math.min(startMs, minStartTime ?? startMs);
                }
                if (conf.endTime) {
                    const endMs = new Date(conf.endTime).getTime();
                    if (!isNaN(endMs)) maxEndTime = Math.max(endMs, maxEndTime ?? endMs);
                }
            });

            if (minStartTime !== null) request.startTime = new Date(minStartTime).toISOString();
            if (maxEndTime !== null) request.endTime = new Date(maxEndTime).toISOString();

            if (request.startTime && request.endTime) {
                const start = new Date(request.startTime).getTime();
                const end = new Date(request.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    request.durationSeconds = Math.round((end - start) / 1000);
                } else {
                    request.durationSeconds = 0;
                }
            }
        }
    }
}