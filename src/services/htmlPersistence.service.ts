// src/services/htmlPersistence.service.ts
import 'reflect-metadata';
import { singleton, inject, DependencyContainer } from 'tsyringe'; // <<< THÊM DependencyContainer
import { BrowserContext } from 'playwright';
import { PlaywrightService } from './playwright.service';
import { LoggingService } from './logging.service';
import { BatchProcessingOrchestratorService } from './batchProcessingOrchestrator.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, ApiModels } from '../types/crawl/crawl.types';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility
import { RequestStateService } from './requestState.service';
import { InMemoryResultCollectorService } from './inMemoryResultCollector.service'; // <<< THÊM IMPORT

/**
 * Service responsible for managing HTML content persistence and delegating
 * to BatchProcessingOrchestratorService for further processing (crawling, AI extraction).
 * It acts as an intermediary, ensuring Playwright's BrowserContext is available
 * and handling the high-level logic for "update" and "save" flows.
 */
@singleton()
export class HtmlPersistenceService {
    private readonly serviceBaseLogger: Logger;
    private browserContext: BrowserContext | null = null; // Playwright BrowserContext

    /**
     * Constructs an instance of HtmlPersistenceService.
     * Dependencies are injected via tsyringe.
     * @param {PlaywrightService} playwrightService - Handles Playwright browser and context management.
     * @param {LoggingService} loggingService - Provides logging capabilities.
     * @param {BatchProcessingOrchestratorService} batchProcessingOrchestratorService - Orchestrates background batch processing of conferences.
     */
    constructor(
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(BatchProcessingOrchestratorService) private batchProcessingOrchestratorService: BatchProcessingOrchestratorService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'HtmlPersistenceServiceBase' });
        this.serviceBaseLogger.info({ event: 'html_persistence_init_success' }, "HtmlPersistenceService instance created.");
    }

    /**
     * Sets the Playwright BrowserContext for this service to use.
     * This method must be called after PlaywrightService has initialized the context.
     * @param {Logger} [parentLogger] - An optional parent logger for contextual logging.
     * @throws {Error} If unable to retrieve the BrowserContext from PlaywrightService.
     */
    public setBrowserContext(parentLogger?: Logger): void {
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.setBrowserContext' }) : this.serviceBaseLogger;
        try {
            this.browserContext = this.playwrightService.getBrowserContext(logger);
            logger.debug({ event: 'browser_context_set' }, "BrowserContext successfully set for HtmlPersistenceService.");
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'html_persistence_set_context_failed', reason: 'Failed to get browser context from PlaywrightService' }, `Failed to set BrowserContext: "${errorMessage}".`);
            throw error; // Re-throw to propagate critical error
        }
    }

    /**
     * Internal helper to ensure BrowserContext is available before use.
     * @param {Logger} logger - The logger instance (must be provided).
     * @returns {BrowserContext} The Playwright BrowserContext.
     * @throws {Error} If BrowserContext has not been set.
     */
    private getContext(logger: Logger): BrowserContext {
        if (!this.browserContext) {
            const errMsg = "BrowserContext not set in HtmlPersistenceService. Call setBrowserContext() first.";
            logger.fatal({ internalError: errMsg, event: 'browser_context_not_available' }, errMsg);
            throw new Error(errMsg);
        }
        return this.browserContext;
    }

    /**
     * Processes the "UPDATE" flow for a conference. This involves taking pre-defined links
     * and delegating to BatchProcessingOrchestratorService to crawl and extract information from them.
     *
     * @param {ConferenceUpdateData} conference - The conference data including pre-defined links.
     * @param {Logger} taskLogger - The logger instance specific to the current conference task.
     * @param {ApiModels} apiModels - An object specifying which model type ('tuned' or 'non-tuned') to use for AI API stages.
     * @returns {Promise<boolean>} A Promise that resolves to true if the update flow was successfully delegated and processed, false otherwise.
     */
    async processUpdateFlow(
        conference: ConferenceUpdateData,
        taskLogger: Logger,
        apiModels: ApiModels,
        requestStateService: RequestStateService,
        requestContainer: DependencyContainer,
        resultCollector: InMemoryResultCollectorService // <<< THÊM THAM SỐ MỚI


    ): Promise<boolean> {
        const flowLogger = taskLogger.child({
            persistenceFlow: 'update',
            apiModelsUsed: apiModels,
        });
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        flowLogger.info({ event: 'process_update_start' }, `Initiating UPDATE flow for conference "${conference.Acronym}" using API models (${modelsDesc}).`);

        try {
            // Delegate to BatchProcessingOrchestratorService for the actual update logic.
            // It will manage the crawling, parsing, and AI extraction from the provided links.
            const success = await this.batchProcessingOrchestratorService.processConferenceUpdate(
                this.getContext(flowLogger), // Ensure context is available
                conference,
                flowLogger,
                apiModels, // Pass ApiModels to BatchProcessingOrchestratorService
                requestStateService, // <<< Truyền xuống
                requestContainer,
                resultCollector // <<< TRUYỀN COLLECTOR VÀO ĐÂY


            );

            if (success) {
                flowLogger.info({ event: 'process_update_delegation_completed', success: true }, 'BatchProcessingOrchestratorService.processConferenceUpdate completed successfully.');
            } else {
                flowLogger.warn({ event: 'process_update_delegation_failed', success: false }, 'BatchProcessingOrchestratorService.processConferenceUpdate reported failure for this conference.');
            }
            return success;

        } catch (updateError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(updateError);
            flowLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'process_update_delegation_error' }, `Error occurred while delegating to BatchProcessingOrchestratorService.processConferenceUpdate: "${errorMessage}".`);
            return false; // Indicate failure
        }
    }

    /**
     * Processes the "SAVE" flow for a conference. This involves taking initial search result links,
     * crawling them, determining relevant sub-links (CFP, important dates), and then extracting
     * detailed information using AI models. This is typically an asynchronous background operation.
     *
     * @param {ConferenceData} conference - The initial conference data.
     * @param {string[]} searchResultLinks - An array of initial search result URLs to crawl.
     * @param {Logger} taskLogger - The logger instance specific to the current conference task.
     * @param {ApiModels} apiModels - An object specifying which model type ('tuned' or 'non-tuned') to use for AI API stages.
     * @returns {Promise<boolean>} A Promise that resolves to true if the save flow was successfully initiated (batch operation started), false otherwise.
     */
    async processSaveFlow(
        conference: ConferenceData,
        searchResultLinks: string[],
        taskLogger: Logger,
        apiModels: ApiModels,
        requestStateService: RequestStateService, // <<< THÊM THAM SỐ MỚI
        requestContainer: DependencyContainer,
        resultCollector: InMemoryResultCollectorService // <<< THÊM THAM SỐ MỚI


    ): Promise<boolean> {
        const flowLogger = taskLogger.child({
            persistenceFlow: 'save',
            apiModelsUsed: apiModels, // Log the models for this flow
        });
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        flowLogger.info({ linksCount: searchResultLinks.length, event: 'process_save_start' }, `Initiating SAVE flow for conference "${conference.Acronym}" with ${searchResultLinks.length} links (using API models: ${modelsDesc}).`);

        if (searchResultLinks.length === 0) {
            flowLogger.warn({ event: 'process_save_skipped_no_links' }, "Skipping SAVE flow as no search result links were provided. Cannot proceed.");
            return false;
        }

        try {
            // Delegate to BatchProcessingOrchestratorService to process the conference by crawling the search result links.
            // This method initiates an asynchronous operation managed by BatchProcessingOrchestratorService's internal queue.
            const initiationSuccess = await this.batchProcessingOrchestratorService.processConferenceSave(
                this.getContext(flowLogger), // Ensure context is available
                conference,
                searchResultLinks,
                flowLogger,
                apiModels,
                requestStateService,// <<< Truyền xuống
                requestContainer,
                resultCollector // <<< TRUYỀN COLLECTOR VÀO ĐÂY


            );

            if (initiationSuccess === true) {
                flowLogger.info({ event: 'process_save_delegation_initiated', success: true }, 'BatchProcessingOrchestratorService.processConferenceSave initiated successfully (batch save running asynchronously).');
                return true;
            } else {
                flowLogger.warn({ event: 'process_save_delegation_initiation_failed', success: false }, 'BatchProcessingOrchestratorService.processConferenceSave reported failure during initiation. Check BatchProcessingOrchestratorService logs for details.');
                return false;
            }
        } catch (saveError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(saveError);
            flowLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'process_save_delegation_error' }, `Error occurred while delegating to BatchProcessingOrchestratorService.processConferenceSave: "${errorMessage}".`);
            return false; // Indicate failure
        }
    }

    /**
     * Resets any local state managed by HtmlPersistenceService.
     * Currently, this service holds no complex local state that needs explicit resetting beyond `browserContext`.
     * @param {Logger} [parentLogger] - An optional parent logger for contextual logging.
     * @returns {void}
     */
    public resetState(parentLogger?: Logger): void {
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.resetState' }) : this.serviceBaseLogger;
        // The browserContext is managed by PlaywrightService lifecycle, so we don't explicitly reset it here.
        // It becomes null on PlaywrightService.close().
        logger.info({ event: 'html_persistence_reset_state_noop' }, "HtmlPersistenceService: No complex local state to reset. Browser context is managed by PlaywrightService.");
    }
}