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
type RetryableFunction = (limiter: RateLimiterMemory) => Promise<ApiResponse>;

// Interface for parameters passed to internal callGeminiAPI method
interface InternalCallGeminiApiParams {
    batch: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
    apiType: string;
    // systemInstruction is derived internally from config
    modelName: string;
    generationConfig: SDKGenerationConfig | undefined; // Use renamed SDK type
    // parentLogger is removed, will use this.logger
    fewShotParts: Part[]; // Pass prepared parts
    useCache: boolean; // Pass determined cache usage
}

// Interface for parameters passed to public API methods
export interface GeminiApiParams {
    batch: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
    // parentLogger is removed
}


@singleton()
export class GeminiApiService {
    private readonly logger: Logger;
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
    private serviceInitialized: boolean = false; // Flag to track initialization


    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.configService = configService; // Store injected service
        this.logger = loggingService.getLogger({ service: 'GeminiApiService' });

        this.logger.info("Constructing GeminiApiService...");

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

        this.logger.info(`Response Output Dir: ${this.responseOutputDir}`);
        this.logger.info(`Cache Map Path: ${this.cacheMapFilePath}`);

        // --- Initialize Google Generative AI ---
        try {
            if (!this.geminiApiKey) {
                throw new Error("GEMINI_API_KEY is missing in configuration.");
            }
            this.genAI = new GoogleGenerativeAI(this.geminiApiKey);
            this.logger.info("GoogleGenerativeAI initialized successfully.");
            // Initialize Cache Manager after GenAI
            this.initializeCacheManager();
        } catch (initError: unknown) {
            const errorDetails = initError instanceof Error ? { name: initError.name, message: initError.message, stack: initError.stack } : { details: String(initError) };
            this.logger.fatal({ err: errorDetails }, "Failed to initialize GoogleGenerativeAI. Gemini API calls will likely fail.");
            // Consider throwing the error to halt application startup if GenAI is critical
            // throw initError;
        }

        // Initialization status is false until init() is called
    }

    // --- Initialization Method (Call after resolving the service and after ConfigService init) ---
    public async init(): Promise<void> {
        if (this.serviceInitialized) {
            this.logger.debug("GeminiApiService already initialized.");
            return;
        }
        // Ensure ConfigService examples are loaded *before* Gemini service loads its cache map
        // The calling code should await configService.initializeExamples() first.
        this.logger.info("Running async initialization for GeminiApiService...");
        await this.loadCacheNameMap();
        this.serviceInitialized = true; // Mark as initialized
        this.logger.info("GeminiApiService async initialization complete.");
    }

    private ensureInitialized(): void {
        if (!this.serviceInitialized) {
            const errorMsg = "GeminiApiService is not initialized. Call init() after resolving the service.";
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
        if (!this.genAI) {
            const errorMsg = "GoogleGenerativeAI failed to initialize. Cannot proceed.";
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    // --- Cache Name Map File I/O Functions (Private methods) ---
    private async loadCacheNameMap(): Promise<void> {
        const logContext = { filePath: this.cacheMapFilePath, function: 'loadCacheNameMap' };
        this.logger.info(logContext, "Attempting to load cache name map");
        try {
            // Ensure directory exists (using configured path)
            if (!existsSync(this.cacheMapDir)) {
                this.logger.warn({ ...logContext, directory: this.cacheMapDir }, "Cache map directory not found, creating");
                await fsPromises.mkdir(this.cacheMapDir, { recursive: true });
                this.logger.info({ ...logContext, directory: this.cacheMapDir }, "Cache map directory created");
            }
            // Check file existence
            if (!existsSync(this.cacheMapFilePath)) {
                this.logger.warn(logContext, "Cache map file not found. Starting with an empty map.");
                this.persistentCacheNameMap = new Map();
                return;
            }
            // Read and parse file
            const fileContent = await fsPromises.readFile(this.cacheMapFilePath, 'utf8');
            if (!fileContent.trim()) {
                this.logger.warn(logContext, "Cache map file is empty. Starting with an empty map.");
                this.persistentCacheNameMap = new Map();
                return;
            }
            const data: Record<string, string> = JSON.parse(fileContent);
            this.persistentCacheNameMap = new Map<string, string>(Object.entries(data));
            this.logger.info({ ...logContext, loadedCount: this.persistentCacheNameMap.size }, "Successfully loaded cache name entries from file");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.logger.error({ ...logContext, err: errorDetails, event: 'cache_load_failed' }, "Failed to load or parse cache name map. Starting with an empty map.");
            this.persistentCacheNameMap = new Map(); // Reset on error
        }
    }

    private async saveCacheNameMap(): Promise<void> {
        this.ensureInitialized(); // Ensure GenAI is available
        const logContext = { filePath: this.cacheMapFilePath, function: 'saveCacheNameMap' };
        this.logger.debug(logContext, "Attempting to save cache name map");
        try {
            // Ensure directory exists
            if (!existsSync(this.cacheMapDir)) {
                this.logger.info({ ...logContext, directory: this.cacheMapDir }, "Creating cache map directory before saving");
                await fsPromises.mkdir(this.cacheMapDir, { recursive: true });
            }
            // Save map content
            const dataToSave: Record<string, string> = Object.fromEntries(this.persistentCacheNameMap);
            const jsonString = JSON.stringify(dataToSave, null, 2);
            await fsPromises.writeFile(this.cacheMapFilePath, jsonString, 'utf8');
            this.logger.info({ ...logContext, savedCount: this.persistentCacheNameMap.size, event: 'cache_write_success' }, "Successfully saved cache name map to file");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.logger.error({ ...logContext, err: errorDetails, event: 'cache_write_failed' }, "Failed to save cache name map");
        }
    }

    private async removePersistentCacheEntry(cacheKey: string): Promise<void> {
        const logContext = { cacheKey, function: 'removePersistentCacheEntry' };
        if (this.persistentCacheNameMap.has(cacheKey)) {
            this.logger.warn(logContext, "Removing persistent cache entry");
            this.persistentCacheNameMap.delete(cacheKey);
            await this.saveCacheNameMap(); // Save immediately
        } else {
            this.logger.debug(logContext, "No persistent cache entry found to remove");
        }
        // Also remove from in-memory cache
        if (this.contextCaches.has(cacheKey)) {
            this.logger.warn({ ...logContext, source: 'in-memory' }, "Removing in-memory cache entry");
            this.contextCaches.delete(cacheKey);
        }
    }

    // --- Cache Manager Initialization (Private method) ---
    private initializeCacheManager(): void {
        const logContext = { function: 'initializeCacheManager' };
        if (!this.genAI) {
            // This case is handled in the constructor, but double-check
            this.logger.warn(logContext, "GoogleGenerativeAI not initialized, skipping CacheManager initialization.");
            return;
        }
        if (this.cacheManager) {
            this.logger.debug(logContext, "CacheManager already initialized.");
            return;
        }
        this.logger.info(logContext, "Initializing GoogleAICacheManager...");
        try {
            // Ensure API key is available (checked in constructor)
            if (!this.geminiApiKey) {
                throw new Error("Cannot initialize CacheManager without GEMINI_API_KEY");
            }

            // Always instantiate GoogleAICacheManager directly
            this.cacheManager = new GoogleAICacheManager(this.geminiApiKey);
            this.logger.info(logContext, "Initialized GoogleAICacheManager directly.");

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.logger.error({ ...logContext, err: errorDetails, event: 'cache_manager_create_failed' }, "Failed to initialize GoogleAICacheManager");
            this.cacheManager = null; // Ensure it's null on failure
        }
    }

    // --- Per-Model Rate Limiting Setup (Private method) ---
    private getRateLimiterForModel(modelName: string): RateLimiterMemory {
        const logContext = { modelName, function: 'getRateLimiterForModel' };
        if (!this.modelRateLimiters.has(modelName)) {
            this.logger.info(logContext, "Creating new rate limiter");
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
                    this.logger.error({ ...logContext, options: limiterOptions }, "Failed to create a valid rate limiter object");
                    throw new Error(`Failed to create valid rate limiter for ${modelName}`);
                }
                this.logger.debug({ ...logContext, options: limiterOptions }, "Rate limiter created successfully");
                this.modelRateLimiters.set(modelName, newLimiter);
            } catch (creationError: unknown) {
                const errorDetails = creationError instanceof Error ? { name: creationError.name, message: creationError.message } : { details: String(creationError) };
                this.logger.error({ ...logContext, err: errorDetails, options: limiterOptions }, "Exception during RateLimiterMemory creation");
                throw creationError; // Propagate error
            }
        }
        const limiterInstance = this.modelRateLimiters.get(modelName);
        // Add extra check after retrieval
        if (!limiterInstance || typeof limiterInstance.consume !== 'function') {
            this.logger.error(logContext, "Invalid limiter found in map or failed creation");
            // Attempt recreation once? Or just throw? Throw for now.
            throw new Error(`Retrieved invalid rate limiter from map for ${modelName}`);
        }
        this.logger.debug(logContext, "Retrieved existing rate limiter");
        return limiterInstance;
    }

    // --- Refactored Get Or Create Context Cache (Private method) ---
    private async getOrCreateContextCache(
        apiType: string,
        modelName: string,
        systemInstructionText: string,
        fewShotParts: Part[]
    ): Promise<CachedContent | null> {
        this.ensureInitialized(); // Check if service and GenAI are ready
        const cacheKey = `${apiType}-${modelName}`;
        const baseLogContext = { cacheKey, apiType, modelName, function: 'getOrCreateContextCache' };
        this.logger.debug({ ...baseLogContext, event: 'cache_get_or_create_start' }, "Getting or creating context cache");

        // 1. Check in-memory cache
        const cachedInMemory = this.contextCaches.get(cacheKey);
        if (cachedInMemory?.name) {
            this.logger.info({ ...baseLogContext, cacheName: cachedInMemory.name, event: 'cache_reuse_in_memory' }, "Reusing existing context cache object from in-memory map");
            return cachedInMemory;
        }

        // 2. Check if creation promise exists
        let cachePromise = this.cachePromises.get(cacheKey);
        if (cachePromise) {
            this.logger.debug({ ...baseLogContext, event: 'cache_creation_in_progress' }, "Cache creation already in progress, awaiting...");
            return await cachePromise;
        }

        // 3. Create new promise
        cachePromise = (async (): Promise<CachedContent | null> => {
            // Ensure CacheManager is initialized
            if (!this.cacheManager) {
                this.logger.error({ ...baseLogContext, event: 'cache_manager_unavailable_early' }, "CacheManager not available. Cannot create or retrieve cache.");
                return null; // Cannot proceed without cache manager
            }
            const manager = this.cacheManager; // Use the class property

            try {
                // 4. Check persistent storage
                const knownCacheName = this.persistentCacheNameMap.get(cacheKey);
                if (knownCacheName) {
                    const retrievalContext = { ...baseLogContext, cacheName: knownCacheName, event_group: "persistent_retrieval" };
                    this.logger.debug({ ...retrievalContext, event: 'cache_retrieval_start' }, "Found cache name in persistent map, attempting retrieval");
                    try {
                        const retrievedCache = await manager.get(knownCacheName);
                        if (retrievedCache?.name) { // Check if retrieval was successful
                            this.logger.info({ ...retrievalContext, event: 'cache_retrieval_success', retrievedModel: retrievedCache.model }, "Successfully retrieved cache from manager");
                            this.contextCaches.set(cacheKey, retrievedCache); // Store in memory
                            return retrievedCache;
                        } else {
                            // Cache name was known, but retrieval failed
                            this.logger.warn({ ...retrievalContext, event: 'cache_retrieval_failed_not_found' }, "Cache name found in map, but retrieval from manager failed. Removing local entry.");
                            await this.removePersistentCacheEntry(cacheKey); // Clean up stale entry
                        }
                    } catch (retrievalError: unknown) {
                        const errorDetails = retrievalError instanceof Error ? { name: retrievalError.name, message: retrievalError.message } : { details: String(retrievalError) };
                        this.logger.error({ ...retrievalContext, err: errorDetails, event: 'cache_retrieval_failed_exception' }, "Error retrieving cache from manager. Proceeding to create new cache.");
                        await this.removePersistentCacheEntry(cacheKey); // Clean up potentially problematic entry
                    }
                } else {
                    this.logger.debug({ ...baseLogContext, event: 'cache_persistent_miss' }, "Cache name not found in persistent map.");
                }

                // 5. Double-check in-memory cache after potential persistent check delay
                const doubleCheckCachedInMemory = this.contextCaches.get(cacheKey);
                if (doubleCheckCachedInMemory?.name) {
                    this.logger.info({ ...baseLogContext, cacheName: doubleCheckCachedInMemory.name, event: 'cache_reuse_in_memory_double_check' }, "Reusing in-memory cache found after lock acquisition");
                    return doubleCheckCachedInMemory;
                }

                // --- Create New Cache ---
                const createContext = { ...baseLogContext, event_group: "cache_creation" };
                this.logger.info({ ...createContext, event: 'cache_create_start' }, "Attempting to create NEW context cache");

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

                    this.logger.debug({
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
                        this.logger.error({ ...createContext, modelForCache: modelForCacheApi, createdCacheObject: createdCache, event: 'cache_create_failed_invalid_object' }, "Failed to create context cache: Invalid cache object returned by manager.create");
                        return null; // Return null on creation failure
                    }

                    this.logger.info({ ...createContext, cacheName: createdCache.name, model: createdCache.model, event: 'cache_create_success' }, "Context cache created successfully");

                    // Store using the composite key
                    this.contextCaches.set(cacheKey, createdCache);
                    this.persistentCacheNameMap.set(cacheKey, createdCache.name);
                    await this.saveCacheNameMap(); // Persist the new mapping

                    return createdCache;

                } catch (cacheError: unknown) {
                    const errorDetails = cacheError instanceof Error ? { name: cacheError.name, message: cacheError.message } : { details: String(cacheError) };
                    this.logger.error({ ...createContext, err: errorDetails, event: 'cache_create_failed' }, "Failed to create NEW context cache");
                    if (errorDetails.message?.includes("invalid model") || errorDetails.message?.includes("model not found")) {
                        this.logger.error({ ...createContext, modelForCache: modelForCacheApi, event: 'cache_create_invalid_model_error' }, "Ensure model name is correct for caching API (might require 'models/' prefix or specific version).");
                    } else if (errorDetails.message?.includes("permission denied")) {
                        this.logger.error({ ...createContext, event: 'cache_create_permission_error' }, "Permission denied during cache creation. Check API key permissions for caching.");
                    }
                    // Don't automatically remove persistent entry here, as creation failed before association
                    return null; // Return null on creation error
                }
            } catch (outerError: unknown) {
                // Catch errors from early manager init or persistent retrieval blocks
                const errorDetails = outerError instanceof Error ? { name: outerError.name, message: outerError.message } : { details: String(outerError) };
                this.logger.error({ ...baseLogContext, err: errorDetails, event: 'cache_logic_outer_exception' }, "Unhandled exception during cache get/create logic");
                return null;
            } finally {
                // 6. Always remove the promise using composite key once resolved/rejected
                this.cachePromises.delete(cacheKey);
                this.logger.debug({ ...baseLogContext, event: 'cache_promise_deleted' }, "Removed cache creation promise.");
            }
        })(); // End of async IIFE

        // Store the promise BEFORE awaiting it, using the composite key
        this.cachePromises.set(cacheKey, cachePromise);
        this.logger.debug({ ...baseLogContext, event: 'cache_promise_set' }, "Cache creation promise stored.");

        // Await and return the result of the promise
        return await cachePromise;
    }


    // --- Execute with Retry Logic (Private method) ---
    private async executeWithRetry(
        fn: RetryableFunction,
        apiType: string,
        batchIndex: number,
        modelName: string,
        modelRateLimiter: RateLimiterMemory
    ): Promise<ApiResponse> {
        this.ensureInitialized(); // Check if service and GenAI are ready
        const cacheKey = `${apiType}-${modelName}`;
        const baseLogContext = { apiType, batchIndex, modelName, cacheKey, function: 'executeWithRetry' };
        this.logger.debug({ ...baseLogContext, event: 'retry_loop_start' }, "Executing with retry");

        let retryCount = 0;
        let currentDelay = this.initialDelayMs; // Use configured value
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        while (retryCount < this.maxRetries) { // Use configured value
            const attempt = retryCount + 1;
            const attemptLogContext = { ...baseLogContext, attempt, maxAttempts: this.maxRetries };
            this.logger.info({ ...attemptLogContext, event: 'retry_attempt_start' }, "Executing function attempt");

            try {
                // GenAI initialization check already done by ensureInitialized()
                return await fn(modelRateLimiter); // Execute the core function

            } catch (error: unknown) {
                let shouldRetry = true;
                let invalidateCache = false;
                const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
                const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
                let errorEvent = 'retry_attempt_error_unknown'; // Default error event type

                // Check internal rate limiter error first
                if (error instanceof RateLimiterRes) {
                    const waitTimeMs = error.msBeforeNext;
                    this.logger.warn({ ...attemptLogContext, waitTimeMs, event: 'retry_internal_rate_limit_wait' }, `Internal rate limit exceeded. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                    // Important: 'continue' skips retryCount increment and delay logic
                    continue;
                }

                // Handle specific Gemini/other errors
                if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                    errorEvent = 'retry_attempt_error_cache';
                    this.logger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Cache related error detected. Invalidating cache reference and retrying.");
                    invalidateCache = true; // Mark for invalidation below
                } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted') || errorMessageLower.includes('rate limit')) {
                    errorEvent = 'retry_attempt_error_429';
                    this.logger.warn({ ...attemptLogContext, status: 429, err: errorDetails, event: errorEvent }, "429/Resource Exhausted/Rate Limit Error from API. Retrying...");
                    // Keep shouldRetry = true
                } else if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                    errorEvent = 'retry_attempt_error_5xx';
                    this.logger.warn({ ...attemptLogContext, status: 500, err: errorDetails, event: errorEvent }, "5xx/Server Error from API. Retrying...");
                    // Keep shouldRetry = true
                } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                    errorEvent = 'retry_attempt_error_safety_blocked';
                    this.logger.error({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Request blocked by safety settings. No further retries.");
                    shouldRetry = false; // Do not retry safety blocks
                } else {
                    // Keep default errorEvent = 'retry_attempt_error_unknown'
                    this.logger.warn({ ...attemptLogContext, err: errorDetails, event: errorEvent }, "Unhandled/other error during execution attempt. Retrying...");
                    // Keep shouldRetry = true (default assumption for unknown errors)
                }

                // --- Cache Invalidation Logic ---
                if (invalidateCache) {
                    this.logger.info({ ...attemptLogContext, event: 'retry_cache_invalidate' }, "Removing cache entry due to error.");
                    this.contextCaches.delete(cacheKey); // Remove from in-memory map
                    await this.removePersistentCacheEntry(cacheKey); // Remove from persistent map
                }
                // --- End Cache Invalidation Logic ---


                // Increment retry count *after* handling the error type
                retryCount++;
                const isLastAttempt = retryCount >= this.maxRetries;

                // Check if we should stop retrying
                if (!shouldRetry) {
                    this.logger.error({ ...attemptLogContext, finalError: errorDetails, event: 'retry_abort_non_retryable' }, "Non-retryable error encountered. Aborting retries.");
                    return defaultResponse; // Return default on non-retryable error
                }

                if (isLastAttempt) {
                    this.logger.error({ ...attemptLogContext, maxRetries: this.maxRetries, finalError: errorDetails, event: 'retry_failed_max_retries' }, `Failed to process after maximum retries.`);
                    return defaultResponse; // Return default after max retries
                }

                // Calculate delay with exponential backoff and jitter
                const jitter = Math.random() * 500; // Adds 0-500ms jitter
                const delayWithJitter = Math.max(0, currentDelay + jitter); // Ensure delay isn't negative
                this.logger.info({ ...attemptLogContext, nextAttempt: retryCount + 1, delaySeconds: (delayWithJitter / 1000).toFixed(2), event: 'retry_wait_before_next' }, `Waiting before next retry...`);

                await new Promise(resolve => setTimeout(resolve, delayWithJitter));

                // Increase delay for next potential retry (exponential backoff)
                currentDelay = Math.min(currentDelay * 2, this.maxDelayMs); // Use configured max delay

            } // End catch block
        } // End while loop

        // Fallback return
        this.logger.error({ ...baseLogContext, event: 'retry_loop_exit_unexpected' }, "Exited retry loop unexpectedly.");
        return defaultResponse;
    }


    // --- Core Gemini API Call Function (Private method) ---
    private async callGeminiAPI({
        batch, batchIndex, title, acronym, apiType, modelName, generationConfig, fewShotParts, useCache
    }: InternalCallGeminiApiParams): Promise<ApiResponse> {
        this.ensureInitialized(); // Check if service and GenAI are ready
        const baseLogContext = { apiType, batchIndex, modelName, title: title || 'N/A', acronym: acronym || 'N/A', function: 'callGeminiAPI' };
        // Note: systemInstruction is derived from apiConfig inside the calling public method
        this.logger.info({ ...baseLogContext, event: 'gemini_call_start' }, "Preparing Gemini API call");
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        let modelRateLimiter: RateLimiterMemory;
        try {
            modelRateLimiter = this.getRateLimiterForModel(modelName); // Use internal method
        } catch (limiterError: unknown) {
            const errorDetails = limiterError instanceof Error ? { name: limiterError.name, message: limiterError.message } : { details: String(limiterError) };
            this.logger.error({ ...baseLogContext, err: errorDetails, event: 'gemini_call_limiter_init_failed' }, "Failed to get or create rate limiter. Aborting API call.");
            return defaultResponse;
        }

        // Get the specific config for this API type from the pre-loaded configs
        const apiConfig = this.apiConfigs[apiType];
        if (!apiConfig) {
            this.logger.error({ ...baseLogContext, event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found.`);
            return defaultResponse;
        }
        const systemInstructionText = apiConfig.systemInstruction || ""; // Get instruction from loaded config

        // Setup Model (Cached or Non-Cached)
        let model: GenerativeModel | undefined;
        let contentRequest: GenerateContentRequest | string;
        let usingCache = false; // Re-evaluate based on passed param
        let currentCache: CachedContent | null = null;
        const cacheIdentifier = `${apiType}-${modelName}`;

        if (useCache) { // Check the passed parameter
            const cacheSetupContext = { ...baseLogContext, cacheIdentifier, event_group: 'cache_setup' };
            this.logger.debug({ ...cacheSetupContext, event: 'cache_setup_get_or_create' }, "Attempting to get or create cache");
            try {
                // Pass the system instruction text derived from config
                currentCache = await this.getOrCreateContextCache(apiType, modelName, systemInstructionText, fewShotParts);
            } catch (cacheSetupError: unknown) {
                const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
                this.logger.error({ ...cacheSetupContext, err: errorDetails, event: 'cache_setup_get_or_create_failed' }, "Critical error during cache setup, proceeding without cache");
                currentCache = null;
            }

            if (currentCache?.name) {
                this.logger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_attempt_use' }, "Attempting to use cached context object");
                try {
                    // genAI checked by ensureInitialized()
                    model = this.genAI!.getGenerativeModelFromCachedContent(currentCache);
                    contentRequest = batch; // Simple request when using cache
                    usingCache = true; // Confirm cache is being used
                    this.logger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_setup_use_success' }, "Using cached context model");
                } catch (getModelError: unknown) {
                    const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                    this.logger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'cache_setup_getmodel_failed' }, "Error getting model from cached content, falling back to non-cached");
                    this.contextCaches.delete(cacheIdentifier);
                    await this.removePersistentCacheEntry(cacheIdentifier);
                    currentCache = null;
                    usingCache = false; // Fallback, ensure flag is false
                }
            } else {
                this.logger.info({ ...cacheSetupContext, event: 'cache_setup_no_cache_found' }, "No valid cache object found or created, proceeding without cache.");
                usingCache = false; // Ensure flag is false
            }
        } // End if useCache

        // --- Non-Cached Model Setup ---
        if (!usingCache) {
            const nonCachedSetupContext = { ...baseLogContext, event_group: 'non_cached_setup' };
            if (useCache) { // Log only if fallback occurred
                this.logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_fallback' }, "Proceeding without cache (setup failed or no cache found).");
            } else {
                this.logger.debug({ ...nonCachedSetupContext, event: 'non_cached_setup_normal' }, "Setting up non-cached model.");
            }
            try {
                // genAI checked by ensureInitialized()
                const modelConfig: { model: string, systemInstruction?: Content } = {
                    model: modelName, // Use the passed modelName
                };
                // Use systemInstructionText derived from config
                if (systemInstructionText) {
                    modelConfig.systemInstruction = { role: "system", parts: [{ text: systemInstructionText }] };
                    this.logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_using_system_instruction' }, "Model configured WITH system instruction.");
                } else {
                    this.logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_skipping_system_instruction' }, "Model configured WITHOUT system instruction.");
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
                    this.logger.info({ ...nonCachedSetupContext, historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Using non-cached model with history");
                } else {
                    contentRequest = batch; // Simple request if no few-shots
                    this.logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_request_simple' }, "Using simple non-cached model request");
                }
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                this.logger.error({ ...nonCachedSetupContext, generationModelName: modelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
                return defaultResponse;
            }
        } // End non-cached setup

        // --- Call API with Retry Logic ---
        return this.executeWithRetry(async (limiter): Promise<ApiResponse> => { // Use internal method
            const callAttemptContext = { ...baseLogContext, usingCache, cacheName: usingCache ? currentCache?.name : 'N/A', event_group: 'gemini_api_attempt' };
            if (!model) {
                // This should theoretically not happen if setup logic is correct
                this.logger.error({ ...callAttemptContext, event: 'gemini_api_model_undefined' }, "Model object is undefined before calling generateContent.");
                throw new Error("Model is not initialized");
            }

            // Use rate limiter passed from executeWithRetry
            const rateLimitKey = `${apiType}_${batchIndex}_${modelName}`; // Unique key per attempt/model
            this.logger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points`);
            try {
                await limiter.consume(rateLimitKey, 1); // Consume point
                this.logger.debug({ ...callAttemptContext, event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed. Sending request...`);
            } catch (limiterError: unknown) {
                this.logger.warn({ ...callAttemptContext, event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed.`);
                throw limiterError; // Propagate to retry logic
            }

            let result: GenerateContentResult;
            try {
                this.logger.info({ ...callAttemptContext, requestType: typeof contentRequest === 'string' ? 'string' : 'object', event: 'gemini_api_generate_start' }, "Calling model.generateContent");
                result = await model.generateContent(contentRequest);
                this.logger.info({ ...callAttemptContext, event: 'gemini_api_generate_success' }, "model.generateContent successful");
            } catch (generateContentError: unknown) {
                const errorDetails = generateContentError instanceof Error ? { name: generateContentError.name, message: generateContentError.message } : { details: String(generateContentError) };
                this.logger.error({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_generate_failed' }, "Error during model.generateContent");
                // Propagate error to executeWithRetry for handling (including cache invalidation)
                throw generateContentError;
            }

            // --- Process Response ---
            const response = result?.response;
            const feedback = response?.promptFeedback;
            if (!response) {
                this.logger.warn({ ...callAttemptContext, feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing response object.");
                if (feedback?.blockReason) {
                    this.logger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings");
                    throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`); // Propagate
                }
                throw new Error("Empty or invalid response object from Gemini API."); // Propagate
            }
            if (feedback?.blockReason) {
                this.logger.error({ ...callAttemptContext, blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings (found in feedback)");
                throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`); // Propagate
            }

            let responseText = "";
            try {
                responseText = response.text(); // Preferred method
                this.logger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_success' }, "Extracted text using response.text()");
            } catch (textError: unknown) {
                // Fallback if response.text() fails (might happen with complex responses/errors)
                const errorDetails = textError instanceof Error ? { name: textError.name, message: textError.message } : { details: String(textError) };
                this.logger.warn({ ...callAttemptContext, err: errorDetails, event: 'gemini_api_text_extract_failed' }, "Response.text() accessor failed, trying fallback.");
                responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
                if (!responseText) {
                    this.logger.error({ ...callAttemptContext, responseStructure: JSON.stringify(response)?.substring(0, 500), event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback.");
                    // Consider throwing an error here if text is absolutely required
                    // throw new Error("Failed to extract text content from response.");
                } else {
                    this.logger.debug({ ...callAttemptContext, event: 'gemini_api_text_extract_fallback_success' }, "Extracted text using fallback");
                }
            }

            const metaData = response.usageMetadata ?? null;

            // --- Write Response to File (Async, Fire-and-Forget) ---
            const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
            // Use configured output dir
            const responseOutputPath = path.join(this.responseOutputDir, `result_${apiType}_${safeAcronym}_${batchIndex}.txt`);
            const fileLogContext = { ...callAttemptContext, filePath: responseOutputPath, event_group: 'response_file_write' };

            (async () => {
                try {
                    // Use configured output dir
                    if (!existsSync(this.responseOutputDir)) {
                        await fsPromises.mkdir(this.responseOutputDir, { recursive: true });
                        this.logger.info({ directory: this.responseOutputDir, event: 'response_dir_created' }, "Created response output directory");
                    }
                    this.logger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Writing response to file");
                    await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8"); // Write even if empty
                    this.logger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file");
                } catch (fileWriteError: unknown) {
                    const errorDetails = fileWriteError instanceof Error ? { name: fileWriteError.name, message: fileWriteError.message } : { details: String(fileWriteError) };
                    this.logger.error({ ...fileLogContext, err: errorDetails, event: 'response_file_write_failed' }, "Error writing response to file");
                }
            })(); // End async file write

            this.logger.info({ ...callAttemptContext, responseLength: responseText.length, hasMetaData: !!metaData, tokens: metaData?.totalTokenCount, event: 'gemini_api_attempt_success' }, "Gemini API request processed successfully for this attempt.");
            return { responseText, metaData }; // Return successful response

        }, apiType, batchIndex, modelName, modelRateLimiter); // Pass limiter to executeWithRetry
    }


    // --- Helper to Prepare Few-Shot Parts ---
    private prepareFewShotParts(apiType: string, apiConfig: GeminiApiConfig): Part[] {
        const fewShotParts: Part[] = [];
        const fewShotContext = { apiType, function: 'prepareFewShotParts' };

        if (!apiConfig.inputs || !apiConfig.outputs) {
            this.logger.debug({ ...fewShotContext, event: 'few_shot_prep_skipped_no_data' }, "Skipping few-shot parts: No inputs/outputs found in config.");
            return fewShotParts;
        }

        this.logger.debug({ ...fewShotContext, event: 'few_shot_prep_start' }, "Preparing few-shot parts from config");
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
                    this.logger.warn({ ...fewShotContext, inputKey, event: 'few_shot_prep_missing_input_value' }, "Input key found but value is empty/missing.")
                }

                if (outputValue) {
                    fewShotParts.push({ text: outputValue });
                } else {
                    // It's possible for a model response (output) to be empty, might not be a warning.
                    this.logger.trace({ ...fewShotContext, inputKey, outputKey, event: 'few_shot_prep_missing_output_value' }, "Output value not found or empty for corresponding input.")
                    // Still add an empty model part if input exists? Depends on Gemini requirements.
                    // For safety, only add if outputValue exists:
                    // fewShotParts.push({ text: "" }); // Or skip if outputValue is missing/empty
                }
            });

            if (fewShotParts.length === 0) {
                this.logger.warn({ ...fewShotContext, event: 'few_shot_prep_empty_result' }, "Few-shot inputs/outputs processed, but resulted in empty parts array.");
            } else {
                this.logger.debug({ ...fewShotContext, fewShotPairCount: fewShotParts.length / 2, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
            }
        } catch (fewShotError: unknown) {
            const errorDetails = fewShotError instanceof Error ? { name: fewShotError.name, message: fewShotError.message } : { details: String(fewShotError) };
            this.logger.error({ ...fewShotContext, err: errorDetails, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Returning empty array.");
            fewShotParts.length = 0; // Clear array on error
        }
        return fewShotParts;
    }


    // --- Public API Methods ---

    public async extractInformation(params: GeminiApiParams): Promise<ApiResponse> {
        this.ensureInitialized();
        const apiType = this.API_TYPE_EXTRACT;
        const config = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };
        const baseLogContext = { apiType, batchIndex: params.batchIndex, title: params.title || 'N/A', acronym: params.acronym || 'N/A', function: 'extractInformation' };

        if (!config) {
            this.logger.error(baseLogContext, "Configuration not found.");
            return defaultResponse;
        }
        const modelNames = config.modelNames; // Expect modelNames for extract
        if (!modelNames || modelNames.length === 0) {
            this.logger.error(baseLogContext, "No model names configured.");
            return defaultResponse;
        }

        // Round-robin model selection
        const selectedModelName = modelNames[this.extractModelIndex];
        const nextIndex = (this.extractModelIndex + 1) % modelNames.length;
        this.logger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating API call (round-robin)");
        this.extractModelIndex = nextIndex;

        // Determine feature usage from config
        const useFewShotExamples = false; // Extract usually uses few-shots
        const useCache = false; // Extract usually doesn't benefit from caching context

        // Prepare few-shot parts based on config
        const fewShotParts = useFewShotExamples ? this.prepareFewShotParts(apiType, config) : [];


        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                ...params,
                apiType,
                modelName: selectedModelName,
                generationConfig: config.generationConfig,
                fewShotParts: fewShotParts,
                useCache: useCache,
            });

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
                    this.logger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
                } catch (parseError: unknown) {
                    const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                    this.logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                    cleanedResponseText = "";
                }
            } else {
                this.logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
                cleanedResponseText = "";
            }

            this.logger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            // Errors during callGeminiAPI are caught and logged internally,
            // but re-throw or handle unexpected errors here if necessary.
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.logger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails }, "Unhandled error in public method");
            return defaultResponse; // Return default on unhandled error
        }
    }

    public async extractCfp(params: GeminiApiParams): Promise<ApiResponse> {
        this.ensureInitialized();
        const apiType = this.API_TYPE_CFP;
        const config = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };
        const baseLogContext = { apiType, batchIndex: params.batchIndex, title: params.title || 'N/A', acronym: params.acronym || 'N/A', function: 'extractCfp' };

        if (!config) {
            this.logger.error(baseLogContext, "Configuration not found for CFP.");
            return defaultResponse;
        }
        const modelNames = config.modelNames; // Expect modelNames for CFP
        if (!modelNames || modelNames.length === 0) {
            this.logger.error(baseLogContext, "No model names configured for CFP.");
            return defaultResponse;
        }

        // Round-robin model selection
        const selectedModelName = modelNames[this.cfpModelIndex];
        const nextIndex = (this.cfpModelIndex + 1) % modelNames.length;
        this.logger.debug({ ...baseLogContext, selectedModel: selectedModelName, nextIndex }, "Initiating CFP API call (round-robin)");
        this.cfpModelIndex = nextIndex;

        // Determine feature usage from config
        const useFewShotExamples = true; // CFP uses few-shots
        const useCache = false; // CFP likely doesn't benefit from caching

        // Prepare few-shot parts based on config
        const fewShotParts = useFewShotExamples ? this.prepareFewShotParts(apiType, config) : [];

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                ...params,
                apiType,
                modelName: selectedModelName,
                generationConfig: config.generationConfig,
                fewShotParts: fewShotParts,
                useCache: useCache,
            });

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
                    this.logger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response for CFP.");
                } catch (parseError: unknown) {
                    const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                    this.logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse CFP extracted text as JSON after cleaning, returning empty string.");
                    cleanedResponseText = "";
                }
            } else {
                this.logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in CFP response, returning empty string.");
                cleanedResponseText = "";
            }

            this.logger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "CFP API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.logger.error({ ...baseLogContext, modelUsed: selectedModelName, err: errorDetails }, "Unhandled error in public method");
            return defaultResponse;
        }
    }

    public async determineLinks(params: GeminiApiParams): Promise<ApiResponse> {
        this.ensureInitialized();
        const apiType = this.API_TYPE_DETERMINE;
        const config = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };
        const baseLogContext = { apiType, batchIndex: params.batchIndex, title: params.title || 'N/A', acronym: params.acronym || 'N/A', function: 'determineLinks' };

        if (!config) {
            this.logger.error(baseLogContext, "Configuration not found.");
            return defaultResponse;
        }
        // Determine API typically uses a single model name
        const modelName = config.modelName;
        if (!modelName) {
            this.logger.error(baseLogContext, "No model name configured.");
            return defaultResponse;
        }

        // Determine feature usage from config
        const useFewShotExamples = false; // Determine usually doesn't use few-shots
        const useCache = false; // Determine doesn't benefit from caching

        // Prepare few-shot parts (will be empty)
        const fewShotParts = useFewShotExamples ? this.prepareFewShotParts(apiType, config) : [];


        const logContextWithModel = { ...baseLogContext, modelName };
        this.logger.debug(logContextWithModel, "Initiating API call");

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                ...params,
                apiType,
                modelName: modelName,
                generationConfig: config.generationConfig,
                fewShotParts: fewShotParts, // Pass empty array
                useCache: useCache,
            });

            // JSON Cleaning Logic
            const firstCurly = responseText.indexOf('{');
            const lastCurly = responseText.lastIndexOf('}');
            let cleanedResponseText = "";
            const cleaningLogContext = { ...logContextWithModel };
            if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
                const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
                try {
                    JSON.parse(potentialJson);
                    cleanedResponseText = potentialJson.trim();
                    this.logger.debug(cleaningLogContext, "Successfully cleaned and validated JSON response.");
                } catch (parseError: unknown) {
                    const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                    this.logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200), err: errorDetails }, "Failed to parse extracted text as JSON after cleaning, returning empty string.");
                    cleanedResponseText = "";
                }
            } else {
                this.logger.warn({ ...cleaningLogContext, rawResponseSnippet: responseText.substring(0, 200) }, "Could not find valid JSON structure ({...}) in response, returning empty string.");
                cleanedResponseText = "";
            }

            this.logger.info({ ...cleaningLogContext, cleanedResponseLength: cleanedResponseText.length }, "API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            this.logger.error({ ...logContextWithModel, err: errorDetails }, "Unhandled error in public method");
            return defaultResponse;
        }
    }

} // End GeminiApiService class