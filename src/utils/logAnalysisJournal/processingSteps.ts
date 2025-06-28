// src/utils/logAnalysisJournal/processingSteps.ts
import {
    JournalLogAnalysisResult,
    JournalAnalysisDetail,
    JournalRequestLogData,
    // JournalRequestSummary, // Already in JournalLogAnalysisResult
} from '../../types/logAnalysisJournal/logAnalysisJournal.types';
import {
    createJournalKey,
    initializeJournalAnalysisDetail,
    addJournalError,
    normalizeErrorKey
} from './helpers';
import { eventHandlerMapJournal } from './index'; // Ensure this is the journal-specific map

export const processJournalLogEntry = (
    logEntry: any,
    results: JournalLogAnalysisResult,
    journalLastTimestamp: { [compositeKey: string]: number } // Tracks last seen log for a journal
): void => {
    const entryTimeMillis = logEntry.time ? new Date(logEntry.time).getTime() : NaN;
    const entryTimestampISO = !isNaN(entryTimeMillis) ? new Date(entryTimeMillis).toISOString() : new Date().toISOString() + '_INVALID_TIME';

    if (typeof logEntry.level === 'number') {
        if (logEntry.level >= 50) results.errorLogCount++; // Error, Fatal
        if (logEntry.level >= 60) results.fatalLogCount++; // Fatal
    }

    const eventName = logEntry.event as string | undefined;
    const batchRequestId = logEntry.batchRequestId;

    // Try to get journal identifiers from common log fields
    const journalTitle = logEntry.journalTitle
        || logEntry.title
        || (logEntry.context && (logEntry.context.journalTitle || logEntry.context.title))
        || (logEntry.row && (logEntry.row.Title || logEntry.row.journalName));
    const sourceId = logEntry.sourceId
        || (logEntry.context && logEntry.context.sourceId)
        || (logEntry.row && logEntry.row.Sourceid);

    let journalDetail: JournalAnalysisDetail | null = null;
    let compositeKey: string | null = null;

    if (batchRequestId && journalTitle) { // journalTitle is mandatory for a specific journal context
        compositeKey = createJournalKey(batchRequestId, journalTitle, sourceId);
        if (compositeKey) {
            if (!results.journalAnalysis[compositeKey]) {
                // Initialize with 'unknown' data source, specific handlers or context will update it
                const dataSource = logEntry.dataSource || (logEntry.context && logEntry.context.dataSource) || 'unknown';
                const issn = logEntry.issn || (logEntry.row && logEntry.row.Issn) || 'Unknown ISSN'; // Default to 'Unknown ISSN' if not found
                const originalInput = logEntry.url || (logEntry.row ? JSON.stringify(logEntry.row).substring(0, 100) : undefined);
                results.journalAnalysis[compositeKey] = initializeJournalAnalysisDetail(
                    batchRequestId,
                    journalTitle,
                    issn,
                    dataSource,
                    sourceId,
                    originalInput
                );
            }
            journalDetail = results.journalAnalysis[compositeKey];
            if (!isNaN(entryTimeMillis)) {
                journalLastTimestamp[compositeKey] = Math.max(entryTimeMillis, journalLastTimestamp[compositeKey] ?? 0);
            }
        }
    }

    if (eventName && eventHandlerMapJournal[eventName]) {
        const handler = eventHandlerMapJournal[eventName];
        try {
            handler(logEntry, results, journalDetail, entryTimestampISO);
        } catch (handlerError: any) {
            if (journalDetail) {
                addJournalError(
                    journalDetail,
                    entryTimestampISO,
                    handlerError,
                    {
                        defaultMessage: `Internal error processing journal event ${eventName}`,
                        keyPrefix: 'handler_internal_error_journal',
                        sourceService: 'LogAnalysisProcessorJournal',
                        errorType: 'Logic',
                        context: {
                            phase: 'response_processing',
                            eventName: eventName,
                            ...(logEntry.context || {})
                        }
                    }
                );
            }
            results.logProcessingErrors.push(`Handler error for journal event '${eventName}' on batchRequestId '${batchRequestId}': ${handlerError.message}`);
        }
    } else if (eventName) {
        // Optional: Log unhandled events for debugging
        // console.warn(`Unhandled journal event: ${eventName}`, logEntry);
    }
};

export const calculateJournalFinalMetrics = (
    results: JournalLogAnalysisResult,
    journalLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, JournalRequestLogData>
): void => {
    // STAGE 0: Calculate Overall Start/End Time for the entire analysis period
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        // This initial duration is based on the log span, will be refined by sum of request durations
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
    } else if (Object.keys(results.journalAnalysis).length > 0) {
        // Fallback if analysisStart/EndMillis are not available (e.g. no request-level time grouping)
        let minJournalStart: number | null = null;
        let maxJournalEnd: number | null = null;
        Object.values(results.journalAnalysis).forEach(detail => {
            if (detail.startTime) {
                const startMs = new Date(detail.startTime).getTime();
                if (!isNaN(startMs)) minJournalStart = Math.min(startMs, minJournalStart ?? startMs);
            }
            if (detail.endTime) {
                const endMs = new Date(detail.endTime).getTime();
                if (!isNaN(endMs)) maxJournalEnd = Math.max(endMs, maxJournalEnd ?? endMs);
            }
        });
        if (minJournalStart !== null) results.overall.startTime = new Date(minJournalStart).toISOString();
        if (maxJournalEnd !== null) results.overall.endTime = new Date(maxJournalEnd).toISOString();
        if (minJournalStart !== null && maxJournalEnd !== null && maxJournalEnd >= minJournalStart) {
            results.overall.durationSeconds = Math.round((maxJournalEnd - minJournalStart) / 1000);
        }
    }


    // STAGE 1: Finalize individual request timings and identify stuck journals
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId); // From readAndGroupJournalLogs
        let currentRequestSummary = results.requests[reqId];

        if (!currentRequestSummary) { // Should have been created by init_start or controller_failed
            currentRequestSummary = {
                batchRequestId: reqId,
                startTime: null, endTime: null, durationSeconds: null, status: 'Unknown',
                dataSource: requestData?.dataSource,
                errorMessages: [],
            };
            results.requests[reqId] = currentRequestSummary;
        }


        if (requestData && requestData.startTime !== null && requestData.endTime !== null) {
            currentRequestSummary.startTime = new Date(requestData.startTime).toISOString();
            currentRequestSummary.endTime = new Date(requestData.endTime).toISOString();
            currentRequestSummary.durationSeconds = Math.round((requestData.endTime - requestData.startTime) / 1000);
        }
        if (requestData?.dataSource && !currentRequestSummary.dataSource) {
            currentRequestSummary.dataSource = requestData.dataSource;
        }


        const journalsForThisRequest = Object.values(results.journalAnalysis)
            .filter(jd => jd.batchRequestId === reqId);

        const requestEndTimeISO = currentRequestSummary.endTime;
        if (requestEndTimeISO) {
            const requestEndTimeMillis = new Date(requestEndTimeISO).getTime();
            journalsForThisRequest.forEach(journal => {
                if (!journal.endTime && (journal.status === 'processing')) {
                    const journalKey = createJournalKey(journal.batchRequestId, journal.journalTitle, journal.sourceId);
                    const lastLogTimeForThisJournalMillis = journalKey ? journalLastTimestamp[journalKey] : null;

                    let isConsideredStuck = true;
                    // Basic stuck logic: if last log for journal is significantly before request end
                    if (lastLogTimeForThisJournalMillis !== null) {
                        const MAX_SILENCE_MS = 15000; // 15 seconds
                        if ((requestEndTimeMillis - lastLogTimeForThisJournalMillis) < MAX_SILENCE_MS) {
                            isConsideredStuck = false;
                        }
                    }

                    if (isConsideredStuck) {
                        journal.status = 'failed';
                        journal.endTime = new Date(Math.max(requestEndTimeMillis, lastLogTimeForThisJournalMillis || requestEndTimeMillis)).toISOString();
                        addJournalError(
                            journal,
                            journal.endTime,
                            "Journal task did not complete before its parent request finished or went silent.",
                            {
                                defaultMessage: "Journal task considered stuck or incomplete.",
                                keyPrefix: 'journal_task_stuck',
                                sourceService: 'FinalMetricsJournal',
                                errorType: 'Logic',
                                context: {
                                    phase: 'response_processing',
                                    stuckReason: "Parent request ended or task silent.",
                                    journalStartTime: journal.startTime,
                                    journalLastSeenLogTime: lastLogTimeForThisJournalMillis ? new Date(lastLogTimeForThisJournalMillis).toISOString() : null,
                                    parentRequestEndTime: requestEndTimeISO,
                                }
                            }
                        );
                    }
                }
            });
        }
    }

    // --- RECALCULATE OVERALL DURATION based on sum of analyzed request durations ---
    let summedRequestDurations = 0;
    for (const reqId of results.analyzedRequestIds) {
        const reqSummary = results.requests[reqId];
        if (reqSummary && typeof reqSummary.durationSeconds === 'number') {
            summedRequestDurations += reqSummary.durationSeconds;
        }
    }
    results.overall.durationSeconds = summedRequestDurations > 0 ? summedRequestDurations : results.overall.durationSeconds;


    // STAGE 2: Finalize JournalAnalysisDetail (duration, status based on sub-steps)
    Object.values(results.journalAnalysis).forEach(detail => {
        if (!results.analyzedRequestIds.includes(detail.batchRequestId)) {
            return; // Only process journals belonging to analyzed requests
        }

        let isCriticallyFailedInternally = false;
        let criticalFailureReason = "";

        // Example critical failure: if image search was attempted but failed, and it's essential
        // For journals, this might be less critical than for conferences. Adjust as needed.
        // if (detail.steps.image_search_attempted && detail.steps.image_search_success === false) {
        //     isCriticallyFailedInternally = true;
        //     criticalFailureReason = "Image search failed";
        // }

        if (detail.steps.jsonl_write_success === false && detail.status !== 'failed') {
            isCriticallyFailedInternally = true;
            criticalFailureReason = "JSONL write failed";
        }


        if (isCriticallyFailedInternally && detail.status !== 'failed' && detail.status !== 'skipped') {
            const oldStatus = detail.status;
            detail.status = 'failed';
            const failureTimestamp = detail.endTime || results.requests[detail.batchRequestId]?.endTime || results.overall.endTime || new Date().toISOString();
            if (!detail.endTime || (detail.endTime && new Date(failureTimestamp).getTime() > new Date(detail.endTime).getTime())) {
                detail.endTime = failureTimestamp;
            }
            addJournalError(
                detail,
                failureTimestamp,
                `Journal marked as failed in final metrics due to: ${criticalFailureReason}. Original status: ${oldStatus}.`,
                {
                    keyPrefix: `final_metric_override_journal_${normalizeErrorKey(criticalFailureReason)}`,
                    sourceService: 'FinalMetricsJournal',
                    errorType: 'Logic',
                }
            );
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
            } catch (e) { detail.durationSeconds = 0; }
        }

        // Update overall counters based on final journal status
        if (detail.status === 'completed') {
            if (detail.steps.bioxbio_success) results.overall.processedJournalsWithBioxbioSuccess++;
            if (detail.steps.scimago_details_success) results.overall.processedJournalsWithScimagoDetailsSuccess++;
            // image search success already counted by its handler
        }
    });

    // STAGE 3: Recalculate Overall Counts & Update Request Statuses
    results.overall.totalJournalsProcessed = 0; // Reset and recount based on final status
    results.overall.totalJournalsFailed = 0;
    results.overall.totalJournalsSkipped = 0;
    // totalJournalsInput is tricky if not all logs for input definition are present.
    // It's better to sum it from request summaries if those are reliable.

    const uniqueJournalKeysInAnalysis = new Set<string>();

    Object.values(results.journalAnalysis).forEach(journal => {
        if (results.analyzedRequestIds.includes(journal.batchRequestId)) {
            const journalKey = createJournalKey(journal.batchRequestId, journal.journalTitle, journal.sourceId);
            if (journalKey) uniqueJournalKeysInAnalysis.add(journalKey);
            // Status based counts are done per request below, then summed.
        }
    });
    // results.overall.totalJournalsInput = uniqueJournalKeysInAnalysis.size; // This is more like "unique journals encountered"

    for (const reqId of results.analyzedRequestIds) {
        const journalsForThisRequest = Object.values(results.journalAnalysis)
            .filter(jd => jd.batchRequestId === reqId);
        const reqSummary = results.requests[reqId];
        if (!reqSummary) continue;

        let numCompleted = 0, numFailed = 0, numSkipped = 0, numProcessing = 0;
        journalsForThisRequest.forEach(j => {
            if (j.status === 'completed') numCompleted++;
            else if (j.status === 'failed') numFailed++;
            else if (j.status === 'skipped') numSkipped++;
            else if (j.status === 'processing') numProcessing++;
        });

        reqSummary.processedJournalsCountForRequest = numCompleted;
        reqSummary.failedJournalsCountForRequest = numFailed;
        // reqSummary.totalJournalsInputForRequest is best set by dataSource handlers or summary log.
        // If not set, we can estimate it as sum of completed, failed, skipped, processing.
        if (reqSummary.totalJournalsInputForRequest === undefined) {
            reqSummary.totalJournalsInputForRequest = numCompleted + numFailed + numSkipped + numProcessing;
        }


        results.overall.totalJournalsProcessed += numCompleted;
        results.overall.totalJournalsFailed += numFailed;
        results.overall.totalJournalsSkipped += numSkipped;


        if (journalsForThisRequest.length === 0 && reqSummary.totalJournalsInputForRequest === 0) {
            // If summary log indicated 0 tasks, and we saw 0 tasks, it's completed (or NoData if no summary)
            reqSummary.status = (reqSummary.totalJournalsInputForRequest === 0 && reqSummary.startTime && reqSummary.endTime) ? 'Completed' : 'NoData';
        } else if (numProcessing > 0) {
            reqSummary.status = 'Processing';
        } else if (numFailed === reqSummary.totalJournalsInputForRequest && reqSummary.totalJournalsInputForRequest > 0) {
            reqSummary.status = 'Failed';
        } else if (numFailed > 0) {
            reqSummary.status = 'CompletedWithErrors';
        } else if (numCompleted === reqSummary.totalJournalsInputForRequest && reqSummary.totalJournalsInputForRequest > 0) {
            reqSummary.status = 'Completed';
        } else if ((numCompleted + numSkipped) === reqSummary.totalJournalsInputForRequest && reqSummary.totalJournalsInputForRequest > 0) {
            reqSummary.status = 'Completed'; // Or 'PartiallyCompleted' if skips are significant
        } else if (numSkipped === reqSummary.totalJournalsInputForRequest && reqSummary.totalJournalsInputForRequest > 0) {
            reqSummary.status = 'Skipped';
        } else if (numCompleted > 0 || numSkipped > 0) {
            reqSummary.status = 'PartiallyCompleted';
        } else {
            reqSummary.status = 'Unknown';
        }
    }
    // Sum up total input from request summaries if they are now populated
    let totalInputFromRequests = 0;
    results.analyzedRequestIds.forEach(reqId => {
        totalInputFromRequests += results.requests[reqId]?.totalJournalsInputForRequest || 0;
    });
    if (totalInputFromRequests > 0) results.overall.totalJournalsInput = totalInputFromRequests;
    else if (results.overall.totalJournalsInput === 0) results.overall.totalJournalsInput = uniqueJournalKeysInAnalysis.size;



    // --- STAGE 3.5: TÍNH TOÁN LẠI THỜI GIAN REQUEST TỪ CÁC JOURNAL CON ---
    // Bước này để khắc phục trường hợp request bị lỗi và không có log start/end,
    // đảm bảo dữ liệu ở view tổng hợp và view chi tiết là nhất quán.
    for (const reqId of results.analyzedRequestIds) {
        const requestSummary = results.requests[reqId];
        if (!requestSummary) continue;

        // Chỉ tính toán lại nếu thông tin thời gian của request bị thiếu.
        if (requestSummary.startTime === null || requestSummary.endTime === null) {
            const journalsForThisRequest = Object.values(results.journalAnalysis)
                .filter(jd => jd.batchRequestId === reqId);

            if (journalsForThisRequest.length > 0) {
                let minStartTime: number | null = null;
                let maxEndTime: number | null = null;

                journalsForThisRequest.forEach(journal => {
                    if (journal.startTime) {
                        const startMs = new Date(journal.startTime).getTime();
                        if (!isNaN(startMs)) {
                            minStartTime = Math.min(startMs, minStartTime ?? startMs);
                        }
                    }
                    // Sử dụng endTime của journal, đã được tính toán chính xác ở các bước trước
                    if (journal.endTime) {
                        const endMs = new Date(journal.endTime).getTime();
                        if (!isNaN(endMs)) {
                            maxEndTime = Math.max(endMs, maxEndTime ?? endMs);
                        }
                    }
                });

                if (minStartTime !== null) {
                    requestSummary.startTime = new Date(minStartTime).toISOString();
                }
                if (maxEndTime !== null) {
                    requestSummary.endTime = new Date(maxEndTime).toISOString();
                }

                // Tính lại durationSeconds sau khi đã có startTime và endTime
                if (requestSummary.startTime && requestSummary.endTime) {
                    const start = new Date(requestSummary.startTime).getTime();
                    const end = new Date(requestSummary.endTime).getTime();
                    if (!isNaN(start) && !isNaN(end) && end >= start) {
                        requestSummary.durationSeconds = Math.round((end - start) / 1000);
                    } else {
                        requestSummary.durationSeconds = 0;
                    }
                }
            }
        }
    }
    // --- KẾT THÚC STAGE 3.5 ---




    // STAGE 4: Determine final overall analysis status
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
            } else {
                results.status = 'Completed'; // Default to completed if a mix of good states
            }
        } else {
            results.status = 'Unknown';
        }
    } else {
        results.status = "NoRequestsAnalyzed";
    }
};