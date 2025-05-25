/**
 * @fileoverview Cung cấp các hàm khởi tạo (initializer functions) để tạo các đối tượng phân tích
 * với các giá trị mặc định. Điều này giúp đảm bảo tính nhất quán và dễ dàng khởi tạo trạng thái ban đầu
 * cho các cấu trúc dữ liệu phân tích nhật ký.
 */

import { OverallAnalysis, LogAnalysisResult, ConferenceAnalysisDetail, ConferenceCrawlType } from './analysis.types';
import { GoogleSearchAnalysis, GoogleSearchHealthData } from './search.types';
import { GeminiApiAnalysis } from './gemini.types';
import { PlaywrightAnalysis } from './playwright.types';
import { BatchProcessingAnalysis } from './batchProcessing.types';
import { FileOutputAnalysis } from './fileOutput.types';
import { ValidationStats, DataQualityInsight } from './validation.types';
import { RequestTimings, LogError } from './common.types'; // Đảm bảo đã import LogError

/**
 * @function getInitialOverallAnalysis
 * @description Khởi tạo một đối tượng `OverallAnalysis` rỗng với các giá trị mặc định.
 * @returns {OverallAnalysis} Một thể hiện `OverallAnalysis` mới.
 */
export const getInitialOverallAnalysis = (): OverallAnalysis => ({
    startTime: null,
    endTime: null,
    durationSeconds: null,
    totalConferencesInput: 0,
    processedConferencesCount: 0,
    completedTasks: 0,
    failedOrCrashedTasks: 0,
    processingTasks: 0,
    skippedTasks: 0,
    successfulExtractions: 0,
});

/**
 * @function getInitialGoogleSearchHealthData
 * @description Khởi tạo một đối tượng `GoogleSearchHealthData` rỗng với các giá trị mặc định.
 * @returns {GoogleSearchHealthData} Một thể hiện `GoogleSearchHealthData` mới.
 */
export const getInitialGoogleSearchHealthData = (): GoogleSearchHealthData => ({
    rotationsSuccess: 0,
    rotationsFailed: 0,
    allKeysExhaustedOnGetNextKey: 0,
    maxUsageLimitsReachedTotal: 0,
    successfulSearchesWithNoItems: 0,
});

/**
 * @function getInitialGoogleSearchAnalysis
 * @description Khởi tạo một đối tượng `GoogleSearchAnalysis` rỗng với các giá trị mặc định.
 * @returns {GoogleSearchAnalysis} Một thể hiện `GoogleSearchAnalysis` mới.
 */
export const getInitialGoogleSearchAnalysis = (): GoogleSearchAnalysis => ({
    totalRequests: 0,
    successfulSearches: 0,
    failedSearches: 0,
    skippedSearches: 0,
    quotaErrors: 0,
    keyUsage: {},
    errorsByType: {},
    attemptIssues: 0,
    attemptIssueDetails: {},
    apiKeyLimitsReached: 0,
    keySpecificLimitsReached: {},
    apiKeysProvidedCount: 0,
    allKeysExhaustedEvents_GetNextKey: 0,
    allKeysExhaustedEvents_StatusCheck: 0,
    apiKeyRotationsSuccess: 0,
    apiKeyRotationsFailed: 0,
    successfulSearchesWithNoItems: 0,
    malformedResultItems: 0,
});

/**
 * @function getInitialPlaywrightAnalysis
 * @description Khởi tạo một đối tượng `PlaywrightAnalysis` rỗng với các giá trị mặc định.
 * @returns {PlaywrightAnalysis} Một thể hiện `PlaywrightAnalysis` mới.
 */
export const getInitialPlaywrightAnalysis = (): PlaywrightAnalysis => ({
    setupAttempts: 0,
    setupSuccess: null,
    setupError: null,
    contextErrors: 0,
    htmlSaveAttempts: 0,
    successfulSaveInitiations: 0,
    failedSaves: 0,
    skippedSaves: 0,
    linkProcessing: {
        totalLinksAttempted: 0,
        successfulAccess: 0,
        failedAccess: 0,
        redirects: 0,
    },
    otherFailures: 0,
    errorsByType: {},
});

/**
 * @function getInitialGeminiApiAnalysis
 * @description Khởi tạo một đối tượng `GeminiApiAnalysis` rỗng với các giá trị mặc định.
 * @returns {GeminiApiAnalysis} Một thể hiện `GeminiApiAnalysis` mới.
 */
export const getInitialGeminiApiAnalysis = (): GeminiApiAnalysis => ({
    // --- Call Stats ---
    totalCalls: 0,
    successfulCalls: 0,
    failedCalls: 0,
    callsByType: {},
    callsByModel: {},

    // --- Retry Stats ---
    totalRetries: 0,
    retriesByType: {},
    retriesByModel: {},

    // --- Model Usage by API Type and Crawl Model ---
    modelUsageByApiType: {},

    // --- Orchestration Stats ---
    primaryModelStats: {
        attempts: 0,
        successes: 0,
        failures: 0,
        preparationFailures: 0,
        skippedOrNotConfigured: 0,
    },
    fallbackModelStats: {
        attempts: 0,
        successes: 0,
        failures: 0,
        preparationFailures: 0,
        notConfiguredWhenNeeded: 0,
    },
    // fallbackLogic is deprecated but kept for compatibility with old logs.
    // For new analysis, primaryModelStats and fallbackModelStats are preferred.
    fallbackLogic: {
        attemptsWithFallbackModel: 0,
        successWithFallbackModel: 0,
        primaryModelFailuresLeadingToFallback: 0,
        noFallbackConfigured: 0,
        failedAfterFallbackAttempts: 0,
    },

    // --- Token Usage ---
    totalTokens: 0,

    // --- Error & Limit Stats ---
    blockedBySafety: 0,
    rateLimitWaits: 0,
    intermediateErrors: 0,
    errorsByType: {},

    // --- Service & Client Initialization ---
    serviceInitialization: {
        starts: 0,
        completes: 0,
        failures: 0,
        lazyAttempts: 0,
        criticallyUninitialized: 0,
        clientInitAttempts: 0,
        clientGenAiSuccesses: 0,
        clientCacheManagerSuccesses: 0,
        clientInitFailures: 0,
        noApiKeysConfigured: 0,
        noClientsInitializedOverall: 0,
    },
    apiCallSetupFailures: 0,

    // --- Model Preparation (from GeminiModelOrchestratorService) ---
    modelPreparationStats: {
        attempts: 0,
        successes: 0,
        failures: 0,
        criticalFailures: 0,
    },

    // --- API Key Management (from GeminiClientManagerService) ---
    apiKeyManagement: {
        unhandledApiTypeSelections: 0,
        noKeysAvailableSelections: 0,
        indexOutOfBoundsSelections: 0,
    },

    // --- Rate Limiter Setup (from GeminiRateLimiterService) ---
    rateLimiterSetup: {
        creationAttempts: 0,
        creationSuccesses: 0,
        creationFailures: 0,
    },

    // --- Few-Shot Preparation ---
    fewShotPreparation: {
        attempts: 0,
        successes: 0,
        failures: { oddPartsCount: 0, processingError: 0 },
        warnings: { missingInput: 0, missingOutput: 0, emptyResult: 0 },
        configuredButNoData: 0,
        disabledByConfig: 0,
    },

    // --- Request Payload Logging ---
    requestPayloadLogging: {
        successes: 0,
        failures: 0,
    },

    // --- Generate Content (model.generateContent() calls) ---
    generateContentInternal: {
        attempts: 0,
        successes: 0,
    },

    // --- Cache Specifics ---
    cacheDecisionStats: {
        cacheUsageAttempts: 0,
        cacheExplicitlyDisabled: 0,
    },
    cacheContextHits: 0,
    cacheContextAttempts: 0,
    cacheContextCreationSuccess: 0,
    cacheContextRetrievalSuccess: 0,
    cacheContextMisses: 0, // Kept for backward compatibility if old logs might use it.
    cacheContextCreationFailed: 0,
    cacheContextInvalidations: 0,
    cacheContextRetrievalFailures: 0,
    cacheMapLoadAttempts: 0,
    cacheMapLoadFailures: 0,
    cacheMapLoadSuccess: null, // null indicates not attempted or unknown
    cacheMapWriteAttempts: 0,
    cacheMapWriteSuccessCount: 0,
    cacheMapWriteFailures: 0,
    cacheManagerCreateFailures: 0, // Kept for backward compatibility.

    // --- Response Processing ---
    responseProcessingStats: {
        markdownStripped: 0,
        jsonValidationsSucceededInternal: 0,
        jsonValidationFailedInternal: 0,
        jsonCleaningSuccessesPublic: 0,
        emptyAfterProcessingInternal: 0,
        publicMethodFinishes: 0,
        trailingCommasFixed: 0,
        blockedBySafetyInResponseHandler: 0,
        responseFileWrites: 0,
        responseFileWriteFailures: 0,
    },

    // --- Config Errors ---
    serviceInitializationFailures: 0, // Should be marked as @deprecated in GeminiApiAnalysis type.
    configErrors: {
        modelListMissing: 0,
        apiTypeConfigMissing: 0,
        // Add other specific config errors here if they are part of the type.
    },
});

/**
 * @function getInitialBatchProcessingAnalysis
 * @description Khởi tạo một đối tượng `BatchProcessingAnalysis` rỗng với các giá trị mặc định.
 * @returns {BatchProcessingAnalysis} Một thể hiện `BatchProcessingAnalysis` mới.
 */
export const getInitialBatchProcessingAnalysis = (): BatchProcessingAnalysis => ({
    totalBatchesAttempted: 0,
    successfulBatches: 0,
    failedBatches: 0,
    apiFailures: 0,
    fileSystemFailures: 0,
    logicRejections: 0,
    aggregatedResultsCount: null,
    determineApiFailures: 0,
    extractApiFailures: 0,
    cfpApiFailures: 0,
    apiResponseParseFailures: 0,
});

/**
 * @function getInitialFileOutputAnalysis
 * @description Khởi tạo một đối tượng `FileOutputAnalysis` rỗng với các giá trị mặc định.
 * @returns {FileOutputAnalysis} Một thể hiện `FileOutputAnalysis` mới.
 */
export const getInitialFileOutputAnalysis = (): FileOutputAnalysis => ({
    jsonlRecordsSuccessfullyWritten: 0,
    jsonlWriteErrors: 0,
    csvFileGenerated: null,
    csvRecordsAttempted: 0,
    csvRecordsSuccessfullyWritten: 0,
    csvWriteErrors: 0,
    csvOrphanedSuccessRecords: 0,
    csvPipelineFailures: 0,
});

/**
 * @function getInitialValidationStats
 * @description Khởi tạo một đối tượng `ValidationStats` rỗng với các giá trị mặc định.
 * @returns {ValidationStats} Một thể hiện `ValidationStats` mới.
 */
export const getInitialValidationStats = (): ValidationStats => ({
    totalValidationWarnings: 0,
    warningsByField: {},
    warningsBySeverity: {
        Low: 0,
        Medium: 0,
        High: 0,
    },
    warningsByInsightMessage: {},
    totalNormalizationsApplied: 0,
    normalizationsByField: {},
    normalizationsByReason: {},
});

/**
 * @function getInitialLogAnalysisResult
 * @description Khởi tạo một đối tượng `LogAnalysisResult` hoàn chỉnh với các giá trị mặc định cho tất cả các thành phần của nó.
 * @param {string} [logFilePath="N/A"] - Đường dẫn đến tệp nhật ký đang được phân tích. Mặc định là "N/A".
 * @returns {LogAnalysisResult} Một thể hiện `LogAnalysisResult` mới.
 */
export const getInitialLogAnalysisResult = (logFilePath: string = "N/A"): LogAnalysisResult => ({
    analysisTimestamp: new Date().toISOString(),
    logFilePath: logFilePath,
    status: 'Processing',
    errorMessage: undefined,
    filterRequestId: undefined,
    analyzedRequestIds: [],
    requests: {},
    totalLogEntries: 0,
    parsedLogEntries: 0,
    parseErrors: 0,
    errorLogCount: 0,
    fatalLogCount: 0,
    googleSearch: getInitialGoogleSearchAnalysis(),
    playwright: getInitialPlaywrightAnalysis(),
    geminiApi: getInitialGeminiApiAnalysis(),
    batchProcessing: getInitialBatchProcessingAnalysis(),
    fileOutput: getInitialFileOutputAnalysis(),
    validationStats: getInitialValidationStats(),
    overall: getInitialOverallAnalysis(),
    errorsAggregated: {},
    logProcessingErrors: [],
    conferenceAnalysis: {},
});