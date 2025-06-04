// src/services/logAnalysisCache.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe'; // Không cần delay nữa
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { LoggingService, LoggerType } from './logging.service';
// Không cần import ConferenceLogAnalysisService và JournalLogAnalysisService nữa
import { ConferenceLogAnalysisResult } from '../types/logAnalysis';
import { JournalLogAnalysisResult } from '../types/logAnalysisJournal/logAnalysisJournal.types';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils';

interface CacheEntry<T> {
    data: T;
    createdAt: number;
    expiryTimestamp?: number;
}

@singleton()
export class LogAnalysisCacheService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
        // Không inject ConferenceLogAnalysisService và JournalLogAnalysisService nữa
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'LogAnalysisCacheService' });
        this.serviceLogger.info('LogAnalysisCacheService initializing...');
        this.ensureCacheDirectoriesExist();
        this.serviceLogger.info('LogAnalysisCacheService initialized successfully.');
    }

    private ensureCacheDirectoriesExist(): void {
        try {
            const confDir = this.configService.conferenceAnalysisCacheDirectory;
            const journalDir = this.configService.journalAnalysisCacheDirectory;

            if (!fs.existsSync(confDir)) {
                fs.mkdirSync(confDir, { recursive: true });
                this.serviceLogger.info(`Created conference analysis cache directory: ${confDir}`);
            }
            if (!fs.existsSync(journalDir)) {
                fs.mkdirSync(journalDir, { recursive: true });
                this.serviceLogger.info(`Created journal analysis cache directory: ${journalDir}`);
            }
        } catch (error) {
            const { message } = getErrorMessageAndStack(error);
            this.serviceLogger.error({ err: error }, `CRITICAL: Failed to create cache directories: ${message}. Caching will not work.`);
            throw new Error(`Failed to create cache directories: ${message}`);
        }
    }

    /**
     * Writes the provided analysis result to the cache.
     * This is called by the analysis services after a live analysis is performed and the result is final.
     */
    public async writeToCache(
        type: 'conference' | 'journal',
        batchRequestId: string,
        analysisResultData: ConferenceLogAnalysisResult | JournalLogAnalysisResult
    ): Promise<void> {
        const logger = this.loggingService.getLogger(type as LoggerType, {
            batchRequestId,
            service: 'LogAnalysisCacheService',
            operation: 'writeToCache'
        });

        if (!this.configService.analysisCacheEnabled) {
            logger.info(`Analysis caching is disabled. Skipping cache write for request ID: ${batchRequestId}.`);
            return;
        }

        // Kiểm tra lại điều kiện status trước khi ghi, mặc dù service gọi hàm này nên đảm bảo điều đó
        if (!analysisResultData.status || ['Processing', 'Unknown'].includes(analysisResultData.status)) {
            logger.warn({ currentStatus: analysisResultData.status, batchRequestId }, `Attempted to write non-final analysis result to cache. Skipping.`);
            return;
        }

        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);
        logger.info(`Writing analysis result for request ID ${batchRequestId} to cache: ${cachePath}. Status: ${analysisResultData.status}`);

        try {
            const cacheEntry: CacheEntry<typeof analysisResultData> = {
                data: analysisResultData,
                createdAt: Date.now(),
            };

            if (this.configService.analysisCacheTTLSeconds > 0) {
                cacheEntry.expiryTimestamp = Date.now() + (this.configService.analysisCacheTTLSeconds * 1000);
            }

            const resultJson = JSON.stringify(cacheEntry, null, 2);
            await fsPromises.writeFile(cachePath, resultJson);
            logger.info(`Successfully wrote analysis result to cache for request ID: ${batchRequestId}.`);

        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack }, batchRequestId }, `Failed to write analysis result to cache for request ID: ${batchRequestId}.`);
        }
    }

    /**
     * Invalidates (deletes) the cache file for a specific request ID.
     * This is called by the crawl controller when a crawl request finishes.
     */
    public async invalidateCacheForRequest(
        type: 'conference' | 'journal',
        batchRequestId: string
    ): Promise<void> {
        const logger = this.loggingService.getLogger(type as LoggerType, {
            batchRequestId,
            service: 'LogAnalysisCacheService',
            operation: 'invalidateCacheForRequest'
        });

        if (!this.configService.analysisCacheEnabled) {
            logger.info(`Analysis caching is disabled. Skipping cache invalidation for request ID: ${batchRequestId}.`);
            return;
        }

        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);
        logger.info(`Invalidating cache for request ID ${batchRequestId} by deleting file: ${cachePath}.`);

        try {
            if (fs.existsSync(cachePath)) {
                await fsPromises.unlink(cachePath);
                logger.info(`Successfully invalidated (deleted) cache for request ID: ${batchRequestId}.`);
            } else {
                logger.info(`No cache file found to invalidate for request ID: ${batchRequestId}. Path: ${cachePath}`);
            }
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack }, batchRequestId }, `Failed to invalidate cache for request ID: ${batchRequestId}.`);
        }
    }


    public async readFromCache<T extends ConferenceLogAnalysisResult | JournalLogAnalysisResult>(
        type: 'conference' | 'journal',
        batchRequestId: string
    ): Promise<T | null> {
        const logger = this.loggingService.getLogger(type as LoggerType, {
            batchRequestId,
            service: 'LogAnalysisCacheService',
            operation: 'readFromCache'
        });

        if (!this.configService.analysisCacheEnabled) {
            logger.info(`Analysis caching is disabled. Skipping cache read for request ID: ${batchRequestId}.`);
            return null;
        }

        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);

        try {
            if (!fs.existsSync(cachePath)) {
                logger.info(`Analysis cache file not found for request ID ${batchRequestId}: ${cachePath}`);
                return null;
            }

            const fileContent = await fsPromises.readFile(cachePath, 'utf-8');
            const cachedEntry = JSON.parse(fileContent) as CacheEntry<T>;

            if (cachedEntry.expiryTimestamp && Date.now() > cachedEntry.expiryTimestamp) {
                logger.info(`Cache for request ID ${batchRequestId} has expired. Deleting cache file: ${cachePath}`);
                // Xóa file bất đồng bộ, không cần đợi và không làm block việc trả về null
                fsPromises.unlink(cachePath).catch(unlinkErr => {
                    logger.warn({ err: unlinkErr, batchRequestId }, `Failed to delete expired cache file: ${cachePath}`);
                });
                return null;
            }

            logger.info(`Successfully read analysis result from cache for request ID: ${batchRequestId}.`);
            return cachedEntry.data;
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack }, cachePath, batchRequestId }, `Failed to read or parse analysis result from cache for request ID: ${batchRequestId}.`);
            if (fs.existsSync(cachePath)) {
                 fsPromises.unlink(cachePath).catch(unlinkErr => { // Xóa file bị lỗi
                    logger.warn({ err: unlinkErr, batchRequestId }, `Failed to delete potentially corrupted cache file after read error: ${cachePath}`);
                });
            }
            return null;
        }
    }

    public async cacheExists(
        type: 'conference' | 'journal',
        batchRequestId: string
    ): Promise<boolean> {
        const logger = this.loggingService.getLogger(type as LoggerType, {
            batchRequestId,
            service: 'LogAnalysisCacheService',
            operation: 'cacheExists'
        });

        if (!this.configService.analysisCacheEnabled) {
            logger.debug(`Analysis caching is disabled. Cache check for ${batchRequestId} returns false.`);
            return false;
        }
        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);
        try {
            await fsPromises.access(cachePath);
            const fileContent = await fsPromises.readFile(cachePath, 'utf-8'); // Cần đọc để kiểm tra TTL
            const cachedEntry = JSON.parse(fileContent) as CacheEntry<any>;
            if (cachedEntry.expiryTimestamp && Date.now() > cachedEntry.expiryTimestamp) {
                logger.debug(`Cache file for ${batchRequestId} exists but is expired.`);
                return false;
            }
            logger.debug(`Cache file for ${batchRequestId} exists and is valid.`);
            return true;
        } catch {
            logger.debug(`Cache file for ${batchRequestId} does not exist or is not accessible.`);
            return false;
        }
    }

    public async getAllCachedRequestIds(type: 'conference' | 'journal'): Promise<string[]> {
         const logger = this.loggingService.getLogger(type as LoggerType, {
            service: 'LogAnalysisCacheService',
            operation: 'getAllCachedRequestIds'
        });

        if (!this.configService.analysisCacheEnabled) {
            logger.info(`Analysis caching is disabled. Returning empty list of cached IDs.`);
            return [];
        }

        const cacheDir = type === 'conference'
            ? this.configService.conferenceAnalysisCacheDirectory
            : this.configService.journalAnalysisCacheDirectory;

        try {
            if (!fs.existsSync(cacheDir)) {
                logger.warn(`Cache directory does not exist: ${cacheDir}. Returning empty list.`);
                return [];
            }
            const files = await fsPromises.readdir(cacheDir);
            const validRequestIds: string[] = [];
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const requestId = file.replace('.json', '');
                    const cachePath = path.join(cacheDir, file);
                    try {
                        const content = await fsPromises.readFile(cachePath, 'utf-8');
                        const cachedEntry = JSON.parse(content) as CacheEntry<any>;
                        if (cachedEntry.expiryTimestamp && Date.now() > cachedEntry.expiryTimestamp) {
                            continue; // Bỏ qua file hết hạn
                        }
                        validRequestIds.push(requestId);
                    } catch (readErr) {
                        logger.warn({err: readErr, file: cachePath}, "Failed to read or parse cache file while listing IDs, skipping.")
                    }
                }
            }
            logger.info(`Found ${validRequestIds.length} valid cached request IDs for type '${type}'.`);
            return validRequestIds;
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack }, cacheDir }, `Failed to list cached request IDs for type '${type}'.`);
            return [];
        }
    }

    public async clearExpiredCache(): Promise<void> {
        // Logic giữ nguyên như bạn đã cung cấp, nó đã khá tốt.
        if (!this.configService.analysisCacheEnabled || this.configService.analysisCacheTTLSeconds <= 0) {
            this.serviceLogger.info("Cache clearing skipped: Caching disabled or no TTL configured.");
            return;
        }
        this.serviceLogger.info("Starting to clear expired cache files...");
        let clearedCount = 0;
        const types: Array<'conference' | 'journal'> = ['conference', 'journal'];

        for (const type of types) {
            const cacheDir = type === 'conference'
                ? this.configService.conferenceAnalysisCacheDirectory
                : this.configService.journalAnalysisCacheDirectory;

            if (!fs.existsSync(cacheDir)) continue;

            try {
                const files = await fsPromises.readdir(cacheDir);
                for (const file of files) {
                    if (file.endsWith('.json')) {
                        const cachePath = path.join(cacheDir, file);
                        try {
                            const fileContent = await fsPromises.readFile(cachePath, 'utf-8');
                            const cachedEntry = JSON.parse(fileContent) as CacheEntry<any>;
                            if (cachedEntry.expiryTimestamp && Date.now() > cachedEntry.expiryTimestamp) {
                                await fsPromises.unlink(cachePath);
                                clearedCount++;
                                this.serviceLogger.debug(`Deleted expired cache file: ${cachePath}`);
                            }
                        } catch (readOrParseError) {
                            this.serviceLogger.warn({ err: readOrParseError, file: cachePath }, "Error reading/parsing cache file during cleanup, attempting to delete if old.");
                            try {
                                const stats = await fsPromises.stat(cachePath);
                                const ageInMs = Date.now() - stats.mtime.getTime();
                                if (ageInMs > this.configService.analysisCacheTTLSeconds * 1000 * 2) {
                                    await fsPromises.unlink(cachePath);
                                    this.serviceLogger.info(`Deleted potentially corrupted/old cache file: ${cachePath}`);
                                }
                            } catch (statError) { /* Ignore */ }
                        }
                    }
                }
            } catch (dirError) {
                 this.serviceLogger.error({ err: dirError, directory: cacheDir }, "Error processing cache directory for cleanup.");
            }
        }
        this.serviceLogger.info(`Expired cache cleanup finished. Cleared ${clearedCount} files.`);
    }
}