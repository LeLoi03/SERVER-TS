// src/utils/logAnalysis/fileOutputHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { createConferenceKey } from './helpers'; // Đảm bảo đường dẫn đúng
import { OverallAnalysis, FileOutputAnalysis, getInitialFileOutputAnalysis, getInitialOverallAnalysis } from '../../types';

// Khởi tạo fileOutput trong results nếu chưa có
const ensureFileOutputAnalysis = (results: any): FileOutputAnalysis => {
    if (!results.fileOutput) {
        results.fileOutput = getInitialFileOutputAnalysis(); // Tái sử dụng ở đây!
    }
    return results.fileOutput as FileOutputAnalysis;
};

const ensureOverallAnalysis = (results: any): OverallAnalysis => {
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis(); // Tái sử dụng ở đây!
    }
    return results.overall as OverallAnalysis;
};
export const handleCsvWriteSuccess: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const fileOutput = ensureFileOutputAnalysis(results);
    const overall = ensureOverallAnalysis(results); // Đảm bảo có overall

    const acronym = logEntry.conferenceAcronym;
    const title = logEntry.conferenceTitle;
    const batchRequestId = logEntry.batchRequestId; // <<< RẤT QUAN TRỌNG

    if (!batchRequestId) {
        // console.warn("CSV write success event is missing batchRequestId:", logEntry);
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        return;
    }
    if (!acronym || !title) {
        // console.warn("CSV write success event is missing conference info (acronym/title):", logEntry);
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        return;
    }

    const compositeKey = createConferenceKey(batchRequestId, acronym, title);


    if (compositeKey && results.conferenceAnalysis[compositeKey]) {
        const confDetail = results.conferenceAnalysis[compositeKey];

        // Chỉ cập nhật nếu chưa phải là 'completed' từ một nguồn khác (ít khả năng nhưng để an toàn)
        // Hoặc nếu nó đang ở trạng thái 'failed' và giờ đã thành công (phục hồi)
        const previousStatus = confDetail.status;

        confDetail.csvWriteSuccess = true;
        confDetail.status = 'completed';
        if (!confDetail.endTime) {
            confDetail.endTime = entryTimestampISO; // Hoặc logEntry.time nếu có
        }
        if (confDetail.startTime && confDetail.endTime && !confDetail.durationSeconds) {
            try {
                const start = new Date(confDetail.startTime).getTime();
                const end = new Date(confDetail.endTime).getTime();
                if (!isNaN(start) && !isNaN(end) && end >= start) {
                    confDetail.durationSeconds = Math.round((end - start) / 1000);
                }
            } catch (e) { /* ignore */ }
        }

        fileOutput.csvRecordsSuccessfullyWritten = (fileOutput.csvRecordsSuccessfullyWritten || 0) + 1;

        // Cập nhật overall counters
        // Chỉ tăng completedTasks nếu nó chưa được tính là completed trước đó
        if (previousStatus !== 'completed') {
            overall.completedTasks = (overall.completedTasks || 0) + 1;
        }
        // Nếu task trước đó bị failed và giờ completed, giảm failed count
        if (previousStatus === 'failed') {
            overall.failedOrCrashedTasks = Math.max(0, (overall.failedOrCrashedTasks || 0) - 1);
        }
        // Nếu task trước đó bị skipped và giờ completed (ít xảy ra nhưng có thể)
        if (previousStatus === 'skipped') {
            overall.skippedTasks = Math.max(0, (overall.skippedTasks || 0) - 1);
        }
        // Nếu task này trước đó được tính là failed, cần giảm failedOrCrashedTasks
        // Điều này phức tạp và nên được xử lý cẩn thận, có thể dựa trên trạng thái trước đó của task
        // Ví dụ: if (confDetail.previousStatus === 'failed') overall.failedOrCrashedTasks--;

    } else {
        // console.warn(`CSV write success for key '${compositeKey}', but conference detail not found. LogEntry:`, logEntry);
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
    }
};


export const handleJsonlWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // confDetail ở đây là confDetail của conference mà event này thuộc về, được tìm bởi getConferenceDetail
    const fileOutputStats = ensureFileOutputAnalysis(results);
    if (confDetail) {
        confDetail.jsonlWriteSuccess = true;
        // Không set status = 'completed' ở đây, chỉ khi CSV thành công
        // endTime của conference sẽ được cập nhật bởi event cuối cùng (thường là CSV success/failed)
        fileOutputStats.jsonlRecordsSuccessfullyWritten = (fileOutputStats.jsonlRecordsSuccessfullyWritten || 0) + 1;
    } else {
        // Trường hợp này ít xảy ra nếu getConferenceDetail hoạt động đúng,
        // vì event 'save_batch_append_success' thường có acronym/title.
    }
};

export const handleJsonlWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // confDetail ở đây là confDetail của conference mà event này thuộc về
    const fileOutputStats = ensureFileOutputAnalysis(results);
    const overallStats = ensureOverallAnalysis(results); // Đảm bảo overall stats tồn tại

    const error = logEntry.err || logEntry.reason || logEntry.msg || 'Jsonl record write failed';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    fileOutputStats.jsonlWriteErrors = (fileOutputStats.jsonlWriteErrors || 0) + 1;

    if (confDetail) {
        if (confDetail.status !== 'failed') {
            overallStats.failedOrCrashedTasks = (overallStats.failedOrCrashedTasks || 0) + 1;
        }
        confDetail.status = 'failed';
        confDetail.jsonlWriteSuccess = false;
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

// Handler mới cho các event từ ResultProcessingService (nội bộ, không trực tiếp cập nhật confDetail)
export const handleCsvProcessingEvent: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const fileOutput = ensureFileOutputAnalysis(results);
    const eventName = logEntry.event;

    switch (eventName) {
        case 'csv_record_processed_for_writing': // Từ ResultProcessingService
            fileOutput.csvRecordsAttempted = (fileOutput.csvRecordsAttempted || 0) + 1;
            break;
        case 'csv_stream_collect_success': // Từ ResultProcessingService
            // Event này báo hiệu toàn bộ stream CSV đã được xử lý (có thể rỗng)
            // Nếu fileOutput.csvFileGenerated còn null, có thể set là true nếu có record được ghi
            // Hoặc dựa vào event 'csv_generation_pipeline_success' (nếu có)
            if (fileOutput.csvRecordsSuccessfullyWritten > 0) {
                 fileOutput.csvFileGenerated = true;
            }
            break;
        case 'csv_stream_collect_failed': // Từ ResultProcessingService
            fileOutput.csvFileGenerated = false;
            fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;
            // logger.error({ event: 'csv_stream_collect_failed', logEntry }, "CSV stream collection failed in ResultProcessingService.");
            break;
        case 'csv_generation_failed_or_empty': // Từ CrawlOrchestratorService
        case 'csv_generation_pipeline_failed': // Từ CrawlOrchestratorService
            fileOutput.csvFileGenerated = false;
            fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;
            // logger.error({ event: eventName, logEntry }, "CSV generation pipeline failed.");
            break;
        case 'csv_generation_empty_but_file_exists': // Từ CrawlOrchestratorService
            // File được tạo nhưng không có record (có thể do filter hoặc không có data)
            fileOutput.csvFileGenerated = true; // File vẫn được tạo
            // logger.info({ event: eventName, logEntry }, "CSV file generated but is empty.");
            break;
        // Thêm các case khác nếu cần
    }
};
