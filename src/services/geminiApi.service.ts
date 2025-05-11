// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import {
    GoogleGenerativeAI,
    type CachedContent,
    type GenerativeModel,
    type Content,
    type Part,
    type GenerateContentRequest,
    type GenerateContentResult,
    type GenerationConfig as SDKGenerationConfig, // Renamed to avoid conflict
    type UsageMetadata,
    // HarmCategory, HarmBlockThreshold, // Optionally import safety types if needed
} from "@google/generative-ai";
import { GoogleAICacheManager } from "@google/generative-ai/server"; // Might not be needed depending on genAI version

import {
    RateLimiterRes,
    RateLimiterMemory,
    type IRateLimiterOptions,
} from 'rate-limiter-flexible';

import { ConfigService, type GeminiApiConfig } from '../config/config.service'; // Import ConfigService and the structured config type
import { LoggingService } from './logging.service'; // Import LoggingService
import { Logger } from 'pino'; // Import Logger type

// --- Type Definitions ---
export interface ApiResponse {
    responseText: string;
    metaData: UsageMetadata | null | undefined;
}

// Type for the function passed to executeWithRetry (now an internal method)
type RetryableFunction = (limiter: RateLimiterMemory, logger: Logger) => Promise<ApiResponse>;

// Interface for parameters passed to internal callGeminiAPI method
interface InternalCallGeminiApiParams {
    batch: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
    apiType: string;
    modelName: string;
    generationConfig: SDKGenerationConfig | undefined; // Use renamed SDK type
    fewShotParts: Part[]; // Pass prepared parts
    useCache: boolean; // Pass determined cache usage
}

// Interface for parameters passed to public API methods
export interface GeminiApiParams {
    batch: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
}


@singleton()
export class GeminiApiService {
    private readonly serviceBaseLogger: Logger; // Đổi tên
    private readonly configService: ConfigService; // Store injected service

    // --- Configuration values stored as properties ---
    private readonly geminiApiKey: string;
    private readonly apiConfigs: Record<string, GeminiApiConfig>; // Use the structured config from ConfigService
    private readonly rateLimitPoints: number;
    private readonly rateLimitDuration: number;
    private readonly rateLimitBlockDuration: number;
    private readonly maxRetries: number;
    private readonly initialDelayMs: number;
    private readonly maxDelayMs: number;
    private readonly responseOutputDir: string;
    private readonly cacheMapFilePath: string;
    private readonly cacheMapDir: string;

    // API Type constants (can be kept here or imported if defined elsewhere)
    public readonly API_TYPE_EXTRACT = 'extract';
    public readonly API_TYPE_DETERMINE = 'determine';
    public readonly API_TYPE_CFP = 'cfp';


    // --- Service State ---
    private genAI: GoogleGenerativeAI | null = null;
    private cacheManager: GoogleAICacheManager | null = null;
    private persistentCacheNameMap: Map<string, string> = new Map(); // Keys: composite `${apiType}-${modelName}`
    private contextCaches: Map<string, CachedContent | null> = new Map(); // Keys: composite `${apiType}-${modelName}`
    private cachePromises: Map<string, Promise<CachedContent | null>> = new Map(); // Keys: composite `${apiType}-${modelName}`
    private modelRateLimiters: Map<string, RateLimiterMemory> = new Map(); // Keys: modelName
    private extractModelIndex: number = 0;
    private cfpModelIndex: number = 0;
    private serviceInitialized: boolean = false;


    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.configService = configService; // Store injected service
        this.serviceBaseLogger = loggingService.getLogger({ service: 'GeminiApiServiceBase' }); // Đổi tên

        this.serviceBaseLogger.info("Constructing GeminiApiService...");

        // --- Load configuration values from ConfigService ---
        this.geminiApiKey = this.configService.config.GEMINI_API_KEY;
        this.apiConfigs = this.configService.geminiApiConfigs; // Use the pre-built structured config
        this.rateLimitPoints = this.configService.config.GEMINI_RATE_LIMIT_POINTS;
        this.rateLimitDuration = this.configService.config.GEMINI_RATE_LIMIT_DURATION;
        this.rateLimitBlockDuration = this.configService.config.GEMINI_RATE_LIMIT_BLOCK_DURATION;
        this.maxRetries = this.configService.config.GEMINI_MAX_RETRIES;
        this.initialDelayMs = this.configService.config.GEMINI_INITIAL_DELAY_MS;
        this.maxDelayMs = this.configService.config.GEMINI_MAX_DELAY_MS;

        // Use getters from ConfigService for paths to ensure consistency and absolute paths
        this.responseOutputDir = path.join(this.configService.baseOutputDir, 'gemini_responses'); // Example subfolder
        this.cacheMapDir = path.join(this.configService.baseOutputDir, 'gemini_cache'); // Example subfolder
        const cacheMapFilename = 'gemini_cache_map.json'; // Keep filename simple
        this.cacheMapFilePath = path.join(this.cacheMapDir, cacheMapFilename);

        this.serviceBaseLogger.info(`Response Output Dir: ${this.responseOutputDir}`);
        this.serviceBaseLogger.info(`Cache Map Path: ${this.cacheMapFilePath}`);

        // --- Initialize Google Generative AI ---
        try {
            if (!this.geminiApiKey) {
                this.serviceBaseLogger.fatal({ event: 'gemini_service_config_error', reason: 'GEMINI_API_KEY missing' }, "GEMINI_API_KEY is missing in configuration. Service will not function.");

                throw new Error("GEMINI_API_KEY is missing in configuration.");
            }
            this.genAI = new GoogleGenerativeAI(this.geminiApiKey);
            // BỔ SUNG EVENT
            this.serviceBaseLogger.info({ event: 'gemini_service_genai_init_success' }, "GoogleGenerativeAI initialized successfully.");
            this.initializeCacheManager(); // Gọi sau khi genAI được init
        } catch (initError: unknown) {
            const errorDetails = initError instanceof Error ? { name: initError.name, message: initError.message, stack: initError.stack } : { details: String(initError) };
            // SỬA EVENT
            this.serviceBaseLogger.fatal({ err: errorDetails, event: 'gemini_service_genai_init_failed' }, "Failed to initialize GoogleGenerativeAI. Gemini API calls will likely fail.");
            // throw initError; // Cân nhắc có nên throw để dừng hẳn app
        }
    }

    // Helper để tạo logger cho phương thức với context từ parentLogger
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GeminiApiService.${methodName}`, ...additionalContext });
    }

    // --- Initialization Method ---
    public async init(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'init');

        if (this.serviceInitialized) {
            logger.debug("GeminiApiService already initialized.");
            return;
        }
        // BỔ SUNG EVENT
        logger.info({ event: 'gemini_service_async_init_start' }, "Running async initialization for GeminiApiService (loading cache map)...");
        try {
            await this.loadCacheNameMap(logger);
            this.serviceInitialized = true;
            // BỔ SUNG EVENT
            logger.info({ event: 'gemini_service_async_init_complete' }, "GeminiApiService async initialization complete.");
        } catch (error) {
            // Lỗi loadCacheNameMap đã được log bên trong, ở đây có thể log thêm lỗi init tổng thể
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // BỔ SUNG EVENT
            logger.error({ err: errorDetails, event: 'gemini_service_async_init_failed' }, "GeminiApiService async initialization failed during cache map loading.");
            // Không set serviceInitialized = true
        }
    }

    private ensureInitialized(logger: Logger): void {
        if (!this.serviceInitialized) {
            const errorMsg = "GeminiApiService is not initialized. Call init() after resolving the service.";
            // BỔ SUNG EVENT
            logger.error({ event: 'gemini_service_not_initialized', detail: errorMsg }, errorMsg);
            throw new Error(errorMsg);
        }
        if (!this.genAI) {
            const errorMsg = "GoogleGenerativeAI failed to initialize. Cannot proceed.";
            // BỔ SUNG EVENT (Có thể gộp với gemini_service_genai_init_failed nhưng đây là check runtime)
            logger.error({ event: 'gemini_service_genai_not_ready', detail: errorMsg }, errorMsg);
            throw new Error(errorMsg);
        }
    }


    // --- Cache Name Map File I/O Functions ---
    private async loadCacheNameMap(logger: Logger): Promise<void> { // Nhận logger
        const logContext = { filePath: this.cacheMapFilePath, function: 'loadCacheNameMap' };
        logger.info({ ...logContext, event: 'cache_map_load_attempt' }, "Attempting to load cache name map");
        try {
            // Ensure directory exists (using configured path)
            if (!existsSync(this.cacheMapFilePath)) {
                logger.warn({ ...logContext, event: 'cache_map_file_not_found' }, "Cache map file not found. Starting with an empty map.");
                this.persistentCacheNameMap = new Map();
                // BỔ SUNG EVENT (cho trường hợp file không tồn tại, coi như load thành công với map rỗng)
                logger.info({ ...logContext, event: 'cache_map_load_success', status: 'empty_map_created' }, "Cache map loaded (file did not exist, new empty map used).");
                return;
            }
            const fileContent = await fsPromises.readFile(this.cacheMapFilePath, 'utf8');
            if (!fileContent.trim()) {
                logger.warn({ ...logContext, event: 'cache_map_file_empty' }, "Cache map file is empty. Starting with an empty map.");
                this.persistentCacheNameMap = new Map();
                // BỔ SUNG EVENT (cho trường hợp file rỗng, coi như load thành công với map rỗng)
                logger.info({ ...logContext, event: 'cache_map_load_success', status: 'empty_map_from_empty_file' }, "Cache map loaded (file was empty, new empty map used).");
                return;
            }
            const data: Record<string, string> = JSON.parse(fileContent);
            this.persistentCacheNameMap = new Map<string, string>(Object.entries(data));
            // BỔ SUNG EVENT
            logger.info({ ...logContext, loadedCount: this.persistentCacheNameMap.size, event: 'cache_map_load_success', status: 'loaded_from_file' }, "Successfully loaded cache name entries from file");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // SỬA EVENT (từ cache_load_failed thành cache_map_load_failed cho rõ ràng)
            logger.error({ ...logContext, err: errorDetails, event: 'cache_map_load_failed' }, "Failed to load or parse cache name map. Starting with an empty map.");
            this.persistentCacheNameMap = new Map();
            throw error; // Ném lỗi để init() biết
        }
    }


    private async saveCacheNameMap(logger: Logger): Promise<void> {
        this.ensureInitialized(logger);
        const logContext = { filePath: this.cacheMapFilePath, function: 'saveCacheNameMap' };
        // BỔ SUNG EVENT
        logger.debug({ ...logContext, event: 'cache_map_write_attempt' }, "Attempting to save cache name map");
        try {
            // Ensure directory exists
            if (!existsSync(this.cacheMapDir)) {
                logger.info({ ...logContext, directory: this.cacheMapDir }, "Creating cache map directory before saving");
                await fsPromises.mkdir(this.cacheMapDir, { recursive: true });
            }
            // Save map content
            const dataToSave: Record<string, string> = Object.fromEntries(this.persistentCacheNameMap);
            const jsonString = JSON.stringify(dataToSave, null, 2);
            await fsPromises.writeFile(this.cacheMapFilePath, jsonString, 'utf8');
            // SỬA EVENT (từ cache_write_success thành cache_map_write_success)
            logger.info({ ...logContext, savedCount: this.persistentCacheNameMap.size, event: 'cache_map_write_success' }, "Successfully saved cache name map to file");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // SỬA EVENT (từ cache_write_failed thành cache_map_write_failed)
            logger.error({ ...logContext, err: errorDetails, event: 'cache_map_write_failed' }, "Failed to save cache name map");
        }
    }

    private async removePersistentCacheEntry(cacheKey: string, logger: Logger): Promise<void> {
        const logContext = { cacheKey, function: 'removePersistentCacheEntry' };
        if (this.persistentCacheNameMap.has(cacheKey)) {
            // BỔ SUNG EVENT
            logger.warn({ ...logContext, event: 'cache_persistent_entry_remove_start' }, "Removing persistent cache entry");
            this.persistentCacheNameMap.delete(cacheKey);
            await this.saveCacheNameMap(logger);
        } else {
            logger.debug({ ...logContext, event: 'cache_persistent_entry_remove_skipped_not_found' }, "No persistent cache entry found to remove");
        }
        if (this.contextCaches.has(cacheKey)) {
            // BỔ SUNG EVENT
            logger.warn({ ...logContext, source: 'in-memory', event: 'cache_inmemory_entry_remove' }, "Removing in-memory cache entry");
            this.contextCaches.delete(cacheKey);
        }
    }


    // --- Cache Manager Initialization (Private method) ---
    private initializeCacheManager(): void {
        const logContext = { function: 'initializeCacheManager' };
        if (!this.genAI) {
            // This case is handled in the constructor, but double-check
            this.serviceBaseLogger.warn(logContext, "GoogleGenerativeAI not initialized, skipping CacheManager initialization.");
            return;
        }
        if (this.cacheManager) {
            this.serviceBaseLogger.debug(logContext, "CacheManager already initialized.");
            return;
        }
        this.serviceBaseLogger.info({ ...logContext, event: 'cache_manager_init_start' }, "Initializing GoogleAICacheManager...");
        try {
            // Ensure API key is available (checked in constructor)
            if (!this.geminiApiKey) {
                throw new Error("Cannot initialize CacheManager without GEMINI_API_KEY");
            }

            // Always instantiate GoogleAICacheManager directly
            this.cacheManager = new GoogleAICacheManager(this.geminiApiKey);
            this.serviceBaseLogger.info({ ...logContext, event: 'cache_manager_init_success' }, "Initialized GoogleAICacheManager directly.");

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.serviceBaseLogger.error({ ...logContext, err: errorDetails, event: 'cache_manager_create_failed' }, "Failed to initialize GoogleAICacheManager");
            this.cacheManager = null; // Ensure it's null on failure
        }
    }

    // --- Per-Model Rate Limiting Setup (Private method) ---
    private getRateLimiterForModel(modelName: string): RateLimiterMemory {
        const logContext = { modelName, function: 'getRateLimiterForModel' };
        if (!this.modelRateLimiters.has(modelName)) {
            this.serviceBaseLogger.info(logContext, "Creating new rate limiter");
            // Use configured rate limit values
            const limiterOptions: IRateLimiterOptions = {
                points: this.rateLimitPoints,
                duration: this.rateLimitDuration,
                blockDuration: this.rateLimitBlockDuration,
                keyPrefix: `model_${modelName}`, // Keep prefix based on model
            };
            try {
                const newLimiter = new RateLimiterMemory(limiterOptions);
                if (!newLimiter || typeof newLimiter.consume !== 'function') {
                    this.serviceBaseLogger.error({ ...logContext, options: limiterOptions }, "Failed to create a valid rate limiter object");
                    throw new Error(`Failed to create valid rate limiter for ${modelName}`);
                }
                this.serviceBaseLogger.debug({ ...logContext, options: limiterOptions }, "Rate limiter created successfully");
                this.modelRateLimiters.set(modelName, newLimiter);
            } catch (creationError: unknown) {
                const errorDetails = creationError instanceof Error ? { name: creationError.name, message: creationError.message } : { details: String(creationError) };
                this.serviceBaseLogger.error({ ...logContext, err: errorDetails, options: limiterOptions }, "Exception during RateLimiterMemory creation");
                throw creationError; // Propagate error
            }
        }
        const limiterInstance = this.modelRateLimiters.get(modelName);
        // Add extra check after retrieval
        if (!limiterInstance || typeof limiterInstance.consume !== 'function') {
            this.serviceBaseLogger.error(logContext, "Invalid limiter found in map or failed creation");
            // Attempt recreation once? Or just throw? Throw for now.
            throw new Error(`Retrieved invalid rate limiter from map for ${modelName}`);
        }
        this.serviceBaseLogger.debug(logContext, "Retrieved existing rate limiter");
        return limiterInstance;
    }

    // --- Refactored Get Or Create Context Cache (Private method) ---

    private async getOrCreateContextCache(
        apiType: string,
        modelName: string,
        systemInstructionText: string,
        fewShotParts: Part[],
        logger: Logger
    ): Promise<CachedContent | null> {
        this.ensureInitialized(logger);
        const cacheKey = `${apiType}-${modelName}`;
        const baseLogContext = { cacheKey, apiType, modelName, function: 'getOrCreateContextCache' };
        // BỔ SUNG EVENT (cho việc bắt đầu get hoặc create)
        logger.debug({ ...baseLogContext, event: 'cache_context_get_or_create_start' }, "Getting or creating context cache");

        const cachedInMemory = this.contextCaches.get(cacheKey);
        if (cachedInMemory?.name) {
            // BỔ SUNG EVENT (hoặc dùng lại cache_setup_use_success nếu đây là điểm quyết định)
            logger.info({ ...baseLogContext, cacheName: cachedInMemory.name, event: 'cache_context_hit_inmemory' }, "Reusing existing context cache object from in-memory map");
            return cachedInMemory;
        }

        let cachePromise = this.cachePromises.get(cacheKey);
        if (cachePromise) {
            logger.debug({ ...baseLogContext, event: 'cache_context_creation_in_progress_wait' }, "Cache creation already in progress, awaiting...");
            return await cachePromise;
        }

        cachePromise = (async (): Promise<CachedContent | null> => {
            if (!this.cacheManager) {
                // SỬA EVENT (rõ ràng hơn)
                logger.error({ ...baseLogContext, event: 'cache_context_setup_failed_no_manager' }, "CacheManager not available. Cannot create or retrieve cache context.");
                return null;
            }
            const manager = this.cacheManager;

            try {
                const knownCacheName = this.persistentCacheNameMap.get(cacheKey);
                if (knownCacheName) {
                    const retrievalContext = { ...baseLogContext, cacheName: knownCacheName, event_group: "persistent_retrieval" };
                    // BỔ SUNG EVENT
                    logger.debug({ ...retrievalContext, event: 'cache_context_retrieval_attempt' }, "Found cache name in persistent map, attempting retrieval");
                    try {
                        const retrievedCache = await manager.get(knownCacheName);
                        if (retrievedCache?.name) {
                            // SỬA EVENT (rõ ràng hơn)
                            logger.info({ ...retrievalContext, event: 'cache_context_retrieval_success', retrievedModel: retrievedCache.model }, "Successfully retrieved cache context from manager");
                            this.contextCaches.set(cacheKey, retrievedCache);
                            return retrievedCache;
                        } else {
                            // SỬA EVENT (rõ ràng hơn)
                            logger.warn({ ...retrievalContext, event: 'cache_context_retrieval_failed_not_found_in_manager' }, "Cache name found in map, but retrieval from manager failed (not found). Removing local entry.");
                            await this.removePersistentCacheEntry(cacheKey, logger);
                        }
                    } catch (retrievalError: unknown) {
                        const errorDetails = retrievalError instanceof Error ? { name: retrievalError.name, message: retrievalError.message } : { details: String(retrievalError) };
                        // SỬA EVENT (rõ ràng hơn)
                        logger.error({ ...retrievalContext, err: errorDetails, event: 'cache_context_retrieval_failed_exception' }, "Error retrieving cache context from manager. Proceeding to create new cache.");
                        await this.removePersistentCacheEntry(cacheKey, logger);
                    }
                } else {
                    logger.debug({ ...baseLogContext, event: 'cache_context_persistent_miss' }, "Cache context name not found in persistent map.");
                }


                // 5. Double-check in-memory cache after potential persistent check delay
                const doubleCheckCachedInMemory = this.contextCaches.get(cacheKey);
                if (doubleCheckCachedInMemory?.name) {
                    logger.info({ ...baseLogContext, cacheName: doubleCheckCachedInMemory.name, event: 'cache_reuse_in_memory_double_check' }, "Reusing in-memory cache found after lock acquisition");
                    return doubleCheckCachedInMemory;
                }

                // --- Create New Cache ---
                const createContext = { ...baseLogContext, event_group: "cache_creation" };
                logger.info({ ...baseLogContext, event_group: "cache_creation", event: 'cache_context_create_attempt' }, "Attempting to create NEW context cache");

                // Use the base model name for the API, potentially prefixed
                const modelForCacheApi = `models/${modelName}`; // Assuming prefix is needed

                try {
                    const systemInstructionContent: Part[] = systemInstructionText ? [{ text: systemInstructionText }] : [];
                    const contentToCache: Content[] = [];
                    // Ensure fewShotParts are only added if they exist and have content
                    if (fewShotParts && fewShotParts.length > 0) {
                        for (let i = 0; i < fewShotParts.length; i += 2) {
                            if (fewShotParts[i]?.text) contentToCache.push({ role: 'user', parts: [fewShotParts[i]] });
                            if (fewShotParts[i + 1]?.text) contentToCache.push({ role: 'model', parts: [fewShotParts[i + 1]] });
                        }
                    }

                    // Make displayName more descriptive
                    const displayName = `cache-${apiType}-${modelName}-${Date.now()}`;

                    logger.debug({
                        ...createContext, modelForCache: modelForCacheApi, displayName,
                        hasSystemInstruction: !!systemInstructionText, contentToCacheCount: contentToCache.length,
                        event: 'cache_create_details'
                    }, "Cache creation details");

                    // Ensure systemInstruction is only included if text exists
                    const cacheCreateParams: any = { // Use 'any' or a more specific type from the SDK if available
                        model: modelForCacheApi,
                        contents: contentToCache,
                        displayName: displayName,
                        // ttl: { seconds: 60 * 60 * 24 } // Example TTL, configure if needed
                    };
                    if (systemInstructionContent.length > 0) {
                        cacheCreateParams.systemInstruction = { role: "system", parts: systemInstructionContent };
                    }

                    const createdCache = await manager.create(cacheCreateParams);

                    if (!createdCache?.name) {
                        // SỬA EVENT (từ cache_create_failed_invalid_object thành cache_context_create_failed_invalid_response)
                        logger.error({ ...baseLogContext, modelForCache: modelForCacheApi, createdCacheObject: createdCache, event: 'cache_context_create_failed_invalid_response' }, "Failed to create context cache: Invalid cache object returned by manager.create");
                        return null;
                    }
                    // SỬA EVENT (từ cache_create_success thành cache_context_create_success)
                    logger.info({ ...baseLogContext, cacheName: createdCache.name, model: createdCache.model, event: 'cache_context_create_success' }, "Context cache created successfully");
                    this.contextCaches.set(cacheKey, createdCache);
                    this.persistentCacheNameMap.set(cacheKey, createdCache.name);
                    await this.saveCacheNameMap(logger);
                    return createdCache;
                } catch (cacheError: unknown) {
                    const errorDetails = cacheError instanceof Error ? { name: cacheError.name, message: cacheError.message } : { details: String(cacheError) };
                    // SỬA EVENT (từ cache_create_failed thành cache_context_create_failed)
                    logger.error({ ...baseLogContext, err: errorDetails, event: 'cache_context_create_failed' }, "Failed to create NEW context cache");
                    if (errorDetails.message?.includes("invalid model") || errorDetails.message?.includes("model not found")) {
                        // SỬA EVENT (từ cache_create_invalid_model_error thành cache_context_create_failed_invalid_model)
                        logger.error({ ...baseLogContext, modelForCache: modelForCacheApi, event: 'cache_context_create_failed_invalid_model' }, "Ensure model name is correct for caching API.");
                    } else if (errorDetails.message?.includes("permission denied")) {
                        // BỔ SUNG EVENT
                        logger.error({ ...baseLogContext, event: 'cache_context_create_failed_permission' }, "Permission denied during cache creation.");
                    }
                    return null;
                }
            } catch (outerError: unknown) {
                const errorDetails = outerError instanceof Error ? { name: outerError.name, message: outerError.message } : { details: String(outerError) };
                // SỬA EVENT (từ cache_logic_outer_exception thành cache_context_logic_unhandled_error)
                logger.error({ ...baseLogContext, err: errorDetails, event: 'cache_context_logic_unhandled_error' }, "Unhandled exception during cache get/create logic");
                return null;
            } finally {
                this.cachePromises.delete(cacheKey);
                logger.debug({ ...baseLogContext, event: 'cache_context_promise_deleted' }, "Removed cache creation promise.");
            }
        })();
        this.cachePromises.set(cacheKey, cachePromise);
        logger.debug({ ...baseLogContext, event: 'cache_context_promise_set' }, "Cache creation promise stored.");
        return await cachePromise;
    }


    // --- Execute with Retry Logic (Private method) ---
    private async executeWithRetry(
        fn: RetryableFunction,
        apiType: string,
        batchIndex: number,
        modelName: string,
        modelRateLimiter: RateLimiterMemory,
        logger: Logger
    ): Promise<ApiResponse> {
        this.ensureInitialized(logger);
        const cacheKey = `${apiType}-${modelName}`; // Vẫn giữ cacheKey để dùng cho cache invalidation
        const baseLogContext = { apiType, batchIndex, modelName, function: 'executeWithRetry' };
        logger.debug({ ...baseLogContext, event: 'retry_loop_start' }, "Executing with retry");

        let retryCount = 0;
        let currentDelay = this.initialDelayMs;
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        while (retryCount < this.maxRetries) {
            const attempt = retryCount + 1;
            // BỔ SUNG apiType, modelName vào attemptLogContext để retry_attempt_start có thể lấy
            const attemptLogContext = { ...baseLogContext, attempt, maxAttempts: this.maxRetries, apiType, modelName };
            // SỬA EVENT (từ retry_attempt_start thành retry_attempt) để handler RetryAttemptStart xử lý
            logger.info({ ...attemptLogContext, event: 'retry_attempt_start' }, "Executing function attempt");

            try {
                return await fn(modelRateLimiter, logger);
            } catch (error: unknown) {
                let shouldRetry = true;
                let invalidateCache = false;
                const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
                const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
                let errorEvent = 'retry_attempt_error_unknown'; // Default error event type

                // Check internal rate limiter error first
                if (error instanceof RateLimiterRes) {
                    const waitTimeMs = error.msBeforeNext;
                    logger.warn({ ...attemptLogContext, waitTimeMs, event: 'retry_internal_rate_limit_wait' }, `Internal rate limit exceeded. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                    // Important: 'continue' skips retryCount increment and delay logic
                    continue;
                }

                // Handle specific Gemini/other errors
                if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                    errorEvent = 'retry_attempt_error_cache';
                    logger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Cache related error detected. Invalidating cache reference and retrying.");
                    invalidateCache = true; // Mark for invalidation below
                } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted') || errorMessageLower.includes('rate limit')) {
                    errorEvent = 'retry_attempt_error_429';
                    logger.warn({ ...attemptLogContext, status: 429, err: errorDetails, event: errorEvent }, "429/Resource Exhausted/Rate Limit Error from API. Retrying...");
                    // Keep shouldRetry = true
                } else if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                    errorEvent = 'retry_attempt_error_5xx';
                    logger.warn({ ...attemptLogContext, status: 500, err: errorDetails, event: errorEvent }, "5xx/Server Error from API. Retrying...");
                    // Keep shouldRetry = true
                } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                    errorEvent = 'retry_attempt_error_safety_blocked';
                    logger.error({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Request blocked by safety settings. No further retries.");
                    shouldRetry = false; // Do not retry safety blocks
                } else {
                    // Keep default errorEvent = 'retry_attempt_error_unknown'
                    logger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Unhandled/other error during execution attempt. Retrying...");
                    // Keep shouldRetry = true (default assumption for unknown errors)
                }

                // Quan trọng: event 'retry_cache_invalidate' phải được log khi cache bị invalidate trong vòng lặp này
                if (invalidateCache) { // invalidateCache được set trong logic phía trên
                    // BỔ SUNG THÊM CONTEXT CHO LOG CACHE INVALIDATE
                    logger.info({ ...attemptLogContext, cacheKeyToInvalidate: cacheKey, event: 'retry_cache_invalidate' }, "Removing cache entry due to error during retry.");
                    this.contextCaches.delete(cacheKey);
                    await this.removePersistentCacheEntry(cacheKey, logger);
                }


                // Increment retry count *after* handling the error type
                retryCount++;
                const isLastAttempt = retryCount >= this.maxRetries;

                // Check if we should stop retrying
                if (!shouldRetry) {
                    logger.error({ ...attemptLogContext, finalError: errorDetails, event: 'retry_abort_non_retryable' }, "Non-retryable error encountered. Aborting retries.");
                    return defaultResponse; // Return default on non-retryable error
                }

                if (isLastAttempt) {
                    logger.error({ ...attemptLogContext, maxRetries: this.maxRetries, finalError: errorDetails, event: 'retry_failed_max_retries' }, `Failed to process after maximum retries.`);
                    return defaultResponse; // Return default after max retries
                }

                // Calculate delay with exponential backoff and jitter
                const jitter = Math.random() * 500; // Adds 0-500ms jitter
                const delayWithJitter = Math.max(0, currentDelay + jitter); // Ensure delay isn't negative
                logger.info({ ...attemptLogContext, nextAttempt: retryCount + 1, delaySeconds: (delayWithJitter / 1000).toFixed(2), event: 'retry_wait_before_next' }, `Waiting before next retry...`);

                await new Promise(resolve => setTimeout(resolve, delayWithJitter));

                // Increase delay for next potential retry (exponential backoff)
                currentDelay = Math.min(currentDelay * 2, this.maxDelayMs); // Use configured max delay

            } // End catch block
        } // End while loop

        // Fallback return
        logger.error({ ...baseLogContext, event: 'retry_loop_exit_unexpected' }, "Exited retry loop unexpectedly.");
        return defaultResponse;
    }


    // --- Core Gemini API Call Function (Private method) ---
    private async callGeminiAPI(
        params: InternalCallGeminiApiParams,
        logger: Logger
    ): Promise<ApiResponse> {
        this.ensureInitialized(logger);
        const { batch, batchIndex, title, acronym, apiType, modelName, generationConfig, fewShotParts, useCache } = params;
        // BỔ SUNG apiType, modelName, title, acronym vào baseLogContext cho gemini_call_start
        const baseLogContext = { apiType, batchIndex, modelName, title: title || 'N/A', acronym: acronym || 'N/A', function: 'callGeminiAPI' };
        // Event 'gemini_call_start' đã có context tốt.
        logger.info({ ...baseLogContext, event: 'gemini_call_start' }, "Preparing Gemini API call");
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        let modelRateLimiter: RateLimiterMemory;
        try {
            modelRateLimiter = this.getRateLimiterForModel(modelName); // Use internal method
        } catch (limiterError: unknown) {
            const errorDetails = limiterError instanceof Error ? { name: limiterError.name, message: limiterError.message } : { details: String(limiterError) };
            logger.error({ ...baseLogContext, err: errorDetails, event: 'gemini_call_limiter_init_failed' }, "Failed to get or create rate limiter. Aborting API call.");
            return defaultResponse;
        }

        // Get the specific config for this API type from the pre-loaded configs
        const apiConfig = this.apiConfigs[apiType];
        if (!apiConfig) {
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found.`);
            return defaultResponse;
        }
        const systemInstructionText = apiConfig.systemInstruction || ""; // Get instruction from loaded config

        // Setup Model (Cached or Non-Cached)
        let model: GenerativeModel | undefined;
        let contentRequest: GenerateContentRequest | string;
        let usingCacheActual = false; // Đổi tên để phân biệt với param `useCache`
        let currentCache: CachedContent | null = null;
        const cacheIdentifier = `${apiType}-${modelName}`;


        if (useCache) {
            const cacheSetupContext = { ...baseLogContext, cacheIdentifier, event_group: 'cache_setup' };
            logger.debug({ ...cacheSetupContext, event: 'cache_context_attempt_setup_for_call' }, "Attempting to get or create cache for API call");
            try {
                currentCache = await this.getOrCreateContextCache(apiType, modelName, systemInstructionText, fewShotParts, logger);
            } catch (cacheSetupError: unknown) {
                const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
                // SỬA EVENT (từ cache_setup_get_or_create_failed thành một event cụ thể hơn cho call setup)
                logger.error({ ...cacheSetupContext, err: errorDetails, event: 'gemini_call_cache_setup_failed' }, "Critical error during cache setup for call, proceeding without cache");
                currentCache = null;
            }

            if (currentCache?.name) {
                // BỔ SUNG CONTEXT CHO EVENT NÀY
                logger.info({ ...cacheSetupContext, cacheName: currentCache.name, apiType, modelName, event: 'cache_setup_use_success' }, "Attempting to use cached context object for call");
                try {
                    model = this.genAI!.getGenerativeModelFromCachedContent(currentCache);
                    contentRequest = batch;
                    usingCacheActual = true;
                    logger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_model_from_cache_success' }, "Using cached context model");
                } catch (getModelError: unknown) {
                    const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                    // SỬA EVENT (từ cache_setup_getmodel_failed thành một event cụ thể hơn)
                    logger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'gemini_call_model_from_cache_failed' }, "Error getting model from cached content, falling back to non-cached");
                    this.contextCaches.delete(cacheIdentifier); // Invalidate in-memory
                    await this.removePersistentCacheEntry(cacheIdentifier, logger); // Invalidate persistent
                    currentCache = null;
                    usingCacheActual = false;
                }
            } else {
                logger.info({ ...cacheSetupContext, event: 'gemini_call_no_cache_available' }, "No valid cache object found or created for call, proceeding without cache.");
                usingCacheActual = false;
            }
        }

        // --- Non-Cached Model Setup ---
        if (!usingCacheActual) {
            const nonCachedSetupContext = { ...baseLogContext, event_group: 'non_cached_setup' };
            if (useCache) { // Log only if fallback occurred
                logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_fallback' }, "Proceeding without cache (setup failed or no cache found).");
            } else {
                logger.debug({ ...nonCachedSetupContext, event: 'non_cached_setup_normal' }, "Setting up non-cached model.");
            }
            try {
                // genAI checked by ensureInitialized()
                const modelConfig: { model: string, systemInstruction?: Content } = {
                    model: modelName, // Use the passed modelName
                };
                // Use systemInstructionText derived from config
                if (systemInstructionText) {
                    modelConfig.systemInstruction = { role: "system", parts: [{ text: systemInstructionText }] };
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_using_system_instruction' }, "Model configured WITH system instruction.");
                } else {
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_skipping_system_instruction' }, "Model configured WITHOUT system instruction.");
                }
                model = this.genAI!.getGenerativeModel(modelConfig);

                // Check if fewShotParts were provided (caller decides this based on config)
                if (fewShotParts.length > 0) {
                    const history: Content[] = [];
                    // Rebuild history from provided parts
                    for (let i = 0; i < fewShotParts.length; i += 2) {
                        if (fewShotParts[i]) history.push({ role: "user", parts: [fewShotParts[i]] });
                        if (fewShotParts[i + 1]) history.push({ role: "model", parts: [fewShotParts[i + 1]] });
                    }
                    history.push({ role: "user", parts: [{ text: batch }] }); // Add current batch
                    contentRequest = {
                        contents: history,
                        generationConfig: generationConfig, // Use passed generationConfig
                    };
                    logger.info({ ...nonCachedSetupContext, historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Using non-cached model with history");
                } else {
                    contentRequest = batch; // Simple request if no few-shots
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_request_simple' }, "Using simple non-cached model request");
                }
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                logger.error({ ...nonCachedSetupContext, generationModelName: modelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
                return defaultResponse;
            }
        } // End non-cached setup

        // --- Call API with Retry Logic ---
        return this.executeWithRetry(
            async (limiter): Promise<ApiResponse> => {
                // BỔ SUNG CONTEXT cho callAttemptContext
                const callAttemptContext = { ...baseLogContext, usingCache: usingCacheActual, cacheName: usingCacheActual ? currentCache?.name : 'N/A', event_group: 'gemini_api_attempt' };
                if (!model) {
                    // SỬA EVENT (cho rõ ràng hơn)
                    logger.error({ ...callAttemptContext, event: 'gemini_api_model_missing_before_generate' }, "Model object is undefined before calling generateContent.");
                    throw new Error("Model is not initialized for generateContent");
                }

                // Use rate limiter passed from executeWithRetry
                const rateLimitKey = `${apiType}_${batchIndex}_${modelName}`; // Unique key per attempt/model
                logger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points`);
                try {
                    await limiter.consume(rateLimitKey, 1); // Consume point
                    logger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed. Sending request...`);
                } catch (limiterError: unknown) {
                    logger.warn({ ...callAttemptContext, event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed.`);
                    throw limiterError; // Propagate to retry logic
                }

                let result: GenerateContentResult;
                try {
                    logger.info({ ...callAttemptContext, requestType: typeof contentRequest === 'string' ? 'string' : 'object', event: 'gemini_api_generate_start' }, "Calling model.generateContent");
                    result = await model.generateContent(contentRequest);
                    logger.info({ ...callAttemptContext, event: 'gemini_api_generate_success' }, "model.generateContent successful");
                } catch (generateContentError: unknown) {
                    const errorDetails = generateContentError instanceof Error ? { name: generateContentError.name, message: generateContentError.message } : { details: String(generateContentError) };
                    // SỬA EVENT (cho rõ hơn)
                    logger.error({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_generate_content_failed' }, "Error during model.generateContent");
                    throw generateContentError;
                }

                // --- Process Response ---
                const response = result?.response;
                const feedback = response?.promptFeedback;
                if (!response) {
                    logger.warn({ ...callAttemptContext, feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing response object.");
                    if (feedback?.blockReason) {
                        logger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings");
                        throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`); // Propagate
                    }
                    throw new Error("Empty or invalid response object from Gemini API."); // Propagate
                }
                if (feedback?.blockReason) {
                    logger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings (found in feedback)");
                    throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`); // Propagate
                }

                let responseText = "";
                try {
                    responseText = response.text(); // Preferred method
                    logger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_success' }, "Extracted text using response.text()");
                } catch (textError: unknown) {
                    // Fallback if response.text() fails (might happen with complex responses/errors)
                    const errorDetails = textError instanceof Error ? { name: textError.name, message: textError.message } : { details: String(textError) };
                    logger.warn({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_text_extract_failed' }, "Response.text() accessor failed, trying fallback.");
                    responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                    if (!responseText) {
                        logger.error({ ...callAttemptContext, responseStructure: JSON.stringify(response)?.substring(0, 500), event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback.");
                        // Consider throwing an error here if text is absolutely required
                        // throw new Error("Failed to extract text content from response.");
                    } else {
                        logger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_fallback_success' }, "Extracted text using fallback");
                    }
                }

                const metaData = response.usageMetadata ?? null;

                // --- Write Response to File (Async, Fire-and-Forget) ---
                const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
                // Use configured output dir
                const responseOutputPath = path.join(this.responseOutputDir, `result_${apiType}_${safeAcronym}_${batchIndex}.txt`);
                const fileLogContext = { ...callAttemptContext, filePath: responseOutputPath, event_group: 'response_file_write' };

                (async () => {
                    const fileWriteLogger = logger.child({ sub_operation: 'response_file_write_async' }); // Tạo child logger cho tác vụ async

                    try {
                        // Use configured output dir
                        if (!existsSync(this.responseOutputDir)) {
                            await fsPromises.mkdir(this.responseOutputDir, { recursive: true });
                            logger.info({ directory: this.responseOutputDir, event: 'response_dir_created' }, "Created response output directory");
                        }
                        fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Writing response to file");
                        await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8"); // Write even if empty
                        logger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file");
                    } catch (fileWriteError: unknown) {
                        const errorDetails = fileWriteError instanceof Error ? { name: fileWriteError.name, message: fileWriteError.message } : { details: String(fileWriteError) };
                        fileWriteLogger.error({ ...fileLogContext, err: errorDetails, event: 'response_file_write_failed' }, "Error writing response to file");
                    }
                })(); // End async file write

                // BỔ SUNG THÊM CONTEXT CHO EVENT THÀNH CÔNG
                logger.info({ ...callAttemptContext, responseLength: responseText.length, metaData, tokens: metaData?.totalTokenCount, apiType, modelName, usingCache: usingCacheActual, event: 'gemini_api_attempt_success' }, "Gemini API request processed successfully for this attempt.");
                return { responseText, metaData };
            }, apiType, batchIndex, modelName, modelRateLimiter, logger);
        
    }

    // --- Helper to Prepare Few-Shot Parts ---
    private prepareFewShotParts(apiType: string, apiConfig: GeminiApiConfig, logger: Logger): Part[] { // Nhận logger
        const fewShotParts: Part[] = [];
        const fewShotContext = { apiType, function: 'prepareFewShotParts' };

        if (!apiConfig.inputs || !apiConfig.outputs) {
            logger.debug({ ...fewShotContext, event: 'few_shot_prep_skipped_no_data' }, "Skipping few-shot parts: No inputs/outputs found in config."); // Sử dụng logger
            return fewShotParts;
        }
        logger.debug({ ...fewShotContext, event: 'few_shot_prep_start' }, "Preparing few-shot parts from config");
        try {
            const inputs = apiConfig.inputs;
            const outputs = apiConfig.outputs;
            // Ensure inputs/outputs are paired correctly based on keys
            Object.keys(inputs).forEach((inputKey) => {
                const outputKey = inputKey; // Assuming keys match directly now
                const inputValue = inputs[inputKey];
                const outputValue = outputs[outputKey]; // Find corresponding output

                if (inputValue) {
                    fewShotParts.push({ text: inputValue });
                } else {
                    logger.warn({ ...fewShotContext, inputKey, event: 'few_shot_prep_missing_input_value' }, "Input key found but value is empty/missing.")
                }

                if (outputValue) {
                    fewShotParts.push({ text: outputValue });
                } else {
                    // It's possible for a model response (output) to be empty, might not be a warning.
                    logger.trace({ ...fewShotContext, inputKey, outputKey, event: 'few_shot_prep_missing_output_value' }, "Output value not found or empty for corresponding input.")
                    // Still add an empty model part if input exists? Depends on Gemini requirements.
                    // For safety, only add if outputValue exists:
                    // fewShotParts.push({ text: "" }); // Or skip if outputValue is missing/empty
                }
            });

            if (fewShotParts.length === 0) {
                logger.warn({ ...fewShotContext, event: 'few_shot_prep_empty_result' }, "Few-shot inputs/outputs processed, but resulted in empty parts array.");
            } else {
                logger.debug({ ...fewShotContext, fewShotPairCount: fewShotParts.length / 2, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
            }
        } catch (fewShotError: unknown) {
            const errorDetails = fewShotError instanceof Error ? { name: fewShotError.name, message: fewShotError.message } : { details: String(fewShotError) };
            logger.error({ ...fewShotContext, err: errorDetails, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Returning empty array.");
            fewShotParts.length = 0; // Clear array on error
        }
        return fewShotParts;
    }


    // --- Public API Methods ---

    public async extractInformation(params: GeminiApiParams, parentLogger?: Logger): Promise<ApiResponse> {
        const logger = this.getMethodLogger(parentLogger, 'extractInformation', { acronym: params.acronym, batchIndex: params.batchIndex });
        this.ensureInitialized(logger);
        const apiType = this.API_TYPE_EXTRACT;
        const config = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };
        const baseLogContext = { apiType, batchIndex: params.batchIndex, title: params.title || 'N/A', acronym: params.acronym || 'N/A', function: 'extractInformation' };

        if (!config) {
            // ĐÃ BỔ SUNG EVENT TRONG PHIÊN BẢN TRƯỚC:
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found.`);
            return defaultResponse;
        }
        const modelNames = config.modelNames;
        if (!modelNames || modelNames.length === 0) {
            // BỔ SUNG EVENT (hoặc gộp chung với missing_apiconfig nếu coi đây là một dạng thiếu config)
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_model_config', detail: `No model names configured for API type '${apiType}'.` }, "No model names configured for API type.");
            return defaultResponse;
        }

        const selectedModelName = modelNames[this.extractModelIndex];
        const nextIndex = (this.extractModelIndex + 1) % modelNames.length;
        logger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating API call (round-robin)");
        this.extractModelIndex = nextIndex;

        const useFewShotExamples = false;
        const useCache = false;
        const fewShotParts = useFewShotExamples ? this.prepareFewShotParts(apiType, config, logger) : [];

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                ...params,
                apiType,
                modelName: selectedModelName,
                generationConfig: config.generationConfig,
                fewShotParts: fewShotParts,
                useCache: useCache,
            }, logger);

            // JSON Cleaning Logic
            const firstCurly = responseText.indexOf('{');
            const lastCurly = responseText.lastIndexOf('}');
            let cleanedResponseText = "";
            const cleaningLogContext = { ...baseLogContext, modelUsed: selectedModelName };
            if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
                const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
                try {
                    JSON.parse(potentialJson);
                    cleanedResponseText = potentialJson.trim();
                    logger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
                } catch (parseError: unknown) {
                    const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                    logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                    cleanedResponseText = "";
                }
            } else {
                logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
                cleanedResponseText = "";
            }

            // Log thông tin khi hoàn thành, có thể bổ sung modelUsed
            logger.info({ ...baseLogContext, modelUsed: selectedModelName, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, "extractInformation API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            // Lỗi này bắt các exception không mong muốn thoát ra từ callGeminiAPI hoặc logic cleaning
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // ĐÃ BỔ SUNG EVENT TRONG PHIÊN BẢN TRƯỚC:
            logger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, "Unhandled error in public method extractInformation");
            return defaultResponse;
        }
    }

    public async extractCfp(params: GeminiApiParams, parentLogger?: Logger): Promise<ApiResponse> {
        const logger = this.getMethodLogger(parentLogger, 'extractCfp', { acronym: params.acronym, batchIndex: params.batchIndex });
        this.ensureInitialized(logger);
        const apiType = this.API_TYPE_CFP;
        const config = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };
        const baseLogContext = { apiType, batchIndex: params.batchIndex, title: params.title || 'N/A', acronym: params.acronym || 'N/A', function: 'extractCfp' };

        if (!config) {
            // BỔ SUNG EVENT
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found for CFP.`);
            return defaultResponse;
        }
        const modelNames = config.modelNames;
        if (!modelNames || modelNames.length === 0) {
            // BỔ SUNG EVENT
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_model_config', detail: `No model names configured for API type '${apiType}' (CFP).` }, "No model names configured for CFP.");
            return defaultResponse;
        }

        const selectedModelName = modelNames[this.cfpModelIndex];
        const nextIndex = (this.cfpModelIndex + 1) % modelNames.length;
        logger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating CFP API call (round-robin)");
        this.cfpModelIndex = nextIndex;

        const useFewShotExamples = true;
        const useCache = false;
        const fewShotParts = useFewShotExamples ? this.prepareFewShotParts(apiType, config, logger) : [];

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                ...params,
                apiType,
                modelName: selectedModelName,
                generationConfig: config.generationConfig,
                fewShotParts: fewShotParts,
                useCache: useCache,
            }, logger);

            // JSON Cleaning Logic
            const firstCurly = responseText.indexOf('{');
            const lastCurly = responseText.lastIndexOf('}');
            let cleanedResponseText = "";
            // Thêm modelUsed vào cleaningLogContext để dễ debug
            const cleaningLogContext = { ...baseLogContext, modelUsed: selectedModelName };
            if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
                const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
                try {
                    JSON.parse(potentialJson);
                    cleanedResponseText = potentialJson.trim();
                    logger.debug({ ...cleaningLogContext, event: 'json_clean_success' }, "Successfully cleaned and validated JSON response for CFP.");
                } catch (parseError: unknown) {
                    const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                    // BỔ SUNG EVENT CHO LỖI PARSE JSON
                    logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails, event: 'json_clean_parse_failed' }, "Failed to parse CFP extracted text as JSON after cleaning, returning empty string.");
                    cleanedResponseText = ""; // Hoặc có thể throw lỗi nếu JSON là bắt buộc
                }
            } else {
                // BỔ SUNG EVENT CHO LỖI KHÔNG TÌM THẤY JSON
                logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_structure_not_found' }, "Could not find valid JSON structure ({...}) in CFP response, returning empty string.");
                cleanedResponseText = "";
            }

            // BỔ SUNG EVENT
            logger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, "extractCfp API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // BỔ SUNG EVENT
            logger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, "Unhandled error in public method extractCfp");
            return defaultResponse;
        }
    }

    public async determineLinks(params: GeminiApiParams, parentLogger?: Logger): Promise<ApiResponse> {
        const logger = this.getMethodLogger(parentLogger, 'determineLinks', { acronym: params.acronym, batchIndex: params.batchIndex });
        this.ensureInitialized(logger);
        const apiType = this.API_TYPE_DETERMINE;
        const config = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };
        const baseLogContext = { apiType, batchIndex: params.batchIndex, title: params.title || 'N/A', acronym: params.acronym || 'N/A', function: 'determineLinks' };

        if (!config) {
            // BỔ SUNG EVENT
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found for determineLinks.`);
            return defaultResponse;
        }
        const modelName = config.modelName; // Determine API thường dùng 1 model
        if (!modelName) {
            // BỔ SUNG EVENT
            logger.error({ ...baseLogContext, event: 'gemini_call_missing_model_config', detail: `No model name configured for API type '${apiType}' (determineLinks).` }, "No model name configured for determineLinks.");
            return defaultResponse;
        }

        const useFewShotExamples = false;
        const useCache = false;
        const fewShotParts = useFewShotExamples ? this.prepareFewShotParts(apiType, config, logger) : [];

        const logContextWithModel = { ...baseLogContext, modelName }; // Dùng modelName cụ thể
        logger.debug(logContextWithModel, "Initiating determineLinks API call"); // Giữ nguyên, không cần event riêng cho debug

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                ...params,
                apiType,
                modelName: modelName,
                generationConfig: config.generationConfig,
                fewShotParts: fewShotParts,
                useCache: useCache,
            }, logger);

            // JSON Cleaning Logic
            const firstCurly = responseText.indexOf('{');
            const lastCurly = responseText.lastIndexOf('}');
            let cleanedResponseText = "";
            const cleaningLogContext = { ...logContextWithModel }; // Đã có modelName
            if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
                const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
                try {
                    JSON.parse(potentialJson);
                    cleanedResponseText = potentialJson.trim();
                    logger.debug({ ...cleaningLogContext, event: 'json_clean_success' }, "Successfully cleaned and validated JSON response for determineLinks.");
                } catch (parseError: unknown) {
                    const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                    // BỔ SUNG EVENT CHO LỖI PARSE JSON
                    logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails, event: 'json_clean_parse_failed' }, "Failed to parse determineLinks extracted text as JSON after cleaning, returning empty string.");
                    cleanedResponseText = "";
                }
            } else {
                // BỔ SUNG EVENT CHO LỖI KHÔNG TÌM THẤY JSON
                logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_structure_not_found' }, "Could not find valid JSON structure ({...}) in determineLinks response, returning empty string.");
                cleanedResponseText = "";
            }

            // BỔ SUNG EVENT
            logger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, "determineLinks API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // BỔ SUNG EVENT
            logger.error({ ...logContextWithModel, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, "Unhandled error in public method determineLinks");
            return defaultResponse;
        }
    }

} // End GeminiApiService class