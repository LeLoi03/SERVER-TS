// src/services/gemini/geminiContextCache.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    type CachedContent,
    type Part,
    type Content,
    // Alias cho các type từ SDK để code dễ đọc hơn
    GenerateContentConfig as SDKGenerateContentConfig,
    CreateCachedContentParameters as SDKCreateCachedContentParameters,
    CreateCachedContentConfig as SDKCreateCachedContentConfig,
    GetCachedContentParameters as SDKGetCachedContentParameters

} from "@google/genai";
import { GeminiClientManagerService } from './geminiClientManager.service';
import { GeminiCachePersistenceService } from './geminiCachePersistence.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils';


@singleton()
export class GeminiContextCacheService {
    private contextCachesInternal: Map<string, CachedContent | null> = new Map();
    private cachePromisesInternal: Map<string, Promise<CachedContent | null>> = new Map();

    constructor(
        @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService,
        @inject(GeminiCachePersistenceService) private persistenceService: GeminiCachePersistenceService,
    ) { }

    public async getOrCreateContext(
        apiType: string,
        modelName: string, // Tên model ngắn gọn, ví dụ: "gemini-1.5-flash"
        systemInstructionText: string,
        fewShotParts: Part[],
        generationConfigForCache: SDKGenerateContentConfig, // Dùng để trích xuất systemInstruction, tools, toolConfig nếu có
        logger: Logger
    ): Promise<CachedContent | null> {
        const cacheKey = `${apiType}-${modelName}`;
        const methodLogger = logger.child({ function: 'getOrCreateContextCache', cacheKey, apiType, modelName });

        methodLogger.debug({ event: 'cache_context_get_or_create_start' }, "Attempting to get or create context cache.");

        const cachedInMemory = this.contextCachesInternal.get(cacheKey);
        if (cachedInMemory?.name) {
            methodLogger.info({ cacheName: cachedInMemory.name, event: 'cache_context_hit_inmemory' }, "Reusing context cache from in-memory map.");
            return cachedInMemory;
        }

        let cachePromise = this.cachePromisesInternal.get(cacheKey);
        if (cachePromise) {
            methodLogger.debug({ event: 'cache_context_creation_in_progress_wait' }, "Cache creation/retrieval in progress, awaiting existing promise.");
            return await cachePromise;
        }

        cachePromise = (async (): Promise<CachedContent | null> => {
            let cachesService;
            try {
                // Lấy Caches service thông qua clientManager
                cachesService = this.clientManager.getCachesService(apiType);
            } catch (e: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(e);
                methodLogger.error({ event: 'cache_context_setup_failed_no_caches_service', detail: errorMessage }, "Caches service not available. Cannot create or retrieve cache context.");
                return null;
            }

            try {
                const knownCacheName = this.persistenceService.getPersistentCacheName(cacheKey);
                if (knownCacheName) {
                    const retrievalContext = { cacheName: knownCacheName, event_group: "persistent_retrieval_orchestrator" };
                    methodLogger.debug({ ...retrievalContext, event: 'cache_context_retrieval_attempt' }, `Found cache name "${knownCacheName}", attempting SDK retrieval.`);
                    try {
                        const getParams: SDKGetCachedContentParameters = { name: knownCacheName };
                        const retrievedCache = await cachesService.get(getParams); // Gọi trực tiếp cachesService.get

                        if (retrievedCache?.name) {
                            // Kiểm tra xem model của cache có khớp với modelName hiện tại không (quan trọng!)
                            // SDK trả về cache.model là tên đầy đủ, ví dụ "models/gemini-1.5-flash-001/cachedContents/..."
                            // hoặc chỉ là tên model ngắn gọn tùy theo context. Cần chuẩn hóa hoặc so sánh linh hoạt.
                            // Tạm thời giả định retrievedCache.model là tên ngắn gọn hoặc có thể so sánh được.
                            const cacheModelName = retrievedCache.model?.split('/').pop() || retrievedCache.model;
                            if (cacheModelName && cacheModelName.includes(modelName)) { // So sánh linh hoạt
                                methodLogger.info({ ...retrievalContext, event: 'cache_context_retrieval_success', retrievedModel: retrievedCache.model }, `Successfully retrieved cache "${retrievedCache.name}" from SDK.`);
                                this.contextCachesInternal.set(cacheKey, retrievedCache);
                                return retrievedCache;
                            } else {
                                methodLogger.warn({ ...retrievalContext, event: 'cache_context_retrieval_model_mismatch', expectedModel: modelName, actualModel: retrievedCache.model }, `Retrieved cache "${retrievedCache.name}" but model mismatch. Removing local entry.`);
                                await this.removePersistentEntry(cacheKey, methodLogger);
                            }
                        } else {
                            methodLogger.warn({ ...retrievalContext, event: 'cache_context_retrieval_failed_sdk_returned_invalid' }, `Cache name "${knownCacheName}" found, but SDK retrieval failed (not found or invalid). Removing local entry.`);
                            await this.removePersistentEntry(cacheKey, methodLogger);
                        }
                    } catch (retrievalError: unknown) {
                        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(retrievalError);
                        methodLogger.error({ ...retrievalContext, err: { message: errorMessage, stack: errorStack }, event: 'cache_context_retrieval_failed_exception' }, `Error retrieving cache "${knownCacheName}" from SDK: "${errorMessage}". Proceeding to create new cache.`);
                        await this.removePersistentEntry(cacheKey, methodLogger);
                    }
                } else {
                    methodLogger.debug({ event: 'cache_context_persistent_miss' }, "Cache name not in persistent map. Will attempt creation.");
                }

                const doubleCheckCachedInMemory = this.contextCachesInternal.get(cacheKey);
                if (doubleCheckCachedInMemory?.name) {
                    methodLogger.info({ cacheName: doubleCheckCachedInMemory.name, event: 'cache_reuse_in_memory_double_check' }, "Reusing in-memory cache found after initial checks.");
                    return doubleCheckCachedInMemory;
                }

                const createContext = { event_group: "cache_creation_orchestrator" };
                methodLogger.info({ ...createContext, event: 'cache_context_create_attempt' }, "No existing valid cache found. Attempting to create NEW context cache.");

                // Chuẩn bị contents và systemInstruction cho cache
                const contentToCache: Content[] = [];
                if (fewShotParts && fewShotParts.length > 0) {
                    for (let i = 0; i < fewShotParts.length; i += 2) {
                        // Đảm bảo fewShotParts[i] và fewShotParts[i+1] là Part hợp lệ trước khi truy cập .text
                        if (fewShotParts[i]) contentToCache.push({ role: 'user', parts: [fewShotParts[i]] });
                        if (fewShotParts[i + 1]) contentToCache.push({ role: 'model', parts: [fewShotParts[i + 1]] });
                    }
                }

                const cacheConfig: SDKCreateCachedContentConfig = {
                    contents: contentToCache,
                    displayName: `cache-${apiType}-${modelName}-${Date.now()}`,
                    // Trích xuất systemInstruction, tools, toolConfig từ generationConfigForCache nếu có
                    // và chúng phù hợp với CreateCachedContentConfig
                    ...(generationConfigForCache.systemInstruction && { systemInstruction: generationConfigForCache.systemInstruction }),
                    ...(generationConfigForCache.tools && { tools: generationConfigForCache.tools }),
                    ...(generationConfigForCache.toolConfig && { toolConfig: generationConfigForCache.toolConfig }),
                    // TTL có thể được thêm vào đây nếu cần:
                    // ttl: "3600s" // ví dụ 1 giờ
                };

                // Nếu systemInstructionText được cung cấp riêng và generationConfigForCache không có, ưu tiên nó
                if (systemInstructionText && !cacheConfig.systemInstruction) {
                    cacheConfig.systemInstruction = { role: "system", parts: [{ text: systemInstructionText }] };
                }


                const cacheCreateParams: SDKCreateCachedContentParameters = {
                    model: modelName, // Tên model ngắn gọn, ví dụ: "gemini-1.5-flash"
                    config: cacheConfig
                };

                methodLogger.debug({
                    ...createContext, modelForCache: cacheCreateParams.model, displayName: cacheConfig.displayName,
                    hasSystemInstruction: !!cacheConfig.systemInstruction, contentToCacheCount: contentToCache.length,
                    event: 'cache_create_details'
                }, "Details for new cache creation request.");

                try {
                    const createdCache = await cachesService.create(cacheCreateParams); // Gọi trực tiếp cachesService.create

                    if (!createdCache?.name) {
                        methodLogger.error({ modelForCache: cacheCreateParams.model, createdCacheObject: createdCache, event: 'cache_context_create_failed_invalid_response_sdk' }, "Failed to create context cache: Invalid cache object returned by SDK.");
                        return null;
                    }
                    methodLogger.info({ cacheName: createdCache.name, model: createdCache.model, event: 'cache_context_create_success' }, `Context cache "${createdCache.name}" created successfully.`);
                    this.contextCachesInternal.set(cacheKey, createdCache);
                    this.persistenceService.setPersistentCacheName(cacheKey, createdCache.name);
                    await this.persistenceService.saveMap(methodLogger);
                    return createdCache;
                } catch (cacheError: unknown) {
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(cacheError);
                    methodLogger.error({ ...createContext, err: { message: errorMessage, stack: errorStack }, event: 'cache_context_create_failed_sdk_exception' }, `Failed to create NEW context cache via SDK: "${errorMessage}".`);
                    // Các log chi tiết về lỗi model, permission, quota vẫn hữu ích
                    if (String(errorMessage).includes("invalid model") || String(errorMessage).includes("model not found")) {
                        methodLogger.error({ ...createContext, modelForCache: cacheCreateParams.model, event: 'cache_context_create_failed_invalid_model_sdk' }, "Check model name for Gemini caching API.");
                    } else if (String(errorMessage).includes("permission denied") || String(errorMessage).includes("quota")) {
                        methodLogger.error({ ...createContext, event: 'cache_context_create_failed_permission_or_quota_sdk' }, `Permission denied or quota issue during cache creation: "${errorMessage}".`);
                    }
                    return null;
                }
            } catch (outerError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(outerError);
                methodLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'cache_context_logic_unhandled_error' }, `Unhandled exception in cache get/create: "${errorMessage}".`);
                return null;
            } finally {
                this.cachePromisesInternal.delete(cacheKey);
                methodLogger.debug({ event: 'cache_context_promise_deleted' }, "Removed cache creation/retrieval promise.");
            }
        })();
        this.cachePromisesInternal.set(cacheKey, cachePromise);
        methodLogger.debug({ event: 'cache_context_promise_set' }, "Cache creation/retrieval promise stored.");
        return await cachePromise;
    }

    public async removePersistentEntry(cacheKey: string, logger: Logger): Promise<void> {
        const methodLogger = logger.child({ function: 'removePersistentCacheEntryContextSvc', cacheKey }); // Đổi tên function để phân biệt
        if (this.persistenceService.hasPersistentCacheName(cacheKey)) {
            methodLogger.warn({ event: 'cache_persistent_entry_remove_start' }, `Removing persistent cache entry for "${cacheKey}".`);
            this.persistenceService.deletePersistentCacheName(cacheKey);
            await this.persistenceService.saveMap(methodLogger);
            methodLogger.info({ event: 'cache_persistent_entry_remove_success' }, `Persistent cache entry for "${cacheKey}" removed.`);
        } else {
            methodLogger.debug({ event: 'cache_persistent_entry_remove_skipped_not_found' }, `No persistent entry for "${cacheKey}" to remove.`);
        }
        if (this.contextCachesInternal.has(cacheKey)) {
            methodLogger.warn({ source: 'in-memory', event: 'cache_inmemory_entry_remove_on_persistent_remove' }, `Removing in-memory cache for "${cacheKey}".`);
            this.contextCachesInternal.delete(cacheKey);
        }
    }

    public deleteInMemoryOnly(cacheKey: string, logger: Logger): void {
        const methodLogger = logger.child({ function: 'deleteInMemoryOnlyContextSvc', cacheKey }); // Đổi tên function
        if (this.contextCachesInternal.has(cacheKey)) {
            methodLogger.warn({ source: 'in-memory', event: 'cache_inmemory_entry_remove_only' }, `Removing in-memory cache for "${cacheKey}" (not persistent).`);
            this.contextCachesInternal.delete(cacheKey);
        } else {
            methodLogger.debug({ source: 'in-memory', event: 'cache_inmemory_entry_not_found_to_delete' }, `In-memory entry for "${cacheKey}" not found.`);
        }
    }
}