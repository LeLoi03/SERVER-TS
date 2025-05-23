// src/utils/logAnalysis/fileOutputHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { createConferenceKey } from './helpers'; // Đảm bảo đường dẫn đúng
import { OverallAnalysis, FileOutputAnalysis, getInitialFileOutputAnalysis, getInitialOverallAnalysis, LogErrorContext } from '../../types'; // Import LogErrorContext

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
    const overall = ensureOverallAnalysis(results);

    const acronym = logEntry.conferenceAcronym;
    const title = logEntry.conferenceTitle;
    const batchRequestId = logEntry.batchRequestId;

    if (!batchRequestId) {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        // Có thể thêm lỗi vào đây nếu cần theo dõi các bản ghi thành công "mồ côi"
        // addConferenceError(null, entryTimestampISO, "CSV success event missing batchRequestId", {
        //     keyPrefix: 'csv_orphan_success',
        //     sourceService: logEntry.service || 'FileOutputService',
        //     errorType: 'Logic',
        //     details: logEntry,
        //     isRecovered: false, // Vì không có conference để gán
        //     context: { phase: 'response_processing' }
        // });
        return;
    }
    if (!acronym || !title) {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        // Tương tự, có thể thêm lỗi vào đây
        return;
    }

    const compositeKey = createConferenceKey(batchRequestId, acronym, title);


    if (compositeKey && results.conferenceAnalysis[compositeKey]) {
        const confDetail = results.conferenceAnalysis[compositeKey];

        const previousStatus = confDetail.status;

        confDetail.csvWriteSuccess = true;
        confDetail.status = 'completed';
        if (!confDetail.endTime) {
            confDetail.endTime = entryTimestampISO;
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

        if (previousStatus !== 'completed') {
            overall.completedTasks = (overall.completedTasks || 0) + 1;
        }
        if (previousStatus === 'failed') {
            overall.failedOrCrashedTasks = Math.max(0, (overall.failedOrCrashedTasks || 0) - 1);
            // Đánh dấu các lỗi trước đó đã được phục hồi nếu event này thành công
            confDetail.errors.forEach(err => {
                // Nếu lỗi liên quan đến việc không ghi được file đầu ra hoặc là lỗi dẫn đến status 'failed'
                // và bây giờ đã thành công, thì coi như được phục hồi.
                // Logic này có thể phức tạp tùy vào cách bạn định nghĩa "phục hồi".
                // Ví dụ: chỉ phục hồi lỗi file output, không phải lỗi API.
                if (!err.isRecovered && err.errorType === 'FileSystem' || err.errorType === 'Logic' && err.key.includes('csv_write_failed')) {
                    err.isRecovered = true;
                }
            });
        }
        if (previousStatus === 'skipped') {
            overall.skippedTasks = Math.max(0, (overall.skippedTasks || 0) - 1);
        }

    } else {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
    }
};


export const handleJsonlWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    if (confDetail) {
        confDetail.jsonlWriteSuccess = true;
        fileOutputStats.jsonlRecordsSuccessfullyWritten = (fileOutputStats.jsonlRecordsSuccessfullyWritten || 0) + 1;
    }
};

export const handleJsonlWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    const overallStats = ensureOverallAnalysis(results);

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    const errorSource = logEntry.err || logEntry;
    const defaultMessage = 'Jsonl record write failed';

    // normalizeErrorKey vẫn cần cho errorsAggregated
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;
    fileOutputStats.jsonlWriteErrors = (fileOutputStats.jsonlWriteErrors || 0) + 1;

    if (confDetail) {
        const previousStatus = confDetail.status;
        if (previousStatus !== 'failed' && previousStatus !== 'skipped') { // Chỉ tăng nếu chưa bị đánh dấu failed/skipped
            overallStats.failedOrCrashedTasks = (overallStats.failedOrCrashedTasks || 0) + 1;
            // Nếu trước đó là completed, giảm số completed
            if (previousStatus === 'completed' && overallStats.completedTasks && overallStats.completedTasks > 0) {
                overallStats.completedTasks--;
            }
        }
        confDetail.status = 'failed';
        confDetail.jsonlWriteSuccess = false;
        confDetail.endTime = entryTimestampISO;

        const errorContext: LogErrorContext = {
            phase: 'response_processing', // Lỗi xảy ra trong quá trình xử lý/ghi kết quả
            ...logEntry.context // Bao gồm context gốc của logEntry
        };

        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource, // Truyền trực tiếp errorSource
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'jsonl_write_failed',
                sourceService: logEntry.service || 'FileOutputService',
                errorType: 'FileSystem', // Giả định là lỗi ghi file
                context: errorContext,
                additionalDetails: {
                    filePath: logEntry.filePath, // Thêm chi tiết về đường dẫn file nếu có
                    batchSize: logEntry.batchSize // và các chi tiết khác liên quan đến batch ghi
                }
            }
        );
    }
};

// Handler mới cho các event từ ResultProcessingService (nội bộ, không trực tiếp cập nhật confDetail)
export const handleCsvProcessingEvent: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const fileOutput = ensureFileOutputAnalysis(results);
    const overall = ensureOverallAnalysis(results); // Cần overall nếu có lỗi

    const eventName = logEntry.event;

    switch (eventName) {
        case 'csv_record_processed_for_writing':
            fileOutput.csvRecordsAttempted = (fileOutput.csvRecordsAttempted || 0) + 1;
            break;
        case 'csv_stream_collect_success':
            if (fileOutput.csvRecordsSuccessfullyWritten > 0) {
                 fileOutput.csvFileGenerated = true;
            }
            break;
        case 'csv_stream_collect_failed':
        case 'csv_generation_failed_or_empty':
        case 'csv_generation_pipeline_failed':
            fileOutput.csvFileGenerated = false;
            fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;

            // Nếu có confDetail liên quan đến lỗi này (ví dụ: lỗi xảy ra trong bối cảnh một conference cụ thể)
            // (Tuy nhiên, các event này thường là global hơn, không gắn với 1 confDetail cụ thể qua batchRequestId/acronym/title)
            // Nếu bạn muốn gán lỗi này cho một conference, bạn cần logic để tìm confDetail trước.
            // Hiện tại, chúng ta chỉ ghi log lỗi và tăng overall count.
            const errorSource = logEntry.err || logEntry;
            const defaultMessage = `CSV pipeline failed (${eventName})`;
            const keyForAggregation = normalizeErrorKey(errorSource);
            results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

            // Nếu đây là lỗi hệ thống toàn bộ, có thể tăng overall.failedOrCrashedTasks
            // Nhưng cẩn thận tránh double count nếu lỗi này cũng dẫn đến handleTaskUnhandledError.
            // Thường thì những lỗi pipeline này sẽ được phản ánh qua status của task.
            // addConferenceError(confDetail, entryTimestampISO, errorSource, {
            //     defaultMessage: defaultMessage,
            //     keyPrefix: 'csv_pipeline_failure',
            //     sourceService: logEntry.service || 'ResultProcessingService',
            //     errorType: 'FileSystem', // Hoặc 'Logic' nếu do logic trống rỗng
            //     context: { phase: 'response_processing', ...logEntry.context }
            // });

            break;
        case 'csv_generation_empty_but_file_exists':
            fileOutput.csvFileGenerated = true;
            break;
    }
};