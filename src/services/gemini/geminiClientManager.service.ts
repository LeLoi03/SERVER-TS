// src/services/gemini/geminiClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    GoogleGenAI,
    type CachedContent,
    type Content,
    Caches,
    Models,
    CreateCachedContentParameters,
    GetCachedContentParameters
} from "@google/genai";
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

// Định nghĩa cấu trúc của các Pool
interface KeyPool {
    keyIndices: number[];
}

@singleton()
export class GeminiClientManagerService {
    private readonly baseLogger: Logger;
    private readonly genAIInstances: Map<string, GoogleGenAI> = new Map();
    private readonly geminiApiKeys: string[];

      // --- START: CẬP NHẬT CHIẾN LƯỢC VÒNG 2 ---

    // 1. Định nghĩa lại các pool
    private readonly keyPools: Record<string, KeyPool> = {
        interactive: { keyIndices: [0, 1, 2, 3, 4] },      
        extraction:  { keyIndices: [5, 6, 7, 8, 9, 10] }, 
        // default:     { keyIndices: [3] },      // Giữ nguyên key dự phòng
    };

    // 2. Map từ apiType sang tên pool (không đổi nhưng để đây cho rõ)
    private readonly apiTypeToPoolMap: Record<string, string> = {
        determine: 'interactive',
        cfp:       'interactive',
        extract:   'extraction',
    };

    // --- END: CẬP NHẬT CHIẾN LƯỢC VÒNG 2 ---


    // 3. Bộ đếm cho từng pool để thực hiện Round-Robin
    private readonly poolCounters: Map<string, number> = new Map();

    // --- END: THAY ĐỔI CHO CHIẾN LƯỢC MỚI ---

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger('conference', { service: 'GeminiClientManagerService' });
        this.geminiApiKeys = this.configService.additionalGeminiApiKeys;

        // Khởi tạo bộ đếm cho mỗi pool
        Object.keys(this.keyPools).forEach(poolName => {
            this.poolCounters.set(poolName, 0);
        });

        this.initializeAllClients();
    }

    private initializeAllClients(): void {
        const logger = this.baseLogger.child({ function: 'initializeAllClients' });

        if (this.geminiApiKeys.length === 0) {
            logger.fatal({ event: 'gemini_service_config_error', reason: 'GEMINI_API_KEYS missing' }, "Critical: No GEMINI_API_KEYs found. Gemini services will not be initialized.");
            return;
        }
        
        // Cảnh báo nếu số lượng key không khớp với cấu hình pool
        const maxIndexInPools = Math.max(...Object.values(this.keyPools).flatMap(p => p.keyIndices));
        if (this.geminiApiKeys.length <= maxIndexInPools) {
            logger.warn(
                { 
                    configuredKeys: this.geminiApiKeys.length, 
                    requiredKeysByPools: maxIndexInPools + 1,
                    event: 'gemini_key_pool_config_mismatch' 
                }, 
                "Warning: The number of available API keys is less than or equal to the highest index defined in keyPools. Some keys might not be available."
            );
        }


        this.geminiApiKeys.forEach((apiKey, index) => {
            const keyId = `key_${index}`;
            logger.info({ keyId, event: 'gemini_client_init_start' }, `Attempting to initialize client for ${keyId}.`);
            try {
                const genAI = new GoogleGenAI({ apiKey });
                this.genAIInstances.set(keyId, genAI);
                logger.info({ keyId, event: 'gemini_client_genai_init_success' }, `GoogleGenAI client for ${keyId} initialized successfully.`);

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
                this.genAIInstances.delete(keyId);
            }
        });

        if (this.genAIInstances.size === 0) {
            logger.fatal({ event: 'gemini_service_no_clients_initialized' }, "No Gemini API clients initialized.");
        } else {
            logger.info({ initializedClients: this.genAIInstances.size }, `Successfully initialized ${this.genAIInstances.size} Gemini API client(s).`);
        }
    }

    // --- START: HÀM LOGIC CHÍNH ĐƯỢC CẬP NHẬT ---
    private getApiKeyIdForApiType(apiType: string): string {
        // 1. Xác định pool dựa trên apiType, nếu không có thì dùng pool 'default'
        const poolName = this.apiTypeToPoolMap[apiType] || 'default';
        const pool = this.keyPools[poolName];

        if (!pool || pool.keyIndices.length === 0) {
            this.baseLogger.error({ apiType, poolName, event: 'gemini_key_selection_invalid_pool' }, `Invalid or empty pool configured for '${poolName}'.`);
            throw new Error(`Invalid key pool configuration for '${poolName}'.`);
        }

        // 2. Lấy bộ đếm hiện tại của pool
        let counter = this.poolCounters.get(poolName) ?? 0;

        // 3. Logic Round-Robin: Chọn key tiếp theo trong pool
        const keyIndexInPool = counter % pool.keyIndices.length;
        const selectedKeyIndex = pool.keyIndices[keyIndexInPool];

        // 4. Tăng bộ đếm cho lần gọi tiếp theo
        this.poolCounters.set(poolName, counter + 1);

        // 5. Kiểm tra xem key được chọn có thực sự tồn tại không
        if (selectedKeyIndex >= this.geminiApiKeys.length) {
            const originalIndex = selectedKeyIndex;
            // Fallback: Nếu key được chọn không tồn tại, thử dùng key cuối cùng có sẵn
            const fallbackIndex = this.geminiApiKeys.length > 0 ? this.geminiApiKeys.length - 1 : -1;
            
            if (fallbackIndex === -1) {
                const errorMsg = "No Gemini API keys available.";
                this.baseLogger.fatal({ apiType, event: 'gemini_key_selection_no_keys_available' }, errorMsg);
                throw new Error(errorMsg);
            }

            this.baseLogger.warn({
                apiType,
                poolName,
                originalRequestedIndex: originalIndex,
                selectedKeyIndexFallback: fallbackIndex,
                event: 'gemini_key_selection_index_out_of_bounds'
            }, `Requested key index ${originalIndex} from pool '${poolName}' is out of bounds. Falling back to the last available key index ${fallbackIndex}.`);
            
            return `key_${fallbackIndex}`;
        }
        
        const keyId = `key_${selectedKeyIndex}`;
        this.baseLogger.debug({ apiType, poolName, keyId, event: 'gemini_key_selected' }, `Selected ${keyId} from pool '${poolName}' for API type '${apiType}'.`);

        return keyId;
    }
    // --- END: HÀM LOGIC CHÍNH ĐƯỢC CẬP NHẬT ---

    public getGenAI(apiType: string): GoogleGenAI {
        // Sử dụng hàm logic mới
        const keyId = this.getApiKeyIdForApiType(apiType);
        const genAI = this.genAIInstances.get(keyId);
        if (!genAI) {
            const errorMsg = `GoogleGenAI client for API type '${apiType}' (key ID: ${keyId}) is not initialized.`;
            this.baseLogger.error({ apiType, keyId, event: 'get_genai_client_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI;
    }

    public getModelsService(apiType: string): Models {
        const genAI = this.getGenAI(apiType);
        const keyId = this.getApiKeyIdForApiType(apiType); // Lấy lại keyId để log cho chính xác
        if (!genAI.models) {
            const errorMsg = `Models service for API type '${apiType}' (key ID: ${keyId}) is not available.`;
            this.baseLogger.error({ apiType, keyId, event: 'get_models_service_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI.models;
    }

    public getCachesService(apiType: string): Caches {
        const genAI = this.getGenAI(apiType);
        const keyId = this.getApiKeyIdForApiType(apiType); // Lấy lại keyId để log cho chính xác
        if (!genAI.caches) {
            const errorMsg = `Caches service for API type '${apiType}' (key ID: ${keyId}) is not available.`;
            this.baseLogger.error({ apiType, keyId, event: 'get_caches_service_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI.caches;
    }

    // ... các phương thức còn lại không thay đổi ...
    public async createSdkCache(
        params: {
            model: string;
            contents: Content[];
            displayName?: string;
            systemInstruction?: Content;
            ttl?: string;
            expireTime?: string;
        },
        parentLogger: Logger,
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
        cacheName: string,
        parentLogger: Logger,
        apiType: string
    ): Promise<CachedContent> {
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
            throw error;
        }
    }
}