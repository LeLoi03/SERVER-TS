// src/services/logAnalysis/journal/logReader.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fsPromises from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { Logger } from 'pino';
import { ConfigService } from '../../../config/config.service';
import { LoggingService } from '../../logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';

@singleton()
export class JournalLogReaderService {
    private readonly serviceLogger: Logger;
    private readonly journalRequestLogBaseDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceLogger = this.loggingService.getLogger('app', { service: 'JournalLogReaderService' });
        this.journalRequestLogBaseDir = this.configService.appConfiguration.journalRequestLogDirectory;
    }

    /**
     * Khám phá các ID request từ tên file trong thư mục log.
     */
    async discoverRequestIdsFromLogFiles(): Promise<string[]> {
        const logger = this.serviceLogger.child({ function: 'discoverRequestIdsFromLogFiles' });
        let requestIds: string[] = [];
        try {
            if (fsSync.existsSync(this.journalRequestLogBaseDir)) {
                const files = await fsPromises.readdir(this.journalRequestLogBaseDir);
                requestIds = files
                    .filter(file => file.endsWith('.log'))
                    .map(file => path.basename(file, '.log'));
            } else {
                logger.warn(`Journal request log directory not found: ${this.journalRequestLogBaseDir}. No live request IDs will be discovered.`);
            }
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack } }, 'Error reading journal request log directory for ID discovery.');
        }
        return requestIds;
    }
}