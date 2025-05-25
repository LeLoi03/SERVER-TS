// src/services/batchOutputPersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import { Logger } from 'pino';

import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { FileSystemService } from '../fileSystem.service';
import { IBatchOutputPersistenceService } from '../interfaces/batchOutputPersistence.interface'; // Adjust path
import { BatchEntryWithIds, BatchUpdateDataWithIds } from '../../types/crawl'; // Adjust path

@singleton()
export class BatchOutputPersistenceService implements IBatchOutputPersistenceService {
    private readonly serviceLogger: Logger;
    private readonly errorLogPath: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        this.serviceLogger = loggingService.getLogger('main', { service: 'BatchOutputPersistenceService' });
        this.errorLogPath = path.join(this.configService.baseOutputDir, 'batch_processing_errors.log');
        this.serviceLogger.info("BatchOutputPersistenceService constructed.");
    }

    public async ensureDirectories(paths: string[], parentLogger: Logger): Promise<void> {
        const logger = parentLogger.child({ serviceScopedFunction: 'ensureDirectories' });
        const logContext = { function: 'ensureDirectories', service: 'BatchOutputPersistenceService' }; // Keep original context for event name
        for (const dirPath of paths) {
            let effectiveDirPath = dirPath;
            try {
                if (fs.existsSync(dirPath) && fs.statSync(dirPath).isFile()) {
                    effectiveDirPath = path.dirname(dirPath);
                } else if (!fs.existsSync(dirPath)) {
                    effectiveDirPath = path.dirname(dirPath);
                }
            } catch (e) {
                effectiveDirPath = path.dirname(dirPath);
            }

            if (!fs.existsSync(effectiveDirPath)) {
                logger.info({ ...logContext, path: effectiveDirPath, event: 'batch_processing_ensure_dir_create_attempt' });
                try {
                    await this.fileSystemService.ensureDirExists(effectiveDirPath, logger);
                } catch (mkdirError: unknown) {
                    logger.error({ ...logContext, path: effectiveDirPath, err: mkdirError, event: 'batch_dir_create_failed' });
                    throw mkdirError;
                }
            }
        }
    }

    public async appendFinalRecord(
        record: BatchEntryWithIds | BatchUpdateDataWithIds,
        batchRequestIdForFile: string,
        parentLogger: Logger
    ): Promise<void> {
        const jsonlPathForBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForFile);
        // Logger passed from caller already has context, appendFinalRecord specific logger is fine
        const logger = parentLogger.child({
            // batchServiceFunction: 'appendFinalRecord', // This was from original, keep if needed for log analysis
            serviceScopedFunction: 'appendFinalRecord', // New scope
            outputPath: jsonlPathForBatch,
            recordOriginalAcronymForAppend: record.conferenceAcronym,
            recordInternalAcronymForAppend: record.internalProcessingAcronym,
        });
        try {
            logger.info({ event: 'append_final_record_start' }, `Appending to ${path.basename(jsonlPathForBatch)}`);
            // Ensure directory for the specific file being appended to
            await this.fileSystemService.ensureDirExists(path.dirname(jsonlPathForBatch), logger);
            const dataToWrite = JSON.stringify(record) + '\n';
            await this.fileSystemService.appendFile(jsonlPathForBatch, dataToWrite, logger);
            logger.info({ event: 'append_final_record_success' });
        } catch (appendError: any) {
            logger.error({ err: appendError, event: 'append_final_record_failed' });
            throw appendError;
        }
    }

    public async logBatchProcessingError(
        context: {
            conferenceAcronym: string | undefined;
            batchItemIndex: number | undefined;
            batchRequestId: string | undefined;
            flow: 'save' | 'update' | 'general';
        },
        error: any,
        parentLogger: Logger // The logger from the context where error occurred
    ): Promise<void> {
        const logger = parentLogger.child({ serviceScopedFunction: 'logBatchProcessingErrorToFile' });
        try {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in Batch Processing (Flow: ${context.flow}) for ${context.conferenceAcronym || 'N/A'} (BatchItemIndex: ${context.batchItemIndex ?? 'N/A'}, BatchRequestID: ${context.batchRequestId || 'N/A'}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            
            // Ensure the directory for the error log exists
            await this.fileSystemService.ensureDirExists(path.dirname(this.errorLogPath), logger);
            await this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger);
            logger.debug({ event: 'batch_processing_error_logged_to_file', errorLogPath: this.errorLogPath });
        } catch (e) {
            // Log to console if file logging fails
            logger.error({ err: e, event: 'failed_to_write_to_error_log_file', originalErrorContext: context });
            console.error("CRITICAL: Failed to write to batch_processing_errors.log", e);
        }
    }
}