// src/services/batchProcessing/finalRecordAppender.service.ts

import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import path from 'path';
import { Logger } from 'pino';
// <<< THAY ĐỔI QUAN TRỌNG >>>
import { InMemoryResultCollectorService } from '../inMemoryResultCollector.service'; 
import { RequestStateService } from '../requestState.service';
import { BatchEntryWithIds, BatchUpdateDataWithIds, InputRowData } from '../../types/crawl';
import { ConfigService } from '../../config/config.service';
import { FileSystemService } from '../fileSystem.service';

type FinalRecord = BatchEntryWithIds | BatchUpdateDataWithIds;

export interface IFinalRecordAppenderService {
    // <<< THÊM THAM SỐ MỚI VÀO INTERFACE >>>
    append(
        record: FinalRecord, 
        batchRequestId: string, 
        logger: Logger, 
        requestStateService: RequestStateService,
        resultCollector: InMemoryResultCollectorService // <<< THAM SỐ MỚI
    ): Promise<void>;
}

@injectable()
export class FinalRecordAppenderService implements IFinalRecordAppenderService {
    constructor(
        @inject(ConfigService) private readonly configService: ConfigService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService
        // <<< XÓA INJECT COLLECTOR KHỎI CONSTRUCTOR >>>
    ) { }

    public async append(
        record: FinalRecord,
        batchRequestId: string,
        logger: Logger,
        requestStateService: RequestStateService,
        resultCollector: InMemoryResultCollectorService // <<< NHẬN COLLECTOR TỪ THAM SỐ
    ): Promise<void> {
        if (requestStateService.shouldRecordFiles()) {
            // Luồng ghi file giữ nguyên
            const finalJsonlPath = this.configService.getFinalOutputJsonlPathForBatch(batchRequestId);
            const jsonLine = JSON.stringify(record);
            try {
                await this.fileSystemService.appendFile(finalJsonlPath, jsonLine + '\n', logger);
                logger.info({ event: 'append_final_record_success' }, 'Successfully appended final record to JSONL file.');
            } catch (error) {
                logger.error({ err: error, event: 'append_final_record_failed' }, 'Failed to append final record to JSONL file.');
                throw error;
            }
        } else {
            // --- Luồng mới: Sử dụng collector được truyền vào ---
            resultCollector.add(record as InputRowData); // <<< SỬ DỤNG INSTANCE TỪ THAM SỐ
            logger.info({ event: 'append_final_record_to_memory_success' }, 'Successfully added final record to in-memory collector.');
        }
    }
}