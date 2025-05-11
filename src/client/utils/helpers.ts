import { ConferenceAnalysisDetail } from '../types/logAnalysis'; // Adjust path if needed
// import { logger } from '../../conference/11_utils'; // Adjust path if needed
import { LogAnalysisResult } from '../types/logAnalysis';

// --- Helper function: Normalize Error Key ---
export const normalizeErrorKey = (error: any): string => {
    let message = 'Unknown Error Structure';
    if (error && typeof error === 'object') {
        message = error.message || error.reason || error.details || JSON.stringify(error);
    } else if (error) {
        message = String(error);
    }
    // Limit length, replace numbers, normalize whitespace
    return message.substring(0, 150).replace(/\d+/g, 'N').replace(/\s+/g, ' ').trim();
};

// --- Helper function: Create Composite Key ---
export const createConferenceKey = (acronym?: string | null, title?: string | null): string | null => {
    if (acronym && typeof acronym === 'string' && acronym.trim() !== '' &&
        title && typeof title === 'string' && title.trim() !== '') {
        // Only create key if both acronym and title are valid and non-empty
        return `${acronym.trim()} - ${title.trim()}`;
    }
    // Return null if missing information for a reliable unique key
    return null;
};

// --- Helper function: Initialize Conference Detail ---
export const initializeConferenceDetail = (acronym: string, title: string): ConferenceAnalysisDetail => ({
    title: title,
    acronym: acronym,
    status: 'unknown', // Initial status
    startTime: null,
    endTime: null,
    durationSeconds: null,
    steps: {
        search_attempted: false,
        search_success: null,
        search_attempts_count: 0,
        search_results_count: null,
        search_filtered_count: null,
        html_save_attempted: false,
        link_processing_failed: [],
        html_save_success: null,
        link_processing_attempted: 0,
        link_processing_success: 0,
        gemini_determine_attempted: false,
        gemini_determine_success: null,
        gemini_determine_cache_used: null,
        gemini_extract_attempted: false,
        gemini_extract_success: null,
        gemini_extract_cache_used: null,
    },
    errors: [],

    validationIssues: [],


    finalResultPreview: undefined,
});

// --- Helper function: Add Error to Conference Detail ---
export const addConferenceError = (
    detail: ConferenceAnalysisDetail,
    timestamp: string,
    errorSource: any,
    defaultMsg: string
) => {
    const normError = normalizeErrorKey(errorSource || defaultMsg);
    detail.errors.push({
        timestamp: timestamp,
        message: normError,
        // Include more details if available, handling potential circular references
        details: errorSource ? JSON.stringify(errorSource, Object.getOwnPropertyNames(errorSource), 2) : undefined
    });
    // Optionally log the error addition
    // logger.debug({ event: 'add_conference_error', acronym: detail.acronym, title: detail.title, error: normError }, "Added error to conference detail");
};

// --- Helper function: Initialize Log Analysis Result Structure ---
export const initializeLogAnalysisResult = (logFilePath: string): LogAnalysisResult => ({
    analysisTimestamp: new Date().toISOString(),
    logFilePath: logFilePath,
    totalLogEntries: 0,
    parsedLogEntries: 0,
    parseErrors: 0,
    errorLogCount: 0, // Errors within the *analyzed* time range
    fatalLogCount: 0, // Fatal errors within the *analyzed* time range
    overall: {
        startTime: null, endTime: null, durationSeconds: null, totalConferencesInput: 0,
        processedConferencesCount: 0, completedTasks: 0, failedOrCrashedTasks: 0, processingTasks: 0, successfulExtractions: 0
    },
    googleSearch: {
        totalRequests: 0, successfulSearches: 0, failedSearches: 0, skippedSearches: 0, quotaErrors: 0, keyUsage: {}, errorsByType: {},
        attemptIssues: 0, attemptIssueDetails: {}, quotaErrorsEncountered: 0, malformedResultItems: 0, successfulSearchesWithNoItems: 0, 
        apiKeyLimitsReached: 0, keySpecificLimitsReached: {}, apiKeysProvidedCount: 0, allKeysExhaustedEvents_GetNextKey: 0,
        allKeysExhaustedEvents_StatusCheck: 0, apiKeyRotationsSuccess: 0, apiKeyRotationsFailed: 0
    },
    playwright: {
        setupSuccess: null, setupError: null, htmlSaveAttempts: 0, successfulSaves: 0, failedSaves: 0, linkProcessing: { totalLinksAttempted: 0, successfulAccess: 0, failedAccess: 0, redirects: 0 }, errorsByType: {}
    },
    geminiApi: {
        totalCalls: 0, callsByType: {}, callsByModel: {}, successfulCalls: 0, failedCalls: 0, retriesByType: {}, retriesByModel: {}, cacheAttempts: 0, cacheHits: 0, cacheMisses: 0, cacheCreationSuccess: 0, cacheCreationFailed: 0, cacheInvalidations: 0, blockedBySafety: 0, totalTokens: 0, errorsByType: {}, rateLimitWaits: 0
    },
    batchProcessing: {
        totalBatchesAttempted: 0, successfulBatches: 0, failedBatches: 0, aggregatedResultsCount: null
    },
    errorsAggregated: {},
    logProcessingErrors: [],
    conferenceAnalysis: {}, // Key: "acronym - title"

    validationStats: {
        totalValidationWarnings: 0,
        warningsByField: {},
        totalNormalizationsApplied: 0,
        normalizationsByField: {},
    },
});

// --- Helper function: Check if request overlaps with filter range ---
export const doesRequestOverlapFilter = (
    reqStartMillis: number | null,
    reqEndMillis: number | null,
    filterStartMillis: number | null,
    filterEndMillis: number | null,
    requestId: string // For logging context
): boolean => {
    const logContext = { function: 'doesRequestOverlapFilter', requestId };

    if (filterStartMillis === null && filterEndMillis === null) {
        return true; // No filter applied
    }

    if (reqStartMillis === null || reqEndMillis === null) {
        // If strict filtering is needed, exclude requests without a full time range
        // logger.debug({ ...logContext, event: 'filter_exclude_incomplete_timestamp' }, 'Excluding request from filtered analysis due to missing start/end time.');
        return false;
    }

    // --- Overlap Check ---
    // Request range: [reqStartMillis, reqEndMillis]
    // Filter range:  [filterStartMillis, filterEndMillis]
    // Overlap exists if reqStart <= filterEnd AND reqEnd >= filterStart
    const overlaps = (filterEndMillis === null || reqStartMillis <= filterEndMillis) &&
        (filterStartMillis === null || reqEndMillis >= filterStartMillis);

    // --- Alternative: Start Time Check (Simpler, if only filtering by start time is desired) ---
    /*
    let overlaps = true;
    if (filterStartMillis !== null && reqStartMillis < filterStartMillis) {
        overlaps = false;
    }
    if (filterEndMillis !== null && reqStartMillis > filterEndMillis) {
        overlaps = false;
    }
    */

    if (!overlaps) {
        // logger.trace({ ...logContext, event: 'filter_exclude_no_overlap', reqStartMillis, reqEndMillis, filterStartMillis, filterEndMillis }, 'Excluding request: time range does not overlap with filter.');
    }

    return overlaps;
};