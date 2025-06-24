// src/utils/logAnalysis/batchProcessingHandlers.ts
import { LogEventHandler } from './index'; // Hoặc từ './index'
import { normalizeErrorKey, addConferenceError } from './utils'; // Import trực tiếp
import { LogErrorContext } from '../../types/logAnalysis'; // Import LogErrorContext nếu chưa có

export const handleBatchTaskCreate: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Events: 'batch_task_create', 'batch_task_create_delegation_start'
    results.batchProcessing.totalBatchesAttempted = (results.batchProcessing.totalBatchesAttempted || 0) + 1;
    // Không cập nhật confDetail ở đây vì đây là event tạo batch, chưa xử lý.
};

export const handleBatchRejectionOrLogicFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Events: 'save_batch_unhandled_error_or_rethrown',
    //         'batch_processing_abort_no_main_text',
    //         'conference_link_processor_link_missing_for_update',
    //         'conference_link_processor_update_link_failed'
    results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;

    const isLogicRejection = logEntry.event === 'batch_processing_abort_no_main_text' ||
        logEntry.event === 'conference_link_processor_link_missing_for_update' ||
        logEntry.event === 'conference_link_processor_update_link_failed';

    if (isLogicRejection) {
        results.batchProcessing.logicRejections = (results.batchProcessing.logicRejections || 0) + 1;
    }

    // Xây dựng thông điệp lỗi dựa trên event và context
    let defaultMessage = `Batch processing rejected or critical logic failure (${logEntry.event})`;
    if (logEntry.context?.linkType) {
        defaultMessage += ` for link type: ${logEntry.context.linkType}`;
    }
    if (logEntry.context?.reason) {
        defaultMessage += `. Reason: ${logEntry.context.reason}`;
    }

    // Sử dụng logEntry.err hoặc toàn bộ logEntry làm errorSource
    const errorSource = logEntry.err || logEntry;
    const keyForAggregation = normalizeErrorKey(errorSource); // Vẫn dùng normalizeErrorKey để tổng hợp

    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail) {
        confDetail.status = 'failed'; // Mark conference as failed
        confDetail.endTime = entryTimestampISO;

        // Truyền logEntry.err hoặc logEntry làm errorSource, và cung cấp options
        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource, // Truyền trực tiếp errorSource
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'batch_rejection', // Tiền tố rõ ràng cho lỗi loại này
                sourceService: logEntry.service || 'BatchProcessing', // Lấy service từ logEntry nếu có
                errorType: isLogicRejection ? 'Logic' : 'Unknown', // Xác định errorType cụ thể hơn
                context: {
                    phase: 'primary_execution', // Giả định là trong quá trình thực thi chính
                    ...logEntry.context // Bao gồm context gốc của logEntry
                }
            }
        );
    }
};

export const handleBatchApiFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Events:
    // 'save_batch_determine_api_call_failed', 'save_batch_extract_api_call_failed',
    // 'save_batch_cfp_api_call_failed', 'save_batch_process_determine_call_failed',
    // 'save_batch_process_determine_failed_invalid', 'save_batch_api_response_parse_failed',
    // 'save_batch_parallel_final_apis_both_failed'
    results.batchProcessing.apiFailures = (results.batchProcessing.apiFailures || 0) + 1;
    results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1; // Lỗi API làm batch fail

    const event = logEntry.event;
    const apiType = logEntry.context?.apiType; // 'determine', 'extract', 'cfp'
    const modelIdentifier = logEntry.context?.modelIdentifier;

    if (event === 'save_batch_api_response_parse_failed') {
        results.batchProcessing.apiResponseParseFailures = (results.batchProcessing.apiResponseParseFailures || 0) + 1;
    } else if (apiType === 'determine' || event.includes('determine') || event === 'save_batch_parallel_final_apis_both_failed') {
        if (apiType === 'determine' || event.includes('determine')) {
            results.batchProcessing.determineApiFailures = (results.batchProcessing.determineApiFailures || 0) + 1;
        }
    } else if (apiType === 'extract' || event.includes('extract')) {
        results.batchProcessing.extractApiFailures = (results.batchProcessing.extractApiFailures || 0) + 1;
    } else if (apiType === 'cfp' || event.includes('cfp')) {
        results.batchProcessing.cfpApiFailures = (results.batchProcessing.cfpApiFailures || 0) + 1;
    }

    const defaultMessage = `Batch API operation failed (${logEntry.event})`;
    const errorSource = logEntry.err || logEntry; // Sử dụng logEntry.err hoặc toàn bộ logEntry
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail) {
        // Cập nhật confDetail dựa trên lỗi API cụ thể
        if (apiType === 'determine' || event.includes('determine')) {
            if (confDetail.steps.gemini_determine_success !== false) confDetail.steps.gemini_determine_success = false;
        }
        if (apiType === 'extract' || event.includes('extract')) {
            if (confDetail.steps.gemini_extract_success !== false) confDetail.steps.gemini_extract_success = false;
        }
        if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) {
            if (confDetail.steps.gemini_cfp_success !== false) confDetail.steps.gemini_cfp_success = false;
        }

        if (event === 'save_batch_parallel_final_apis_both_failed') {
            if (confDetail.steps.gemini_extract_success !== false) confDetail.steps.gemini_extract_success = false;
            if (confDetail.steps.hasOwnProperty('gemini_cfp_success') && confDetail.steps.gemini_cfp_success !== false) {
                confDetail.steps.gemini_cfp_success = false;
            }
        }

        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;

        const errorContext: LogErrorContext = {
            phase: 'sdk_call', // Lỗi xảy ra trong quá trình gọi SDK/API
            apiType: apiType,
            modelIdentifier: modelIdentifier,
            ...logEntry.context // Bao gồm context gốc của logEntry
        };

        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource, // Truyền trực tiếp errorSource
            {
                defaultMessage: defaultMessage,
                keyPrefix: `batch_api_${apiType || 'general'}`, // Key prefix cụ thể hơn
                sourceService: logEntry.service || 'BatchProcessing',
                errorType: (event === 'save_batch_api_response_parse_failed') ? 'DataParsing' : 'ThirdPartyAPI',
                context: errorContext
            }
        );
    }
};

export const handleBatchFileSystemFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Events: 'save_batch_dir_create_failed', 'save_batch_read_content_failed',
    // 'save_batch_read_content_failed_missing_path', 'save_batch_write_file_failed'
    results.batchProcessing.fileSystemFailures = (results.batchProcessing.fileSystemFailures || 0) + 1;

    // Lỗi FS nghiêm trọng có thể làm batch fail
    const isCriticalFsError = logEntry.event === 'save_batch_read_content_failed' || logEntry.event === 'save_batch_read_content_failed_missing_path';
    if (isCriticalFsError) {
        results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;
    }

    const defaultMessage = `Batch FileSystem operation failed (${logEntry.event})`;
    const errorSource = logEntry.err || logEntry; // Sử dụng logEntry.err hoặc toàn bộ logEntry
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail && isCriticalFsError) { // Chỉ cập nhật confDetail nếu lỗi FS làm hỏng cả conference
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(
            confDetail,
            entryTimestampISO,
            errorSource, // Truyền trực tiếp errorSource
            {
                defaultMessage: defaultMessage,
                keyPrefix: 'batch_fs_failure',
                sourceService: logEntry.service || 'BatchProcessing',
                errorType: 'FileSystem',
                context: {
                    phase: 'primary_execution',
                    ...logEntry.context
                }
            }
        );
    }
    // Các lỗi ghi file intermediate ('save_batch_write_file_failed') có thể không làm fail cả conference
    // nên không cập nhật confDetail ở đây trừ khi có logic cụ thể hơn.
};

export const handleBatchFinishSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Event: 'save_batch_finish_success'
    results.batchProcessing.successfulBatches = (results.batchProcessing.successfulBatches || 0) + 1;

    if (confDetail && confDetail.status !== 'failed') {
        // ...
    }
};

export const handleBatchAggregationEnd: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    // Event: 'save_batch_aggregate_content_end'
    const aggregatedCount = logEntry.aggregatedCount || logEntry.context?.aggregatedCount;
    const aggregatedItems = logEntry.aggregatedItems || logEntry.context?.aggregatedItems;
    const charCount = logEntry.charCount || logEntry.context?.charCount;

    if (aggregatedCount !== undefined && aggregatedCount !== null) {
        results.batchProcessing.aggregatedResultsCount = aggregatedCount;
    } else if (aggregatedItems !== undefined && aggregatedItems !== null) {
        results.batchProcessing.aggregatedResultsCount = aggregatedItems;
    } else if (charCount !== undefined && charCount !== null) {
        results.batchProcessing.aggregatedResultsCount = charCount;
    }
};