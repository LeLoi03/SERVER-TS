// src/client/utils/eventHandlers/batchProcessingHandlers.ts
import { LogEventHandler } from './commonHandlers';
import { normalizeErrorKey, addConferenceError } from './helpers';

export const handleBatchRejection: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.batchProcessing.failedBatches++;
    const error = logEntry.err || logEntry.reason || 'Batch promise rejected';
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        addConferenceError(confDetail, entryTimestampISO, error, 'Batch processing step failed (rejected)');
    }
};

export const handleSaveBatchApiFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Save batch step failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    if (confDetail) {
        if (logEntry.event.includes('determine')) confDetail.steps.gemini_determine_success = false;
        if (logEntry.event.includes('extract')) confDetail.steps.gemini_extract_success = false;
        confDetail.status = 'failed';
        confDetail.endTime = entryTimestampISO;
        addConferenceError(confDetail, entryTimestampISO, error, errorKey);

    }
};

export const handleSaveBatchFsFailure: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    const error = logEntry.err || logEntry.reason || logEntry.msg || `Save batch FS operation failed (${logEntry.event})`;
    const errorKey = normalizeErrorKey(error);
    results.errorsAggregated[errorKey] = (results.errorsAggregated[errorKey] || 0) + 1;
    // Typically not added to specific conference detail unless context links it
};




export const handleSaveBatchFinishSuccess: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    // Assuming this event signifies one successful batch operation completion
    results.batchProcessing.successfulBatches++;
    // logger.trace({ ...logContext, event: 'analysis_batch_op_success' }, 'Counted successful batch operation.');
    // Note: This doesn't necessarily mean the overall conference succeeded, just one batch file write.
};


export const handleBatchTaskCreate: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    results.batchProcessing.totalBatchesAttempted++;
};


export const handleBatchAggregationEnd: LogEventHandler = (logEntry, results, confDetail, entryTimestampISO, logContext) => {
    if (logEntry.context?.aggregatedCount !== null) {
        results.batchProcessing.aggregatedResultsCount = logEntry.context.aggregatedCount;
    }
};
