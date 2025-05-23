// src/types/fileOutput.types.ts

/**
 * Analysis of file output operations (JSONL and CSV).
 */
export interface FileOutputAnalysis {
    /** Number of records successfully written to JSONL files. */
    jsonlRecordsSuccessfullyWritten: number;
    /** Number of errors encountered during JSONL file writes. */
    jsonlWriteErrors: number;
    /** Whether a CSV file was successfully generated (null if not attempted/finished). */
    csvFileGenerated: boolean | null;
    /** Number of records attempted to be written to CSV. */
    csvRecordsAttempted: number;
    /** Number of records successfully written to CSV. */
    csvRecordsSuccessfullyWritten: number;
    /** Number of errors encountered during CSV file writes. */
    csvWriteErrors: number;
    /** Number of successful CSV records that were "orphaned" (e.g., not linked to a full batch success). */
    csvOrphanedSuccessRecords: number;
    /** Number of failures in the overall CSV pipeline. */
    csvPipelineFailures: number;
    /** Optional: Other unclassified CSV-related errors. */
    csvOtherErrors?: number;
}