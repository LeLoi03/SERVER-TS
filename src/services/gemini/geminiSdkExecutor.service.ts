// src/services/gemini/geminiSdkExecutor.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { type RateLimiterMemory } from 'rate-limiter-flexible';
import { Logger } from 'pino';
import { type GenerateContentResult, Part } from "@google/generative-ai"; // Thêm Part
import { GeminiResponseHandlerService, type ProcessedGeminiResponse } from './geminiResponseHandler.service';
import { GeminiRequestPayloadFileLoggerService } from './geminiRequestPayloadFileLogger.service';
import { type ModelPreparationResult } from './geminiModelOrchestrator.service';
import { LoggingService } from '../logging.service';
import { CrawlModelType } from '../../types/crawl.types';

export interface SdkExecutorParams {
    limiterInstance: RateLimiterMemory;
    currentModelPrep: ModelPreparationResult;
    apiType: string;
    batchIndex: number;
    acronym: string | undefined;
    title: string | undefined;
    crawlModel: CrawlModelType;
    systemInstructionTextToUse: string;
    fewShotPartsToUse: Part[]; // Sửa kiểu dữ liệu
    requestLogDir: string;
}

@singleton()
export class GeminiSdkExecutorService {
    private readonly serviceBaseLogger: Logger;

    constructor(
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GeminiResponseHandlerService) private responseHandler: GeminiResponseHandlerService,
        @inject(GeminiRequestPayloadFileLoggerService) private payloadFileLogger: GeminiRequestPayloadFileLoggerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('main', { service: 'GeminiSdkExecutorService' });
        this.serviceBaseLogger.info("Constructing GeminiSdkExecutorService.");
    }

    public async executeSdkCall(
        params: SdkExecutorParams,
        parentAttemptLogger: Logger
    ): Promise<ProcessedGeminiResponse> {
        const attemptApiCallLogger = parentAttemptLogger.child({
            // serviceMethod, function (của retry), attempt đã có từ parentAttemptLogger
            // Thêm định danh cho function của service này và giữ event_group
            sdkExecFunc: 'GeminiSdkExecutorService.executeSdkCall',
            event_group: 'gemini_api_attempt' // Giữ nguyên event_group từ gốc
        });

        const {
            limiterInstance, currentModelPrep, apiType, batchIndex, acronym, title,
            crawlModel, systemInstructionTextToUse, fewShotPartsToUse, requestLogDir
        } = params;

        if (!currentModelPrep.model) {
            attemptApiCallLogger.error({ event: 'gemini_api_model_missing_before_generate' }, "Model object is undefined before calling generateContent.");
            throw new Error("Model is not initialized for generateContent");
        }

        // await this.payloadFileLogger.logRequestPayload({
        //     parentAttemptLogger: attemptApiCallLogger,
        //     requestLogDir,
        //     apiType,
        //     modelNameUsed: currentModelPrep.modelNameUsed,
        //     acronym,
        //     batchIndex,
        //     title,
        //     crawlModel,
        //     usingCacheActual: currentModelPrep.usingCacheActual,
        //     currentCacheName: currentModelPrep.currentCache?.name,
        //     systemInstructionApplied: systemInstructionTextToUse,
        //     fewShotPartsApplied: fewShotPartsToUse,
        //     contentRequest: currentModelPrep.contentRequest,
        //     generationConfigSent: (typeof currentModelPrep.contentRequest === 'object' && currentModelPrep.contentRequest.generationConfig)
        //         ? currentModelPrep.contentRequest.generationConfig
        //         : undefined,
        //     generationConfigEffective: currentModelPrep.model.generationConfig
        // });

        const rateLimitKey = `${apiType}_${batchIndex}_${currentModelPrep.modelNameUsed}`;
        attemptApiCallLogger.debug({ event: 'gemini_api_rate_limit_consume' }, `Attempting to consume rate limit points`);
        try {
            await limiterInstance.consume(rateLimitKey, 1);
            attemptApiCallLogger.debug({ event: 'gemini_api_rate_limit_passed' }, `Rate limit check passed. Sending request...`);
        } catch (rlError: unknown) {
            attemptApiCallLogger.warn({ event: 'gemini_api_rate_limit_failed' }, `Rate limit consumption failed.`);
            throw rlError;
        }

        let sdkApiResult: GenerateContentResult;
        try {
            attemptApiCallLogger.info({ requestType: typeof currentModelPrep.contentRequest === 'string' ? 'string' : 'object', event: 'gemini_api_generate_start' }, "Calling model.generateContent");
            sdkApiResult = await currentModelPrep.model.generateContent(currentModelPrep.contentRequest);
            attemptApiCallLogger.info({ event: 'gemini_api_generate_success' }, "model.generateContent successful");
        } catch (genError: unknown) {
            const errorDetails = genError instanceof Error ? { name: genError.name, message: genError.message } : { details: String(genError) };
            attemptApiCallLogger.error({ err: errorDetails, event: 'gemini_api_generate_content_failed' }, "Error during model.generateContent");
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
            cacheName: currentModelPrep.usingCacheActual ? currentModelPrep.currentCache?.name : 'N/A',
            modelUsed: currentModelPrep.modelNameUsed, // THÊM
            crawlModel: currentModelPrep.crawlModelUsed, // THÊM
            event: 'gemini_api_attempt_success'
        }, "Gemini API request processed successfully for this attempt.");
        return processed;
    }
}