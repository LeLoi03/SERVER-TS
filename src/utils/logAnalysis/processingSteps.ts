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


    // --- STAGE 1: Determine/Update status for each conference (stuck tasks) and then for each request ---
    for (const reqId of results.analyzedRequestIds) {
        const requestData = filteredRequestsData.get(reqId);
        let currentRequestTimings: RequestTimings = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            status: 'Unknown', // Trạng thái ban đầu của request timing object
            originalRequestId: results.requests[reqId]?.originalRequestId,
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

        if (requestEndTimeISO) { // Chỉ áp dụng logic "stuck task" nếu request cha đã có endTime
            const requestEndTimeMillis = new Date(requestEndTimeISO).getTime();

            conferencesForThisRequest.forEach(conf => {
                if (!conf.endTime && (conf.status === 'processing' || conf.status === 'processed_ok')) {
                    const confKeyForTimestamp = createConferenceKey(conf.batchRequestId, conf.acronym, conf.title);
                    const lastLogTimeForThisConferenceMillis = confKeyForTimestamp ? conferenceLastTimestamp[confKeyForTimestamp] : null;
                    const confStartTimeMillis = conf.startTime ? new Date(conf.startTime).getTime() : null;

                    let isConsideredStuck = true; // Mặc định là stuck

                    if (lastLogTimeForThisConferenceMillis !== null) {
                        // Tiêu chí 1: Conference chỉ vừa mới bắt đầu và chưa có log hoạt động nào đáng kể sau đó.
                        // (lastLogTime <= startTime có nghĩa là chỉ có log task_start hoặc các log cùng thời điểm)
                        if (confStartTimeMillis !== null && lastLogTimeForThisConferenceMillis <= confStartTimeMillis) {
                            isConsideredStuck = false;
                        } else {
                            // Tiêu chí 2: Log cuối cùng của conference này không quá xa so với thời điểm kết thúc của request cha.
                            // Nếu khoảng cách này nhỏ, có thể luồng log của request cha đã dừng đột ngột.
                            // Ngưỡng này có thể cần điều chỉnh. Ví dụ: 2-5 giây.
                            const MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS = 3000; // 3 giây

                            if ((requestEndTimeMillis - lastLogTimeForThisConferenceMillis) < MAX_ALLOWED_SILENCE_BEFORE_REQUEST_END_MS) {
                                // Nếu thời gian từ log cuối của conference đến khi request cha kết thúc là nhỏ,
                                // thì không coi là stuck.
                                // Điều này bao gồm cả trường hợp log cuối của conference chính là log cuối của request.
                                isConsideredStuck = false;
                            }
                        }
                    }
                    // Nếu confStartTimeMillis hoặc lastLogTimeForThisConferenceMillis là null,
                    // isConsideredStuck sẽ vẫn là true (mặc định an toàn).

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
                    // else {
                    //    // Nếu isConsideredStuck là false, conference này sẽ giữ nguyên status 'processing' (hoặc 'processed_ok').
                    //    // Nó sẽ được tính là 'Processing' cho request cha và cho tổng thể (nếu chưa có endTime).
                    // }
                }
            });
        }

        if (conferencesForThisRequest.length === 0) {
            if (requestData && Array.isArray(requestData.logs) && requestData.logs.length > 0) {
                currentRequestTimings.status = 'Completed'; // Request có log nhưng không có conference nào được phân tích
            } else {
                currentRequestTimings.status = 'NoData'; // Request không có log
            }
        } else {
            let numProcessing = 0;
            let numFailed = 0;
            let numCompleted = 0;
            let numSkipped = 0;
            let numProcessedOk = 0; // <--- THÊM BIẾN ĐẾM CHO PROCESSED_OK

            for (const conf of conferencesForThisRequest) {
                // Điều chỉnh cách đếm numProcessing:
                // Một conference là "processing" nếu status của nó là 'processing' HOẶC 'processed_ok' (chờ CSV)
                // và nó chưa có endTime.
                // Tuy nhiên, ở bước này, nếu nó là 'processed_ok' và không có endTime,
                // và request cha có endTime, nó đã bị chuyển thành 'failed' ở trên.
                // Nên ta chỉ cần đếm các status hiện tại.

                if (conf.status === 'processing') {
                    numProcessing++;
                } else if (conf.status === 'processed_ok') { // <--- ĐẾM PROCESSED_OK
                    numProcessedOk++;
                } else if (conf.status === 'failed') {
                    numFailed++;
                } else if (conf.status === 'completed') {
                    numCompleted++;
                } else if (conf.status === 'skipped') {
                    numSkipped++;
                }
                // Conference với status 'unknown' không được tính vào các nhóm này,
                // chúng sẽ ảnh hưởng đến logic 'PartiallyCompleted' hoặc 'Unknown' của request.
            }

            const totalTasksInRequest = conferencesForThisRequest.length;
            const FAILED_THRESHOLD_PERCENT = 0.15; // Giữ nguyên ngưỡng này

            // THAY ĐỔI: Request vẫn là 'Processing' nếu có bất kỳ conference nào là 'processing' HOẶC 'processed_ok'
            if (numProcessing > 0 || numProcessedOk > 0) {
                currentRequestTimings.status = 'Processing';
            } else {
                // Logic còn lại để xác định Failed, CompletedWithErrors, Completed, Skipped, PartiallyCompleted, Unknown
                if (numFailed === totalTasksInRequest && totalTasksInRequest > 0) {
                    currentRequestTimings.status = 'Failed';
                } else if (numFailed > 0) {
                    // Nếu có lỗi, nhưng không phải tất cả đều lỗi
                    if ((numFailed / totalTasksInRequest) > FAILED_THRESHOLD_PERCENT) {
                        currentRequestTimings.status = 'CompletedWithErrors'; // Nhiều lỗi đáng kể
                    } else {
                        // Ít lỗi hơn ngưỡng
                        if ((numCompleted + numSkipped) === (totalTasksInRequest - numFailed)) {
                            // Tất cả các task không failed đều completed hoặc skipped
                            currentRequestTimings.status = 'Completed'; // Coi là completed nếu lỗi ít và phần còn lại OK
                        } else {
                            currentRequestTimings.status = 'CompletedWithErrors'; // Có lỗi và có task chưa rõ ràng (unknown)
                        }
                    }
                } else if (numCompleted === totalTasksInRequest || ((numCompleted + numSkipped) === totalTasksInRequest && totalTasksInRequest > 0)) {
                    // Không có lỗi, và tất cả đều completed hoặc (completed + skipped)
                    currentRequestTimings.status = 'Completed';
                } else if (numSkipped === totalTasksInRequest && totalTasksInRequest > 0) {
                    // Tất cả đều skipped
                    currentRequestTimings.status = 'Skipped';
                } else if (numCompleted > 0 || numSkipped > 0) {
                    // Có một số completed hoặc skipped, nhưng không phải tất cả (và không có processing/processed_ok/failed)
                    // Điều này có nghĩa là có một số task ở trạng thái 'unknown'
                    currentRequestTimings.status = 'PartiallyCompleted';
                }
                else {
                    // Không có processing, processed_ok, failed, completed, skipped.
                    // Tất cả các task phải là 'unknown' (hoặc không có task nào).
                    // Nếu có task, và chúng là 'unknown', thì request là 'Unknown'.
                    if (totalTasksInRequest > 0) {
                        currentRequestTimings.status = 'Unknown';
                    } else {
                        // Trường hợp này đã được xử lý bởi `conferencesForThisRequest.length === 0` ở trên.
                        // Để an toàn, nếu không có task nào, có thể đặt là 'NoData' hoặc 'Completed' tùy theo ngữ cảnh.
                        // Giả sử `conferencesForThisRequest.length === 0` đã xử lý đúng.
                        currentRequestTimings.status = 'Unknown'; // Mặc định cuối cùng
                    }
                }
            }
        }
        results.requests[reqId] = {
            ...(results.requests[reqId] || {}),
            ...currentRequestTimings
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

    // --- STAGE 3: Recalculate Overall Counts & Request Statuses (Dựa trên status conference đã chốt ở STAGE 2) ---
    // Đặt lại các counter tổng thể trước khi đếm lại
    results.overall.completedTasks = 0;
    results.overall.failedOrCrashedTasks = 0;
    results.overall.skippedTasks = 0;
    results.overall.processingTasks = 0; // Sẽ bao gồm cả 'processing' và 'processed_ok' cho mục đích hiển thị

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
                // Cho mục đích đếm tổng thể "đang xử lý", gộp cả hai
                results.overall.processingTasks++;
            }
        }
    });
    results.overall.processedConferencesCount = uniqueConferenceKeysInAnalysis.size;


    // SAU KHI CẬP NHẬT TẤT CẢ CONFERENCE STATUS, TÍNH LẠI REQUEST STATUS
    for (const reqId of results.analyzedRequestIds) {
        const conferencesForThisRequest = Object.values(results.conferenceAnalysis)
            .filter(cd => cd.batchRequestId === reqId);

        const requestTimings = results.requests[reqId]; // Lấy lại request timings đã có startTime, endTime
        if (!requestTimings) continue; // Bỏ qua nếu không tìm thấy request

        if (conferencesForThisRequest.length === 0) {
            // Status đã được set ở STAGE 1, không đổi
        } else {
            let numProcessing = 0, numFailed = 0, numCompleted = 0, numSkipped = 0, numProcessedOk = 0;
            for (const conf of conferencesForThisRequest) {
                if (conf.status === 'processing') numProcessing++;
                else if (conf.status === 'processed_ok') numProcessedOk++;
                else if (conf.status === 'failed') numFailed++;
                else if (conf.status === 'completed') numCompleted++;
                else if (conf.status === 'skipped') numSkipped++;
            }

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
                        if ((numCompleted + numSkipped) === (totalTasksInRequest - numFailed)) {
                            requestTimings.status = 'Completed'; // Ít lỗi, còn lại xong -> Completed
                        } else {
                            requestTimings.status = 'CompletedWithErrors'; // Ít lỗi, nhưng có gì đó chưa xong (unknown)
                        }
                    }
                } else if (numCompleted === totalTasksInRequest || (numCompleted + numSkipped) === totalTasksInRequest) {
                    requestTimings.status = 'Completed';
                } else if (numSkipped === totalTasksInRequest) {
                    requestTimings.status = 'Skipped';
                } else if (numCompleted > 0 || numSkipped > 0) {
                    requestTimings.status = 'PartiallyCompleted'; // Có completed/skipped, nhưng có cả unknown
                } else {
                    requestTimings.status = 'Unknown'; // Tất cả là unknown
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