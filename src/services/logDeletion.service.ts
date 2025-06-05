// src/services/logDeletion.service.ts (NEW FILE)
import { singleton, inject } from 'tsyringe';
import fs from 'fs/promises';
import { ConfigService } from '../config/config.service'; // Your existing ConfigService
import { LoggingService } from './logging.service';   // Your existing LoggingService
import { Logger } from 'pino';

export type CrawlerType = 'conference' | 'journal';

export interface DeletionOpResult {
    success: boolean;
    path?: string;
    error?: string;
}

export interface RequestDeletionResult {
    requestId: string;
    logFile: DeletionOpResult;
    cacheFile: DeletionOpResult;
    overallSuccess: boolean;
    errorMessage?: string;
}

@singleton()
export class LogDeletionService {
    private logger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService
    ) {
        this.logger = loggingService.getLogger('app').child({ service: 'LogDeletionService' });
    }

    private async deleteFile(filePath: string, entityName: string, requestId: string): Promise<DeletionOpResult> {
        try {
            this.logger.info({ requestId, path: filePath }, `Attempting to delete ${entityName} file.`);
            await fs.access(filePath); // Check if file exists before unlinking
            await fs.unlink(filePath);
            this.logger.info({ requestId, path: filePath }, `${entityName} file deleted successfully.`);
            return { success: true, path: filePath };
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                this.logger.warn({ requestId, path: filePath }, `${entityName} file not found, considered successfully handled.`);
                return { success: true, path: filePath }; // Or success: false if "not found" is an error for you
            }
            this.logger.error({ err, requestId, path: filePath }, `Error deleting ${entityName} file.`);
            return { success: false, path: filePath, error: err.message };
        }
    }

    public async deleteRequestData(requestId: string, crawlerType: CrawlerType): Promise<RequestDeletionResult> {
        this.logger.debug({ requestId, crawlerType }, 'Starting deletion process for request.');

        const logFilePath = this.configService.getRequestSpecificLogFilePath(crawlerType, requestId);
        const cacheFilePath = this.configService.getAnalysisCachePathForRequest(crawlerType, requestId);

        const logDeletionResult = await this.deleteFile(logFilePath, 'log', requestId);
        const cacheDeletionResult = await this.deleteFile(cacheFilePath, 'cache', requestId);

        const overallSuccess = logDeletionResult.success && cacheDeletionResult.success;
        let errorMessage: string | undefined;
        if (!overallSuccess) {
            const errors = [];
            if (logDeletionResult.error) errors.push(`Log: ${logDeletionResult.error}`);
            if (cacheDeletionResult.error) errors.push(`Cache: ${cacheDeletionResult.error}`);
            errorMessage = errors.join('; ');
        }

        return {
            requestId,
            logFile: logDeletionResult,
            cacheFile: cacheDeletionResult,
            overallSuccess,
            errorMessage,
        };
    }
}