// src/utils/logAnalysis/batchProcessingHandlers/failure.handlers.ts

/**
 * Centralizes all failure handlers for batch processing, including logic, API, and file system errors.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../utils';
import { LogErrorContext } from '../../../types/logAnalysis';

export const handleBatchRejectionOrLogicFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;

    const isLogicRejection = logEntry.event === 'batch_processing_abort_no_main_text' ||
        logEntry.event === 'conference_link_processor_link_missing_for_update' ||
        logEntry.event === 'conference_link_processor_update_link_failed';

    if (isLogicRejection) {
        results.batchProcessing.logicRejections = (results.batchProcessing.logicRejections || 0) + 1;
    }

    let defaultMessage = `Batch processing rejected or critical logic failure (${logEntry.event})`;
    if (logEntry.context?.linkType) defaultMessage += ` for link type: ${logEntry.context.linkType}`;
    if (logEntry.context?.reason) defaultMessage += `. Reason: ${logEntry.context.reason}`;

    const errorSource = logEntry.err || logEntry;
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail) {
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, errorSource, {
            defaultMessage,
            keyPrefix: 'batch_rejection',
            sourceService: logEntry.service || 'BatchProcessing',
            errorType: isLogicRejection ? 'Logic' : 'Unknown',
            context: { phase: 'primary_execution', ...logEntry.context }
        });
    }
};

export const handleBatchApiFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.batchProcessing.apiFailures = (results.batchProcessing.apiFailures || 0) + 1;
    results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;

    const event = logEntry.event;
    const apiType = logEntry.context?.apiType;
    const modelIdentifier = logEntry.context?.modelIdentifier;

    if (event === 'save_batch_api_response_parse_failed') {
        results.batchProcessing.apiResponseParseFailures = (results.batchProcessing.apiResponseParseFailures || 0) + 1;
    } else if (apiType === 'determine' || event.includes('determine')) {
        results.batchProcessing.determineApiFailures = (results.batchProcessing.determineApiFailures || 0) + 1;
    } else if (apiType === 'extract' || event.includes('extract')) {
        results.batchProcessing.extractApiFailures = (results.batchProcessing.extractApiFailures || 0) + 1;
    } else if (apiType === 'cfp' || event.includes('cfp')) {
        results.batchProcessing.cfpApiFailures = (results.batchProcessing.cfpApiFailures || 0) + 1;
    }

    if (event === 'batch_parallel_final_apis_both_failed') {
        results.batchProcessing.extractApiFailures = (results.batchProcessing.extractApiFailures || 0) + 1;
        results.batchProcessing.cfpApiFailures = (results.batchProcessing.cfpApiFailures || 0) + 1;
    }

    const defaultMessage = `Batch API operation failed (${logEntry.event})`;
    const errorSource = logEntry.err || logEntry;
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail) {
        if (apiType === 'determine' || event.includes('determine')) confDetail.steps.gemini_determine_success = false;
        if (apiType === 'extract' || event.includes('extract')) confDetail.steps.gemini_extract_success = false;
        if (apiType === 'cfp' && confDetail.steps.hasOwnProperty('gemini_cfp_success')) confDetail.steps.gemini_cfp_success = false;
        if (event === 'batch_parallel_final_apis_both_failed') {
            confDetail.steps.gemini_extract_success = false;
            if (confDetail.steps.hasOwnProperty('gemini_cfp_success')) confDetail.steps.gemini_cfp_success = false;
        }

        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        const errorContext: LogErrorContext = { phase: 'sdk_call', apiType, modelIdentifier, ...logEntry.context };
        addConferenceError(confDetail, entryTimestampISO, errorSource, {
            defaultMessage,
            keyPrefix: `batch_api_${apiType || 'general'}`,
            sourceService: logEntry.service || 'BatchProcessing',
            errorType: (event === 'save_batch_api_response_parse_failed') ? 'DataParsing' : 'ThirdPartyAPI',
            context: errorContext
        });
    }
};

export const handleBatchFileSystemFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO) => {
    results.batchProcessing.fileSystemFailures = (results.batchProcessing.fileSystemFailures || 0) + 1;

    const isCriticalFsError = logEntry.event === 'save_batch_read_content_failed' || logEntry.event === 'save_batch_read_content_failed_missing_path';
    if (isCriticalFsError) {
        results.batchProcessing.failedBatches = (results.batchProcessing.failedBatches || 0) + 1;
    }

    const defaultMessage = `Batch FileSystem operation failed (${logEntry.event})`;
    const errorSource = logEntry.err || logEntry;
    const keyForAggregation = normalizeErrorKey(errorSource);
    results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;

    if (confDetail && isCriticalFsError) {
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, errorSource, {
            defaultMessage,
            keyPrefix: 'batch_fs_failure',
            sourceService: logEntry.service || 'BatchProcessing',
            errorType: 'FileSystem',
            context: { phase: 'primary_execution', ...logEntry.context }
        });
    }
};