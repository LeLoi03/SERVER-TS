// src/services/htmlPersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { BrowserContext } from 'playwright';
import { PlaywrightService } from './playwright.service';
import { LoggingService } from './logging.service';
import { BatchProcessingService } from './batchProcessing.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData } from '../types/crawl.types';
import { CrawlModelType, ApiModels } from '../types/crawl.types';
// -----------------------------------------------------------------------

@singleton()
export class HtmlPersistenceService {
    private readonly serviceBaseLogger: Logger;
    private browserContext: BrowserContext | null = null;

    constructor(
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(BatchProcessingService) private batchProcessingService: BatchProcessingService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'HtmlPersistenceServiceBase' });
        this.serviceBaseLogger.info("HtmlPersistenceService instance created.");
    }

    public setBrowserContext(parentLogger?: Logger) {
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.setBrowserContext' }) : this.serviceBaseLogger;
        try {
            this.browserContext = this.playwrightService.getBrowserContext(logger);
            logger.debug("BrowserContext set for HtmlPersistenceService.");
        } catch (error) {
            logger.error({ err: error, event: 'htmlpersistence_set_context_failed', reason: 'Failed to get browser context from PlaywrightService' }, "Failed to get browser context in HtmlPersistenceService.");
            throw error;
        }
    }

    private getContext(logger: Logger): BrowserContext {
        if (!this.browserContext) {
            const errMsg = "BrowserContext not set in HtmlPersistenceService. Call setBrowserContext first.";
            logger.error({ internalError: errMsg }, "BrowserContext not available.");
            throw new Error(errMsg);
        }
        return this.browserContext;
    }

    async processUpdateFlow(
        conference: ConferenceUpdateData,
        taskLogger: Logger,
        apiModels: ApiModels // << THAY ĐỔI Ở ĐÂY
    ): Promise<boolean> {
        const flowLogger = taskLogger.child({
            persistenceFlow: 'update',
        });
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        flowLogger.info({ event: 'process_update_start' }, `Processing UPDATE flow (using API models: ${modelsDesc})`);

        try {
            // Giả sử BatchProcessingService.processConferenceUpdate được cập nhật để nhận ApiModels
            const success = await this.batchProcessingService.processConferenceUpdate(
                this.getContext(flowLogger),
                conference,
                flowLogger,
                apiModels // << TRUYỀN ApiModels
            );

            if (success) {
                flowLogger.info({ event: 'process_update_delegation_completed' }, 'BatchProcessingService.processConferenceUpdate completed successfully.');
            } else {
                flowLogger.warn({ event: 'process_update_delegation_failed' }, 'BatchProcessingService.processConferenceUpdate reported failure.');
            }
            return success;

        } catch (updateError: any) {
            flowLogger.error({ err: updateError, event: 'process_update_delegation_error' }, 'Error occurred while calling BatchProcessingService.processConferenceUpdate');
            return false;
        }
    }

    async processSaveFlow(
        conference: ConferenceData,
        searchResultLinks: string[],
        taskLogger: Logger,
        apiModels: ApiModels // << THAY ĐỔI Ở ĐÂY
    ): Promise<boolean> {
        const flowLogger = taskLogger.child({
            persistenceFlow: 'save',
            apiModelsUsed: apiModels // << Log object models
        });
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        flowLogger.info({ linksCount: searchResultLinks.length, event: 'process_save_start' }, `Processing SAVE flow (using API models: ${modelsDesc}) by delegating to BatchProcessingService`);

        if (searchResultLinks.length === 0) {
            flowLogger.warn({ event: 'process_save_skipped_no_links' }, "Skipping save flow as no search links were provided.");
            return false;
        }

        try {
            // Giả sử BatchProcessingService.processConferenceSave được cập nhật để nhận ApiModels
            const initiationSuccess = await this.batchProcessingService.processConferenceSave(
                this.getContext(flowLogger),
                conference,
                searchResultLinks,
                flowLogger,
                apiModels // << TRUYỀN ApiModels
            );

            if (initiationSuccess === true) {
                flowLogger.info({ event: 'process_save_delegation_initiated' }, 'BatchProcessingService.processConferenceSave initiated successfully (batch save running async).');
                return true;
            } else {
                flowLogger.warn({ event: 'process_save_delegation_initiation_failed' }, 'BatchProcessingService.processConferenceSave reported failure during initiation.');
                return false;
            }
        } catch (saveError: any) {
            flowLogger.error({ err: saveError, event: 'process_save_delegation_error' }, 'Error occurred while calling BatchProcessingService.processConferenceSave initiation');
            return false;
        }
    }

     public resetState(parentLogger?: Logger): void {
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.resetState' }) : this.serviceBaseLogger;
        logger.info("HtmlPersistenceService: No local state to reset.");
    }
}