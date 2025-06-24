// src/utils/logAnalysis/finalizers/overall.finalizer.ts

/**
 * @fileoverview Contains logic to finalize the overall analysis result.
 * This includes calculating aggregate metrics, total duration, and determining
 * the final top-level status and error message for the entire analysis.
 */

import { ConferenceLogAnalysisResult, RequestTimings } from '../../../types/logAnalysis';
import { createConferenceKey } from '../utils';

/**
 * Finalizes the overall analysis result based on all finalized requests and conferences.
 * This function MUTATES the results object passed to it.
 *
 * @param results The main analysis result object to finalize.
 */
export function finalizeOverallAnalysis(results: ConferenceLogAnalysisResult): void {
    // Logic 1: Recalculate overall duration based on sum of request durations
    let summedRequestDurations = 0;
    for (const reqId of results.analyzedRequestIds) {
        const requestTimings = results.requests[reqId];
        if (requestTimings && typeof requestTimings.durationSeconds === 'number') {
            summedRequestDurations += requestTimings.durationSeconds;
        }
    }
    results.overall.durationSeconds = summedRequestDurations;

    // Logic 2: Recalculate overall task counts (from original STAGE 3)
    results.overall.completedTasks = 0;
    results.overall.failedOrCrashedTasks = 0;
    results.overall.skippedTasks = 0;
    results.overall.processingTasks = 0;

    const uniqueConferenceKeysInAnalysis = new Set<string>();
    Object.values(results.conferenceAnalysis).forEach(conf => {
        if (results.analyzedRequestIds.includes(conf.batchRequestId)) {
            const confKey = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
            if (confKey) uniqueConferenceKeysInAnalysis.add(confKey);

            if (conf.status === 'completed') results.overall.completedTasks++;
            else if (conf.status === 'failed') results.overall.failedOrCrashedTasks++;
            else if (conf.status === 'skipped') results.overall.skippedTasks++;
            else if (conf.status === 'processing' || conf.status === 'processed_ok') results.overall.processingTasks++;
        }
    });
    results.overall.processedConferencesCount = uniqueConferenceKeysInAnalysis.size;

    // Logic 3: Determine final overall analysis status and error message (from original STAGE 4)
    if (results.analyzedRequestIds.length > 0) {
        const requestStatuses = results.analyzedRequestIds.map(id => results.requests[id]?.status);
        const requestErrorMessagesMap = new Map<string, string[]>();
        results.analyzedRequestIds.forEach(id => {
            if (results.requests[id]?.errorMessages?.length) {
                requestErrorMessagesMap.set(id, results.requests[id].errorMessages);
            }
        });

        if (requestStatuses.some(s => s === 'Processing')) {
            results.status = 'Processing';
            results.errorMessage = 'One or more requests are still processing.';
        } else if (requestStatuses.every(s => s === 'Failed')) {
            results.status = 'Failed';
            if (results.analyzedRequestIds.length === 1) {
                const failedReqId = results.analyzedRequestIds[0];
                results.errorMessage = requestErrorMessagesMap.get(failedReqId)?.join('; ') || `Request ${failedReqId} failed.`;
            } else {
                results.errorMessage = 'All analyzed requests failed.';
            }
        } else if (requestStatuses.some(s => s === 'Failed' || s === 'CompletedWithErrors')) {
            results.status = 'CompletedWithErrors';
            const problematicRequestIds = results.analyzedRequestIds.filter(id =>
                results.requests[id]?.status === 'Failed' || results.requests[id]?.status === 'CompletedWithErrors'
            );
            if (problematicRequestIds.length === 1) {
                const problemReqId = problematicRequestIds[0];
                results.errorMessage = requestErrorMessagesMap.get(problemReqId)?.join('; ') || `Request ${problemReqId} completed with errors or failed.`;
            } else {
                const collectedErrorMessages: string[] = [];
                let count = 0;
                for (const reqId of problematicRequestIds) {
                    if (count >= 2) break;
                    const errorMsgs = requestErrorMessagesMap.get(reqId);
                    if (errorMsgs?.length) {
                        collectedErrorMessages.push(`Req ${reqId.slice(-6)}: ${errorMsgs[0]}`);
                        count++;
                    }
                }
                if (collectedErrorMessages.length > 0) {
                    results.errorMessage = `Multiple requests had issues. Examples: ${collectedErrorMessages.join('; ')}. Total problematic: ${problematicRequestIds.length}.`;
                } else {
                    results.errorMessage = `${problematicRequestIds.length} requests completed with errors or failed.`;
                }
            }
        } else if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'PartiallyCompleted' || s === 'NoData' || s === 'Unknown')) {
            if (requestStatuses.some(s => s === 'PartiallyCompleted')) {
                results.status = 'PartiallyCompleted';
                results.errorMessage = 'Some requests were only partially completed.';
            } else if (requestStatuses.some(s => s === 'Unknown')) {
                results.status = 'Unknown';
                results.errorMessage = 'The status of some requests could not be determined.';
            } else if (requestStatuses.some(s => s === 'NoData')) {
                if (requestStatuses.every(s => s === 'NoData' || s === 'Completed' || s === 'Skipped')) {
                    results.status = 'Completed';
                    results.errorMessage = requestStatuses.every(s => s === 'NoData') ? 'All analyzed requests had no data to process.' : 'All requests completed; some may have had no data or were skipped.';
                } else {
                    results.status = 'PartiallyCompleted';
                    results.errorMessage = 'Requests completed with mixed results (some had no data).';
                }
            } else if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped')) {
                results.status = 'Completed';
                if (requestStatuses.some(s => s === 'Skipped')) {
                    results.errorMessage = 'All analyzed requests completed or were skipped.';
                }
            } else {
                results.status = 'Completed';
            }
        } else {
            results.status = 'Unknown';
            results.errorMessage = "The overall analysis status could not be determined due to an unexpected combination of request statuses.";
        }
    } else {
        results.status = "NoRequestsAnalyzed";
        results.errorMessage = "No requests were found matching the filter criteria for analysis.";
        if (results.filterRequestId) {
            results.errorMessage = `Request ID '${results.filterRequestId}' not found or no logs available for it.`;
        }
    }

    // Logic 4: Final error message and status adjustments (from end of original STAGE 4)
    if ((results.status === 'Failed' || results.status === 'CompletedWithErrors') && !results.errorMessage) {
        if (results.overall.failedOrCrashedTasks > 0) {
            results.errorMessage = `Analysis completed with ${results.overall.failedOrCrashedTasks} failed/crashed conference tasks across all requests.`;
        } else {
            results.errorMessage = `Analysis finished with status ${results.status}, but no specific error message was generated.`;
        }
    }

    if (results.status === 'Completed' && results.overall.failedOrCrashedTasks > 0) {
        results.status = 'CompletedWithErrors';
        if (!results.errorMessage) {
            results.errorMessage = `Analysis completed, but ${results.overall.failedOrCrashedTasks} conference tasks failed or crashed.`;
        }
    }

    if (results.status === 'Completed' && results.overall.failedOrCrashedTasks === 0 && results.overall.processingTasks === 0) {
        const hasRequestLevelErrors = results.analyzedRequestIds.some(id => results.requests[id]?.errorMessages?.length > 0);
        if (!hasRequestLevelErrors) {
            results.errorMessage = undefined;
        } else if (!results.errorMessage) {
            results.status = 'CompletedWithErrors';
            results.errorMessage = "Some requests completed but had internal processing issues.";
        }
    }
}