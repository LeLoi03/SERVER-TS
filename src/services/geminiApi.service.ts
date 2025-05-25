// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { type UsageMetadata, type Part, type Content, type GenerationConfig as SDKGenerationConfig } from "@google/generative-ai";
import { ConfigService, type AppConfig, type GeminiApiConfig as GeneralApiTypeConfig } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import path from 'path';
import axios, { AxiosError } from 'axios';

import { GeminiCachePersistenceService } from './gemini/geminiCachePersistence.service';
import { GeminiResponseHandlerService } from './gemini/geminiResponseHandler.service';
import { GeminiApiOrchestratorService } from './gemini/geminiApiOrchestrator.service';

import { CrawlModelType } from '../types/crawl/crawl.types';
import { ApiResponse, GeminiApiParams, OrchestrationResult, VpsApiPayload, VpsApiResponse } from '../types/crawl';
import { getErrorMessageAndStack } from '../utils/errorUtils';

// Định nghĩa các lỗi tùy chỉnh cho VPS
class VpsReportedError extends Error {
    public details?: any;
    constructor(message: string, details?: any) {
        super(message);
        this.name = "VpsReportedError";
        this.details = details;
    }
}
class VpsNetworkError extends Error {
    public details?: any;
    constructor(message: string, details?: any) {
        super(message);
        this.name = "VpsNetworkError";
        this.details = details;
    }
}

@singleton()
export class GeminiApiService {
    private readonly serviceBaseLogger: Logger;
    private readonly appConfig: AppConfig;
    private readonly generalApiTypeSettings: Record<string, GeneralApiTypeConfig>;

    public readonly API_TYPE_EXTRACT = 'extract';
    public readonly API_TYPE_DETERMINE = 'determine';
    public readonly API_TYPE_CFP = 'cfp';

    private modelIndices: {
        [apiType: string]: number;
    };

    private serviceInitialized: boolean = false;
    private readonly requestLogDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GeminiCachePersistenceService) private cachePersistence: GeminiCachePersistenceService,
        @inject(GeminiApiOrchestratorService) private apiOrchestrator: GeminiApiOrchestratorService,
        @inject(GeminiResponseHandlerService) private responseHandler: GeminiResponseHandlerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('main', { service: 'GeminiApiService' });
        this.serviceBaseLogger.info("Constructing GeminiApiService...");

        this.appConfig = this.configService.config;
        this.generalApiTypeSettings = this.configService.geminiApiConfigs;
        const baseOutputDir = this.configService.baseOutputDir || path.join(process.cwd(), 'outputs');
        this.requestLogDir = path.join(baseOutputDir, 'gemini_api_requests_log');
        this.serviceBaseLogger.info({ requestLogDir: this.requestLogDir }, "Gemini API request logging directory initialized.");

        this.modelIndices = {
            [this.API_TYPE_EXTRACT]: 0,
            [this.API_TYPE_DETERMINE]: 0,
            [this.API_TYPE_CFP]: 0,
        };

        if (this.appConfig.VPS_WORKER_URL) {
            this.serviceBaseLogger.info({
                vpsUrl: this.appConfig.VPS_WORKER_URL,
            }, "VPS Worker integration is configured.");
        }
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
        logger.info({ event: 'gemini_service_async_init_start' }, "Running async initialization for GeminiApiService...");
        try {
            await this.cachePersistence.loadMap(this.loggingService.getLogger('main', { service: 'GeminiCachePersistenceService', operation: 'loadMapOnInit' }));
            this.serviceInitialized = true;
            logger.info({ event: 'gemini_service_async_init_complete' }, "GeminiApiService async initialization complete.");
        } catch (error) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            logger.error({ err: errorDetails, event: 'gemini_service_async_init_failed' }, "GeminiApiService async initialization failed.");
        }
    }

    private ensureInitialized(logger: Logger): void {
        if (!this.serviceInitialized) {
            const errorMsg = "GeminiApiService is not initialized. Please call `init()` and await its completion.";
            logger.fatal({ event: 'gemini_service_critically_uninitialized', detail: errorMsg, apiType: (logger.bindings() as any).apiType }, errorMsg);
            throw new Error(errorMsg);
        }
    }

    private _prepareFewShotPartsForVps(apiType: string, configForApiType: GeneralApiTypeConfig, parentLogger: Logger): Part[] {
        const fewShotParts: Part[] = [];
        const prepLogger = parentLogger.child({
            vpsFewShotPrepFunc: 'GeminiApiService._prepareFewShotPartsForVps'
        });

        if (!configForApiType.inputs || !configForApiType.outputs || Object.keys(configForApiType.inputs).length === 0) {
            prepLogger.debug({ event: 'vps_few_shot_prep_skipped_no_data_in_config' }, "Skipping few-shot for VPS: No inputs/outputs found or inputs are empty in API config.");
            return fewShotParts;
        }
        prepLogger.debug({ event: 'vps_few_shot_prep_start' }, "Preparing few-shot parts for VPS from config");
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
                else prepLogger.warn({ inputKey, event: 'vps_few_shot_prep_missing_or_empty_input_value' }, `Input value for ${inputKey} is missing or empty (for VPS).`);

                if (inputValue && outputValue) fewShotParts.push({ text: outputValue });
                else if (inputValue && !outputValue) prepLogger.warn({ inputKey, outputKey, event: 'vps_few_shot_prep_missing_or_empty_output_value_for_input' }, `Output value for ${outputKey} (for ${inputKey}) is missing or empty (for VPS).`);
            });

            if (fewShotParts.length === 0) prepLogger.warn({ event: 'vps_few_shot_prep_empty_result_after_processing' }, "Few-shot for VPS processed, but resulted in empty parts array.");
            else if (fewShotParts.length % 2 !== 0) prepLogger.error({ event: 'vps_few_shot_prep_odd_parts_count', count: fewShotParts.length }, "CRITICAL: Prepared few-shot parts for VPS have an odd count.");
            else prepLogger.debug({ fewShotPairCount: fewShotParts.length / 2, totalParts: fewShotParts.length, event: 'vps_few_shot_prep_success' }, "Prepared few-shot parts for VPS");

        } catch (fewShotError: unknown) {
            const { message, stack } = getErrorMessageAndStack(fewShotError);
            prepLogger.error({ err: { message, stack }, event: 'vps_few_shot_prep_failed' }, "Error processing few-shot examples for VPS. Returning empty array.");
            fewShotParts.length = 0;
        }
        return fewShotParts;
    }

    private async _callApiViaVps(
        vpsPayload: VpsApiPayload,
        parentLogger: Logger
    ): Promise<ApiResponse> {
        const { apiType, modelName, baseParams } = vpsPayload;
        const vpsLogger = parentLogger.child({ vpsCall: true, modelForVps: modelName, acronym: baseParams.acronym, batchIndex: baseParams.batchIndex });

        if (!this.appConfig.VPS_WORKER_URL || !this.appConfig.VPS_WORKER_AUTH_TOKEN) {
            vpsLogger.error({ event: 'vps_call_misconfigured' }, "VPS worker URL or auth token not configured.");
            throw new VpsNetworkError("VPS worker not configured.", { type: "Misconfigured" });
        }

        vpsLogger.info({ event: 'gemini_vps_call_attempt', vpsUrl: this.appConfig.VPS_WORKER_URL, apiType, modelName }, `Attempting API call via VPS for ${apiType} with model ${modelName}`);

        try {
            const response = await axios.post<VpsApiResponse>(
                this.appConfig.VPS_WORKER_URL,
                vpsPayload,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        // 'X-VPS-Auth-Token': this.appConfig.VPS_WORKER_AUTH_TOKEN
                    },
                    timeout: this.appConfig.GEMINI_MAX_DELAY_MS * 3
                }
            );

            if (response.data && response.data.success && response.data.data) {
                vpsLogger.info({
                    event: 'gemini_vps_call_success',
                    apiType,
                    modelUsedOnVps: modelName,
                    tokens: response.data.data.metaData?.totalTokenCount,
                }, `VPS call successful for ${apiType} with model ${modelName}.`);
                return {
                    responseText: response.data.data.responseText,
                    metaData: response.data.data.metaData
                };
            } else {
                const vpsErrorDetails = response.data?.error || { message: "Unknown error from VPS response" };
                vpsLogger.error({
                    event: 'gemini_vps_call_failed_on_vps_side',
                    apiType, modelUsedOnVps: modelName,
                    vpsResponseStatus: response.status, vpsError: vpsErrorDetails
                }, `VPS call for ${apiType} with ${modelName} failed on VPS side. Error: ${vpsErrorDetails.message}`);
                throw new VpsReportedError(`VPS Error (${vpsErrorDetails.name || 'VpsProcessingError'}): ${vpsErrorDetails.message}`, vpsErrorDetails);
            }
        } catch (error: any) {
            if (error instanceof VpsReportedError) throw error;

            let errorDetails: any = { message: String(error) };
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                errorDetails = {
                    message: axiosError.message,
                    code: axiosError.code,
                    configUrl: axiosError.config?.url,
                    responseStatus: axiosError.response?.status,
                    responseData: axiosError.response?.data
                };
            }
            vpsLogger.error({
                event: 'gemini_vps_call_network_error',
                apiType, modelUsedOnVps: modelName, err: errorDetails,
            }, `Network/Axios error during VPS call for ${apiType} with ${modelName}.`);
            throw new VpsNetworkError(`VPS Network/Axios Error: ${errorDetails.message}`, errorDetails);
        }
    }

    private async executeApiCallLogic(
        params: GeminiApiParams,
        apiType: string,
        initialCrawlModelType: CrawlModelType,
        useVpsForThisBatch: boolean,
        parentLogger?: Logger
    ): Promise<ApiResponse> {
        const { batch: batchPrompt, batchIndex, title, acronym } = params;
        const methodLogger = this.getMethodLogger(parentLogger, apiType, { batchIndex, title, acronym, apiType, initialCrawlModelType, useVps: useVpsForThisBatch });

        this.ensureInitialized(methodLogger);
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };

        let modelList: string[];
        let primaryFallbackModelName: string | undefined;

        switch (apiType) {
            case this.API_TYPE_EXTRACT:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_EXTRACT_TUNED_MODEL_NAMES : this.appConfig.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES;
                primaryFallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_EXTRACT_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_EXTRACT_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            case this.API_TYPE_DETERMINE:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_DETERMINE_TUNED_MODEL_NAMES : this.appConfig.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES;
                primaryFallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_DETERMINE_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_DETERMINE_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            case this.API_TYPE_CFP:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_CFP_TUNED_MODEL_NAMES : this.appConfig.GEMINI_CFP_NON_TUNED_MODEL_NAMES;
                primaryFallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_CFP_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_CFP_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            default:
                methodLogger.error({ event: 'gemini_unknown_api_type', apiTypeReceived: apiType }, `Unknown API type: ${apiType}`);
                return defaultApiResponse;
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({
                event: 'gemini_model_list_empty_or_missing',
                apiType, crawlModel: initialCrawlModelType, sourceService: 'GeminiApiService',
            }, `Model list for ${apiType}/${initialCrawlModelType} is empty.`);
            return defaultApiResponse;
        }

        const currentIndex = this.modelIndices[apiType];
        const selectedPrimaryModelName = modelList[currentIndex];
        this.modelIndices[apiType] = (currentIndex + 1) % modelList.length;

        methodLogger.debug({ selectedPrimaryModel: selectedPrimaryModelName, primaryFallbackModel: primaryFallbackModelName || 'N/A', nextModelIndex: this.modelIndices[apiType] }, "Primary model selected for this call.");

        if (useVpsForThisBatch) {
            methodLogger.info({ event: 'dispatch_to_vps', apiType, modelName: selectedPrimaryModelName }, `Attempting primary call for ${apiType} via VPS with model ${selectedPrimaryModelName}.`);

            const generalSettings = this.generalApiTypeSettings[apiType];
            if (!generalSettings) {
                methodLogger.error({ event: 'gemini_vps_call_missing_apitypeconfig', apiType }, `API type configuration for '${apiType}' not found. Cannot prepare for VPS call.`);
                return defaultApiResponse;
            }

            let systemInstructionTextForVps: string;
            let fewShotPartsForVps: Part[];
            let generationConfigForVps: SDKGenerationConfig;
            let finalBatchPromptForVps = batchPrompt;

            const isEffectivelyTunedCallForVps = initialCrawlModelType === 'tuned';

            if (isEffectivelyTunedCallForVps) {
                systemInstructionTextForVps = "";
                fewShotPartsForVps = [];
                generationConfigForVps = { ...generalSettings.generationConfig, responseMimeType: "text/plain" };
                if (generationConfigForVps.responseSchema) delete generationConfigForVps.responseSchema;
                const prefixForTuned = generalSettings.systemInstructionPrefixForNonTunedModel;
                if (prefixForTuned?.trim()) {
                    finalBatchPromptForVps = `${prefixForTuned.trim()}\n\n${batchPrompt}`;
                }
            } else {
                systemInstructionTextForVps = generalSettings.systemInstruction || "";
                fewShotPartsForVps = generalSettings.allowFewShotForNonTuned
                    ? this._prepareFewShotPartsForVps(apiType, generalSettings, methodLogger)
                    : [];
                generationConfigForVps = { ...generalSettings.generationConfig };
                generationConfigForVps.responseMimeType = generalSettings.generationConfig.responseMimeType || "application/json";
                if (generalSettings.generationConfig.responseSchema && generationConfigForVps.responseMimeType === "application/json") {
                    generationConfigForVps.responseSchema = generalSettings.generationConfig.responseSchema;
                } else if (generationConfigForVps.responseSchema) {
                    delete generationConfigForVps.responseSchema;
                }
            }

            // Đầu hàm executeApiCallLogic, hoặc trước khi tạo payload
            if (typeof title === 'undefined' || typeof acronym === 'undefined') {
                methodLogger.error({
                    event: 'gemini_missing_required_params_for_vps',
                    apiType,
                    titleProvided: typeof title,
                    acronymProvided: typeof acronym
                }, "Title or Acronym is undefined, cannot proceed with VPS call.");
                // Hoặc throw new Error("Title and Acronym are required for VPS call.");
                return defaultApiResponse; // Hoặc ném lỗi
            }

            // Sau đó, bạn có thể sử dụng title và acronym một cách an toàn
            const vpsPayloadPrimary: VpsApiPayload = {
                baseParams: {
                    batchIndex,
                    title: title, // TypeScript sẽ hiểu title là string ở đây
                    acronym: acronym, // TypeScript sẽ hiểu acronym là string ở đây
                },
                apiType,
                modelName: selectedPrimaryModelName,
                prompt: finalBatchPromptForVps,
                systemInstruction: systemInstructionTextForVps,
                fewShotParts: fewShotPartsForVps,
                generationConfig: generationConfigForVps,
            };

            try {
                const vpsResult = await this._callApiViaVps(vpsPayloadPrimary, methodLogger);
                const cleaningLogger = methodLogger.child({ modelUsed: selectedPrimaryModelName, crawlModelUsed: initialCrawlModelType, sub_op: 'jsonClean_vps_primary' });
                const cleanedResponseText = this.responseHandler.cleanJsonResponse(vpsResult.responseText, cleaningLogger);
                this.logJsonCleaningOutcome(apiType, vpsResult.responseText, cleanedResponseText, cleaningLogger, `_vps_primary`);

                methodLogger.info({
                    event: 'gemini_public_method_finish_vps_primary',
                    apiType, modelUsed: selectedPrimaryModelName, crawlModel: initialCrawlModelType,
                    cleanedResponseLength: cleanedResponseText.length, tokens: vpsResult.metaData?.totalTokenCount,
                }, `${apiType} API call via VPS (primary) finished successfully.`);
                return { responseText: cleanedResponseText, metaData: vpsResult.metaData };

            } catch (vpsErrorPrimary: any) {
                methodLogger.warn({
                    event: 'gemini_vps_primary_call_failed',
                    apiType, modelUsed: selectedPrimaryModelName, crawlModel: initialCrawlModelType,
                    errorName: vpsErrorPrimary.name, errorMessage: vpsErrorPrimary.message, errorDetails: vpsErrorPrimary.details,
                }, `Primary call via VPS for ${apiType} with ${selectedPrimaryModelName} failed. Attempting fallback via VPS if configured.`);

                if (primaryFallbackModelName) {
                    methodLogger.info({ event: 'dispatch_to_vps_fallback', apiType, modelName: primaryFallbackModelName }, `Attempting fallback call for ${apiType} via VPS with model ${primaryFallbackModelName}.`);

                    const fallbackCrawlModelType: CrawlModelType = (initialCrawlModelType === 'tuned') ? 'non-tuned' : initialCrawlModelType;
                    let systemInstructionTextForVpsFallback: string;
                    let fewShotPartsForVpsFallback: Part[];
                    let generationConfigForVpsFallback: SDKGenerationConfig;
                    let finalBatchPromptForVpsFallback = batchPrompt;

                    systemInstructionTextForVpsFallback = generalSettings.systemInstruction || "";
                    fewShotPartsForVpsFallback = generalSettings.allowFewShotForNonTuned
                        ? this._prepareFewShotPartsForVps(apiType, generalSettings, methodLogger.child({ forFallback: true }))
                        : [];
                    generationConfigForVpsFallback = { ...generalSettings.generationConfig };
                    generationConfigForVpsFallback.responseMimeType = generalSettings.generationConfig.responseMimeType || "application/json";
                    if (generalSettings.generationConfig.responseSchema && generationConfigForVpsFallback.responseMimeType === "application/json") {
                        generationConfigForVpsFallback.responseSchema = generalSettings.generationConfig.responseSchema;
                    } else if (generationConfigForVpsFallback.responseSchema) {
                        delete generationConfigForVpsFallback.responseSchema;
                    }

                    const vpsPayloadFallback: VpsApiPayload = {
                        baseParams: { batchIndex, title, acronym },
                        apiType,
                        modelName: primaryFallbackModelName,
                        prompt: finalBatchPromptForVpsFallback,
                        systemInstruction: systemInstructionTextForVpsFallback,
                        fewShotParts: fewShotPartsForVpsFallback,
                        generationConfig: generationConfigForVpsFallback,
                    };

                    try {
                        const vpsFallbackResult = await this._callApiViaVps(vpsPayloadFallback, methodLogger);
                        const cleaningLoggerFallback = methodLogger.child({ modelUsed: primaryFallbackModelName, crawlModelUsed: fallbackCrawlModelType, sub_op: 'jsonClean_vps_fallback' });
                        const cleanedResponseTextFallback = this.responseHandler.cleanJsonResponse(vpsFallbackResult.responseText, cleaningLoggerFallback);
                        this.logJsonCleaningOutcome(apiType, vpsFallbackResult.responseText, cleanedResponseTextFallback, cleaningLoggerFallback, `_vps_fallback`);

                        methodLogger.info({
                            event: 'gemini_public_method_finish_vps_fallback',
                            apiType, modelUsed: primaryFallbackModelName, crawlModel: fallbackCrawlModelType, usedFallback: true,
                            cleanedResponseLength: cleanedResponseTextFallback.length, tokens: vpsFallbackResult.metaData?.totalTokenCount,
                        }, `${apiType} API call via VPS (fallback) finished successfully.`);
                        return { responseText: cleanedResponseTextFallback, metaData: vpsFallbackResult.metaData };

                    } catch (vpsErrorFallback: any) {
                        methodLogger.error({
                            event: 'gemini_vps_fallback_call_failed',
                            apiType, primaryModel: selectedPrimaryModelName, fallbackModel: primaryFallbackModelName,
                            crawlModelPrimary: initialCrawlModelType, crawlModelFallback: fallbackCrawlModelType,
                            errorName: vpsErrorFallback.name, errorMessage: vpsErrorFallback.message, errorDetails: vpsErrorFallback.details,
                            sourceService: 'GeminiApiService.VpsFallbackFailed',
                        }, `Fallback call via VPS for ${apiType} with ${primaryFallbackModelName} also failed. No more VPS attempts.`);
                        return defaultApiResponse;
                    }
                } else {
                    methodLogger.warn({
                        event: 'gemini_vps_primary_failed_no_fallback',
                        apiType, modelUsed: selectedPrimaryModelName, crawlModel: initialCrawlModelType,
                    }, `Primary call via VPS failed for ${apiType}, and no fallback model configured for VPS path.`);
                    return defaultApiResponse;
                }
            }
        } else {
            methodLogger.info({ event: 'dispatch_to_local', apiType, modelName: selectedPrimaryModelName }, `Executing API call for ${apiType} locally with model ${selectedPrimaryModelName}.`);
            try {
                const orchestrationResult: OrchestrationResult = await this.apiOrchestrator.orchestrateApiCall({
                    batchPrompt, batchIndex, title, acronym,
                    apiType, modelName: selectedPrimaryModelName, fallbackModelName: primaryFallbackModelName,
                    crawlModel: initialCrawlModelType,
                    requestLogDir: this.requestLogDir,
                }, methodLogger);

                if (orchestrationResult.success) {
                    const cleaningLogger = methodLogger.child({
                        modelUsed: orchestrationResult.modelActuallyUsed,
                        crawlModelUsed: orchestrationResult.crawlModelActuallyUsed,
                        usedFallback: orchestrationResult.usedFallback,
                        sub_op: 'jsonClean_local'
                    });
                    const cleanedResponseText = this.responseHandler.cleanJsonResponse(orchestrationResult.responseText, cleaningLogger);
                    this.logJsonCleaningOutcome(apiType, orchestrationResult.responseText, cleanedResponseText, cleaningLogger, `_local`);

                    methodLogger.info({
                        event: 'gemini_public_method_finish',
                        apiType,
                        modelUsed: orchestrationResult.modelActuallyUsed,
                        crawlModel: orchestrationResult.crawlModelActuallyUsed,
                        isFallbackSuccess: orchestrationResult.usedFallback,
                        cleanedResponseLength: cleanedResponseText.length,
                        tokens: orchestrationResult.metaData?.totalTokenCount,
                    }, `${apiType} API call (local) finished successfully.`);
                    return { responseText: cleanedResponseText, metaData: orchestrationResult.metaData };
                } else {
                    methodLogger.error({
                        event: 'gemini_public_method_orchestration_failed',
                        apiType,
                        selectedModel: selectedPrimaryModelName,
                        initialCrawlModel: initialCrawlModelType,
                        finalErrorType: orchestrationResult.finalErrorType,
                        finalErrorDetails: orchestrationResult.finalErrorDetails,
                        sourceService: 'GeminiApiService.OrchestrationFailedLocal',
                    }, `Local orchestration failed for ${apiType}. Final error: ${orchestrationResult.finalErrorType}`);
                    return defaultApiResponse;
                }
            } catch (error: unknown) {
                const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
                methodLogger.error({
                    event: 'gemini_public_method_unhandled_error',
                    apiType,
                    selectedModel: selectedPrimaryModelName,
                    crawlModel: initialCrawlModelType,
                    err: errorDetails,
                    sourceService: 'GeminiApiService.InternalErrorLocal',
                }, `Unhandled error in ${apiType} public method (local).`);
                return defaultApiResponse;
            }
        }
    }

    private logJsonCleaningOutcome(
        apiType: string,
        originalResponseText: string | undefined | null,
        cleanedResponseText: string,
        cleaningLogger: Logger,
        sourceSuffix: string
    ): void {
        if (originalResponseText && cleanedResponseText === "" && originalResponseText !== "{}") {
            cleaningLogger.warn({
                event: `json_clean_empty_from_non_empty${sourceSuffix}`,
                rawResponseSnippet: originalResponseText.substring(0, 200),
                apiType, modelUsed: (cleaningLogger.bindings() as any).modelUsed
            }, `JSON cleaning resulted in empty string from non-empty input for ${apiType} from source${sourceSuffix}.`);
        } else if (cleanedResponseText !== originalResponseText) {
            cleaningLogger.debug({ event: `json_clean_applied${sourceSuffix}`, apiType }, `Successfully cleaned JSON response for ${apiType} from source${sourceSuffix}.`);
        } else {
            cleaningLogger.trace({ event: `json_clean_not_needed${sourceSuffix}`, apiType }, `JSON response for ${apiType} from source${sourceSuffix} did not require cleaning.`);
        }

        if (apiType === this.API_TYPE_DETERMINE || apiType === this.API_TYPE_CFP) {
            if (!cleanedResponseText && originalResponseText) {
                const originalFirstCurly = originalResponseText.indexOf('{');
                const originalLastCurly = originalResponseText.lastIndexOf('}');
                if (originalFirstCurly !== -1 && originalLastCurly !== -1 && originalLastCurly >= originalFirstCurly) {
                    cleaningLogger.warn({ rawResponseSnippet: originalResponseText.substring(0, 200), event: `json_clean_parse_failed_after_clean_for_${apiType}${sourceSuffix}` }, `Failed to parse ${apiType} text as JSON after cleaning (resulted in empty) from source${sourceSuffix}.`);
                } else {
                    cleaningLogger.warn({ rawResponseSnippet: originalResponseText.substring(0, 200), event: `json_clean_structure_not_found_after_clean_for_${apiType}${sourceSuffix}` }, `No JSON structure in ${apiType} response after cleaning (resulted in empty) from source${sourceSuffix}.`);
                }
            } else if (cleanedResponseText) {
                try {
                    JSON.parse(cleanedResponseText);
                    cleaningLogger.debug({ event: `json_clean_final_valid_for_${apiType}${sourceSuffix}` }, `Cleaned response for ${apiType} from source${sourceSuffix} is valid JSON.`);
                } catch (e) {
                    cleaningLogger.error({ rawResponseSnippet: cleanedResponseText.substring(0, 200), event: `json_clean_final_invalid_for_${apiType}${sourceSuffix}` }, `Cleaned response for ${apiType} from source${sourceSuffix} is NOT valid JSON.`);
                }
            }
        }
    }

    public async extractInformation(params: GeminiApiParams, crawlModel: CrawlModelType, useVpsForThisBatch: boolean, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_EXTRACT, crawlModel, useVpsForThisBatch, parentLogger);
    }

    public async extractCfp(params: GeminiApiParams, crawlModel: CrawlModelType, useVpsForThisBatch: boolean, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_CFP, crawlModel, useVpsForThisBatch, parentLogger);
    }

    public async determineLinks(params: GeminiApiParams, crawlModel: CrawlModelType, useVpsForThisBatch: boolean, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_DETERMINE, crawlModel, useVpsForThisBatch, parentLogger);
    }
}