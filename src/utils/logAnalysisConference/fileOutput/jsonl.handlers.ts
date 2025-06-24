// src/utils/logAnalysis/fileOutputHandlers/jsonl.handlers.ts

/**
 * Handles events related to writing final records to JSONL files.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, addConferenceError } from '../utils';
import { LogErrorContext } from '../../../types/logAnalysis';
import { ensureFileOutputAnalysis, ensureOverallAnalysis } from './helpers';

export const handleJsonlWriteSuccess: LogEventHandler = (logEntry, results, confDetail) => {
    const fileOutputStats = ensureFileOutputAnalysis(results);
    if (confDetail) {
        confDetail.jsonlWriteSuccess = true;
        fileOutputStats.jsonlRecordsSuccessfullyWritten = (fileOutputStats.jsonlRecordsSuccessfullyWritten || 0) + 1;
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
        confDetail.jsonlWriteSuccess = false;

        if (previousStatus !== 'failed' && previousStatus !== 'skipped') {
            confDetail.status = 'failed';
            confDetail.endTime = entryTimestampISO;

            overallStats.failedOrCrashedTasks = (overallStats.failedOrCrashedTasks || 0) + 1;
            if (previousStatus === 'processing' && overallStats.processingTasks > 0) {
                overallStats.processingTasks--;
            } else if (previousStatus === 'completed' && overallStats.completedTasks > 0) {
                overallStats.completedTasks--;
            }
        }

        const errorContext: LogErrorContext = { phase: 'response_processing', ...logEntry.context };
        addConferenceError(confDetail, entryTimestampISO, errorSource, {
            defaultMessage,
            keyPrefix: 'jsonl_write_failed',
            sourceService: logEntry.service || 'FileOutputService',
            errorType: 'FileSystem',
            context: errorContext,
            additionalDetails: { filePath: logEntry.filePath, batchSize: logEntry.batchSize }
        });
    }
};