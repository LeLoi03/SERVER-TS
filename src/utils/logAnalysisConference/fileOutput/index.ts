// src/utils/logAnalysis/fileOutputHandlers/index.ts

/**
 * This file serves as the single entry point for all file output related log event handlers.
 * It aggregates handlers from different modules into a single map for the main dispatcher.
 */

import { LogEventHandler } from '../index';
import { handleCsvWriteSuccess, handleCsvProcessingEvent } from './csv.handlers';
import { handleJsonlWriteSuccess, handleJsonlWriteFailed } from './jsonl.handlers';

export const fileOutputEventHandlers: { [key: string]: LogEventHandler } = {
    // JSONL Output
    'append_final_record_success': handleJsonlWriteSuccess,
    'append_final_record_failed': handleJsonlWriteFailed,

    // CSV Output
    'csv_write_record_success': handleCsvWriteSuccess,
    'csv_record_processed_for_writing': handleCsvProcessingEvent,
    'csv_stream_collect_success': handleCsvProcessingEvent,
    'csv_stream_collect_failed': handleCsvProcessingEvent,
    'csv_generation_pipeline_failed': handleCsvProcessingEvent,
    'csv_generation_failed_or_empty': handleCsvProcessingEvent,
    'csv_generation_empty_but_file_exists': handleCsvProcessingEvent,
};