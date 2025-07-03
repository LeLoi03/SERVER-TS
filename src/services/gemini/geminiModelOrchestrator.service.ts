// src/services/gemini/geminiModelOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    type CachedContent,
    type Part,
    type Content, // Giữ lại Content để tạo cấu trúc few-shot và system instruction
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

    public async prepareModel(
        apiType: string,
        modelName: string, // Tên model sẽ được sử dụng, ví dụ "gemini-1.5-flash-latest"
        systemInstructionTextToUse: string, // Sẽ được Executor thêm vào config
        fewShotPartsToUse: Part[],
        generationConfig: SDKGenerateContentConfig, // Config cơ bản từ caller
        currentPrompt: string,
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
        const cacheIdentifier = `${apiType}-${modelName}`; // Giữ nguyên cacheIdentifier

        // Tạo một bản sao của generationConfig để có thể sửa đổi cục bộ nếu cần
        // (ví dụ: thêm cachedContent name sau này bởi Executor)
        // Tuy nhiên, ở bước này, chúng ta chỉ truyền config gốc.
        const preparedGenerationConfig: SDKGenerateContentConfig = { ...generationConfig };

        // 1. Xử lý Cache
        if (shouldUseCache) {
            const cacheSetupContext = logger.child({ cacheIdentifier, event_group: 'cache_setup_orchestrator' });
            cacheSetupContext.debug({ event: 'cache_context_attempt_for_call' }, "Attempting to get or create cache.");
            try {
                currentCache = await this.contextCacheService.getOrCreateContext(
                    apiType,
                    modelName, // modelName cho cache (ví dụ: 'gemini-1.5-flash')
                    systemInstructionTextToUse, // systemInstruction cho cache
                    fewShotPartsToUse,          // fewShotParts cho cache
                    preparedGenerationConfig,   // generationConfig cho cache (ít quan trọng hơn system/fewshot)
                    cacheSetupContext
                );
            } catch (cacheSetupError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(cacheSetupError);
                cacheSetupContext.error({ err: { message: errorMessage, stack: errorStack }, event: 'cache_setup_failed_orchestrator' }, `Error during cache setup: "${errorMessage}". Proceeding without cache.`);
                currentCache = null;
            }

            if (currentCache?.name) {
                cacheSetupContext.info({ cacheName: currentCache.name, apiType, modelName, event: 'cache_will_be_used_orchestrator' }, "Valid cache found/created. It will be used by the executor.");
                usingCacheActual = true;
                // Nội dung request khi có cache chỉ là prompt hiện tại.
                // Cache name sẽ được thêm vào generationConfig bởi Executor.
                contentRequest = [{ role: "user", parts: [{ text: currentPrompt }] }];
            } else {
                cacheSetupContext.info({ event: 'no_valid_cache_available_orchestrator' }, "No valid cache, proceeding without cache.");
                usingCacheActual = false;
            }
        } else {
            logger.debug({ event: 'cache_disabled_orchestrator' }, "Caching explicitly disabled.");
            usingCacheActual = false;
        }

        // 2. Chuẩn bị contentRequest nếu không dùng cache (hoặc cache thất bại)
        if (!usingCacheActual) {
            const nonCachedSetupContext = logger.child({ event_group: 'non_cached_content_setup' });
            nonCachedSetupContext.debug({ event: 'preparing_non_cached_content' }, "Preparing content for non-cached request.");

            const history: Content[] = [];

            // System instruction sẽ được Executor thêm vào generationConfig.
            // Ở đây, chúng ta chỉ tập trung vào việc xây dựng `contents` (few-shot + prompt).

            if (fewShotPartsToUse.length > 0) {
                for (let i = 0; i < fewShotPartsToUse.length; i += 2) {
                    if (fewShotPartsToUse[i]) history.push({ role: "user", parts: [fewShotPartsToUse[i]] });
                    if (fewShotPartsToUse[i + 1]) history.push({ role: "model", parts: [fewShotPartsToUse[i + 1]] });
                }
                nonCachedSetupContext.debug({ numFewShotTurns: history.length / 2, event: 'few_shot_history_prepared' }, "Few-shot examples added to history.");
            }

            history.push({ role: "user", parts: [{ text: currentPrompt }] });
            contentRequest = history; // SDKContentListUnion có thể là Content[]

            nonCachedSetupContext.info({
                historyLength: history.length,
                event: 'non_cached_content_request_prepared'
            }, "Prepared content request (history + current prompt) for non-cached call.");
        }

        // contentRequest phải được đảm bảo đã được gán giá trị
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
            model: modelsService, // Trả về service Models
            contentRequest,       // Trả về SDKContentListUnion (prompt + few-shot nếu có)
            finalGenerationConfig: preparedGenerationConfig, // Trả về config cơ bản
            usingCacheActual,
            currentCache,
            crawlModelUsed: crawlModel,
            modelNameUsed: modelName, // Tên model để Executor sử dụng
        };
    }
}