// src/services/gemini/geminiClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    GoogleGenerativeAI,
    type GenerativeModel,
    type CachedContent,
    type Content,
    type GenerationConfig as SDKGenerationConfig, // Import SDKGenerationConfig for type safety
    type ChatSession, // Added for potential future use or completeness
} from "@google/generative-ai";
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { Logger } from 'pino';
import { GoogleAICacheManager } from '@google/generative-ai/server';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Manages the core Google Generative AI client and Cache Manager instances.
 * This service is responsible for initializing and providing access to the
 * `GoogleGenerativeAI` and `GoogleAICacheManager` SDK objects, ensuring they
 * are properly configured with the API key.
 * It acts as a centralized access point for Gemini SDK features.
 */
@singleton()
export class GeminiClientManagerService {
    private readonly baseLogger: Logger;
    private _genAI: GoogleGenerativeAI | null = null; // Google Generative AI client instance
    private _cacheManager: GoogleAICacheManager | null = null; // Google AI Cache Manager instance
    private readonly geminiApiKey: string; // API key for Gemini

    /**
     * Constructs an instance of GeminiClientManagerService.
     * Initializes the Google Generative AI client and Cache Manager on startup.
     * @param {ConfigService} configService - Injected configuration service.
     * @param {LoggingService} loggingService - Injected logging service.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger({ service: 'GeminiClientManagerService' });
        this.geminiApiKey = this.configService.config.GEMINI_API_KEY;

        // Attempt to initialize GenAI and CacheManager immediately
        this.initializeGoogleGenerativeAI();
        if (this._genAI) { // Only attempt to initialize CacheManager if GenAI succeeded
            this.initializeCacheManager();
        }
    }

    /**
     * Initializes the `GoogleGenerativeAI` client using the configured API key.
     * Logs success or fatal error if the API key is missing or initialization fails.
     */
    private initializeGoogleGenerativeAI(): void {
        const logger = this.baseLogger.child({ function: 'initializeGoogleGenerativeAI' });
        try {
            if (!this.geminiApiKey) {
                // Log event consistent with original GeminiApiService constructor
                logger.fatal({ event: 'gemini_service_config_error', reason: 'GEMINI_API_KEY missing' }, "Critical: GEMINI_API_KEY is missing in configuration. GoogleGenerativeAI will not be initialized.");
                throw new Error("GEMINI_API_KEY is missing in configuration.");
            }
            this._genAI = new GoogleGenerativeAI(this.geminiApiKey);
            // Log event consistent with original GeminiApiService constructor
            logger.info({ event: 'gemini_service_genai_init_success' }, "GoogleGenerativeAI client initialized successfully.");
        } catch (initError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(initError);
            // Log event consistent with original GeminiApiService constructor
            logger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'gemini_service_genai_init_failed' }, `Failed to initialize GoogleGenerativeAI: "${errorMessage}".`);
            this._genAI = null; // Ensure it's null on failure to prevent partial state
        }
    }

    /**
     * Initializes the `GoogleAICacheManager` client.
     * Requires `GoogleGenerativeAI` to be already initialized.
     * Logs success or error during initialization.
     */
    private initializeCacheManager(): void {
        const logger = this.baseLogger.child({ function: 'initializeCacheManager' });
        if (!this._genAI) {
            logger.warn({ event: 'cache_manager_init_skipped_no_genai' }, "GoogleGenerativeAI client not initialized. Skipping CacheManager initialization.");
            return;
        }
        if (this._cacheManager) {
            logger.debug({ event: 'cache_manager_already_initialized' }, "CacheManager already initialized. Skipping.");
            return;
        }

        logger.info({ event: 'cache_manager_init_start' }, "Initializing GoogleAICacheManager...");
        try {
            if (!this.geminiApiKey) {
                // Defensive check, should be caught by initializeGoogleGenerativeAI already
                throw new Error("Cannot initialize CacheManager without GEMINI_API_KEY.");
            }
            this._cacheManager = new GoogleAICacheManager(this.geminiApiKey);
            logger.info({ event: 'cache_manager_init_success' }, "GoogleAICacheManager initialized successfully.");
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'cache_manager_create_failed' }, `Failed to initialize GoogleAICacheManager: "${errorMessage}".`);
            this._cacheManager = null; // Ensure it's null on failure
        }
    }

    /**
     * Provides the initialized `GoogleGenerativeAI` client instance.
     * @returns {GoogleGenerativeAI} The initialized Google Generative AI client.
     * @throws {Error} If the client has not been successfully initialized.
     */
    public getGenAI(): GoogleGenerativeAI {
        if (!this._genAI) {
            // This error indicates a critical setup failure. The calling service should handle.
            throw new Error("GoogleGenerativeAI client is not initialized in ClientManager.");
        }
        return this._genAI;
    }

    /**
     * Provides the initialized `GoogleAICacheManager` instance.
     * @returns {GoogleAICacheManager} The initialized Google AI Cache Manager.
     * @throws {Error} If the cache manager has not been successfully initialized.
     */
    public getCacheManager(): GoogleAICacheManager {
        if (!this._cacheManager) {
            // This error indicates a critical setup failure related to caching.
            throw new Error("GoogleAICacheManager is not initialized in ClientManager.");
        }
        return this._cacheManager;
    }

    /**
     * Retrieves a `GenerativeModel` instance for a specific model name and system instruction.
     * This model can be used for generating content (e.g., text, chat completions).
     * `generationConfig` can be passed to set default parameters for this model.
     *
     * @param {string} modelName - The name of the Gemini model (e.g., 'gemini-pro').
     * @param {Content | undefined} systemInstruction - The system instruction content for the model.
     * @param {Logger} _parentLogger - (Unused directly in this method, but kept for consistency if needed in future.)
     * @param {SDKGenerationConfig} [generationConfig] - Optional generation configuration for the model.
     * @returns {GenerativeModel} An instance of `GenerativeModel`.
     * @throws {Error} If `GoogleGenerativeAI` client is not initialized.
     */
    public getGenerativeModel(
        modelName: string,
        systemInstruction: Content | undefined,
        _parentLogger: Logger, // Logger might be useful for future enhancements in this method
        generationConfig?: SDKGenerationConfig // New parameter to pass generationConfig
    ): GenerativeModel {
        const genAI = this.getGenAI();
        // `getGenerativeModel` now correctly accepts `generationConfig` as an option.
        return genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
            generationConfig // Pass generationConfig here
        });
    }

    /**
     * Retrieves a `GenerativeModel` instance from a previously cached content object.
     * This is used when making requests that should leverage a pre-created cache.
     *
     * @param {CachedContent} cachedContent - The `CachedContent` object obtained from the SDK.
     * @param {Logger} _parentLogger - (Unused directly in this method, but kept for consistency if needed in future.)
     * @returns {GenerativeModel} An instance of `GenerativeModel` linked to the cached content.
     * @throws {Error} If `GoogleGenerativeAI` client is not initialized.
     */
    public getGenerativeModelFromCachedContent(
        cachedContent: CachedContent,
        _parentLogger: Logger
    ): GenerativeModel {
        const genAI = this.getGenAI();
        // When getting a model from cached content, the generationConfig of the cache is implicitly used.
        // You can still override parameters in `model.generateContent()` calls later.
        return genAI.getGenerativeModelFromCachedContent(cachedContent);
    }

    /**
     * Creates a new cached content entry on the Google AI backend.
     * This cache can then be used to initialize models for subsequent requests,
     * potentially saving on token costs for common instructions/few-shot examples.
     *
     * @param {object} params - Parameters for creating the cache.
     * @param {string} params.model - The model name (e.g., 'models/gemini-pro').
     * @param {Content[]} params.contents - The content (e.g., few-shot examples) to cache.
     * @param {string} params.displayName - A human-readable name for the cache.
     * @param {Content} [params.systemInstruction] - Optional system instruction for the cached content.
     * @param {SDKGenerationConfig} [params.generationConfig] - Optional generation configuration for the cached content.
     * @param {Logger} _parentLogger - (Unused directly in this method, but kept for consistency if needed in future.)
     * @returns {Promise<CachedContent>} A Promise that resolves with the created `CachedContent` object.
     * @throws {Error} If `GoogleAICacheManager` is not initialized or cache creation fails.
     */
    public async createSdkCache(
        params: {
            model: string;
            contents: Content[];
            displayName: string;
            systemInstruction?: Content;
            generationConfig?: SDKGenerationConfig; // Added for cache creation
        },
        _parentLogger: Logger
    ): Promise<CachedContent> {
        const manager = this.getCacheManager();
        // `manager.create` accepts systemInstruction and generationConfig in its parameters.
        return manager.create(params);
    }

    /**
     * Retrieves an existing cached content entry from the Google AI backend by its cache name.
     * @param {string} cacheName - The full name of the cached content (e.g., 'cachedContents/your-cache-id').
     * @param {Logger} _parentLogger - (Unused directly in this method, but kept for consistency if needed in future.)
     * @returns {Promise<CachedContent | undefined>} A Promise that resolves with the `CachedContent` object,
     *                                               or `undefined` if the cache is not found.
     * @throws {Error} If `GoogleAICacheManager` is not initialized.
     */
    public async getSdkCache(
        cacheName: string,
        _parentLogger: Logger
    ): Promise<CachedContent | undefined> {
        const manager = this.getCacheManager();
        return manager.get(cacheName);
    }
}