// src/types/batchProcessing.types.ts

/**
 * Analysis of batch processing operations.
 */
export interface BatchProcessingAnalysis {
    /** Total number of batches attempted. */
    totalBatchesAttempted: number;
    /** Number of batches that completed successfully. */
    successfulBatches: number;
    /** Number of batches that failed. */
    failedBatches: number;
    /** Number of failures related to API calls within batches. */
    apiFailures: number;
    /** Number of failures related to file system operations within batches. */
    fileSystemFailures: number;
    /** Number of times processing was rejected due to logic (e.g., invalid input). */
    logicRejections: number;
    /** Aggregated count of results across all processed batches (null if no results). */
    aggregatedResultsCount: number | null;
    /** Number of failures in the 'determineLinks' API stage. */
    determineApiFailures: number;
    /** Number of failures in the 'extractInfo' API stage. */
    extractApiFailures: number;
    /** Number of failures in the 'extractCfp' API stage. */
    cfpApiFailures: number;
    /** Number of times API responses failed to parse. */
    apiResponseParseFailures: number;
}