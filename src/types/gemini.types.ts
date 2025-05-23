// src/types/gemini.types.ts

/**
 * Detailed analysis of Gemini API (or other AI API) interactions.
 */
export interface GeminiApiAnalysis {
    // --- Call Stats ---
    /** Total number of API calls made to Gemini (sum of primary and fallback attempts that proceed to call). */
    totalCalls: number;
    /** Number of successful API calls (resulting in a usable response, either primary or fallback). */
    successfulCalls: number;
    /** Number of failed API calls (after all retries for a given model, and potentially after fallback). */
    failedCalls: number;
    /** Breakdown of API calls by specific API type (e.g., 'extract', 'determine', 'cfp'). */
    callsByType: { [apiType: string]: number };
    /** Breakdown of API calls by model name (e.g., 'gemini-pro', 'my-tuned-model'). */
    callsByModel: { [modelName: string]: number };

    // --- Retry Stats ---
    /** Total number of API call retries (attempts > 1 for a given model call). */
    totalRetries: number;
    /** Breakdown of retries by API type. */
    retriesByType: { [apiType: string]: number };
    /** Breakdown of retries by model name. */
    retriesByModel: { [modelName: string]: number };

    // --- Model Usage by API Type and Crawl Model ---
    /**
     * Detailed breakdown of model usage, including calls, retries, successes, failures, tokens, and safety blocks,
     * categorized by API type and then by specific model identifier (tuned/non-tuned).
     */
    modelUsageByApiType: {
        [apiType: string]: { // e.g., 'extract', 'determine', 'cfp'
            [modelIdentifier: string]: { // e.g., "gemini-pro (non-tuned)", "models/my-tuned-model (tuned)"
                calls: number; // Number of times this specific model was invoked (initial attempts)
                retries: number;
                successes: number;
                failures: number;
                tokens: number;
                safetyBlocks: number;
            };
        };
    };

    // --- Orchestration Stats ---
    primaryModelStats: {
        attempts: number; // Times primary model was selected for an API call
        successes: number; // Times primary model succeeded (on its single shot)
        failures: number; // Times primary model failed (on its single shot)
        preparationFailures: number; // Failures during prepareForApiCall for primary
        skippedOrNotConfigured: number;
    };
    fallbackModelStats: {
        attempts: number; // Times fallback model was selected after primary failed
        successes: number; // Times fallback model succeeded (after its retries)
        failures: number; // Times fallback model failed (after its retries)
        preparationFailures: number; // Failures during prepareForApiCall for fallback
        notConfiguredWhenNeeded: number; // Primary failed, but no fallback was available
    };
     /** @deprecated Use primaryModelStats and fallbackModelStats instead */
    fallbackLogic: {
        attemptsWithFallbackModel: number;
        successWithFallbackModel: number;
        primaryModelFailuresLeadingToFallback: number;
        noFallbackConfigured: number;
        failedAfterFallbackAttempts: number;
    };


    // --- Token Usage ---
    /** Total number of tokens consumed across all Gemini API calls. */
    totalTokens: number;

    // --- Error & Limit Stats ---
    /** Number of responses blocked due to safety filters. */
    blockedBySafety: number;
    /** Number of times the system had to wait due to rate limits (internal or SDK). */
    rateLimitWaits: number;
    /** Number of intermediate errors that occurred during API calls but were potentially retried. */
    intermediateErrors: number;
    /** A map of error types to their counts, where keys are normalized error strings. */
    errorsByType: { [normalizedErrorKey: string]: number };

    // --- Service & Client Initialization ---
    serviceInitialization: {
        starts: number; // GeminiApiService async init starts
        completes: number; // GeminiApiService async init completes
        failures: number; // GeminiApiService async init failures
        lazyAttempts: number;
        criticallyUninitialized: number;
        clientInitAttempts: number; // For GeminiClientManagerService per key
        clientGenAiSuccesses: number;
        clientCacheManagerSuccesses: number;
        clientInitFailures: number; // Overall failures in GeminiClientManagerService
        noApiKeysConfigured: number;
        noClientsInitializedOverall: number;
    };
    /** Number of failures specifically during API call setup (prepareForApiCall, modelOrchestrator.prepareModel before actual `generateContent`). */
    apiCallSetupFailures: number; // General counter for setup issues not fitting primary/fallback prep failures

    // --- Model Preparation (from GeminiModelOrchestratorService) ---
    modelPreparationStats: {
        attempts: number; // Calls to modelOrchestrator.prepareModel
        successes: number;
        failures: number; // General failures in modelOrchestrator.prepareModel
        criticalFailures: number; // e.g., model_orchestration_critical_failure_final_check
    };

    // --- API Key Management (from GeminiClientManagerService) ---
    apiKeyManagement: {
        unhandledApiTypeSelections: number;
        noKeysAvailableSelections: number;
        indexOutOfBoundsSelections: number;
    };

    // --- Rate Limiter Setup (from GeminiRateLimiterService) ---
    rateLimiterSetup: {
        creationAttempts: number;
        creationSuccesses: number;
        creationFailures: number;
    };

    // --- Few-Shot Preparation ---
    fewShotPreparation: {
        attempts: number;
        successes: number;
        failures: {
            oddPartsCount: number;
            processingError: number;
        };
        warnings: {
            missingInput: number;
            missingOutput: number;
            emptyResult: number;
        };
        configuredButNoData: number;
        disabledByConfig: number;
    };

    // --- Request Payload Logging ---
    requestPayloadLogging: {
        successes: number;
        failures: number;
    };

    // --- Generate Content (model.generateContent() calls) ---
    generateContentInternal: {
        attempts: number;
        successes: number;
        // Failures are typically caught by RetryHandler and logged as intermediate/final errors
    };

    // --- Cache Specifics ---
    cacheDecisionStats: {
        /** Times cache was considered for use (shouldUseCache was true in prepareModel) */
        cacheUsageAttempts: number;
        /** Times cache was explicitly disabled for a call (shouldUseCache was false) */
        cacheExplicitlyDisabled: number;
    };
    cacheContextHits: number; // Actual successful use of a cached model
    cacheContextAttempts: number; // getOrCreateContext calls
    cacheContextCreationSuccess: number; // New cache created via SDK
    cacheContextRetrievalSuccess: number; // Existing cache retrieved via SDK (part of getOrCreateContext)
    /** @deprecated Covered by cacheContextCreationSuccess + cacheContextRetrievalSuccess vs cacheContextAttempts */
    cacheContextMisses: number;
    cacheContextCreationFailed: number; // Failures in getOrCreateContext (SDK or logic)
    cacheContextInvalidations: number;
    cacheContextRetrievalFailures: number; // Failures in getSdkCache
    cacheMapLoadAttempts: number;
    cacheMapLoadFailures: number;
    cacheMapLoadSuccess?: boolean | null;
    cacheMapWriteAttempts: number;
    cacheMapWriteSuccessCount: number;
    cacheMapWriteFailures: number;
    /** @deprecated Covered by serviceInitialization.clientInitFailures or specific cache manager errors */
    cacheManagerCreateFailures: number;


    // --- Response Processing (from GeminiResponseHandlerService & GeminiApiService) ---
    responseProcessingStats: {
        /** Count of successful markdown stripping operations. */
        markdownStripped: number;
        /** Count of successful JSON validations by ResponseHandler.processResponse. */
        jsonValidationsSucceededInternal: number;
        /** Count of JSON validation failures by ResponseHandler.processResponse (these usually throw and lead to retries). */
        jsonValidationFailedInternal: number;
        /** Count of successful final JSON cleaning by GeminiApiService.cleanJsonResponse. */
        jsonCleaningSuccessesPublic: number;
        /** Count of times response text was empty after internal processing (markdown strip, etc.). */
        emptyAfterProcessingInternal: number;
        /** Count of times a public API method (extract, determine, cfp) finished successfully. */
        publicMethodFinishes: number;
        /** Count of trailing comma fixes applied. */
        trailingCommasFixed: number;
        /** Count of responses blocked by safety settings (detected in ResponseHandler). */
        blockedBySafetyInResponseHandler: number;
        /** Count of file writes for responses. */
        responseFileWrites: number;
        /** Count of file write failures for responses. */
        responseFileWriteFailures: number;
    };

    // --- Config Errors ---
    /** @deprecated Covered by serviceInitialization or specific config error counters */
    serviceInitializationFailures: number;
    configErrors: {
        modelListMissing: number; // For a specific API type
        apiTypeConfigMissing: number; // General config for an API type not found
        // Other specific config errors can be added here
    };
}