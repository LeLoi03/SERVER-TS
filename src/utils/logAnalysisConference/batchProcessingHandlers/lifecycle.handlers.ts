// src/utils/logAnalysis/batchProcessingHandlers/lifecycle.handlers.ts

/**
 * Handles the primary lifecycle events of a batch task, such as creation and successful completion.
 */

import { LogEventHandler } from '../index';

export const handleBatchTaskCreate: LogEventHandler = (logEntry, results) => {
    results.batchProcessing.totalBatchesAttempted = (results.batchProcessing.totalBatchesAttempted || 0) + 1;
};

export const handleBatchFinishSuccess: LogEventHandler = (logEntry, results, confDetail) => {
    results.batchProcessing.successfulBatches = (results.batchProcessing.successfulBatches || 0) + 1;

    if (confDetail && confDetail.status !== 'failed') {
        // Logic to potentially update conference status upon successful batch processing, if needed.
        // Currently, the main status is determined by task_finish, so this might just be for stats.
    }
};