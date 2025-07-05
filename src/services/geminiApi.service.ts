// src/services/geminiApi.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { ConfigService } from '../config';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import path from 'path';

// +++ THÊM IMPORT NÀY +++
import { ContentListUnion } from "@google/genai";

import { GeminiCachePersistenceService } from './gemini/geminiCachePersistence.service';
import { GeminiResponseHandlerService } from './gemini/geminiResponseHandler.service';
import { GeminiApiOrchestratorService } from './gemini/geminiApiOrchestrator.service';

import { CrawlModelType } from '../types/crawl/crawl.types';
import { ApiResponse, GeminiApiParams, OrchestrationResult } from '../types/crawl';

import { API_TYPE_EXTRACT, API_TYPE_DETERMINE, API_TYPE_CFP } from '../config/constants';


@singleton()
export class GeminiApiService {
    private readonly serviceBaseLogger: Logger;

    public readonly API_TYPE_EXTRACT = API_TYPE_EXTRACT;
    public readonly API_TYPE_DETERMINE = API_TYPE_DETERMINE;
    public readonly API_TYPE_CFP = API_TYPE_CFP;

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
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'GeminiApiService' });
        this.serviceBaseLogger.info("Constructing GeminiApiService...");

        const baseOutputDir = this.configService.baseOutputDir;
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
            await this.cachePersistence.loadMap(this.loggingService.getLogger('conference', { service: 'GeminiCachePersistenceService', operation: 'loadMapOnInit' }));
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

    // +++ THAY ĐỔI CHÍNH NẰM Ở ĐÂY +++
    private async executeApiCallLogic(
        params: GeminiApiParams,
        apiType: string,
        initialCrawlModelType: CrawlModelType,
        parentLogger?: Logger
    ): Promise<ApiResponse> {
        // Destructure cả `contents` và `batch` từ params
        const { contents, batch, batchIndex, title, acronym } = params;
        const methodLogger = this.getMethodLogger(parentLogger, apiType, { batchIndex, title, acronym, apiType, crawlModel: initialCrawlModelType });

        this.ensureInitialized(methodLogger);
        const defaultApiResponse: ApiResponse = { responseText: "", metaData: null };

        // --- Logic chọn model giữ nguyên ---
        let modelList: string[];
        let fallbackModelName: string | undefined;
        const geminiApiTypeConfig = this.configService.geminiApiTypeConfiguration;


        switch (apiType) {
            case API_TYPE_EXTRACT: // Use imported constants
                modelList = initialCrawlModelType === 'tuned'
                    ? geminiApiTypeConfig.extractTunedModelNames
                    : geminiApiTypeConfig.extractNonTunedModelNames;
                fallbackModelName = initialCrawlModelType === 'tuned'
                    ? geminiApiTypeConfig.extractTunedFallbackModelName
                    : geminiApiTypeConfig.extractNonTunedFallbackModelName;
                break;
            case API_TYPE_DETERMINE: // Use imported constants
                modelList = initialCrawlModelType === 'tuned'
                    ? geminiApiTypeConfig.determineTunedModelNames
                    : geminiApiTypeConfig.determineNonTunedModelNames;
                fallbackModelName = initialCrawlModelType === 'tuned'
                    ? geminiApiTypeConfig.determineTunedFallbackModelName
                    : geminiApiTypeConfig.determineNonTunedFallbackModelName;
                break;
            case API_TYPE_CFP: // Use imported constants
                modelList = initialCrawlModelType === 'tuned'
                    ? geminiApiTypeConfig.cfpTunedModelNames
                    : geminiApiTypeConfig.cfpNonTunedModelNames;
                fallbackModelName = initialCrawlModelType === 'tuned'
                    ? geminiApiTypeConfig.cfpTunedFallbackModelName
                    : geminiApiTypeConfig.cfpNonTunedFallbackModelName;
                break;
            default:
                methodLogger.error({ event: 'gemini_unknown_api_type', apiTypeReceived: apiType }, `Unknown API type: ${apiType}`);
                // return defaultApiResponse; // Or throw error
                // Ensure defaultApiResponse is defined or handle appropriately
                throw new Error(`Unknown API type: ${apiType}`); // More robust to throw
        }

        if (!modelList || modelList.length === 0) {
            methodLogger.error({
                event: 'gemini_model_list_empty_or_missing',
                apiType,
                crawlModel: initialCrawlModelType,
            }, `Model list for ${apiType}/${initialCrawlModelType} is empty.`);
            return defaultApiResponse;
        }
        const currentIndex = this.modelIndices[apiType];
        const selectedModelName = modelList[currentIndex];
        this.modelIndices[apiType] = (currentIndex + 1) % modelList.length;


        // +++ LOGIC MỚI: XÁC ĐỊNH NỘI DUNG GỬI ĐI (userContent) +++
        let userContent: ContentListUnion;
        if (contents && contents.length > 0) {
            // Ưu tiên `contents` nếu nó tồn tại (trường hợp multimodal)
            userContent = contents;
            methodLogger.info({ contentType: 'multimodal', partCount: contents.length }, "Executing API call with multimodal content.");
        } else if (batch) {
            // Dùng `batch` nếu không có `contents` (trường hợp text-only)
            userContent = batch;
            methodLogger.info({ contentType: 'text-only', contentLength: batch.length }, "Executing API call with text-only content.");
        } else {
            // Trường hợp không có nội dung nào được cung cấp
            methodLogger.error({ event: 'gemini_api_call_no_content' }, "API call attempted without 'contents' or 'batch'. Aborting.");
            return defaultApiResponse;
        }

        try {
            // +++ TRUYỀN `userContent` XUỐNG ORCHESTRATOR +++
            const orchestrationResult: OrchestrationResult = await this.apiOrchestrator.orchestrateApiCall({
                userContent, // <<< THAY THẾ `batchPrompt`
                batchIndex,
                title,
                acronym,
                apiType,
                modelName: selectedModelName,
                fallbackModelName,
                crawlModel: initialCrawlModelType,
                requestLogDir: this.requestLogDir,
            }, methodLogger);

            // --- Toàn bộ logic xử lý response sau khi gọi orchestrator giữ nguyên ---
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
                            cleaningLogger.debug({ event: `json_clean_final_valid_for_${apiType}` }, `Cleaned response for ${apiType} is valid JSON.`);
                        } catch (e) {
                            cleaningLogger.error({ rawResponseSnippet: cleanedResponseText.substring(0, 200), event: `json_clean_final_invalid_for_${apiType}` }, `Cleaned response for ${apiType} is NOT valid JSON.`);
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
                }, `Orchestration failed for ${apiType}. Final error: ${orchestrationResult.finalErrorType}`);
                return defaultApiResponse;
            }
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            methodLogger.error({
                event: 'gemini_public_method_unhandled_error',
                apiType,
                selectedModel: selectedModelName,
                crawlModel: initialCrawlModelType,
                err: errorDetails,
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