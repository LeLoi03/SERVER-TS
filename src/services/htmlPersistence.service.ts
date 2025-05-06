// src/services/htmlPersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { BrowserContext } from 'playwright';
import { PlaywrightService } from './playwright.service';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { BatchProcessingService } from './batchProcesing.service'; // Correct service injected
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData } from '../types/crawl.types';
// Removed import for originalUpdateHTML

@singleton()
export class HtmlPersistenceService {
    private readonly logger: Logger;
    private browserContext: BrowserContext | null = null;
    private readonly year2: number; // Keep if needed elsewhere, otherwise remove

    // Shared state - batchIndexRef is still needed if SAVE and UPDATE share numbering
    private existingAcronyms: Set<string> = new Set(); // Keep for SAVE flow
    private batchIndexRef = { current: 1 };

    constructor(
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(ConfigService) private configService: ConfigService, // Keep for year2 or other config
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(BatchProcessingService) private batchProcessingService: BatchProcessingService // Correct service
    ) {
        this.logger = this.loggingService.getLogger({ service: 'HtmlPersistenceService' });
        this.year2 = this.configService.config.YEAR2; // Keep if needed
    }


    // Called by Orchestrator before processing tasks
    public setBrowserContext() {
        this.browserContext = this.playwrightService.getBrowserContext();
        this.logger.debug("BrowserContext set for HtmlPersistenceService.");
    }

    private getContext(): BrowserContext {
        if (!this.browserContext) {
            const errMsg = "BrowserContext not set in HtmlPersistenceService. Call setBrowserContext first.";
            this.logger.error(errMsg);
            throw new Error(errMsg);
        }
        return this.browserContext;
    }

     /**
     * Processes the UPDATE flow by delegating to BatchProcessingService.
     */
     async processUpdateFlow(conference: ConferenceUpdateData, taskLogger: Logger): Promise<boolean> {
        // Use taskLogger for context specific to this conference update task
        taskLogger.info({ event: 'process_update_start' }, `Processing UPDATE flow by delegating to BatchProcessingService`);

        try {
            // Delegate the entire update process for this conference
            // Await the result as update flow is expected to be synchronous within the task
            const success = await this.batchProcessingService.processConferenceUpdate(
                this.getContext(),      // Pass the browser context
                conference,             // Pass conference update data
                this.batchIndexRef      // Pass the shared batch index reference
                // Logger is handled internally by BatchProcessingService now
            );

            if (success) {
                taskLogger.info({ event: 'process_update_delegation_completed' }, 'BatchProcessingService.processConferenceUpdate completed successfully.');
            } else {
                taskLogger.warn({ event: 'process_update_delegation_failed' }, 'BatchProcessingService.processConferenceUpdate reported failure.');
            }
            return success; // Return the success status

        } catch (updateError: any) {
            taskLogger.error({ err: updateError, event: 'process_update_delegation_error' }, 'Error occurred while calling BatchProcessingService.processConferenceUpdate');
            return false; // Indicate failure
        }
    }


    /**
     * Processes the SAVE flow by delegating to BatchProcessingService.
     */
    async processSaveFlow(conference: ConferenceData, searchResultLinks: string[], taskLogger: Logger): Promise<void> {
        taskLogger.info({ linksCount: searchResultLinks.length, event: 'process_save_start' }, `Processing SAVE flow by delegating to BatchProcessingService`);

        if (searchResultLinks.length === 0) {
            taskLogger.warn({ event: 'process_save_skipped_no_links' }, "Skipping save flow as no search links were provided.");
            return; // Nothing to do
        }

        try {
            // Await the INITIATION of the process. The actual batch save runs async.
            const initiationSuccess = await this.batchProcessingService.processConferenceSave(
                this.getContext(),
                conference,
                searchResultLinks,
                this.batchIndexRef,
                this.existingAcronyms
            );

            if (initiationSuccess) {
                taskLogger.info({ event: 'process_save_delegation_initiated' }, 'BatchProcessingService.processConferenceSave initiated successfully (batch save running async).');
            } else {
                taskLogger.warn({ event: 'process_save_delegation_initiation_failed' }, 'BatchProcessingService.processConferenceSave reported failure during initiation.');
            }
        } catch (saveError: any) {
            taskLogger.error({ err: saveError, event: 'process_save_delegation_error' }, 'Error occurred while calling BatchProcessingService.processConferenceSave initiation');
        }
    }

    // Reset state (called by orchestrator before a new run)
    public resetState(): void {
        this.existingAcronyms.clear();
        this.batchIndexRef.current = 1;
        this.logger.info("HtmlPersistenceService state (existingAcronyms, batchIndexRef) reset.");
    }
}