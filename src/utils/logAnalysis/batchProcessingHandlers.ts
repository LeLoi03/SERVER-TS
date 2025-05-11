// src/client/utils/eventHandlers/batchProcessingHandlers.ts
import { LogEventHandler } from './index'; // Hoặc từ './index'
import { normalizeErrorKey, addConferenceError } from './helpers'; // Import trực tiếp

export const handleBatchTaskCreate: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'batch_task_create', 'batch_task_create_delegation_start'
    results.batchProcessing.totalBatchesAttempted = (results.batchProcessing.totalBatchesAttempted || 0) + 1;
    // Không cập nhật confDetail ở đây vì đây là event tạo batch, chưa xử lý.
};

export const handleBatchRejectionOrLogicFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'save_batch_unhandled_error_or_rethrown',
    //         'batch_processing_abort_no_main_text',
    //         'conference_link_processor_link_missing_for_update',  <-- Mới
    //         'conference_link_processor_update_link_failed'        <-- Mới
    results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;

    const isLogicRejection = logEntry.event === 'batch_processing_abort_no_main_text' ||
        logEntry.event === 'conference_link_processor_link_missing_for_update' ||
        logEntry.event === 'conference_link_processor_update_link_failed'; // Coi các lỗi link này là logic rejection

    if (isLogicRejection) {
        results.batchProcessing.logicRejections = (results.batchProcessing.logicRejections || 0) + 1;
    }
    // Các lỗi 'save_batch_unhandled_error_or_rethrown' sẽ không tăng logicRejections trừ khi bạn thêm logic để phân biệt nó là unhandled exception chứ không phải lỗi logic cụ thể.

    // Xây dựng thông điệp lỗi dựa trên event và context
    let errorMessage = `Batch processing rejected or critical logic failure (${logEntry.event})`;
    if (logEntry.context?.linkType) {
        errorMessage += ` for link type: ${logEntry.context.linkType}`;
    }
    if (logEntry.context?.reason) {
        errorMessage += `. Reason: ${logEntry.context.reason}`;
    }

    const error = logEntry.err || logEntry.reason || logEntry.msg || errorMessage;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.status = 'failed'; // Mark conference as failed
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey); // Sử dụng errorKey làm mô tả ngắn gọn
    }
};

export const handleBatchApiFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events:
    // 'save_batch_determine_api_call_failed', 'save_batch_extract_api_call_failed',
    // 'save_batch_cfp_api_call_failed', 'save_batch_process_determine_call_failed',
    // 'save_batch_process_determine_failed_invalid', 'save_batch_api_response_parse_failed',
    // 'save_batch_parallel_final_apis_both_failed'
    results.batchProcessing.apiFailures = (results.batchProcessing.apiFailures || 0) + 1;
    results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1; // Lỗi API làm batch fail

    const event = logEntry.event;
    const apiType = logEntry.context?.apiType; // 'determine', 'extract', 'cfp'
    // const apiCallNumber = logEntry.context?.apiCallNumber;

    if (event === 'save_batch_api_response_parse_failed') {
        results.batchProcessing.apiResponseParseFailures = (results.batchProcessing.apiResponseParseFailures || 0) + 1;
    } else if (apiType === 'determine' || event.includes('determine') || event === 'save_batch_parallel_final_apis_both_failed') {
        // 'save_batch_parallel_final_apis_both_failed' có thể không có apiType cụ thể,
        // nhưng nó liên quan đến thất bại của các API trong batch.
        // Nếu là lỗi `determine` cụ thể, tăng counter determine.
        if (apiType === 'determine' || event.includes('determine')) {
            results.batchProcessing.determineApiFailures = (results.batchProcessing.determineApiFailures || 0) + 1;
        }
    } else if (apiType === 'extract' || event.includes('extract')) {
        results.batchProcessing.extractApiFailures = (results.batchProcessing.extractApiFailures || 0) + 1;
    } else if (apiType === 'cfp' || event.includes('cfp')) {
        results.batchProcessing.cfpApiFailures = (results.batchProcessing.cfpApiFailures || 0) + 1;
    }

    const error = logEntry.err || logEntry.reason || logEntry.msg || `Batch API operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        // Cập nhật confDetail dựa trên lỗi API cụ thể
        // Giả sử API calls được thực hiện bởi Gemini
        if (apiType === 'determine' || event.includes('determine')) {
            if (confDetail.steps.gemini_determine_success !== false) confDetail.steps.gemini_determine_success = false;
        }
        if (apiType === 'extract' || event.includes('extract')) {
            if (confDetail.steps.gemini_extract_success !== false) confDetail.steps.gemini_extract_success = false;
        }
        if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) { // Thêm nếu có
            if (confDetail.steps.gemini_cfp_success !== false) confDetail.steps.gemini_cfp_success = false;
        }

        // Nếu cả hai API cuối cùng đều thất bại (trong 'save_batch_parallel_final_apis_both_failed')
        if (event === 'save_batch_parallel_final_apis_both_failed') {
            if (confDetail.steps.gemini_extract_success !== false) confDetail.steps.gemini_extract_success = false;
            if (confDetail.steps.hasOwnProperty('gemini_cfp_success') && confDetail.steps.gemini_cfp_success !== false) {
                confDetail.steps.gemini_cfp_success = false;
            }
        }


        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
};

export const handleBatchFileSystemFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Events: 'save_batch_dir_create_failed', 'save_batch_read_content_failed',
    // 'save_batch_read_content_failed_missing_path', 'save_batch_write_file_failed'
    results.batchProcessing.fileSystemFailures = (results.batchProcessing.fileSystemFailures || 0) + 1;

    // Lỗi FS nghiêm trọng có thể làm batch fail
    const isCriticalFsError = logEntry.event === 'save_batch_read_content_failed' || logEntry.event === 'save_batch_read_content_failed_missing_path';
    if (isCriticalFsError) {
        results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;
    }

    const error = logEntry.err || logEntry.reason || logEntry.msg || `Batch FileSystem operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail && isCriticalFsError) { // Chỉ cập nhật confDetail nếu lỗi FS làm hỏng cả conference
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
    }
    // Các lỗi ghi file intermediate ('save_batch_write_file_failed') có thể không làm fail cả conference
    // nên không cập nhật confDetail ở đây trừ khi có logic cụ thể hơn.
};

export const handleBatchFinishSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'save_batch_finish_success'
    results.batchProcessing.successfulBatches = (results.batchProcessing.successfulBatches || 0) + 1;

    if (confDetail && confDetail.status !== 'failed') { // Chỉ set completed nếu chưa bị set là failed
        // Việc một "batch task" thành công không đồng nghĩa với conference "completed"
        // Conference "completed" thường được đánh dấu bởi việc ghi CSV/JSONL thành công.
        // Tuy nhiên, nếu event 'save_batch_finish_success' là dấu hiệu cuối cùng của một conference
        // và không có lỗi nào khác, bạn có thể cập nhật status ở đây.
        // Hiện tại, chúng ta chỉ đếm successfulBatches.
    }
};

export const handleBatchAggregationEnd: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Event: 'save_batch_aggregate_content_end'
    if (logEntry.context?.aggregatedCount !== undefined && logEntry.context?.aggregatedCount !== null) { // Ưu tiên aggregatedCount
        results.batchProcessing.aggregatedResultsCount = logEntry.context.aggregatedCount;
    } else if (logEntry.context?.aggregatedItems !== undefined && logEntry.context?.aggregatedItems !== null) { // Sau đó là aggregatedItems
        results.batchProcessing.aggregatedResultsCount = logEntry.context.aggregatedItems;
    } else if (logEntry.context?.charCount !== undefined && logEntry.context?.charCount !== null) { // Cuối cùng là charCount
        results.batchProcessing.aggregatedResultsCount = logEntry.context.charCount;
    }
};