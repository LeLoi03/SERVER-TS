// src/services/gemini/geminiApiOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import { type Part, GenerationConfig as SDKGenerationConfig, type UsageMetadata } from "@google/generative-ai";
import { ConfigService, type GeminiApiConfig as GeneralApiTypeConfig } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { GeminiModelOrchestratorService } from './geminiModelOrchestrator.service';
import { GeminiRateLimiterService } from './geminiRateLimiter.service';
import { GeminiRetryHandlerService, } from './geminiRetryHandler.service';
import { GeminiSdkExecutorService } from './geminiSdkExecutor.service';

import { CrawlModelType } from '../../types/crawl/crawl.types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

import { OrchestrationResult, InternalCallGeminiApiParams, ModelExecutionConfig, type ExecuteWithRetryResult, type RetryableGeminiApiCall } from '../../types/crawl';


@singleton()
export class GeminiApiOrchestratorService {
    private readonly serviceBaseLogger: Logger;
    private readonly generalApiTypeSettings: Record<string, GeneralApiTypeConfig>;
    private readonly defaultMaxRetriesForFallback: number;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GeminiModelOrchestratorService) private modelOrchestrator: GeminiModelOrchestratorService,
        @inject(GeminiRateLimiterService) private rateLimiters: GeminiRateLimiterService,
        @inject(GeminiRetryHandlerService) private retryHandler: GeminiRetryHandlerService,
        @inject(GeminiSdkExecutorService) private sdkExecutor: GeminiSdkExecutorService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'GeminiApiOrchestratorService' });
        this.generalApiTypeSettings = this.configService.geminiApiConfigs;
        this.defaultMaxRetriesForFallback = this.configService.config.GEMINI_MAX_RETRIES;
        this.serviceBaseLogger.info("Constructing GeminiApiOrchestratorService with updated retry/fallback logic.");
    }

    private prepareFewShotParts(apiType: string, configForApiType: GeneralApiTypeConfig, parentLogger: Logger): Part[] {
        const fewShotParts: Part[] = [];
        const prepLogger = parentLogger.child({
            fewShotPrepFunc: 'GeminiApiOrchestratorService.prepareFewShotParts'
        });

        if (!configForApiType.inputs || !configForApiType.outputs || Object.keys(configForApiType.inputs).length === 0) {
            prepLogger.debug({ event: 'few_shot_prep_skipped_no_data_in_config' }, "Skipping few-shot parts: No inputs/outputs found or inputs are empty in API config.");
            return fewShotParts;
        }
        prepLogger.debug({ event: 'few_shot_prep_start' }, "Preparing few-shot parts from config");
        try {
            const inputs = configForApiType.inputs;
            const outputs = configForApiType.outputs;
            const sortedInputKeys = Object.keys(inputs).sort((a, b) => parseInt(a.replace('input', ''), 10) - parseInt(b.replace('input', ''), 10));

            sortedInputKeys.forEach((inputKey) => {
                const indexSuffix = inputKey.replace('input', '');
                const outputKey = `output${indexSuffix}`;
                const inputValue = inputs[inputKey];
                const outputValue = outputs[outputKey];

                if (inputValue) fewShotParts.push({ text: inputValue });
                else prepLogger.warn({ inputKey, event: 'few_shot_prep_missing_or_empty_input_value' }, `Input value for ${inputKey} is missing or empty.`);

                if (inputValue && outputValue) fewShotParts.push({ text: outputValue });
                else if (inputValue && !outputValue) prepLogger.warn({ inputKey, outputKey, event: 'few_shot_prep_missing_or_empty_output_value_for_input' }, `Output value for ${outputKey} (corresponding to ${inputKey}) is missing or empty. Input part was added, but model part is skipped.`);
            });

            if (fewShotParts.length === 0) prepLogger.warn({ event: 'few_shot_prep_empty_result_after_processing' }, "Few-shot inputs/outputs processed, but resulted in empty parts array.");
            else if (fewShotParts.length % 2 !== 0) prepLogger.error({ event: 'few_shot_prep_odd_parts_count', count: fewShotParts.length }, "CRITICAL: Prepared few-shot parts have an odd count.");
            else prepLogger.debug({ fewShotPairCount: fewShotParts.length / 2, totalParts: fewShotParts.length, event: 'few_shot_prep_success' }, "Prepared few-shot parts");
        } catch (fewShotError: unknown) {
            const { message, stack } = getErrorMessageAndStack(fewShotError);
            prepLogger.error({ err: { message, stack }, event: 'few_shot_prep_failed' }, "Error processing few-shot examples. Returning empty array.");
            fewShotParts.length = 0;
        }
        return fewShotParts;
    }

    private async prepareForApiCall(
        modelNameToUse: string,
        apiType: string,
        originalBatchPrompt: string, // The very original prompt before any prefixing
        effectiveCrawlModelType: CrawlModelType, // How this specific model call should be treated
        parentLogger: Logger
    ): Promise<ModelExecutionConfig | null> {
        const prepConfigLogger = parentLogger.child({ sub_op: 'prepareForApiCall', modelForPrep: modelNameToUse, effectiveCrawlModelType });
        try {
            const modelRateLimiter = this.rateLimiters.getLimiter(modelNameToUse, prepConfigLogger.child({ sub_op: 'getLimiter' }));

            const generalSettings = this.generalApiTypeSettings[apiType];
            if (!generalSettings) {
                prepConfigLogger.error({ event: 'gemini_call_missing_apitypeconfig' }, `API type configuration for '${apiType}' not found.`);
                return null;
            }

            let systemInstructionText = "";
            let fewShotParts: Part[] = [];
            let shouldUseCache = false;
            let finalGenerationConfig: SDKGenerationConfig = { ...generalSettings.generationConfig };
            let finalBatchPromptForThisCall = originalBatchPrompt; // Start with the original prompt

            const isEffectivelyTunedCall = effectiveCrawlModelType === 'tuned';
            const configApplyLogger = prepConfigLogger.child({ sub_op: 'configApplication', isEffectivelyTunedCall });

            if (isEffectivelyTunedCall) {
                configApplyLogger.info({ event: 'gemini_tuned_model_config_applied_for_call' }, "Applying TUNED model configurations for this specific call.");
                finalGenerationConfig.responseMimeType = "text/plain";
                if (finalGenerationConfig.responseSchema) delete finalGenerationConfig.responseSchema;
                systemInstructionText = ""; fewShotParts = []; shouldUseCache = false;

                const prefixForTuned = generalSettings.systemInstructionPrefixForNonTunedModel; // This prefix is for tuned models
                if (prefixForTuned?.trim()) {
                    finalBatchPromptForThisCall = `${prefixForTuned.trim()}\n\n${originalBatchPrompt}`;
                    configApplyLogger.info({ event: 'gemini_tuned_model_prompt_prefixed_for_call', prefixLength: prefixForTuned.trim().length });
                } else {
                    configApplyLogger.info({ event: 'gemini_tuned_model_prompt_prefix_not_found_for_call' });
                }
            } else { // Non-Tuned configuration for this specific call
                configApplyLogger.info({ event: 'gemini_non_tuned_model_config_applied_for_call' }, "Applying NON-TUNED model configurations for this specific call.");
                finalGenerationConfig.responseMimeType = generalSettings.generationConfig.responseMimeType || "application/json";
                if (generalSettings.generationConfig.responseSchema && finalGenerationConfig.responseMimeType === "application/json") {
                    finalGenerationConfig.responseSchema = generalSettings.generationConfig.responseSchema;
                } else if (finalGenerationConfig.responseSchema) {
                    delete finalGenerationConfig.responseSchema;
                }
                systemInstructionText = generalSettings.systemInstruction || "";
                if (generalSettings.allowFewShotForNonTuned) {
                    fewShotParts = this.prepareFewShotParts(apiType, generalSettings, configApplyLogger);
                }
                if (generalSettings.allowCacheForNonTuned) shouldUseCache = true;
                // finalBatchPromptForThisCall remains originalBatchPrompt (no prefix for non-tuned)
            }

            const modelPrepResult = await this.modelOrchestrator.prepareModel(
                apiType, modelNameToUse, systemInstructionText, fewShotParts,
                finalGenerationConfig, finalBatchPromptForThisCall, shouldUseCache,
                effectiveCrawlModelType, // Pass the effective type for this call
                prepConfigLogger.child({ sub_op: 'modelPreparation' })
            );

            return {
                systemInstructionText, fewShotParts, shouldUseCache, finalGenerationConfig,
                finalBatchPrompt: finalBatchPromptForThisCall, // Return the potentially prefixed prompt
                modelRateLimiter, modelPrepResult
            };

        } catch (error: unknown) {
            const { message, stack } = getErrorMessageAndStack(error);
            prepConfigLogger.error({ err: { message, stack }, event: 'gemini_call_preparation_failed_for_model' }, `Failed to prepare execution for model ${modelNameToUse}.`);
            return null;
        }
    }

    public async orchestrateApiCall(
        params: InternalCallGeminiApiParams,
        parentServiceMethodLogger: Logger
    ): Promise<OrchestrationResult> { // Thay đổi kiểu trả về
        const { batchPrompt: originalBatchPrompt, batchIndex, title, acronym, apiType, requestLogDir } = params;
        const primaryModelName = params.modelName;
        const fallbackModelNameFromParams = params.fallbackModelName;
        const initialCrawlModelType = params.crawlModel;

        const callOperationLoggerBase = parentServiceMethodLogger.child({
            function: 'orchestrateApiCall',
            apiType,
            batchIndex,
            primaryModelNameSpecified: primaryModelName,
            fallbackModelNameSpecified: fallbackModelNameFromParams || 'N/A',
            initialCrawlModelType: initialCrawlModelType
        });

        const defaultOrchestrationResult: OrchestrationResult = {
            responseText: "",
            metaData: null,
            success: false,
            usedFallback: false,
        };

        callOperationLoggerBase.info({
            event: 'gemini_call_start',
            apiType: apiType,
            modelName: primaryModelName, // Model chính được yêu cầu ban đầu
            crawlModel: initialCrawlModelType,
        }, `Gemini API call orchestration started for apiType: ${apiType}`);

        // --- Phase 0: Primary Model (Single Shot) ---
        callOperationLoggerBase.info({
            event: 'gemini_orchestration_primary_start',
            modelName: primaryModelName,
            crawlModel: initialCrawlModelType, // Thêm crawlModel cho context
            phase: 'primary_execution_phase_start' // Rõ ràng hơn
        }, "Attempting API call with primary model (single shot).");

        let primaryModelResult: ExecuteWithRetryResult | null = null;
        let primaryModelSucceeded = false;

        if (!primaryModelName) {
            callOperationLoggerBase.warn({
                event: 'gemini_orchestration_no_primary_model',
                apiType // Thêm context
            }, "No primary model name provided. Skipping primary attempt.");
            // primaryModelResult vẫn là null, primaryModelSucceeded là false
        } else {
            const primaryPrepConfig = await this.prepareForApiCall(
                primaryModelName,
                apiType,
                originalBatchPrompt,
                initialCrawlModelType,
                callOperationLoggerBase.child({ phase: 'primary_prep', modelForPrep: primaryModelName, effectiveCrawlModelType: initialCrawlModelType })
            );

            if (primaryPrepConfig) {
                const { modelRateLimiter, modelPrepResult, systemInstructionText, fewShotParts } = primaryPrepConfig;

                const apiCallFnPrimary: RetryableGeminiApiCall = (limiter, prepResult, type, attemptLogger) =>
                    this.sdkExecutor.executeSdkCall({
                        limiterInstance: limiter, currentModelPrep: prepResult, apiType: type, batchIndex, acronym, title,
                        crawlModel: initialCrawlModelType,
                        systemInstructionTextToUse: systemInstructionText, fewShotPartsToUse: fewShotParts, requestLogDir,
                    }, attemptLogger);

                primaryModelResult = await this.retryHandler.executeWithRetry(
                    apiCallFnPrimary, modelPrepResult, apiType, batchIndex,
                    modelRateLimiter, callOperationLoggerBase.child({ modelName: primaryModelName, crawlModel: initialCrawlModelType, phase: 'primary_execution' }),
                    1 // MAX ATTEMPTS = 1 for primary model
                );

                if (primaryModelResult.responseText || primaryModelResult.metaData) {
                    primaryModelSucceeded = true;
                    callOperationLoggerBase.info({
                        event: 'gemini_orchestration_primary_success',
                        modelUsed: primaryModelName,
                        crawlModel: initialCrawlModelType,
                        phase: 'primary_execution', // Thêm phase
                        // tokens: primaryModelResult.metaData?.totalTokenCount // Sẽ được log bởi SdkExecutor
                    }, `Success with primary model ${primaryModelName} on single shot.`);

                    return {
                        responseText: primaryModelResult.responseText,
                        metaData: primaryModelResult.metaData,
                        success: true,
                        usedFallback: false,
                        modelActuallyUsed: primaryModelName,
                        crawlModelActuallyUsed: initialCrawlModelType,
                    };
                } else {
                    // Primary model failed its single shot
                    callOperationLoggerBase.warn({
                        event: 'gemini_orchestration_primary_failed',
                        modelUsed: primaryModelName,
                        crawlModel: initialCrawlModelType,
                        phase: 'primary_execution', // Đã có
                        errorType: primaryModelResult.finalErrorType,
                        errorDetails: primaryModelResult.errorDetails,
                        // Thêm context cho addConferenceError
                        sourceService: 'GeminiApiOrchestratorService.PrimaryAttempt',
                        apiType: apiType,
                    }, `Primary model ${primaryModelName} failed on single shot. Error: ${primaryModelResult.finalErrorType}. Proceeding to fallback if available.`);
                }
            } else {
                // Preparation for primary model failed
                callOperationLoggerBase.error({
                    event: 'gemini_orchestration_primary_prep_failed',
                    modelName: primaryModelName,
                    crawlModel: initialCrawlModelType, // Thêm context
                    phase: 'primary_prep', // Thêm phase
                    // Thêm context cho addConferenceError
                    sourceService: 'GeminiApiOrchestratorService.PrimaryPrep',
                    apiType: apiType,
                }, `Preparation failed for primary model ${primaryModelName}. Proceeding to fallback if available.`);
                // primaryModelResult vẫn là null (hoặc có thể tạo một errorResult)
                // primaryModelSucceeded là false
            }
        }

        // --- Phase 1: Fallback Model (Full Retries) ---
        // Điều kiện để thử fallback: primary model không được cung cấp HOẶC primary model đã thử và thất bại.
        if (!primaryModelSucceeded) { // Chỉ thử fallback nếu primary chưa thành công
            if (!fallbackModelNameFromParams) {
                callOperationLoggerBase.info({
                    event: 'gemini_orchestration_no_fallback_model',
                    primaryModelAttempted: !!primaryModelName, // True nếu primary đã được thử
                    primaryModelFailureReason: primaryModelResult?.finalErrorType, // Lý do primary thất bại
                    apiType // Thêm context
                }, "No fallback model configured. Primary attempt failed or was skipped.");

                // Đây là điểm thất bại cuối cùng nếu primary thất bại và không có fallback
                if (primaryModelName && !primaryModelSucceeded) { // Nếu primary đã được thử và thất bại
                    callOperationLoggerBase.error({
                        event: 'gemini_call_failed_no_more_options', // EVENT CHỦ ĐẠO CHO FAILED_CALLS
                        reason: 'Primary model failed and no fallback configured.',
                        primaryModelUsed: primaryModelName,
                        primaryCrawlModel: initialCrawlModelType,
                        primaryErrorType: primaryModelResult?.finalErrorType,
                        primaryErrorDetails: primaryModelResult?.errorDetails,
                        phase: 'orchestration_end',
                        apiType: apiType,
                        modelUsed: primaryModelName, // Model cuối cùng đã thử
                        crawlModel: initialCrawlModelType, // Crawl model của model cuối cùng
                    }, `Operation failed: Primary model ${primaryModelName} failed and no fallback was configured.`);
                }

                return {
                    ...defaultOrchestrationResult, // responseText, metaData sẽ là default
                    success: false,
                    usedFallback: false,
                    modelActuallyUsed: primaryModelName, // Model cuối cùng đã được thử (nếu có)
                    crawlModelActuallyUsed: initialCrawlModelType,
                    finalErrorType: primaryModelResult?.finalErrorType || (primaryModelName ? 'primary_failed_unknown' : 'no_primary_model'),
                    finalErrorDetails: primaryModelResult?.errorDetails || { message: (primaryModelName ? "Primary model failed" : "No primary model specified and no fallback.") }
                };
            }

            const fallbackEffectiveCrawlModelType: CrawlModelType = (initialCrawlModelType === 'tuned')
                ? 'non-tuned'
                : initialCrawlModelType;

            callOperationLoggerBase.info({
                event: 'gemini_orchestration_fallback_start',
                modelName: fallbackModelNameFromParams,
                crawlModel: fallbackEffectiveCrawlModelType, // Thêm crawlModel cho context
                phase: 'fallback_execution_phase_start', // Rõ ràng hơn
                originalModel: primaryModelName || 'N/A',
                initialCrawlModelTypeForPrimary: initialCrawlModelType,
            }, "Primary model failed or was not specified. Attempting API call with fallback model (with full retries).");

            const fallbackPrepConfig = await this.prepareForApiCall(
                fallbackModelNameFromParams,
                apiType,
                originalBatchPrompt,
                fallbackEffectiveCrawlModelType,
                callOperationLoggerBase.child({ phase: 'fallback_prep', modelForPrep: fallbackModelNameFromParams, effectiveCrawlModelType: fallbackEffectiveCrawlModelType })
            );

            if (!fallbackPrepConfig) {
                callOperationLoggerBase.error({
                    event: 'gemini_orchestration_fallback_prep_failed',
                    modelName: fallbackModelNameFromParams,
                    crawlModel: fallbackEffectiveCrawlModelType, // Thêm context
                    phase: 'fallback_prep', // Thêm phase
                    // Thêm context cho addConferenceError
                    sourceService: 'GeminiApiOrchestratorService.FallbackPrep',
                    apiType: apiType,
                }, `Preparation failed for fallback model ${fallbackModelNameFromParams}. Aborting.`);

                callOperationLoggerBase.error({
                    event: 'gemini_call_failed_no_more_options', // EVENT CHỦ ĐẠO CHO FAILED_CALLS
                    reason: 'Fallback model preparation failed.',
                    primaryModelUsed: primaryModelName,
                    primaryCrawlModel: initialCrawlModelType,
                    primaryErrorType: primaryModelResult?.finalErrorType,
                    fallbackModelAttempted: fallbackModelNameFromParams,
                    fallbackCrawlModel: fallbackEffectiveCrawlModelType,
                    phase: 'orchestration_end',
                    apiType: apiType,
                    modelUsed: fallbackModelNameFromParams, // Model cuối cùng đã thử (prep)
                    crawlModel: fallbackEffectiveCrawlModelType,
                }, `Operation failed: Preparation for fallback model ${fallbackModelNameFromParams} failed.`);

                return {
                    ...defaultOrchestrationResult,
                    success: false,
                    usedFallback: true, // Đã cố gắng sử dụng fallback
                    modelActuallyUsed: fallbackModelNameFromParams, // Model cuối cùng đã được thử (chuẩn bị)
                    crawlModelActuallyUsed: fallbackEffectiveCrawlModelType,
                    finalErrorType: 'fallback_prep_failed',
                    finalErrorDetails: { message: `Preparation failed for fallback model ${fallbackModelNameFromParams}` }
                };
            }

            const { modelRateLimiter: fallbackRateLimiter, modelPrepResult: fallbackPrepResult, systemInstructionText: fallbackSystemInstruction, fewShotParts: fallbackFewShot } = fallbackPrepConfig;

            const apiCallFnFallback: RetryableGeminiApiCall = (limiter, prepResult, type, attemptLogger) =>
                this.sdkExecutor.executeSdkCall({
                    limiterInstance: limiter, currentModelPrep: prepResult, apiType: type, batchIndex, acronym, title,
                    crawlModel: fallbackEffectiveCrawlModelType,
                    systemInstructionTextToUse: fallbackSystemInstruction, fewShotPartsToUse: fallbackFewShot, requestLogDir,
                }, attemptLogger);

            const fallbackModelFullResult: ExecuteWithRetryResult = await this.retryHandler.executeWithRetry(
                apiCallFnFallback, fallbackPrepResult, apiType, batchIndex,
                fallbackRateLimiter, callOperationLoggerBase.child({ modelName: fallbackModelNameFromParams, crawlModel: fallbackEffectiveCrawlModelType, phase: 'fallback_execution' }),
                this.defaultMaxRetriesForFallback
            );

            if (fallbackModelFullResult.responseText || fallbackModelFullResult.metaData) {
                callOperationLoggerBase.info({
                    event: 'gemini_orchestration_fallback_success',
                    modelUsed: fallbackModelNameFromParams,
                    crawlModel: fallbackEffectiveCrawlModelType, // Thêm crawlModel
                    phase: 'fallback_execution', // Thêm phase
                    // tokens: fallbackModelFullResult.metaData?.totalTokenCount // Sẽ được log bởi SdkExecutor
                }, `Success with fallback model ${fallbackModelNameFromParams}.`);
                return {
                    responseText: fallbackModelFullResult.responseText,
                    metaData: fallbackModelFullResult.metaData,
                    success: true,
                    usedFallback: true,
                    modelActuallyUsed: fallbackModelNameFromParams,
                    crawlModelActuallyUsed: fallbackEffectiveCrawlModelType,
                };
            } else {
                // Fallback model failed after all retries
                callOperationLoggerBase.error({
                    event: 'gemini_orchestration_fallback_failed_after_retries',
                    modelUsed: fallbackModelNameFromParams,
                    crawlModel: fallbackEffectiveCrawlModelType, // Thêm crawlModel
                    phase: 'fallback_execution', // Thêm phase
                    errorType: fallbackModelFullResult.finalErrorType,
                    errorDetails: fallbackModelFullResult.errorDetails,
                    // Thêm context cho addConferenceError
                    sourceService: 'GeminiApiOrchestratorService.FallbackAttempt',
                    apiType: apiType,
                }, `Fallback model ${fallbackModelNameFromParams} failed after all retries. Error: ${fallbackModelFullResult.finalErrorType}.`);

                callOperationLoggerBase.error({
                    event: 'gemini_call_failed_no_more_options', // EVENT CHỦ ĐẠO CHO FAILED_CALLS
                    reason: 'Fallback model failed after all retries.',
                    primaryModelUsed: primaryModelName,
                    primaryCrawlModel: initialCrawlModelType,
                    primaryErrorType: primaryModelResult?.finalErrorType,
                    fallbackModelAttempted: fallbackModelNameFromParams,
                    fallbackCrawlModel: fallbackEffectiveCrawlModelType,
                    fallbackErrorType: fallbackModelFullResult.finalErrorType,
                    fallbackErrorDetails: fallbackModelFullResult.errorDetails,
                    phase: 'orchestration_end',
                    apiType: apiType,
                    modelUsed: fallbackModelNameFromParams, // Model cuối cùng đã thử
                    crawlModel: fallbackEffectiveCrawlModelType,
                }, `Operation failed: Fallback model ${fallbackModelNameFromParams} also failed.`);

                return {
                    ...defaultOrchestrationResult,
                    success: false,
                    usedFallback: true,
                    modelActuallyUsed: fallbackModelNameFromParams,
                    crawlModelActuallyUsed: fallbackEffectiveCrawlModelType,
                    finalErrorType: fallbackModelFullResult.finalErrorType,
                    finalErrorDetails: fallbackModelFullResult.errorDetails
                };
            }
        } else {
            // Trường hợp này không nên xảy ra nếu logic đúng, vì nếu primary thành công, hàm đã return.
            // Nhưng để an toàn, nếu primarySucceeded là true mà vẫn đến đây, có nghĩa là có lỗi logic.
            callOperationLoggerBase.error({
                event: 'gemini_orchestration_logic_error',
                reason: 'Reached fallback section逻辑错误，主模型已成功但未返回。',
                primaryModelSucceeded,
                primaryModelName,
                apiType
            }, "Logic error in orchestration: Primary model succeeded but did not return early.");
            return { // Trả về kết quả của primary nếu có, hoặc lỗi
                responseText: primaryModelResult?.responseText || "",
                metaData: primaryModelResult?.metaData,
                success: primaryModelSucceeded,
                usedFallback: false,
                modelActuallyUsed: primaryModelName,
                crawlModelActuallyUsed: initialCrawlModelType,
                finalErrorType: primaryModelSucceeded ? undefined : (primaryModelResult?.finalErrorType || "orchestration_logic_error"),
                finalErrorDetails: primaryModelSucceeded ? undefined : (primaryModelResult?.errorDetails || { message: "Orchestration logic error" })
            };
        }
    }
}