// src/utils/logAnalysis/finalizers/conference.finalizer.ts

/**
 * @fileoverview Contains logic to finalize a single ConferenceAnalysisDetail object.
 * This includes detecting stuck tasks, critical internal failures, propagating
 * request-level errors (like CSV failures), and calculating final duration.
 */

import { ConferenceAnalysisDetail, RequestTimings } from '../../../types/logAnalysis';
import { addConferenceError, normalizeErrorKey } from '../utils';

/**
 * Context required to finalize a conference.
 * Contains information from the conference's parent request and its own log timestamps.
 */
export interface ConferenceFinalizationContext {
    parentRequest: RequestTimings;
    conferenceLastTimestamp: number | null;
}

/**
 * Finalizes a single conference's details by applying various logic checks.
 * This function MUTATES the conference object passed to it.
 *
 * @param conference The conference detail object to finalize.
 * @param context Additional context needed for finalization.
 */
export function finalizeConference(
    conference: ConferenceAnalysisDetail,
    context: ConferenceFinalizationContext
): void {
    const { parentRequest, conferenceLastTimestamp } = context;

    // Logic 1: Detect and handle "stuck" tasks (from original STAGE 1)
    // A task is considered stuck if its parent request has finished, but the task
    // itself is still in a processing state without a recent log entry.
    if (parentRequest.endTime && !conference.endTime && (conference.status === 'processing' || conference.status === 'processed_ok')) {
        const requestEndTimeMillis = new Date(parentRequest.endTime).getTime();
        const confStartTimeMillis = conference.startTime ? new Date(conference.startTime).getTime() : null;

        let isConsideredStuck = true;
        if (conferenceLastTimestamp !== null) {
            // If the last log is before or at the start time, it's not considered active.
            if (confStartTimeMillis !== null && conferenceLastTimestamp <= confStartTimeMillis) {
                isConsideredStuck = false;
            } else {
                // If the last log was very close to the request's end, it might just be a timing issue.
                const MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS = 3000;
                if ((requestEndTimeMillis - conferenceLastTimestamp) < MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS) {
                    isConsideredStuck = false;
                }
            }
        }

        if (isConsideredStuck) {
            conference.status = 'failed';
            let failureTimestampMillis = requestEndTimeMillis;
            if (conferenceLastTimestamp !== null) {
                failureTimestampMillis = Math.max(failureTimestampMillis, conferenceLastTimestamp);
            }
            conference.endTime = new Date(failureTimestampMillis).toISOString();

            addConferenceError(
                conference,
                conference.endTime,
                "Conference did not complete (stuck in processing/processed_ok) before its parent request finished.",
                {
                    defaultMessage: "Conference task considered stuck or incomplete as parent request ended.",
                    keyPrefix: 'task_stuck_or_incomplete',
                    sourceService: 'FinalMetricsCalculation',
                    errorType: 'Logic',
                    context: {
                        phase: 'response_processing',
                        stuckReason: "Parent request ended while task active. Task had prior activity but no final status log.",
                        conferenceStartTime: conference.startTime,
                        conferenceLastSeenLogTime: conferenceLastTimestamp ? new Date(conferenceLastTimestamp).toISOString() : null,
                        parentRequestEndTime: parentRequest.endTime,
                        timeDiffLastConfLogAndReqEndMs: conferenceLastTimestamp ? (requestEndTimeMillis - conferenceLastTimestamp) : null
                    }
                }
            );
        }
    }

    // Logic 2: Detect critical internal failures (from original STAGE 2)
    let isCriticallyFailedInternally = false;
    let criticalFailureReason = "";
    let criticalFailureEventKey = "";

     if (conference.steps) {
        if (conference.steps.gemini_extract_attempted && conference.steps.gemini_extract_success === false) {
            isCriticallyFailedInternally = true;
            criticalFailureReason = "Gemini extract failed";
            criticalFailureEventKey = "gemini_extract_failed";
        }

        if (!isCriticallyFailedInternally && conference.status !== 'failed' && conference.status !== 'skipped') {
            const linksIntendedToProcess = conference.steps.search_limited_count ?? conference.steps.search_filtered_count ?? 0;
            const linkProcessingAttemptedCount = conference.steps.link_processing_attempted_count ?? 0;
            const linkProcessingSuccessCount = conference.steps.link_processing_success_count ?? 0;

            if (linksIntendedToProcess > 0 && linkProcessingAttemptedCount >= linksIntendedToProcess && linkProcessingSuccessCount === 0) {
                isCriticallyFailedInternally = true;
                criticalFailureReason = `All ${linksIntendedToProcess} relevant links failed to process.`;
                criticalFailureEventKey = "all_intended_links_failed";
            }
        }
    }

    if (isCriticallyFailedInternally && conference.status !== 'failed' && conference.status !== 'skipped') {
        const oldStatus = conference.status;
        conference.status = 'failed';

        // ==================================================================
        // <<<< SỬA LỖI TẠI ĐÂY >>>>
        // ==================================================================
        // Lấy timestamp của hoạt động cuối cùng của conference này làm thời gian thất bại.
        // Đây là thời điểm chính xác nhất, thay vì lấy của parent request.
        const lastActivityTimestamp = conferenceLastTimestamp ? new Date(conferenceLastTimestamp).toISOString() : null;

        // Ưu tiên endTime đã có, sau đó là lastActivityTimestamp, cuối cùng mới fallback về parentRequest.endTime
        const failureTimestamp = conference.endTime || lastActivityTimestamp || parentRequest.endTime || new Date().toISOString();
        
        if (!conference.endTime || (conference.endTime && new Date(failureTimestamp).getTime() > new Date(conference.endTime).getTime())) {
            conference.endTime = failureTimestamp;
        }
        // ==================================================================
        // <<<< KẾT THÚC SỬA LỖI >>>>
        // ==================================================================

        addConferenceError(
            conference,
            conference.endTime, // Sử dụng endTime vừa được gán chính xác
            `Task marked as failed in final metrics due to: ${criticalFailureReason}.`,
            {
                defaultMessage: `Conference task status overridden to failed. Original status: ${oldStatus}.`,
                keyPrefix: `final_metric_override_${normalizeErrorKey(criticalFailureEventKey)}`,
                sourceService: 'FinalMetricsCalculation',
                errorType: 'Logic',
                context: { phase: 'response_processing', reason: criticalFailureReason, originalStatus: oldStatus, eventKey: criticalFailureEventKey }
            }
        );
    }

    // Logic 3: Propagate request-level CSV stream failure (from original STAGE 2)
    if (parentRequest.csvOutputStreamFailed === true) {
        if (conference.csvWriteSuccess !== true && conference.status !== 'failed' && conference.status !== 'skipped') {
            const oldConfStatus = conference.status;
            conference.status = 'failed';
            conference.csvWriteSuccess = false;

            const csvFailureTimestamp = conference.endTime || parentRequest.endTime || new Date().toISOString();
            if (!conference.endTime || (conference.endTime && new Date(csvFailureTimestamp).getTime() > new Date(conference.endTime).getTime())) {
                conference.endTime = csvFailureTimestamp;
            }

            addConferenceError(
                conference,
                csvFailureTimestamp,
                `Conference failed due to CSV output stream failure for its parent request (ID: ${conference.batchRequestId}).`,
                {
                    defaultMessage: "CSV output stream failed for the request this conference belongs to.",
                    keyPrefix: "request_csv_stream_failure_override_conf",
                    sourceService: 'FinalMetricsCalculation',
                    errorType: 'FileSystem',
                    context: { phase: 'response_processing', csvErrorSource: "request_output_stream", originalStatus: oldConfStatus, parentRequestId: conference.batchRequestId }
                }
            );
        } else if (conference.status === 'failed' && conference.csvWriteSuccess !== false) {
            conference.csvWriteSuccess = false;
        }
    }

    // Logic 4: Calculate final duration (from original STAGE 2)
    // Logic này sẽ tự động hoạt động chính xác sau khi conference.endTime đã được sửa ở trên.
    if (!conference.durationSeconds && conference.startTime && conference.endTime) {
        try {
            const startMillis = new Date(conference.startTime).getTime();
            const endMillis = new Date(conference.endTime).getTime();
            if (!isNaN(startMillis) && !isNaN(endMillis) && endMillis >= startMillis) {
                conference.durationSeconds = Math.round((endMillis - startMillis) / 1000);
            } else {
                conference.durationSeconds = 0;
            }
        } catch (e) {
            conference.durationSeconds = 0;
        }
    }
}