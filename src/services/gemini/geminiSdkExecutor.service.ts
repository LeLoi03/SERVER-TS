// src/services/gemini/geminiSdkExecutor.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import {
    type GenerateContentResponse,
    // Alias cho rõ ràng
    GenerateContentParameters as SDKGenerateContentParameters,
    GenerateContentConfig as SDKGenerateContentConfig,
    ContentListUnion as SDKContentListUnion
} from "@google/genai";
import { GeminiResponseHandlerService } from './geminiResponseHandler.service';
// import { GeminiRequestPayloadFileLoggerService } from './geminiRequestPayloadFileLogger.service';
import { LoggingService } from '../logging.service';
import {
    SdkExecutorParams,
    ProcessedGeminiResponse,
} from '../../types/crawl';



@singleton()
export class GeminiSdkExecutorService {
    private readonly serviceBaseLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GeminiResponseHandlerService) private responseHandler: GeminiResponseHandlerService,
        // @inject(GeminiRequestPayloadFileLoggerService) private payloadFileLogger: GeminiRequestPayloadFileLoggerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'GeminiSdkExecutorService' });
        this.serviceBaseLogger.info("Constructing GeminiSdkExecutorService.");
    }

    public async executeSdkCall(
        params: SdkExecutorParams, // SdkExecutorParams chứa systemInstructionTextToUse và fewShotPartsToUse (đã được Orchestrator xử lý)
        parentAttemptLogger: Logger
    ): Promise<ProcessedGeminiResponse> {
        const attemptApiCallLogger = parentAttemptLogger.child({
            sdkExecFunc: 'GeminiSdkExecutorService.executeSdkCall',
            event_group: 'gemini_api_attempt'
        });

        const {
            limiterInstance, currentModelPrep, apiType, batchIndex, acronym,
            systemInstructionTextToUse
        } = params;

        // currentModelPrep.model là service Models
        if (!currentModelPrep.model || typeof currentModelPrep.model.generateContent !== 'function') {
            attemptApiCallLogger.error({ event: 'gemini_api_models_service_missing_before_generate' }, "Models service object is undefined or invalid.");
            throw new Error("Models service is not initialized for generateContent");
        }
        if (!currentModelPrep.contentRequest) {
            attemptApiCallLogger.error({ event: 'gemini_api_content_request_missing_from_prep' }, "Content request is missing from model preparation result.");
            throw new Error("Content request is missing from model preparation result.");
        }

        // --- Xây dựng tham số cho SDK call ---
        const sdkCallConfig: SDKGenerateContentConfig = {
            ...(currentModelPrep.finalGenerationConfig || {}), // Bắt đầu với config từ Orchestrator
        };

        // 1. Thêm System Instruction vào config
        if (systemInstructionTextToUse) {
            // SDK mới cho phép systemInstruction là string, Part, hoặc Content
            // Để đơn giản và nhất quán, có thể dùng cấu trúc Content hoặc Part
            sdkCallConfig.systemInstruction = { role: "system", parts: [{ text: systemInstructionTextToUse }] };
            // Hoặc đơn giản là: sdkCallConfig.systemInstruction = systemInstructionTextToUse; nếu SDK hỗ trợ trực tiếp string
        }

        // 2. Thêm Cached Content vào config nếu có
        if (currentModelPrep.usingCacheActual && currentModelPrep.currentCache?.name) {
            sdkCallConfig.cachedContent = currentModelPrep.currentCache.name;
            attemptApiCallLogger.info({ cacheName: currentModelPrep.currentCache.name, event: 'gemini_api_using_cache_in_config' }, "Cache will be used for this SDK call.");
        }

        // `currentModelPrep.contentRequest` đã bao gồm few-shot (nếu có) và prompt chính từ Orchestrator
        const sdkCallContents: SDKContentListUnion = currentModelPrep.contentRequest;

        const paramsForSDK: SDKGenerateContentParameters = {
            model: currentModelPrep.modelNameUsed, // Tên model đã được Orchestrator quyết định
            contents: sdkCallContents,
            config: sdkCallConfig,
        };

        // --- Ghi log payload (nếu bỏ comment và điều chỉnh) ---
        // const generationConfigForLogging = paramsForSDK.generationConfig;
        // await this.payloadFileLogger.logRequestPayload({
        //     parentAttemptLogger: attemptApiCallLogger,
        //     requestLogDir,
        //     apiType,
        //     modelNameUsed: currentModelPrep.modelNameUsed,
        //     acronym,
        //     batchIndex,
        //     title,
        //     crawlModel: params.crawlModel, // crawlModel gốc của request
        //     usingCacheActual: currentModelPrep.usingCacheActual,
        //     currentCacheName: currentModelPrep.currentCache?.name,
        //     systemInstructionApplied: systemInstructionTextToUse, 
        //     fewShotPartsApplied: params.fewShotPartsToUse, // fewShotParts gốc của request (Orchestrator đã xử lý chúng)
        //     contentRequest: paramsForSDK.contents, 
        //     generationConfigSent: generationConfigForLogging,
        //     // generationConfigEffective: // Khó xác định chính xác trước khi gọi
        // });

        const rateLimitKey = `${apiType}_${batchIndex}_${currentModelPrep.modelNameUsed}`;
        attemptApiCallLogger.debug({ event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points for ${rateLimitKey}`);
        try {
            await limiterInstance.consume(rateLimitKey, 1);
            attemptApiCallLogger.debug({ event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed for ${rateLimitKey}.`);
        } catch (rlError: unknown) {
            attemptApiCallLogger.warn({ event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed for ${rateLimitKey}.`);
            throw rlError;
        }

        let sdkApiResult: GenerateContentResponse;
        try {
            attemptApiCallLogger.info({
                requestModel: paramsForSDK.model,
                requestConfigPreview: {
                    temp: paramsForSDK.config?.temperature,
                    sysInstruction: !!paramsForSDK.config?.systemInstruction,
                    cachedContent: paramsForSDK.config?.cachedContent
                },
                contentLength: Array.isArray(paramsForSDK.contents) ? paramsForSDK.contents.length : typeof paramsForSDK.contents === 'string' ? 1 : 'object',
                event: 'gemini_api_generate_start'
            }, "Calling ModelsService.generateContent");

            sdkApiResult = await currentModelPrep.model.generateContent(paramsForSDK);

            attemptApiCallLogger.info({ event: 'gemini_api_generate_success' }, "ModelsService.generateContent successful");
        } catch (genError: unknown) {
            const errorDetails = genError instanceof Error ? { name: genError.name, message: genError.message } : { details: String(genError) };
            attemptApiCallLogger.error({ err: errorDetails, event: 'gemini_api_generate_content_failed' }, "Error during ModelsService.generateContent");
            throw genError;
        }

        const processingLogger = attemptApiCallLogger.child({ sub_op: 'responseProcessing' });
        const processed = this.responseHandler.processResponse(sdkApiResult, processingLogger);

        const fileWriteLogger = attemptApiCallLogger.child({ sub_op: 'responseFileWrite' });
        this.responseHandler.writeResponseToFile(
            processed.responseText, apiType, acronym, batchIndex, fileWriteLogger
        );

        attemptApiCallLogger.info({
            responseLength: processed.responseText.length,
            metaData: processed.metaData,
            tokens: processed.metaData?.totalTokenCount,
            usingCache: currentModelPrep.usingCacheActual,
            cacheName: currentModelPrep.currentCache?.name || 'N/A',
            modelUsed: currentModelPrep.modelNameUsed,
            crawlModel: currentModelPrep.crawlModelUsed,
            event: 'gemini_api_attempt_success'
        }, "Gemini API request processed successfully for this attempt.");
        return processed;
    }
}