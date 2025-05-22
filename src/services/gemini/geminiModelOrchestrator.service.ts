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
import { CrawlModelType } from '../../types/crawl.types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

export interface ModelPreparationResult {
    model: GenerativeModel;
    contentRequest: GenerateContentRequest | string;
    usingCacheActual: boolean;
    currentCache: CachedContent | null;
    crawlModelUsed: CrawlModelType;
    modelNameUsed: string;
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
        systemInstructionTextToUse: string,
        fewShotPartsToUse: Part[],
        generationConfig: SDKGenerationConfig,
        currentPrompt: string,
        shouldUseCache: boolean,
        crawlModel: CrawlModelType,
        logger: Logger
    ): Promise<ModelPreparationResult> {
        let model: GenerativeModel | undefined;
        // KHẮC PHỤC LỖI: Khởi tạo contentRequest với một giá trị mặc định hợp lệ.
        // Giá trị này sẽ được ghi đè bởi logic bên dưới.
        let contentRequest: GenerateContentRequest | string = ""; 

        let usingCacheActual = false;
        let currentCache: CachedContent | null = null;
        const cacheIdentifier = `${apiType}-${modelName}`;

        // 1. Attempt to use cache if `shouldUseCache` is true
        if (shouldUseCache) {
            const cacheSetupContext = logger.child({ cacheIdentifier, event_group: 'cache_setup' });
            cacheSetupContext.debug({ event: 'cache_context_attempt_setup_for_call' }, "Attempting to get or create cache for API call as per dynamic decision.");
            try {
                currentCache = await this.contextCacheService.getOrCreateContext(
                    apiType,
                    modelName,
                    systemInstructionTextToUse,
                    fewShotPartsToUse,
                    generationConfig,
                    cacheSetupContext
                );
            } catch (cacheSetupError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(cacheSetupError);
                cacheSetupContext.error({ err: { message: errorMessage, stack: errorStack }, event: 'gemini_call_cache_setup_failed' }, `Critical error during cache setup for call: "${errorMessage}". Proceeding without cache.`);
                currentCache = null;
            }

            if (currentCache?.name) {
                cacheSetupContext.info({ cacheName: currentCache.name, apiType, modelName, event: 'cache_setup_use_success' }, "Attempting to use cached context object for call");
                try {
                    model = this.clientManager.getGenerativeModelFromCachedContent(currentCache, cacheSetupContext);
                    contentRequest = {
                        contents: [{ role: "user", parts: [{ text: currentPrompt }] }],
                        generationConfig: generationConfig
                    };
                    usingCacheActual = true;
                    cacheSetupContext.info({ cacheName: currentCache.name, event: 'cache_model_from_cache_success' }, "Using cached context model with explicit generationConfig in request.");
                } catch (getModelError: unknown) {
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(getModelError);
                    cacheSetupContext.error({ err: { message: errorMessage, stack: errorStack }, cacheName: currentCache?.name, event: 'gemini_call_model_from_cache_failed' }, `Error getting model from cached content: "${errorMessage}". Falling back to non-cached`);
                    this.contextCacheService.deleteInMemoryOnly(cacheIdentifier, cacheSetupContext);
                    await this.contextCacheService.removePersistentEntry(cacheIdentifier, cacheSetupContext);
                    currentCache = null;
                    usingCacheActual = false;
                }
            } else {
                cacheSetupContext.info({ event: 'gemini_call_no_cache_available_or_setup_failed' }, "No valid cache object found/created or setup failed for call, proceeding without cache.");
                usingCacheActual = false;
            }
        } else {
            logger.debug({ event: 'gemini_call_cache_disabled' }, "Caching is explicitly disabled for this call.");
            usingCacheActual = false;
        }

        // 2. Fallback to non-cached model setup if cache was not used (either disabled or failed)
        if (!usingCacheActual) {
            const nonCachedSetupContext = logger.child({ event_group: 'non_cached_setup' });
            if (shouldUseCache && !usingCacheActual) {
                nonCachedSetupContext.warn({ event: 'non_cached_setup_fallback' }, "Proceeding without cache because cache setup failed or no cache was found despite being enabled.");
            } else {
                nonCachedSetupContext.debug({ event: 'non_cached_setup_normal' }, "Setting up non-cached model.");
            }

            try {
                let systemInstructionContentForSdk: Content | undefined = undefined;
                if (systemInstructionTextToUse) {
                    systemInstructionContentForSdk = { role: "system", parts: [{ text: systemInstructionTextToUse }] };
                    nonCachedSetupContext.debug({ event: 'non_cached_setup_using_system_instruction' }, "Model configured WITH system instruction.");
                } else {
                    nonCachedSetupContext.debug({ event: 'non_cached_setup_skipping_system_instruction' }, "Model configured WITHOUT system instruction.");
                }

                model = this.clientManager.getGenerativeModel(modelName, systemInstructionContentForSdk, nonCachedSetupContext, generationConfig);

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
                    nonCachedSetupContext.info({ historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Prepared non-cached model request with history and explicit generationConfig.");
                } else {
                    contentRequest = {
                        contents: [{ role: "user", parts: [{ text: currentPrompt }] }],
                        generationConfig: generationConfig,
                    };
                    nonCachedSetupContext.info({ event: 'non_cached_setup_request_simple_object' }, "Prepared simple non-cached model request (as object with explicit generationConfig).");
                }
            } catch (getModelError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(getModelError);
                nonCachedSetupContext.fatal({ err: { message: errorMessage, stack: errorStack }, generationModelName: modelName, event: 'non_cached_setup_failed' }, `Fatal error: Failed to get non-cached generative model for "${modelName}": "${errorMessage}".`);
                throw getModelError;
            }
        }

        // Final validation: ensure `model` and `contentRequest` are set before returning
        if (!model || contentRequest === undefined) { // Check for undefined explicitly
            const finalErrorMsg = "Critical: Model or content request could not be prepared (internal state error in orchestrator).";
            logger.fatal({ ...logger.bindings(), event: 'model_orchestration_critical_failure_final_check' }, finalErrorMsg);
            throw new Error(finalErrorMsg);
        }

        logger.info({
            event: 'model_preparation_complete',
            modelNameUsed: modelName,
            crawlModelUsed: crawlModel,
            usingCacheActual: usingCacheActual,
            contentRequestType: typeof contentRequest === 'string' ? 'string' : 'object',
        }, `Model preparation completed. Using model "${modelName}" (crawl type: ${crawlModel}). Cache used: ${usingCacheActual}.`);

        return {
            model,
            contentRequest,
            usingCacheActual,
            currentCache,
            crawlModelUsed: crawlModel,
            modelNameUsed: modelName,
        };
    }
}