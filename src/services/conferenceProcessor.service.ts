// src/services/conferenceProcessor.service.ts
import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GoogleSearchService } from './googleSearch.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { FileSystemService } from './fileSystem.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, GoogleSearchResult, CrawlModelType } from '../types/crawl.types';
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

    // ++ MODIFIED: Added crawlModel and batchRequestId parameters
    async process(
        conference: ConferenceData, // Can contain originalRequestId
        taskIndex: number,
        parentLogger: Logger, // This logger already contains the batchRequestId from orchestrator
        crawlModel: CrawlModelType,
        batchRequestId: string // Explicitly passed for clarity and potential direct use
    ): Promise<void> { // Consider returning ProcessedRowData if this service is responsible for creating it
        const confAcronym = conference?.Acronym || `UnknownAcronym-${taskIndex}`;
        const confTitle = conference?.Title || `UnknownTitle-${taskIndex}`;

        // parentLogger đã chứa batchRequestId.
        // taskLogger sẽ kế thừa batchRequestId và thêm context của task này.
        const taskLogger = parentLogger.child({
            processorTask: 'ConferenceProcessor',
            title: confTitle,
            acronym: confAcronym,
            taskIndex: taskIndex + 1,
            crawlModelUsed: crawlModel,
            // batchRequestId sẽ được kế thừa từ parentLogger
            originalRequestId: conference.originalRequestId, // Log originalRequestId if present
            event_group: 'conference_task_processing'
        });

        // Tạo một ID duy nhất cho lần xử lý cụ thể này của item (nếu cần thiết cho ProcessedRowData)
        // const currentItemProcessingId = `${batchRequestId}-item-${taskIndex}`;
        // taskLogger.info({ currentItemProcessingId }, "Generated current item processing ID.");


        if (conference.originalRequestId) {
            taskLogger.info({ event: 'recrawl_detected', originalRequestId: conference.originalRequestId },
                `This is a re-crawl task for an item from original request: ${conference.originalRequestId}`);
        }

        taskLogger.info({ event: 'task_start' }, `Processing conference task using ${crawlModel} model`);
        let taskSuccessfullyCompleted = true;
        let specificTaskError: any = null;
        // let processedDataForThisItem: Partial<ProcessedRowData> = { // Example if returning data
        //     inputConference: conference,
        //     newRequestId: currentItemProcessingId, // ID for this specific processing attempt
        // };

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
                    // Nếu cần, có thể thêm originalRequestId vào ConferenceUpdateData
                };
                // ++ TRUYỀN CRAWLMODEL và taskLogger (chứa batchRequestId) XUỐNG
                const updateSuccess = await this.htmlPersistenceService.processUpdateFlow(
                    conferenceUpdateData,
                    taskLogger, // taskLogger chứa thông tin batchRequestId và originalRequestId
                    crawlModel
                );
                taskLogger.info({ event: 'update_flow_finish', success: updateSuccess }, `Update flow finished.`);
                if (!updateSuccess) {
                    taskSuccessfullyCompleted = false;
                    specificTaskError = new Error("Update flow did not complete successfully.");
                    // processedDataForThisItem.status = 'error';
                    // processedDataForThisItem.message = "Update flow failed.";
                } else {
                    // processedDataForThisItem.status = 'success';
                    // processedDataForThisItem.message = "Update flow successful.";
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
                    // GoogleSearchService cũng nên nhận taskLogger
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
                    // FileSystemService cũng nên nhận taskLogger
                    await this.fileSystemService.writeCustomSearchResults(confAcronym, allLinks, taskLogger);
                } catch (searchError: any) {
                    taskLogger.error({ err: searchError, event: 'search_ultimately_failed_in_task' }, "Google Search failed for this conference, skipping save HTML step.");
                    searchResultsLinks = [];
                    // taskSuccessfullyCompleted = false; // Quyết định xem search lỗi có làm task fail không
                    // specificTaskError = searchError;
                    // processedDataForThisItem.status = 'error';
                    // processedDataForThisItem.message = `Google Search failed: ${searchError.message}`;
                }

                if (searchResultsLinks.length > 0) {
                    // ++ TRUYỀN CRAWLMODEL và taskLogger XUỐNG
                    const saveSuccess = await this.htmlPersistenceService.processSaveFlow(
                        conference, // conference object (có thể chứa originalRequestId)
                        searchResultsLinks,
                        taskLogger, // taskLogger chứa thông tin batchRequestId và originalRequestId
                        crawlModel
                    );
                    if (saveSuccess === false) {
                        taskSuccessfullyCompleted = false;
                        specificTaskError = new Error("Save flow did not complete successfully (processSaveFlow returned false).");
                        // processedDataForThisItem.status = 'error';
                        // processedDataForThisItem.message = "Save flow failed.";
                    } else {
                        // processedDataForThisItem.status = 'success';
                        // processedDataForThisItem.message = "Save flow successful.";
                    }
                } else {
                    taskLogger.warn({ event: 'save_html_skipped_no_links_in_task' }, "Skipping save HTML step as no valid search links were found or processed.");
                    taskSuccessfullyCompleted = false; // Như logic gốc
                    specificTaskError = new Error("Save HTML step as no valid search links were found or processed.");
                    // processedDataForThisItem.status = 'skipped'; // Hoặc 'error' tùy theo yêu cầu
                    // processedDataForThisItem.message = "Skipped save HTML: No valid links.";
                }
            }
        } catch (taskError: any) {
            taskSuccessfullyCompleted = false;
            specificTaskError = taskError;
            taskLogger.error({ err: taskError, stack: taskError.stack, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
            // processedDataForThisItem.status = 'error';
            // processedDataForThisItem.message = `Unhandled error: ${taskError.message}`;
        } finally {
            const finishContext: { event: string; success?: boolean; error_details?: string } = { event: 'task_finish' };
            if (!specificTaskError && taskSuccessfullyCompleted) {
                finishContext.success = true;
            } else {
                finishContext.success = false;
                if (specificTaskError && !taskLogger.bindings().err) {
                     finishContext.error_details = specificTaskError instanceof Error ? specificTaskError.message : String(specificTaskError);
                } else if (taskLogger.bindings().err) {
                    // No need to set, already in logger
                } else if (!specificTaskError && !taskSuccessfullyCompleted) {
                    finishContext.error_details = "Task did not complete successfully for an unspecified reason.";
                }
            }
            taskLogger.info(finishContext, `Finished processing conference task.`);
            // if (this service is responsible for returning ProcessedRowData)
            // return processedDataForThisItem as ProcessedRowData;
        }
        // If CrawlOrchestratorService's TaskQueue expects a Promise<void>, keep it this way.
        // If TaskQueue expects Promise<ProcessedRowData>, then this method should return processedDataForThisItem.
    }
}