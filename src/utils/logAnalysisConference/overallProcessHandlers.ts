// src/utils/logAnalysis/overallProcessHandlers.ts
import { LogEventHandler } from './index';
import { createConferenceKey } from './helpers';
import { OverallAnalysis, getInitialOverallAnalysis, ConferenceLogAnalysisResult, RequestTimings } from '../../types/logAnalysis';

// Khởi tạo overall analysis nếu chưa có
const ensureOverallAnalysis = (results: ConferenceLogAnalysisResult): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};

// Handler mới cho sự kiện 'received_request'
export const handleReceivedRequest: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const currentBatchRequestId = logEntry.batchRequestId as string | undefined;
    const requestDescription = logEntry.requestDescription as string | undefined; // Lấy từ trường log mới
    const requestStartTime = entryTimestampISO; // Thời gian của log entry này là startTime của request

    if (currentBatchRequestId) {
        if (!results.requests[currentBatchRequestId]) {
            results.requests[currentBatchRequestId] = {
                startTime: requestStartTime,
                endTime: null,
                durationSeconds: null,
                errorMessages: [],
                description: requestDescription, // Gán description ở đây
                status: 'Processing', // Mặc định là Processing khi nhận request
                // Các trường khác sẽ được cập nhật sau
            };
        } else {
            // Nếu request đã tồn tại (ít khả năng cho 'received_request' nhưng để an toàn)
            // Ưu tiên gán description nếu chưa có hoặc cập nhật nếu cần
            if (requestDescription && !results.requests[currentBatchRequestId].description) {
                results.requests[currentBatchRequestId].description = requestDescription;
            }
            // Cập nhật startTime nếu log entry này sớm hơn
            if (!results.requests[currentBatchRequestId].startTime || new Date(requestStartTime) < new Date(results.requests[currentBatchRequestId].startTime!)) {
                 results.requests[currentBatchRequestId].startTime = requestStartTime;
            }
        }

        // Cập nhật overall start time nếu cần
        const overall = ensureOverallAnalysis(results);
        if (!overall.startTime || new Date(requestStartTime) < new Date(overall.startTime)) {
            overall.startTime = requestStartTime;
        }
    }
};


export const handleCrawlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentEventStartTime = logEntry.context?.operationStartTime || entryTimestampISO; // Giả sử operationStartTime có trong context
    if (!overall.startTime || new Date(currentEventStartTime) < new Date(overall.startTime)) {
        overall.startTime = currentEventStartTime;
    }
    if (logEntry.context?.totalConferences && typeof logEntry.context.totalConferences === 'number') {
        overall.totalConferencesInput = (overall.totalConferencesInput || 0) + logEntry.context.totalConferences;
    } else if (logEntry.totalConferences && typeof logEntry.totalConferences === 'number') { // Fallback
         overall.totalConferencesInput = (overall.totalConferencesInput || 0) + logEntry.totalConferences;
    }
};

export const handleControllerProcessingFinished: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentBatchRequestId = logEntry.batchRequestId as string | undefined;

    if (currentBatchRequestId && !results.requests[currentBatchRequestId]) {
        // Trường hợp này ít xảy ra nếu 'received_request' luôn được log trước
        // nhưng để an toàn, khởi tạo một phần
        results.requests[currentBatchRequestId] = {
            startTime: null, // Sẽ được set bởi 'received_request' hoặc calculateFinalMetrics
            endTime: null,
            durationSeconds: null,
            errorMessages: [],
        };
    }
    
    const requestTimingForCurrentBatch = currentBatchRequestId ? results.requests[currentBatchRequestId] : undefined;

    if (logEntry.event === 'processing_finished_successfully') {
        // results.status = 'Completed'; // Trạng thái tổng thể của analysis, sẽ được tinh chỉnh trong calculateFinalMetrics
        overall.endTime = logEntry.context?.operationEndTime || entryTimestampISO;

        const controllerContext = logEntry.context || {};
        const processedDataFromController = controllerContext.processedResults;
        // const requestDescriptionFromLog = controllerContext.requestDescription as string | undefined; // <<< BỎ LẤY DESCRIPTION Ở ĐÂY >>>

        // // Gán description cho request hiện tại <<< BỎ >>>
        // if (requestTimingForCurrentBatch && requestDescriptionFromLog && !requestTimingForCurrentBatch.description) {
        //     // Chỉ gán nếu chưa có, ưu tiên từ 'received_request'
        //     requestTimingForCurrentBatch.description = requestDescriptionFromLog;
        // }

        // Gán thời gian kết thúc cho request hiện tại
        if (requestTimingForCurrentBatch && controllerContext.operationEndTime) {
            requestTimingForCurrentBatch.endTime = controllerContext.operationEndTime;
            // Có thể cập nhật status của request cụ thể này thành 'Completed' ở đây,
            // nhưng calculateFinalMetrics sẽ làm điều này một cách toàn diện hơn.
            if (!requestTimingForCurrentBatch.status || requestTimingForCurrentBatch.status === 'Processing') {
                requestTimingForCurrentBatch.status = 'Completed'; // Tạm thời, sẽ được review bởi calculateFinalMetrics
            }
        }

        // ... (phần xử lý processedDataFromController và originalRequestId giữ nguyên) ...
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
        // results.status = 'Failed'; // Trạng thái tổng thể của analysis
        results.errorMessage = logEntry.err?.message || logEntry.err || logEntry.msg || "Processing failed at controller level";
        overall.endTime = logEntry.context?.operationEndTime || entryTimestampISO;

        const controllerContext = logEntry.context || {};
        // const requestDescriptionFromLog = controllerContext.requestDescription as string | undefined; // <<< BỎ LẤY DESCRIPTION Ở ĐÂY >>>

        if (requestTimingForCurrentBatch) {
            // if (requestDescriptionFromLog && !requestTimingForCurrentBatch.description) { // <<< BỎ >>>
            //     requestTimingForCurrentBatch.description = requestDescriptionFromLog;
            // }
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