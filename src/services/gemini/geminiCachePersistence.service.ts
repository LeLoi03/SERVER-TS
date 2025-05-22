// src/services/gemini/geminiCachePersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import { ConfigService } from '../../config/config.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Manages the persistence of Gemini cache names (mapping arbitrary cache keys to actual SDK cache names).
 * This service stores a simple key-value map in a JSON file to survive application restarts,
 * ensuring that pre-existing Gemini model caches can be retrieved.
 */
@singleton()
export class GeminiCachePersistenceService {
    private readonly cacheMapFilePath: string; // Full path to the cache map JSON file
    private readonly cacheMapDir: string;      // Directory where the cache map file resides
    // This map holds the in-memory representation of the persistent cache names.
    private persistentCacheNameMapInternal: Map<string, string> = new Map();

    /**
     * Constructs an instance of GeminiCachePersistenceService.
     * @param {ConfigService} configService - The injected configuration service.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
    ) {
        // Construct the directory and file path for the cache map
        this.cacheMapDir = path.join(this.configService.baseOutputDir, 'gemini_cache');
        const cacheMapFilename = 'gemini_cache_map.json';
        this.cacheMapFilePath = path.join(this.cacheMapDir, cacheMapFilename);
    }

    /**
     * Loads the persistent cache name map from the file system into memory.
     * If the file does not exist or is empty, an empty map is initialized.
     * @param {Logger} logger - The logger instance for logging operations.
     * @returns {Promise<void>} A Promise that resolves when the map has been loaded.
     * @throws {Error} If there's an error reading or parsing the file.
     */
    public async loadMap(logger: Logger): Promise<void> {
        // Keep original function name for log context
        const logContext = { filePath: this.cacheMapFilePath, function: 'loadCacheNameMap' };
        logger.info({ ...logContext, event: 'cache_map_load_attempt' }, "Attempting to load Gemini cache name map from file.");
        try {
            if (!existsSync(this.cacheMapFilePath)) {
                logger.warn({ ...logContext, event: 'cache_map_file_not_found' }, "Cache map file not found. Initializing with an empty map.");
                this.persistentCacheNameMapInternal = new Map(); // Initialize as empty
                logger.info({ ...logContext, event: 'cache_map_load_success', status: 'empty_map_created' }, "Cache map loaded (file did not exist, new empty map used).");
                return;
            }
            const fileContent = await fsPromises.readFile(this.cacheMapFilePath, 'utf8');
            if (!fileContent.trim()) { // Check if file content is empty or just whitespace
                logger.warn({ ...logContext, event: 'cache_map_file_empty' }, "Cache map file is empty. Initializing with an empty map.");
                this.persistentCacheNameMapInternal = new Map(); // Initialize as empty
                logger.info({ ...logContext, event: 'cache_map_load_success', status: 'empty_map_from_empty_file' }, "Cache map loaded (file was empty, new empty map used).");
                return;
            }
            // Parse JSON content and convert to Map
            const data: Record<string, string> = JSON.parse(fileContent);
            this.persistentCacheNameMapInternal = new Map<string, string>(Object.entries(data));
            logger.info({ ...logContext, loadedCount: this.persistentCacheNameMapInternal.size, event: 'cache_map_load_success', status: 'loaded_from_file' }, `Successfully loaded ${this.persistentCacheNameMapInternal.size} cache name entries from file.`);
        } catch (error: unknown) { // Catch as unknown for type safety
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ ...logContext, err: { message: errorMessage, stack: errorStack }, event: 'cache_map_load_failed' }, `Failed to load or parse cache name map. Starting with an empty map. Error: "${errorMessage}".`);
            this.persistentCacheNameMapInternal = new Map(); // Ensure map is reset on error to avoid corrupted state
            throw error; // Re-throw the error as this is a critical loading failure
        }
    }

    /**
     * Saves the current in-memory cache name map to the file system.
     * It ensures the cache directory exists before writing.
     * @param {Logger} logger - The logger instance for logging operations.
     * @returns {Promise<void>} A Promise that resolves when the map has been saved.
     */
    public async saveMap(logger: Logger): Promise<void> {
        // Keep original function name for log context
        const logContext = { filePath: this.cacheMapFilePath, function: 'saveCacheNameMap' };
        logger.debug({ ...logContext, event: 'cache_map_write_attempt' }, "Attempting to save Gemini cache name map to file.");
        try {
            if (!existsSync(this.cacheMapDir)) {
                logger.info({ ...logContext, directory: this.cacheMapDir, event: 'cache_map_dir_create_attempt' }, "Cache map directory does not exist. Creating it before saving.");
                await fsPromises.mkdir(this.cacheMapDir, { recursive: true });
                logger.info({ ...logContext, directory: this.cacheMapDir, event: 'cache_map_dir_create_success' }, "Cache map directory created successfully.");
            }
            // Convert Map to a plain object for JSON serialization
            const dataToSave: Record<string, string> = Object.fromEntries(this.persistentCacheNameMapInternal);
            const jsonString = JSON.stringify(dataToSave, null, 2); // Pretty print with 2 spaces
            await fsPromises.writeFile(this.cacheMapFilePath, jsonString, 'utf8');
            logger.info({ ...logContext, savedCount: this.persistentCacheNameMapInternal.size, event: 'cache_map_write_success' }, `Successfully saved ${this.persistentCacheNameMapInternal.size} cache name entries to file.`);
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ ...logContext, err: { message: errorMessage, stack: errorStack }, event: 'cache_map_write_failed' }, `Failed to save cache name map: "${errorMessage}".`);
            // Original code did not throw here, so we follow that pattern for consistency.
        }
    }

    /**
     * Retrieves a Gemini cache name (e.g., `cachedContents/foo`) associated with a given internal cache key.
     * @param {string} cacheKey - The internal key used to store the cache name.
     * @returns {string | undefined} The Gemini SDK cache name, or undefined if not found.
     */
    public getPersistentCacheName(cacheKey: string): string | undefined {
        return this.persistentCacheNameMapInternal.get(cacheKey);
    }

    /**
     * Stores a Gemini cache name (e.g., `cachedContents/foo`) associated with an internal cache key.
     * @param {string} cacheKey - The internal key to store the cache name under.
     * @param {string} cacheName - The actual cache name returned by the Gemini SDK.
     * @returns {void}
     */
    public setPersistentCacheName(cacheKey: string, cacheName: string): void {
        this.persistentCacheNameMapInternal.set(cacheKey, cacheName);
    }

    /**
     * Checks if a Gemini cache name exists for a given internal cache key.
     * @param {string} cacheKey - The internal key to check.
     * @returns {boolean} True if the key exists, false otherwise.
     */
    public hasPersistentCacheName(cacheKey: string): boolean {
        return this.persistentCacheNameMapInternal.has(cacheKey);
    }
    
    /**
     * Deletes a Gemini cache name entry for a given internal cache key.
     * @param {string} cacheKey - The internal key to delete.
     * @returns {boolean} True if the entry was deleted, false otherwise.
     */
    public deletePersistentCacheName(cacheKey: string): boolean {
        return this.persistentCacheNameMapInternal.delete(cacheKey);
    }
}