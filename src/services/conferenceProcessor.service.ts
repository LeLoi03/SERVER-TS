// src/services/conferenceProcessor.service.ts
import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GoogleSearchService } from './googleSearch.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { FileSystemService } from './fileSystem.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, GoogleSearchResult, ApiModels } from '../types/crawl.types';
import { filterSearchResults } from '../utils/crawl/linkFiltering'; // Corrected import path
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Service responsible for processing a single conference item.
 * It handles either the "SAVE" flow (search, crawl, determine links, extract info, extract cfp)
 * or the "UPDATE" flow (crawl pre-defined links, extract info, extract cfp).
 * This service integrates with Google Search, Playwright (via HtmlPersistenceService),
 * and AI API services (via HtmlPersistenceService).
 */
@injectable()
export class ConferenceProcessorService {
    private readonly searchQueryTemplate: string;
    private readonly year1: number;
    private readonly year2: number;
    private readonly year3: number;
    private readonly unwantedDomains: string[];
    private readonly skipKeywords: string[];
    private readonly maxLinks: number;
    private readonly serviceBaseLogger: Logger;

    /**
     * Constructs an instance of ConferenceProcessorService.
     * Dependencies are injected via tsyringe.
     * @param {ConfigService} configService - Service for application configuration.
     * @param {LoggingService} loggingService - Service for logging operations.
     * @param {GoogleSearchService} googleSearchService - Handles Google Custom Search API calls.
     * @param {HtmlPersistenceService} htmlPersistenceService - Manages HTML content saving and processing.
     * @param {FileSystemService} fileSystemService - Manages file and directory operations.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GoogleSearchService) private googleSearchService: GoogleSearchService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'ConferenceProcessorBase' });
        // Retrieve configuration values
        this.searchQueryTemplate = this.configService.config.SEARCH_QUERY_TEMPLATE;
        this.year1 = this.configService.config.YEAR1;
        this.year2 = this.configService.config.YEAR2;
        this.year3 = this.configService.config.YEAR3;
        this.unwantedDomains = this.configService.config.UNWANTED_DOMAINS;
        this.skipKeywords = this.configService.config.SKIP_KEYWORDS;
        this.maxLinks = this.configService.config.MAX_LINKS;

        this.serviceBaseLogger.info("ConferenceProcessorService instance created and initialized with configurations.");
    }

    /**
     * Processes a single conference item, either by performing a search and crawl (SAVE flow)
     * or by processing pre-defined links (UPDATE flow).
     *
     * @param {ConferenceData} conference - The conference data to process.
     * @param {number} taskIndex - The index of the task within the current batch (0-based).
     * @param {Logger} parentLogger - The parent Pino logger instance (e.g., from CrawlOrchestrator).
     * @param {ApiModels} apiModels - An object specifying which model type ('tuned' or 'non-tuned') to use for each AI API stage.
     * @param {string} batchRequestId - The unique identifier for the current batch processing request.
     * @returns {Promise<void>} A Promise that resolves when the conference processing is complete for this item.
     * @throws {Error} If a critical unrecoverable error occurs during processing this specific conference.
     */
    async process(
        conference: ConferenceData,
        taskIndex: number,
        parentLogger: Logger,
        apiModels: ApiModels,
        batchRequestId: string
    ): Promise<void> {
        // Use provided conference acronym and title, or fallback if undefined/null
        const confAcronym = conference?.Acronym || `UnknownAcronym-${taskIndex}`;
        const confTitle = conference?.Title || `UnknownTitle-${taskIndex}`;

        // Create a child logger for this specific conference task, inheriting parent's context
        const taskLogger = parentLogger.child({
            processorTask: 'ConferenceProcessor',
            conferenceAcronym: confAcronym, // Ensure acronym is bound to this task's logs
            conferenceTitle: confTitle,   // Ensure title is bound to this task's logs
            taskIndex: taskIndex + 1, // 1-based index for logging clarity
            event_group: 'conference_task_processing',
            batchRequestId: batchRequestId, // Explicitly bind batchRequestId
            originalRequestId: conference.originalRequestId, // Bind originalRequestId if present
        });

        if (conference.originalRequestId) {
            taskLogger.info({ event: 'recrawl_detected', originalRequestId: conference.originalRequestId },
                `Detected re-crawl task for item from original request ID: ${conference.originalRequestId}.`);
        }

        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        taskLogger.info({ event: 'task_start', modelsUsed: modelsDesc }, `Starting processing for conference: "${confTitle}" (${confAcronym}) using API models (${modelsDesc}).`);

        let taskSuccessfullyCompleted = true; // Flag to track overall success of this task
        let specificTaskError: Error | null = null; // Store specific error for `finally` block and potential re-throw

        try {
            // Check if the conference data already contains mainLink, cfpLink, and impLink
            // This determines whether to run the "UPDATE" flow or the "SAVE" flow.
            const hasAllRequiredLinksForUpdate = typeof conference.mainLink === 'string' && conference.mainLink.trim() !== '' &&
                                                typeof conference.cfpLink === 'string' && conference.cfpLink.trim() !== '' &&
                                                typeof conference.impLink === 'string' && conference.impLink.trim() !== '';

            if (hasAllRequiredLinksForUpdate) {
                taskLogger.info({ event: 'update_flow_start' }, `Conference item has pre-defined links. Initiating UPDATE flow.`);
                const conferenceUpdateData: ConferenceUpdateData = {
                    Acronym: conference.Acronym,
                    Title: conference.Title,
                    mainLink: conference.mainLink as string, // Cast after type check
                    cfpLink: conference.cfpLink as string,
                    impLink: conference.impLink as string,
                    originalRequestId: conference.originalRequestId,
                };

                // Call HtmlPersistenceService to process the update flow.
                // It will handle fetching content from these links and calling AI for extraction.
                const updateSuccess = await this.htmlPersistenceService.processUpdateFlow(
                    conferenceUpdateData,
                    taskLogger,
                    apiModels // Pass the ApiModels object
                );

                if (!updateSuccess) {
                    taskSuccessfullyCompleted = false;
                    specificTaskError = new Error(`Update flow did not complete successfully for "${confTitle}" (${confAcronym}).`);
                    taskLogger.error({ event: 'update_flow_failed', error: specificTaskError.message }, `Update flow failed for conference. Result: ${specificTaskError.message}.`);
                } else {
                    taskLogger.info({ event: 'update_flow_finish', success: updateSuccess }, `Update flow finished successfully for conference.`);
                }
            } else {
                taskLogger.info({ event: 'save_flow_start' }, `Conference item requires search and processing. Initiating SAVE flow.`);

                let searchResultsLinks: string[] = [];
                // Construct the search query using the template and conference data
                const searchQuery: string = this.searchQueryTemplate
                    .replace(/\${Title}/g, confTitle)
                    .replace(/\${Acronym}/g, confAcronym)
                    .replace(/\${Year2}/g, String(this.year2))
                    .replace(/\${Year3}/g, String(this.year3))
                    .replace(/\${Year1}/g, String(this.year1));

                try {
                    // Perform Google search and filter results
                    const searchResults: GoogleSearchResult[] = await this.googleSearchService.search(searchQuery, taskLogger);
                    const filteredResults = filterSearchResults(searchResults, this.unwantedDomains, this.skipKeywords);
                    const limitedResults = filteredResults.slice(0, this.maxLinks);
                    searchResultsLinks = limitedResults.map(res => res.link);

                    taskLogger.info({
                        searchQueryUsed: searchQuery,
                        rawResultsCount: searchResults.length,
                        filteredResultsCount: filteredResults.length,
                        limitedResultsCount: searchResultsLinks.length,
                        event: 'search_and_filter_completed'
                    }, `Google search and filtering completed. Found ${searchResultsLinks.length} relevant links.`);

                    // Optionally write all original search results to a file for debugging/analysis
                    const allOriginalLinks = searchResults.map(result => result.link);
                    await this.fileSystemService.writeCustomSearchResults(confAcronym, allOriginalLinks, taskLogger);

                } catch (searchError: unknown) { // Catch as unknown
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(searchError);
                    taskLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'search_failed_for_task' }, `Google Search failed for this conference: "${errorMessage}". Skipping HTML saving.`);
                    searchResultsLinks = []; // Clear links to ensure save HTML step is skipped
                    specificTaskError = new Error(`Google Search failed: ${errorMessage}`);
                    taskSuccessfullyCompleted = false;
                }

                if (searchResultsLinks.length > 0) {
                    // Call HtmlPersistenceService to process the save flow.
                    // This involves crawling the links, determining relevant sub-links (CFP, IMP)
                    // and then extracting content using AI models.
                    const saveSuccess = await this.htmlPersistenceService.processSaveFlow(
                        conference,
                        searchResultsLinks,
                        taskLogger,
                        apiModels // Pass the ApiModels object
                    );
                    if (saveSuccess === false) {
                        taskSuccessfullyCompleted = false;
                        specificTaskError = new Error(`Save flow did not complete successfully for "${confTitle}" (${confAcronym}) (processSaveFlow returned false).`);
                        taskLogger.error({ event: 'save_flow_failed', error: specificTaskError.message }, `Save flow failed for conference. Result: ${specificTaskError.message}.`);
                    } else {
                        taskLogger.info({ event: 'save_flow_finish', success: saveSuccess }, `Save flow finished successfully for conference.`);
                    }
                } else {
                    taskLogger.warn({ event: 'save_html_skipped_no_links_found' }, "Skipping HTML saving and AI extraction as no valid search links were found or processed for this conference.");
                    taskSuccessfullyCompleted = false; // Mark task as not fully successful if search failed
                    if (!specificTaskError) { // Only set if not already set by search failure
                        specificTaskError = new Error("No valid search links found to process.");
                    }
                }
            }
        } catch (taskError: unknown) { // Catch any unhandled errors in the processing logic as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(taskError);
            taskSuccessfullyCompleted = false;
            specificTaskError = taskError instanceof Error ? taskError : new Error(errorMessage); // Ensure it's an Error object if storing/re-throwing
            taskLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'task_unhandled_exception' }, `An unhandled exception occurred during conference processing for "${confTitle}" (${confAcronym}).`);
        } finally {
            // Log final status of the task
            const finishContext: { event: string; success: boolean; error_details?: string } = {
                event: 'task_finish',
                success: taskSuccessfullyCompleted,
            };
            if (specificTaskError) {
                // If specificTaskError is present and it hasn't been fully logged as `err` property yet
                if (!taskLogger.bindings().err) {
                    finishContext.error_details = specificTaskError.message;
                }
                // If it was already logged as `err` by taskLogger.error, no need to duplicate message
            } else if (!taskSuccessfullyCompleted) {
                // This case should ideally not happen if specificTaskError is managed correctly,
                // but as a fallback for robustness.
                finishContext.error_details = "Task did not complete successfully for an unspecified reason.";
            }
            taskLogger.info(finishContext, `Finished processing conference task for "${confTitle}" (${confAcronym}).`);
        }
    }
}