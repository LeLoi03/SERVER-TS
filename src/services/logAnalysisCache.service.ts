// src/services/logAnalysisCache.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service'; // LoggerType không cần thiết nếu chỉ dùng app logger
import { ConferenceLogAnalysisResult } from '../types/logAnalysis';
import { JournalLogAnalysisResult } from '../types/logAnalysisJournal/logAnalysisJournal.types';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../utils/errorUtils';
import { createHash } from 'crypto'; // Sử dụng crypto để tạo hash cho fingerprint

interface CacheEntry<T> {
    data: T;
    createdAt: number;
    expiryTimestamp?: number;
}
// Thêm kiểu dữ liệu cho cache tổng hợp
interface OverallCacheEntry<T> {
    fingerprint: string; // Dấu vân tay của trạng thái cache
    data: T;
    createdAt: number;
}

@singleton()
export class LogAnalysisCacheService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        // Khởi tạo serviceLogger một lần trong constructor
        // Logger này sẽ ghi vào stream chung của 'app' (hoặc stream mặc định của LoggingService)
        // với context cố định là { service: 'LogAnalysisCacheService' }
        this.serviceLogger = this.loggingService.getLogger('app').child({ service: 'LogAnalysisCacheService' });
        this.serviceLogger.info('LogAnalysisCacheService initializing...');
        this.ensureCacheDirectoriesExist(); // ensureCacheDirectoriesExist cũng sẽ dùng this.serviceLogger
        this.serviceLogger.info('LogAnalysisCacheService initialized successfully.');
    }

    private ensureCacheDirectoriesExist(): void {
        try {
            const confDir = this.configService.conferenceAnalysisCacheDirectory;
            const journalDir = this.configService.journalAnalysisCacheDirectory;

            if (!fs.existsSync(confDir)) {
                fs.mkdirSync(confDir, { recursive: true });
                this.serviceLogger.info({ directory: confDir }, `Created conference analysis cache directory.`);
            }
            if (!fs.existsSync(journalDir)) {
                fs.mkdirSync(journalDir, { recursive: true });
                this.serviceLogger.info({ directory: journalDir }, `Created journal analysis cache directory.`);
            }
        } catch (error) {
            const { message } = getErrorMessageAndStack(error);
            // Ghi lỗi nghiêm trọng vào serviceLogger
            this.serviceLogger.error({ err: error, errorMessage: message }, `CRITICAL: Failed to create cache directories. Caching will not work.`);
            throw new Error(`Failed to create cache directories: ${message}`);
        }
    }

    public async writeToCache(
        type: 'conference' | 'journal',
        batchRequestId: string,
        analysisResultData: ConferenceLogAnalysisResult | JournalLogAnalysisResult
    ): Promise<void> {
        // Tạo child logger từ serviceLogger cho context của operation này
        const operationLogger = this.serviceLogger.child({
            operation: 'writeToCache',
            cacheType: type,
            batchRequestId
        });

        if (!this.configService.analysisCacheEnabled) {
            operationLogger.info(`Analysis caching is disabled. Skipping cache write.`);
            return;
        }

        if (!analysisResultData.status || ['Processing', 'Unknown'].includes(analysisResultData.status)) {
            operationLogger.warn({ currentStatus: analysisResultData.status }, `Attempted to write non-final analysis result to cache. Skipping.`);
            return;
        }

        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);
        operationLogger.info({ cachePath, status: analysisResultData.status }, `Writing analysis result to cache.`);

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
            operationLogger.info({ cachePath }, `Successfully wrote analysis result to cache.`);

        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            operationLogger.error({ err: { message, stack }, cachePath }, `Failed to write analysis result to cache.`);
        }
    }

    public async invalidateCacheForRequest(
        type: 'conference' | 'journal',
        batchRequestId: string
    ): Promise<void> {
        const operationLogger = this.serviceLogger.child({
            operation: 'invalidateCacheForRequest',
            cacheType: type,
            batchRequestId
        });

        if (!this.configService.analysisCacheEnabled) {
            operationLogger.info(`Analysis caching is disabled. Skipping cache invalidation.`);
            return;
        }

        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);
        operationLogger.info({ cachePath }, `Invalidating cache by deleting file.`);

        try {
            if (fs.existsSync(cachePath)) {
                await fsPromises.unlink(cachePath);
                operationLogger.info({ cachePath }, `Successfully invalidated (deleted) cache.`);
            } else {
                operationLogger.info({ cachePath }, `No cache file found to invalidate.`);
            }
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            operationLogger.error({ err: { message, stack }, cachePath }, `Failed to invalidate cache.`);
        }
    }

    public async readFromCache<T extends ConferenceLogAnalysisResult | JournalLogAnalysisResult>(
        type: 'conference' | 'journal',
        batchRequestId: string
    ): Promise<T | null> {
        const operationLogger = this.serviceLogger.child({
            operation: 'readFromCache',
            cacheType: type,
            batchRequestId
        });

        if (!this.configService.analysisCacheEnabled) {
            operationLogger.info(`Analysis caching is disabled. Skipping cache read.`);
            return null;
        }

        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);

        try {
            if (!fs.existsSync(cachePath)) {
                operationLogger.info({ cachePath }, `Analysis cache file not found.`);
                return null;
            }

            const fileContent = await fsPromises.readFile(cachePath, 'utf-8');
            const cachedEntry = JSON.parse(fileContent) as CacheEntry<T>;

            if (cachedEntry.expiryTimestamp && Date.now() > cachedEntry.expiryTimestamp) {
                operationLogger.info({ cachePath }, `Cache has expired. Deleting cache file.`);
                fsPromises.unlink(cachePath).catch(unlinkErr => {
                    const { message: errMsg, stack: errStack } = getErrorMessageAndStack(unlinkErr);
                    operationLogger.warn({ err: { message: errMsg, stack: errStack }, cachePath }, `Failed to delete expired cache file.`);
                });
                return null;
            }

            // operationLogger.info({ cachePath }, `Successfully read analysis result from cache.`);
            return cachedEntry.data;
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            operationLogger.error({ err: { message, stack }, cachePath }, `Failed to read or parse analysis result from cache.`);
            if (fs.existsSync(cachePath)) {
                fsPromises.unlink(cachePath).catch(unlinkErr => {
                    const { message: errMsg, stack: errStack } = getErrorMessageAndStack(unlinkErr);
                    operationLogger.warn({ err: { message: errMsg, stack: errStack }, cachePath }, `Failed to delete potentially corrupted cache file after read error.`);
                });
            }
            return null;
        }
    }

    public async cacheExists(
        type: 'conference' | 'journal',
        batchRequestId: string
    ): Promise<boolean> {
        const operationLogger = this.serviceLogger.child({
            operation: 'cacheExists',
            cacheType: type,
            batchRequestId
        });

        if (!this.configService.analysisCacheEnabled) {
            operationLogger.debug(`Analysis caching is disabled. Cache check returns false.`);
            return false;
        }
        const cachePath = this.configService.getAnalysisCachePathForRequest(type, batchRequestId);
        try {
            await fsPromises.access(cachePath); // Check existence and accessibility
            const fileContent = await fsPromises.readFile(cachePath, 'utf-8');
            const cachedEntry = JSON.parse(fileContent) as CacheEntry<any>;
            if (cachedEntry.expiryTimestamp && Date.now() > cachedEntry.expiryTimestamp) {
                operationLogger.debug({ cachePath }, `Cache file exists but is expired.`);
                return false;
            }
            operationLogger.debug({ cachePath }, `Cache file exists and is valid.`);
            return true;
        } catch {
            operationLogger.debug({ cachePath }, `Cache file does not exist or is not accessible.`);
            return false;
        }
    }

    public async getAllCachedRequestIds(type: 'conference' | 'journal'): Promise<string[]> {
        const operationLogger = this.serviceLogger.child({
            operation: 'getAllCachedRequestIds',
            cacheType: type
        });

        if (!this.configService.analysisCacheEnabled) {
            operationLogger.info(`Analysis caching is disabled. Returning empty list of cached IDs.`);
            return [];
        }

        const cacheDir = type === 'conference'
            ? this.configService.conferenceAnalysisCacheDirectory
            : this.configService.journalAnalysisCacheDirectory;

        try {
            if (!fs.existsSync(cacheDir)) {
                operationLogger.warn({ cacheDir }, `Cache directory does not exist. Returning empty list.`);
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
                            // Log cho từng file hết hạn có thể quá nhiều, cân nhắc bỏ nếu không cần thiết
                            // operationLogger.debug({ cachePath, requestId }, "Skipping expired cache file during ID listing.");
                            continue;
                        }
                        validRequestIds.push(requestId);
                    } catch (readErr) {
                        const { message: errMsg, stack: errStack } = getErrorMessageAndStack(readErr);
                        operationLogger.warn({ err: { message: errMsg, stack: errStack }, cachePath, file }, "Failed to read or parse cache file while listing IDs, skipping.")
                    }
                }
            }
            operationLogger.info({ count: validRequestIds.length, cacheDir }, `Found valid cached request IDs.`);
            return validRequestIds;
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            operationLogger.error({ err: { message, stack }, cacheDir }, `Failed to list cached request IDs.`);
            return [];
        }
    }

    public async clearExpiredCache(): Promise<void> {
        const operationLogger = this.serviceLogger.child({ operation: 'clearExpiredCache' });

        if (!this.configService.analysisCacheEnabled || this.configService.analysisCacheTTLSeconds <= 0) {
            operationLogger.info("Cache clearing skipped: Caching disabled or no TTL configured.");
            return;
        }
        operationLogger.info("Starting to clear expired cache files...");
        let clearedCount = 0;
        const types: Array<'conference' | 'journal'> = ['conference', 'journal'];

        for (const cacheType of types) {
            const typeLogger = operationLogger.child({ cacheType }); // Logger cho từng type
            const cacheDir = cacheType === 'conference'
                ? this.configService.conferenceAnalysisCacheDirectory
                : this.configService.journalAnalysisCacheDirectory;

            if (!fs.existsSync(cacheDir)) {
                typeLogger.debug({ cacheDir }, "Cache directory does not exist, skipping for this type.");
                continue;
            }

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
                                typeLogger.debug({ cachePath }, `Deleted expired cache file.`);
                            }
                        } catch (readOrParseError) {
                            const { message: errMsg, stack: errStack } = getErrorMessageAndStack(readOrParseError);
                            typeLogger.warn({ err: { message: errMsg, stack: errStack }, file: cachePath }, "Error reading/parsing cache file during cleanup, attempting to delete if old.");
                            try {
                                // Xóa file nếu nó quá cũ (gấp đôi TTL) như một biện pháp an toàn
                                const stats = await fsPromises.stat(cachePath);
                                const ageInMs = Date.now() - stats.mtime.getTime();
                                if (this.configService.analysisCacheTTLSeconds > 0 && // Chỉ xóa nếu TTL được cấu hình
                                    ageInMs > this.configService.analysisCacheTTLSeconds * 1000 * 2) {
                                    await fsPromises.unlink(cachePath);
                                    typeLogger.info({ cachePath }, `Deleted potentially corrupted/old cache file (older than 2x TTL).`);
                                }
                            } catch (statError) {
                                // Bỏ qua lỗi khi cố gắng stat hoặc unlink file bị lỗi
                                const { message: statErrMsg } = getErrorMessageAndStack(statError);
                                typeLogger.warn({ err: { message: statErrMsg }, file: cachePath }, "Failed to stat/delete potentially corrupted file during cleanup.");
                            }
                        }
                    }
                }
            } catch (dirError) {
                const { message: errMsg, stack: errStack } = getErrorMessageAndStack(dirError);
                typeLogger.error({ err: { message: errMsg, stack: errStack }, directory: cacheDir }, "Error processing cache directory for cleanup.");
            }
        }
        operationLogger.info({ clearedCount }, `Expired cache cleanup finished.`);
    }


    // --- CÁC PHƯƠNG THỨC MỚI CHO CACHE TỔNG HỢP ---

    /**
       * TẠO LẠI "DẤU VÂN TAY" DỰA TRÊN THƯ MỤC LOG
       * Dấu vân tay này thay đổi nếu có bất kỳ file log nào được thêm, xóa, hoặc cập nhật.
       */
    public async generateLogStateFingerprint(type: 'conference' | 'journal'): Promise<string> {
        const operationLogger = this.serviceLogger.child({ operation: 'generateLogStateFingerprint', cacheType: type });

        // Lấy đường dẫn đến thư mục chứa các file log của từng request
        const logDir = type === 'conference'
            ? this.configService.appConfiguration.conferenceRequestLogDirectory
            : this.configService.appConfiguration.journalRequestLogDirectory; // Giả sử có config này

        try {
            if (!fs.existsSync(logDir)) return 'no-log-dir';

            const files = await fsPromises.readdir(logDir);
            if (files.length === 0) return 'no-log-files';

            // Chỉ lấy các file log, có thể lọc thêm nếu cần
            const logFiles = files.filter(f => f.endsWith('.log'));
            logFiles.sort(); // Đảm bảo thứ tự file luôn nhất quán

            const fileStatsPromises = logFiles.map(async (file) => {
                const filePath = path.join(logDir, file);
                const stats = await fsPromises.stat(filePath);
                // Kết hợp tên file và thời gian sửa đổi cuối cùng
                return `${file}:${stats.mtime.getTime()}`;
            });

            const fileStats = await Promise.all(fileStatsPromises);
            const combinedString = fileStats.join('|');

            // Sử dụng hash để giữ cho fingerprint có độ dài cố định
            return createHash('sha256').update(combinedString).digest('hex');

        } catch (error) {
            operationLogger.error({ err: error }, "Failed to generate log state fingerprint.");
            return `error-${Date.now()}`;
        }
    }

    /**
     * Ghi kết quả phân tích tổng hợp vào file cache đặc biệt.
     */
    public async writeOverallCache(
        type: 'conference' | 'journal',
        fingerprint: string,
        analysisResultData: ConferenceLogAnalysisResult | JournalLogAnalysisResult
    ): Promise<void> {
        const operationLogger = this.serviceLogger.child({ operation: 'writeOverallCache', cacheType: type });
        const cachePath = path.join(
            type === 'conference' ? this.configService.conferenceAnalysisCacheDirectory : this.configService.journalAnalysisCacheDirectory,
            '_overall_analysis.json'
        );

        operationLogger.info({ cachePath }, "Writing overall aggregated analysis result to cache.");
        try {
            const cacheEntry: OverallCacheEntry<typeof analysisResultData> = {
                fingerprint,
                data: analysisResultData,
                createdAt: Date.now(),
            };
            const resultJson = JSON.stringify(cacheEntry, null, 2);
            await fsPromises.writeFile(cachePath, resultJson);
        } catch (error) {
            operationLogger.error({ err: error, cachePath }, "Failed to write overall cache.");
        }
    }

    /**
     * Đọc kết quả phân tích tổng hợp từ cache.
     */
    public async readOverallCache<T extends ConferenceLogAnalysisResult | JournalLogAnalysisResult>(
        type: 'conference' | 'journal'
    ): Promise<OverallCacheEntry<T> | null> {
        const operationLogger = this.serviceLogger.child({ operation: 'readOverallCache', cacheType: type });
        const cachePath = path.join(
            type === 'conference' ? this.configService.conferenceAnalysisCacheDirectory : this.configService.journalAnalysisCacheDirectory,
            '_overall_analysis.json'
        );

        try {
            if (!fs.existsSync(cachePath)) {
                operationLogger.info("Overall analysis cache file not found.");
                return null;
            }
            const fileContent = await fsPromises.readFile(cachePath, 'utf-8');
            return JSON.parse(fileContent) as OverallCacheEntry<T>;
        } catch (error) {
            operationLogger.error({ err: error, cachePath }, "Failed to read or parse overall cache.");
            return null;
        }
    }
}