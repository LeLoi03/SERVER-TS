// src/services/gemini/geminiClientManager.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    GoogleGenerativeAI,
    type GenerativeModel,
    type CachedContent,
    type Content,
    type GenerationConfig as SDKGenerationConfig,
    type ChatSession,
} from "@google/generative-ai";
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { Logger } from 'pino';
import { GoogleAICacheManager } from '@google/generative-ai/server';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

/**
 * Manages the core Google Generative AI client and Cache Manager instances.
 * This service is responsible for initializing and providing access to the
 * `GoogleGenerativeAI` and `GoogleAICacheManager` SDK objects, ensuring they
 * are properly configured with the API key.
 * It acts as a centralized access point for Gemini SDK features, now supporting
 * multiple API keys with selection based on API type.
 */
@singleton()
export class GeminiClientManagerService {
    private readonly baseLogger: Logger;
    // Map to store GoogleGenerativeAI instances, keyed by API key index (e.g., 'key_0', 'key_1')
    private readonly genAIInstances: Map<string, GoogleGenerativeAI> = new Map();
    // Map to store GoogleAICacheManager instances, keyed by API key index
    private readonly cacheManagerInstances: Map<string, GoogleAICacheManager> = new Map();
    private readonly geminiApiKeys: string[]; // All available Gemini API keys

    /**
     * Constructs an instance of GeminiClientManagerService.
     * Initializes the Google Generative AI client and Cache Manager instances
     * for each configured API key on startup.
     * @param {ConfigService} configService - Injected configuration service.
     * @param {LoggingService} loggingService - Injected logging service.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger('main', { service: 'GeminiClientManagerService' });
        this.geminiApiKeys = this.configService.config.GEMINI_API_KEYS;

        // Initialize all GenAI and CacheManager instances for each available key
        this.initializeAllClients();
    }

    /**
     * Initializes GoogleGenerativeAI and GoogleAICacheManager clients for each
     * API key provided in the configuration.
     */
    private initializeAllClients(): void {
        const logger = this.baseLogger.child({ function: 'initializeAllClients' });

        if (this.geminiApiKeys.length === 0) {
            logger.fatal({ event: 'gemini_service_config_error', reason: 'GEMINI_API_KEYS missing' }, "Critical: No GEMINI_API_KEYs found in configuration. Gemini services will not be initialized.");
            return;
        }

        this.geminiApiKeys.forEach((apiKey, index) => {
            const keyId = `key_${index}`;
            logger.info({ keyId, event: 'gemini_client_init_start' }, `Attempting to initialize client for ${keyId}.`);
            try {
                // Initialize GoogleGenerativeAI
                const genAI = new GoogleGenerativeAI(apiKey);
                this.genAIInstances.set(keyId, genAI);
                logger.info({ keyId, event: 'gemini_client_genai_init_success' }, `GoogleGenerativeAI client for ${keyId} initialized successfully.`);

                // Initialize GoogleAICacheManager for this key
                const cacheManager = new GoogleAICacheManager(apiKey);
                this.cacheManagerInstances.set(keyId, cacheManager);
                logger.info({ keyId, event: 'gemini_client_cache_manager_init_success' }, `GoogleAICacheManager for ${keyId} initialized successfully.`);

            } catch (initError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(initError);
                logger.error({ keyId, err: { message: errorMessage, stack: errorStack }, event: 'gemini_client_init_failed' }, `Failed to initialize client for ${keyId}: "${errorMessage}". This key will not be available.`);
                this.genAIInstances.delete(keyId);
                this.cacheManagerInstances.delete(keyId);
            }
        });

        if (this.genAIInstances.size === 0) {
            logger.fatal({ event: 'gemini_service_no_clients_initialized' }, "No Gemini API clients were successfully initialized. All Gemini functionality will be unavailable.");
        } else {
            logger.info({ initializedClients: this.genAIInstances.size }, `Successfully initialized ${this.genAIInstances.size} Gemini API client(s).`);
        }
    }

    /**
     * Selects the appropriate API key index based on the API type.
     * @param {string} apiType - The type of API call (e.g., 'determine', 'cfp', 'extract').
     * @returns {string} The key ID (e.g., 'key_0', 'key_1') for the chosen API key.
     * @throws {Error} If no suitable API key is found or configured.
     */
    private getApiKeyIndexForApiType(apiType: string): string {
        // Logic: determine/cfp uses key 1 (index 0 if only one key, otherwise first key), extract uses key 2 (index 1)
        let keyIndex: number;

        if (apiType === 'determine' || apiType === 'cfp') {
            keyIndex = 0; // Uses the first key (index 0)
        } else if (apiType === 'extract') {
            keyIndex = 1; // Uses the second key (index 1)
        } else {
            // Default or fallback to the first key if apiType is not explicitly handled
            keyIndex = 0;
            this.baseLogger.warn({ apiType, event: 'gemini_key_selection_unhandled_api_type' }, `Unhandled API type "${apiType}". Defaulting to first Gemini API key.`);
        }

        // Ensure the selected key index is within the bounds of available keys
        if (keyIndex >= this.geminiApiKeys.length) {
            // Fallback to the last available key if the requested index is out of bounds
            keyIndex = this.geminiApiKeys.length > 0 ? this.geminiApiKeys.length - 1 : -1;
            if (keyIndex === -1) {
                const errorMsg = "No Gemini API keys are available at all to select from.";
                this.baseLogger.fatal({ apiType, event: 'gemini_key_selection_no_keys_available' }, errorMsg);
                throw new Error(errorMsg);
            }
            this.baseLogger.warn({ apiType, selectedKeyIndex: keyIndex, totalKeys: this.geminiApiKeys.length, event: 'gemini_key_selection_index_out_of_bounds' }, `Requested Gemini API key index ${keyIndex + 1} (for API type "${apiType}") is out of bounds. Falling back to key ${keyIndex + 1} (index ${keyIndex}).`);
        }
        return `key_${keyIndex}`;
    }

    /**
     * Provides the initialized `GoogleGenerativeAI` client instance for a specific API type.
     * @param {string} apiType - The type of API call (e.g., 'determine', 'cfp', 'extract') to select the appropriate client.
     * @returns {GoogleGenerativeAI} The initialized Google Generative AI client.
     * @throws {Error} If the client for the specified API type has not been successfully initialized.
     */
    public getGenAI(apiType: string): GoogleGenerativeAI {
        const keyId = this.getApiKeyIndexForApiType(apiType);
        const genAI = this.genAIInstances.get(keyId);
        if (!genAI) {
            const errorMsg = `GoogleGenerativeAI client for API type '${apiType}' (key ID: ${keyId}) is not initialized.`;
            this.baseLogger.error({ apiType, keyId, event: 'get_genai_client_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return genAI;
    }

    /**
     * Provides the initialized `GoogleAICacheManager` instance for a specific API type.
     * @param {string} apiType - The type of API call to select the appropriate cache manager.
     * @returns {GoogleAICacheManager} The initialized Google AI Cache Manager.
     * @throws {Error} If the cache manager for the specified API type has not been successfully initialized.
     */
    public getCacheManager(apiType: string): GoogleAICacheManager {
        const keyId = this.getApiKeyIndexForApiType(apiType);
        const cacheManager = this.cacheManagerInstances.get(keyId);
        if (!cacheManager) {
            const errorMsg = `GoogleAICacheManager for API type '${apiType}' (key ID: ${keyId}) is not initialized.`;
            this.baseLogger.error({ apiType, keyId, event: 'get_cache_manager_failed' }, errorMsg);
            throw new Error(errorMsg);
        }
        return cacheManager;
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
     * @param {string} apiType - The type of API call (e.g., 'determine', 'cfp', 'extract') to select the appropriate client.
     * @returns {GenerativeModel} An instance of `GenerativeModel`.
     * @throws {Error} If `GoogleGenerativeAI` client is not initialized for the given apiType.
     */
    public getGenerativeModel(
        modelName: string,
        systemInstruction: Content | undefined,
        _parentLogger: Logger, // Logger might be useful for future enhancements in this method
        generationConfig: SDKGenerationConfig | undefined, // Now optional as per SDK usage
        apiType: string // Pass apiType to select the correct client
    ): GenerativeModel {
        const genAI = this.getGenAI(apiType); // Get specific GenAI instance
        return genAI.getGenerativeModel({
            model: modelName,
            systemInstruction,
            generationConfig
        });
    }

    /**
     * Retrieves a `GenerativeModel` instance from a previously cached content object.
     * This is used when making requests that should leverage a pre-created cache.
     *
     * @param {CachedContent} cachedContent - The `CachedContent` object obtained from the SDK.
     * @param {Logger} _parentLogger - (Unused directly in this method, but kept for consistency if needed in future.)
     * @param {string} apiType - The type of API call to select the appropriate client.
     * @returns {GenerativeModel} An instance of `GenerativeModel` linked to the cached content.
     * @throws {Error} If `GoogleGenerativeAI` client is not initialized for the given apiType.
     */
    public getGenerativeModelFromCachedContent(
        cachedContent: CachedContent,
        _parentLogger: Logger,
        apiType: string // Pass apiType to select the correct client
    ): GenerativeModel {
        const genAI = this.getGenAI(apiType); // Get specific GenAI instance
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
     * @param {string} apiType - The type of API call to select the appropriate cache manager.
     * @returns {Promise<CachedContent>} A Promise that resolves with the created `CachedContent` object.
     * @throws {Error} If `GoogleAICacheManager` is not initialized for the given apiType or cache creation fails.
     */
    public async createSdkCache(
        params: {
            model: string;
            contents: Content[];
            displayName: string;
            systemInstruction?: Content;
            generationConfig?: SDKGenerationConfig;
        },
        _parentLogger: Logger,
        apiType: string // Pass apiType to select the correct cache manager
    ): Promise<CachedContent> {
        const manager = this.getCacheManager(apiType); // Get specific CacheManager instance
        return manager.create(params);
    }

    /**
     * Retrieves an existing cached content entry from the Google AI backend by its cache name.
     * @param {string} cacheName - The full name of the cached content (e.g., 'cachedContents/your-cache-id').
     * @param {Logger} _parentLogger - (Unused directly in this method, but kept for consistency if needed in future.)
     * @param {string} apiType - The type of API call to select the appropriate cache manager.
     * @returns {Promise<CachedContent | undefined>} A Promise that resolves with the `CachedContent` object,
     *                                               or `undefined` if the cache is not found.
     * @throws {Error} If `GoogleAICacheManager` is not initialized for the given apiType.
     */
    public async getSdkCache(
        cacheName: string,
        _parentLogger: Logger,
        apiType: string // Pass apiType to select the correct cache manager
    ): Promise<CachedContent | undefined> {
        const manager = this.getCacheManager(apiType); // Get specific CacheManager instance
        return manager.get(cacheName);
    }
}