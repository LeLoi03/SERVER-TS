// src/services/gemini/geminiClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    GoogleGenerativeAI,
    type GenerativeModel,
    type CachedContent,
    type Content,
    // type Part, // Not directly used for model/cache creation here
    // type SDKGenerationConfig, // Not directly used for model/cache creation here
} from "@google/generative-ai";
import { ConfigService } from '../../config/config.service'; // Adjust path as needed
import { LoggingService } from '../logging.service'; // Adjust path as needed
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

        this.initializeGoogleGenerativeAI(); // Called in constructor
        // initializeCacheManager is called *after* genAI init, within its own method or here.
        // For consistency with original, let's call it if genAI init succeeds.
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

    // These methods are direct pass-throughs to the SDK, logging should be handled by the caller
    // which has more semantic context (e.g., GeminiModelOrchestratorService or GeminiContextCacheService)

    public getGenerativeModel(
        modelName: string,
        systemInstruction: Content | undefined, // Takes prepared Content object
        _parentLogger: Logger // Logger for potential internal use, but SDK calls are atomic here
    ): GenerativeModel {
        const genAI = this.getGenAI();
        // The logging for 'non_cached_setup_using_system_instruction' etc.
        // should happen in the ModelOrchestrator BEFORE this call.
        return genAI.getGenerativeModel({ model: modelName, systemInstruction });
    }

    public getGenerativeModelFromCachedContent(
        cachedContent: CachedContent,
        _parentLogger: Logger
    ): GenerativeModel {
        const genAI = this.getGenAI();
        return genAI.getGenerativeModelFromCachedContent(cachedContent);
    }

    public async createSdkCache(
        params: {
            model: string;
            contents: Content[];
            displayName: string;
            systemInstruction?: Content;
        },
        _parentLogger: Logger
    ): Promise<CachedContent> {
        const manager = this.getCacheManager();
        return manager.create(params);
    }

    public async getSdkCache(
        cacheName: string,
        _parentLogger: Logger
    ): Promise<CachedContent | undefined> {
        const manager = this.getCacheManager();
        return manager.get(cacheName); // SDK returns undefined if not found
    }
}