// src/utils/logAnalysis/overallProcessHandlers.ts
import { LogEventHandler } from './index';
import { createConferenceKey } from './helpers';
import { OverallAnalysis, ConferenceAnalysisDetail } from '../../types/logAnalysis.types';

// Khởi tạo overall analysis nếu chưa có (đã có trong taskLifecycleHandlers, nhưng có thể cần ở đây nếu event này đến trước)
const ensureOverallAnalysis = (results: any): OverallAnalysis => {
    if (!results.overall) {
        results.overall = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            totalConferencesInput: 0, // Đảm bảo khởi tạo là 0
            processedConferencesCount: 0,
            completedTasks: 0,
            failedOrCrashedTasks: 0,
            processingTasks: 0,
            skippedTasks: 0,
            successfulExtractions: 0,
        };
    }
    return results.overall as OverallAnalysis;
};

export const handleCrawlStart: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    // Lấy startTime từ logEntry nếu có, vì đó là thời điểm bắt đầu thực sự của event này
    // overall.startTime nên là thời điểm sớm nhất của tất cả các crawl_start
    const currentEventStartTime = logEntry.startTime || entryTimestampISO;
    if (!overall.startTime || new Date(currentEventStartTime) < new Date(overall.startTime)) {
        overall.startTime = currentEventStartTime;
    }

    // totalConferencesInput cần được cộng dồn từ các event crawl_start
    if (logEntry.totalConferences && typeof logEntry.totalConferences === 'number') {
        // Sử dụng (overall.totalConferencesInput || 0) để đảm bảo an toàn nếu nó chưa được khởi tạo
        // mặc dù ensureOverallAnalysis đã làm điều đó.
        overall.totalConferencesInput = (overall.totalConferencesInput || 0) + logEntry.totalConferences;
    }
};

// Đổi tên handler cho rõ ràng hơn về việc nó xử lý event từ controller
export const handleControllerProcessingFinished: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const overall = ensureOverallAnalysis(results);

    // Event 'processing_finished_successfully' từ controller báo hiệu toàn bộ request đã hoàn thành.
    // (Không phải là `crawl_end_success` vì "crawl" là 1 phần)
    if (logEntry.event === 'processing_finished_successfully') {
        results.status = 'Completed'; // Đánh dấu toàn bộ phân tích log là hoàn thành
        overall.endTime = entryTimestampISO; // Thời điểm log entry này được xử lý

        // Context từ log entry của controller
        const controllerContext = logEntry.context || {};

        // Nếu controller log thời gian kết thúc thực sự của nó
        if (controllerContext.endTime) {
            overall.endTime = controllerContext.endTime;
        }

        // Tính duration tổng thể
        if (overall.startTime && overall.endTime) {
            try {
                const start = new Date(overall.startTime).getTime();
                const end = new Date(overall.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    overall.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore date parsing error */ }
        }

        // Xử lý results (final data) từ controller nếu có
        // logEntry.context.processed_results là nơi controller nên đặt mảng kết quả
        const processedDataFromController = controllerContext.processed_results;
        if (processedDataFromController && Array.isArray(processedDataFromController)) {
            processedDataFromController.forEach((resultItem: any) => {
                const acronym = resultItem.acronym;
                const title = resultItem.title;
                const currentRequestId = resultItem.requestId; // <<< Lấy requestId từ log entry của controller

                const compositeKey = createConferenceKey(currentRequestId, acronym, title);

                if (compositeKey && results.conferenceAnalysis[compositeKey]) {
                    const detailToUpdate = results.conferenceAnalysis[compositeKey] as ConferenceAnalysisDetail;
                    // Gán vào finalResult vì đây là dữ liệu cuối cùng sau khi qua ResultProcessingService
                    detailToUpdate.finalResult = resultItem;

                    // Cập nhật các trường khác nếu cần, ví dụ, trạng thái cuối cùng
                    // Dựa vào logic: Nếu có finalResult, và các bước trước đó không failed,
                    // và CSV write thành công (từ event khác), thì mới là 'completed' thực sự.
                    // Ở đây, chỉ lưu trữ finalResult. Trạng thái 'completed' của conference
                    // nên được quản lý bởi handleCsvWriteSuccess.

                } else if (acronym || title || currentRequestId) {
                    // logger.warn({...})
                }
            });
        }
    } else if (logEntry.event === 'processing_failed_in_controller') { // Event mới nếu controller fail
        results.status = 'Failed';
        results.errorMessage = logEntry.err || logEntry.msg || "Processing failed at controller level";
        overall.endTime = entryTimestampISO;
        if (logEntry.context?.endTime) {
            overall.endTime = logEntry.context.endTime;
        }
        // Tính duration
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