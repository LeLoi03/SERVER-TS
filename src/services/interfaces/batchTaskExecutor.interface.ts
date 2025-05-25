// src/services/interfaces/batchTaskExecutor.interface.ts
import { BrowserContext } from 'playwright';
import { Logger } from 'pino';
import { BatchEntry, BatchUpdateEntry, ApiModels } from '../../types/crawl/crawl.types'; // Adjust path

export interface IBatchTaskExecutorService {
    executeBatchTaskForUpdate(
        batchInput: BatchUpdateEntry,
        batchItemIndex: number,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>, // Passed from orchestrator
        parentLogger: Logger
    ): Promise<boolean>;

    executeBatchTaskForSave(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        primaryOriginalAcronymForInitialFilesPrefix: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>, // Passed from orchestrator
        parentLogger: Logger
    ): Promise<boolean>;
}