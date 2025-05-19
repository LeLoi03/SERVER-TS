// src/services/gemini/geminiModelOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    type GenerativeModel,
    type CachedContent,
    type Part,
    type GenerateContentRequest,
    type Content,
    type GenerationConfig as SDKGenerationConfig,
} from "@google/generative-ai";
import { GeminiClientManagerService } from './geminiClientManager.service';
import { GeminiContextCacheService } from './geminiContextCache.service';
import { Logger } from 'pino';

export interface ModelPreparationResult {
    model: GenerativeModel;
    contentRequest: GenerateContentRequest | string;
    usingCacheActual: boolean;
    currentCache: CachedContent | null;
}

@singleton()
export class GeminiModelOrchestratorService {
    constructor(
        @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService,
        @inject(GeminiContextCacheService) private contextCacheService: GeminiContextCacheService,
    ) { }

    public async prepareModel(
        apiType: string,
        modelName: string,
        systemInstructionTextToUse: string, // Đã được quyết định bởi GeminiApiService
        fewShotPartsToUse: Part[],          // Đã được quyết định bởi GeminiApiService
        generationConfig: SDKGenerationConfig,
        currentPrompt: string,
        shouldUseCache: boolean,            // Đã được quyết định bởi GeminiApiService
        logger: Logger                      // Logger từ GeminiApiService với context đầy đủ
    ): Promise<ModelPreparationResult> {
        // logger đã có context từ GeminiApiService.callGeminiAPI

        let model: GenerativeModel | undefined;
        let contentRequest: GenerateContentRequest | string;
        let usingCacheActual = false;
        let currentCache: CachedContent | null = null;
        const cacheIdentifier = `${apiType}-${modelName}`;

        if (shouldUseCache) {
            const cacheSetupContext = { ...logger.bindings(), cacheIdentifier, event_group: 'cache_setup' };
            logger.debug({ ...cacheSetupContext, event: 'cache_context_attempt_setup_for_call' }, "Attempting to get or create cache for API call (as per dynamic decision).");
            try {
                currentCache = await this.contextCacheService.getOrCreateContext(
                    apiType, modelName, systemInstructionTextToUse, fewShotPartsToUse,
                    generationConfig, // Truyền generationConfig (đã có responseMimeType đúng)
                    logger
                );
            } catch (cacheSetupError: unknown) {
                const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
                logger.error({ ...cacheSetupContext, err: errorDetails, event: 'gemini_call_cache_setup_failed' }, "Critical error during cache setup for call, proceeding without cache");
                currentCache = null;
            }

            if (currentCache?.name) {
                logger.info({ ...cacheSetupContext, cacheName: currentCache.name, apiType, modelName, event: 'cache_setup_use_success' }, "Attempting to use cached context object for call");
                try {
                    model = this.clientManager.getGenerativeModelFromCachedContent(currentCache, logger);
                    contentRequest = currentPrompt;
                    usingCacheActual = true;
                    logger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_model_from_cache_success' }, "Using cached context model");
                } catch (getModelError: unknown) {
                    const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                    logger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'gemini_call_model_from_cache_failed' }, "Error getting model from cached content, falling back to non-cached");
                    this.contextCacheService.deleteInMemoryOnly(cacheIdentifier, logger);
                    await this.contextCacheService.removePersistentEntry(cacheIdentifier, logger);
                    currentCache = null;
                    usingCacheActual = false;
                }
            } else {
                logger.info({ ...cacheSetupContext, event: 'gemini_call_no_cache_available_or_setup_failed' }, "No valid cache object found/created or setup failed for call, proceeding without cache.");
                usingCacheActual = false;
            }
        } else { // shouldUseCache was false
            // Event log cho trường hợp này đã được xử lý ở GeminiApiService
            // logger.info({ ...logger.bindings(), event_group: 'cache_setup', event: 'gemini_cache_explicitly_disabled_by_caller' }, "Cache explicitly disabled by caller (e.g., tuned model or configuration).");
            usingCacheActual = false;
        }

        if (!usingCacheActual) {
            const nonCachedSetupContext = { ...logger.bindings(), event_group: 'non_cached_setup' };
            if (shouldUseCache && !usingCacheActual) { // Cache được bật nhưng thất bại
                logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_fallback' }, "Proceeding without cache (cache setup failed or no cache found despite being enabled).");
            } else { // Cache không được bật hoặc đây là luồng non-cached bình thường
                logger.debug({ ...nonCachedSetupContext, event: 'non_cached_setup_normal' }, "Setting up non-cached model.");
            }

            try {
                let systemInstructionContentForSdk: Content | undefined = undefined;
                if (systemInstructionTextToUse) {
                    systemInstructionContentForSdk = { role: "system", parts: [{ text: systemInstructionTextToUse }] };
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_using_system_instruction' }, "Model configured WITH system instruction (dynamically determined).");
                } else {
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_skipping_system_instruction' }, "Model configured WITHOUT system instruction (dynamically determined).");
                }
                model = this.clientManager.getGenerativeModel(modelName, systemInstructionContentForSdk, logger);

                if (fewShotPartsToUse.length > 0) {
                    const history: Content[] = [];
                    for (let i = 0; i < fewShotPartsToUse.length; i += 2) {
                        if (fewShotPartsToUse[i]) history.push({ role: "user", parts: [fewShotPartsToUse[i]] });
                        if (fewShotPartsToUse[i + 1]) history.push({ role: "model", parts: [fewShotPartsToUse[i + 1]] });
                    }
                    history.push({ role: "user", parts: [{ text: currentPrompt }] });
                    contentRequest = {
                        contents: history,
                        generationConfig: generationConfig,
                    };
                    logger.info({ ...nonCachedSetupContext, historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Using non-cached model with history (dynamically determined).");
                } else {
                    contentRequest = currentPrompt;
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_request_simple' }, "Using simple non-cached model request (dynamically determined).");
                }
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                logger.error({ ...nonCachedSetupContext, generationModelName: modelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
                throw getModelError;
            }
        }

        if (!model) {
            logger.fatal({ ...logger.bindings(), event: 'model_orchestration_critical_failure' }, "Model instance is undefined after preparation logic.");
            throw new Error("Critical: Model could not be prepared.");
        }
        // @ts-ignore : contentRequest is guaranteed to be assigned by the logic above
        return { model, contentRequest, usingCacheActual, currentCache };
    }
}