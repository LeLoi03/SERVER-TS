// src/services/batchProcessing/finalRecordAppender.service.ts

import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { Logger } from 'pino';
import { RequestStateService } from '../requestState.service'; // <<< IMPORT MỚI
import { InMemoryResultCollectorService } from '../inMemoryResultCollector.service'; // <<< THAY ĐỔI IMPORT

// --- Types ---
import { BatchEntryWithIds, BatchUpdateDataWithIds, InputRowData } from '../../types/crawl';

// --- Service Imports ---
import { ConfigService } from '../../config/config.service';
import { FileSystemService } from '../fileSystem.service';

type FinalRecord = BatchEntryWithIds | BatchUpdateDataWithIds;

export interface IFinalRecordAppenderService {
    append(record: FinalRecord, batchRequestId: string, logger: Logger): Promise<void>;
}

@singleton()
export class FinalRecordAppenderService implements IFinalRecordAppenderService {
    constructor(
        @inject(ConfigService) private readonly configService: ConfigService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService,
        @inject(RequestStateService) private readonly requestStateService: RequestStateService, // <<< INJECT MỚI
        @inject(InMemoryResultCollectorService) private readonly resultCollector: InMemoryResultCollectorService
    ) { }

    public async append(record: FinalRecord, batchRequestId: string, logger: Logger): Promise<void> {
        // <<< LOGIC ĐIỀU KIỆN >>>
        if (this.requestStateService.shouldRecordFiles()) {
            // --- Luồng cũ: Ghi vào file JSONL ---
            const finalJsonlPath = this.configService.getFinalOutputJsonlPathForBatch(batchRequestId);
            const jsonLine = JSON.stringify(record);
            try {
                await this.fileSystemService.appendFile(finalJsonlPath, jsonLine + '\n', logger);
                logger.info({ event: 'append_final_record_success', recordType: 'update' in record ? 'update' : 'save' }, 'Successfully appended final record to JSONL file.');
            } catch (error) {
                logger.error({ err: error, event: 'append_final_record_failed' }, 'Failed to append final record to JSONL file.');
                throw error;
            }
        } else {
            // --- Luồng mới: Lưu vào bộ nhớ thông qua service chuyên dụng ---
            this.resultCollector.add(record as InputRowData); // <<< SỬ DỤNG SERVICE MỚI
            logger.info({ event: 'append_final_record_to_memory_success' }, 'Successfully added final record to in-memory collector.');
        }
    }
}