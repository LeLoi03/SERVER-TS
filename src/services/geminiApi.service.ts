// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    type Part,
    type GenerateContentResult, // For type hint if SDK result passed around
    type GenerationConfig as SDKGenerationConfig,
    type UsageMetadata,
} from "@google/generative-ai";
import { RateLimiterRes, type RateLimiterMemory } from 'rate-limiter-flexible';
import { ConfigService, type GeminiApiConfig as GeneralApiTypeConfig, type AppConfig } from '../config/config.service'; // Renamed GeminiApiConfig to GeneralApiTypeConfig for clarity
import { LoggingService } from './logging.service'; // Adjust path
import { Logger } from 'pino';

// Import new Gemini sub-services (adjust paths as needed)
import { GeminiClientManagerService } from './gemini/geminiClientManager.service';
import { GeminiCachePersistenceService } from './gemini/geminiCachePersistence.service';
import { GeminiContextCacheService } from './gemini/geminiContextCache.service';
import { GeminiRateLimiterService } from './gemini/geminiRateLimiter.service';
import { GeminiModelOrchestratorService, type ModelPreparationResult } from './gemini/geminiModelOrchestrator.service';
import { GeminiResponseHandlerService, type ProcessedGeminiResponse } from './gemini/geminiResponseHandler.service';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs'; // Thêm fsPromises, existsSync
import { CrawlModelType } from '../types/crawl.types';

export interface ApiResponse {
    responseText: string;
    metaData: UsageMetadata | null | undefined;
}

type RetryableGeminiApiCall = (
    limiter: RateLimiterMemory,
    modelPrep: ModelPreparationResult,
    attemptLogger: Logger
) => Promise<ProcessedGeminiResponse>;


// Thêm một kiểu trả về cho executeWithRetry để báo hiệu lỗi 5xx và cần fallback
interface ExecuteWithRetryResult extends ProcessedGeminiResponse {
    finalErrorType?: '5xx_non_retryable_for_current_model'; // Cho biết lỗi 5xx và đã hết retries với model hiện tại
}

// Thêm InternalCallGeminiApiParams để bao gồm crawlModel
interface InternalCallGeminiApiParams {
    batchPrompt: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
    apiType: string;
    modelName: string; // Model name cụ thể từ danh sách (vd: 'gemini-pro' hoặc 'models/my-tuned-model-xyz')
    fallbackModelName?: string;
    crawlModel: CrawlModelType; // << THÊM VÀO ĐÂY: 'tuned' hoặc 'non-tuned'
}

export interface GeminiApiParams {
    batch: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
}

@singleton()
export class GeminiApiService {
    private readonly serviceBaseLogger: Logger;
    private readonly appConfig: AppConfig; // Store the whole app config
    private readonly generalApiTypeSettings: Record<string, GeneralApiTypeConfig>; // Stores general settings per API type
    private readonly maxRetries: number;
    private readonly initialDelayMs: number;
    private readonly maxDelayMs: number;

    public readonly API_TYPE_EXTRACT = 'extract';
    public readonly API_TYPE_DETERMINE = 'determine';
    public readonly API_TYPE_CFP = 'cfp';

    // ++ REINSTATED MODEL INDICES
    private extractModelIndex: number = 0;
    private cfpModelIndex: number = 0;
    private determineModelIndex: number = 0; // For determine as well

    private serviceInitialized: boolean = false;
    private readonly requestLogDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService,
        @inject(GeminiCachePersistenceService) private cachePersistence: GeminiCachePersistenceService,
        @inject(GeminiContextCacheService) private contextCache: GeminiContextCacheService,
        @inject(GeminiRateLimiterService) private rateLimiters: GeminiRateLimiterService,
        @inject(GeminiModelOrchestratorService) private modelOrchestrator: GeminiModelOrchestratorService,
        @inject(GeminiResponseHandlerService) private responseHandler: GeminiResponseHandlerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'GeminiApiServiceBase' });
        this.serviceBaseLogger.info("Constructing GeminiApiService (with Tuned/Non-Tuned model indexing)...");

        this.appConfig = this.configService.config;
        this.generalApiTypeSettings = this.configService.geminiApiConfigs;
        this.maxRetries = this.appConfig.GEMINI_MAX_RETRIES;
        this.initialDelayMs = this.appConfig.GEMINI_INITIAL_DELAY_MS;
        this.maxDelayMs = this.appConfig.GEMINI_MAX_DELAY_MS;

        const baseOutputDir = this.configService.baseOutputDir || path.join(process.cwd(), 'outputs');
        this.requestLogDir = path.join(baseOutputDir, 'gemini_api_requests_log');
        this.serviceBaseLogger.info({ requestLogDir: this.requestLogDir }, "Gemini API request logging directory initialized.");
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GeminiApiService.${methodName}`, ...additionalContext });
    }

    // ++ MODIFIED: Added crawlModel parameter (though mostly for logging here, real use is in calls)
    public async init(parentLogger?: Logger, crawlModel?: CrawlModelType): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'init', { crawlModel });
        if (this.serviceInitialized) {
            logger.debug("GeminiApiService already initialized.");
            return;
        }
        logger.info({ event: 'gemini_service_async_init_start' }, "Running async initialization for GeminiApiService (loading cache map)...");
        try {
            await this.cachePersistence.loadMap(logger.child({ sub_service_op: 'GeminiCachePersistenceService.loadMap' }));
            this.clientManager.getGenAI(); // Check if client can be initialized
            this.serviceInitialized = true;
            logger.info({ event: 'gemini_service_async_init_complete' }, "GeminiApiService async initialization complete.");
        } catch (error) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            logger.error({ err: errorDetails, event: 'gemini_service_async_init_failed' }, "GeminiApiService async initialization failed.");
            // Potentially re-throw or handle as critical if init must succeed
        }
    }

    private ensureInitialized(logger: Logger): void {
        if (!this.serviceInitialized) {
            // Try to initialize if not already (e.g. if init() was skipped or failed silently)
            // This is a fallback, ideally init() should be called and awaited successfully.
            logger.warn({ event: 'gemini_service_lazy_init_attempt' }, "GeminiApiService was not initialized. Attempting lazy initialization. Call init() explicitly for robust startup.");
            // Synchronous part of init can be called here, but async part (loadMap) is tricky.
            // For simplicity, we'll throw if critical parts aren't ready.
            try {
                this.clientManager.getGenAI(); // Check this critical component
            } catch (e) {
                const errorMsg = "GoogleGenerativeAI client is not available, and service is not initialized. Cannot proceed.";
                logger.error({ event: 'gemini_service_critically_uninitialized', detail: errorMsg, underlyingError: (e as Error).message }, errorMsg);
                throw new Error(errorMsg);
            }
            // If we want to make `init` fully synchronous or ensure it's called, that's a larger refactor.
            // For now, let's assume `this.clientManager.getGenAI()` is the most critical check.
            // The `loadMap` is for caching, calls might proceed without it but be slower/less efficient.
        }
        try {
            this.clientManager.getGenAI();
        } catch (e) {
            const errorMsg = "GoogleGenerativeAI failed to initialize. Cannot proceed.";
            logger.error({ event: 'gemini_service_genai_not_ready', detail: errorMsg, underlyingError: (e as Error).message }, errorMsg);
            throw new Error(errorMsg);
        }
    }


    private async executeWithRetry(
        apiCallFn: RetryableGeminiApiCall,
        modelPreparation: ModelPreparationResult, // Giờ đây chứa crawlModelUsed và modelNameUsed
        apiType: string,
        batchIndex: number,
        // currentModelNameForRetry không còn cần thiết nếu modelPreparation.modelNameUsed là chính xác
        limiter: RateLimiterMemory,
        parentOperationLogger: Logger
    ): Promise<ExecuteWithRetryResult> {
        // Sử dụng modelNameUsed và crawlModelUsed từ modelPreparation cho context
        const modelNameForThisExecution = modelPreparation.modelNameUsed;
        const crawlModelForThisExecution = modelPreparation.crawlModelUsed;

        const retryLogicLogger = parentOperationLogger.child({
            function: 'executeWithRetry',
            apiType: apiType, // Context quan trọng
            batchIndex: batchIndex, // Context quan trọng
            modelBeingRetried: modelNameForThisExecution, // Sử dụng modelName từ modelPreparation
            crawlModel: crawlModelForThisExecution, // Sử dụng crawlModel từ modelPreparation
            // acronym, title sẽ được kế thừa từ parentOperationLogger nếu có
        });

        const cacheKeyForInvalidation = `${apiType}-${modelNameForThisExecution}`;

        retryLogicLogger.debug({ event: 'retry_loop_start' }, "Executing with retry logic");
        let retryCount = 0;
        let currentDelay = this.initialDelayMs;
        const defaultResponse: ExecuteWithRetryResult = { responseText: "", metaData: null };

        const commonLogContext = { // Context chung cho các log event trong attempt này
            apiType: apiType,
            modelName: modelNameForThisExecution,
            crawlModel: crawlModelForThisExecution,
            // batchIndex, acronym, title đã có trong logger
        };

        while (retryCount < this.maxRetries) {
            const attempt = retryCount + 1;
            // attemptLogger kế thừa context từ retryLogicLogger (bao gồm apiType, modelName, crawlModel, batchIndex)
            const attemptLogger = retryLogicLogger.child({
                attempt,
                maxAttempts: this.maxRetries,
            });

            if (attempt > 1) {
                attemptLogger.info({
                    ...commonLogContext,
                    event: 'retry_attempt_start',
                }, `Starting retry attempt ${attempt} for ${apiType} with model ${modelNameForThisExecution} (${crawlModelForThisExecution})`);
            } else {
                attemptLogger.info({
                    ...commonLogContext,
                    event: 'initial_attempt_start',
                }, `Starting initial attempt for ${apiType} with model ${modelNameForThisExecution} (${crawlModelForThisExecution})`);
            }

            try {
                // apiCallFn (singleAttemptFunction) sẽ nhận attemptLogger,
                // và nên log các event của nó (vd: gemini_api_generate_content_failed)
                // với đầy đủ context (apiType, modelName, crawlModel) được bind vào attemptLogger
                // hoặc được truyền rõ ràng.
                const successResult = await apiCallFn(limiter, modelPreparation, attemptLogger);
                // Nếu thành công, successResult được trả về, không cần log thêm ở đây.
                // singleAttemptFunction đã log 'gemini_api_attempt_success'.
                return { ...successResult, finalErrorType: undefined };
            } catch (error: unknown) {
                let shouldRetry = true;
                let invalidateCacheOnError = false;
                const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
                const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
                let errorEventForThisAttempt = 'retry_attempt_error_unknown';
                let is5xxError = false;

                if (error instanceof RateLimiterRes) {
                    const waitTimeMs = error.msBeforeNext;
                    attemptLogger.warn({
                        ...commonLogContext,
                        waitTimeMs,
                        event: 'retry_internal_rate_limit_wait',
                    }, `Internal rate limit for ${modelNameForThisExecution}. Waiting ${waitTimeMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                    continue; // Bỏ qua phần log lỗi chung và logic retry bên dưới
                }

                // Xác định loại lỗi
                if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                    errorEventForThisAttempt = 'retry_attempt_error_5xx';
                    is5xxError = true;
                } else if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                    errorEventForThisAttempt = 'retry_attempt_error_cache';
                    invalidateCacheOnError = true;
                } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted') || errorMessageLower.includes('rate limit')) {
                    errorEventForThisAttempt = 'retry_attempt_error_429';
                } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                    errorEventForThisAttempt = 'retry_attempt_error_safety_blocked';
                    shouldRetry = false;
                }

                // Log lỗi MỘT LẦN từ executeWithRetry cho attempt này
                const logPayloadForAttemptError = {
                    ...commonLogContext,
                    err: errorDetails,
                    event: errorEventForThisAttempt,
                };

                if (shouldRetry) {
                    attemptLogger.warn(logPayloadForAttemptError, `Attempt ${attempt} failed with ${errorEventForThisAttempt}. Preparing for retry.`);
                } else {
                    attemptLogger.error(logPayloadForAttemptError, `Attempt ${attempt} failed with non-retryable error ${errorEventForThisAttempt}. Aborting.`);
                }


                if (invalidateCacheOnError) {
                    attemptLogger.info({
                        ...commonLogContext,
                        cacheKeyToInvalidate: cacheKeyForInvalidation,
                        event: 'retry_cache_invalidate',
                    }, `Invalidating cache for ${cacheKeyForInvalidation} due to error.`);
                    this.contextCache.deleteInMemoryOnly(cacheKeyForInvalidation, attemptLogger.child({ sub_op: 'deleteInMemoryOnly' }));
                    await this.contextCache.removePersistentEntry(cacheKeyForInvalidation, attemptLogger.child({ sub_op: 'removePersistentEntry' }));
                }

                retryCount++;
                const isLastAttemptAfterThisFailure = retryCount >= this.maxRetries;

                if (!shouldRetry) { // Lỗi không thể retry (vd: safety block)
                    attemptLogger.error({
                        ...commonLogContext,
                        finalError: errorDetails, // Sử dụng errorDetails thay vì error
                        event: 'retry_abort_non_retryable',
                    }, `Non-retryable error encountered with ${modelNameForThisExecution}. Aborting all retries for this model call.`);
                    // Trả về defaultResponse, callGeminiAPI sẽ không thử fallback trong trường hợp này.
                    // Nếu muốn thử fallback cho lỗi safety, logic cần thay đổi.
                    return defaultResponse;
                }

                if (isLastAttemptAfterThisFailure) { // Đã hết số lần retry cho model hiện tại
                    const finalFailureEvent = is5xxError ? 'retry_failed_max_retries_5xx_current_model' : 'retry_failed_max_retries';
                    attemptLogger.error({
                        ...commonLogContext,
                        maxRetries: this.maxRetries,
                        finalError: errorDetails,
                        event: finalFailureEvent,
                    }, `Failed to process with model ${modelNameForThisExecution} after ${this.maxRetries} retries. Final error: ${errorEventForThisAttempt}`);

                    if (is5xxError) {
                        return { ...defaultResponse, finalErrorType: '5xx_non_retryable_for_current_model' }; // Báo hiệu cho callGeminiAPI để thử fallback
                    } else {
                        return defaultResponse; // Không báo hiệu fallback cho lỗi không phải 5xx khi hết retry
                    }
                }

                // Nếu chưa phải lần thử cuối và lỗi có thể retry
                const jitter = Math.random() * 500;
                const delayWithJitter = Math.max(0, currentDelay + jitter);
                attemptLogger.info({
                    ...commonLogContext,
                    nextAttemptWillBe: attempt + 1, // Sửa tên để rõ ràng hơn
                    delaySeconds: (delayWithJitter / 1000).toFixed(2),
                    event: 'retry_wait_before_next',
                }, `Waiting ${(delayWithJitter / 1000).toFixed(2)}s before next attempt with ${modelNameForThisExecution}.`);
                await new Promise(resolve => setTimeout(resolve, delayWithJitter));
                currentDelay = Math.min(currentDelay * 2, this.maxDelayMs);
            } // Kết thúc catch
        } // Kết thúc while loop

        retryLogicLogger.error({
            ...commonLogContext, // Sử dụng commonLogContext nếu có thể
            event: 'retry_loop_exit_unexpected',
        }, `Exited retry loop unexpectedly for model ${modelNameForThisExecution} without returning a result or specific error.`);
        return defaultResponse;
    }

    private async callGeminiAPI(params: InternalCallGeminiApiParams, parentMethodLogger: Logger): Promise<ApiResponse> {
        const { batchPrompt, batchIndex, title, acronym, apiType, crawlModel } = params; // crawlModel is available
        let currentModelNameToUse = params.modelName;
        let explicitFallbackModelNameToUse = params.fallbackModelName;

        const callOperationLoggerBase = parentMethodLogger.child({ function: 'callGeminiAPI', apiType });
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };

        for (let attemptPhase = 0; attemptPhase < 2; attemptPhase++) {
            const callOperationLogger = callOperationLoggerBase.child({ modelName: currentModelNameToUse, attemptPhase: attemptPhase === 0 ? 'primary' : 'fallback' });

            if (attemptPhase === 1) {
                if (!explicitFallbackModelNameToUse) {
                    callOperationLogger.info({ event: 'gemini_call_no_fallback_configured' }, "No fallback model configured or needed for this phase.");
                    break;
                }
                currentModelNameToUse = explicitFallbackModelNameToUse;
                explicitFallbackModelNameToUse = undefined;
                callOperationLogger.info({ event: 'gemini_call_attempting_fallback_model', fallbackModel: currentModelNameToUse, originalModel: params.modelName }, "Attempting API call with fallback model.");
            } else {
                callOperationLogger.info({ event: 'gemini_call_attempting_primary_model', primaryModel: currentModelNameToUse }, "Attempting API call with primary model.");
            }

            this.ensureInitialized(callOperationLogger);
            callOperationLogger.info({ event: 'gemini_call_start' }, "Preparing Gemini API call");

            let modelRateLimiter: RateLimiterMemory;
            try {
                modelRateLimiter = this.rateLimiters.getLimiter(currentModelNameToUse, callOperationLogger);
            } catch (limiterError: unknown) {
                const errorDetails = limiterError instanceof Error ? { name: limiterError.name, message: limiterError.message } : { details: String(limiterError) };
                callOperationLogger.error({ err: errorDetails, event: 'gemini_call_limiter_init_failed' }, `Failed to get or create rate limiter for model ${currentModelNameToUse}. Aborting this phase.`);
                if (attemptPhase === 0 && params.fallbackModelName) continue;
                return defaultApiResponse;
            }

            const generalSettings = this.generalApiTypeSettings[apiType];
            if (!generalSettings) {
                callOperationLogger.error({ event: 'gemini_call_missing_apitypeconfig' }, `API type configuration for '${apiType}' not found.`);
                return defaultApiResponse;
            }

            let systemInstructionTextToUse = "";
            let fewShotPartsToUse: Part[] = [];
            let shouldUseCache = false;
            let finalGenerationConfig: SDKGenerationConfig = { ...generalSettings.generationConfig };

            let finalBatchPrompt = batchPrompt; // Initialize with the original batchPrompt

            const isTunedCallBasedOnParam = crawlModel === 'tuned';

            if (isTunedCallBasedOnParam) {
                callOperationLogger.info({ event: 'gemini_tuned_model_config_applied', modelName: currentModelNameToUse }, "Applying TUNED model configurations: text/plain, no system instruction, no few-shot, no cache.");
                finalGenerationConfig.responseMimeType = "text/plain";
                if (finalGenerationConfig.responseSchema) {
                    delete finalGenerationConfig.responseSchema;
                    callOperationLogger.debug("Removed responseSchema for tuned model call.");
                }
                systemInstructionTextToUse = "";
                fewShotPartsToUse = [];
                shouldUseCache = false;

                // *** NEW LOGIC: Prepend system instruction prefix (for non-tuned) to the prompt for tuned models ***
                const prefixForTunedPrompt = generalSettings.systemInstructionPrefixForNonTunedModel;
                if (prefixForTunedPrompt && prefixForTunedPrompt.trim() !== "") {
                    // Add a newline separator. Adjust if a different separator is preferred.
                    finalBatchPrompt = `${prefixForTunedPrompt.trim()}\n\n${batchPrompt}`;
                    callOperationLogger.info({
                        event: 'gemini_tuned_model_prompt_prefixed',
                        modelName: currentModelNameToUse,
                        // prefixAdded: prefixForTunedPrompt.trim() // Avoid logging potentially large prefix directly here, or truncate
                        prefixLength: prefixForTunedPrompt.trim().length
                    }, "Prepended configured prefix to the prompt for tuned model.");
                } else {
                    callOperationLogger.info({ event: 'gemini_tuned_model_prompt_prefix_not_found_or_empty', modelName: currentModelNameToUse }, "No system instruction prefix (for non-tuned) found/configured or it's empty; prompt remains unchanged for tuned model.");
                }
                // finalBatchPrompt now contains the potentially prefixed prompt for tuned models

            } else { // 'non-tuned' model
                callOperationLogger.info({ event: 'gemini_non_tuned_model_config_applied', modelName: currentModelNameToUse }, "Applying NON-TUNED model configurations.");
                finalGenerationConfig.responseMimeType = generalSettings.generationConfig.responseMimeType || "application/json";

                if (generalSettings.generationConfig.responseSchema && finalGenerationConfig.responseMimeType === "application/json") {
                    finalGenerationConfig.responseSchema = generalSettings.generationConfig.responseSchema;
                    callOperationLogger.debug("Applied responseSchema for non-tuned JSON call.");
                } else {
                    if (finalGenerationConfig.responseSchema) {
                        delete finalGenerationConfig.responseSchema;
                        callOperationLogger.debug("Removed responseSchema as MIME type is not JSON or schema not configured.");
                    }
                }

                systemInstructionTextToUse = generalSettings.systemInstruction || ""; // Standard system instruction for non-tuned
                // For non-tuned models, finalBatchPrompt remains the original batchPrompt (no prefix added here)

                if (generalSettings.allowFewShotForNonTuned) {
                    if (generalSettings.inputs && generalSettings.outputs && Object.keys(generalSettings.inputs).length > 0) {
                        fewShotPartsToUse = this.prepareFewShotParts(apiType, generalSettings, callOperationLogger);
                        if (fewShotPartsToUse.length > 0) callOperationLogger.info({ event: 'gemini_fewshot_enabled_for_non_tuned', apiType }, "Few-shot enabled and prepared for non-tuned model.");
                        else callOperationLogger.warn({ event: 'gemini_fewshot_allowed_but_no_valid_data_for_non_tuned', apiType }, "Few-shot allowed for non-tuned model, but no valid input/output data resulted in few-shot parts.");
                    } else callOperationLogger.info({ event: 'gemini_fewshot_allowed_but_no_config_data_for_non_tuned', apiType }, "Few-shot allowed for non-tuned model, but no inputs/outputs data configured for this API type.");
                } else callOperationLogger.info({ event: 'gemini_fewshot_disabled_for_non_tuned_by_config', apiType }, "Few-shot explicitly disabled by config for non-tuned model.");

                if (generalSettings.allowCacheForNonTuned) {
                    shouldUseCache = true;
                    callOperationLogger.info({ event: 'gemini_cache_enabled_for_non_tuned_by_config', apiType }, "Cache enabled by config for non-tuned model.");
                } else callOperationLogger.info({ event: 'gemini_cache_disabled_for_non_tuned_by_config', apiType }, "Cache explicitly disabled by config for non-tuned model.");
            }

            let modelPrepResult: ModelPreparationResult;
            try {
                modelPrepResult = await this.modelOrchestrator.prepareModel(
                    apiType, currentModelNameToUse,
                    systemInstructionTextToUse,
                    fewShotPartsToUse,
                    finalGenerationConfig,
                    finalBatchPrompt,           // <<< USE THE POTENTIALLY MODIFIED PROMPT HERE
                    shouldUseCache,
                    crawlModel,
                    callOperationLogger
                );
            } catch (prepError: unknown) {
                const errorDetails = prepError instanceof Error ? { name: prepError.name, message: prepError.message } : { details: String(prepError) };
                callOperationLogger.error({ err: errorDetails, event: 'gemini_call_model_prep_orchestration_failed' }, `Failed to prepare model ${currentModelNameToUse}. Aborting this phase.`);
                if (attemptPhase === 0 && params.fallbackModelName) continue;
                return defaultApiResponse;
            }

            // Sửa lại cách khai báo singleAttemptFunction để nhận thêm fewShotParts đã dùng
            const singleAttemptFunction = async (
                limiterInstance: RateLimiterMemory,
                currentModelPrep: ModelPreparationResult, // This will contain the finalBatchPrompt within its contentRequest
                attemptLogger: Logger,
                systemInstructionApplied: string,
                fewShotPartsApplied: Part[]
            ): Promise<ProcessedGeminiResponse> => {
                // ... (rest of singleAttemptFunction remains the same)
                // The currentModelPrep.contentRequest will use the finalBatchPrompt,
                // so logging of contentRequestSent will reflect the prefixed prompt if applicable.
                const attemptApiCallLogger = attemptLogger.child({ event_group: 'gemini_api_attempt' });

                if (!currentModelPrep.model) {
                    attemptApiCallLogger.error({ event: 'gemini_api_model_missing_before_generate' }, "Model object is undefined before calling generateContent.");
                    throw new Error("Model is not initialized for generateContent");
                }

                // --- BEGIN: GHI LOG REQUEST RA FILE ---
                try {
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
                    const attemptNumber = attemptLogger.bindings().attempt || 'unknown_attempt';
                    const requestLogFileName = `request_${apiType}_${currentModelNameToUse.replace('/', '_')}_${safeAcronym}_b${batchIndex}_att${attemptNumber}_${timestamp}.json`;
                    const requestLogFilePath = path.join(this.requestLogDir, requestLogFileName);

                    const requestPayloadToLog: any = {
                        timestamp: new Date().toISOString(),
                        apiType: apiType,
                        modelName: currentModelNameToUse,
                        crawlModelUsed: crawlModel,
                        batchIndex: batchIndex,
                        attempt: attemptNumber,
                        title: title,
                        acronym: acronym,
                        usingCache: currentModelPrep.usingCacheActual,
                        cacheName: currentModelPrep.usingCacheActual ? currentModelPrep.currentCache?.name : 'N/A',
                        systemInstructionApplied: systemInstructionApplied || "N/A",
                    };

                    if (fewShotPartsApplied && fewShotPartsApplied.length > 0) {
                        requestPayloadToLog.fewShotPartsApplied = fewShotPartsApplied;
                    }

                    if (typeof currentModelPrep.contentRequest === 'object' && currentModelPrep.contentRequest.generationConfig) {
                        requestPayloadToLog.generationConfigSent = currentModelPrep.contentRequest.generationConfig;
                    } else if (currentModelPrep.model.generationConfig) {
                        requestPayloadToLog.generationConfigEffective = currentModelPrep.model.generationConfig;
                    }

                    // This will log the potentially prefixed prompt
                    requestPayloadToLog.contentRequestSent = currentModelPrep.contentRequest;


                    if (!existsSync(this.requestLogDir)) {
                        await fsPromises.mkdir(this.requestLogDir, { recursive: true });
                    }
                    await fsPromises.writeFile(requestLogFilePath, JSON.stringify(requestPayloadToLog, null, 2), 'utf8');
                    attemptApiCallLogger.debug({ event: 'gemini_api_request_payload_logged', filePath: requestLogFilePath }, "Full request payload logged to file.");

                } catch (logError) {
                    attemptApiCallLogger.error({ event: 'gemini_api_request_payload_log_failed', err: logError }, "Failed to log full request payload to file.");
                }
                // --- END: GHI LOG REQUEST RA FILE ---


                const rateLimitKey = `${apiType}_${batchIndex}_${currentModelNameToUse}`;
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

                const processed = this.responseHandler.processResponse(sdkApiResult, attemptApiCallLogger);
                this.responseHandler.writeResponseToFile(
                    processed.responseText, apiType, acronym, batchIndex, attemptApiCallLogger
                );

                attemptApiCallLogger.info({
                    responseLength: processed.responseText.length,
                    metaData: processed.metaData,
                    tokens: processed.metaData?.totalTokenCount,
                    usingCache: currentModelPrep.usingCacheActual,
                    cacheName: currentModelPrep.usingCacheActual ? currentModelPrep.currentCache?.name : 'N/A',
                    event: 'gemini_api_attempt_success'
                }, "Gemini API request processed successfully for this attempt.");
                return processed;
            }; // Kết thúc singleAttemptFunction

            const retryResult = await this.executeWithRetry(
                (limiter, modelPrep, logger) => singleAttemptFunction(limiter, modelPrep, logger, systemInstructionTextToUse, fewShotPartsToUse),
                modelPrepResult, apiType, batchIndex,
                modelRateLimiter, callOperationLogger
            );


            if (retryResult.finalErrorType === '5xx_non_retryable_for_current_model') {
                if (attemptPhase === 0 && params.fallbackModelName) {
                    callOperationLogger.warn({ event: 'gemini_call_5xx_switching_to_fallback', originalModel: currentModelNameToUse, fallbackModel: params.fallbackModelName }, `Switching to fallback model due to persistent 5xx error.`);
                    continue;
                } else {
                    callOperationLogger.error({ event: 'gemini_call_5xx_no_more_fallback_options', modelUsed: currentModelNameToUse }, `Persistent 5xx error with model ${currentModelNameToUse} and no further fallback options.`);
                    return defaultApiResponse;
                }
            } else if (retryResult.responseText || retryResult.metaData) {
                callOperationLogger.info({ event: 'gemini_call_success_with_model', modelUsed: currentModelNameToUse, isFallback: attemptPhase === 1 }, `Successfully processed API call with model ${currentModelNameToUse}.`);
                return {
                    responseText: retryResult.responseText,
                    metaData: retryResult.metaData,
                };
            }

            if (attemptPhase === 0 && params.fallbackModelName) {
                callOperationLogger.warn({ event: 'gemini_call_primary_failed_non_5xx_checking_fallback', model: currentModelNameToUse }, `Primary model ${currentModelNameToUse} failed. Checking fallback.`);
            } else {
                callOperationLogger.error({ event: 'gemini_call_failed_no_more_options', modelUsed: currentModelNameToUse }, `API call failed with model ${currentModelNameToUse} and no further options.`);
                return defaultApiResponse;
            }
        }
        callOperationLoggerBase.error({ event: 'gemini_call_unexpected_exit_after_attempts' }, "Unexpected exit from callGeminiAPI after primary/fallback attempts.");
        return defaultApiResponse;
    }

    private prepareFewShotParts(apiType: string, configForApiType: GeneralApiTypeConfig, parentLogger: Logger): Part[] {
        const fewShotParts: Part[] = [];
        const prepLogger = parentLogger.child({ function: 'prepareFewShotParts' });

        if (!configForApiType.inputs || !configForApiType.outputs || Object.keys(configForApiType.inputs).length === 0) {
            prepLogger.debug({ event: 'few_shot_prep_skipped_no_data_in_config' }, "Skipping few-shot parts: No inputs/outputs found or inputs are empty in API config.");
            return fewShotParts;
        }
        prepLogger.debug({ event: 'few_shot_prep_start' }, "Preparing few-shot parts from config");
        try {
            const inputs = configForApiType.inputs;
            const outputs = configForApiType.outputs;

            // Sắp xếp các keys của inputs để đảm bảo thứ tự (ví dụ: input1, input2, input10)
            // Nếu không, "input10" có thể đến trước "input2"
            const sortedInputKeys = Object.keys(inputs).sort((a, b) => {
                const numA = parseInt(a.replace('input', ''), 10);
                const numB = parseInt(b.replace('input', ''), 10);
                return numA - numB;
            });

            sortedInputKeys.forEach((inputKey) => { // inputKey là "input1", "input2", ...
                // Chuyển đổi inputKey ("input1") thành outputKey tương ứng ("output1")
                const indexSuffix = inputKey.replace('input', ''); // Lấy phần số "1", "2", ...
                const outputKey = `output${indexSuffix}`;         // Tạo outputKey: "output1", "output2", ...

                const inputValue = inputs[inputKey];
                const outputValue = outputs[outputKey]; // Bây giờ sẽ lấy đúng output

                if (inputValue) { // Kiểm tra xem inputValue có thực sự là một chuỗi có nội dung không
                    fewShotParts.push({ text: inputValue }); // USER part
                } else {
                    prepLogger.warn({ inputKey, event: 'few_shot_prep_missing_or_empty_input_value' }, `Input value for ${inputKey} is missing or empty.`);
                }

                // QUAN TRỌNG: Chỉ thêm output part nếu có input part tương ứng và outputValue có nội dung
                if (inputValue && outputValue) {
                    fewShotParts.push({ text: outputValue }); // MODEL part
                } else if (inputValue && !outputValue) { // Có input nhưng không có output
                    prepLogger.warn({ inputKey, outputKey, event: 'few_shot_prep_missing_or_empty_output_value_for_input' }, `Output value for ${outputKey} (corresponding to ${inputKey}) is missing or empty. Input part was added, but model part is skipped.`);
                    // TÙY CHỌN: Nếu API yêu cầu một model part rỗng trong trường hợp này, bạn có thể thêm:
                    // fewShotParts.push({ text: "" }); // Thêm model part rỗng
                    // Tuy nhiên, thường thì bỏ qua sẽ tốt hơn là thêm một ví dụ "hỏng".
                } else if (!inputValue) {
                    // Không cần làm gì thêm vì input đã được log ở trên, và không có input thì không nên có output.
                }
            });

            if (fewShotParts.length === 0) {
                prepLogger.warn({ event: 'few_shot_prep_empty_result_after_processing' }, "Few-shot inputs/outputs processed, but resulted in empty parts array (possibly due to missing values or no valid pairs).");
            } else if (fewShotParts.length % 2 !== 0) {
                prepLogger.error({ event: 'few_shot_prep_odd_parts_count', count: fewShotParts.length }, "CRITICAL: Prepared few-shot parts have an odd count, indicating missing user/model pairs. This will likely cause API errors.");
                // Có thể bạn muốn clear fewShotParts ở đây để tránh gửi đi dữ liệu hỏng:
                // fewShotParts.length = 0;
            }
            else {
                prepLogger.debug({ fewShotPairCount: fewShotParts.length / 2, totalParts: fewShotParts.length, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
            }
        } catch (fewShotError: unknown) {
            const errorDetails = fewShotError instanceof Error ? { name: fewShotError.name, message: fewShotError.message } : { details: String(fewShotError) };
            prepLogger.error({ err: errorDetails, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Returning empty array.");
            fewShotParts.length = 0;
        }
        return fewShotParts;
    }

    // Các phương thức public (extractInformation, extractCfp, determineLinks) đã được điều chỉnh ở bước trước
    // để chọn đúng model list và fallback dựa trên `crawlModel` và truyền `crawlModel` xuống `callGeminiAPI`.
    // Chúng ta chỉ cần đảm bảo rằng `crawlModel` được truyền vào `callGeminiAPI` một cách chính xác.

    public async extractInformation(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {

        const { batch, ...paramsWithoutBatch } = params; // Tách trường 'batch' ra
        const methodLogger = this.getMethodLogger(
            parentLogger,
            'extractInformation',
            { ...paramsWithoutBatch, crawlModel } // Chỉ bind các params còn lại và crawlModel
        );
        this.ensureInitialized(methodLogger);

        const apiType = this.API_TYPE_EXTRACT;
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        let modelList: string[];
        let fallbackModelName: string | undefined;

        if (crawlModel === 'tuned') {
            modelList = this.appConfig.GEMINI_EXTRACT_TUNED_MODEL_NAMES;
            fallbackModelName = this.appConfig.GEMINI_EXTRACT_TUNED_FALLBACK_MODEL_NAME;
        } else { // 'non-tuned'
            modelList = this.appConfig.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES;
            fallbackModelName = this.appConfig.GEMINI_EXTRACT_NON_TUNED_FALLBACK_MODEL_NAME;
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({ event: 'gemini_model_list_empty_or_missing', apiType, crawlModel }, `Model list for ${apiType}/${crawlModel} is empty or not configured.`);
            return defaultResponse;
        }

        const selectedModelName = modelList[this.extractModelIndex];
        this.extractModelIndex = (this.extractModelIndex + 1) % modelList.length;
        methodLogger.debug({ selectedModel: selectedModelName, fallback: fallbackModelName || 'N/A', nextIndex: this.extractModelIndex, listUsedLength: modelList.length }, "Model selected for API call (round-robin)");

        try {
            // Truyền crawlModel vào InternalCallGeminiApiParams
            const { responseText, metaData } = await this.callGeminiAPI({
                batchPrompt: batch, // Sử dụng biến 'batch' đã tách ra ở trên
                batchIndex: params.batchIndex,
                title: params.title,
                acronym: params.acronym,
                apiType,
                modelName: selectedModelName,
                fallbackModelName: fallbackModelName,
                crawlModel: crawlModel, // << TRUYỀN VÀO ĐÂY
            }, methodLogger); // methodLogger giờ đây không còn binding 'batch' (prompt)

            const cleaningLogger = methodLogger.child({ modelUsed: selectedModelName, sub_op: 'jsonClean' });
            const cleanedResponseText = this.responseHandler.cleanJsonResponse(responseText, cleaningLogger);

            if (responseText && cleanedResponseText === "" && responseText !== "{}") { // Check if cleaning actually removed content
                cleaningLogger.warn({ rawResponseSnippet: responseText.substring(0, 200) }, "JSON cleaning resulted in empty string from non-empty/non-empty-object input for extractInformation.");
            } else if (cleanedResponseText !== responseText) {
                cleaningLogger.debug("Successfully cleaned JSON response for extractInformation.");
            }

            methodLogger.info({ modelUsed: selectedModelName, crawlModel, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, `${apiType} API call finished.`);
            return { responseText: cleanedResponseText, metaData };
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            methodLogger.error({ modelUsed: selectedModelName, crawlModel, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, `Unhandled error in ${apiType}`);
            return defaultResponse;
        }
    }

    public async extractCfp(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        const { batch, ...paramsWithoutBatch } = params;
        const methodLogger = this.getMethodLogger(
            parentLogger,
            'extractCfp',
            { ...paramsWithoutBatch, crawlModel }
        );

        this.ensureInitialized(methodLogger);
        const apiType = this.API_TYPE_CFP;
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        let modelList: string[];
        let fallbackModelName: string | undefined;

        if (crawlModel === 'tuned') {
            modelList = this.appConfig.GEMINI_CFP_TUNED_MODEL_NAMES;
            fallbackModelName = this.appConfig.GEMINI_CFP_TUNED_FALLBACK_MODEL_NAME;
        } else {
            modelList = this.appConfig.GEMINI_CFP_NON_TUNED_MODEL_NAMES;
            fallbackModelName = this.appConfig.GEMINI_CFP_NON_TUNED_FALLBACK_MODEL_NAME;
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({ event: 'gemini_model_list_empty_or_missing', apiType, crawlModel }, `Model list for ${apiType}/${crawlModel} is empty or not configured.`);
            return defaultResponse;
        }

        const selectedModelName = modelList[this.cfpModelIndex];
        this.cfpModelIndex = (this.cfpModelIndex + 1) % modelList.length;
        methodLogger.debug({ selectedModel: selectedModelName, fallback: fallbackModelName || 'N/A', nextIndex: this.cfpModelIndex, listUsedLength: modelList.length }, "Model selected for API call (round-robin)");

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                batchPrompt: batch, // Sử dụng biến 'batch' đã tách ra
                batchIndex: params.batchIndex,
                title: params.title,
                acronym: params.acronym,
                apiType,
                modelName: selectedModelName,
                fallbackModelName: fallbackModelName,
                crawlModel: crawlModel, // << TRUYỀN VÀO ĐÂY
            }, methodLogger);

            const cleaningLogger = methodLogger.child({ modelUsed: selectedModelName, sub_op: 'jsonClean' });
            const cleanedResponseText = this.responseHandler.cleanJsonResponse(responseText, cleaningLogger);
            const cleaningLogContextForPublicMethod = { ...cleaningLogger.bindings() }; // Inherits modelUsed
            const originalFirstCurly = responseText.indexOf('{'); // For specific logging conditions
            const originalLastCurly = responseText.lastIndexOf('}');

            if (cleanedResponseText && cleanedResponseText !== "") {
                cleaningLogger.debug({ ...cleaningLogContextForPublicMethod, event: 'json_clean_success' }, "Successfully cleaned and validated JSON response for CFP.");
            } else if (responseText && responseText !== "") {
                if (originalFirstCurly !== -1 && originalLastCurly !== -1 && originalLastCurly >= originalFirstCurly) {
                    cleaningLogger.warn({ ...cleaningLogContextForPublicMethod, rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_parse_failed' }, "Failed to parse CFP extracted text as JSON after cleaning, returning empty string.");
                } else {
                    cleaningLogger.warn({ ...cleaningLogContextForPublicMethod, rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_structure_not_found' }, "Could not find valid JSON structure ({...}) in CFP response, returning empty string.");
                }
            }

            methodLogger.info({ modelUsed: selectedModelName, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, "extractCfp API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            methodLogger.error({ modelUsed: selectedModelName, crawlModel, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, `Unhandled error in ${apiType}`);
            return defaultResponse;
        }
    }

    public async determineLinks(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        const { batch, ...paramsWithoutBatch } = params;
        const methodLogger = this.getMethodLogger(
            parentLogger,
            'determineLinks',
            { ...paramsWithoutBatch, crawlModel }
        );
        this.ensureInitialized(methodLogger);
        const apiType = this.API_TYPE_DETERMINE;
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        let modelList: string[];
        let fallbackModelName: string | undefined;

        if (crawlModel === 'tuned') {
            modelList = this.appConfig.GEMINI_DETERMINE_TUNED_MODEL_NAMES;
            fallbackModelName = this.appConfig.GEMINI_DETERMINE_TUNED_FALLBACK_MODEL_NAME;
        } else {
            modelList = this.appConfig.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES;
            fallbackModelName = this.appConfig.GEMINI_DETERMINE_NON_TUNED_FALLBACK_MODEL_NAME;
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({ event: 'gemini_model_list_empty_or_missing', apiType, crawlModel }, `Model list for ${apiType}/${crawlModel} is empty or not configured.`);
            return defaultResponse;
        }

        const selectedModelName = modelList[this.determineModelIndex];
        this.determineModelIndex = (this.determineModelIndex + 1) % modelList.length;
        methodLogger.debug({ selectedModel: selectedModelName, fallback: fallbackModelName || 'N/A', nextIndex: this.determineModelIndex, listUsedLength: modelList.length }, "Model selected for API call (round-robin)");

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                batchPrompt: batch, // Sử dụng biến 'batch' đã tách ra
                batchIndex: params.batchIndex,
                title: params.title,
                acronym: params.acronym,
                apiType,
                modelName: selectedModelName,
                fallbackModelName: fallbackModelName,
                crawlModel: crawlModel, // << TRUYỀN VÀO ĐÂY
            }, methodLogger);

            const cleaningLogger = methodLogger.child({ modelUsed: selectedModelName, sub_op: 'jsonClean' });
            const cleanedResponseText = this.responseHandler.cleanJsonResponse(responseText, cleaningLogger);
            const cleaningLogContextForPublicMethod = { ...cleaningLogger.bindings() };
            const originalFirstCurly = responseText.indexOf('{');
            const originalLastCurly = responseText.lastIndexOf('}');

            if (cleanedResponseText && cleanedResponseText !== "") {
                cleaningLogger.debug({ ...cleaningLogContextForPublicMethod, event: 'json_clean_success' }, "Successfully cleaned and validated JSON response for determineLinks.");
            } else if (responseText && responseText !== "") {
                if (originalFirstCurly !== -1 && originalLastCurly !== -1 && originalLastCurly >= originalFirstCurly) {
                    cleaningLogger.warn({ ...cleaningLogContextForPublicMethod, rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_parse_failed' }, "Failed to parse determineLinks extracted text as JSON after cleaning, returning empty string.");
                } else {
                    cleaningLogger.warn({ ...cleaningLogContextForPublicMethod, rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_structure_not_found' }, "Could not find valid JSON structure ({...}) in determineLinks response, returning empty string.");
                }
            }
            methodLogger.info({ modelUsed: selectedModelName, crawlModel, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, `${apiType} API call finished.`);
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            methodLogger.error({ modelUsed: selectedModelName, crawlModel, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, `Unhandled error in ${apiType}`);
            return defaultResponse;
        }
    }
} // Kết thúc class GeminiApiService
