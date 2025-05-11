// src/client/utils/eventHandlers/fileOutputHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { FileOutputAnalysis, OverallAnalysis } from '../../types/logAnalysis.types'; // Giả sử bạn có type này

// Khởi tạo fileOutput trong results nếu chưa có
const ensureFileOutputAnalysis = (results: any): FileOutputAnalysis => {
    if (!results.fileOutput) {
        results.fileOutput = {
            jsonlRecordsSuccessfullyWritten: 0,
            jsonlWriteErrors: 0,
            csvFileGenerated: null, // null ban đầu, true/false sau khi xử lý CSV
            csvRecordsAttempted: 0, // Tổng số record mà ResultProcessingService đã xử lý từ JSONL
            csvRecordsSuccessfullyWritten: 0, // Số record thực sự được ghi vào CSV và có confDetail
            csvWriteErrors: 0, // Số record thất bại khi ghi vào CSV (nếu có event)
            csvOrphanedSuccessRecords: 0, // Số record ghi thành công nhưng không tìm thấy confDetail
            csvPipelineFailures: 0, // Số lần toàn bộ pipeline CSV thất bại
        };
    }
    return results.fileOutput as FileOutputAnalysis;
};


const ensureOverallAnalysis = (results: any): OverallAnalysis => {
    if (!results.overall) {
        results.overall = {
            startTime: null,
            endTime: null,
            durationSeconds: null,
            totalConferencesInput: 0,
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

export const handleCsvWriteSuccess: LogEventHandler = (logEntry, results, confDetailFromInput, entryTimestampISO, logContext) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    const overallStats = ensureOverallAnalysis(results); // Đảm bảo overall stats tồn tại

    // Tìm confDetail dựa trên context của logEntry, vì confDetailFromInput có thể không đúng ở đây
    // (confDetailFromInput là confDetail của log entry trước đó, không phải của event này)
    const confKey = logEntry.context?.conferenceAcronym && logEntry.context?.conferenceTitle ?
        `${logEntry.context.conferenceAcronym}_${logEntry.context.conferenceTitle}` : null;
    const confDetail = confKey ? results.conferenceAnalysis[confKey] : null;

    if (confDetail) {
        confDetail.status = 'completed'; // Chỉ khi CSV thành công thì mới completed
        confDetail.csvWriteSuccess = true;
        confDetail.endTime = entryTimestampISO; // Cập nhật endTime của conference
        fileOutputStats.csvRecordsSuccessfullyWritten = (fileOutputStats.csvRecordsSuccessfullyWritten || 0) + 1;
        // === TĂNG COMPLETED TASKS ===
        overallStats.completedTasks = (overallStats.completedTasks || 0) + 1;
    } else {
        // Log entry này được tạo ra bởi service điều phối,
        // nếu không tìm thấy confDetail thì có thể là lỗi logic hoặc conference đó không được xử lý ở các bước trước.
        fileOutputStats.csvOrphanedSuccessRecords = (fileOutputStats.csvOrphanedSuccessRecords || 0) + 1;

    }
};

export const handleCsvWriteFailed: LogEventHandler = (logEntry, results, confDetailFromInput, entryTimestampISO, logContext) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    const overallStats = ensureOverallAnalysis(results); // Đảm bảo overall stats tồn tại

    const confKey = logEntry.context?.conferenceAcronym && logEntry.context?.conferenceTitle ?
        `${logEntry.context.conferenceAcronym}_${logEntry.context.conferenceTitle}` : null;
    const confDetail = confKey ? results.conferenceAnalysis[confKey] : null;

    const error = logEntry.err || logEntry.reason || logEntry.msg || 'CSV record write failed';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    fileOutputStats.csvWriteErrors = (fileOutputStats.csvWriteErrors || 0) + 1;

    if (confDetail) {
        // Chỉ tăng failedOrCrashedTasks nếu trạng thái TRƯỚC ĐÓ của confDetail không phải là 'failed'
        // để tránh đếm kép nếu có nhiều event lỗi cho cùng một conference.
        if (confDetail.status !== 'failed') {
            overallStats.failedOrCrashedTasks = (overallStats.failedOrCrashedTasks || 0) + 1;
        }
        confDetail.status = 'failed';
        confDetail.csvWriteSuccess = false;
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    } else {
        fileOutputStats.csvOrphanedSuccessRecords = (fileOutputStats.csvOrphanedSuccessRecords || 0) + 1;
        // Nếu không có confDetail, nhưng là lỗi ghi CSV, có thể coi là một "crash" ở mức độ nào đó,
        // nhưng khó quy cho một task cụ thể.
        // overallStats.failedOrCrashedTasks = (overallStats.failedOrCrashedTasks || 0) + 1; // Cân nhắc kỹ
    }
};

export const handleJsonlWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // confDetail ở đây là confDetail của conference mà event này thuộc về, được tìm bởi getConferenceDetail
    const fileOutputStats = ensureFileOutputAnalysis(results);
    if (confDetail) {
        confDetail.jsonlWriteSuccess = true;
        // Không set status = 'completed' ở đây, chỉ khi CSV thành công
        // endTime của conference sẽ được cập nhật bởi event cuối cùng (thường là CSV success/failed)
        fileOutputStats.jsonlRecordsSuccessfullyWritten = (fileOutputStats.jsonlRecordsSuccessfullyWritten || 0) + 1;
    } else {
        // Trường hợp này ít xảy ra nếu getConferenceDetail hoạt động đúng,
        // vì event 'save_batch_append_success' thường có context acronym/title.
    }
};

export const handleJsonlWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
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
export const handleCsvProcessingEvent: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    const event = logEntry.event;

    if (event === 'csv_record_processed_for_writing') { // Từ ResultProcessingService
        fileOutputStats.csvRecordsAttempted = (fileOutputStats.csvRecordsAttempted || 0) + 1;
    } else if (event === 'csv_stream_collect_success') { // Từ ResultProcessingService
        fileOutputStats.csvFileGenerated = true;
    } else if (event === 'csv_stream_collect_failed') { // Từ ResultProcessingService
        fileOutputStats.csvFileGenerated = false;
        fileOutputStats.csvPipelineFailures = (fileOutputStats.csvPipelineFailures || 0) + 1;
        const error = logEntry.err || logEntry.reason || logEntry.msg || 'CSV generation pipeline failed';
        const errorKey = normalizeErrorKey(error);
        results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    } else if (event === 'csv_generation_failed_or_empty') { // Từ CrawlOrchestratorService
        fileOutputStats.csvFileGenerated = false;
    }
};