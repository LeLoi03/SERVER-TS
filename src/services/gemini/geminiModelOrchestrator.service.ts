// src/services/gemini/geminiModelOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    type CachedContent,
    type Part,
    type Content,
    GenerateContentConfig as SDKGenerateContentConfig,
    ContentListUnion as SDKContentListUnion
} from "@google/genai";
import { GeminiClientManagerService } from './geminiClientManager.service';
import { GeminiContextCacheService } from './geminiContextCache.service';
import { Logger } from 'pino';
import { CrawlModelType } from '../../types/crawl/crawl.types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { ModelPreparationResult } from '../../types/crawl'; // Đã cập nhật ModelPreparationResult

// Alias cho rõ ràng


@singleton()
export class GeminiModelOrchestratorService {
    constructor(
        @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService,
        @inject(GeminiContextCacheService) private contextCacheService: GeminiContextCacheService,
    ) { }

    // +++ HÀM NÀY ĐƯỢC CẬP NHẬT ĐỂ NHẬN `userContent` +++
    public async prepareModel(
        apiType: string,
        modelName: string,
        systemInstructionTextToUse: string,
        fewShotPartsToUse: Part[],
        generationConfig: SDKGenerateContentConfig,
        // Thay thế `currentPrompt: string` bằng `userContent: ContentListUnion`
        userContent: SDKContentListUnion,
        shouldUseCache: boolean,
        crawlModel: CrawlModelType,
        logger: Logger
    ): Promise<ModelPreparationResult> {
        logger.info({
            event: 'model_preparation_start', // Đổi tên event cho rõ ràng hơn
            apiType,
            modelNameForPrep: modelName,
            crawlModelForPrep: crawlModel,
            shouldUseCache
        }, `Starting model preparation for ${modelName} (API type: ${apiType}).`);

        // Lấy service Models từ clientManager
        const modelsService = this.clientManager.getModelsService(apiType);
        if (!modelsService) { // Kiểm tra bổ sung
            logger.fatal({ apiType, event: 'model_preparation_no_models_service' }, `Fatal: Models service not available for API type ${apiType}.`);
            throw new Error(`Models service not available for API type ${apiType}.`);
        }

        let contentRequest: SDKContentListUnion | undefined = undefined;
        let usingCacheActual = false;
        let currentCache: CachedContent | null = null;
        const cacheIdentifier = `${apiType}-${modelName}`;
        const preparedGenerationConfig: SDKGenerateContentConfig = { ...generationConfig };

        // +++ LOGIC MỚI: KIỂM TRA XEM YÊU CẦU CÓ PHẢI LÀ MULTIMODAL KHÔNG +++
        // Yêu cầu là multimodal nếu `userContent` là một mảng và chứa ít nhất một part không phải là text.
        // Hoặc đơn giản hơn, nếu là mảng thì coi như có khả năng là multimodal.
        const isMultimodalRequest = Array.isArray(userContent);
        const canUseCache = shouldUseCache && !isMultimodalRequest; // Chỉ dùng cache nếu được phép VÀ không phải multimodal


        // 1. Xử lý Cache (chỉ khi có thể)
        if (canUseCache) {
            const cacheSetupContext = logger.child({ cacheIdentifier, event_group: 'cache_setup_orchestrator' });
            cacheSetupContext.debug({ event: 'cache_context_attempt_for_call' }, "Attempting to get or create cache for text-only request.");
            try {
                // `userContent` lúc này chắc chắn là string
                const currentPrompt = userContent as string;
                currentCache = await this.contextCacheService.getOrCreateContext(
                    apiType, modelName, systemInstructionTextToUse, fewShotPartsToUse,
                    preparedGenerationConfig, cacheSetupContext
                );
            } catch (cacheSetupError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(cacheSetupError);
                cacheSetupContext.error({ err: { message: errorMessage, stack: errorStack }, event: 'cache_setup_failed_orchestrator' }, `Error during cache setup: "${errorMessage}". Proceeding without cache.`);
                currentCache = null;
            }

            if (currentCache?.name) {
                cacheSetupContext.info({ cacheName: currentCache.name, event: 'cache_will_be_used_orchestrator' }, "Valid cache found/created.");
                usingCacheActual = true;
                // Khi có cache, nội dung request chỉ là prompt hiện tại (dạng text)
                const currentPrompt = userContent as string;
                contentRequest = [{ role: "user", parts: [{ text: currentPrompt }] }];
            } else {
                cacheSetupContext.info({ event: 'no_valid_cache_available_orchestrator' }, "No valid cache, proceeding without cache.");
                usingCacheActual = false;
            }
        } else {
            logger.debug({ event: 'cache_disabled_or_multimodal_orchestrator', canUseCache, isMultimodalRequest, shouldUseCacheConfig: shouldUseCache }, "Caching disabled or request is multimodal.");
            usingCacheActual = false;
        }

        // 2. Chuẩn bị contentRequest nếu không dùng cache
        if (!usingCacheActual) {
            const nonCachedSetupContext = logger.child({ event_group: 'non_cached_content_setup' });


            const history: Content[] = [];

            if (fewShotPartsToUse.length > 0) {
                for (let i = 0; i < fewShotPartsToUse.length; i += 2) {
                    if (fewShotPartsToUse[i]) history.push({ role: "user", parts: [fewShotPartsToUse[i]] });
                    if (fewShotPartsToUse[i + 1]) history.push({ role: "model", parts: [fewShotPartsToUse[i + 1]] });
                }
                nonCachedSetupContext.debug({ numFewShotTurns: history.length / 2, event: 'few_shot_history_prepared' }, "Few-shot examples added to history.");
            }

            // +++ LOGIC MỚI: XỬ LÝ `userContent` ĐỂ THÊM VÀO HISTORY +++
            if (isMultimodalRequest) {
                // Nếu là mảng Part (multimodal), bọc nó trong một Content object
                history.push({ role: "user", parts: userContent as Part[] });
            } else {
                // Nếu là string (text-only), bọc nó trong một Part rồi trong một Content object
                history.push({ role: "user", parts: [{ text: userContent as string }] });
            }


            contentRequest = history;

            nonCachedSetupContext.info({
                historyLength: history.length,
                isMultimodal: isMultimodalRequest,
                event: 'non_cached_content_request_prepared'
            }, "Prepared content request (history + current prompt) for non-cached call.");
        }

        if (contentRequest === undefined) {
            const finalErrorMsg = "Critical: Content request could not be prepared (internal state error in orchestrator).";
            logger.fatal({ ...logger.bindings(), event: 'model_orchestration_content_request_undefined' }, finalErrorMsg);
            throw new Error(finalErrorMsg);
        }
        
        logger.info({
            event: 'model_preparation_complete',
            modelNameUsed: modelName,
            crawlModelUsed: crawlModel,
            usingCacheActual: usingCacheActual,
            cacheName: currentCache?.name || 'N/A',
            contentRequestLength: Array.isArray(contentRequest) ? contentRequest.length : 1,
        }, `Model preparation completed for "${modelName}". Cache used: ${usingCacheActual}.`);

        return {
            model: modelsService,
            contentRequest,
            finalGenerationConfig: preparedGenerationConfig,
            usingCacheActual,
            currentCache,
            crawlModelUsed: crawlModel,
            modelNameUsed: modelName,
        };
    }
}