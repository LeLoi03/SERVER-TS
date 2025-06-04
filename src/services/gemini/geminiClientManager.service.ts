// src/services/gemini/geminiClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    GoogleGenAI,
    type CachedContent,
    type Content,
    Caches,  // Service cho các hoạt động cache
    Models,  // Service cho các hoạt động model
    CreateCachedContentParameters,
    GetCachedContentParameters
} from "@google/genai";
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

@singleton()
export class GeminiClientManagerService {
    private readonly baseLogger: Logger;
    private readonly genAIInstances: Map<string, GoogleGenAI> = new Map();
    private readonly geminiApiKeys: string[];

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger('conference', { service: 'GeminiClientManagerService' });
        this.geminiApiKeys = this.configService.additionalGeminiApiKeys;
        this.initializeAllClients();
    }

    private initializeAllClients(): void {
        const logger = this.baseLogger.child({ function: 'initializeAllClients' });

        if (this.geminiApiKeys.length === 0) {
            logger.fatal({ event: 'gemini_service_config_error', reason: 'GEMINI_API_KEYS missing' }, "Critical: No GEMINI_API_KEYs found. Gemini services will not be initialized.");
            return;
        }

        this.geminiApiKeys.forEach((apiKey, index) => {
            const keyId = `key_${index}`;
            logger.info({ keyId, event: 'gemini_client_init_start' }, `Attempting to initialize client for ${keyId}.`);
            try {
                const genAI = new GoogleGenAI({ apiKey });
                this.genAIInstances.set(keyId, genAI);
                logger.info({ keyId, event: 'gemini_client_genai_init_success' }, `GoogleGenAI client for ${keyId} initialized successfully.`);

                // Kiểm tra sự tồn tại của các sub-service
                if (genAI.caches) {
                     logger.info({ keyId, event: 'gemini_client_caches_service_available' }, `Caches service is available for ${keyId}.`);
                } else {
                    logger.warn({ keyId, event: 'gemini_client_caches_service_unavailable' }, `Caches service is NOT available for ${keyId}.`);
                }
                if (genAI.models) {
                    logger.info({ keyId, event: 'gemini_client_models_service_available' }, `Models service is available for ${keyId}.`);
                } else {
                   logger.warn({ keyId, event: 'gemini_client_models_service_unavailable' }, `Models service is NOT available for ${keyId}.`);
               }

            } catch (initError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(initError);
                logger.error({ keyId, err: { message: errorMessage, stack: errorStack }, event: 'gemini_client_init_failed' }, `Failed to initialize client for ${keyId}: "${errorMessage}".`);
                this.genAIInstances.delete(keyId); // Xóa instance bị lỗi
            }
        });

        if (this.genAIInstances.size === 0) {
            logger.fatal({ event: 'gemini_service_no_clients_initialized' }, "No Gemini API clients initialized.");
        } else {
            logger.info({ initializedClients: this.genAIInstances.size }, `Successfully initialized ${this.genAIInstances.size} Gemini API client(s).`);
        }
    }

    private getApiKeyIndexForApiType(apiType: string): string {
        let keyIndex: number;
        // Logic chọn key của bạn
        if (apiType === 'determine' || apiType === 'cfp') {
            keyIndex = 0;
        } else if (apiType === 'extract') {
            keyIndex = 1;
        } else {
            keyIndex = 0;
            this.baseLogger.warn({ apiType, event: 'gemini_key_selection_unhandled_api_type' }, `Unhandled API type "${apiType}". Defaulting to first key.`);
        }

        if (keyIndex >= this.geminiApiKeys.length) {
            const originalRequestedIndex = keyIndex;
            keyIndex = this.geminiApiKeys.length > 0 ? this.geminiApiKeys.length - 1 : -1;
            if (keyIndex === -1) {
                const errorMsg = "No Gemini API keys available.";
                this.baseLogger.fatal({ apiType, event: 'gemini_key_selection_no_keys_available' }, errorMsg);
                throw new Error(errorMsg);
            }
            this.baseLogger.warn({ apiType, originalRequestedIndex, selectedKeyIndexFallback: keyIndex, totalKeys: this.geminiApiKeys.length, event: 'gemini_key_selection_index_out_of_bounds' }, `Requested key index ${originalRequestedIndex} for "${apiType}" out of bounds. Falling back to key index ${keyIndex}.`);
        }
        return `key_${keyIndex}`;
    }

    /**
     * Cung cấp instance `GoogleGenAI` đã được khởi tạo cho một loại API cụ thể.
     * @param {string} apiType - Loại API call.
     * @returns {GoogleGenAI} Client GoogleGenAI.
     * @throws {Error} Nếu client chưa được khởi tạo.
     */
    public getGenAI(apiType: string): GoogleGenAI {
        const keyId = this.getApiKeyIndexForApiType(apiType);
        const genAI = this.genAIInstances.get(keyId);
        if (!genAI) {
            const errorMsg = `GoogleGenAI client for API type '${apiType}' (key ID: ${keyId}) is not initialized.`;
            this.baseLogger.error({ apiType, keyId, event: 'get_genai_client_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI;
    }

    /**
     * Cung cấp service `Models` từ instance `GoogleGenAI` cho một loại API cụ thể.
     * Service này được dùng cho các hoạt động như generateContent, countTokens, v.v.
     * @param {string} apiType - Loại API call.
     * @returns {Models} Service Models.
     * @throws {Error} Nếu client GoogleGenAI hoặc service Models của nó chưa được khởi tạo.
     */
    public getModelsService(apiType: string): Models {
        const genAI = this.getGenAI(apiType); // Đã bao gồm kiểm tra lỗi
        if (!genAI.models) {
            const errorMsg = `Models service for API type '${apiType}' (key ID: ${this.getApiKeyIndexForApiType(apiType)}) is not available on the GoogleGenAI instance.`;
            this.baseLogger.error({ apiType, keyId: this.getApiKeyIndexForApiType(apiType), event: 'get_models_service_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI.models;
    }

    /**
     * Cung cấp service `Caches` từ instance `GoogleGenAI` cho một loại API cụ thể.
     * @param {string} apiType - Loại API call.
     * @returns {Caches} Service Caches.
     * @throws {Error} Nếu client GoogleGenAI hoặc service Caches của nó chưa được khởi tạo.
     */
    public getCachesService(apiType: string): Caches {
        const genAI = this.getGenAI(apiType); // Đã bao gồm kiểm tra lỗi
        if (!genAI.caches) {
            const errorMsg = `Caches service for API type '${apiType}' (key ID: ${this.getApiKeyIndexForApiType(apiType)}) is not available on the GoogleGenAI instance.`;
            this.baseLogger.error({ apiType, keyId: this.getApiKeyIndexForApiType(apiType), event: 'get_caches_service_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI.caches;
    }

    // Các phương thức getGenerativeModel và getGenerativeModelFromCachedContent bị loại bỏ
    // vì mô hình tương tác đã thay đổi.
    // Thay vào đó, các service khác sẽ sử dụng getModelsService() và sau đó gọi
    // modelsService.generateContent({ model: 'model-name', ... })
    // System instructions và cached content được truyền như một phần của GenerateContentParameters.

    public async createSdkCache(
        params: {
            model: string; // Tên model mà cache này dành cho, ví dụ: 'gemini-1.5-flash'
            contents: Content[];
            displayName?: string;
            systemInstruction?: Content; // Content
            ttl?: string; // ví dụ: "3600s"
            expireTime?: string; // Định dạng RFC 3339
        },
        parentLogger: Logger, // Đổi tên _parentLogger thành parentLogger để sử dụng
        apiType: string
    ): Promise<CachedContent> {
        const cachesService = this.getCachesService(apiType);
        const createParams: CreateCachedContentParameters = {
            model: params.model,
            config: {
                contents: params.contents,
                ...(params.displayName && { displayName: params.displayName }),
                ...(params.systemInstruction && { systemInstruction: params.systemInstruction }),
                ...(params.ttl && { ttl: params.ttl }),
                ...(params.expireTime && { expireTime: params.expireTime }),
            }
        };
        parentLogger.info({ apiType, model: params.model, cacheDisplayName: params.displayName, event: 'create_sdk_cache_attempt' }, "Attempting to create SDK cache.");
        try {
            const cache = await cachesService.create(createParams);
            parentLogger.info({ apiType, cacheName: cache.name, event: 'create_sdk_cache_success' }, "SDK cache created successfully.");
            return cache;
        } catch (error) {
            const { message } = getErrorMessageAndStack(error);
            parentLogger.error({ apiType, model: params.model, err: { message }, event: 'create_sdk_cache_failed' }, `Failed to create SDK cache: ${message}`);
            throw error;
        }
    }

    public async getSdkCache(
        cacheName: string, // Tên đầy đủ của resource, ví dụ: "cachedContents/abc123xyz"
        parentLogger: Logger, // Đổi tên _parentLogger thành parentLogger để sử dụng
        apiType: string
    ): Promise<CachedContent> { // SDK sẽ throw lỗi nếu không tìm thấy
        const cachesService = this.getCachesService(apiType);
        const getParams: GetCachedContentParameters = { name: cacheName };
        parentLogger.info({ apiType, cacheName, event: 'get_sdk_cache_attempt' }, "Attempting to get SDK cache.");
        try {
            const cache = await cachesService.get(getParams);
            parentLogger.info({ apiType, cacheName, event: 'get_sdk_cache_success' }, "SDK cache retrieved successfully.");
            return cache;
        } catch (error) {
            const { message } = getErrorMessageAndStack(error);
            parentLogger.warn({ apiType, cacheName, err: { message }, event: 'get_sdk_cache_failed_or_not_found' }, `Failed to get SDK cache or cache not found: ${message}`);
            throw error; // Ném lại lỗi để phù hợp với hành vi của SDK
        }
    }
}