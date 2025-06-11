// src/utils/logAnalysis/batchProcessingHandlers/info.handlers.ts

/**
 * Handles informational events related to batch processing, such as aggregation results.
 */

import { LogEventHandler } from '../index';

export const handleBatchAggregationEnd: LogEventHandler = (logEntry, results) => {
    const aggregatedCount = logEntry.aggregatedCount ?? logEntry.context?.aggregatedCount;
    const aggregatedItems = logEntry.aggregatedItems ?? logEntry.context?.aggregatedItems;
    const charCount = logEntry.charCount ?? logEntry.context?.charCount;

    if (aggregatedCount !== undefined && aggregatedCount !== null) {
        results.batchProcessing.aggregatedResultsCount = aggregatedCount;
    } else if (aggregatedItems !== undefined && aggregatedItems !== null) {
        results.batchProcessing.aggregatedResultsCount = aggregatedItems;
    } else if (charCount !== undefined && charCount !== null) {
        results.batchProcessing.aggregatedResultsCount = charCount;
    }
};