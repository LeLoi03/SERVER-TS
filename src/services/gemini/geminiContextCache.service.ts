// src/services/gemini/geminiContextCache.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { type CachedContent, type Part, type Content, GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import { GeminiClientManagerService } from './geminiClientManager.service';
import { GeminiCachePersistenceService } from './geminiCachePersistence.service';
import { Logger } from 'pino';

@singleton()
export class GeminiContextCacheService {
    // These are owned and managed by this service.
    private contextCachesInternal: Map<string, CachedContent | null> = new Map();
    private cachePromisesInternal: Map<string, Promise<CachedContent | null>> = new Map();

    constructor(
        @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService,
        @inject(GeminiCachePersistenceService) private persistenceService: GeminiCachePersistenceService,
    ) { }

    // This method replicates the logic of the original getOrCreateContextCache
    public async getOrCreateContext(
        apiType: string,
        modelName: string,
        systemInstructionText: string, // Raw text
        fewShotParts: Part[], // Prepared parts
        generationConfigForCache: SDKGenerationConfig, // <-- THAM SỐ MỚI

        logger: Logger // This logger is expected to be from GeminiApiService, already having some context
    ): Promise<CachedContent | null> {
        const cacheKey = `${apiType}-${modelName}`;
        // Create a child logger specific to this operation, inheriting parent context
        // and adding its own fixed context. This ensures logs are like the original.
        const methodLogger = logger.child({ function: 'getOrCreateContextCache', cacheKey });

        methodLogger.debug({ event: 'cache_context_get_or_create_start' }, "Getting or creating context cache");

        const cachedInMemory = this.contextCachesInternal.get(cacheKey);
        if (cachedInMemory?.name) {
            methodLogger.info({ cacheName: cachedInMemory.name, event: 'cache_context_hit_inmemory' }, "Reusing existing context cache object from in-memory map");
            return cachedInMemory;
        }

        let cachePromise = this.cachePromisesInternal.get(cacheKey);
        if (cachePromise) {
            methodLogger.debug({ event: 'cache_context_creation_in_progress_wait' }, "Cache creation already in progress, awaiting...");
            return await cachePromise;
        }

        cachePromise = (async (): Promise<CachedContent | null> => {
            try {
                this.clientManager.getCacheManager(); // Check if available, throws if not
            } catch (e) {
                methodLogger.error({ event: 'cache_context_setup_failed_no_manager', detail: (e as Error).message }, "CacheManager not available. Cannot create or retrieve cache context.");
                return null;
            }

            try {
                const knownCacheName = this.persistenceService.getPersistentCacheName(cacheKey);
                if (knownCacheName) {
                    const retrievalContext = { cacheName: knownCacheName, event_group: "persistent_retrieval" };
                    methodLogger.debug({ ...retrievalContext, event: 'cache_context_retrieval_attempt' }, "Found cache name in persistent map, attempting retrieval");
                    try {
                        const retrievedCache = await this.clientManager.getSdkCache(knownCacheName, methodLogger);
                        if (retrievedCache?.name) {
                            methodLogger.info({ ...retrievalContext, event: 'cache_context_retrieval_success', retrievedModel: retrievedCache.model }, "Successfully retrieved cache context from manager");
                            this.contextCachesInternal.set(cacheKey, retrievedCache);
                            return retrievedCache;
                        } else {
                            methodLogger.warn({ ...retrievalContext, event: 'cache_context_retrieval_failed_not_found_in_manager' }, "Cache name found in map, but retrieval from manager failed (not found). Removing local entry.");
                            await this.removePersistentEntry(cacheKey, methodLogger); // Call internal method
                        }
                    } catch (retrievalError: unknown) {
                        const errorDetails = retrievalError instanceof Error ? { name: retrievalError.name, message: retrievalError.message } : { details: String(retrievalError) };
                        methodLogger.error({ ...retrievalContext, err: errorDetails, event: 'cache_context_retrieval_failed_exception' }, "Error retrieving cache context from manager. Proceeding to create new cache.");
                        await this.removePersistentEntry(cacheKey, methodLogger); // Call internal method
                    }
                } else {
                    methodLogger.debug({ event: 'cache_context_persistent_miss' }, "Cache context name not found in persistent map.");
                }

                const doubleCheckCachedInMemory = this.contextCachesInternal.get(cacheKey);
                if (doubleCheckCachedInMemory?.name) {
                    methodLogger.info({ cacheName: doubleCheckCachedInMemory.name, event: 'cache_reuse_in_memory_double_check' }, "Reusing in-memory cache found after lock acquisition");
                    return doubleCheckCachedInMemory;
                }

                const createContext = { event_group: "cache_creation" };
                methodLogger.info({ ...createContext, event: 'cache_context_create_attempt' }, "Attempting to create NEW context cache");
                const modelForCacheApi = `models/${modelName}`;

                try {
                    const systemInstructionContent: Part[] = systemInstructionText ? [{ text: systemInstructionText }] : [];
                    const contentToCache: Content[] = [];
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
                    }, "Cache creation details");

                    const cacheCreateParams: any = {
                        model: modelForCacheApi, contents: contentToCache, displayName: displayName, generationConfig: generationConfigForCache, // <-- SỬ DỤNG Ở ĐÂY

                    };
                    if (systemInstructionContent.length > 0) {
                        cacheCreateParams.systemInstruction = { role: "system", parts: systemInstructionContent };
                    }

                    const createdCache = await this.clientManager.createSdkCache(cacheCreateParams, methodLogger);

                    if (!createdCache?.name) {
                        methodLogger.error({ modelForCache: modelForCacheApi, createdCacheObject: createdCache, event: 'cache_context_create_failed_invalid_response' }, "Failed to create context cache: Invalid cache object returned by manager.create");
                        return null;
                    }
                    methodLogger.info({ cacheName: createdCache.name, model: createdCache.model, event: 'cache_context_create_success' }, "Context cache created successfully");
                    this.contextCachesInternal.set(cacheKey, createdCache);
                    this.persistenceService.setPersistentCacheName(cacheKey, createdCache.name);
                    await this.persistenceService.saveMap(methodLogger); // Pass logger for saveMap
                    return createdCache;
                } catch (cacheError: unknown) {
                    const errorDetails = cacheError instanceof Error ? { name: cacheError.name, message: cacheError.message } : { details: String(cacheError) };
                    methodLogger.error({ ...createContext, err: errorDetails, event: 'cache_context_create_failed' }, "Failed to create NEW context cache");
                    if (errorDetails.message?.includes("invalid model") || errorDetails.message?.includes("model not found")) {
                        methodLogger.error({ ...createContext, modelForCache: modelForCacheApi, event: 'cache_context_create_failed_invalid_model' }, "Ensure model name is correct for caching API.");
                    } else if (errorDetails.message?.includes("permission denied")) {
                        methodLogger.error({ ...createContext, event: 'cache_context_create_failed_permission' }, "Permission denied during cache creation.");
                    }
                    return null;
                }
            } catch (outerError: unknown) {
                const errorDetails = outerError instanceof Error ? { name: outerError.name, message: outerError.message } : { details: String(outerError) };
                methodLogger.error({ err: errorDetails, event: 'cache_context_logic_unhandled_error' }, "Unhandled exception during cache get/create logic");
                return null;
            } finally {
                this.cachePromisesInternal.delete(cacheKey);
                methodLogger.debug({ event: 'cache_context_promise_deleted' }, "Removed cache creation promise.");
            }
        })();
        this.cachePromisesInternal.set(cacheKey, cachePromise);
        methodLogger.debug({ event: 'cache_context_promise_set' }, "Cache creation promise stored.");
        return await cachePromise;
    }

    // This method replicates the logic of the original removePersistentCacheEntry
    public async removePersistentEntry(cacheKey: string, logger: Logger): Promise<void> {
        // Child logger with the original function name for log consistency
        const methodLogger = logger.child({ function: 'removePersistentCacheEntry', cacheKey });

        if (this.persistenceService.hasPersistentCacheName(cacheKey)) {
            methodLogger.warn({ event: 'cache_persistent_entry_remove_start' }, "Removing persistent cache entry"); // from map
            this.persistenceService.deletePersistentCacheName(cacheKey);
            await this.persistenceService.saveMap(methodLogger); // Pass logger for saveMap
        } else {
            methodLogger.debug({ event: 'cache_persistent_entry_remove_skipped_not_found' }, "No persistent cache entry found to remove");
        }
        // In-memory part
        if (this.contextCachesInternal.has(cacheKey)) {
            methodLogger.warn({ source: 'in-memory', event: 'cache_inmemory_entry_remove' }, "Removing in-memory cache entry");
            this.contextCachesInternal.delete(cacheKey);
        }
    }

    public deleteInMemoryOnly(cacheKey: string, logger: Logger): void {
        const methodLogger = logger.child({ function: 'deleteInMemoryOnly', cacheKey });
        if (this.contextCachesInternal.has(cacheKey)) {
            // This specific log for in-memory removal as part of a larger invalidation
            // was 'cache_inmemory_entry_remove'.
            methodLogger.warn({ source: 'in-memory', event: 'cache_inmemory_entry_remove' }, "Removing in-memory cache entry");
            this.contextCachesInternal.delete(cacheKey);
        }
    }
}