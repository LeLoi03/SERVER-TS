// src/utils/logAnalysis/processingSteps.ts
import {
    ConferenceLogAnalysisResult,
    ConferenceAnalysisDetail,
    RequestLogData,
    RequestTimings,
} from '../../types/logAnalysis';
import {
    createConferenceKey,
    initializeConferenceDetail,
    addConferenceError,

} from './helpers';
import { normalizeErrorKey } from './helpers';
import { eventHandlerMap } from './index';


// --- processLogEntry giữ nguyên ---
export const processLogEntry = (
    logEntry: any,
    results: ConferenceLogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number }
): void => {
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
            // Khi conference được khởi tạo lần đầu, nếu nó thuộc request đang được phân tích,
            // thì tăng processedConferencesCount.
            // Cần đảm bảo results.analyzedRequestIds đã được điền trước khi processLogEntry chạy,
            // hoặc kiểm tra này phải được thực hiện ở nơi khác (ví dụ: cuối calculateFinalMetrics).
            // Hiện tại, overall.processedConferencesCount được cập nhật trong handleTaskStart
            // và calculateFinalMetrics (STAGE 3) sẽ đếm lại chính xác.
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
                        context: {
                            phase: 'response_processing',
                            eventName: eventName,
                            ...logEntry.context
                        }
                    }
                );
            }
            results.logProcessingErrors.push(`Handler error for event '${eventName}' on batchRequestId '${currentRequestId}': ${handlerError.message}`);
        }
    }
};


export const calculateFinalMetrics = (
    results: ConferenceLogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData>
): void => {

    // STAGE 0: Calculate Overall Start/End Time.
    // Duration will be recalculated later based on sum of request durations.
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
        // Initial duration based on overall span, will be overwritten
        results.overall.durationSeconds = Math.round((analysisEndMillis - analysisStartMillis) / 1000);
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

        if (minConfStart !== null && maxConfEnd !== null && maxConfEnd >= minConfStart) {
            // Initial duration based on conference span, will be overwritten
            results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
        } else {
            results.overall.durationSeconds = 0;
        }
    } else {
        results.overall.durationSeconds = 0; // Default if no other info
    }


    // --- STAGE 1: Determine/Update status for each conference (stuck tasks) and then initialize request timings ---
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        let currentRequestTimings: RequestTimings = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            status: 'Unknown',
            originalRequestId: results.requests[reqId]?.originalRequestId,
            csvOutputStreamFailed: false,
            errorMessages: []
        };

        if (requestData && requestData.startTime !== null && requestData.endTime !== null) {
            currentRequestTimings.startTime = new Date(requestData.startTime).toISOString();
            currentRequestTimings.endTime = new Date(requestData.endTime).toISOString();
            currentRequestTimings.durationSeconds = Math.round((requestData.endTime - requestData.startTime) / 1000);
        } else if (requestData) {
            currentRequestTimings.startTime = requestData.startTime ? new Date(requestData.startTime).toISOString() : null;
            currentRequestTimings.endTime = requestData.endTime ? new Date(requestData.endTime).toISOString() : null;
            currentRequestTimings.durationSeconds = (requestData.startTime && requestData.endTime) ? Math.round((requestData.endTime - requestData.startTime) / 1000) : (requestData.startTime || requestData.endTime ? 0 : null);
        }

        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        if (conferencesForThisRequest.length > 0 && !currentRequestTimings.originalRequestId) {
            for (const conf of conferencesForThisRequest) {
                if (conf.originalRequestId) {
                    currentRequestTimings.originalRequestId = conf.originalRequestId;
                    break;
                }
                if (!currentRequestTimings.originalRequestId && conf.finalResult?.originalRequestId) {
                    currentRequestTimings.originalRequestId = conf.finalResult.originalRequestId;
                }
            }
        }

        const requestEndTimeISO = currentRequestTimings.endTime;

        if (requestEndTimeISO) {
            const requestEndTimeMillis = new Date(requestEndTimeISO).getTime();

            conferencesForThisRequest.forEach(conf => {
                if (!conf.endTime && (conf.status === 'processing' || conf.status === 'processed_ok')) {
                    const confKeyForTimestamp = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
                    const lastLogTimeForThisConferenceMillis = confKeyForTimestamp ? conferenceLastTimestamp[confKeyForTimestamp] : null;
                    const confStartTimeMillis = conf.startTime ? new Date(conf.startTime).getTime() : null;

                    let isConsideredStuck = true;

                    if (lastLogTimeForThisConferenceMillis !== null) {
                        if (confStartTimeMillis !== null && lastLogTimeForThisConferenceMillis <= confStartTimeMillis) {
                            isConsideredStuck = false;
                        } else {
                            const MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS = 3000;
                            if ((requestEndTimeMillis - lastLogTimeForThisConferenceMillis) < MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS) {
                                isConsideredStuck = false;
                            }
                        }
                    }

                    if (isConsideredStuck) {
                        conf.status = 'failed';
                        let failureTimestampMillis = requestEndTimeMillis;
                        if (lastLogTimeForThisConferenceMillis !== null) {
                            failureTimestampMillis = Math.max(failureTimestampMillis, lastLogTimeForThisConferenceMillis);
                        }
                        conf.endTime = new Date(failureTimestampMillis).toISOString();

                        addConferenceError(
                            conf,
                            conf.endTime,
                            "Conference did not complete (stuck in processing/processed_ok) before its parent request finished.",
                            {
                                defaultMessage: "Conference task considered stuck or incomplete as parent request ended.",
                                keyPrefix: 'task_stuck_or_incomplete',
                                sourceService: 'FinalMetricsCalculation',
                                errorType: 'Logic',
                                context: {
                                    phase: 'response_processing',
                                    stuckReason: "Parent request ended while task active. Task had prior activity but no final status log.",
                                    conferenceStartTime: conf.startTime,
                                    conferenceLastSeenLogTime: lastLogTimeForThisConferenceMillis ? new Date(lastLogTimeForThisConferenceMillis).toISOString() : null,
                                    parentRequestEndTime: requestEndTimeISO,
                                    timeDiffLastConfLogAndReqEndMs: lastLogTimeForThisConferenceMillis ? (requestEndTimeMillis - lastLogTimeForThisConferenceMillis) : null
                                }
                            }
                        );
                    }
                }
            });
        }
        results.requests[reqId] = {
            ...(results.requests[reqId] || {}),
            startTime: currentRequestTimings.startTime,
            endTime: currentRequestTimings.endTime,
            durationSeconds: currentRequestTimings.durationSeconds,
            originalRequestId: currentRequestTimings.originalRequestId,
            errorMessages: [], // Khởi tạo mảng errorMessages
            // status, totalConferencesInputForRequest và processedConferencesCountForRequest sẽ được cập nhật ở STAGE 3
        };

        // Sau khi xử lý stuck conferences và thêm lỗi vào conf.errors
        // Lặp lại qua conferencesForThisRequest để tổng hợp lỗi vào requestTimings.errorMessages
        const requestErrorMessages = new Set<string>();
        conferencesForThisRequest.forEach(conf => {
            if (conf.errors && conf.errors.length > 0) {
                // Lấy message của lỗi đầu tiên hoặc một thông báo tóm tắt
                requestErrorMessages.add(`Conference '${conf.acronym}': ${conf.errors[0].message}`);
            }
        });
        if (results.requests[reqId]) { // Kiểm tra lại vì có thể đã bị xóa nếu logic thay đổi
            results.requests[reqId].errorMessages = Array.from(requestErrorMessages).slice(0, 5); // Giới hạn số lượng error messages
        }
    }

    // --- NEW: RECALCULATE OVERALL DURATION BASED ON SUM OF ANALYZED REQUEST DURATIONS ---
    // This overwrites the initial overall.durationSeconds calculated in STAGE 0.
    // This must be done *after* individual request durations are calculated and stored in STAGE 1.
    let summedRequestDurations = 0;
    for (const reqId of results.analyzedRequestIds) {
        const requestTimings = results.requests[reqId];
        if (requestTimings && typeof requestTimings.durationSeconds === 'number') {
            summedRequestDurations += requestTimings.durationSeconds;
        }
    }
    results.overall.durationSeconds = summedRequestDurations;
    // --- END NEW SECTION ---


    // --- STAGE 2: Finalize Conference Details (duration, status based on sub-steps, and request-level CSV failures) ---
    Object.values(results.conferenceAnalysis).forEach(detail => {
        if (!results.analyzedRequestIds.includes(detail.batchRequestId)) {
            return;
        }

        let isCriticallyFailedInternally = false;
        let criticalFailureReason = "";
        let criticalFailureEventKey = "";

        if (detail.steps) {
            // Lỗi 1: Gemini extract thất bại (giữ nguyên, đây là lỗi nghiêm trọng)
            if (detail.steps.gemini_extract_attempted && detail.steps.gemini_extract_success === false) {
                isCriticallyFailedInternally = true;
                criticalFailureReason = "Gemini extract failed";
                criticalFailureEventKey = "gemini_extract_failed";
            }

            // --- BẮT ĐẦU SỬA ĐỔI LOGIC LỖI LINK ---
            if (!isCriticallyFailedInternally && detail.status !== 'failed' && detail.status !== 'skipped') {
                const searchFilteredCount = detail.steps.search_filtered_count ?? 0;
                const linkProcessingAttemptedCount = detail.steps.link_processing_attempted_count ?? 0;
                const linkProcessingSuccessCount = detail.steps.link_processing_success_count ?? 0;

                // Điều kiện để coi là lỗi link nghiêm trọng:
                // 1. Có link đã được lọc để xử lý (searchFilteredCount > 0).
                // 2. Đã cố gắng xử lý TẤT CẢ các link đã lọc (linkProcessingAttemptedCount >= searchFilteredCount).
                //    Dùng '>=' để phòng trường hợp có logic thử lại hoặc logic phức tạp hơn.
                // 3. Không có link nào thành công (linkProcessingSuccessCount === 0).
                if (searchFilteredCount > 0 &&
                    linkProcessingAttemptedCount >= searchFilteredCount &&
                    linkProcessingSuccessCount === 0) {

                    isCriticallyFailedInternally = true;
                    criticalFailureReason = `All ${searchFilteredCount} filtered links failed to process.`;
                    criticalFailureEventKey = "all_filtered_links_failed";
                }
            }
            // --- KẾT THÚC SỬA ĐỔI LOGIC LỖI LINK ---
        }

        // Phần còn lại của STAGE 2 (ghi lỗi, xử lý CSV fail) giữ nguyên
        if (isCriticallyFailedInternally && detail.status !== 'failed' && detail.status !== 'skipped') {
            const oldStatus = detail.status;
            detail.status = 'failed';

            const failureTimestamp = detail.endTime ||
                (results.requests[detail.batchRequestId]?.endTime) ||
                results.overall.endTime ||
                new Date().toISOString();

            if (!detail.endTime || (detail.endTime && new Date(failureTimestamp).getTime() > new Date(detail.endTime).getTime())) {
                detail.endTime = failureTimestamp;
            }

            addConferenceError(
                detail,
                failureTimestamp,
                `Task marked as failed in final metrics due to: ${criticalFailureReason}.`,
                {
                    defaultMessage: `Conference task status overridden to failed. Original status: ${oldStatus}.`,
                    keyPrefix: `final_metric_override_${normalizeErrorKey(criticalFailureEventKey)}`,
                    sourceService: 'FinalMetricsCalculation',
                    errorType: 'Logic',
                    context: {
                        phase: 'response_processing',
                        reason: criticalFailureReason,
                        originalStatus: oldStatus,
                        eventKey: criticalFailureEventKey
                    }
                }
            );
        }

        const requestInfo = results.requests[detail.batchRequestId]; // Changed from requestData to requestInfo for clarity
        if (requestInfo && requestInfo.csvOutputStreamFailed === true) {
            if (detail.csvWriteSuccess !== true && detail.status !== 'failed' && detail.status !== 'skipped') {
                const oldConfStatus = detail.status;
                detail.status = 'failed';
                detail.csvWriteSuccess = false;

                const csvFailureTimestamp = detail.endTime ||
                    requestInfo.endTime ||
                    results.overall.endTime ||
                    new Date().toISOString();

                if (!detail.endTime || (detail.endTime && new Date(csvFailureTimestamp).getTime() > new Date(detail.endTime).getTime())) {
                    detail.endTime = csvFailureTimestamp;
                }

                addConferenceError(
                    detail,
                    csvFailureTimestamp,
                    `Conference failed due to CSV output stream failure for its parent request (ID: ${detail.batchRequestId}).`,
                    {
                        defaultMessage: "CSV output stream failed for the request this conference belongs to.",
                        keyPrefix: "request_csv_stream_failure_override_conf",
                        sourceService: 'FinalMetricsCalculation',
                        errorType: 'FileSystem',
                        context: {
                            phase: 'response_processing',
                            csvErrorSource: "request_output_stream",
                            originalStatus: oldConfStatus,
                            parentRequestId: detail.batchRequestId
                        }
                    }
                );
            } else if (detail.status === 'failed' && detail.csvWriteSuccess !== false) {
                detail.csvWriteSuccess = false;
            }
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
            } catch (e) {
                detail.durationSeconds = 0;
            }
        }
    });


    // --- STAGE 3: Recalculate Overall Counts & Update Request Statuses AND Conference Counts ---
    results.overall.completedTasks = 0;
    results.overall.failedOrCrashedTasks = 0;
    results.overall.skippedTasks = 0;
    results.overall.processingTasks = 0;

    const uniqueConferenceKeysInAnalysis = new Set<string>();

    Object.values(results.conferenceAnalysis).forEach(conf => {
        if (results.analyzedRequestIds.includes(conf.batchRequestId)) {
            const confKey = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
            if (confKey) uniqueConferenceKeysInAnalysis.add(confKey);

            if (conf.status === 'completed') {
                results.overall.completedTasks++;
            } else if (conf.status === 'failed') {
                results.overall.failedOrCrashedTasks++;
            } else if (conf.status === 'skipped') {
                results.overall.skippedTasks++;
            } else if (conf.status === 'processing' || conf.status === 'processed_ok') {
                results.overall.processingTasks++;
            }
        }
    });
    results.overall.processedConferencesCount = uniqueConferenceKeysInAnalysis.size;


    for (const reqId of results.analyzedRequestIds) {
        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        const requestTimings = results.requests[reqId];
        if (!requestTimings) continue;

        let currentReqProcessedConferences = 0;
        let currentReqTotalInputConferences = 0;

        let numProcessing = 0, numFailed = 0, numCompleted = 0, numSkipped = 0, numProcessedOk = 0;

        for (const conf of conferencesForThisRequest) {
            currentReqTotalInputConferences++;
            if (conf.status === 'completed') {
                numCompleted++;
                currentReqProcessedConferences++;
            } else if (conf.status === 'processed_ok') {
                numProcessedOk++;
                currentReqProcessedConferences++;
            } else if (conf.status === 'processing') {
                numProcessing++;
            } else if (conf.status === 'failed') {
                numFailed++;
            } else if (conf.status === 'skipped') {
                numSkipped++;
            }
        }

        requestTimings.totalConferencesInputForRequest = currentReqTotalInputConferences;
        requestTimings.processedConferencesCountForRequest = currentReqProcessedConferences;

        if (conferencesForThisRequest.length === 0) {
            const requestDataFromFiltered = filteredRequestsData.get(reqId); // Renamed to avoid conflict
            if (requestDataFromFiltered && Array.isArray(requestDataFromFiltered.logs) && requestDataFromFiltered.logs.length > 0) {
                requestTimings.status = 'Completed';
            } else {
                requestTimings.status = 'NoData';
            }
        } else {
            const totalTasksInRequest = conferencesForThisRequest.length;
            const FAILED_THRESHOLD_PERCENT = 0.15;

            if (numProcessing > 0 || numProcessedOk > 0) {
                requestTimings.status = 'Processing';
            } else {
                if (numFailed === totalTasksInRequest) {
                    requestTimings.status = 'Failed';
                } else if (numFailed > 0) {
                    if ((numFailed / totalTasksInRequest) > FAILED_THRESHOLD_PERCENT) {
                        requestTimings.status = 'CompletedWithErrors';
                    } else {
                        if ((numCompleted + numSkipped) === (totalTasksInRequest - numFailed)) { // numProcessedOk is 0 here
                            requestTimings.status = 'Completed';
                        } else {
                            requestTimings.status = 'CompletedWithErrors';
                        }
                    }
                } else if (numCompleted === totalTasksInRequest || (numCompleted + numSkipped) === totalTasksInRequest && totalTasksInRequest > 0) { // numProcessedOk is 0 here
                    requestTimings.status = 'Completed';
                } else if (numSkipped === totalTasksInRequest && totalTasksInRequest > 0) {
                    requestTimings.status = 'Skipped';
                } else if (numCompleted > 0 || numSkipped > 0) { // numProcessedOk is 0 here
                    requestTimings.status = 'PartiallyCompleted';
                } else {
                    requestTimings.status = 'Unknown';
                }
            }
        }
    }


    if (results.geminiApi) {
        results.geminiApi.cacheContextMisses = Math.max(0, (results.geminiApi.cacheContextAttempts || 0) - (results.geminiApi.cacheContextHits || 0));
    }

    // --- STAGE 3.5: TÍNH TOÁN LẠI THỜI GIAN REQUEST TỪ CÁC CONFERENCE CON ---
    // Bước này để khắc phục trường hợp request bị lỗi và không có log start/end,
    // đảm bảo dữ liệu ở view tổng hợp và view chi tiết là nhất quán.
    for (const reqId of results.analyzedRequestIds) {
        const requestTimings = results.requests[reqId];
        if (!requestTimings) continue;

        // Chỉ tính toán lại nếu thông tin thời gian của request bị thiếu.
        if (requestTimings.startTime === null || requestTimings.endTime === null) {
            const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
                .filter(cd => cd.batchRequestId === reqId);

            if (conferencesForThisRequest.length > 0) {
                let minStartTime: number | null = null;
                let maxEndTime: number | null = null;

                conferencesForThisRequest.forEach(conf => {
                    if (conf.startTime) {
                        const startMs = new Date(conf.startTime).getTime();
                        if (!isNaN(startMs)) {
                            minStartTime = Math.min(startMs, minStartTime ?? startMs);
                        }
                    }
                    // Sử dụng endTime của conference, đã được tính toán chính xác ở các bước trước
                    if (conf.endTime) {
                        const endMs = new Date(conf.endTime).getTime();
                        if (!isNaN(endMs)) {
                            maxEndTime = Math.max(endMs, maxEndTime ?? endMs);
                        }
                    }
                });

                if (minStartTime !== null) {
                    requestTimings.startTime = new Date(minStartTime).toISOString();
                }
                if (maxEndTime !== null) {
                    requestTimings.endTime = new Date(maxEndTime).toISOString();
                }

                // Tính lại durationSeconds sau khi đã có startTime và endTime
                if (requestTimings.startTime && requestTimings.endTime) {
                    const start = new Date(requestTimings.startTime).getTime();
                    const end = new Date(requestTimings.endTime).getTime();
                    if (!isNaN(start) && !isNaN(end) && end >= start) {
                        requestTimings.durationSeconds = Math.round((end - start) / 1000);
                    } else {
                        requestTimings.durationSeconds = 0;
                    }
                }
            }
        }
    }
    // --- KẾT THÚC STAGE 3.5 ---






    // --- STAGE 4: Determine final overall analysis status and error message ---
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
                const errorMsgs = requestErrorMessagesMap.get(failedReqId);
                results.errorMessage = errorMsgs?.join('; ') || `Request ${failedReqId} failed.`;
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
                const errorMsgs = requestErrorMessagesMap.get(problemReqId);
                results.errorMessage = errorMsgs?.join('; ') || `Request ${problemReqId} completed with errors or failed.`;
            } else {
                // Lấy một vài thông điệp lỗi đầu tiên từ các request có vấn đề
                const collectedErrorMessages: string[] = [];
                let count = 0;
                for (const reqId of problematicRequestIds) {
                    if (count >= 2) break; // Lấy tối đa 2 message
                    const errorMsgs = requestErrorMessagesMap.get(reqId);
                    if (errorMsgs?.length) {
                        collectedErrorMessages.push(`Req ${reqId.slice(-6)}: ${errorMsgs[0]}`); // Lấy lỗi đầu tiên của request đó
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
            // Ưu tiên các trạng thái ít "hoàn hảo" hơn
            if (requestStatuses.some(s => s === 'PartiallyCompleted')) {
                results.status = 'PartiallyCompleted';
                results.errorMessage = 'Some requests were only partially completed.';
            } else if (requestStatuses.some(s => s === 'Unknown')) {
                results.status = 'Unknown';
                results.errorMessage = 'The status of some requests could not be determined.';
            } else if (requestStatuses.some(s => s === 'NoData')) {
                // Nếu tất cả là NoData, hoặc Completed/Skipped/NoData
                if (requestStatuses.every(s => s === 'NoData' || s === 'Completed' || s === 'Skipped')) {
                    if (requestStatuses.every(s => s === 'NoData')) {
                        results.status = 'Completed'; // Coi như completed nhưng không có data
                        results.errorMessage = 'All analyzed requests had no data to process.';
                    } else {
                        results.status = 'Completed';
                        results.errorMessage = 'All requests completed; some may have had no data or were skipped.';
                    }
                } else { // Trường hợp này khó xảy ra nếu logic trên đúng
                    results.status = 'PartiallyCompleted';
                    results.errorMessage = 'Requests completed with mixed results (some had no data).';
                }
            } else if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped')) {
                results.status = 'Completed';
                if (requestStatuses.some(s => s === 'Skipped')) {
                    results.errorMessage = 'All analyzed requests completed or were skipped.';
                } else {
                    // Không cần errorMessage nếu tất cả đều 'Completed' thuần túy
                }
            } else {
                // Fallback nếu logic trên chưa bao phủ hết (khó xảy ra)
                results.status = 'Completed'; // Mặc định là completed nếu không có lỗi rõ ràng
            }
        } else {
            // Trường hợp không khớp với bất kỳ logic nào ở trên (rất hiếm)
            results.status = 'Unknown';
            results.errorMessage = "The overall analysis status could not be determined due to an unexpected combination of request statuses.";
        }
    } else { // Không có request ID nào được phân tích
        results.status = "NoRequestsAnalyzed";
        results.errorMessage = "No requests were found matching the filter criteria for analysis.";
        // Nếu có filterRequestId được truyền vào, thông báo cụ thể hơn
        if (results.filterRequestId) {
            results.errorMessage = `Request ID '${results.filterRequestId}' not found or no logs available for it.`;
        }
    }

    // --- Đảm bảo errorMessage được đặt nếu status là Failed hoặc CompletedWithErrors và chưa có ---
    // Đoạn này có thể được tinh chỉnh hoặc gộp vào logic ở trên.
    if ((results.status === 'Failed' || results.status === 'CompletedWithErrors') && !results.errorMessage) {
        if (results.analyzedRequestIds.length === 1) {
            const reqId = results.analyzedRequestIds[0];
            const reqSummary = results.requests[reqId];
            if (reqSummary?.errorMessages?.length) {
                results.errorMessage = reqSummary.errorMessages.join('; ');
            } else if (reqSummary?.status === 'Failed') {
                results.errorMessage = `Request ${reqId} failed with an unspecified error.`;
            } else if (reqSummary?.status === 'CompletedWithErrors') {
                results.errorMessage = `Request ${reqId} completed with unspecified errors.`;
            }
        } else if (results.overall.failedOrCrashedTasks > 0) {
            results.errorMessage = `Analysis completed with ${results.overall.failedOrCrashedTasks} failed/crashed conference tasks across all requests.`;
        } else {
            results.errorMessage = `Analysis finished with status ${results.status}, but no specific error message was generated.`;
        }
    }

    // Nếu status là Completed nhưng có lỗi ở conference con, có thể đổi thành CompletedWithErrors
    if (results.status === 'Completed' && results.overall.failedOrCrashedTasks > 0) {
        results.status = 'CompletedWithErrors';
        if (!results.errorMessage) { // Chỉ đặt nếu chưa có errorMessage cụ thể hơn
            results.errorMessage = `Analysis completed, but ${results.overall.failedOrCrashedTasks} conference tasks failed or crashed.`;
        }
    }

    // Nếu không có lỗi gì và status là Completed, xóa errorMessage (nếu có từ các trường hợp khác)
    if (results.status === 'Completed' && results.overall.failedOrCrashedTasks === 0 && results.overall.processingTasks === 0) {
        // Kiểm tra xem có errorMessages nào ở các request con không
        const hasRequestLevelErrors = results.analyzedRequestIds.some(id => results.requests[id]?.errorMessages?.length > 0);
        if (!hasRequestLevelErrors) {
            results.errorMessage = undefined; // Xóa errorMessage nếu thực sự không có lỗi nào
        } else if (!results.errorMessage) {
            // Nếu có lỗi ở request con nhưng chưa có errorMessage tổng thể
            results.status = 'CompletedWithErrors'; // Nâng cấp status
            results.errorMessage = "Some requests completed but had internal processing issues.";
        }
    }
};