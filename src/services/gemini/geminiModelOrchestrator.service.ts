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
export interface ModelPreparationResult {
    model: GenerativeModel;
    contentRequest: GenerateContentRequest | string;
    usingCacheActual: boolean;
    currentCache: CachedContent | null;
    crawlModelUsed: CrawlModelType; // <<< THÊM TRƯỜNG NÀY
    modelNameUsed: string; // << Cũng nên thêm modelName thực tế đã được chuẩn bị
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
        generationConfig: SDKGenerationConfig, // generationConfig đã được chuẩn bị
        currentPrompt: string,
        shouldUseCache: boolean,
        crawlModel: CrawlModelType, // <<< NHẬN crawlModel LÀM THAM SỐ
        logger: Logger
    ): Promise<ModelPreparationResult> {
        let model: GenerativeModel | undefined;
        // Khởi tạo để TypeScript không báo lỗi used before assigned nếu có đường dẫn phức tạp
        // Dù logic của bạn có vẻ đã bao phủ, đây là cách an toàn để làm TypeScript hài lòng.
        let contentRequest: GenerateContentRequest | string = ""; // Giá trị khởi tạo này sẽ bị ghi đè.

        let usingCacheActual = false;
        let currentCache: CachedContent | null = null;
        const cacheIdentifier = `${apiType}-${modelName}`;

        if (shouldUseCache) {
            const cacheSetupContext = { ...logger.bindings(), cacheIdentifier, event_group: 'cache_setup' };
            logger.debug({ ...cacheSetupContext, event: 'cache_context_attempt_setup_for_call' }, "Attempting to get or create cache for API call (as per dynamic decision).");
            try {
                currentCache = await this.contextCacheService.getOrCreateContext(
                    apiType, modelName, systemInstructionTextToUse, fewShotPartsToUse,
                    generationConfig, // Truyền generationConfig vào getOrCreateContext
                    logger
                );
            } catch (cacheSetupError: unknown) {
                const errorDetails = cacheSetupError instanceof Error ? { name: cacheSetupError.name, message: cacheSetupError.message } : { details: String(cacheSetupError) };
                logger.error({ ...cacheSetupContext, err: errorDetails, event: 'gemini_call_cache_setup_failed' }, "Critical error during cache setup for call, proceeding without cache");
                currentCache = null; // Đảm bảo currentCache là null nếu lỗi
            }

            if (currentCache?.name) { // Chỉ thực hiện nếu currentCache hợp lệ
                logger.info({ ...cacheSetupContext, cacheName: currentCache.name, apiType, modelName, event: 'cache_setup_use_success' }, "Attempting to use cached context object for call");
                try {
                    // Khi lấy model từ cache, generationConfig của cache sẽ được dùng.
                    // Tuy nhiên, khi gọi model.generateContent, nếu contentRequest là object
                    // thì generationConfig trong object đó sẽ ghi đè.
                    model = this.clientManager.getGenerativeModelFromCachedContent(currentCache, logger);
                    // Đối với model từ cache, contentRequest nên là object để có thể ghi đè generationConfig nếu cần
                    contentRequest = {
                        contents: [{ role: "user", parts: [{ text: currentPrompt }] }],
                        generationConfig: generationConfig // Ghi đè generationConfig ở đây
                    };
                    usingCacheActual = true;
                    logger.info({ ...cacheSetupContext, cacheName: currentCache.name, event: 'cache_model_from_cache_success' }, "Using cached context model with explicit generationConfig in request.");
                } catch (getModelError: unknown) {
                    const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                    logger.error({ ...cacheSetupContext, cacheName: currentCache?.name, err: errorDetails, event: 'gemini_call_model_from_cache_failed' }, "Error getting model from cached content, falling back to non-cached");
                    this.contextCacheService.deleteInMemoryOnly(cacheIdentifier, logger);
                    await this.contextCacheService.removePersistentEntry(cacheIdentifier, logger);
                    currentCache = null; // Đặt lại currentCache
                    usingCacheActual = false; // Quan trọng: Phải set lại đây
                }
            } else { // currentCache không hợp lệ hoặc getOrCreateContext lỗi
                logger.info({ ...cacheSetupContext, event: 'gemini_call_no_cache_available_or_setup_failed' }, "No valid cache object found/created or setup failed for call, proceeding without cache.");
                usingCacheActual = false;
            }
        } else { // shouldUseCache là false
            usingCacheActual = false;
        }

        // Khối này chỉ chạy nếu cache không được sử dụng HOẶC nếu việc sử dụng cache thất bại (usingCacheActual = false)
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

                // ++ TRUYỀN generationConfig vào getGenerativeModel
                model = this.clientManager.getGenerativeModel(modelName, systemInstructionContentForSdk, logger, generationConfig);

                if (fewShotPartsToUse.length > 0) {
                    const history: Content[] = [];
                    for (let i = 0; i < fewShotPartsToUse.length; i += 2) {
                        if (fewShotPartsToUse[i]) history.push({ role: "user", parts: [fewShotPartsToUse[i]] });
                        if (fewShotPartsToUse[i + 1]) history.push({ role: "model", parts: [fewShotPartsToUse[i + 1]] });
                    }
                    history.push({ role: "user", parts: [{ text: currentPrompt }] });
                    contentRequest = {
                        contents: history,
                        generationConfig: generationConfig, // Áp dụng generationConfig ở đây
                    };
                    logger.info({ ...nonCachedSetupContext, historyLength: history.length, event: 'non_cached_setup_request_with_history' }, "Using non-cached model with history and explicit generationConfig.");
                } else {
                    // Khi không có few-shot, contentRequest nên là object để truyền generationConfig
                    contentRequest = {
                        contents: [{ role: "user", parts: [{ text: currentPrompt }] }],
                        generationConfig: generationConfig // Áp dụng generationConfig ở đây
                    };
                    logger.info({ ...nonCachedSetupContext, event: 'non_cached_setup_request_simple_object' }, "Using simple non-cached model request (as object with explicit generationConfig).");
                }
            } catch (getModelError: unknown) {
                const errorDetails = getModelError instanceof Error ? { name: getModelError.name, message: getModelError.message } : { details: String(getModelError) };
                logger.error({ ...nonCachedSetupContext, generationModelName: modelName, err: errorDetails, event: 'non_cached_setup_failed' }, "Error getting non-cached generative model");
                throw getModelError; // Re-throw để dừng thực thi nếu model không thể tạo
            }
        }


        // Đảm bảo model được trả về là model thực tế đã được get (ví dụ sau khi fallback nếu có logic đó ở đây)
        // Giả sử modelName không thay đổi trong hàm này sau khi được truyền vào.
        // Nếu có logic thay đổi modelName bên trong prepareModel, bạn cần dùng modelName cuối cùng.

        if (!model) { // model là biến chứa GenerativeModel đã được khởi tạo
            // Dòng này gần như không thể đạt được nếu logic ở trên đúng và các lỗi được throw.
            // Nhưng để an toàn và rõ ràng.
            logger.fatal({ ...logger.bindings(), event: 'model_orchestration_critical_failure_final_check' }, "Model instance is undefined before final return.");
            throw new Error("Critical: Model could not be prepared (final check in orchestrator).");
        }

        return {
            model,
            contentRequest,
            usingCacheActual,
            currentCache,
            crawlModelUsed: crawlModel, // <<< TRẢ VỀ crawlModel ĐÃ SỬ DỤNG
            modelNameUsed: modelName,   // <<< TRẢ VỀ modelName ĐÃ SỬ DỤNG
        };
    }
}