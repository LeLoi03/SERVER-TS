// src/types/search.types.ts

/**
 * Defines high-level health metrics related to Google Custom Search API key rotations and usage.
 */
export interface GoogleSearchHealthData {
    /** The number of successful API key rotations. */
    rotationsSuccess: number;
    /** The number of failed API key rotations. */
    rotationsFailed: number;
    /** The total count of times all configured API keys were exhausted when attempting to get the next available key. */
    allKeysExhaustedOnGetNextKey: number;
    /** The total number of times maximum usage limits (across all keys) were reported as reached. */
    maxUsageLimitsReachedTotal: number;
    /** The number of successful search queries that returned no items (i.e., empty results). */
    successfulSearchesWithNoItems: number;
}

/**
 * Comprehensive analysis of Google Search operations.
 */
export interface GoogleSearchAnalysis {
    /** Total number of Google Search API requests made. */
    totalRequests: number;
    /** Number of successful search queries. */
    successfulSearches: number;
    /** Number of failed search queries. */
    failedSearches: number;
    /** Number of search queries that were skipped. */
    skippedSearches: number;
    /** Number of times general quota errors were encountered (can overlap with keySpecificLimitsReached). */
    quotaErrors: number;
    /** Breakdown of API key usage by key. */
    keyUsage: { [apiKey: string]: number };
    /** A map of error types to their counts, where keys are normalized error strings. */
    errorsByType: { [normalizedErrorKey: string]: number };
    /** Number of issues encountered during search attempts (e.g., malformed URLs). */
    attemptIssues: number;
    /** Detailed breakdown of specific attempt issues. */
    attemptIssueDetails: Record<string, number>;
    /** Number of times Google API key limits were explicitly reached. */
    apiKeyLimitsReached: number;
    /** Breakdown of limits reached for specific API keys. */
    keySpecificLimitsReached: Record<string, number>;
    /** Total number of API keys provided for Google Search. */
    apiKeysProvidedCount: number;
    /** Number of times all keys were exhausted when getting the next key. */
    allKeysExhaustedEvents_GetNextKey: number;
    /** Number of times all keys were exhausted during status checks. */
    allKeysExhaustedEvents_StatusCheck: number;
    /** Number of successful API key rotations. */
    apiKeyRotationsSuccess: number;
    /** Number of failed API key rotations. */
    apiKeyRotationsFailed: number;
    /** Number of successful searches that returned no items. */
    successfulSearchesWithNoItems: number;
    /** Number of times malformed result items were received from Google CSE. */
    malformedResultItems: number;
}