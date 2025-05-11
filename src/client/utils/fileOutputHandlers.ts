// src/client/utils/eventHandlers/fileOutputHandlers.ts
import { LogEventHandler } from './commonHandlers';
import { normalizeErrorKey, addConferenceError } from './helpers';
// import { logger } from '../../../conference/11_utils'; // Chỉ import nếu dùng


export const handleCsvWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        confDetail.status = 'completed';
        confDetail.csvWriteSuccess = true;
        confDetail.endTime = entryTimestampISO;
        // logger.trace({ ...logContext, event: 'analysis_mark_completed_csv' }, 'Marked conference as completed (CSV write success).');
    } else {
        // logger.warn({ ...logContext, event: 'analysis_csv_success_no_detail', acronym: logEntry.context?.acronym, title: logEntry.context?.title }, 'CSV write success event found but no corresponding conference detail.');
    }
};


export const handleCsvWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'CSV record write failed';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.status = 'failed';
        confDetail.csvWriteSuccess = false;
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        // logger.warn({ ...logContext, event: 'analysis_mark_failed_csv_write' }, 'Marked conference as failed (CSV write failure).');
    } else {
        // logger.warn({ ...logContext, event: 'analysis_csv_fail_no_detail', acronym: logEntry.context?.acronym, title: logEntry.context?.title }, 'CSV write failure event found but cannot link to conference detail.');
    }
};

export const handleJsonlWriteSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (confDetail) {
        // confDetail.status = 'completed';
        confDetail.jsonlWriteSuccess = true;
        confDetail.endTime = entryTimestampISO;
        // logger.trace({ ...logContext, event: 'analysis_mark_completed_jsonl' }, 'Marked conference as completed (jsonl write success).');
    } else {
        // logger.warn({ ...logContext, event: 'analysis_jsonl_success_no_detail', acronym: logEntry.context?.acronym, title: logEntry.context?.title }, 'jsonl write success event found but no corresponding conference detail.');
    }
};


export const handleJsonlWriteFailed: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || 'Jsonl record write failed';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;

    if (confDetail) {
        confDetail.status = 'failed';
        confDetail.jsonlWriteSuccess = false;
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);
        // logger.warn({ ...logContext, event: 'analysis_mark_failed_jsonl_write' }, 'Marked conference as failed (jsonl write failure).');
    } else {
        // logger.warn({ ...logContext, event: 'analysis_jsonl_fail_no_detail', acronym: logEntry.context?.acronym, title: logEntry.context?.title }, 'JSONL write failure event found but cannot link to conference detail.');
    }
};