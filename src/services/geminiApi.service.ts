// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
// import path from 'path'; // No longer needed here directly for paths
import {
    type Part,
    type GenerateContentResult, // For type hint if SDK result passed around
    type GenerationConfig as SDKGenerationConfig,
    type UsageMetadata,
} from "@google/generative-ai";
import { RateLimiterRes, type RateLimiterMemory } from 'rate-limiter-flexible';
import { ConfigService, type GeminiApiConfig } from '../config/config.service'; // Adjust path
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

interface InternalCallGeminiApiParams {
    batchPrompt: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
    apiType: string;
    modelName: string;
    // generationConfig, fewShotParts, useCacheConfig will be derived or decided within callGeminiAPI
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
    private readonly apiConfigs: Record<string, GeminiApiConfig>;
    private readonly maxRetries: number;
    private readonly initialDelayMs: number;
    private readonly maxDelayMs: number;

    public readonly API_TYPE_EXTRACT = 'extract';
    public readonly API_TYPE_DETERMINE = 'determine';
    public readonly API_TYPE_CFP = 'cfp';

    private extractModelIndex: number = 0;
    private cfpModelIndex: number = 0;
    private serviceInitialized: boolean = false;

    // --- Thêm một thuộc tính để lưu đường dẫn thư mục log request ---
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
        this.serviceBaseLogger.info("Constructing GeminiApiService (Refactored)...");

        this.apiConfigs = this.configService.geminiApiConfigs;
        this.maxRetries = this.configService.config.GEMINI_MAX_RETRIES;
        this.initialDelayMs = this.configService.config.GEMINI_INITIAL_DELAY_MS;
        this.maxDelayMs = this.configService.config.GEMINI_MAX_DELAY_MS;


        // Khởi tạo đường dẫn thư mục log request
        // Bạn có thể lấy baseOutputDir từ ConfigService nếu muốn
        const baseOutputDir = this.configService.baseOutputDir || path.join(process.cwd(), 'outputs'); // Ví dụ
        this.requestLogDir = path.join(baseOutputDir, 'gemini_api_requests_log');
        this.serviceBaseLogger.info({ requestLogDir: this.requestLogDir }, "Gemini API request logging directory initialized.");
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GeminiApiService.${methodName}`, ...additionalContext });
    }

    public async init(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'init');
        if (this.serviceInitialized) {
            logger.debug("GeminiApiService already initialized.");
            return;
        }
        logger.info({ event: 'gemini_service_async_init_start' }, "Running async initialization for GeminiApiService (loading cache map)...");
        try {
            await this.cachePersistence.loadMap(logger.child({ sub_service_op: 'GeminiCachePersistenceService.loadMap' }));
            this.clientManager.getGenAI();
            this.serviceInitialized = true;
            logger.info({ event: 'gemini_service_async_init_complete' }, "GeminiApiService async initialization complete.");
        } catch (error) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            logger.error({ err: errorDetails, event: 'gemini_service_async_init_failed' }, "GeminiApiService async initialization failed during cache map loading or client check.");
        }
    }

    private ensureInitialized(logger: Logger): void {
        if (!this.serviceInitialized) {
            const errorMsg = "GeminiApiService is not initialized. Call init() after resolving the service.";
            logger.error({ event: 'gemini_service_not_initialized', detail: errorMsg }, errorMsg);
            throw new Error(errorMsg);
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
        modelPreparation: ModelPreparationResult,
        apiType: string,
        batchIndex: number,
        currentModelNameForRetry: string, // Đổi tên từ modelName để rõ ràng đây là model cho vòng lặp retry hiện tại
        limiter: RateLimiterMemory,
        parentOperationLogger: Logger
    ): Promise<ExecuteWithRetryResult> { // <-- Thay đổi kiểu trả về
        const retryLogicLogger = parentOperationLogger.child({ function: 'executeWithRetry', modelBeingRetried: currentModelNameForRetry });
        const cacheKeyForInvalidation = `${apiType}-${currentModelNameForRetry}`;

        retryLogicLogger.debug({ event: 'retry_loop_start' }, "Executing with retry");
        let retryCount = 0;
        let currentDelay = this.initialDelayMs;
        const defaultResponse: ExecuteWithRetryResult = { responseText: "", metaData: null };

        while (retryCount < this.maxRetries) {
            const attempt = retryCount + 1;
            const attemptLogger = retryLogicLogger.child({ attempt, maxAttempts: this.maxRetries });
            if (attempt > 1) // Không cộng retry cho lần đầu
                 attemptLogger.info({ event: 'retry_attempt_start' }, "Executing function attempt");

            try {
                // Nếu thành công, gói lại trong ExecuteWithRetryResult
                const successResult = await apiCallFn(limiter, modelPreparation, attemptLogger);
                return { ...successResult, finalErrorType: undefined };
            } catch (error: unknown) {
                let shouldRetry = true;
                let invalidateCacheOnError = false;
                const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
                const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
                let errorEvent = 'retry_attempt_error_unknown';
                let is5xxError = false; // Cờ để nhận biết lỗi 5xx

                if (error instanceof RateLimiterRes) {
                    const waitTimeMs = error.msBeforeNext;
                    attemptLogger.warn({ waitTimeMs, event: 'retry_internal_rate_limit_wait' }, `Internal rate limit exceeded. Waiting...`);
                    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                    continue;
                }

                // Kiểm tra lỗi 5xx (bao gồm 500, 503, ...)
                if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                    errorEvent = 'retry_attempt_error_5xx';
                    is5xxError = true; // Đánh dấu là lỗi 5xx
                    attemptLogger.warn({ status: 500, err: errorDetails, event: errorEvent }, "5xx/Server Error from API. Retrying current model or preparing for fallback...");
                    // Vẫn retry với model hiện tại theo maxRetries
                } else if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                    errorEvent = 'retry_attempt_error_cache';
                    attemptLogger.warn({ err: errorDetails, event: errorEvent }, "Cache related error detected. Invalidating cache reference and retrying.");
                    invalidateCacheOnError = true;
                } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted') || errorMessageLower.includes('rate limit')) {
                    errorEvent = 'retry_attempt_error_429';
                    attemptLogger.warn({ status: 429, err: errorDetails, event: errorEvent }, "429/Resource Exhausted/Rate Limit Error from API. Retrying...");
                } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                    errorEvent = 'retry_attempt_error_safety_blocked';
                    attemptLogger.error({ err: errorDetails, event: errorEvent }, "Request blocked by safety settings. No further retries.");
                    shouldRetry = false;
                } else {
                    attemptLogger.warn({ err: errorDetails, event: errorEvent }, "Unhandled/other error during execution attempt. Retrying...");
                }

                if (invalidateCacheOnError) {
                    attemptLogger.info({ cacheKeyToInvalidate: cacheKeyForInvalidation, event: 'retry_cache_invalidate' }, "Removing cache entry due to error during retry.");
                    this.contextCache.deleteInMemoryOnly(cacheKeyForInvalidation, attemptLogger.child({ sub_op: 'deleteInMemoryCache' }));
                    await this.contextCache.removePersistentEntry(cacheKeyForInvalidation, attemptLogger.child({ sub_op: 'removePersistentCache' }));
                }

                retryCount++;
                const isLastAttempt = retryCount >= this.maxRetries;

                if (!shouldRetry) {
                    attemptLogger.error({ finalError: errorDetails, event: 'retry_abort_non_retryable' }, "Non-retryable error encountered. Aborting retries.");
                    return defaultResponse; // Trả về default, không có finalErrorType đặc biệt
                }

                if (isLastAttempt) {
                    if (is5xxError) {
                        // Lỗi 5xx và đã hết số lần retry với model hiện tại
                        attemptLogger.error({ maxRetries: this.maxRetries, finalError: errorDetails, event: 'retry_failed_max_retries_5xx_current_model' }, `Failed to process with model ${currentModelNameForRetry} after maximum retries due to 5xx error. Will attempt fallback if configured.`);
                        return { ...defaultResponse, finalErrorType: '5xx_non_retryable_for_current_model' }; // Báo hiệu cho callGeminiAPI
                    } else {
                        // Lỗi khác và đã hết số lần retry
                        attemptLogger.error({ maxRetries: this.maxRetries, finalError: errorDetails, event: 'retry_failed_max_retries' }, `Failed to process with model ${currentModelNameForRetry} after maximum retries.`);
                        return defaultResponse; // Trả về default, không có finalErrorType đặc biệt
                    }
                }

                const jitter = Math.random() * 500;
                const delayWithJitter = Math.max(0, currentDelay + jitter);
                attemptLogger.info({ nextAttempt: retryCount + 1, delaySeconds: (delayWithJitter / 1000).toFixed(2), event: 'retry_wait_before_next' }, `Waiting before next retry...`);
                await new Promise(resolve => setTimeout(resolve, delayWithJitter));
                currentDelay = Math.min(currentDelay * 2, this.maxDelayMs);
            } // end catch
        } // end while

        retryLogicLogger.error({ event: 'retry_loop_exit_unexpected' }, "Exited retry loop unexpectedly.");
        return defaultResponse; // Không có finalErrorType đặc biệt
    }

    private async callGeminiAPI(
        params: Omit<InternalCallGeminiApiParams, 'generationConfig' | 'fewShotParts' | 'useCacheConfig'>,
        parentMethodLogger: Logger
    ): Promise<ApiResponse> {
        const { batchPrompt, batchIndex, title, acronym, apiType } = params;
        let currentModelNameToUse = params.modelName; // Model ban đầu
        let isUsingFallback = false;

        const callOperationLoggerBase = parentMethodLogger.child({ function: 'callGeminiAPI', apiType });
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };


        // Vòng lặp để thử model chính và sau đó là model fallback (nếu có)
        for (let attemptPhase = 0; attemptPhase < 2; attemptPhase++) { // 0: model chính, 1: model fallback
            const callOperationLogger = callOperationLoggerBase.child({ modelName: currentModelNameToUse, attemptPhase: attemptPhase === 0 ? 'primary' : 'fallback' });

            if (attemptPhase === 1) { // Đang ở giai đoạn thử fallback
                if (!isUsingFallback) break; // Nếu không được đánh dấu để dùng fallback, thoát
                callOperationLogger.info({ event: 'gemini_call_attempting_fallback_model', fallbackModel: currentModelNameToUse, originalModel: params.modelName }, "Attempting API call with fallback model.");
            } else {
                callOperationLogger.info({ event: 'gemini_call_attempting_primary_model', primaryModel: currentModelNameToUse }, "Attempting API call with primary model.");
            }


            this.ensureInitialized(callOperationLogger);
            // Log 'gemini_call_start' sẽ được ghi cho cả model chính và fallback nếu có
            callOperationLogger.info({ event: 'gemini_call_start' }, "Preparing Gemini API call");


            let modelRateLimiter: RateLimiterMemory;
            try {
                modelRateLimiter = this.rateLimiters.getLimiter(currentModelNameToUse, callOperationLogger);
            } catch (limiterError: unknown) {
                const errorDetails = limiterError instanceof Error ? { name: limiterError.name, message: limiterError.message } : { details: String(limiterError) };
                callOperationLogger.error({ err: errorDetails, event: 'gemini_call_limiter_init_failed' }, `Failed to get or create rate limiter for model ${currentModelNameToUse}. Aborting this phase.`);
                if (attemptPhase === 0 && this.apiConfigs[apiType]?.fallbackModelName) { // Nếu là model chính lỗi và có fallback
                    currentModelNameToUse = this.apiConfigs[apiType]!.fallbackModelName!;
                    isUsingFallback = true;
                    continue; // Chuyển sang vòng lặp tiếp theo để thử fallback
                }
                return defaultApiResponse; // Không có fallback hoặc fallback cũng lỗi limiter
            }

            const apiSpecificConfig = this.apiConfigs[apiType];
            if (!apiSpecificConfig) { // Kiểm tra này nên ở ngoài vòng lặp, nhưng để an toàn
                callOperationLogger.error({ event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found.`);
                return defaultApiResponse;
            }

            // Logic isTunedModel và chuẩn bị các tham số sẽ áp dụng cho currentModelNameToUse
            const isTunedModel = currentModelNameToUse.startsWith('tuned');
            let systemInstructionTextToUse = "";
            let fewShotPartsToUse: Part[] = [];
            let shouldUseCache = false;

            // --- BEGIN: Dynamic generationConfig based on isTunedModel ---
            let finalGenerationConfig: SDKGenerationConfig = { ...apiSpecificConfig.generationConfig }; // Start with base config

            if (isTunedModel) {
                callOperationLogger.info({ event: 'gemini_tuned_model_detected', modelName: currentModelNameToUse }, "Tuned model detected. Setting responseMimeType to text/plain. System instruction, few-shot, and cache will be disabled.");
                finalGenerationConfig.responseMimeType = "text/plain";
                // systemInstructionTextToUse remains ""
                // fewShotPartsToUse remains []
                // shouldUseCache remains false
            } else { // Not a tuned model
                callOperationLogger.info({ event: 'gemini_non_tuned_model_detected', modelName: currentModelNameToUse }, "Non-tuned model detected. Applying non-tuned configurations. Setting responseMimeType to application/json.");
                finalGenerationConfig.responseMimeType = "application/json"; // Hoặc lấy từ config nếu bạn muốn có một giá trị mặc định khác cho non-tuned

                systemInstructionTextToUse = apiSpecificConfig.systemInstruction || "";
                if (apiSpecificConfig.allowFewShotForNonTuned) {
                    if (apiSpecificConfig.inputs && apiSpecificConfig.outputs && Object.keys(apiSpecificConfig.inputs).length > 0) {
                        fewShotPartsToUse = this.prepareFewShotParts(apiType, apiSpecificConfig, callOperationLogger);
                        if (fewShotPartsToUse.length > 0) callOperationLogger.info({ event: 'gemini_fewshot_enabled_for_non_tuned', apiType }, "Few-shot enabled and prepared for non-tuned model.");
                        else callOperationLogger.warn({ event: 'gemini_fewshot_allowed_but_no_valid_data_for_non_tuned', apiType }, "Few-shot allowed for non-tuned model, but no valid input/output data resulted in few-shot parts.");
                    } else callOperationLogger.info({ event: 'gemini_fewshot_allowed_but_no_config_data_for_non_tuned', apiType }, "Few-shot allowed for non-tuned model, but no inputs/outputs data configured for this API type.");
                } else callOperationLogger.info({ event: 'gemini_fewshot_disabled_for_non_tuned_by_config', apiType }, "Few-shot explicitly disabled by config for non-tuned model.");

                if (apiSpecificConfig.allowCacheForNonTuned) {
                    shouldUseCache = true;
                    callOperationLogger.info({ event: 'gemini_cache_enabled_for_non_tuned_by_config', apiType }, "Cache enabled by config for non-tuned model.");
                } else callOperationLogger.info({ event: 'gemini_cache_disabled_for_non_tuned_by_config', apiType }, "Cache explicitly disabled by config for non-tuned model.");
            }
            // --- END: Dynamic generationConfig ---

            let modelPrepResult: ModelPreparationResult;
            try {
                modelPrepResult = await this.modelOrchestrator.prepareModel(
                    apiType, currentModelNameToUse, systemInstructionTextToUse, fewShotPartsToUse,
                    finalGenerationConfig, // <-- Sử dụng finalGenerationConfig đã được điều chỉnh
                    batchPrompt, shouldUseCache, callOperationLogger
                );
            } catch (prepError: unknown) {
                const errorDetails = prepError instanceof Error ? { name: prepError.name, message: prepError.message } : { details: String(prepError) };
                callOperationLogger.error({ err: errorDetails, event: 'gemini_call_model_prep_orchestration_failed' }, `Failed to prepare model ${currentModelNameToUse}. Aborting this phase.`);
                if (attemptPhase === 0 && apiSpecificConfig.fallbackModelName) {
                    currentModelNameToUse = apiSpecificConfig.fallbackModelName;
                    isUsingFallback = true;
                    continue;
                }
                return defaultApiResponse;
            }

            // Sửa lại cách khai báo singleAttemptFunction để nhận thêm fewShotParts đã dùng
            const singleAttemptFunction = async (
                limiterInstance: RateLimiterMemory,
                currentModelPrep: ModelPreparationResult,
                attemptLogger: Logger,
                systemInstructionApplied: string, // System instruction đã dùng
                fewShotPartsApplied: Part[]      // Few-shot parts đã dùng
            ): Promise<ProcessedGeminiResponse> => {
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
                        batchIndex: batchIndex,
                        attempt: attemptNumber,
                        title: title,
                        acronym: acronym,
                        usingCache: currentModelPrep.usingCacheActual,
                        cacheName: currentModelPrep.usingCacheActual ? currentModelPrep.currentCache?.name : 'N/A',
                        systemInstructionApplied: systemInstructionApplied || "N/A", // Ghi lại system instruction
                    };

                    // Ghi lại few-shot parts nếu chúng được sử dụng
                    if (fewShotPartsApplied && fewShotPartsApplied.length > 0) {
                        requestPayloadToLog.fewShotPartsApplied = fewShotPartsApplied;
                    }

                    // Ghi lại generation config hiệu lực
                    if (typeof currentModelPrep.contentRequest === 'object' && currentModelPrep.contentRequest.generationConfig) {
                        requestPayloadToLog.generationConfigSent = currentModelPrep.contentRequest.generationConfig;
                    } else if (currentModelPrep.model.generationConfig) {
                        requestPayloadToLog.generationConfigEffective = currentModelPrep.model.generationConfig;
                    }

                    // Ghi lại toàn bộ contentRequest được gửi đi
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

            // Trong callGeminiAPI, khi bạn gọi executeWithRetry:
            // Biến `fewShotPartsToUse` và `systemInstructionTextToUse` đã được xác định ở phần trên của callGeminiAPI
            const retryResult = await this.executeWithRetry(
                (limiter, modelPrep, logger) => singleAttemptFunction(limiter, modelPrep, logger, systemInstructionTextToUse, fewShotPartsToUse),
                modelPrepResult, apiType, batchIndex,
                currentModelNameToUse, modelRateLimiter, callOperationLogger
            );


            if (retryResult.finalErrorType === '5xx_non_retryable_for_current_model') {
                const apiSpecificConfig = this.apiConfigs[apiType]; // Cần lấy lại config ở đây

                // Lỗi 5xx với model hiện tại, đã hết retry cho model này
                if (attemptPhase === 0 && apiSpecificConfig.fallbackModelName && apiSpecificConfig.fallbackModelName !== currentModelNameToUse) {
                    // Nếu đang ở model chính và có fallback model khác với model hiện tại
                    callOperationLogger.warn({ event: 'gemini_call_5xx_switching_to_fallback', originalModel: currentModelNameToUse, fallbackModel: apiSpecificConfig.fallbackModelName }, `Switching to fallback model due to persistent 5xx error with primary model.`);
                    currentModelNameToUse = apiSpecificConfig.fallbackModelName;
                    isUsingFallback = true;
                    continue; // Chuyển sang vòng lặp tiếp theo để thử fallback
                } else {
                    // Không có fallback, hoặc fallback model chính là model hiện tại, hoặc đã thử fallback và vẫn lỗi
                    callOperationLogger.error({ event: 'gemini_call_5xx_no_more_fallback_options', modelUsed: currentModelNameToUse }, `Persistent 5xx error with model ${currentModelNameToUse} and no further fallback options.`);
                    return defaultApiResponse; // Trả về lỗi sau khi đã thử hết các lựa chọn
                }
            } else if (retryResult.responseText || retryResult.metaData) {
                // Thành công với model hiện tại (chính hoặc fallback)
                callOperationLogger.info({ event: 'gemini_call_success_with_model', modelUsed: currentModelNameToUse, isFallback: attemptPhase === 1 }, `Successfully processed API call with model ${currentModelNameToUse}.`);
                return {
                    responseText: retryResult.responseText,
                    metaData: retryResult.metaData,
                };
            }
            // Nếu không phải lỗi 5xx đặc biệt và cũng không thành công (ví dụ lỗi non-retryable khác)
            // thì vòng lặp sẽ kết thúc ở đây nếu là model chính và không có fallback,
            // hoặc nếu đã thử fallback.
            if (attemptPhase === 0 && apiSpecificConfig.fallbackModelName && apiSpecificConfig.fallbackModelName !== currentModelNameToUse) {
                callOperationLogger.warn({ event: 'gemini_call_primary_failed_non_5xx_checking_fallback', model: currentModelNameToUse }, `Primary model ${currentModelNameToUse} failed (non-5xx or other retryable exhausted). Checking fallback.`);
                currentModelNameToUse = apiSpecificConfig.fallbackModelName;
                isUsingFallback = true;
                // continue; // Sẽ tự động continue ở vòng lặp for
            } else {
                callOperationLogger.error({ event: 'gemini_call_failed_no_more_options', modelUsed: currentModelNameToUse }, `API call failed with model ${currentModelNameToUse} and no further options.`);
                return defaultApiResponse;
            }


        } // Hết vòng lặp for (primary/fallback)

        callOperationLoggerBase.error({ event: 'gemini_call_unexpected_exit_after_attempts' }, "Unexpected exit from callGeminiAPI after primary/fallback attempts.");
        return defaultApiResponse;
    }


    private prepareFewShotParts(apiType: string, configForApiType: GeminiApiConfig, parentLogger: Logger): Part[] {
        const fewShotParts: Part[] = [];
        const prepLogger = parentLogger.child({ function: 'prepareFewShotParts', apiType });

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

    public async extractInformation(params: GeminiApiParams, parentLogger?: Logger): Promise<ApiResponse> {
        const methodLogger = this.getMethodLogger(parentLogger, 'extractInformation', { acronym: params.acronym, batchIndex: params.batchIndex, title: params.title || 'N/A' });
        this.ensureInitialized(methodLogger);

        const apiType = this.API_TYPE_EXTRACT;
        const configForApi = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        if (!configForApi) {
            methodLogger.error({ event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found.`);
            return defaultResponse;
        }
        const modelNames = configForApi.modelNames;
        if (!modelNames || modelNames.length === 0) {
            methodLogger.error({ event: 'gemini_call_missing_model_config', detail: `No model names configured for API type '${apiType}'.` }, "No model names configured for API type.");
            return defaultResponse;
        }

        const selectedModelName = modelNames[this.extractModelIndex];
        const nextIdx = (this.extractModelIndex + 1) % modelNames.length;
        methodLogger.debug({ selectedModel: selectedModelName, nextIndex: nextIdx }, "Initiating API call (round-robin)");
        this.extractModelIndex = nextIdx;

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                batchPrompt: params.batch,
                batchIndex: params.batchIndex,
                title: params.title,
                acronym: params.acronym,
                apiType,
                modelName: selectedModelName,
                // generationConfig is handled inside callGeminiAPI via apiSpecificConfig
            }, methodLogger);

            const cleaningLogger = methodLogger.child({ modelUsed: selectedModelName, sub_op: 'jsonClean' });
            const cleanedResponseText = this.responseHandler.cleanJsonResponse(responseText, cleaningLogger);

            if (responseText && cleanedResponseText === "" && responseText !== "{}") { // Check if cleaning actually removed content
                cleaningLogger.warn({ rawResponseSnippet: responseText.substring(0, 200) }, "JSON cleaning resulted in empty string from non-empty/non-empty-object input for extractInformation.");
            } else if (cleanedResponseText !== responseText) {
                cleaningLogger.debug("Successfully cleaned JSON response for extractInformation.");
            }

            methodLogger.info({ modelUsed: selectedModelName, cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, "extractInformation API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            methodLogger.error({ modelUsed: selectedModelName, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, "Unhandled error in public method extractInformation");
            return defaultResponse;
        }
    }

    public async extractCfp(params: GeminiApiParams, parentLogger?: Logger): Promise<ApiResponse> {
        const methodLogger = this.getMethodLogger(parentLogger, 'extractCfp', { acronym: params.acronym, batchIndex: params.batchIndex, title: params.title || 'N/A' });
        this.ensureInitialized(methodLogger);

        const apiType = this.API_TYPE_CFP;
        const configForApi = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        if (!configForApi) {
            methodLogger.error({ event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found for CFP.`);
            return defaultResponse;
        }
        const modelNames = configForApi.modelNames;
        if (!modelNames || modelNames.length === 0) {
            methodLogger.error({ event: 'gemini_call_missing_model_config', detail: `No model names configured for API type '${apiType}' (CFP).` }, "No model names configured for CFP.");
            return defaultResponse;
        }

        const selectedModelName = modelNames[this.cfpModelIndex];
        const nextIdx = (this.cfpModelIndex + 1) % modelNames.length;
        methodLogger.debug({ selectedModel: selectedModelName, nextIndex: nextIdx }, "Initiating CFP API call (round-robin)");
        this.cfpModelIndex = nextIdx;

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                batchPrompt: params.batch,
                batchIndex: params.batchIndex,
                title: params.title,
                acronym: params.acronym,
                apiType,
                modelName: selectedModelName,
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
            methodLogger.error({ modelUsed: selectedModelName, err: errorDetails, event: 'gemini_public_method_unhandled_error' }, "Unhandled error in public method extractCfp");
            return defaultResponse;
        }
    }

    public async determineLinks(params: GeminiApiParams, parentLogger?: Logger): Promise<ApiResponse> {
        const methodLogger = this.getMethodLogger(parentLogger, 'determineLinks', { acronym: params.acronym, batchIndex: params.batchIndex, title: params.title || 'N/A' });
        this.ensureInitialized(methodLogger);

        const apiType = this.API_TYPE_DETERMINE;
        const configForApi = this.apiConfigs[apiType];
        const defaultResponse: ApiResponse = { responseText: "", metaData: null };

        if (!configForApi) {
            methodLogger.error({ event: 'gemini_call_missing_apiconfig' }, `API configuration for type '${apiType}' not found for determineLinks.`);
            return defaultResponse;
        }
        const modelName = configForApi.modelName;
        if (!modelName) {
            methodLogger.error({ event: 'gemini_call_missing_model_config', detail: `No model name configured for API type '${apiType}' (determineLinks).` }, "No model name configured for determineLinks.");
            return defaultResponse;
        }
        const publicMethodLoggerWithModel = methodLogger.child({ modelName }); // Add modelName to context

        publicMethodLoggerWithModel.debug("Initiating determineLinks API call");

        try {
            const { responseText, metaData } = await this.callGeminiAPI({
                batchPrompt: params.batch,
                batchIndex: params.batchIndex,
                title: params.title,
                acronym: params.acronym,
                apiType,
                modelName: modelName,
            }, publicMethodLoggerWithModel);

            const cleaningLogger = publicMethodLoggerWithModel.child({ modelUsed: modelName, sub_op: 'jsonClean' });
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
            publicMethodLoggerWithModel.info({ cleanedResponseLength: cleanedResponseText.length, event: 'gemini_public_method_finish' }, "determineLinks API call finished.");
            return { responseText: cleanedResponseText, metaData };

        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            publicMethodLoggerWithModel.error({ err: errorDetails, event: 'gemini_public_method_unhandled_error' }, "Unhandled error in public method determineLinks");
            return defaultResponse;
        }
    }
}