// src/services/interfaces/batchApiHandler.interface.ts
import { Logger } from 'pino';
import { CrawlModelType } from '../../types/crawl/crawl.types'; // Adjust path

export interface IBatchApiHandlerService {
    executeFinalExtractionApis(
        contentSendToAPI: string,
        batchItemIndex: number,
        titleForApis: string,
        originalAcronymForApis: string,
        safeConferenceAcronymForFiles: string,
        isUpdate: boolean,
        extractModel: CrawlModelType,
        cfpModel: CrawlModelType,
        parentLogger: Logger
    ): Promise<{
        extractResponseTextPath?: string;
        extractMetaData: any | null;
        cfpResponseTextPath?: string;
        cfpMetaData: any | null;
    }>;
}