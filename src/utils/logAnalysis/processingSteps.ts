// src/utils/logAnalysis/processingSteps.ts
import {
    LogAnalysisResult,
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
    results: LogAnalysisResult,
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
    results: LogAnalysisResult,
    conferenceLastTimestamp: { [compositeKey: string]: number },
    analysisStartMillis: number | null,
    analysisEndMillis: number | null,
    filteredRequestsData: Map<string, RequestLogData>
): void => {

    // STAGE 0: Calculate Overall Duration (Giữ nguyên)
    if (analysisStartMillis !== null && analysisEndMillis !== null) {
        results.overall.startTime = new Date(analysisStartMillis).toISOString();
        results.overall.endTime = new Date(analysisEndMillis).toISOString();
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
            results.overall.durationSeconds = Math.round((maxConfEnd - minConfStart) / 1000);
        } else {
            results.overall.durationSeconds = 0;
        }
    }



    // --- STAGE 1: Determine/Update status for each conference (stuck tasks) and then initialize request timings ---
    // (Phần này có thể giữ nguyên, nhưng đảm bảo currentRequestTimings được khởi tạo đúng cách
    // và originalRequestId được gán. Các counter mới sẽ tính ở STAGE 3.)
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        let currentRequestTimings: RequestTimings = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            status: 'Unknown', // Trạng thái ban đầu của request timing object
            originalRequestId: results.requests[reqId]?.originalRequestId,
            // KHÔNG THÊM totalConferencesInputForRequest và processedConferencesCountForRequest ở đây
            // vì chúng sẽ được tính toán sau khi trạng thái của từng conference được xác định.
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

        // --- OLD LOGIC, WILL BE MOVED/REFINED IN STAGE 3 ---
        // if (conferencesForThisRequest.length === 0) {
        //     if (requestData && Array.isArray(requestData.logs) && requestData.logs.length > 0) {
        //         currentRequestTimings.status = 'Completed';
        //     } else {
        //         currentRequestTimings.status = 'NoData';
        //     }
        // } else {
        //     // ... OLD LOGIC TO DETERMINE STATUS ...
        // }
        // results.requests[reqId] = {
        //     ...(results.requests[reqId] || {}),
        //     ...currentRequestTimings
        // };
        // --- END OLD LOGIC ---

        // Khởi tạo/cập nhật RequestTimings cơ bản (thời gian, originalRequestId)
        // Các trạng thái (status) và số lượng conferences sẽ được tính toán lại sau.
        results.requests[reqId] = {
            ...(results.requests[reqId] || {}), // Giữ lại bất kỳ thông tin nào đã có
            startTime: currentRequestTimings.startTime,
            endTime: currentRequestTimings.endTime,
            durationSeconds: currentRequestTimings.durationSeconds,
            originalRequestId: currentRequestTimings.originalRequestId,
            // totalConferencesInputForRequest và processedConferencesCountForRequest sẽ được cập nhật ở STAGE 3
        };
    }
    // --- STAGE 2: Finalize Conference Details (duration, status based on sub-steps and CSV) ---
    // (Giữ nguyên phần lớn logic, chỉ đảm bảo nó tương tác đúng với 'processed_ok')
    Object.values(results.conferenceAnalysis).forEach(detail => {
        if (!results.analyzedRequestIds.includes(detail.batchRequestId)) {
            return;
        }

        let isCriticallyFailed = false;
        let criticalFailureReason = "";
        let criticalFailureEventKey = "";

        if (detail.steps) {
            if (detail.steps.gemini_extract_attempted && detail.steps.gemini_extract_success === false) {
                isCriticallyFailed = true;
                criticalFailureReason = "Gemini extract failed";
                criticalFailureEventKey = "gemini_extract_failed";
            }

            if (!isCriticallyFailed &&
                detail.steps.link_processing_attempted_count > 0 &&
                detail.steps.link_processing_success_count === 0 &&
                detail.status !== 'failed' && detail.status !== 'skipped') { // Kiểm tra status hiện tại
                isCriticallyFailed = true;
                criticalFailureReason = "All link processing attempts failed";
                criticalFailureEventKey = "all_links_failed";
            }
        }

        // Nếu một task đã là 'processed_ok' hoặc 'completed' nhưng phát hiện lỗi nghiêm trọng ở bước này
        if (isCriticallyFailed && detail.status !== 'failed' && detail.status !== 'skipped') {
            const oldStatus = detail.status;
            detail.status = 'failed'; // Ghi đè thành failed

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
            // Không cần cập nhật lại request status ở đây, vì STAGE 3 & 4 sẽ làm điều đó dựa trên status conference cuối cùng.
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

        // Logic xử lý lỗi ghi CSV
        // if (results.fileOutput &&
        //     results.fileOutput.csvFileGenerated === false && // CSV không được tạo
        //     (
        //         (results.fileOutput.csvPipelineFailures || 0) > 0 ||
        //         (results.fileOutput.csvOtherErrors || 0) > 0 // Hoặc có lỗi khác liên quan đến CSV
        //     )
        // ) {
        if (results.fileOutput && (results.fileOutput.csvPipelineFailures || 0) > 0) {

            // Áp dụng cho các conference không phải 'failed' hoặc 'skipped'
            if (detail.status !== 'failed' && detail.status !== 'skipped') {
                const oldConfStatus = detail.status; // Có thể là 'completed' (nếu CSV không phải bước cuối), 'processed_ok', 'processing'

                // Nếu JSONL ghi thành công nhưng CSV thất bại, conference này là 'failed'
                // Hoặc nếu JSONL không thành công, nó cũng là 'failed' (đã được xử lý bởi handler JSONL)
                // Điều kiện này đảm bảo rằng nếu CSV là một phần của pipeline thành công, thì nó phải thành công.
                // if (detail.jsonlWriteSuccess === true) { // Bỏ điều kiện này, nếu CSV pipeline fail thì task fail bất kể JSONL

                detail.status = 'failed';
                detail.csvWriteSuccess = false; // Đảm bảo cờ này đúng

                const csvFailureTimestamp = detail.endTime || // Giữ endTime hiện tại nếu có
                    (results.requests[detail.batchRequestId]?.endTime) ||
                    results.overall.endTime ||
                    new Date().toISOString();

                // Chỉ cập nhật endTime nếu thời điểm lỗi CSV muộn hơn endTime hiện tại
                if (!detail.endTime || (detail.endTime && new Date(csvFailureTimestamp).getTime() > new Date(detail.endTime).getTime())) {
                    detail.endTime = csvFailureTimestamp;
                }

                addConferenceError(
                    detail,
                    csvFailureTimestamp,
                    "Conference failed due to CSV generation pipeline failure.",
                    {
                        defaultMessage: "CSV generation pipeline failed for conference.",
                        keyPrefix: "csv_pipeline_failure_override_conf",
                        sourceService: 'FinalMetricsCalculation',
                        errorType: 'FileSystem',
                        context: {
                            phase: 'response_processing',
                            csvErrorSource: "pipeline_or_other",
                            originalStatus: oldConfStatus
                        }
                    }
                );
                // } // Kết thúc if (detail.jsonlWriteSuccess === true)
            } else if (detail.status === 'failed') {
                // Nếu đã failed từ trước, chỉ cần đảm bảo csvWriteSuccess là false
                detail.csvWriteSuccess = false;
            }
        }
    });

     // --- STAGE 3: Recalculate Overall Counts & Update Request Statuses AND Conference Counts ---
    // Đặt lại các counter tổng thể trước khi đếm lại
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
    results.overall.processedConferencesCount = uniqueConferenceKeysInAnalysis.size; // This is actually total conferences processed by log analysis, not input. Let's assume it maps to 'total input' for simplicity if no specific 'input' log.


    // --- Lặp lại các requests để cập nhật trạng thái VÀ CÁC THÔNG SỐ CONFERENCES ---
    for (const reqId of results.analyzedRequestIds) {
        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        const requestTimings = results.requests[reqId];
        if (!requestTimings) continue;

        // BẮT ĐẦU TÍNH TOÁN CÁC CHỈ SỐ MỚI CHO TỪNG REQUEST
        let currentReqProcessedConferences = 0;
        let currentReqTotalInputConferences = 0; // Giả sử mỗi confDetail là 1 input conference

        let numProcessing = 0, numFailed = 0, numCompleted = 0, numSkipped = 0, numProcessedOk = 0;

        // Duyệt qua các conference của request này để đếm và xác định trạng thái request
        for (const conf of conferencesForThisRequest) {
            currentReqTotalInputConferences++; // Mỗi conference detail được coi là một đầu vào
            if (conf.status === 'completed') {
                numCompleted++;
                currentReqProcessedConferences++; // 'Completed' là trạng thái processed thành công
            } else if (conf.status === 'processed_ok') {
                numProcessedOk++;
                currentReqProcessedConferences++; // 'processed_ok' cũng được coi là processed thành công (chờ CSV)
            } else if (conf.status === 'processing') {
                numProcessing++;
            } else if (conf.status === 'failed') {
                numFailed++;
            } else if (conf.status === 'skipped') {
                numSkipped++;
            }
            // 'unknown' không đếm vào các nhóm này
        }

        // CẬP NHẬT CÁC THÔNG SỐ VÀO RequestTimings
        requestTimings.totalConferencesInputForRequest = currentReqTotalInputConferences;
        requestTimings.processedConferencesCountForRequest = currentReqProcessedConferences;


        // LÀM LẠI LOGIC XÁC ĐỊNH TRẠNG THÁI CỦA REQUEST
        if (conferencesForThisRequest.length === 0) {
             // Nếu không có conference nào được phân tích cho request này,
             // nhưng requestData có log, có thể coi là completed.
             // Nếu không có log, thì là NoData.
            const requestData = filteredRequestsData.get(reqId);
            if (requestData && Array.isArray(requestData.logs) && requestData.logs.length > 0) {
                requestTimings.status = 'Completed'; // Request có log nhưng không có conference nào được phân tích
            } else {
                requestTimings.status = 'NoData'; // Request không có log
            }
        } else {
            const totalTasksInRequest = conferencesForThisRequest.length;
            const FAILED_THRESHOLD_PERCENT = 0.15;

            if (numProcessing > 0 || numProcessedOk > 0) {
                requestTimings.status = 'Processing';
            } else {
                if (numFailed === totalTasksInRequest) { // Tất cả các tasks đều failed
                    requestTimings.status = 'Failed';
                } else if (numFailed > 0) { // Có ít nhất một task failed
                    if ((numFailed / totalTasksInRequest) > FAILED_THRESHOLD_PERCENT) {
                        requestTimings.status = 'CompletedWithErrors'; // Nhiều lỗi đáng kể
                    } else {
                        // Ít lỗi hơn ngưỡng, kiểm tra các task khác
                        if ((numCompleted + numProcessedOk + numSkipped) === (totalTasksInRequest - numFailed)) {
                            // Tất cả các task không failed đều completed, processed_ok, hoặc skipped
                            requestTimings.status = 'Completed'; // Coi là completed nếu lỗi ít và phần còn lại OK
                        } else {
                            requestTimings.status = 'CompletedWithErrors'; // Có lỗi và có task chưa rõ ràng (unknown)
                        }
                    }
                } else if ((numCompleted + numProcessedOk) === totalTasksInRequest || ((numCompleted + numProcessedOk + numSkipped) === totalTasksInRequest && totalTasksInRequest > 0)) {
                    // Không có lỗi, và tất cả đều completed/processed_ok hoặc (completed/processed_ok + skipped)
                    requestTimings.status = 'Completed';
                } else if (numSkipped === totalTasksInRequest && totalTasksInRequest > 0) {
                    // Tất cả đều skipped
                    requestTimings.status = 'Skipped';
                } else if (numCompleted > 0 || numProcessedOk > 0 || numSkipped > 0) {
                    // Có một số completed/processed_ok/skipped, nhưng không phải tất cả (và không có processing/failed)
                    // Điều này có nghĩa là có một số task ở trạng thái 'unknown'
                    requestTimings.status = 'PartiallyCompleted';
                } else {
                    // Không có processing, processed_ok, failed, completed, skipped.
                    // Tất cả các task phải là 'unknown'.
                    requestTimings.status = 'Unknown';
                }
            }
        }
    }


    if (results.geminiApi) {
        results.geminiApi.cacheContextMisses = Math.max(0, (results.geminiApi.cacheContextAttempts || 0) - (results.geminiApi.cacheContextHits || 0));
    }

    // --- STAGE 4: Determine final overall analysis status (Dựa trên request statuses đã chốt) ---
    if (results.analyzedRequestIds.length > 0) {
        const requestStatuses = results.analyzedRequestIds.map(id => results.requests[id]?.status);

        if (requestStatuses.some(s => s === 'Processing')) {
            results.status = 'Processing';
        } else if (requestStatuses.every(s => s === 'Failed')) {
            results.status = 'Failed';
        } else if (requestStatuses.some(s => s === 'Failed' || s === 'CompletedWithErrors')) {
            results.status = 'CompletedWithErrors';
        } else if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'PartiallyCompleted' || s === 'NoData' || s === 'Unknown')) { // Thêm Unknown
            if (requestStatuses.every(s => s === 'Completed' || s === 'Skipped' || s === 'NoData')) {
                results.status = 'Completed';
            } else if (requestStatuses.some(s => s === 'PartiallyCompleted')) {
                results.status = 'PartiallyCompleted';
            } else if (requestStatuses.some(s => s === 'Unknown') && !requestStatuses.some(s => s === 'Completed' || s === 'Skipped' || s === 'PartiallyCompleted')) {
                results.status = 'Unknown'; // Nếu chỉ có Unknown và NoData
            }
            else { // Mặc định là Completed nếu không rơi vào các trường hợp trên (ví dụ: mix của Completed và Unknown)
                results.status = 'Completed';
            }
        } else {
            results.status = 'Unknown'; // Trường hợp không xác định được
        }
    } else {
        results.status = "NoRequestsAnalyzed";
    }
};