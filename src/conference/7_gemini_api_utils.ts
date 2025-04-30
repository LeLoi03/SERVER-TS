import {
    GoogleGenerativeAI,
    type CachedContent,
    type GenerativeModel,
    type Content,
    type Part,
    type GenerateContentRequest,
    type GenerateContentResult,
    // HarmCategory, HarmBlockThreshold, // Optionally import safety types if needed
} from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server";

import { promises as fsPromises, existsSync } from 'fs';
import path from 'path';
import {
    RateLimiterRes,
    RateLimiterMemory,
    type IRateLimiterOptions,
} from 'rate-limiter-flexible';
import { logger } from './11_utils';
import {
    apiConfigs, API_TYPE_EXTRACT, API_TYPE_DETERMINE, API_TYPE_CFP,
    GEMINI_API_KEY, apiLimiter,
    MODEL_RATE_LIMIT_POINTS, MODEL_RATE_LIMIT_DURATION, MODEL_RATE_LIMIT_BLOCK_DURATION,
    MAX_RETRIES, INITIAL_DELAY_BETWEEN_RETRIES, MAX_DELAY_BETWEEN_RETRIES,
    type ApiConfig
} from '../config';

import { RetryableFunction, type ApiResponse, type CallGeminiApiParams } from "./types";

export const RESPONSE_OUTPUT_DIR: string = path.join(__dirname, "./data/responses");


// --- Persistent Cache Map Configuration ---
const CACHE_MAP_DIR: string = path.join(__dirname, './data');
const CACHE_MAP_FILENAME: string = 'gemini_cache_map.json';
const CACHE_MAP_FILE_PATH: string = path.join(CACHE_MAP_DIR, CACHE_MAP_FILENAME);

// --- Cache Storage ---
// Keys are composite: `${apiType}-${modelName}`
let persistentCacheNameMap: Map<string, string> = new Map();
// Keys are composite: `${apiType}-${modelName}`
const contextCaches: Map<string, CachedContent | null> = new Map();
// Keys are composite: `${apiType}-${modelName}` - For preventing concurrent creation
let cachePromises: Map<string, Promise<CachedContent | null>> = new Map();


// --- Khởi tạo Google Generative AI ---
let genAI: GoogleGenerativeAI | null = null;
// (Initialization logic remains the same as provided)
logger.info("Initializing GoogleGenerativeAI...");
try {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing.");
    }
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    logger.info("GoogleGenerativeAI initialized successfully.");
} catch (initError: unknown) {
    const errorDetails = initError instanceof Error ? { name: initError.name, message: initError.message, stack: initError.stack } : { details: String(initError) };
    logger.fatal({ err: errorDetails }, "Failed to initialize GoogleGenerativeAI. Gemini API calls will likely fail.");
}


// --- Cache Name Map File I/O Functions ---
const loadCacheNameMap = async (): Promise<void> => {
    const logContext = { filePath: CACHE_MAP_FILE_PATH, function: 'loadCacheNameMap' };
    logger.info(logContext, "Attempting to load cache name map");
    try {
        // (Directory/File existence checks remain the same)
        if (!existsSync(CACHE_MAP_DIR)) {
            logger.warn({ ...logContext, directory: CACHE_MAP_DIR }, "Cache map directory not found, creating");
            await fsPromises.mkdir(CACHE_MAP_DIR, { recursive: true });
            logger.info({ ...logContext, directory: CACHE_MAP_DIR }, "Cache map directory created");
        }
        if (!existsSync(CACHE_MAP_FILE_PATH)) {
            logger.warn(logContext, "Cache map file not found. Starting with an empty map.");
            persistentCacheNameMap = new Map();
            return;
        }
        const fileContent = await fsPromises.readFile(CACHE_MAP_FILE_PATH, 'utf8');
        if (!fileContent.trim()) {
            logger.warn(logContext, "Cache map file is empty. Starting with an empty map.");
            persistentCacheNameMap = new Map();
            return;
        }
        // The file *stores* the composite keys directly
        const data: Record<string, string> = JSON.parse(fileContent);
        persistentCacheNameMap = new Map<string, string>(Object.entries(data));
        logger.info({ ...logContext, loadedCount: persistentCacheNameMap.size }, "Successfully loaded cache name entries from file");
    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        logger.error({ ...logContext, err: errorDetails, event: 'cache_load_failed' }, "Failed to load or parse cache name map. Starting with an empty map.");
        persistentCacheNameMap = new Map(); // Reset on error
    }
};

const saveCacheNameMap = async (parentLogger: typeof logger): Promise<void> => {
    const logContext = { filePath: CACHE_MAP_FILE_PATH, function: 'saveCacheNameMap' };
    if (!genAI) {
        parentLogger.warn(logContext, "Skipping save cache name map: GoogleGenerativeAI not initialized.");
        return;
    }
    parentLogger.debug(logContext, "Attempting to save cache name map");
    try {
        // (Directory creation check remains the same)
        if (!existsSync(CACHE_MAP_DIR)) {
            parentLogger.info({ ...logContext, directory: CACHE_MAP_DIR }, "Creating cache map directory before saving");
            await fsPromises.mkdir(CACHE_MAP_DIR, { recursive: true });
        }
        // The map already contains composite keys, so saving is straightforward
        const dataToSave: Record<string, string> = Object.fromEntries(persistentCacheNameMap);
        const jsonString = JSON.stringify(dataToSave, null, 2);
        await fsPromises.writeFile(CACHE_MAP_FILE_PATH, jsonString, 'utf8');
        parentLogger.info({ ...logContext, savedCount: persistentCacheNameMap.size, event: 'cache_write_success' }, "Successfully saved cache name map to file");
    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...logContext, err: errorDetails, event: 'cache_write_failed' }, "Failed to save cache name map");
    }
};

// --- Updated Function to use Composite Key ---
const removePersistentCacheEntry = async (
    cacheKey: string, // Expect the composite key, e.g., "extract-gemini-pro"
    parentLogger: typeof logger
): Promise<void> => {
    // Log context uses the composite key now for clarity
    const logContext = { cacheKey, function: 'removePersistentCacheEntry' };
    if (persistentCacheNameMap.has(cacheKey)) {
        parentLogger.warn(logContext, "Removing persistent cache entry");
        persistentCacheNameMap.delete(cacheKey); // Use composite key
        await saveCacheNameMap(parentLogger); // Save immediately after removal
    } else {
        parentLogger.debug(logContext, "No persistent cache entry found to remove");
    }
    // Also remove from in-memory cache if present
    if (contextCaches.has(cacheKey)) {
        parentLogger.warn({ ...logContext, source: 'in-memory' }, "Removing in-memory cache entry");
        contextCaches.delete(cacheKey);
    }
};

// --- Load Cache Map on Startup ---
(async () => {
    await loadCacheNameMap();
})();


// --- Cache Manager Initialization ---
let cacheManager: GoogleAICacheManager | null = null;
// (Initialization logic remains the same as provided)
const initializeCacheManager = (): GoogleAICacheManager | null => {
    const logContext = { function: 'initializeCacheManager' };
    if (!genAI) {
        logger.warn(logContext, "GoogleGenerativeAI not initialized, skipping CacheManager initialization.");
        return null;
    }
    if (cacheManager) {
        logger.debug(logContext, "CacheManager already initialized.");
        return cacheManager;
    }
    logger.info(logContext, "Initializing GoogleAICacheManager...");
    try {
        if (!GEMINI_API_KEY) throw new Error("Cannot initialize CacheManager without GEMINI_API_KEY");
        cacheManager = new GoogleAICacheManager(GEMINI_API_KEY);
        logger.info(logContext, "GoogleAICacheManager initialized successfully.");
    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        logger.error({ ...logContext, err: errorDetails, event: 'cache_manager_create_failed' }, "Failed to initialize GoogleAICacheManager");
        cacheManager = null;
    }
    return cacheManager;
};


// --- Per-Model Rate Limiting Setup ---
// Rate limiting is still per *model*, not per cache context, so this doesn't need the composite key
const modelRateLimiters: Map<string, RateLimiterMemory> = new Map();
// (getRateLimiterForModel function remains the same as provided)
function getRateLimiterForModel(modelName: string): RateLimiterMemory {
    const logContext = { modelName, function: 'getRateLimiterForModel' };
    if (!modelRateLimiters.has(modelName)) {
        logger.info(logContext, "Creating new rate limiter");
        const limiterOptions: IRateLimiterOptions = {
            points: MODEL_RATE_LIMIT_POINTS,
            duration: MODEL_RATE_LIMIT_DURATION,
            blockDuration: MODEL_RATE_LIMIT_BLOCK_DURATION,
            keyPrefix: `model_${modelName}`, // Prefix based on model name is correct
        };
        try {
            const newLimiter = new RateLimiterMemory(limiterOptions);
            if (!newLimiter || typeof newLimiter.consume !== 'function') {
                logger.error({ ...logContext, options: limiterOptions }, "Failed to create a valid rate limiter object");
                throw new Error(`Failed to create valid rate limiter for ${modelName}`);
            }
            logger.debug({ ...logContext, options: limiterOptions }, "Rate limiter created successfully");
            modelRateLimiters.set(modelName, newLimiter);
        } catch (creationError: unknown) {
            const errorDetails = creationError instanceof Error ? { name: creationError.name, message: creationError.message } : { details: String(creationError) };
            logger.error({ ...logContext, err: errorDetails, options: limiterOptions }, "Exception during RateLimiterMemory creation");
            throw creationError;
        }
    }
    const limiterInstance = modelRateLimiters.get(modelName);
    if (!limiterInstance || typeof limiterInstance.consume !== 'function') {
        logger.error(logContext, "Invalid limiter found in map or failed creation");
        throw new Error(`Retrieved invalid rate limiter from map for ${modelName}`);
    }
    logger.debug(logContext, "Retrieved existing rate limiter");
    return limiterInstance;
}

// --- Refactored Get Or Create Context Cache (Using Composite Key) ---
const getOrCreateContextCache = async (
    apiType: string, // Used to build the composite key
    modelName: string, // Still needed for API calls, rate limiting, etc.
    systemInstructionText: string,
    fewShotParts: Part[],
    parentLogger: typeof logger
): Promise<CachedContent | null> => {
    // *** Use composite key for cache management ***
    const cacheKey = `${apiType}-${modelName}`;
    const baseLogContext = { cacheKey, apiType, modelName, function: 'getOrCreateContextCache' };
    parentLogger.debug({ ...baseLogContext, event: 'cache_get_or_create_start' }, "Getting or creating context cache");

    // 1. Check in-memory cache using composite key
    const cachedInMemory = contextCaches.get(cacheKey);
    if (cachedInMemory?.name) {
        parentLogger.info({ ...baseLogContext, cacheName: cachedInMemory.name, event: 'cache_reuse_in_memory' }, "Reusing existing context cache object from in-memory map");
        return cachedInMemory;
    }

    // 2. Check if a creation promise exists using composite key
    let cachePromise = cachePromises.get(cacheKey);
    if (cachePromise) {
        parentLogger.debug({ ...baseLogContext, event: 'cache_creation_in_progress' }, "Cache creation already in progress, awaiting...");
        return await cachePromise; // Wait for the promise to resolve
    }

    // 3. Create a new promise associated with the composite key
    cachePromise = (async (): Promise<CachedContent | null> => {
        const manager = initializeCacheManager(); // Attempt to get manager early
        if (!manager) {
            parentLogger.warn({ ...baseLogContext, event: 'cache_manager_unavailable_early' }, "CacheManager not available. Cannot create or retrieve cache.");
            // No need to delete promise here as it was never added to the map yet
            return null;
        }

        try {
            // 4. Check persistent storage using composite key before locking
            const knownCacheName = persistentCacheNameMap.get(cacheKey);
            if (knownCacheName) {
                const retrievalContext = { ...baseLogContext, cacheName: knownCacheName, event_group: "persistent_retrieval" };
                parentLogger.debug({ ...retrievalContext, event: 'cache_retrieval_start' }, "Found cache name in persistent map, attempting retrieval");
                try {
                    const retrievedCache = await manager.get(knownCacheName);
                    if (retrievedCache?.name) { // Check if retrieval was successful
                        parentLogger.info({ ...retrievalContext, event: 'cache_retrieval_success', retrievedModel: retrievedCache.model }, "Successfully retrieved cache from manager");
                        contextCaches.set(cacheKey, retrievedCache); // Store in memory
                        // No need to delete promise here as we return early
                        return retrievedCache;
                    } else {
                        // Cache name was known, but retrieval failed (e.g., deleted on server)
                        parentLogger.warn({ ...retrievalContext, event: 'cache_retrieval_failed_not_found' }, "Cache name found in map, but retrieval from manager failed (likely deleted/expired). Removing local entry.");
                        await removePersistentCacheEntry(cacheKey, parentLogger); // Clean up stale entry
                        // Fall through to creation logic
                    }
                } catch (retrievalError: unknown) {
                    const errorDetails = retrievalError instanceof Error ? { name: retrievalError.name, message: retrievalError.message } : { details: String(retrievalError) };
                    parentLogger.error({ ...retrievalContext, err: errorDetails, event: 'cache_retrieval_failed_exception' }, "Error retrieving cache from manager. Proceeding to create new cache.");
                    await removePersistentCacheEntry(cacheKey, parentLogger); // Clean up potentially problematic entry
                    // Fall through to creation logic
                }
            } else {
                parentLogger.debug({ ...baseLogContext, event: 'cache_persistent_miss' }, "Cache name not found in persistent map.");
            }

            // --- Lock acquired implicitly by being inside this async IIFE managed by cachePromises ---

            // 5. Double-check in-memory cache in case another request completed while awaiting lock/persistent check
            const doubleCheckCachedInMemory = contextCaches.get(cacheKey);
            if (doubleCheckCachedInMemory?.name) {
                parentLogger.info({ ...baseLogContext, cacheName: doubleCheckCachedInMemory.name, event: 'cache_reuse_in_memory_double_check' }, "Reusing in-memory cache found after lock acquisition");
                return doubleCheckCachedInMemory;
            }

            // --- Create New Cache ---
            const createContext = { ...baseLogContext, event_group: "cache_creation" };
            parentLogger.info({ ...createContext, event: 'cache_create_start' }, "Attempting to create NEW context cache");

            // Use the base model name for the API, potentially prefixed
            // Check SDK docs if 'models/' prefix is required for caching API
            const modelForCacheApi = `models/${modelName}`;

            try {
                const systemInstructionContent: Part[] = systemInstructionText ? [{ text: systemInstructionText }] : [];
                const contentToCache: Content[] = [];
                // Ensure fewShotParts are only added if they exist
                if (fewShotParts && fewShotParts.length > 0) {
                    for (let i = 0; i < fewShotParts.length; i += 2) {
                        if (fewShotParts[i]) contentToCache.push({ role: 'user', parts: [fewShotParts[i]] });
                        if (fewShotParts[i + 1]) contentToCache.push({ role: 'model', parts: [fewShotParts[i + 1]] });
                    }
                }


                // Make displayName more descriptive
                const displayName = `cache-${apiType}-${modelName}-${Date.now()}`;

                parentLogger.debug({
                    ...createContext,
                    modelForCache: modelForCacheApi,
                    displayName,
                    hasSystemInstruction: !!systemInstructionText,
                    contentToCacheCount: contentToCache.length,
                    event: 'cache_create_details'
                }, "Cache creation details");

                // Ensure systemInstruction is only included if text exists
                const cacheCreateParams: any = { // Use 'any' or a more specific type from the SDK if available
                    model: modelForCacheApi,
                    contents: contentToCache,
                    displayName: displayName,
                };
                if (systemInstructionContent.length > 0) {
                    cacheCreateParams.systemInstruction = { role: "system", parts: systemInstructionContent };
                }

                const createdCache = await manager.create(cacheCreateParams);

                if (!createdCache?.name) {
                    parentLogger.error({ ...createContext, modelForCache: modelForCacheApi, createdCacheObject: createdCache, event: 'cache_create_failed_invalid_object' }, "Failed to create context cache: Invalid cache object returned by manager.create");
                    return null; // Return null on creation failure
                }

                parentLogger.info({ ...createContext, cacheName: createdCache.name, model: createdCache.model, event: 'cache_create_success' }, "Context cache created successfully");

                // Store using the composite key
                contextCaches.set(cacheKey, createdCache);
                persistentCacheNameMap.set(cacheKey, createdCache.name);
                await saveCacheNameMap(parentLogger); // Persist the new mapping

                return createdCache;

            } catch (cacheError: unknown) {
                const errorDetails = cacheError instanceof Error ? { name: cacheError.name, message: cacheError.message } : { details: String(cacheError) };
                parentLogger.error({ ...createContext, err: errorDetails, event: 'cache_create_failed' }, "Failed to create NEW context cache");
                if (errorDetails.message?.includes("invalid model") || errorDetails.message?.includes("model not found")) {
                    parentLogger.error({ ...createContext, modelForCache: modelForCacheApi, event: 'cache_create_invalid_model_error' }, "Ensure model name is correct for caching API (might require 'models/' prefix or specific version).");
                } else if (errorDetails.message?.includes("permission denied")) {
                    parentLogger.error({ ...createContext, event: 'cache_create_permission_error' }, "Permission denied during cache creation. Check API key permissions for caching.");
                }
                // Don't automatically remove persistent entry here, as creation failed before association
                return null; // Return null on creation error
            }
        } catch (outerError: unknown) {
            // Catch errors from early manager init or persistent retrieval blocks
            const errorDetails = outerError instanceof Error ? { name: outerError.name, message: outerError.message } : { details: String(outerError) };
            parentLogger.error({ ...baseLogContext, err: errorDetails, event: 'cache_logic_outer_exception' }, "Unhandled exception during cache get/create logic");
            return null;
        } finally {
            // 6. Always remove the promise using composite key once resolved/rejected
            cachePromises.delete(cacheKey);
            parentLogger.debug({ ...baseLogContext, event: 'cache_promise_deleted' }, "Removed cache creation promise.");
        }
    })(); // End of async IIFE

    // Store the promise BEFORE awaiting it, using the composite key
    cachePromises.set(cacheKey, cachePromise);
    parentLogger.debug({ ...baseLogContext, event: 'cache_promise_set' }, "Cache creation promise stored.");

    // Await and return the result of the promise
    return await cachePromise;
};

// --- Execute with Retry Logic (Refactored for Composite Cache Key) ---
const executeWithRetry = async (
    fn: RetryableFunction,
    apiType: string,         // Passed in, crucial for the composite key
    batchIndex: number,
    modelName: string,       // Passed in, crucial for the composite key
    modelRateLimiter: RateLimiterMemory,
    parentLogger: typeof logger
): Promise<ApiResponse> => {
    // Calculate the composite cache key upfront for potential use in error handling
    const cacheKey = `${apiType}-${modelName}`;
    const baseLogContext = { apiType, batchIndex, modelName, cacheKey, function: 'executeWithRetry' }; // Include cacheKey in base context

    parentLogger.debug({ ...baseLogContext, event: 'retry_loop_start' }, "Executing with retry");
    let retryCount = 0;
    let currentDelay = INITIAL_DELAY_BETWEEN_RETRIES;
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    while (retryCount < MAX_RETRIES) {
        const attempt = retryCount + 1;
        // Include cacheKey in attempt context as well
        const attemptLogContext = { ...baseLogContext, attempt, maxAttempts: MAX_RETRIES };
        parentLogger.info({ ...attemptLogContext, event: 'retry_attempt_start' }, "Executing function attempt");

        try {
            if (!genAI) {
                parentLogger.error({ ...attemptLogContext, event: 'retry_genai_not_init' }, "Cannot execute function: GoogleGenerativeAI is not initialized.");
                return defaultResponse; // Critical setup error, don't retry loop
            }
            // Execute the core function passed in (e.g., the API call logic)
            return await fn(modelRateLimiter);

        } catch (error: unknown) {
            let shouldRetry = true;
            let invalidateCache = false; // Flag to indicate if cache invalidation is needed
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
            let errorEvent = 'retry_attempt_error_unknown'; // Default error event type for logging

            // Check internal rate limiter error first (not a Gemini error)
            if (error instanceof RateLimiterRes) {
                const waitTimeMs = error.msBeforeNext;
                parentLogger.warn({ ...attemptLogContext, waitTimeMs, event: 'retry_internal_rate_limit_wait' }, `Internal rate limit exceeded. Waiting...`);
                await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                // Important: 'continue' skips retryCount increment and delay logic, goes to next loop iteration
                continue;
            }

            // Handle specific Gemini/other errors
            // Use cacheKey in log context for cache errors
            if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                errorEvent = 'retry_attempt_error_cache';
                parentLogger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Cache related error detected. Invalidating cache reference and retrying.");
                invalidateCache = true; // Mark for invalidation below
            } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted') || errorMessageLower.includes('rate limit')) {
                errorEvent = 'retry_attempt_error_429';
                parentLogger.warn({ ...attemptLogContext, status: 429, err: errorDetails, event: errorEvent }, "429/Resource Exhausted/Rate Limit Error from API. Retrying after delay...");
                // Keep shouldRetry = true
            } else if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                errorEvent = 'retry_attempt_error_5xx';
                parentLogger.warn({ ...attemptLogContext, status: 500, err: errorDetails, event: errorEvent }, "5xx/Server Error from API. Retrying after delay...");
                // Keep shouldRetry = true
            } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                errorEvent = 'retry_attempt_error_safety_blocked';
                parentLogger.error({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Request blocked by safety settings. No further retries.");
                shouldRetry = false; // Do not retry safety blocks
            } else {
                // Keep default errorEvent = 'retry_attempt_error_unknown'
                parentLogger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Unhandled/other error during execution attempt. Retrying...");
                // Keep shouldRetry = true (default assumption for unknown errors)
            }

            // --- Cache Invalidation Logic ---
            // If a cache error was detected, invalidate the cache entry using the composite key.
            // No need to check apiType specifically; if invalidateCache is true, it means
            // a cache error occurred for the current apiType, which must be using caching.
            if (invalidateCache) {
                parentLogger.info({ ...attemptLogContext, event: 'retry_cache_invalidate' }, "Removing cache entry due to error.");
                // Use the composite cacheKey for deletion
                contextCaches.delete(cacheKey); // Remove from in-memory map
                await removePersistentCacheEntry(cacheKey, parentLogger); // Remove from persistent map (logs internally)
                // Note: The actual `currentCache` variable inside callGeminiAPI's scope
                // also needs to be nullified if this happens, which should occur naturally
                // on the *next* attempt when getOrCreateContextCache is called again.
            }
            // --- End Cache Invalidation Logic ---


            // Increment retry count *after* handling the error type and potential invalidation
            retryCount++;
            const isLastAttempt = retryCount >= MAX_RETRIES;

            // Check if we should stop retrying (non-retryable error or max retries reached)
            if (!shouldRetry) {
                parentLogger.error({ ...attemptLogContext, finalError: errorDetails, event: 'retry_abort_non_retryable' }, "Non-retryable error encountered. Aborting retries.");
                return defaultResponse; // Return default on non-retryable error
            }

            if (isLastAttempt) {
                parentLogger.error({ ...attemptLogContext, maxRetries: MAX_RETRIES, finalError: errorDetails, event: 'retry_failed_max_retries' }, `Failed to process after maximum retries.`);
                return defaultResponse; // Return default after max retries
            }

            // Calculate delay with exponential backoff and jitter
            const jitter = Math.random() * 500; // Adds 0-500ms jitter
            const delayWithJitter = Math.max(0, currentDelay + jitter); // Ensure delay isn't negative
            parentLogger.info({ ...attemptLogContext, nextAttempt: retryCount + 1, delaySeconds: (delayWithJitter / 1000).toFixed(2), event: 'retry_wait_before_next' }, `Waiting before next retry...`);

            await new Promise(resolve => setTimeout(resolve, delayWithJitter));

            // Increase delay for next potential retry (exponential backoff)
            currentDelay = Math.min(currentDelay * 2, MAX_DELAY_BETWEEN_RETRIES); // Double delay, cap at max

        } // End catch block
    } // End while loop

    // Fallback return: Should ideally not be reached if MAX_RETRIES > 0
    parentLogger.error({ ...baseLogContext, event: 'retry_loop_exit_unexpected' }, "Exited retry loop unexpectedly (MAX_RETRIES might be 0 or loop logic error).");
    return defaultResponse;
};

// --- Core Gemini API Call Function ---
const callGeminiAPI = async ({
    batch, batchIndex, title, acronym, apiType, systemInstruction, modelName, generationConfig, parentLogger
}: CallGeminiApiParams): Promise<ApiResponse> => {
    const baseLogContext = { apiType, batchIndex, modelName, title: title || 'N/A', acronym: acronym || 'N/A', function: 'callGeminiAPI' };
    parentLogger.info({ ...baseLogContext, event: 'gemini_call_start' }, "Preparing Gemini API call");
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    let modelRateLimiter: RateLimiterMemory;
    try {
        modelRateLimiter = getRateLimiterForModel(modelName);
    } catch (limiterError: unknown) {
        const errorDetails = limiterError instanceof Error ? { name: limiterError.name, message: limiterError.message } : { details: String(limiterError) };
        parentLogger.error({ ...baseLogContext, err: errorDetails, event: 'gemini_call_limiter_init_failed' }, "Failed to get or create rate limiter. Aborting API call.");
        return defaultResponse;
    }

    const apiConfig: ApiConfig | undefined = apiConfigs[apiType];
    if (!apiConfig) {
        parentLogger.error({ ...baseLogContext, event: 'gemini_call_invalid_apitype' }, "Invalid apiType provided. Cannot find configuration.");
        return defaultResponse;
    }

    // --- Conditional Setup Based on apiType ---
    let useSystemInstruction = false;
    let useFewShotExamples = false;
    let useCache = false;

    // Define which API types use which features
    // Group similar types together
    if (apiType === API_TYPE_CFP) { // Added API_TYPE_CFP here
        useSystemInstruction = true;
        useFewShotExamples = true;
    }
    // Add more 'else if' blocks here for other API types

    parentLogger.info({
        ...baseLogContext,
        useSystemInstruction,
        useFewShotExamples,
        useCache,
        event: 'gemini_call_feature_config'
    }, "Determined feature usage for API type");

    // Prepare Few-Shot Parts (Conditionally)
    const fewShotContext = { ...baseLogContext, event_group: 'few_shot_prep' };
    const fewShotParts: Part[] = [];
    if (useFewShotExamples) {
        parentLogger.debug({ ...fewShotContext, event: 'few_shot_prep_start' }, "Preparing few-shot parts");
        try {
            const inputs = apiConfig.inputs || {};
            const outputs = apiConfig.outputs || {};
            Object.entries(inputs).forEach(([inputKey, inputValue]) => {
                const outputKey = inputKey.replace('input', 'output');
                const outputValue = outputs[outputKey] || '';
                if (inputValue) fewShotParts.push({ text: inputValue });
                if (outputValue) fewShotParts.push({ text: outputValue });
            });
            if (fewShotParts.length === 0) {
                parentLogger.warn({ ...fewShotContext, event: 'few_shot_prep_empty' }, "Few-shot inputs/outputs defined in config, but resulted in empty parts array.");
            }
            parentLogger.debug({ ...fewShotContext, fewShotCount: fewShotParts.length / 2, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
        } catch (fewShotError: unknown) {
            const errorDetails = fewShotError instanceof Error ? { name: fewShotError.name, message: fewShotError.message } : { details: String(fewShotError) };
            parentLogger.error({ ...fewShotContext, err: errorDetails, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Continuing without them.");
            fewShotParts.length = 0;
        }
    } else {
        parentLogger.debug({ ...fewShotContext, event: 'few_shot_prep_skipped' }, "Skipping few-shot parts preparation as not required for this apiType.");
    }

    // Setup Model (Cached or Non-Cached)
    let model: GenerativeModel | undefined;
    let contentRequest: GenerateContentRequest | string;
    let usingCache = false;
    let currentCache: CachedContent | null = null;
    const generationModelName = modelName;
    // Potential cache identifier combining type and model if needed for segregation
    const cacheIdentifier = `${apiType}-${modelName}`;

    // --- Cache Logic (Only if useCache is enabled) ---
    if (useCache) {
        const cacheSetupContext = { ...baseLogContext, cacheIdentifier, event_group: 'cache_setup' };
        parentLogger.debug({ ...cacheSetupContext, event: 'cache_setup_get_or_create' }, "Attempting to get or create cache");
        try {
            const effectiveSystemInstruction = useSystemInstruction ? systemInstruction : "";
            // Pass apiType to cache function if it needs to differentiate cache instances
            currentCache = await getOrCreateContextCache(apiType, modelName, effectiveSystemInstruction, fewShotParts, parentLogger);
        } catch (cacheSetupError: unknown) {
            const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
            parentLogger.error({ ...cacheSetupContext, err: errorDetails, event: 'cache_setup_get_or_create_failed' }, "Critical error during cache setup, proceeding without cache");
            currentCache = null;
        }

        if (currentCache?.name) {
            parentLogger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_attempt_use' }, "Attempting to use cached context object");
            try {
                if (!genAI) throw new Error("genAI not initialized");
                model = genAI.getGenerativeModelFromCachedContent(currentCache);
                contentRequest = batch;
                usingCache = true;
                parentLogger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_use_success' }, "Using cached context model");
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                parentLogger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'cache_setup_getmodel_failed' }, "Error getting model from cached content, falling back to non-cached");
                contextCaches.delete(cacheIdentifier); // Use consistent identifier for deletion
                await removePersistentCacheEntry(cacheIdentifier, parentLogger); // Use consistent identifier
                currentCache = null;
                usingCache = false;
            }
        } else {
            parentLogger.info({ ...cacheSetupContext, event: 'cache_setup_no_cache_found' }, "No valid cache object found or created, proceeding without cache.");
        }
    } // End of Cache Logic block

    // --- Non-Cached Model Setup (If not using cache or cache failed) ---
    if (!usingCache) {
        // ... (Non-cached setup logic remains exactly the same as before) ...
        const nonCachedSetupContext = { ...baseLogContext, event_group: 'non_cached_setup' };
        if (useCache) {
            parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_fallback' }, "Proceeding without cache (setup failed, error, or no cache found).");
        } else {
            parentLogger.debug({ ...nonCachedSetupContext, event: 'non_cached_setup_normal' }, "Setting up non-cached model (cache not enabled for this apiType).");
        }
        try {
            if (!genAI) throw new Error("genAI not initialized");
            const modelConfig: { model: string, systemInstruction?: Content } = {
                model: generationModelName,
            };
            if (useSystemInstruction && systemInstruction) {
                modelConfig.systemInstruction = { role: "system", parts: [{ text: systemInstruction }] };
                parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_using_system_instruction' }, "Model configured WITH system instruction.");
            } else {
                parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_skipping_system_instruction' }, "Model configured WITHOUT system instruction.");
            }
            model = genAI.getGenerativeModel(modelConfig);

            if (useFewShotExamples && fewShotParts.length > 0) {
                const history: Content[] = [];
                for (let i = 0; i < fewShotParts.length; i += 2) {
                    if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                    if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
                }
                history.push({ role: "user", parts: [{ text: batch }] });
                contentRequest = {
                    contents: history,
                    generationConfig: generationConfig,
                };
                parentLogger.info({ ...nonCachedSetupContext, historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Using non-cached model setup with history (few-shots + user input)");
            } else {
                contentRequest = batch;
                parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_request_simple' }, "Using simple non-cached model setup (user input only)");
            }
        } catch (getModelError: unknown) {
            const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
            parentLogger.error({ ...nonCachedSetupContext, generationModelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
            return defaultResponse;
        }
    } // End of Non-Cached Setup block

    // --- Call API with Retry Logic ---
    return executeWithRetry(async (limiter): Promise<ApiResponse> => {
        // ... (Retry logic, rate limiting, API call, response processing, and file writing remain exactly the same) ...
        const callAttemptContext = { ...baseLogContext, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A', event_group: 'gemini_api_attempt' };
        if (!model) {
            parentLogger.error({ ...callAttemptContext, event: 'gemini_api_model_undefined' }, "Model object is undefined before calling generateContent.");
            throw new Error("Model is not initialized");
        }
        return await apiLimiter(async () => {
            const rateLimitKey = `${apiType}_${batchIndex}_${modelName}`;
            parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points`);
            try {
                await limiter.consume(rateLimitKey, 1);
                parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed. Sending request...`);
            } catch (limiterError: unknown) {
                parentLogger.warn({ ...callAttemptContext, event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed.`);
                throw limiterError;
            }
            let result: GenerateContentResult;
            try {
                parentLogger.info({ ...callAttemptContext, requestType: typeof contentRequest, event: 'gemini_api_generate_start' }, "Calling model.generateContent");
                result = await model.generateContent(contentRequest);
                parentLogger.info({ ...callAttemptContext, event: 'gemini_api_generate_success' }, "model.generateContent successful");
            } catch (generateContentError: unknown) {
                const errorDetails = generateContentError instanceof Error ? { name: generateContentError.name, message: generateContentError.message } : { details: String(generateContentError) };
                parentLogger.error({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_generate_failed' }, "Error during model.generateContent");
                if (usingCache && (errorDetails.message?.toLowerCase().includes("cachedcontent not found") || errorDetails.message?.toLowerCase().includes("permission denied"))) {
                    parentLogger.warn({ ...callAttemptContext, event: 'gemini_api_generate_invalidate_cache' }, "Invalidating cache due to generateContent error.");
                    // Invalidation logic might need adjustment based on how cacheIdentifier is used
                }
                throw generateContentError;
            }
            const response = result?.response;
            const feedback = response?.promptFeedback;
            if (!response) {
                parentLogger.warn({ ...callAttemptContext, feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing response object.");
                if (feedback?.blockReason) {
                    parentLogger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings");
                    throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
                }
                throw new Error("Empty or invalid response object from Gemini API.");
            }
            if (feedback?.blockReason) {
                parentLogger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings (found in feedback)");
                throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
            }
            let responseText = "";
            try {
                responseText = response.text();
                parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_success' }, "Extracted text using response.text()");
            } catch (textError: unknown) {
                const errorDetails = textError instanceof Error ? { name: textError.name, message: textError.message } : { details: String(textError) };
                parentLogger.warn({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_text_extract_failed' }, "Response.text() accessor failed, trying fallback.");
                responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (!responseText) {
                    parentLogger.warn({ ...callAttemptContext, responseStructure: response, event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback.");
                } else {
                    parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_fallback_success' }, "Extracted text using fallback");
                }
            }
            const metaData = response.usageMetadata ?? null;
            const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
            const responseOutputPath = path.join(RESPONSE_OUTPUT_DIR, `result_${apiType}_${safeAcronym}_${batchIndex}.txt`);
            const fileLogContext = { ...callAttemptContext, filePath: responseOutputPath, event_group: 'response_file_write' };
            (async () => {
                try {
                    if (!existsSync(RESPONSE_OUTPUT_DIR)) {
                        await fsPromises.mkdir(RESPONSE_OUTPUT_DIR, { recursive: true });
                        parentLogger.info({ directory: RESPONSE_OUTPUT_DIR, event: 'response_dir_created' }, "Created response output directory");
                    }
                    parentLogger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Writing response to file");
                    await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8");
                    parentLogger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file");
                } catch (fileWriteError: unknown) {
                    const errorDetails = fileWriteError instanceof Error ? { name: fileWriteError.name, message: fileWriteError.message } : { details: String(fileWriteError) };
                    parentLogger.error({ ...fileLogContext, err: errorDetails, event: 'response_file_write_failed' }, "Error writing response to file");
                }
            })();
            parentLogger.info({ ...callAttemptContext, responseLength: responseText.length, hasMetaData: !!metaData, tokens: metaData?.totalTokenCount, event: 'gemini_api_attempt_success' }, "Gemini API request processed successfully for this attempt.");
            return { responseText, metaData };
        }); // End apiLimiter wrapper
    }, apiType, batchIndex, modelName, modelRateLimiter, parentLogger); // End executeWithRetry call
};

// --- Exported API Functions ---


let extractModelIndex: number = 0;

export const extract_information_api = async (
    batch: string,
    batchIndex: number,
    title: string,
    acronym: string | undefined,
    parentLogger: typeof logger
): Promise<ApiResponse> => {
    // return { responseText: "", metaData: null };
    const apiType = API_TYPE_EXTRACT;
    const config: ApiConfig | undefined = apiConfigs[apiType];
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };
    const baseLogContext = { apiType, batchIndex, title: title || 'N/A', acronym: acronym || 'N/A', function: 'extract_information_api' };

    if (!config) {
        parentLogger.error(baseLogContext, "Configuration not found.");
        return defaultResponse;
    }
    const modelNames = config.modelNames;
    if (!modelNames || modelNames.length === 0) {
        parentLogger.error(baseLogContext, "No model names configured.");
        return defaultResponse;
    }

    const selectedModelName = modelNames[extractModelIndex];
    const nextIndex = (extractModelIndex + 1) % modelNames.length;
    parentLogger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating API call (round-robin)");
    extractModelIndex = nextIndex; // Update index *after* logging

    try {
        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, title, acronym, apiType,
            systemInstruction: config.systemInstruction || "",
            modelName: selectedModelName,
            generationConfig: config.generationConfig,
            parentLogger: parentLogger
        });

        // JSON Cleaning Logic
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";
        const cleaningLogContext = { ...baseLogContext, modelUsed: selectedModelName };

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson); // Validate
                cleanedResponseText = potentialJson.trim();
                parentLogger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
            } catch (parseError: unknown) {
                const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                cleanedResponseText = ""; // Ensure empty on error
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
            cleanedResponseText = ""; // Ensure empty
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails }, "Unhandled error in main function");
        return defaultResponse;
    }
};

// --- Add New Exported Function for CFP ---
let cfpModelIndex: number = 0; // Separate index for CFP round-robin

export const cfp_extraction_api = async (
    batch: string,
    batchIndex: number,
    title: string, // Assuming CFP also uses title/acronym context
    acronym: string | undefined,
    parentLogger: typeof logger // Use the actual Logger type
): Promise<ApiResponse> => {
    const apiType = API_TYPE_CFP; // Use the new type
    const config: ApiConfig | undefined = apiConfigs[apiType]; // Get CFP config
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };
    // Use a distinct function name in logs
    const baseLogContext = { apiType, batchIndex, title: title || 'N/A', acronym: acronym || 'N/A', function: 'cfp_extraction_api' };

    if (!config) {
        parentLogger.error(baseLogContext, "Configuration not found for CFP.");
        return defaultResponse;
    }
    // Assuming CFP uses multiple models like EXTRACT
    const modelNames = config.modelNames;
    if (!modelNames || modelNames.length === 0) {
        parentLogger.error(baseLogContext, "No model names configured for CFP.");
        return defaultResponse;
    }

    // Use the separate cfpModelIndex for round-robin
    const selectedModelName = modelNames[cfpModelIndex];
    const nextIndex = (cfpModelIndex + 1) % modelNames.length;
    parentLogger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating CFP API call (round-robin)");
    cfpModelIndex = nextIndex; // Update CFP index

    try {
        // Call the central API function. It will correctly handle CFP based on apiType.
        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, title, acronym, apiType,
            systemInstruction: config.systemInstruction || "", // Pass instruction
            modelName: selectedModelName,
            generationConfig: config.generationConfig,
            parentLogger: parentLogger
        });

        // Use the same JSON Cleaning Logic as extract_information_api
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";
        const cleaningLogContext = { ...baseLogContext, modelUsed: selectedModelName };

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson); // Validate
                cleanedResponseText = potentialJson.trim();
                parentLogger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response for CFP.");
            } catch (parseError: unknown) {
                const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse CFP extracted text as JSON after cleaning, returning empty string.");
                cleanedResponseText = ""; // Ensure empty on error
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in CFP response, returning empty string.");
            cleanedResponseText = ""; // Ensure empty
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "CFP API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails }, "Unhandled error in CFP main function");
        return defaultResponse;
    }
};


export const determine_links_api = async (
    batch: string,
    batchIndex: number,
    title: string | undefined,
    acronym: string | undefined,
    parentLogger: typeof logger
): Promise<ApiResponse> => {

    const apiType = API_TYPE_DETERMINE;
    const config: ApiConfig | undefined = apiConfigs[apiType];
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };
    const baseLogContext = { apiType, batchIndex, title: title || 'N/A', acronym: acronym || 'N/A', function: 'determine_links_api' };

    if (!config) {
        parentLogger.error(baseLogContext, "Configuration not found.");
        return defaultResponse;
    }
    const modelName = config.modelName;
    if (!modelName) {
        parentLogger.error(baseLogContext, "No model name configured.");
        return defaultResponse;
    }
    const logContextWithModel = { ...baseLogContext, modelName };
    parentLogger.debug(logContextWithModel, "Initiating API call");

    try {
        // *** No longer prepare or use systemInstruction here ***
        // const systemInstruction = (config.systemInstruction || "")
        //     .replace(/\${Title}/g, title || 'N/A')
        //     .replace(/\${Acronym}/g, acronym || 'N/A');

        // Call the central API function. Pass an empty string for systemInstruction.
        // callGeminiAPI will ignore it based on the apiType = API_TYPE_DETERMINE.
        // It will also skip few-shot examples based on the apiType.
        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, title, acronym, apiType,
            systemInstruction: "", // Pass empty - it will be ignored internally
            modelName: modelName,
            generationConfig: config.generationConfig,
            parentLogger: parentLogger
        });

        // JSON Cleaning Logic
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";
        const cleaningLogContext = { ...logContextWithModel }; // Use context with model

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson); // Validate
                cleanedResponseText = potentialJson.trim();
                parentLogger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
            } catch (parseError: unknown) {
                const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                cleanedResponseText = ""; // Ensure empty on error
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
            cleanedResponseText = ""; // Ensure empty
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...logContextWithModel, err: errorDetails }, "Unhandled error in main function");
        return defaultResponse;
    }
};