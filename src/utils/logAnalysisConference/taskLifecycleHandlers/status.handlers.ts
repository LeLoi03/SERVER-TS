// src/utils/logAnalysis/taskLifecycleHandlers/status.handlers.ts

/**
 * Handles events that directly change the primary status of a task (e.g., processing, failed, skipped).
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../helpers';
import { ConferenceAnalysisDetail, LogError as AnalysisLogError } from '../../../types/logAnalysis';
import { ensureOverallAnalysis } from './helpers';

export const handleTaskStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        confDetail.crawlType = logEntry.crawlType;
        const previousStatus = confDetail.status;

        if (!confDetail.startTime) {
            confDetail.startTime = entryTimestampISO;
        }

        if (previousStatus === 'unknown' || previousStatus === 'skipped' || !previousStatus) {
            confDetail.status = 'processing';
            overall.processingTasks = (overall.processingTasks || 0) + 1;
            if (previousStatus === 'skipped' && overall.skippedTasks && overall.skippedTasks > 0) {
                overall.skippedTasks--;
            }
        }
    }
};

export const handleTaskFinish: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    if (confDetail) {
        const previousStatus = confDetail.status;
        confDetail.endTime = entryTimestampISO;

        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        if (previousStatus === 'skipped' || previousStatus === 'completed' || previousStatus === 'failed') {
            // Do not re-process a task already in a final or skipped state by a simple 'finish' event.
            // Other events (like an unhandled error) can override this.
            return;
        }

        let isSuccessBasedOnSteps = true;
        let stepFailureReason = "";

        if (confDetail.steps.search_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Search step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.html_save_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "HTML saving step failed."; }
        if (confDetail.crawlType === 'crawl' && isSuccessBasedOnSteps && confDetail.steps.gemini_determine_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Gemini determine step failed (crawl type)."; }
        if (isSuccessBasedOnSteps && confDetail.steps.gemini_extract_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Gemini extract step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.hasOwnProperty('gemini_cfp_success') && confDetail.steps.gemini_cfp_success === false) { isSuccessBasedOnSteps = false; stepFailureReason = "Gemini CFP step failed."; }
        if (isSuccessBasedOnSteps && confDetail.steps.html_save_success !== 'skipped' && confDetail.steps.link_processing_attempted_count > 0 && confDetail.steps.link_processing_success_count === 0) { isSuccessBasedOnSteps = false; stepFailureReason = "All link processing attempts failed."; }

        const hasUnrecoveredError = confDetail.errors.some((err: AnalysisLogError) => !err.isRecovered);
        let newStatus: ConferenceAnalysisDetail['status'] = (isSuccessBasedOnSteps && !hasUnrecoveredError) ? 'processed_ok' : 'failed';

        if (newStatus === 'failed' && stepFailureReason && !confDetail.errors.some(e => e.message.includes(stepFailureReason.substring(0, 20)) && !e.isRecovered)) {
            addConferenceError(confDetail, entryTimestampISO, stepFailureReason, {
                defaultMessage: stepFailureReason, keyPrefix: 'task_finish_step_check', sourceService: 'TaskLifecycleHandler', errorType: 'Logic',
                additionalDetails: { reason: stepFailureReason, crawlType: confDetail.crawlType }
            });
        }

        if (confDetail.status !== newStatus) {
            confDetail.status = newStatus;
            if (previousStatus === 'processing' || previousStatus === 'unknown' || !previousStatus) {
                if (overall.processingTasks && overall.processingTasks > 0) overall.processingTasks--;
                if (newStatus === 'failed') overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
        }
    }
};

export const handleTaskUnhandledError: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = `Task failed due to unhandled error (${logEntry.event || 'unknown_event'})`;

    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail) {
        const previousStatus = confDetail.status;
        addConferenceError(confDetail, entryTimestampISO, errorSource, {
            defaultMessage, keyPrefix: 'task_unhandled', sourceService: logEntry.service || 'UnknownService', errorType: 'Unknown',
            context: { phase: 'primary_execution', ...logEntry.context }, additionalDetails: { event: logEntry.event }
        });

        if (confDetail.status !== 'failed') {
            confDetail.status = 'failed';
            if (!confDetail.endTime) confDetail.endTime = entryTimestampISO;
            if (confDetail.startTime && confDetail.endTime) {
                try {
                    const start = new Date(confDetail.startTime).getTime();
                    const end = new Date(confDetail.endTime).getTime();
                    if (!isNaN(start) && !isNaN(end) && end >= start) confDetail.durationSeconds = Math.round((end - start) / 1000);
                } catch (e) { /* ignore */ }
            }

            if (previousStatus === 'processing' || previousStatus === 'processed_ok') {
                if (previousStatus === 'processing' && overall.processingTasks > 0) overall.processingTasks--;
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            } else if (previousStatus === 'completed') {
                if (overall.completedTasks > 0) overall.completedTasks--;
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            } else if (previousStatus === 'skipped') {
                if (overall.skippedTasks > 0) overall.skippedTasks--;
                overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
            }
        }
    } else {
        overall.failedOrCrashedTasks = (overall.failedOrCrashedTasks || 0) + 1;
    }
};

export const handleTaskSkipped: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const skipReason = logEntry.reason || "Task skipped";

    if (confDetail) {
        const previousStatus = confDetail.status;
        if (previousStatus === 'skipped') return;

        confDetail.status = 'skipped';
        if (!confDetail.startTime) confDetail.startTime = entryTimestampISO;
        if (!confDetail.endTime) confDetail.endTime = entryTimestampISO;
        if (confDetail.startTime && confDetail.endTime) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) confDetail.durationSeconds = Math.round((end - start) / 1000);
            } catch (e) { /* ignore */ }
        }

        addConferenceError(confDetail, entryTimestampISO, skipReason, {
            defaultMessage: skipReason, keyPrefix: 'task_skipped', sourceService: logEntry.service || 'UnknownService', errorType: 'Logic',
            context: { phase: 'setup', ...logEntry.context }, additionalDetails: { reason: logEntry.reason }
        });

        if (previousStatus === 'processing') {
            if (overall.processingTasks > 0) overall.processingTasks--;
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
        } else if (previousStatus === 'completed') {
            if (overall.completedTasks > 0) overall.completedTasks--;
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
        } else if (previousStatus === 'failed') {
            if (overall.failedOrCrashedTasks > 0) overall.failedOrCrashedTasks--;
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
        } else { // unknown, processed_ok, etc.
            overall.skippedTasks = (overall.skippedTasks || 0) + 1;
        }
    } else {
        overall.skippedTasks = (overall.skippedTasks || 0) + 1;
    }
};