// src/utils/logAnalysis/fileOutputHandlers/csv.handlers.ts

/**
 * Handles all events related to the processing and writing of CSV files.
 */

import { LogEventHandler } from '../index';
import { normalizeErrorKey, createConferenceKey } from '../utils';
import { ensureFileOutputAnalysis, ensureOverallAnalysis } from './helpers';

export const handleCsvWriteSuccess: LogEventHandler = (logEntry, results, _confDetailIgnored, entryTimestampISO) => {
    const fileOutput = ensureFileOutputAnalysis(results);
    const overall = ensureOverallAnalysis(results);

    const acronym = logEntry.conferenceAcronym;
    const title = logEntry.conferenceTitle;
    const batchRequestId = logEntry.batchRequestId;

    if (!batchRequestId || !acronym || !title) {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
        return;
    }

    const compositeKey = createConferenceKey(batchRequestId, acronym, title);

    if (compositeKey && results.conferenceAnalysis[compositeKey]) {
        const confDetail = results.conferenceAnalysis[compositeKey];
        const previousStatus = confDetail.status;

        if (previousStatus !== 'completed') {
            confDetail.status = 'completed';
            confDetail.csvWriteSuccess = true;
            if (!confDetail.endTime) confDetail.endTime = entryTimestampISO;
            if (confDetail.startTime && confDetail.endTime) {
                try {
                    const start = new Date(confDetail.startTime).getTime();
                    const end = new Date(confDetail.endTime).getTime();
                    if (!isNaN(start) && !isNaN(end) && end >= start) confDetail.durationSeconds = Math.round((end - start) / 1000);
                } catch (e) { /* ignore */ }
            }

            overall.completedTasks = (overall.completedTasks || 0) + 1;

            if (previousStatus === 'processing') {
                if (overall.processingTasks > 0) overall.processingTasks--;
            } else if (previousStatus === 'failed') {
                if (overall.failedOrCrashedTasks > 0) overall.failedOrCrashedTasks--;
                confDetail.errors.forEach((err: any) => {
                    if (!err.isRecovered && (err.errorType === 'FileSystem' || (err.errorType === 'Logic' && err.key.includes('csv_write_failed')))) {
                        err.isRecovered = true;
                    }
                });
            } else if (previousStatus === 'skipped') {
                if (overall.skippedTasks > 0) overall.skippedTasks--;
            }
        }
        fileOutput.csvRecordsSuccessfullyWritten = (fileOutput.csvRecordsSuccessfullyWritten || 0) + 1;
    } else {
        fileOutput.csvOrphanedSuccessRecords = (fileOutput.csvOrphanedSuccessRecords || 0) + 1;
    }
};

export const handleCsvProcessingEvent: LogEventHandler = (logEntry, results) => {
    const fileOutput = ensureFileOutputAnalysis(results);
    const eventName = logEntry.event as string | undefined;
    const batchRequestId = logEntry.batchRequestId as string | undefined;

    switch (eventName) {
        case 'csv_record_processed_for_writing':
            fileOutput.csvRecordsAttempted = (fileOutput.csvRecordsAttempted || 0) + 1;
            break;
        case 'csv_stream_collect_success':
            const recordsWritten = logEntry.recordsWrittenToCsv ?? logEntry.context?.recordsWrittenToCsv ?? -1;
            if (recordsWritten > 0 || logEntry.context?.allowEmptyFile) {
                fileOutput.csvFileGenerated = true;
            } else if (recordsWritten === 0 && !logEntry.context?.allowEmptyFile) {
                fileOutput.csvFileGenerated = false;
                fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;
            }
            break;
        case 'csv_stream_collect_failed':
        case 'csv_generation_pipeline_failed':
            fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;
            if (batchRequestId && results.requests[batchRequestId]) {
                results.requests[batchRequestId].csvOutputStreamFailed = true;
            }
            const errorSource = logEntry.err || logEntry;
            const keyForAggregation = normalizeErrorKey(errorSource);
            results.errorsAggregated[keyForAggregation] = (results.errorsAggregated[keyForAggregation] || 0) + 1;
            break;
        case 'csv_generation_failed_or_empty':
            if (!logEntry.context?.allowEmptyFileIfNoRecords || fileOutput.csvRecordsAttempted > 0) {
                fileOutput.csvPipelineFailures = (fileOutput.csvPipelineFailures || 0) + 1;
                if (batchRequestId && results.requests[batchRequestId]) {
                    results.requests[batchRequestId].csvOutputStreamFailed = true;
                }
                const errorSourceFc = logEntry.err || logEntry;
                const keyForAggregationFc = normalizeErrorKey(errorSourceFc);
                results.errorsAggregated[keyForAggregationFc] = (results.errorsAggregated[keyForAggregationFc] || 0) + 1;
            }
            break;
        case 'csv_generation_empty_but_file_exists':
            fileOutput.csvFileGenerated = true;
            break;
    }
};