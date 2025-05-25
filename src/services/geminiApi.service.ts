// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { type UsageMetadata } from "@google/generative-ai";
import { ConfigService, type AppConfig } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import path from 'path';

import { GeminiCachePersistenceService } from './gemini/geminiCachePersistence.service';
import { GeminiResponseHandlerService } from './gemini/geminiResponseHandler.service';
import { GeminiApiOrchestratorService } from './gemini/geminiApiOrchestrator.service';

import { CrawlModelType } from '../types/crawl/crawl.types';
import { ApiResponse, GeminiApiParams, OrchestrationResult } from '../types/crawl';


@singleton()
export class GeminiApiService {
    private readonly serviceBaseLogger: Logger;
    private readonly appConfig: AppConfig;

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
        // @inject(GeminiClientManagerService) private clientManager: GeminiClientManagerService, // Không dùng trực tiếp
        @inject(GeminiCachePersistenceService) private cachePersistence: GeminiCachePersistenceService,
        @inject(GeminiApiOrchestratorService) private apiOrchestrator: GeminiApiOrchestratorService,
        @inject(GeminiResponseHandlerService) private responseHandler: GeminiResponseHandlerService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('main', { service: 'GeminiApiService' });
        this.serviceBaseLogger.info("Constructing GeminiApiService...");

        this.appConfig = this.configService.config;
        const baseOutputDir = this.configService.baseOutputDir || path.join(process.cwd(), 'outputs');
        this.requestLogDir = path.join(baseOutputDir, 'gemini_api_requests_log');
        this.serviceBaseLogger.info({ requestLogDir: this.requestLogDir }, "Gemini API request logging directory initialized.");

        this.modelIndices = {
            [this.API_TYPE_EXTRACT]: 0,
            [this.API_TYPE_DETERMINE]: 0,
            [this.API_TYPE_CFP]: 0,
        };
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

    private async executeApiCallLogic(
        params: GeminiApiParams,
        apiType: string, // Sử dụng string để khớp với key của modelIndices
        initialCrawlModelType: CrawlModelType, // Đổi tên cho rõ ràng
        parentLogger?: Logger
    ): Promise<ApiResponse> {
        const { batch, batchIndex, title, acronym } = params;
        const methodLogger = this.getMethodLogger(parentLogger, apiType, { batchIndex, title, acronym, apiType, crawlModel: initialCrawlModelType });

        this.ensureInitialized(methodLogger);
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };

        let modelList: string[];
        let fallbackModelName: string | undefined;

        switch (apiType) {
            case this.API_TYPE_EXTRACT:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_EXTRACT_TUNED_MODEL_NAMES : this.appConfig.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES;
                fallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_EXTRACT_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_EXTRACT_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            case this.API_TYPE_DETERMINE:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_DETERMINE_TUNED_MODEL_NAMES : this.appConfig.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES;
                fallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_DETERMINE_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_DETERMINE_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            case this.API_TYPE_CFP:
                modelList = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_CFP_TUNED_MODEL_NAMES : this.appConfig.GEMINI_CFP_NON_TUNED_MODEL_NAMES;
                fallbackModelName = initialCrawlModelType === 'tuned' ? this.appConfig.GEMINI_CFP_TUNED_FALLBACK_MODEL_NAME : this.appConfig.GEMINI_CFP_NON_TUNED_FALLBACK_MODEL_NAME;
                break;
            default:
                methodLogger.error({ event: 'gemini_unknown_api_type', apiTypeReceived: apiType }, `Unknown API type: ${apiType}`);
                return defaultApiResponse;
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({
                event: 'gemini_model_list_empty_or_missing',
                apiType,
                crawlModel: initialCrawlModelType,
                sourceService: 'GeminiApiService',
            }, `Model list for ${apiType}/${initialCrawlModelType} is empty.`);
            return defaultApiResponse;
        }

        const currentIndex = this.modelIndices[apiType];
        const selectedModelName = modelList[currentIndex];
        this.modelIndices[apiType] = (currentIndex + 1) % modelList.length; // Cập nhật index cho lần gọi sau

        methodLogger.debug({ selectedModel: selectedModelName, fallbackModelName: fallbackModelName || 'N/A', nextIndex: this.modelIndices[apiType], listUsedLength: modelList.length }, "Model selected (round-robin)");

        try {
            const orchestrationResult: OrchestrationResult = await this.apiOrchestrator.orchestrateApiCall({
                batchPrompt: batch, batchIndex, title, acronym,
                apiType, modelName: selectedModelName, fallbackModelName, 
                crawlModel: initialCrawlModelType, // Truyền initialCrawlModelType vào orchestrator
                requestLogDir: this.requestLogDir,
            }, methodLogger);

            if (orchestrationResult.success) {
                const cleaningLogger = methodLogger.child({
                    modelUsed: orchestrationResult.modelActuallyUsed,
                    crawlModelUsed: orchestrationResult.crawlModelActuallyUsed,
                    usedFallback: orchestrationResult.usedFallback,
                    sub_op: 'jsonClean'
                });
                const cleanedResponseText = this.responseHandler.cleanJsonResponse(orchestrationResult.responseText, cleaningLogger);

                if (orchestrationResult.responseText && cleanedResponseText === "" && orchestrationResult.responseText !== "{}") {
                    cleaningLogger.warn({
                        event: 'json_clean_empty_from_non_empty',
                        rawResponseSnippet: orchestrationResult.responseText.substring(0, 200),
                        apiType, modelUsed: orchestrationResult.modelActuallyUsed
                    }, `JSON cleaning resulted in empty string from non-empty input for ${apiType}.`);
                } else if (cleanedResponseText !== orchestrationResult.responseText) {
                    cleaningLogger.debug({ event: 'json_clean_applied', apiType }, `Successfully cleaned JSON response for ${apiType}.`);
                } else {
                     cleaningLogger.trace({ event: 'json_clean_not_needed', apiType }, `JSON response for ${apiType} did not require cleaning.`);
                }
                 // Đặc biệt cho determineLinks và cfp, kiểm tra cấu trúc JSON sau khi clean
                if (apiType === this.API_TYPE_DETERMINE || apiType === this.API_TYPE_CFP) {
                    if (!cleanedResponseText && orchestrationResult.responseText) { // Nếu clean làm rỗng
                        const originalFirstCurly = orchestrationResult.responseText.indexOf('{');
                        const originalLastCurly = orchestrationResult.responseText.lastIndexOf('}');
                        if (originalFirstCurly !== -1 && originalLastCurly !== -1 && originalLastCurly >= originalFirstCurly) {
                            cleaningLogger.warn({ rawResponseSnippet: orchestrationResult.responseText.substring(0, 200), event: `json_clean_parse_failed_after_clean_for_${apiType}` }, `Failed to parse ${apiType} text as JSON after cleaning (resulted in empty).`);
                        } else {
                            cleaningLogger.warn({ rawResponseSnippet: orchestrationResult.responseText.substring(0, 200), event: `json_clean_structure_not_found_after_clean_for_${apiType}` }, `No JSON structure in ${apiType} response after cleaning (resulted in empty).`);
                        }
                    } else if (cleanedResponseText) {
                         try {
                            JSON.parse(cleanedResponseText);
                            cleaningLogger.debug({ event: `json_clean_final_valid_for_${apiType}`}, `Cleaned response for ${apiType} is valid JSON.`);
                         } catch (e) {
                            cleaningLogger.error({ rawResponseSnippet: cleanedResponseText.substring(0,200), event: `json_clean_final_invalid_for_${apiType}`}, `Cleaned response for ${apiType} is NOT valid JSON.`);
                         }
                    }
                }


                methodLogger.info({
                    event: 'gemini_public_method_finish',
                    apiType,
                    modelUsed: orchestrationResult.modelActuallyUsed,
                    crawlModel: orchestrationResult.crawlModelActuallyUsed,
                    isFallbackSuccess: orchestrationResult.usedFallback,
                    cleanedResponseLength: cleanedResponseText.length,
                    tokens: orchestrationResult.metaData?.totalTokenCount,
                }, `${apiType} API call finished successfully.`);
                return { responseText: cleanedResponseText, metaData: orchestrationResult.metaData };
            } else {
                methodLogger.error({
                    event: 'gemini_public_method_orchestration_failed',
                    apiType,
                    selectedModel: selectedModelName,
                    initialCrawlModel: initialCrawlModelType,
                    finalErrorType: orchestrationResult.finalErrorType,
                    finalErrorDetails: orchestrationResult.finalErrorDetails,
                    sourceService: 'GeminiApiService.OrchestrationFailed',
                }, `Orchestration failed for ${apiType}. Final error: ${orchestrationResult.finalErrorType}`);
                return defaultApiResponse;
            }
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0,300) } : { details: String(error) };
            methodLogger.error({
                event: 'gemini_public_method_unhandled_error',
                apiType,
                selectedModel: selectedModelName,
                crawlModel: initialCrawlModelType,
                err: errorDetails,
                sourceService: 'GeminiApiService.InternalError',
            }, `Unhandled error in ${apiType} public method.`);
            return defaultApiResponse;
        }
    }

    public async extractInformation(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_EXTRACT, crawlModel, parentLogger);
    }

    public async extractCfp(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_CFP, crawlModel, parentLogger);
    }

    public async determineLinks(params: GeminiApiParams, crawlModel: CrawlModelType, parentLogger?: Logger): Promise<ApiResponse> {
        return this.executeApiCallLogic(params, this.API_TYPE_DETERMINE, crawlModel, parentLogger);
    }
}