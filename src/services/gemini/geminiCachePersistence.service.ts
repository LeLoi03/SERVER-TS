// src/services/gemini/geminiCachePersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import { ConfigService } from '../../config/config.service'; // Adjust path
// import { LoggingService } from '../logging.service'; // Not needed if logger always passed
import { Logger } from 'pino';

@singleton()
export class GeminiCachePersistenceService {
    private readonly cacheMapFilePath: string;
    private readonly cacheMapDir: string;
    // This map is owned and managed by this service.
    private persistentCacheNameMapInternal: Map<string, string> = new Map();

    constructor(
        @inject(ConfigService) private configService: ConfigService,
    ) {
        this.cacheMapDir = path.join(this.configService.baseOutputDir, 'gemini_cache');
        const cacheMapFilename = 'gemini_cache_map.json'; // As original
        this.cacheMapFilePath = path.join(this.cacheMapDir, cacheMapFilename);
    }

    // Mimics original loadCacheNameMap
    public async loadMap(logger: Logger): Promise<void> {
        const logContext = { filePath: this.cacheMapFilePath, function: 'loadCacheNameMap' }; // Keep original function name
        logger.info({ ...logContext, event: 'cache_map_load_attempt' }, "Attempting to load cache name map");
        try {
            if (!existsSync(this.cacheMapFilePath)) {
                logger.warn({ ...logContext, event: 'cache_map_file_not_found' }, "Cache map file not found. Starting with an empty map.");
                this.persistentCacheNameMapInternal = new Map();
                logger.info({ ...logContext, event: 'cache_map_load_success', status: 'empty_map_created' }, "Cache map loaded (file did not exist, new empty map used).");
                return;
            }
            const fileContent = await fsPromises.readFile(this.cacheMapFilePath, 'utf8');
            if (!fileContent.trim()) {
                logger.warn({ ...logContext, event: 'cache_map_file_empty' }, "Cache map file is empty. Starting with an empty map.");
                this.persistentCacheNameMapInternal = new Map();
                logger.info({ ...logContext, event: 'cache_map_load_success', status: 'empty_map_from_empty_file' }, "Cache map loaded (file was empty, new empty map used).");
                return;
            }
            const data: Record<string, string> = JSON.parse(fileContent);
            this.persistentCacheNameMapInternal = new Map<string, string>(Object.entries(data));
            logger.info({ ...logContext, loadedCount: this.persistentCacheNameMapInternal.size, event: 'cache_map_load_success', status: 'loaded_from_file' }, "Successfully loaded cache name entries from file");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            logger.error({ ...logContext, err: errorDetails, event: 'cache_map_load_failed' }, "Failed to load or parse cache name map. Starting with an empty map.");
            this.persistentCacheNameMapInternal = new Map();
            throw error; // As original
        }
    }

    // Mimics original saveCacheNameMap
    public async saveMap(logger: Logger): Promise<void> {
        const logContext = { filePath: this.cacheMapFilePath, function: 'saveCacheNameMap' }; // Keep original function name
        logger.debug({ ...logContext, event: 'cache_map_write_attempt' }, "Attempting to save cache name map");
        try {
            if (!existsSync(this.cacheMapDir)) {
                // Original log used 'directory' field
                logger.info({ ...logContext, directory: this.cacheMapDir, event: 'cache_map_dir_create_attempt' }, "Creating cache map directory before saving");
                await fsPromises.mkdir(this.cacheMapDir, { recursive: true });
            }
            const dataToSave: Record<string, string> = Object.fromEntries(this.persistentCacheNameMapInternal);
            const jsonString = JSON.stringify(dataToSave, null, 2);
            await fsPromises.writeFile(this.cacheMapFilePath, jsonString, 'utf8');
            logger.info({ ...logContext, savedCount: this.persistentCacheNameMapInternal.size, event: 'cache_map_write_success' }, "Successfully saved cache name map to file");
        } catch (error: unknown) {
            const errorDetails = error instanceof Error ? { name: error.name, message: error.message } : { details: String(error) };
            logger.error({ ...logContext, err: errorDetails, event: 'cache_map_write_failed' }, "Failed to save cache name map");
            // Original did not throw here
        }
    }

    public getPersistentCacheName(cacheKey: string): string | undefined {
        return this.persistentCacheNameMapInternal.get(cacheKey);
    }

    public setPersistentCacheName(cacheKey: string, cacheName: string): void {
        this.persistentCacheNameMapInternal.set(cacheKey, cacheName);
    }

    public hasPersistentCacheName(cacheKey: string): boolean {
        return this.persistentCacheNameMapInternal.has(cacheKey);
    }
    
    public deletePersistentCacheName(cacheKey: string): boolean {
        return this.persistentCacheNameMapInternal.delete(cacheKey);
    }
}