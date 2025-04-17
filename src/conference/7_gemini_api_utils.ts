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
    apiConfigs, API_TYPE_EXTRACT, API_TYPE_DETERMINE,
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
let persistentCacheNameMap: Map<string, string> = new Map();
const extractApiCaches: Map<string, CachedContent> = new Map();

// --- Khởi tạo Google Generative AI ---
let genAI: GoogleGenerativeAI | null = null;
logger.info("Initializing GoogleGenerativeAI..."); // Changed from console.log
try {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing.");
    }
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    logger.info("GoogleGenerativeAI initialized successfully."); // Changed from console.log
} catch (initError: unknown) {
    const errorDetails = initError instanceof Error ? { name: initError.name, message: initError.message, stack: initError.stack } : { details: String(initError) };
    logger.fatal({ err: errorDetails }, "Failed to initialize GoogleGenerativeAI. Gemini API calls will likely fail."); // Structured logging
    // genAI remains null
}


// --- Cache Name Map File I/O Functions ---
const loadCacheNameMap = async (): Promise<void> => {
    const logContext = { filePath: CACHE_MAP_FILE_PATH, function: 'loadCacheNameMap' };
    logger.info(logContext, "Attempting to load cache name map");
    try {
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
        if (!existsSync(CACHE_MAP_DIR)) {
            parentLogger.info({ ...logContext, directory: CACHE_MAP_DIR }, "Creating cache map directory before saving");
            await fsPromises.mkdir(CACHE_MAP_DIR, { recursive: true });
        }
        const dataToSave: Record<string, string> = Object.fromEntries(persistentCacheNameMap);
        const jsonString = JSON.stringify(dataToSave, null, 2);
        await fsPromises.writeFile(CACHE_MAP_FILE_PATH, jsonString, 'utf8');
        parentLogger.info({ ...logContext, savedCount: persistentCacheNameMap.size, event: 'cache_write_success' }, "Successfully saved cache name map to file");
    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...logContext, err: errorDetails, event: 'cache_write_failed' }, "Failed to save cache name map");
    }
};

const removePersistentCacheEntry = async (modelName: string, parentLogger: typeof logger): Promise<void> => {
    const logContext = { modelName, function: 'removePersistentCacheEntry' };
    if (persistentCacheNameMap.has(modelName)) {
        parentLogger.warn(logContext, "Removing persistent cache entry");
        persistentCacheNameMap.delete(modelName);
        await saveCacheNameMap(parentLogger); // Save immediately after removal
    } else {
        parentLogger.debug(logContext, "No persistent cache entry found to remove");
    }
};

// --- Load Cache Map on Startup ---
(async () => {
    await loadCacheNameMap();
})();


// --- Cache Manager Initialization ---
let cacheManager: GoogleAICacheManager | null = null;
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
const modelRateLimiters: Map<string, RateLimiterMemory> = new Map();

function getRateLimiterForModel(modelName: string): RateLimiterMemory {
    const logContext = { modelName, function: 'getRateLimiterForModel' };
    if (!modelRateLimiters.has(modelName)) {
        logger.info(logContext, "Creating new rate limiter");
        const limiterOptions: IRateLimiterOptions = {
            points: MODEL_RATE_LIMIT_POINTS,
            duration: MODEL_RATE_LIMIT_DURATION,
            blockDuration: MODEL_RATE_LIMIT_BLOCK_DURATION,
            keyPrefix: `model_${modelName}`,
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


// --- Get Or Create Extract Cache (with Persistent Logic) ---
let cachePromises: Map<string, Promise<CachedContent | null>> = new Map();

const getOrCreateExtractCache = async (
    modelName: string,
    systemInstructionText: string,
    fewShotParts: Part[],
    parentLogger: typeof logger
): Promise<CachedContent | null> => {
    const baseLogContext = { modelName, function: 'getOrCreateExtractCache' };
    parentLogger.debug({ ...baseLogContext, event: 'cache_get_or_create_start' }, "Getting or creating extract cache");

    // 1. Check in-memory cache first (fast path)
    const cachedInMemory = extractApiCaches.get(modelName);
    if (cachedInMemory?.name) {
        parentLogger.info({ ...baseLogContext, cacheName: cachedInMemory.name, event: 'cache_reuse_in_memory' }, "Reusing existing extract API cache object from in-memory map");
        return cachedInMemory;
    }

    // 2. Check if a creation promise exists
    let cachePromise = cachePromises.get(modelName);
    if (cachePromise) {
        parentLogger.debug({ ...baseLogContext, event: 'cache_creation_in_progress' }, "Cache creation already in progress, awaiting...");
        return await cachePromise; // Wait for the promise to resolve
    }

    // Check persistent storage again
    const knownCacheName = persistentCacheNameMap.get(modelName);
    if (knownCacheName) {
        const manager = initializeCacheManager();
        if (!manager) return null;
        try {
            const retrievedCache = await manager.get(knownCacheName);
            if (retrievedCache) {
                extractApiCaches.set(modelName, retrievedCache);
                return retrievedCache;
            }
        } catch (err) {
            console.error("Error retrieving cache before locking", err);
        }
    }

    // 3. Create a promise and store it
    cachePromise = (async (): Promise<CachedContent | null> => {
        try {
            const manager = initializeCacheManager();
            if (!manager) {
                parentLogger.warn({ ...baseLogContext, event: 'cache_manager_unavailable' }, "CacheManager not available. Cannot create or use cache.");
                return null;
            }

            // Double-check in case another request created the cache while we were waiting
            const cachedInMemory = extractApiCaches.get(modelName);
            if (cachedInMemory?.name) {
                parentLogger.debug({ ...baseLogContext, cacheName: cachedInMemory.name, event: 'cache_reuse_in_memory' }, "Reusing existing extract API cache object from in-memory map");
                cachePromises.delete(modelName);  // Clear the promise
                return cachedInMemory;
            }


            // --- Create New Cache ---
            const createContext = { ...baseLogContext };
            parentLogger.info({ ...createContext, event: 'cache_create_start' }, "Attempting to create NEW context cache");
            try {
                const systemInstructionContent: Part[] = [{ text: systemInstructionText }];
                const contentToCache: Content[] = [];
                for (let i = 0; i < fewShotParts.length; i += 2) {
                    if (fewShotParts[i]) contentToCache.push({ role: 'user', parts: [fewShotParts[i]] });
                    if (fewShotParts[i + 1]) contentToCache.push({ role: 'model', parts: [fewShotParts[i + 1]] });
                }

                const modelForCacheApi = `models/${modelName}`;
                const displayName = `cache-${modelName}-${Date.now()}`;
                parentLogger.debug({ ...createContext, modelForCache: modelForCacheApi, displayName, contentCount: contentToCache.length, event: 'cache_create_details' }, "Cache creation details");

                const createdCache = await manager.create({
                    model: modelForCacheApi,
                    systemInstruction: { role: "system", parts: systemInstructionContent },
                    contents: contentToCache,
                    displayName: displayName
                });

                if (!createdCache?.name) {
                    parentLogger.error({ ...createContext, modelForCache: modelForCacheApi, createdCacheObject: createdCache, event: 'cache_create_failed_invalid_object' }, "Failed to create context cache: Invalid cache object returned by manager.create");
                    return null;
                }

                parentLogger.info({ ...createContext, cacheName: createdCache.name, model: createdCache.model, event: 'cache_create_success' }, "Context cache created successfully");

                extractApiCaches.set(modelName, createdCache);
                persistentCacheNameMap.set(modelName, createdCache.name);
                await saveCacheNameMap(parentLogger); // Log inside this function

                return createdCache;

            } catch (cacheError: unknown) {
                const errorDetails = cacheError instanceof Error ? { name: cacheError.name, message: cacheError.message } : { details: String(cacheError) };
                parentLogger.error({ ...createContext, err: errorDetails, event: 'cache_create_failed' }, "Failed to create NEW context cache");
                if (errorDetails.message?.includes("invalid model")) {
                    parentLogger.error({ ...createContext, modelForCache: `models/${modelName}`, event: 'cache_create_invalid_model_error' }, "Ensure model name is correct and potentially prefixed with 'models/' for caching API.");
                }
                return null;
            } finally {
                cachePromises.delete(modelName); // Remove the promise from the map
            }

        } catch (err) {
            cachePromises.delete(modelName); // Ensure promise is removed on error
            console.error("Error creating cache", err);
            return null;  // Or re-throw, depending on desired error handling
        }

    })();

    cachePromises.set(modelName, cachePromise); // Store promise BEFORE awaiting

    return await cachePromise; // Await the promise

};


// --- Execute with Retry Logic ---
const executeWithRetry = async (
    fn: RetryableFunction,
    apiType: string,
    batchIndex: number,
    modelName: string,
    modelRateLimiter: RateLimiterMemory,
    parentLogger: typeof logger
): Promise<ApiResponse> => {
    const baseLogContext = { apiType, batchIndex, modelName, function: 'executeWithRetry' };
    parentLogger.debug({ ...baseLogContext, event: 'retry_loop_start' }, "Executing with retry");
    let retryCount = 0;
    let currentDelay = INITIAL_DELAY_BETWEEN_RETRIES;
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    while (retryCount < MAX_RETRIES) {
        const attempt = retryCount + 1;
        const attemptLogContext = { ...baseLogContext, attempt, maxAttempts: MAX_RETRIES };
        parentLogger.info({ ...attemptLogContext, event: 'retry_attempt_start' }, "Executing function attempt");
        try {
            if (!genAI) {
                // This is a critical setup error, not retryable in the loop
                parentLogger.error({ ...attemptLogContext, event: 'retry_genai_not_init' }, "Cannot execute function: GoogleGenerativeAI is not initialized.");
                return defaultResponse;
            }
            return await fn(modelRateLimiter); // Execute the core function

        } catch (error: unknown) {
            let shouldRetry = true;
            let invalidateCache = false;
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
            let errorEvent = 'retry_attempt_error_unknown'; // Default error event

            // Check internal rate limiter first
            if (error instanceof RateLimiterRes) {
                const waitTimeMs = error.msBeforeNext;
                parentLogger.warn({ ...attemptLogContext, waitTimeMs, event: 'retry_internal_rate_limit_wait' }, `Internal rate limit exceeded. Waiting...`);
                await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                continue; // Loop again without incrementing retryCount
            }

            // Handle specific Gemini/other errors
            if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                errorEvent = 'retry_attempt_error_cache';
                parentLogger.warn({ ...attemptLogContext, err: errorDetails, cacheName: extractApiCaches.get(modelName)?.name, event: errorEvent }, "Cache related error. Invalidating cache reference and retrying.");
                invalidateCache = true; // Mark for invalidation below
            } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted')) {
                errorEvent = 'retry_attempt_error_429';
                parentLogger.warn({ ...attemptLogContext, status: 429, err: errorDetails, event: errorEvent }, "429/Resource Exhausted Error from Gemini API. Retrying after delay...");
            } else if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                errorEvent = 'retry_attempt_error_5xx';
                parentLogger.warn({ ...attemptLogContext, status: 500, err: errorDetails, event: errorEvent }, "5xx/Server Error from Gemini API. Retrying after delay...");
            } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                errorEvent = 'retry_attempt_error_safety_blocked';
                parentLogger.error({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Request blocked by Gemini safety settings. No further retries.");
                shouldRetry = false;
            } else {
                // Keep default errorEvent = 'retry_attempt_error_unknown'
                parentLogger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Unhandled/other error during execution attempt. Retrying...");
            }

            // Invalidate cache if marked (only for extract API)
            if (invalidateCache && apiType === API_TYPE_EXTRACT) {
                parentLogger.info({ ...attemptLogContext, cacheName: extractApiCaches.get(modelName)?.name, event: 'retry_cache_invalidate' }, "Removing cache entry due to error.");
                extractApiCaches.delete(modelName);
                await removePersistentCacheEntry(modelName, parentLogger); // Logs internally
            }

            // Increment retry count *after* handling the error type
            retryCount++;
            const isLastAttempt = retryCount >= MAX_RETRIES;

            if (!shouldRetry) {
                parentLogger.error({ ...attemptLogContext, finalError: errorDetails, event: 'retry_abort_non_retryable' }, "Non-retryable error encountered. Aborting retries.");
                return defaultResponse;
            }

            if (isLastAttempt) {
                parentLogger.error({ ...attemptLogContext, maxRetries: MAX_RETRIES, finalError: errorDetails, event: 'retry_failed_max_retries' }, `Failed to process after maximum retries.`);
                return defaultResponse;
            }

            // Wait before next retry
            const jitter = Math.random() * 500;
            const delayWithJitter = Math.max(0, currentDelay + jitter);
            parentLogger.info({ ...attemptLogContext, nextAttempt: retryCount + 1, delaySeconds: (delayWithJitter / 1000).toFixed(2), event: 'retry_wait_before_next' }, `Waiting before next retry...`);
            await new Promise(resolve => setTimeout(resolve, delayWithJitter));
            currentDelay = Math.min(currentDelay * 2, MAX_DELAY_BETWEEN_RETRIES); // Exponential backoff
        }
    }
    // Fallback return (should only be reached if MAX_RETRIES is 0)
    parentLogger.error({ ...baseLogContext, event: 'retry_loop_exit_unexpected' }, "Exited retry loop unexpectedly (MAX_RETRIES might be 0).");
    return defaultResponse;
};


// --- Core Gemini API Call Function ---
const callGeminiAPI = async ({
    batch, batchIndex, title, acronym, apiType, systemInstruction, modelName, generationConfig, parentLogger
}: CallGeminiApiParams): Promise<ApiResponse> => {
    const baseLogContext = { apiType, batchIndex, modelName, title: title, acronym: acronym || 'N/A', function: 'callGeminiAPI' };
    parentLogger.info({ ...baseLogContext, event: 'gemini_call_start' }, "Preparing Gemini API call");
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    let modelRateLimiter: RateLimiterMemory;
    try {
        modelRateLimiter = getRateLimiterForModel(modelName); // Logs internally
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

    // Prepare Few-Shot Parts
    const fewShotContext = { ...baseLogContext, event_group: 'few_shot_prep' };
    parentLogger.debug({ ...fewShotContext, event: 'few_shot_prep_start' }, "Preparing few-shot parts");
    const fewShotParts: Part[] = [];
    try {
        const inputs = apiConfig.inputs || {};
        const outputs = apiConfig.outputs || {};
        Object.entries(inputs).forEach(([inputKey, inputValue]) => {
            const outputKey = inputKey.replace('input', 'output');
            const outputValue = outputs[outputKey] || '';
            fewShotParts.push({ text: inputValue });
            fewShotParts.push({ text: outputValue });
        });
        parentLogger.debug({ ...fewShotContext, fewShotCount: fewShotParts.length / 2, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
    } catch (fewShotError: unknown) {
        const errorDetails = fewShotError instanceof Error ? { name: fewShotError.name, message: fewShotError.message } : { details: String(fewShotError) };
        parentLogger.error({ ...fewShotContext, err: errorDetails, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Continuing without them.");
        fewShotParts.length = 0; // Clear array on error
    }

    // Setup Model (Cached or Non-Cached)
    let model: GenerativeModel | undefined;
    let contentRequest: GenerateContentRequest | string;
    let usingCache = false;
    let currentCache: CachedContent | null = null;
    const generationModelName = modelName; // Use the passed modelName for generation

    // Cache logic only for Extract API
    if (apiType === API_TYPE_EXTRACT) {
        const cacheSetupContext = { ...baseLogContext, event_group: 'cache_setup' };
        parentLogger.debug({ ...cacheSetupContext, event: 'cache_setup_get_or_create' }, "Attempting to get or create cache");
        try {
            currentCache = await getOrCreateExtractCache(modelName, systemInstruction, fewShotParts, parentLogger); // Logs internally
        } catch (cacheSetupError: unknown) {
            // getOrCreate should handle its internal errors, but catch here just in case
            const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
            parentLogger.error({ ...cacheSetupContext, err: errorDetails, event: 'cache_setup_get_or_create_failed' }, "Critical error during cache setup, proceeding without cache");
            currentCache = null;
        }

        if (currentCache?.name) {
            parentLogger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_attempt_use' }, "Attempting to use cached context object");
            try {
                if (!genAI) throw new Error("genAI not initialized");
                model = genAI.getGenerativeModelFromCachedContent(currentCache);
                contentRequest = batch; // For cached model, request is just the new user content
                usingCache = true;
                parentLogger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_use_success' }, "Using cached context model");
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                parentLogger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'cache_setup_getmodel_failed' }, "Error getting model from cached content, falling back to non-cached");
                extractApiCaches.delete(modelName);
                await removePersistentCacheEntry(modelName, parentLogger); // Logs internally
                currentCache = null;
                usingCache = false;
            }
        }
    }

    // Fallback for Extract or other API types
    if (!usingCache) {
        const nonCachedSetupContext = { ...baseLogContext, event_group: 'non_cached_setup' };
        if (apiType === API_TYPE_EXTRACT) {
            parentLogger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_fallback' }, "Proceeding without cache (setup failed or error).");
        } else {
            parentLogger.debug({ ...nonCachedSetupContext, event: 'non_cached_setup_normal' }, "Setting up non-cached model.");
        }
        try {
            if (!genAI) throw new Error("genAI not initialized");
            model = genAI.getGenerativeModel({
                model: generationModelName, // Use the actual model name for generation
                systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
            });
            // Construct history for non-cached request
            const history: Content[] = [];
            for (let i = 0; i < fewShotParts.length; i += 2) {
                if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
            }
            history.push({ role: "user", parts: [{ text: batch }] }); // Add the current user input
            contentRequest = {
                contents: history,
                generationConfig: generationConfig, // Apply generation config
            };
            parentLogger.info({ ...nonCachedSetupContext, generationModelName, historyLength: history.length, event: 'non_cached_setup_success' }, "Using non-cached model setup");
        } catch (getModelError: unknown) {
            const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
            parentLogger.error({ ...nonCachedSetupContext, generationModelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
            return defaultResponse; // Cannot proceed without a model
        }
    }

    // --- Call API with Retry Logic ---
    return executeWithRetry(async (limiter): Promise<ApiResponse> => {
        // Context for the actual API call attempt within retry loop
        const callAttemptContext = { ...baseLogContext, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A', event_group: 'gemini_api_attempt' };

        if (!model) {
            // This check is crucial within the retry function scope
            parentLogger.error({ ...callAttemptContext, event: 'gemini_api_model_undefined' }, "Model object is undefined before calling generateContent.");
            throw new Error("Model is not initialized"); // Throw to trigger retry logic potentially
        }

        // Apply the global API limiter first
        return await apiLimiter(async () => {
            // Apply the model-specific rate limiter
            const rateLimitKey = `${apiType}_${batchIndex}_${modelName}`; // Use a specific key per call if needed
            parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points`);
            try {
                await limiter.consume(rateLimitKey, 1); // Consume 1 point
                parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed. Sending request...`);
            } catch (limiterError: unknown) {
                // If consume fails, it throws RateLimiterRes - caught by executeWithRetry
                parentLogger.warn({ ...callAttemptContext, event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed.`);
                throw limiterError; // Propagate for executeWithRetry to handle waiting
            }

            // --- Actual API Call ---
            let result: GenerateContentResult;
            try {
                parentLogger.info({ ...callAttemptContext, event: 'gemini_api_generate_start' }, "Calling model.generateContent");
                // *** API Call ***
                result = await model.generateContent(contentRequest);
                // **************
                parentLogger.info({ ...callAttemptContext, event: 'gemini_api_generate_success' }, "model.generateContent successful");
            } catch (generateContentError: unknown) {
                const errorDetails = generateContentError instanceof Error ? { name: generateContentError.name, message: generateContentError.message } : { details: String(generateContentError) };
                parentLogger.error({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_generate_failed' }, "Error during model.generateContent");
                // Check if error is cache-related to potentially invalidate
                if (usingCache && (errorDetails.message?.toLowerCase().includes("cachedcontent not found") || errorDetails.message?.toLowerCase().includes("permission denied"))) {
                    parentLogger.warn({ ...callAttemptContext, event: 'gemini_api_generate_invalidate_cache' }, "Invalidating cache due to generateContent error.");
                    // Marking invalidateCache here won't help as it's inside retry loop,
                    // The error itself being thrown will trigger retry logic which checks cache errors
                }
                throw generateContentError; // Propagate error for retry handling
            }
            // --- End Actual API Call ---


            const response = result?.response;
            const feedback = response?.promptFeedback; // Access feedback safely

            if (!response) {
                parentLogger.warn({ ...callAttemptContext, feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing response object.");
                if (feedback?.blockReason) {
                    parentLogger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings");
                    throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`); // Throw to trigger retry logic (which will likely fail)
                }
                throw new Error("Empty or invalid response object from Gemini API."); // Throw for retry
            }

            // Check for block reason even if response exists (sometimes happens)
            if (feedback?.blockReason) {
                parentLogger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings (found in feedback)");
                throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`); // Throw to trigger retry logic
            }

            let responseText = "";
            try {
                responseText = response.text(); // Preferred method
                parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_success' }, "Extracted text using response.text()");
            } catch (textError: unknown) {
                const errorDetails = textError instanceof Error ? { name: textError.name, message: textError.message } : { details: String(textError) };
                parentLogger.warn({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_text_extract_failed' }, "Response.text() accessor failed, trying fallback.");
                responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (!responseText) {
                    parentLogger.warn({ ...callAttemptContext, responseStructure: response, event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback.");
                    // Consider throwing an error here if text is absolutely required
                    // throw new Error("Failed to extract text content from API response.");
                } else {
                    parentLogger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_fallback_success' }, "Extracted text using fallback");
                }
            }

            const metaData = response.usageMetadata ?? null;

            // Write response to file (fire-and-forget)
            const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
            const responseOutputPath = path.join(RESPONSE_OUTPUT_DIR, `result_${apiType}_${modelName}_${safeAcronym}_${batchIndex}.txt`); // Add batchIndex
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
            return { responseText, metaData }; // Return successful response

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
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails }, "Unhandled error in main function");
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
        const systemInstruction = (config.systemInstruction || "")
            .replace(/\${Title}/g, title || 'N/A')
            .replace(/\${Acronym}/g, acronym || 'N/A');

        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, title, acronym, apiType,
            systemInstruction: systemInstruction,
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
            }
        } else {
            parentLogger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
        }

        parentLogger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
        parentLogger.error({ ...logContextWithModel, err: errorDetails }, "Unhandled error in main function");
        return defaultResponse;
    }
};