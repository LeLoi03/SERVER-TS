// src/types/common.types.ts

/**
 * Provides timing and status information for a specific batch request or a conference detail.
 */
export interface RequestTimings {
    /** The start time of the request in ISO string format, or null if not available. */
    startTime: string | null;
    /** The end time of the request in ISO string format, or null if not available. */
    endTime: string | null;
    /** The duration of the request in seconds, or null if times are not available. */
    durationSeconds: number | null;
    /**
     * The overall status of the request processing.
     * - 'Completed': All tasks within the request finished successfully.
     * - 'Failed': The request processing failed completely.
     * - 'Processing': The request is still ongoing.
     * - 'CompletedWithErrors': The request completed, but some sub-tasks had errors.
     * - 'PartiallyCompleted': The request completed partially, some parts succeeded, others didn't start or were stopped without error.
     * - 'Skipped': All tasks within the request were skipped (e.g., due to configuration).
     * - 'NoData': No relevant log data found for this request ID.
     * - 'Unknown': Status could not be determined.
     */
    status?:
    | 'Completed'
    | 'Failed'
    | 'Processing'
    | 'CompletedWithErrors'
    | 'PartiallyCompleted'
    | 'Skipped'
    | 'NoData'
    | 'Unknown';
    /** Optional: The original ID provided for the request, if it was a re-crawl. */
    originalRequestId?: string;
}

/**
 * Aggregates all relevant log entries for a given batch request ID.
 * This acts as a container for raw log data pertaining to a single request.
 */
export interface RequestLogData {
    /** An array of raw log entries associated with this request.
     *  Ideally, this would be `PinoLogEntry[]` if Pino logs have a consistent interface.
     *  For now, `any[]` is used for flexibility.
     */
    logs: any[];
    /** The earliest Unix timestamp (milliseconds) found for this request. */
    startTime: number | null;
    /** The latest Unix timestamp (milliseconds) found for this request. */
    endTime: number | null;
}

/**
 * Represents the overall result of reading and initially parsing log files.
 */
export interface ReadLogResult {
    /** A Map where keys are `batchRequestId` and values are `RequestLogData` objects. */
    requestsData: Map<string, RequestLogData>;
    /** The total number of log entries read from the file(s). */
    totalEntries: number;
    /** The number of log entries successfully parsed. */
    parsedEntries: number;
    /** The number of errors encountered during log parsing. */
    parseErrors: number;
    /** An array of error messages encountered during the log processing (e.g., file read errors). */
    logProcessingErrors: string[];
}

/**
 * Represents data that has been filtered based on time range or request ID.
 */
export interface FilteredData {
    /** A Map of requests that passed the filter criteria. */
    filteredRequests: Map<string, RequestLogData>;
    /** The start timestamp (milliseconds) of the analysis period, based on filters applied. */
    analysisStartMillis: number | null;
    /** The end timestamp (milliseconds) of the analysis period, based on filters applied. */
    analysisEndMillis: number | null;
}


export interface LogErrorContext {
    phase?: 'primary_execution' | 'fallback_execution' | 'setup' | 'response_processing' | 'sdk_call' | string;
    modelIdentifier?: string;
    apiType?: string;
    [key: string]: any; // <-- Dòng này cho phép thêm bất kỳ thuộc tính nào khác
}



/**
 * Represents a generic error structure for logging.
 */
export interface LogError {
    timestamp: string;
    message: string;
    key: string; // Normalized key
    details?: any;
    errorCode?: string;
    sourceService?: string;
    errorType?: 'DataParsing' | 'Network' | 'APIQuota' | 'Logic' | 'FileSystem' | 'SafetyBlock' | 'Configuration' | 'Unknown' | 'ThirdPartyAPI';
    isRecovered?: boolean; // True nếu lỗi này đã được khắc phục bởi một hành động sau đó (ví dụ: fallback)
    context?: LogErrorContext; // Context chi tiết hơn về nguồn gốc lỗi
}