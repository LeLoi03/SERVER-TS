// src/services/gemini/geminiClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    GoogleGenerativeAI,
    type GenerativeModel,
    type CachedContent,
    type Content,
    type GenerationConfig as SDKGenerationConfig, // << IMPORT SDKGenerationConfig
} from "@google/generative-ai";
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { Logger } from 'pino';
import { GoogleAICacheManager } from '@google/generative-ai/server';

@singleton()
export class GeminiClientManagerService {
    private readonly baseLogger: Logger;
    private _genAI: GoogleGenerativeAI | null = null;
    private _cacheManager: GoogleAICacheManager | null = null;
    private readonly geminiApiKey: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger({ service: 'GeminiClientManagerService' });
        this.geminiApiKey = this.configService.config.GEMINI_API_KEY;

        this.initializeGoogleGenerativeAI();
        if (this._genAI) {
            this.initializeCacheManager();
        }
    }


    private initializeGoogleGenerativeAI(): void {
        const logger = this.baseLogger.child({ function: 'initializeGoogleGenerativeAI' }); // Context from original
        try {
            if (!this.geminiApiKey) {
                // Log event from original GeminiApiService constructor
                logger.fatal({ event: 'gemini_service_config_error', reason: 'GEMINI_API_KEY missing' }, "GEMINI_API_KEY is missing in configuration. GoogleGenerativeAI will not be initialized.");
                throw new Error("GEMINI_API_KEY is missing in configuration.");
            }
            this._genAI = new GoogleGenerativeAI(this.geminiApiKey);
            // Log event from original GeminiApiService constructor
            logger.info({ event: 'gemini_service_genai_init_success' }, "GoogleGenerativeAI initialized successfully.");
        } catch (initError: unknown) {
            const errorDetails = initError instanceof Error ? { name: initError.name, message: initError.message, stack: initError.stack } : { details: String(initError) };
            // Log event from original GeminiApiService constructor
            logger.fatal({ err: errorDetails, event: 'gemini_service_genai_init_failed' }, "Failed to initialize GoogleGenerativeAI.");
            this._genAI = null; // Ensure it's null on failure
        }
    }

    private initializeCacheManager(): void {
        // This method matches the original initializeCacheManager in GeminiApiService
        const logger = this.baseLogger.child({ function: 'initializeCacheManager' }); // Context from original
        if (!this._genAI) { // Check from original
            logger.warn(/* No specific event in original for this spot */ "GoogleGenerativeAI not initialized, skipping CacheManager initialization.");
            return;
        }
        if (this._cacheManager) { // Check from original
            logger.debug(/* No specific event in original */ "CacheManager already initialized.");
            return;
        }
        // Log event from original GeminiApiService.initializeCacheManager
        logger.info({ event: 'cache_manager_init_start' }, "Initializing GoogleAICacheManager...");
        try {
            if (!this.geminiApiKey) { // Check from original
                throw new Error("Cannot initialize CacheManager without GEMINI_API_KEY");
            }
            this._cacheManager = new GoogleAICacheManager(this.geminiApiKey);
            // Log event from original GeminiApiService.initializeCacheManager
            logger.info({ event: 'cache_manager_init_success' }, "Initialized GoogleAICacheManager directly.");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            // Log event from original GeminiApiService.initializeCacheManager
            logger.error({ err: errorDetails, event: 'cache_manager_create_failed' }, "Failed to initialize GoogleAICacheManager");
            this._cacheManager = null;
        }
    }

    public getGenAI(): GoogleGenerativeAI {
        if (!this._genAI) {
            // This state should be checked by the main service's ensureInitialized logic
            // which would log 'gemini_service_genai_not_ready'
            throw new Error("GoogleGenerativeAI is not initialized in ClientManager.");
        }
        return this._genAI;
    }

    public getCacheManager(): GoogleAICacheManager {
        if (!this._cacheManager) {
            // This state implies an issue during its initialization
            // The original 'cache_context_setup_failed_no_manager' would be logged by the consuming service
            throw new Error("GoogleAICacheManager is not initialized in ClientManager.");
        }
        return this._cacheManager;
    }

    public getGenerativeModel(
        modelName: string,
        systemInstruction: Content | undefined,
        _parentLogger: Logger, // Logger hiện không dùng trực tiếp ở đây, nhưng có thể giữ lại
        generationConfig?: SDKGenerationConfig // << THÊM THAM SỐ MỚI
    ): GenerativeModel {
        const genAI = this.getGenAI();
        // SDK cho phép truyền generationConfig khi lấy model.
        // Điều này sẽ set cấu hình mặc định cho model đó.
        return genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
            generationConfig // << TRUYỀN VÀO ĐÂY
        });
    }


    public getGenerativeModelFromCachedContent(
        cachedContent: CachedContent,
        _parentLogger: Logger
    ): GenerativeModel {
        const genAI = this.getGenAI();
        // Khi lấy model từ cache, generationConfig của cache sẽ được ưu tiên.
        // Tuy nhiên, bạn vẫn có thể ghi đè generationConfig khi gọi model.generateContent().
        // ModelOrchestrator đang làm điều này khi contentRequest là object.
        return genAI.getGenerativeModelFromCachedContent(cachedContent);
    }


    public async createSdkCache(
        params: {
            model: string;
            contents: Content[];
            displayName: string;
            systemInstruction?: Content;
            // generationConfig cũng có thể được truyền vào SDK khi tạo cache nếu SDK hỗ trợ
            // để cache biết config mặc định của nó
        },
        _parentLogger: Logger
    ): Promise<CachedContent> {
        const manager = this.getCacheManager();
        // Kiểm tra tài liệu SDK xem `manager.create` có chấp nhận `generationConfig` không.
        // Nếu có, bạn nên truyền nó từ `GeminiContextCacheService` vào đây.
        return manager.create(params);
    }

    public async getSdkCache(
        cacheName: string,
        _parentLogger: Logger
    ): Promise<CachedContent | undefined> {
        const manager = this.getCacheManager();
        return manager.get(cacheName);
    }
}