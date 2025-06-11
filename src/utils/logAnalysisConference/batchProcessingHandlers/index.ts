// src/utils/logAnalysis/batchProcessingHandlers/index.ts

/**
 * This file serves as the single entry point for all batch processing related log event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import {
    handleBatchRejectionOrLogicFailure,
    handleBatchApiFailure,
    handleBatchFileSystemFailure,
} from './failure.handlers';
import { handleBatchAggregationEnd } from './info.handlers';
import {
    handleBatchTaskCreate,
    handleBatchFinishSuccess,
} from './lifecycle.handlers';

export const batchProcessingEventHandlers: { [key: string]: LogEventHandler } = {
    // Lifecycle
    'batch_task_start_execution': handleBatchTaskCreate,
    'batch_task_create_delegation_start': handleBatchTaskCreate,
    'batch_task_finish_success': handleBatchFinishSuccess,

    // Failures
    'batch_task_execution_failed': handleBatchRejectionOrLogicFailure,
    'batch_processing_abort_no_main_text': handleBatchRejectionOrLogicFailure,
    'conference_link_processor_link_missing_for_update': handleBatchRejectionOrLogicFailure,
    'conference_link_processor_update_link_failed': handleBatchRejectionOrLogicFailure,

    'save_batch_determine_api_call_failed': handleBatchApiFailure,
    'batch_extract_api_call_failed': handleBatchApiFailure,
    'batch_cfp_api_call_failed': handleBatchApiFailure,
    'save_batch_process_determine_call_failed': handleBatchApiFailure,
    'save_batch_process_determine_failed_invalid': handleBatchApiFailure,
    'save_batch_api_response_parse_failed': handleBatchApiFailure,
    'batch_parallel_final_apis_both_failed': handleBatchApiFailure,

    'batch_dir_create_failed': handleBatchFileSystemFailure,
    'save_batch_read_content_failed': handleBatchFileSystemFailure,
    'save_batch_read_content_failed_missing_path': handleBatchFileSystemFailure,
    'save_batch_write_file_failed': handleBatchFileSystemFailure,
    'save_batch_read_content_warn_non_critical': handleBatchFileSystemFailure,

    // Informational
    'save_batch_aggregate_content_end': handleBatchAggregationEnd,
};