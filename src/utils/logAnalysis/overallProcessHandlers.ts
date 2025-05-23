// src/utils/logAnalysis/overallProcessHandlers.ts
import { LogEventHandler } from './index';
import { createConferenceKey } from './helpers'; // Đảm bảo helper này tồn tại và đúng
import { OverallAnalysis, getInitialOverallAnalysis, LogAnalysisResult } from '../../types'; // Thêm LogAnalysisResult

// Khởi tạo overall analysis nếu chưa có
const ensureOverallAnalysis = (results: LogAnalysisResult): OverallAnalysis => { // Sửa any thành LogAnalysisResult
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis(); // Tái sử dụng ở đây!
    }
    return results.overall as OverallAnalysis;
};

export const handleCrawlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentEventStartTime = logEntry.startTime || entryTimestampISO;
    if (!overall.startTime || new Date(currentEventStartTime) < new Date(overall.startTime)) {
        overall.startTime = currentEventStartTime;
    }
    if (logEntry.totalConferences && typeof logEntry.totalConferences === 'number') {
        overall.totalConferencesInput = (overall.totalConferencesInput || 0) + logEntry.totalConferences;
    }
};

export const handleControllerProcessingFinished: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);
    const currentBatchRequestId = logEntry.batchRequestId as string | undefined; // ID của request hiện tại (re-crawl request)

    if (logEntry.event === 'processing_finished_successfully') {
        results.status = 'Completed';
        overall.endTime = logEntry.context?.endTime || entryTimestampISO;

        if (overall.startTime && overall.endTime) {
            try {
                const start = new Date(overall.startTime).getTime();
                const end = new Date(overall.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    overall.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        const controllerContext = logEntry.context || {};
        const processedDataFromController = controllerContext.processedResults;

        if (processedDataFromController && Array.isArray(processedDataFromController) && currentBatchRequestId) {
            let foundOriginalIdForOverallRequest: string | undefined = undefined;

            processedDataFromController.forEach((resultItem: any) => {
                const acronym = resultItem.acronym;
                const title = resultItem.title;
                // `resultItem.requestId` trong log của bạn là `batchRequestId` của re-crawl.
                // `resultItem.originalRequestId` là cái chúng ta quan tâm.

                const compositeKey = createConferenceKey(currentBatchRequestId, acronym, title);

                if (compositeKey && results.conferenceAnalysis[compositeKey]) {
                    const detailToUpdate = results.conferenceAnalysis[compositeKey];
                    detailToUpdate.finalResult = resultItem; // Gán toàn bộ final result

                    // <<< CẬP NHẬT ORIGINAL_REQUEST_ID CHO CONFERENCE_ANALYSIS_DETAIL (FALLBACK) >>>
                    // Nếu `handleRecrawlDetected` chưa gán, hoặc event đó không có,
                    // thì lấy từ finalResult của conference.
                    if (resultItem.originalRequestId && !detailToUpdate.originalRequestId) {
                        detailToUpdate.originalRequestId = resultItem.originalRequestId;
                    }

                    // Thu thập originalRequestId cho request tổng thể (nếu chưa có)
                    if (resultItem.originalRequestId && !foundOriginalIdForOverallRequest) {
                        foundOriginalIdForOverallRequest = resultItem.originalRequestId;
                    }

                } else if (acronym || title) {
                    // console.warn(`Conference detail not found for key derived from controller result: ${compositeKey}`);
                }
            });

            // Gán originalRequestId cho request hiện tại (currentBatchRequestId) nếu tìm thấy
            // và request đó chưa có thông tin này (ưu tiên thông tin từ conf.originalRequestId trong calculateFinalMetrics).
            // Đoạn này có thể không cần thiết nếu calculateFinalMetrics đã xử lý tốt.
            // Tuy nhiên, nó có thể hữu ích nếu `recrawl_detected` không được log cho từng conference.
            if (foundOriginalIdForOverallRequest && results.requests[currentBatchRequestId] && !results.requests[currentBatchRequestId].originalRequestId) {
                results.requests[currentBatchRequestId].originalRequestId = foundOriginalIdForOverallRequest;
            }
        }
    } else if (logEntry.event === 'processing_failed_in_controller') {
        results.status = 'Failed';
        results.errorMessage = logEntry.err || logEntry.msg || "Processing failed at controller level";
        overall.endTime = logEntry.context?.endTime || entryTimestampISO;
        if (overall.startTime && overall.endTime) {
            try {
                const start = new Date(overall.startTime).getTime();
                const end = new Date(overall.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    overall.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }
    }
};