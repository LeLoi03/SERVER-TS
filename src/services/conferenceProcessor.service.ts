// src/services/conferenceProcessor.service.ts
import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GoogleSearchService } from './googleSearch.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { FileSystemService } from './fileSystem.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, GoogleSearchResult, CrawlModelType } from '../types/crawl.types'; // ++ Thêm CrawlModelType
import { filterSearchResults } from '../utils/crawl/linkFiltering';

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

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GoogleSearchService) private googleSearchService: GoogleSearchService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'ConferenceProcessorBase' });
        this.searchQueryTemplate = this.configService.config.SEARCH_QUERY_TEMPLATE;
        this.year1 = this.configService.config.YEAR1;
        this.year2 = this.configService.config.YEAR2;
        this.year3 = this.configService.config.YEAR3;
        this.unwantedDomains = this.configService.config.UNWANTED_DOMAINS;
        this.skipKeywords = this.configService.config.SKIP_KEYWORDS;
        this.maxLinks = this.configService.config.MAX_LINKS;

        this.serviceBaseLogger.info("ConferenceProcessorService instance created.");
    }

    async process(
        conference: ConferenceData,
        taskIndex: number,
        parentLogger: Logger,
        crawlModel: CrawlModelType // ++ THAM SỐ MỚI
    ): Promise<void> {
        const confAcronym = conference?.Acronym || `UnknownAcronym-${taskIndex}`;
        const confTitle = conference?.Title || `UnknownTitle-${taskIndex}`;

        const taskLogger = parentLogger.child({
            processorTask: 'ConferenceProcessor',
            title: confTitle,
            acronym: confAcronym,
            taskIndex: taskIndex + 1,
            crawlModelUsed: crawlModel, // ++ LOG CRAWL MODEL
            event_group: 'conference_task_processing'
        });

        taskLogger.info({ event: 'task_start' }, `Processing conference task using ${crawlModel} model settings`);
        let taskSuccessfullyCompleted = true;
        let specificTaskError: any = null;

        try {
            const hasAllRequiredKeys = 'mainLink' in conference &&
                'cfpLink' in conference &&
                'impLink' in conference;

            if (hasAllRequiredKeys) {
                taskLogger.info({ event: 'update_flow_start' }, `Processing with pre-defined keys (UPDATE flow)`);
                const conferenceUpdateData: ConferenceUpdateData = {
                    Acronym: conference.Acronym,
                    Title: conference.Title,
                    mainLink: conference.mainLink ?? "",
                    cfpLink: conference.cfpLink ?? "",
                    impLink: conference.impLink ?? ""
                };
                // ++ TRUYỀN CRAWLMODEL XUỐNG
                const updateSuccess = await this.htmlPersistenceService.processUpdateFlow(conferenceUpdateData, taskLogger, crawlModel);
                taskLogger.info({ event: 'update_flow_finish', success: updateSuccess }, `Update flow finished.`);
                if (!updateSuccess) {
                    taskSuccessfullyCompleted = false;
                    specificTaskError = new Error("Update flow did not complete successfully.");
                }
            } else {
                taskLogger.info({ event: 'save_flow_start' }, `Searching and processing (SAVE flow)`);
                let searchResultsLinks: string[] = [];
                const searchQuery: string = this.searchQueryTemplate
                    .replace(/\${Title}/g, confTitle)
                    .replace(/\${Acronym}/g, confAcronym)
                    .replace(/\${Year2}/g, String(this.year2))
                    .replace(/\${Year3}/g, String(this.year3))
                    .replace(/\${Year1}/g, String(this.year1));

                try {
                    const searchResults: GoogleSearchResult[] = await this.googleSearchService.search(searchQuery, taskLogger);
                    const filteredResults = filterSearchResults(searchResults, this.unwantedDomains, this.skipKeywords);
                    const limitedResults = filteredResults.slice(0, this.maxLinks);
                    searchResultsLinks = limitedResults.map(res => res.link);
                    taskLogger.info({
                        searchQueryUsed: searchQuery,
                        rawResultsCount: searchResults.length,
                        filteredResultsCount: filteredResults.length,
                        limitedResultsCount: searchResultsLinks.length,
                        event: 'search_results_filtered'
                    }, `Filtered search results`);

                    const allLinks = searchResults.map(result => result.link);
                    await this.fileSystemService.writeCustomSearchResults(confAcronym, allLinks, taskLogger);
                } catch (searchError: any) {
                    taskLogger.error({ err: searchError, event: 'search_ultimately_failed_in_task' }, "Google Search failed for this conference, skipping save HTML step.");
                    searchResultsLinks = []; // Ensure it's empty so save flow is skipped
                }

                if (searchResultsLinks.length > 0) {
                    // ++ TRUYỀN CRAWLMODEL XUỐNG
                    const saveSuccess = await this.htmlPersistenceService.processSaveFlow(conference, searchResultsLinks, taskLogger, crawlModel);
                    if (saveSuccess === false) {
                        taskSuccessfullyCompleted = false;
                        specificTaskError = new Error("Save flow did not complete successfully (processSaveFlow returned false).");
                    }
                } else {
                    taskLogger.warn({ event: 'save_html_skipped_no_links_in_task' }, "Skipping save HTML step as no valid search links were found or processed.");
                    // Consider if this should mark the task as failed or just a partial success.
                    // For now, let's assume if we intended to save but couldn't get links, it's not a full success.
                    // Setting taskSuccessfullyCompleted = false will reflect this in the summary.
                    // If it's acceptable to have no links and still consider the task "done", then don't set this to false.
                    // Based on the original logic, "Save HTML step as no valid search links were found or processed." -> Error, so false is correct.
                    taskSuccessfullyCompleted = false;
                    specificTaskError = new Error("Save HTML step as no valid search links were found or processed.");
                }
            }
        } catch (taskError: any) {
            taskSuccessfullyCompleted = false;
            specificTaskError = taskError;
            taskLogger.error({ err: taskError, stack: taskError.stack, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
        } finally {
            const finishContext: { event: string; success?: boolean; error_details?: string } = { event: 'task_finish' };
            if (!specificTaskError && taskSuccessfullyCompleted) { // Only if truly no error AND explicitly completed
                finishContext.success = true;
            } else { // If there was any error or task didn't complete successfully
                finishContext.success = false;
                if (specificTaskError && !taskLogger.bindings().err) { // If specific error exists and no unhandled exception logged it
                     finishContext.error_details = specificTaskError instanceof Error ? specificTaskError.message : String(specificTaskError);
                } else if (taskLogger.bindings().err) { // If an unhandled exception already logged the error
                    // error_details is already part of the logger's bindings via taskLogger.error
                } else if (!specificTaskError && !taskSuccessfullyCompleted) { // Generic incompletion
                    finishContext.error_details = "Task did not complete successfully for an unspecified reason.";
                }
            }
            taskLogger.info(finishContext, `Finished processing conference task.`);
        }
    }
}