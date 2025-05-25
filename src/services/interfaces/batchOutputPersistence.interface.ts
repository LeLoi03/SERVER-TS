// src/services/interfaces/batchOutputPersistence.interface.ts
import { Logger } from 'pino';
import { BatchEntryWithIds, BatchUpdateDataWithIds } from '../../types/crawl/crawl.types'; // Adjust path as needed

export interface IBatchOutputPersistenceService {
    ensureDirectories(paths: string[], parentLogger: Logger): Promise<void>;

    appendFinalRecord(
        record: BatchEntryWithIds | BatchUpdateDataWithIds,
        batchRequestIdForFile: string,
        parentLogger: Logger
    ): Promise<void>;

    logBatchProcessingError(
        context: {
            conferenceAcronym: string | undefined;
            batchItemIndex: number | undefined;
            batchRequestId: string | undefined;
            flow: 'save' | 'update' | 'general';
        },
        error: any,
        parentLogger: Logger
    ): Promise<void>;
}