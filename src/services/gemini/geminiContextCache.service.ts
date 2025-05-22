// src/services/gemini/geminiContextCache.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { type CachedContent, type Part, type Content, GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import { GeminiClientManagerService } from './geminiClientManager.service';
import { GeminiCachePersistenceService } from './geminiCachePersistence.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Manages the lifecycle and retrieval of Gemini context caches (e.g., for few-shot examples).
 * This service coordinates between in-memory caches, persistent storage (via `GeminiCachePersistenceService`),
 * and the Google AI Cache Manager (via `GeminiClientManagerService`) to provide efficient
 * and persistent context for LLM interactions.
 */
@singleton()
export class GeminiContextCacheService {
    // In-memory map to store CachedContent objects
    private contextCachesInternal: Map<string, CachedContent | null> = new Map();
    // In-memory map to store Promises for cache creation/retrieval to avoid duplicate efforts
    private cachePromisesInternal: Map<string, Promise<CachedContent | null>> = new Map();

    /**
     * Constructs an instance of GeminiContextCacheService.
     * @param {GeminiClientManagerService} clientManager - The injected service for managing Gemini API clients.
     * @param {GeminiCachePersistenceService} persistenceService - The injected service for persisting cache names.
     */
    constructor(
        @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService,
        @inject(GeminiCachePersistenceService) private persistenceService: GeminiCachePersistenceService,
    ) { }

    /**
     * Gets an existing Gemini context cache or creates a new one if it doesn't exist.
     * It checks in-memory, then persistent storage, and finally attempts to create via SDK.
     *
     * @param {string} apiType - The type of API this cache is for (e.g., 'determineLinks', 'extractInfo').
     * @param {string} modelName - The name of the Gemini model (e.g., 'gemini-pro').
     * @param {string} systemInstructionText - The system instruction text used for the model.
     * @param {Part[]} fewShotParts - An array of few-shot example parts to be included in the cache.
     * @param {SDKGenerationConfig} generationConfigForCache - The generation configuration to use when creating the cache.
     * @param {Logger} logger - The logger instance (expected to have context from `GeminiApiService`).
     * @returns {Promise<CachedContent | null>} A Promise that resolves with the `CachedContent` object,
     *                                           or `null` if cache creation/retrieval fails.
     */
    public async getOrCreateContext(
        apiType: string,
        modelName: string,
        systemInstructionText: string,
        fewShotParts: Part[],
        generationConfigForCache: SDKGenerationConfig, // New parameter for generation config
        logger: Logger
    ): Promise<CachedContent | null> {
        const cacheKey = `${apiType}-${modelName}`;
        // Create a child logger for this specific operation, inheriting parent context
        const methodLogger = logger.child({ function: 'getOrCreateContextCache', cacheKey });

        methodLogger.debug({ event: 'cache_context_get_or_create_start' }, "Attempting to get or create context cache.");

        // 1. Check in-memory cache first
        const cachedInMemory = this.contextCachesInternal.get(cacheKey);
        if (cachedInMemory?.name) {
            methodLogger.info({ cacheName: cachedInMemory.name, event: 'cache_context_hit_inmemory' }, "Reusing existing context cache object from in-memory map.");
            return cachedInMemory;
        }

        // 2. Check if creation/retrieval is already in progress
        let cachePromise = this.cachePromisesInternal.get(cacheKey);
        if (cachePromise) {
            methodLogger.debug({ event: 'cache_context_creation_in_progress_wait' }, "Cache creation/retrieval already in progress for this key, awaiting existing promise...");
            return await cachePromise;
        }

        // 3. If not in memory and not in progress, initiate creation/retrieval
        // Store the promise immediately to prevent duplicate efforts
        cachePromise = (async (): Promise<CachedContent | null> => {
            try {
                // Ensure CacheManager is available before proceeding
                this.clientManager.getCacheManager(); // This will throw if not initialized
            } catch (e: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(e);
                methodLogger.error({ event: 'cache_context_setup_failed_no_manager', detail: errorMessage }, "CacheManager not available. Cannot create or retrieve cache context.");
                return null; // Cannot proceed without CacheManager
            }

            // Attempt to retrieve from persistent storage (file system map -> SDK)
            try {
                const knownCacheName = this.persistenceService.getPersistentCacheName(cacheKey);
                if (knownCacheName) {
                    const retrievalContext = { cacheName: knownCacheName, event_group: "persistent_retrieval" };
                    methodLogger.debug({ ...retrievalContext, event: 'cache_context_retrieval_attempt' }, `Found cache name "${knownCacheName}" in persistent map, attempting retrieval from SDK.`);
                    try {
                        const retrievedCache = await this.clientManager.getSdkCache(knownCacheName, methodLogger);
                        if (retrievedCache?.name) {
                            methodLogger.info({ ...retrievalContext, event: 'cache_context_retrieval_success', retrievedModel: retrievedCache.model }, `Successfully retrieved cache context "${retrievedCache.name}" from SDK.`);
                            this.contextCachesInternal.set(cacheKey, retrievedCache); // Store in-memory
                            return retrievedCache;
                        } else {
                            methodLogger.warn({ ...retrievalContext, event: 'cache_context_retrieval_failed_not_found_in_manager' }, `Cache name "${knownCacheName}" found in map, but retrieval from SDK manager failed (not found or invalid response). Removing local entry.`);
                            await this.removePersistentEntry(cacheKey, methodLogger); // Remove from persistent map
                        }
                    } catch (retrievalError: unknown) { // Catch errors during SDK retrieval
                        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(retrievalError);
                        methodLogger.error({ ...retrievalContext, err: { message: errorMessage, stack: errorStack }, event: 'cache_context_retrieval_failed_exception' }, `Error retrieving cache context "${knownCacheName}" from SDK. Error: "${errorMessage}". Proceeding to create new cache.`);
                        await this.removePersistentEntry(cacheKey, methodLogger); // Remove from persistent map on retrieval error
                    }
                } else {
                    methodLogger.debug({ event: 'cache_context_persistent_miss' }, "Cache context name not found in persistent map. Will attempt creation.");
                }

                // Double check in-memory cache again in case another concurrent operation just completed
                const doubleCheckCachedInMemory = this.contextCachesInternal.get(cacheKey);
                if (doubleCheckCachedInMemory?.name) {
                    methodLogger.info({ cacheName: doubleCheckCachedInMemory.name, event: 'cache_reuse_in_memory_double_check' }, "Reusing in-memory cache found after initial checks and lock acquisition.");
                    return doubleCheckCachedInMemory;
                }

                // If not found in-memory or persistently, create a new cache
                const createContext = { event_group: "cache_creation" };
                methodLogger.info({ ...createContext, event: 'cache_context_create_attempt' }, "No existing cache found. Attempting to create NEW context cache.");
                const modelForCacheApi = `models/${modelName}`; // SDK expects "models/model-name" format

                try {
                    const systemInstructionContent: Content[] = systemInstructionText ? [{ role: "system", parts: [{ text: systemInstructionText }] }] : [];
                    const contentToCache: Content[] = [];
                    // Convert few-shot parts (user/model text pairs) into Content array format for caching
                    if (fewShotParts && fewShotParts.length > 0) {
                        for (let i = 0; i < fewShotParts.length; i += 2) {
                            if (fewShotParts[i]?.text) contentToCache.push({ role: 'user', parts: [fewShotParts[i]] });
                            if (fewShotParts[i + 1]?.text) contentToCache.push({ role: 'model', parts: [fewShotParts[i + 1]] });
                        }
                    }

                    const displayName = `cache-${apiType}-${modelName}-${Date.now()}`;
                    methodLogger.debug({
                        ...createContext, modelForCache: modelForCacheApi, displayName,
                        hasSystemInstruction: !!systemInstructionText, contentToCacheCount: contentToCache.length,
                        event: 'cache_create_details'
                    }, "Details for new cache creation request.");

                    // Prepare parameters for SDK cache creation
                    const cacheCreateParams: Parameters<typeof this.clientManager.createSdkCache>[0] = { // Type safe way to define params
                        model: modelForCacheApi,
                        contents: contentToCache,
                        displayName: displayName,
                        generationConfig: generationConfigForCache, // Pass the generation config for the cache
                    };
                    if (systemInstructionContent.length > 0) {
                        // systemInstruction is part of cacheCreateParams
                        cacheCreateParams.systemInstruction = systemInstructionContent[0];
                    }

                    const createdCache = await this.clientManager.createSdkCache(cacheCreateParams, methodLogger);

                    if (!createdCache?.name) {
                        methodLogger.error({ modelForCache: modelForCacheApi, createdCacheObject: createdCache, event: 'cache_context_create_failed_invalid_response' }, "Failed to create context cache: Invalid cache object returned by SDK manager.create.");
                        return null;
                    }
                    methodLogger.info({ cacheName: createdCache.name, model: createdCache.model, event: 'cache_context_create_success' }, `Context cache "${createdCache.name}" created successfully.`);
                    this.contextCachesInternal.set(cacheKey, createdCache); // Store in-memory
                    this.persistenceService.setPersistentCacheName(cacheKey, createdCache.name); // Store persistently
                    await this.persistenceService.saveMap(methodLogger); // Persist the updated map
                    return createdCache;
                } catch (cacheError: unknown) { // Catch errors during SDK cache creation
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(cacheError);
                    methodLogger.error({ ...createContext, err: { message: errorMessage, stack: errorStack }, event: 'cache_context_create_failed' }, `Failed to create NEW context cache: "${errorMessage}".`);
                    if (errorMessage?.includes("invalid model") || errorMessage?.includes("model not found")) {
                        methodLogger.error({ ...createContext, modelForCache: modelForCacheApi, event: 'cache_context_create_failed_invalid_model' }, "Check model name for Gemini caching API (e.g., 'gemini-pro').");
                    } else if (errorMessage?.includes("permission denied") || errorMessage?.includes("quota")) {
                        methodLogger.error({ ...createContext, event: 'cache_context_create_failed_permission_or_quota' }, `Permission denied or quota issue during cache creation: "${errorMessage}".`);
                    }
                    return null; // Creation failed
                }
            } catch (outerError: unknown) { // Catch any unexpected errors in the overall logic
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(outerError);
                methodLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'cache_context_logic_unhandled_error' }, `An unhandled exception occurred during cache get/create logic: "${errorMessage}".`);
                return null;
            } finally {
                // Ensure the promise is removed from the map after it resolves or rejects
                this.cachePromisesInternal.delete(cacheKey);
                methodLogger.debug({ event: 'cache_context_promise_deleted' }, "Removed cache creation/retrieval promise from in-progress map.");
            }
        })(); // Self-executing async function
        this.cachePromisesInternal.set(cacheKey, cachePromise); // Store the promise
        methodLogger.debug({ event: 'cache_context_promise_set' }, "Cache creation/retrieval promise stored in in-progress map.");
        return await cachePromise; // Return the promise to await its resolution
    }

    /**
     * Removes a persistent cache entry (from the file system map and then triggers a save).
     * Also removes the entry from the in-memory cache.
     * This is typically called when a cache is determined to be invalid or no longer exists on the backend.
     * @param {string} cacheKey - The internal key of the cache to remove.
     * @param {Logger} logger - The logger instance.
     * @returns {Promise<void>} A Promise that resolves when the entry is removed and map is saved.
     */
    public async removePersistentEntry(cacheKey: string, logger: Logger): Promise<void> {
        // Child logger with the original function name for log consistency
        const methodLogger = logger.child({ function: 'removePersistentCacheEntry', cacheKey });

        if (this.persistenceService.hasPersistentCacheName(cacheKey)) {
            methodLogger.warn({ event: 'cache_persistent_entry_remove_start' }, `Removing persistent cache entry for key "${cacheKey}" from file system map.`);
            this.persistenceService.deletePersistentCacheName(cacheKey);
            await this.persistenceService.saveMap(methodLogger); // Pass logger for saveMap
            methodLogger.info({ event: 'cache_persistent_entry_remove_success' }, `Persistent cache entry for key "${cacheKey}" removed and map saved.`);
        } else {
            methodLogger.debug({ event: 'cache_persistent_entry_remove_skipped_not_found' }, `No persistent cache entry found for key "${cacheKey}" to remove.`);
        }
        
        // Also remove from in-memory cache to ensure consistency
        if (this.contextCachesInternal.has(cacheKey)) {
            methodLogger.warn({ source: 'in-memory', event: 'cache_inmemory_entry_remove' }, `Removing in-memory cache entry for key "${cacheKey}".`);
            this.contextCachesInternal.delete(cacheKey);
        }
    }

    /**
     * Deletes an entry from the in-memory cache only, without affecting persistent storage.
     * Useful for temporarily invalidating a cache without removing it from the file system.
     * @param {string} cacheKey - The internal key of the cache to delete from memory.
     * @param {Logger} logger - The logger instance.
     * @returns {void}
     */
    public deleteInMemoryOnly(cacheKey: string, logger: Logger): void {
        const methodLogger = logger.child({ function: 'deleteInMemoryOnly', cacheKey });
        if (this.contextCachesInternal.has(cacheKey)) {
            methodLogger.warn({ source: 'in-memory', event: 'cache_inmemory_entry_remove_only' }, `Removing in-memory cache entry for key "${cacheKey}" only (not persistent).`);
            this.contextCachesInternal.delete(cacheKey);
        } else {
            methodLogger.debug({ source: 'in-memory', event: 'cache_inmemory_entry_not_found_to_delete' }, `In-memory cache entry for key "${cacheKey}" not found to delete.`);
        }
    }
}