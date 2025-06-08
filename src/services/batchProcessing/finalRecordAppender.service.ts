// src/services/batchProcessing/finalRecordAppender.service.ts

import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { Logger } from 'pino';

// --- Types ---
import { BatchEntryWithIds, BatchUpdateDataWithIds } from '../../types/crawl';

// --- Service Imports ---
import { ConfigService } from '../../config/config.service';
import { FileSystemService } from '../fileSystem.service';

export interface IFinalRecordAppenderService {
    append(
        record: BatchEntryWithIds | BatchUpdateDataWithIds,
        batchRequestIdForFile: string,
        parentLogger: Logger
    ): Promise<void>;
}

@singleton()
export class FinalRecordAppenderService implements IFinalRecordAppenderService {
    constructor(
        @inject(ConfigService) private readonly configService: ConfigService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService
    ) {}

    public async append(
        record: BatchEntryWithIds | BatchUpdateDataWithIds,
        batchRequestIdForFile: string,
        parentLogger: Logger
    ): Promise<void> {
        const jsonlPathForBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForFile);
        const logger = parentLogger.child({
            batchServiceFunction: 'appendFinalRecord', // Giữ nguyên tên function trong log
            outputPath: jsonlPathForBatch,
            recordOriginalAcronymForAppend: record.conferenceAcronym,
            recordInternalAcronymForAppend: record.internalProcessingAcronym,
        });
        try {
            logger.info({ event: 'append_final_record_start' }, `Appending to ${path.basename(jsonlPathForBatch)}`);
            await this.fileSystemService.ensureDirExists(path.dirname(jsonlPathForBatch), logger);
            const dataToWrite = JSON.stringify(record) + '\n';
            await this.fileSystemService.appendFile(jsonlPathForBatch, dataToWrite, logger);
            logger.info({ event: 'append_final_record_success' });
        } catch (appendError: any) {
            logger.error({ err: appendError, event: 'append_final_record_failed' });
            throw appendError;
        }
    }
}