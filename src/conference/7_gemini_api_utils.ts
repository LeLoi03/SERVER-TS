import {
    GoogleGenerativeAI,
    type CachedContent, // Import specific type
    type GenerativeModel, // Import specific type
    type Content, // Import specific type
    type Part, // Import specific type
    type GenerateContentRequest, // Import specific type
    type GenerateContentResult, // Use GenerateContentResult
    // HarmCategory, HarmBlockThreshold, // Optionally import safety types if needed
} from "@google/generative-ai";
// Check your SDK version if '@google/generative-ai/server' path gives issues.
import { GoogleAICacheManager } from "@google/generative-ai/server";

import { promises as fsPromises, existsSync } from 'fs'; // Use promises and existsSync
import path from 'path';
import {
    RateLimiterRes,
    RateLimiterMemory,
    type IRateLimiterOptions, // Import type for options
} from 'rate-limiter-flexible';
import { logger } from './11_utils'; // Assuming 11_utils.ts exists and exports logger
import {
    apiConfigs, API_TYPE_EXTRACT, API_TYPE_DETERMINE,
    GEMINI_API_KEY, apiLimiter,
    MODEL_RATE_LIMIT_POINTS, MODEL_RATE_LIMIT_DURATION, MODEL_RATE_LIMIT_BLOCK_DURATION,
    MAX_RETRIES, INITIAL_DELAY_BETWEEN_RETRIES, MAX_DELAY_BETWEEN_RETRIES,
    type ApiConfig // Import the interface type from config
} from '../config'; // Import from .ts file

import { RetryableFunction, type ApiResponse, type CallGeminiApiParams } from "./types";

export const RESPONSE_OUTPUT_DIR: string = path.join(__dirname, "./data/responses");


// --- Persistent Cache Map Configuration ---
const CACHE_MAP_DIR: string = path.resolve(process.env.CACHE_MAP_DIR || './data'); // Thư mục lưu file map
const CACHE_MAP_FILENAME: string = 'gemini_cache_map.json';
const CACHE_MAP_FILE_PATH: string = path.join(CACHE_MAP_DIR, CACHE_MAP_FILENAME);

// --- Cache Storage ---
// Map<modelName (string), cacheName (string)> - Stores names loaded from/saved to file
let persistentCacheNameMap: Map<string, string> = new Map();
// Map<modelName (string), cacheObject (CachedContent)> - Stores actual cache objects in memory
const extractApiCaches: Map<string, CachedContent> = new Map();

// --- Khởi tạo Google Generative AI ---
let genAI: GoogleGenerativeAI | null = null;
console.log("Initializing GoogleGenerativeAI...");
try {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY is missing.");
    }
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    console.log("GoogleGenerativeAI initialized successfully.");
    logger.info("GoogleGenerativeAI initialized successfully.");
} catch (initError: unknown) {
    const message = initError instanceof Error ? initError.message : String(initError);
    console.error("Failed to initialize GoogleGenerativeAI:", message);
    logger.fatal(initError, "Failed to initialize GoogleGenerativeAI. Gemini API calls will likely fail.");
    // genAI remains null
    // Consider exiting if genAI is critical: process.exit(1);
}

// --- Cache Name Map File I/O Functions ---
const loadCacheNameMap = async (): Promise<void> => {
    logger.info(`Attempting to load cache name map from: ${CACHE_MAP_FILE_PATH}`);
    try {
        if (!existsSync(CACHE_MAP_DIR)) {
            logger.warn(`Cache map directory not found, creating: ${CACHE_MAP_DIR}`);
            await fsPromises.mkdir(CACHE_MAP_DIR, { recursive: true });
        }
        if (!existsSync(CACHE_MAP_FILE_PATH)) {
            logger.warn(`Cache map file not found at ${CACHE_MAP_FILE_PATH}. Starting with an empty map.`);
            persistentCacheNameMap = new Map();
            return;
        }
        const fileContent = await fsPromises.readFile(CACHE_MAP_FILE_PATH, 'utf8');
        if (!fileContent.trim()) {
            logger.warn(`Cache map file is empty. Starting with an empty map.`);
            persistentCacheNameMap = new Map();
            return;
        }
        // Type the parsed data explicitly
        const data: Record<string, string> = JSON.parse(fileContent);
        persistentCacheNameMap = new Map<string, string>(Object.entries(data));
        logger.info(`Successfully loaded ${persistentCacheNameMap.size} cache name entries from file.`);
    } catch (error: unknown) {
        logger.error(error, `Failed to load or parse cache name map from ${CACHE_MAP_FILE_PATH}. Starting with an empty map.`);
        persistentCacheNameMap = new Map(); // Reset on error
    }
};

const saveCacheNameMap = async (): Promise<void> => {
    if (!genAI) return; // Avoid saving if genAI failed

    logger.debug(`Attempting to save cache name map to: ${CACHE_MAP_FILE_PATH}`);
    try {
        if (!existsSync(CACHE_MAP_DIR)) {
            await fsPromises.mkdir(CACHE_MAP_DIR, { recursive: true });
        }
        // Convert Map to object for JSON.stringify
        const dataToSave: Record<string, string> = Object.fromEntries(persistentCacheNameMap);
        const jsonString = JSON.stringify(dataToSave, null, 2);
        await fsPromises.writeFile(CACHE_MAP_FILE_PATH, jsonString, 'utf8');
        logger.debug(`Successfully saved cache name map (${persistentCacheNameMap.size} entries) to file.`);
    } catch (error: unknown) {
        logger.error(error, `Failed to save cache name map to ${CACHE_MAP_FILE_PATH}.`);
    }
};

const removePersistentCacheEntry = async (modelName: string): Promise<void> => {
    if (persistentCacheNameMap.has(modelName)) {
        logger.warn(`Removing persistent cache entry for model ${modelName}.`);
        persistentCacheNameMap.delete(modelName);
        await saveCacheNameMap(); // Save immediately after removal
    }
};

// --- Load Cache Map on Startup ---
(async () => {
    await loadCacheNameMap();
})();


// --- Cache Manager Initialization ---
let cacheManager: GoogleAICacheManager | null = null;
const initializeCacheManager = (): GoogleAICacheManager | null => {
    if (!genAI) {
        logger.warn("GoogleGenerativeAI not initialized, skipping CacheManager initialization.");
        return null;
    }
    if (cacheManager) {
        return cacheManager;
    }
    logger.info("Initializing GoogleAICacheManager...");
    try {
        // Ensure API Key is valid before passing
        if (!GEMINI_API_KEY) throw new Error("Cannot initialize CacheManager without GEMINI_API_KEY");
        cacheManager = new GoogleAICacheManager(GEMINI_API_KEY);
        logger.info("GoogleAICacheManager initialized successfully.");
    } catch (error: unknown) {
        logger.error(error, "Failed to initialize GoogleAICacheManager");
        cacheManager = null;
    }
    return cacheManager;
};


// --- Per-Model Rate Limiting Setup ---
const modelRateLimiters: Map<string, RateLimiterMemory> = new Map();

function getRateLimiterForModel(modelName: string): RateLimiterMemory {
    if (!modelRateLimiters.has(modelName)) {
        logger.info(`Creating new rate limiter for model: ${modelName}`);
        // Type the options explicitly
        const limiterOptions: IRateLimiterOptions = {
            points: MODEL_RATE_LIMIT_POINTS,
            duration: MODEL_RATE_LIMIT_DURATION,
            blockDuration: MODEL_RATE_LIMIT_BLOCK_DURATION,
            keyPrefix: `model_${modelName}`, // Unique prefix per model
        };
        try {
            const newLimiter = new RateLimiterMemory(limiterOptions);
            // Check if creation was successful and it's a valid object
            if (!newLimiter || typeof newLimiter.consume !== 'function') {
                logger.error(`!!! Failed to create a valid rate limiter object for ${modelName} !!!`, { options: limiterOptions });
                throw new Error(`Failed to create valid rate limiter for ${modelName}`);
            }
            logger.debug({ modelName, options: limiterOptions }, "Rate limiter created successfully.");
            modelRateLimiters.set(modelName, newLimiter);
        } catch (creationError: unknown) {
            logger.error(creationError, `!!! Exception during RateLimiterMemory creation for ${modelName} !!!`);
            // Rethrow to signal critical failure
            throw creationError;
        }
    }

    const limiterInstance = modelRateLimiters.get(modelName);

    // Final check before returning (should theoretically always pass if logic above is correct)
    if (!limiterInstance || typeof limiterInstance.consume !== 'function') {
        logger.error(`!!! Invalid limiter found in map for ${modelName} just before returning !!!`);
        throw new Error(`Retrieved invalid rate limiter from map for ${modelName}`);
    }

    return limiterInstance;
}

// --- Get Or Create Extract Cache (with Persistent Logic) ---
const getOrCreateExtractCache = async (
    modelName: string,
    systemInstructionText: string, // Keep as string text
    fewShotParts: Part[]
): Promise<CachedContent | null> => {
    logger.debug(`Getting or creating extract cache for model: ${modelName}`);

    // 1. Check in-memory cache object map first
    const cachedInMemory = extractApiCaches.get(modelName);
    if (cachedInMemory) {
        logger.debug({ cacheName: cachedInMemory.name, modelName }, "Reusing existing extract API cache object from in-memory map");
        return cachedInMemory;
    }
    logger.debug(`Cache object not found in memory for model ${modelName}. Checking persistent store...`);

    const manager = initializeCacheManager();
    if (!manager) {
        logger.warn("CacheManager not available. Cannot create or use cache.");
        return null;
    }

    // 2. Check persistent cache *name* map
    const knownCacheName = persistentCacheNameMap.get(modelName);
    if (knownCacheName) {
        logger.info(`Found persistent cache name (${knownCacheName}) for model ${modelName}. Attempting to retrieve from Google...`);
        try {
            // 3. Attempt to retrieve cache object from Google using the known name
            // CORRECT
            const retrievedCache = await manager.get(knownCacheName);

            if (retrievedCache?.name) { // Check if retrieved cache is valid
                logger.info(`Successfully retrieved cache object ${retrievedCache.name} from Google.`);
                extractApiCaches.set(modelName, retrievedCache); // Store in memory
                return retrievedCache;
            } else {
                logger.warn(`manager.get for ${knownCacheName} returned invalid object. Proceeding to create new cache.`);
                await removePersistentCacheEntry(modelName); // Remove invalid entry
            }
        } catch (getError: unknown) {
            const errorMsg = getError instanceof Error ? getError.message.toLowerCase() : '';
            if (errorMsg.includes('not found') || errorMsg.includes('permission denied')) {
                logger.warn(getError, `Persistent cache name ${knownCacheName} for model ${modelName} not found or accessible on Google server. Removing from persistent map.`);
            } else {
                logger.error(getError, `Failed to retrieve cache ${knownCacheName} from Google for model ${modelName}. Proceeding to create new cache.`);
            }
            await removePersistentCacheEntry(modelName); // Remove entry if get fails
        }
    } else {
        logger.info(`No persistent cache name found for model ${modelName}.`);
    }

    // 4. If not retrieved -> Create New Cache
    logger.info(`Attempting to create NEW context cache for extract API model: ${modelName}`);
    try {
        // Construct Content object for system instruction and few-shot parts
        const systemInstructionContent: Part[] = [{ text: systemInstructionText }];
        const contentToCache: Content[] = [{ role: 'user', parts: fewShotParts }]; // Assuming fewShotParts is already structured correctly

        const createdCache = await manager.create({
            model: `models/${modelName}`, // Model name needs 'models/' prefix for cache API
            systemInstruction: { role: "system", parts: systemInstructionContent },
            contents: contentToCache,
            // ttl: { seconds: 3600 * 24 * 7 }, // Optional: Example TTL: 1 week
            displayName: `cache-${modelName}-${Date.now()}` // Optional display name
        });

        if (!createdCache?.name) { // Validate response
            logger.error({ createdCacheObject: createdCache, modelName }, "Failed to create context cache: Invalid cache object returned by manager.create");
            return null;
        }

        logger.info({ cacheName: createdCache.name, model: createdCache.model }, "Context cache created successfully");

        // 5. Store the NEW cache object in memory AND its name persistently
        extractApiCaches.set(modelName, createdCache);
        persistentCacheNameMap.set(modelName, createdCache.name);
        await saveCacheNameMap();

        return createdCache;

    } catch (cacheError: unknown) {
        logger.error(cacheError, "Failed to create NEW context cache for extract API", { modelName });
        // Check for specific errors like invalid model format
        if (cacheError instanceof Error && cacheError.message.includes("invalid model")) {
            logger.error(`Ensure model name '${modelName}' is correct and potentially prefixed with 'models/' for caching API.`);
        }
        return null;
    }
};


// --- Execute with Retry Logic ---
const executeWithRetry = async (
    fn: RetryableFunction,
    apiType: string,
    batchIndex: number,
    // key: string, // 'key' parameter seems unused, removed
    modelName: string,
    modelRateLimiter: RateLimiterMemory
): Promise<ApiResponse> => {
    logger.debug(`Executing with retry: apiType=${apiType}, batchIndex=${batchIndex}, model=${modelName}`);
    let retryCount = 0;
    let currentDelay = INITIAL_DELAY_BETWEEN_RETRIES;
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    while (retryCount < MAX_RETRIES) {
        try {
            if (!genAI) {
                logger.error(`Cannot execute function for ${apiType} batch #${batchIndex}: GoogleGenerativeAI is not initialized.`);
                return defaultResponse;
            }
            logger.debug(`Executing function (attempt ${retryCount + 1}): apiType=${apiType}, batchIndex=${batchIndex}, model=${modelName}`);
            // Pass the specific rate limiter to the function
            return await fn(modelRateLimiter);

        } catch (error: unknown) {
            // Check if it's a rate limit error from our internal limiter
            if (error instanceof RateLimiterRes) {
                const waitTimeMs = error.msBeforeNext;
                logger.warn({ apiType, batchIndex, modelName, retryCount, waitTimeMs }, `Internal rate limit exceeded for model ${modelName}. Waiting ${waitTimeMs} ms...`);
                await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                // Don't increment retry count for internal limiter waits, just loop again
                continue;
            }

            let shouldRetry = true;
            let invalidateCache = false;
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) }

            // Handle specific Gemini API errors / other errors
            if (errorMessage.includes("CachedContent not found") || errorMessage.includes("Permission denied on cached content") || errorMessage.includes("INVALID_ARGUMENT: Cannot find cached content")) {
                logger.warn({ apiType, batchIndex, modelName, cacheName: extractApiCaches.get(modelName)?.name, error: errorMessage }, `Cache related error encountered. Invalidating cache reference for model.`);
                invalidateCache = true;
            } else if (errorMessage.includes("429") || errorMessage.includes("RESOURCE_EXHAUSTED")) { // Check for 429 or specific gRPC code
                logger.warn({ apiType, batchIndex, modelName, retryCount }, `429/Resource Exhausted Error from Gemini API for model ${modelName}. Retrying after delay...`);
            } else if (errorMessage.includes("503") || errorMessage.includes("500") || errorMessage.includes("UNAVAILABLE") || errorMessage.includes("INTERNAL")) {
                logger.warn({ apiType, batchIndex, modelName, retryCount, err: errorDetails }, `5xx/Server Error from Gemini API for model ${modelName}. Retrying after delay...`);
            } else if (errorMessage.toLowerCase().includes("blocked") || errorMessage.toLowerCase().includes("safety")) {
                logger.error({ apiType, batchIndex, modelName, retryCount, err: errorDetails }, `Request blocked by Gemini safety settings for model ${modelName}. No further retries.`);
                shouldRetry = false;
            } else {
                // Log other errors but still retry by default
                logger.warn({ apiType, batchIndex, modelName, retryCount, err: errorDetails }, `Unhandled/other error encountered during execution attempt for model ${modelName}. Retrying...`);
            }


            // Invalidate cache if marked (applies only to extract API)
            if (invalidateCache && apiType === API_TYPE_EXTRACT) {
                logger.info(`Removing cache entry for model ${modelName} due to error.`);
                extractApiCaches.delete(modelName);
                await removePersistentCacheEntry(modelName);
            }

            // Increment retry count *after* handling the error type
            retryCount++;
            const isLastRetry = retryCount >= MAX_RETRIES;

            if (!shouldRetry) {
                logger.error({ apiType, batchIndex, modelName, finalError: errorDetails }, `Non-retryable error encountered. Aborting retries.`);
                return defaultResponse;
            }

            // Decide whether to wait and retry
            if (!isLastRetry) {
                const jitter = Math.random() * 500; // Add jitter
                const delayWithJitter = Math.max(0, currentDelay + jitter); // Ensure delay is non-negative
                logger.info({ apiType, batchIndex, modelName, retryCount, delaySeconds: (delayWithJitter / 1000).toFixed(2) }, `Waiting before next retry...`);
                await new Promise(resolve => setTimeout(resolve, delayWithJitter));
                // Exponential backoff with cap
                currentDelay = Math.min(currentDelay * 2, MAX_DELAY_BETWEEN_RETRIES);
            } else {
                logger.error({ apiType, batchIndex, modelName, maxRetries: MAX_RETRIES, finalError: errorDetails }, `Failed to process after ${MAX_RETRIES} retries.`);
                return defaultResponse;
            }
        }
    }
    // Fallback return (should not be reached if MAX_RETRIES > 0)
    logger.error({ apiType, batchIndex, modelName }, "Exited retry loop unexpectedly.");
    return defaultResponse;
};


// --- Core Gemini API Call Function ---
const callGeminiAPI = async ({
    batch, batchIndex, acronym, apiType, systemInstruction, modelName, generationConfig
}: CallGeminiApiParams): Promise<ApiResponse> => {
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };
    logger.debug(`Calling Gemini API: apiType=${apiType}, batchIndex=${batchIndex}, model=${modelName}`);

    // --- Lấy Rate Limiter và Config ---
    let modelRateLimiter: RateLimiterMemory;
    try {
        modelRateLimiter = getRateLimiterForModel(modelName); // Hàm này cần throw lỗi nếu không tạo được limiter
    } catch (limiterError: unknown) {
        logger.error(limiterError, `Failed to get or create rate limiter for ${modelName}. Aborting API call.`);
        return defaultResponse;
    }

    const apiConfig: ApiConfig | undefined = apiConfigs[apiType];
    if (!apiConfig) {
        logger.error({ apiType, acronym, batchIndex }, "Invalid apiType provided. Cannot find configuration.");
        return defaultResponse;
    }

    // --- Chuẩn bị Few-Shot Parts ---
    const inputs = apiConfig.inputs || {};
    const outputs = apiConfig.outputs || {};
    const fewShotParts: Part[] = [];
     try {
        Object.entries(inputs).forEach(([inputKey, inputValue]) => {
            const outputKey = inputKey.replace('input', 'output');
            const outputValue = outputs[outputKey] || '';
            fewShotParts.push({ text: inputValue });
            fewShotParts.push({ text: outputValue });
        });
    } catch (fewShotError: unknown) {
        logger.error(fewShotError, "Error processing few-shot examples", { apiType, batchIndex });
        // Có thể quyết định thất bại hoặc tiếp tục mà không có few-shot
        // return defaultResponse; // Hoặc chỉ ghi log và tiếp tục
    }

    // --- Thiết lập Model và Content Request ---
    let model: GenerativeModel | undefined;
    let contentRequest: GenerateContentRequest | string; // String khi dùng cache, object khi không dùng
    let usingCache = false;
    let currentCache: CachedContent | null = null;
    const generationModelName = modelName; // Sử dụng tên gốc cho getGenerativeModel

    // --- Xử lý Cache cho API_TYPE_EXTRACT ---
    if (apiType === API_TYPE_EXTRACT) {
        try {
            // Hàm getOrCreateExtractCache đã được định nghĩa ở trên
            currentCache = await getOrCreateExtractCache(modelName, systemInstruction, fewShotParts);
        } catch (cacheSetupError: unknown) {
            logger.error(cacheSetupError, "Critical error during cache setup, proceeding without cache", { apiType, batchIndex, acronym, modelName });
            currentCache = null;
        }

        // --- Sử dụng Cache nếu có ---
        if (currentCache?.name) {
            logger.debug({ apiType, batchIndex, acronym, cacheName: currentCache.name, modelName }, "Attempting to use cached context object");
            try {
                if (!genAI) throw new Error("genAI not initialized");

                // Lấy model từ cache. Lưu ý: GenerationConfig thường được kế thừa từ cache.
                model = genAI.getGenerativeModelFromCachedContent(currentCache);

                // Khi dùng cache, chỉ gửi input mới dưới dạng string
                contentRequest = batch;
                usingCache = true;
                logger.info(`Using cached context ${currentCache.name} for model ${modelName}.`);

            } catch (getModelError: unknown) {
                logger.error(getModelError, "Error getting model from cached content, falling back to non-cached", { apiType, batchIndex, acronym, modelName, cacheName: currentCache?.name });
                // Hủy cache nếu không lấy được model từ nó
                extractApiCaches.delete(modelName);
                await removePersistentCacheEntry(modelName);
                currentCache = null;
                usingCache = false; // Đảm bảo fallback
            }
        }

        // --- Fallback (Không dùng Cache) ---
        if (!usingCache) {
            // Log lý do fallback
            if (currentCache) { // Nếu đã cố gắng dùng cache nhưng thất bại
                 logger.warn({ apiType, batchIndex, acronym, modelName }, "Falling back to non-cached model due to error getting model from cache.");
            } else { // Nếu không tìm thấy cache hoặc tạo cache thất bại
                 logger.info({ apiType, batchIndex, acronym, modelName }, "Proceeding without cache (not found, create failed, or getModel failed).");
            }
            // Tạo model và request không dùng cache
            try {
                 if (!genAI) throw new Error("genAI not initialized");
                 // Khởi tạo model không có generationConfig ở đây
                 model = genAI.getGenerativeModel({
                     model: generationModelName,
                     systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
                 });
                 // Xây dựng lịch sử hội thoại (few-shot + input mới)
                 const history: Content[] = [];
                 for (let i = 0; i < fewShotParts.length; i += 2) {
                     if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                     if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
                 }
                 history.push({ role: "user", parts: [{ text: batch }] }); // Input mới nhất
                 // *Đưa generationConfig vào bên trong request object*
                 contentRequest = {
                     contents: history,
                     generationConfig: generationConfig, // SỬA LỖI: Config nằm ở đây
                 };
                 logger.info(`Using non-cached model ${generationModelName}.`);
            } catch (getModelError: unknown) {
                 logger.error(getModelError, "Error getting non-cached generative model", { apiType, batchIndex, acronym, modelName: generationModelName });
                 return defaultResponse;
            }
        }
    } else { // --- API Types khác (Không dùng Cache) ---
        logger.debug({ apiType, batchIndex, acronym, modelName: generationModelName }, "Not using cache for this API type.");
        try {
            if (!genAI) throw new Error("genAI not initialized");
            // Khởi tạo model không có generationConfig ở đây
            model = genAI.getGenerativeModel({
                model: generationModelName,
                systemInstruction: { role: "system", parts: [{ text: systemInstruction }] },
            });
            // Xây dựng lịch sử hội thoại
            const history: Content[] = [];
            for (let i = 0; i < fewShotParts.length; i += 2) {
                 if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                 if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
            }
            history.push({ role: "user", parts: [{ text: batch }] });
            // *Đưa generationConfig vào bên trong request object*
            contentRequest = {
                contents: history,
                generationConfig: generationConfig, // SỬA LỖI: Config nằm ở đây
            };
            logger.info(`Using non-cached model ${generationModelName}.`);
        } catch (getModelError: unknown) {
            logger.error(getModelError, "Error getting generative model", { apiType, batchIndex, acronym, modelName: generationModelName });
            return defaultResponse;
        }
        usingCache = false;
    }
    // --- Kết thúc Thiết lập Model và Content Request ---

    // --- Gọi API với Logic Retry ---
    // executeWithRetry được giả định là đã định nghĩa đúng ở trên
    return executeWithRetry(async (limiter): Promise<ApiResponse> => {
        // Kiểm tra model trước khi dùng
        if (!model) {
            logger.error({ apiType, batchIndex, acronym, modelName: generationModelName, usingCache }, "Model object is undefined before calling generateContent.");
            throw new Error("Model is not initialized"); // Gây lỗi để retry hoặc thất bại
        }

        // Sử dụng p-limit (apiLimiter) để giới hạn tổng số request đồng thời
        return await apiLimiter(async () => {
            const rateLimitKey = `${apiType}_${batchIndex}_${modelName}`; // Key chi tiết hơn cho rate limiter
            try {
                // Sử dụng rate-limiter-flexible (limiter) cho từng model
                await limiter.consume(rateLimitKey);
                logger.debug({ apiType, batchIndex, acronym, modelName: generationModelName, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A' }, `Rate limit check passed for model ${modelName}. Sending request...`);

                let result: GenerateContentResult;
                try {
                    // ****** GỌI API THỰC TẾ - ĐÃ BỎ ĐỐI SỐ THỨ HAI ******
                    result = await model.generateContent(contentRequest);
                    // ******************************************************
                    logger.info(`Gemini API call successful for model ${modelName}.`);
                } catch (generateContentError: unknown) {
                    // Log và xử lý lỗi, bao gồm hủy cache nếu cần
                    logger.error(generateContentError, "Error during model.generateContent", { apiType, batchIndex, acronym, modelName: generationModelName, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A' });
                    if (usingCache && generateContentError instanceof Error && (generateContentError.message.includes("CachedContent not found") || generateContentError.message.includes("Permission denied"))) {
                        logger.warn(`Invalidating cache for model ${modelName} due to generateContent error.`);
                        extractApiCaches.delete(modelName);
                        await removePersistentCacheEntry(modelName); // Đảm bảo xóa cả persistent
                    }
                    throw generateContentError; // Ném lại lỗi để executeWithRetry xử lý
                }

                // --- Xử lý Response ---
                const response = result?.response;
                if (!response) {
                    const feedback = result?.response?.promptFeedback; // Sửa lại cách truy cập feedback
                    logger.warn({ apiType, batchIndex, acronym, modelName, feedback }, "Gemini API returned result with missing response object.");
                    if (feedback?.blockReason) {
                        throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
                    }
                    throw new Error("Empty or invalid response object from Gemini API.");
                }

                // Lấy text an toàn
                let responseText = "";
                try {
                     responseText = response.text(); // Cách chính thức và an toàn nhất
                } catch (textError: unknown) {
                     logger.warn(textError, "Response.text() accessor failed, trying fallback.", { apiType, batchIndex, acronym, modelName });
                     // Fallback (ít dùng hơn với SDK mới)
                     responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                     if (!responseText) {
                         logger.warn({ apiType, batchIndex, acronym, modelName, responseStructure: response }, "Could not extract text content from response via fallback.");
                     }
                }

                const metaData = response.usageMetadata;

                // --- Ghi response ra file (bất đồng bộ) ---
                const safeAcronym = acronym || 'noacronym'; // Đảm bảo tên file hợp lệ
                const response_outputPath = path.join(RESPONSE_OUTPUT_DIR, `result_${apiType}_${modelName}_${batchIndex}_${safeAcronym}.txt`);
                try {
                    if (!existsSync(RESPONSE_OUTPUT_DIR)) {
                        await fsPromises.mkdir(RESPONSE_OUTPUT_DIR, { recursive: true });
                        logger.info({ directory: RESPONSE_OUTPUT_DIR }, "Created response output directory");
                    }
                    await fsPromises.writeFile(response_outputPath, responseText || "", "utf8"); // Ghi chuỗi rỗng nếu responseText null/undefined
                    logger.debug({ filePath: response_outputPath }, "Successfully wrote response to file");
                } catch (fileWriteError: unknown) {
                    logger.error(fileWriteError, "Error writing response to file", { filePath: response_outputPath });
                    // Không coi là lỗi nghiêm trọng của API call
                }

                // --- Hoàn thành ---
                logger.info({ apiType, batchIndex, acronym, modelName: generationModelName, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A' }, "Gemini API request processed successfully.");
                return { responseText, metaData };

            } catch (limiterOrApiError: unknown) {
                // Bắt lỗi từ limiter.consume() hoặc khối try bên trong
                logger.warn({ error: limiterOrApiError instanceof Error ? limiterOrApiError.message : limiterOrApiError }, `Error within apiLimiter block for model ${modelName}. Propagating for retry handling.`);
                throw limiterOrApiError; // Ném lại lỗi để executeWithRetry xử lý
            }
        });
    }, apiType, batchIndex, modelName, modelRateLimiter); // Truyền các đối số cần thiết cho executeWithRetry
};

// --- Exported API Functions ---

// Round-Robin Index for Extract Models
let extractModelIndex: number = 0;

export const extract_information_api = async (
    batch: string,
    batchIndex: number,
    acronym: string | undefined
): Promise<ApiResponse> => {
    const apiType = API_TYPE_EXTRACT;
    const config: ApiConfig | undefined = apiConfigs[apiType];
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    if (!config) {
        logger.error(`Configuration for ${apiType} not found.`);
        return defaultResponse;
    }
    const modelNames = config.modelNames; // Expect array from config
    if (!modelNames || modelNames.length === 0) {
        logger.error(`No model names configured for ${apiType} in apiConfigs.`);
        return defaultResponse;
    }

    // Select Model Round-Robin
    const selectedModelName = modelNames[extractModelIndex];
    extractModelIndex = (extractModelIndex + 1) % modelNames.length; // Update index

    logger.debug({ apiType, batchIndex, selectedModel: selectedModelName, nextIndex: extractModelIndex }, "Initiating extract_information_api call");

    try {
        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, acronym, apiType,
            systemInstruction: config.systemInstruction || "", // Provide default
            modelName: selectedModelName,
            generationConfig: config.generationConfig,
        });

        // --- JSON Cleaning Logic ---
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                // Validate by parsing
                JSON.parse(potentialJson);
                cleanedResponseText = potentialJson.trim();
                logger.debug({ batchIndex, modelUsed: selectedModelName }, "Successfully cleaned and validated JSON response.");
            } catch (parseError: unknown) {
                logger.warn({ batchIndex, modelUsed: selectedModelName, rawResponseSnippet: responseText.substring(0, 200), error: parseError instanceof Error ? parseError.message : String(parseError) }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                // cleanedResponseText remains ""
            }
        } else {
            logger.warn({ batchIndex, modelUsed: selectedModelName, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
            // cleanedResponseText remains ""
        }
        // --- End JSON Cleaning ---

        logger.info(`extract_information_api call successful: batchIndex=${batchIndex}, modelUsed=${selectedModelName}`);
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        logger.error(error, `Unhandled error in extract_information_api main function`, { batchIndex, modelUsed: selectedModelName });
        return defaultResponse;
    }
};

export const determine_links_api = async (
    batch: string,
    batchIndex: number,
    title: string | undefined, // Allow undefined
    acronym: string | undefined // Allow undefined
): Promise<ApiResponse> => {
    const apiType = API_TYPE_DETERMINE;
    const config: ApiConfig | undefined = apiConfigs[apiType];
    const defaultResponse: ApiResponse = { responseText: "", metaData: null };

    if (!config) {
        logger.error(`Configuration for ${apiType} not found.`);
        return defaultResponse;
    }
    const modelName = config.modelName; // Expect single string from config
    if (!modelName) {
        logger.error(`No model name configured for ${apiType} in apiConfigs.`);
        return defaultResponse;
    }

    logger.debug({ apiType, batchIndex, model: modelName, title, acronym }, "Initiating determine_links_api call");

    try {
        // Replace placeholders in system instruction safely
        const systemInstruction = (config.systemInstruction || "")
            .replace(/\${Title}/g, title || 'N/A')
            .replace(/\${Acronym}/g, acronym || 'N/A');

        const { responseText, metaData } = await callGeminiAPI({
            batch, batchIndex, acronym, apiType,
            systemInstruction: systemInstruction,
            modelName: modelName,
            generationConfig: config.generationConfig,
        });

        // --- JSON Cleaning Logic (same as extract) ---
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson);
                cleanedResponseText = potentialJson.trim();
                logger.debug({ batchIndex, modelUsed: modelName }, "Successfully cleaned and validated JSON response.");
            } catch (parseError: unknown) {
                logger.warn({ batchIndex, modelUsed: modelName, rawResponseSnippet: responseText.substring(0, 200), error: parseError instanceof Error ? parseError.message : String(parseError) }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                // cleanedResponseText remains ""
            }
        } else {
            logger.warn({ batchIndex, modelUsed: modelName, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
            // cleanedResponseText remains ""
        }
        // --- End JSON Cleaning ---

        logger.info(`determine_links_api call successful: batchIndex=${batchIndex}, modelUsed=${modelName}`);
        return { responseText: cleanedResponseText, metaData };

    } catch (error: unknown) {
        logger.error(error, `Unhandled error in determine_links_api main function`, { batchIndex, modelUsed: modelName, title, acronym });
        return defaultResponse;
    }
};