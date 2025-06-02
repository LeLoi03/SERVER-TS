// src/utils/logAnalysis/fileOutputHandlers.ts
import { LogEventHandler } from './index';
import { normalizeErrorKey, addConferenceError } from './helpers';
import { createConferenceKey } from './helpers';
import { OverallAnalysis, FileOutputAnalysis, getInitialFileOutputAnalysis, getInitialOverallAnalysis, ConferenceLogAnalysisResult, ConferenceAnalysisDetail, LogErrorContext } from '../../types/logAnalysis'; // Thêm ConferenceLogAnalysisResult, ConferenceAnalysisDetail

const ensureFileOutputAnalysis = (results: ConferenceLogAnalysisResult): FileOutputAnalysis => { // Sửa any
    if (!results.fileOutput) {
        results.fileOutput = getInitialFileOutputAnalysis();
    }
    return results.fileOutput as FileOutputAnalysis;
};

const ensureOverallAnalysis = (results: ConferenceLogAnalysisResult): OverallAnalysis => { // Sửa any
    if (!results.overall) {
        results.overall = getInitialOverallAnalysis();
    }
    return results.overall as OverallAnalysis;
};

export const handleCsvWriteSuccess: LogEventHandler = (logEntry, results, _confDetailIgnored, entryTimestampISO) => {
    const fileOutput = ensureFileOutputAnalysis(results);
    const overall = ensureOverallAnalysis(results);

    const acronym = logEntry.conferenceAcronym;
    const title = logEntry.conferenceTitle;
    const batchRequestId = logEntry.batchRequestId;

    if (!batchRequestId) {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        return;
    }
    if (!acronym || !title) {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        return;
    }

    const compositeKey = createConferenceKey(batchRequestId, acronym, title);

    if (compositeKey && results.conferenceAnalysis[compositeKey]) {
        const confDetail = results.conferenceAnalysis[compositeKey];
        const previousStatus = confDetail.status;

        // Chỉ thay đổi status và counters nếu nó thực sự chuyển sang completed
        if (previousStatus !== 'completed') {
            confDetail.status = 'completed'; // <--- ĐÚNG: Ghi CSV thành công là completed
            confDetail.csvWriteSuccess = true;

            if (!confDetail.endTime) { // Có thể endTime đã được set bởi task_finish
                confDetail.endTime = entryTimestampISO;
            }
            // Recalculate duration if endTime changed or wasn't set by task_finish
            if (confDetail.startTime && confDetail.endTime) {
                try {
                    const start = new Date(confDetail.startTime).getTime();
                    const end = new Date(confDetail.endTime).getTime();
                    if (!isNaN(start) && !isNaN(end) && end >= start) {
                        confDetail.durationSeconds = Math.round((end - start) / 1000);
                    }
                } catch (e) { /* ignore */ }
            }


            overall.completedTasks = (overall.completedTasks || 0) + 1;

            if (previousStatus === 'processing') {
                if (overall.processingTasks && overall.processingTasks > 0) overall.processingTasks--;
            } else if (previousStatus === 'failed') {
                if (overall.failedOrCrashedTasks && overall.failedOrCrashedTasks > 0) overall.failedOrCrashedTasks--;
                // Đánh dấu lỗi trước đó là recovered nếu lỗi đó liên quan đến output
                confDetail.errors.forEach((err: any) => {
                    if (!err.isRecovered && (err.errorType === 'FileSystem' || (err.errorType === 'Logic' && err.key.includes('csv_write_failed')))) {
                        err.isRecovered = true;
                    }
                });
            } else if (previousStatus === 'skipped') {
                if (overall.skippedTasks && overall.skippedTasks > 0) overall.skippedTasks--;
            }
            // Nếu previousStatus là 'processed_ok', nó không nằm trong processingTasks, failedTasks, hay skippedTasks
            // Nó chỉ đơn giản là chuyển từ processed_ok -> completed, và completedTasks tăng lên.
        }
        fileOutput.csvRecordsSuccessfullyWritten = (fileOutput.csvRecordsSuccessfullyWritten || 0) + 1;

    } else {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
    }
};


export const handleJsonlWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    if (confDetail) {
        confDetail.jsonlWriteSuccess = true;
        fileOutputStats.jsonlRecordsSuccessfullyWritten = (fileOutputStats.jsonlRecordsSuccessfullyWritten || 0) + 1;
        // Ghi JSONL thành công không tự động thay đổi status của conference sang 'completed'.
        // Status 'completed' thường được xác định bởi ghi CSV thành công hoặc task_finish nếu không có CSV.
        // Tuy nhiên, nếu logic của bạn coi JSONL là bước cuối cùng, bạn có thể cập nhật status ở đây.
        // Hiện tại, để nó không thay đổi status, chờ CSV hoặc calculateFinalMetrics.
    }
};

export const handleJsonlWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    const overallStats = ensureOverallAnalysis(results);

    const errorSource = logEntry.err || logEntry;
    const defaultMessage = 'Jsonl record write failed';

    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;
    fileOutputStats.jsonlWriteErrors = (fileOutputStats.jsonlWriteErrors || 0) + 1;

    if (confDetail) {
        const previousStatus = confDetail.status;
        confDetail.jsonlWriteSuccess = false; // Đánh dấu ghi JSONL thất bại

        // Nếu lỗi ghi JSONL được coi là lỗi nghiêm trọng làm hỏng cả conference:
        if (previousStatus !== 'failed' && previousStatus !== 'skipped') {
            confDetail.status = 'failed';
            confDetail.endTime = entryTimestampISO; // Cập nhật endTime nếu lỗi này kết thúc task

            overallStats.failedOrCrashedTasks = (overallStats.failedOrCrashedTasks || 0) + 1;
            if (previousStatus === 'processing' && overallStats.processingTasks && overallStats.processingTasks > 0) {
                overallStats.processingTasks--;
            } else if (previousStatus === 'completed' && overallStats.completedTasks && overallStats.completedTasks > 0) {
                overallStats.completedTasks--;
            } else if (previousStatus === 'processed_ok') {
                // Không có counter riêng cho processed_ok, nó chỉ chuyển sang failed
            }
        }


        const errorContext: LogErrorContext = {
            phase: 'response_processing',
            ...logEntry.context
        };

        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource,
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'jsonl_write_failed',
                sourceService: logEntry.service || 'FileOutputService',
                errorType: 'FileSystem',
                context: errorContext,
                additionalDetails: { filePath: logEntry.filePath, batchSize: logEntry.batchSize }
            }
        );
    }
};

// handleCsvProcessingEvent giữ nguyên
export const handleCsvProcessingEvent: LogEventHandler = (logEntry, results, _confDetail, entryTimestampISO) => {
    const fileOutput = ensureFileOutputAnalysis(results); // Đảm bảo results.fileOutput tồn tại
    // const overall = ensureOverallAnalysis(results); // Nếu cần cập nhật overall stats

    const eventName = logEntry.event as string | undefined;
    const batchRequestId = logEntry.batchRequestId as string | undefined; // Lấy batchRequestId từ log entry


    switch (eventName) {
        case 'csv_record_processed_for_writing':
            fileOutput.csvRecordsAttempted = (fileOutput.csvRecordsAttempted || 0) + 1;
            break;
        case 'csv_stream_collect_success':
            const recordsWritten = typeof logEntry.recordsWrittenToCsv === 'number'
                ? logEntry.recordsWrittenToCsv
                : (typeof logEntry.context?.recordsWrittenToCsv === 'number' ? logEntry.context.recordsWrittenToCsv : -1);

            if (recordsWritten > 0 || logEntry.context?.allowEmptyFile) {
                fileOutput.csvFileGenerated = true;
                // QUAN TRỌNG: Nếu trước đó pipeline failure đã được set do hiểu lầm,
                // và giờ stream collect success xác nhận file được tạo, có thể reset pipeline failure.
                // Tuy nhiên, điều này cần cẩn thận. Nếu có một lỗi pipeline THỰC SỰ trước đó,
                // việc reset ở đây có thể che giấu lỗi.
                // Chỉ reset nếu chúng ta chắc chắn rằng pipeline failure trước đó là do
                // việc 'csv_stream_collect_success' bị đánh giá sai.
                // Ví dụ: if (fileOutput.csvPipelineFailures > 0 && recordsWritten > 0) {
                //    // Có thể log một cảnh báo ở đây là đang reset một pipeline failure tiềm năng
                //    // fileOutput.csvPipelineFailures = 0; // Cân nhắc kỹ lưỡng dòng này
                // }
            } else if (recordsWritten === 0 && !logEntry.context?.allowEmptyFile) {
                fileOutput.csvFileGenerated = false;
                fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;
            }
            // Nếu recordsWritten === -1 (không có thông tin), không thay đổi gì, để các event khác quyết định.
            break;
        case 'csv_stream_collect_failed':
        case 'csv_generation_pipeline_failed': // Event này thường chỉ ra lỗi cho cả một pipeline/request
            // Tăng bộ đếm lỗi pipeline toàn cục (vẫn hữu ích cho thống kê)
            fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;

            // Đặt cờ lỗi CSV cho request cụ thể nếu có batchRequestId
            if (batchRequestId && results.requests[batchRequestId]) {
                results.requests[batchRequestId].csvOutputStreamFailed = true; // <--- ĐÂY LÀ NƠI CỜ ĐƯỢC ĐẶT
                // Bạn có thể muốn lưu thêm chi tiết lỗi vào request đó nếu cần
                // Ví dụ: results.requests[batchRequestId].csvErrorDetails = logEntry.err || logEntry.message;
                console.warn(`CSV output stream failed for request: ${batchRequestId}. Flag set.`); // Log để debug
            } else {
                // Nếu không có batchRequestId, lỗi này không thể gán cho request cụ thể
                // Nó sẽ chỉ được tính vào csvPipelineFailures toàn cục
                console.warn(`CSV pipeline/stream failed but no batchRequestId provided in log entry for event: ${eventName}. Log:`, logEntry);
            }

            // Ghi nhận lỗi vào aggregated errors nếu cần
            const errorSource = logEntry.err || logEntry;
            const defaultMessage = `CSV pipeline/stream failed (${eventName})`;
            const keyForAggregation = normalizeErrorKey(errorSource);
            results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;
            break;

        case 'csv_generation_failed_or_empty':
            if (logEntry.context?.allowEmptyFileIfNoRecords && fileOutput.csvRecordsAttempted === 0) {
                // fileOutput.csvFileGenerated = true; // Không cần thiết nếu file riêng
            } else {
                // fileOutput.csvFileGenerated = false; // Không cần thiết nếu file riêng
                fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1; // Đếm lỗi toàn cục

                if (batchRequestId && results.requests[batchRequestId]) {
                    results.requests[batchRequestId].csvOutputStreamFailed = true; // <--- ĐẶT CỜ CHO REQUEST
                    console.warn(`CSV generation failed or empty for request: ${batchRequestId}. Flag set.`);
                } else {
                    console.warn(`CSV generation failed or empty but no batchRequestId for event: ${eventName}. Log:`, logEntry);
                }
                const errorSourceFc = logEntry.err || logEntry;
                const defaultMessageFc = `CSV generation failed or empty (${eventName})`;
                const keyForAggregationFc = normalizeErrorKey(errorSourceFc);
                results.errorsAggregated[keyForAggregationFc] = (results.errorsAggregated[keyForAggregationFc] || 0) + 1;
            }
            break;

        case 'csv_generation_empty_but_file_exists': // File rỗng được tạo thành công
            fileOutput.csvFileGenerated = true;
            break;
    }
};