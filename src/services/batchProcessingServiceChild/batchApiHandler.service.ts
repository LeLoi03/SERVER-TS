// src/services/batchApiHandler.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';

import { LoggingService } from '../logging.service'; // Adjust path
import { GeminiApiService } from '../geminiApi.service'; // Adjust path
import { FileSystemService } from '../fileSystem.service'; // Adjust path
import { IBatchApiHandlerService } from '../interfaces/batchApiHandler.interface'; // Adjust path
import { CrawlModelType } from '../../types/crawl';
import { GeminiApiParams } from '../../types/crawl';

@singleton()
export class BatchApiHandlerService implements IBatchApiHandlerService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(LoggingService) loggingService: LoggingService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        this.serviceLogger = loggingService.getLogger('main', { service: 'BatchApiHandlerService' });
        this.serviceLogger.info("BatchApiHandlerService constructed.");
    }

    public async executeFinalExtractionApis(
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
    }> {
        // Original function name was 'executeFinalExtractionApis'
        // The parentLogger already contains the context from the calling function (e.g., _executeBatchTaskForUpdate)
        // We create a child logger specific to this operation, maintaining the original function name if it's key for log analysis
        const logger = parentLogger.child({
            // batchServiceFunction: 'executeFinalExtractionApis', // This was from original, keep if needed for log analysis
            serviceScopedFunction: 'executeFinalExtractionApis', // New scope
            isUpdateContext: isUpdate,
            extractModelUsed: extractModel,
            cfpModelUsed: cfpModel,
            originalConferenceAcronym: originalAcronymForApis,
            fileNameBaseAcronym: safeConferenceAcronymForFiles
        });

        const suffix = isUpdate ? `_update_response_${batchItemIndex}` : `_response_${batchItemIndex}`;
        const extractFileBase = `${safeConferenceAcronymForFiles}_extract${suffix}`;
        const cfpFileBase = `${safeConferenceAcronymForFiles}_cfp${suffix}`;

        logger.info({ event: 'batch_processing_parallel_final_apis_start', flow: isUpdate ? 'update' : 'save' });

        const commonApiParams: Omit<GeminiApiParams, 'batch'> = {
            batchIndex: batchItemIndex,
            title: titleForApis,
            acronym: originalAcronymForApis,
        };

        const extractPromise = (async () => {
            const extractApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_EXTRACT });
            extractApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_extract_api_call_start' });
            try {
                const response = await this.geminiApiService.extractInformation(
                    { ...commonApiParams, batch: contentSendToAPI },
                    extractModel,
                    extractApiLogger
                );
                const pathValue = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", extractFileBase, extractApiLogger
                );
                extractApiLogger.info({ responseLength: response.responseText?.length, filePath: pathValue, event: 'batch_processing_final_extract_api_call_end', success: !!pathValue });
                return { responseTextPath: pathValue, metaData: response.metaData };
            } catch (error: any) {
                extractApiLogger.error({ err: error, event: 'batch_extract_api_call_failed', apiType: this.geminiApiService.API_TYPE_EXTRACT });
                return { responseTextPath: undefined, metaData: null };
            }
        })();

        const cfpPromise = (async () => {
            const cfpApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_CFP });
            cfpApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_cfp_api_call_start' });
            try {
                const response = await this.geminiApiService.extractCfp(
                    { ...commonApiParams, batch: contentSendToAPI },
                    cfpModel,
                    cfpApiLogger
                );
                const pathValue = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", cfpFileBase, cfpApiLogger
                );
                cfpApiLogger.info({ responseLength: response.responseText?.length, filePath: pathValue, event: 'batch_processing_final_cfp_api_call_end', success: !!pathValue });
                return { responseTextPath: pathValue, metaData: response.metaData };
            } catch (error: any) {
                cfpApiLogger.error({ err: error, event: 'batch_cfp_api_call_failed', apiType: this.geminiApiService.API_TYPE_CFP });
                return { responseTextPath: undefined, metaData: null };
            }
        })();

        const [extractResult, cfpResult] = await Promise.all([extractPromise, cfpPromise]);
        logger.info({
            event: 'batch_processing_parallel_final_apis_finished',
            extractSuccess: !!extractResult.responseTextPath,
            cfpSuccess: !!cfpResult.responseTextPath,
            flow: isUpdate ? 'update' : 'save'
        });
        if (!extractResult.responseTextPath && !cfpResult.responseTextPath) {
            logger.error({ event: 'batch_parallel_final_apis_both_failed', flow: isUpdate ? 'update' : 'save' });
        }
        return {
            extractResponseTextPath: extractResult.responseTextPath,
            extractMetaData: extractResult.metaData,
            cfpResponseTextPath: cfpResult.responseTextPath,
            cfpMetaData: cfpResult.metaData,
        };
    }
}