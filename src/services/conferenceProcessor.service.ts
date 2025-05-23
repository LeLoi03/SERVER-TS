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
import { filterSearchResults } from '../utils/crawl/linkFiltering';
import { getErrorMessageAndStack } from '../utils/errorUtils';

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

        this.serviceBaseLogger.info("ConferenceProcessorService instance created and initialized with configurations.");
    }

    async process(
        conference: ConferenceData,
        taskIndex: number,
        parentLogger: Logger,
        apiModels: ApiModels,
        batchRequestId: string
    ): Promise<void> {
        const confAcronym = conference?.Acronym || `UnknownAcronym-${taskIndex}`;
        const confTitle = conference?.Title || `UnknownTitle-${taskIndex}`;

        // *************** ĐIỀU CHỈNH CHÍNH Ở ĐÂY ***************
        // Kiểm tra xem các thuộc tính có tồn tại trong đối tượng 'conference' hay không.
        // Bất kể giá trị của chúng là gì (string, null, rỗng, v.v.), chỉ cần chúng có mặt.
        const hasAllRequiredLinksProvided = 'mainLink' in conference &&
                                            'cfpLink' in conference &&
                                            'impLink' in conference;

        const crawlType = hasAllRequiredLinksProvided ? "update" : "crawl";
        // *******************************************************

        const taskLogger = parentLogger.child({
            processorTask: 'ConferenceProcessor',
            conferenceAcronym: confAcronym,
            conferenceTitle: confTitle,
            taskIndex: taskIndex + 1,
            event_group: 'conference_task_processing',
            batchRequestId: batchRequestId,
            originalRequestId: conference.originalRequestId,
            crawlType: crawlType,
        });

        if (conference.originalRequestId) {
            taskLogger.info({ event: 'recrawl_detected', originalRequestId: conference.originalRequestId },
                `Detected re-crawl task for item from original request ID: ${conference.originalRequestId}.`);
        }

        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        taskLogger.info({ event: 'task_start', modelsUsed: modelsDesc }, `Starting processing for conference: "${confTitle}" (${confAcronym}) using API models (${modelsDesc}).`);

        let taskSuccessfullyCompleted = true;
        let specificTaskError: Error | null = null;

        try {
            // *************** SỬ DỤNG BIẾN ĐIỀU CHỈNH ***************
            if (hasAllRequiredLinksProvided) {
            // *******************************************************
                taskLogger.info({ event: 'update_flow_start' }, `Conference item has pre-defined links. Initiating UPDATE flow.`);
                const conferenceUpdateData: ConferenceUpdateData = {
                    Acronym: conference.Acronym,
                    Title: conference.Title,
                    // Ép kiểu an toàn hơn nếu bạn chắc chắn các thuộc tính tồn tại
                    mainLink: conference.mainLink as string | null, // Có thể là string, null hoặc undefined tùy theo dữ liệu gốc
                    cfpLink: conference.cfpLink as string | null,
                    impLink: conference.impLink as string | null,
                    originalRequestId: conference.originalRequestId,
                };

                const updateSuccess = await this.htmlPersistenceService.processUpdateFlow(
                    conferenceUpdateData,
                    taskLogger,
                    apiModels
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
                        event: 'search_and_filter_completed'
                    }, `Google search and filtering completed. Found ${searchResultsLinks.length} relevant links.`);

                    const allOriginalLinks = searchResults.map(result => result.link);
                    await this.fileSystemService.writeCustomSearchResults(confAcronym, allOriginalLinks, taskLogger);

                } catch (searchError: unknown) {
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(searchError);
                    taskLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'search_failed_for_task' }, `Google Search failed for this conference: "${errorMessage}". Skipping HTML saving.`);
                    searchResultsLinks = [];
                    specificTaskError = new Error(`Google Search failed: ${errorMessage}`);
                    taskSuccessfullyCompleted = false;
                }

                if (searchResultsLinks.length > 0) {
                    const saveSuccess = await this.htmlPersistenceService.processSaveFlow(
                        conference,
                        searchResultsLinks,
                        taskLogger,
                        apiModels
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
                    taskSuccessfullyCompleted = false;
                    if (!specificTaskError) {
                        specificTaskError = new Error("No valid search links found to process.");
                    }
                }
            }
        } catch (taskError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(taskError);
            taskSuccessfullyCompleted = false;
            specificTaskError = taskError instanceof Error ? taskError : new Error(errorMessage);
            taskLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'task_unhandled_exception' }, `An unhandled exception occurred during conference processing for "${confTitle}" (${confAcronym}).`);
        } finally {
            const finishContext: { event: string; success: boolean; error_details?: string } = {
                event: 'task_finish',
                success: taskSuccessfullyCompleted,
            };
            if (specificTaskError) {
                if (!taskLogger.bindings().err) {
                    finishContext.error_details = specificTaskError.message;
                }
            } else if (!taskSuccessfullyCompleted) {
                finishContext.error_details = "Task did not complete successfully for an unspecified reason.";
            }
            taskLogger.info(finishContext, `Finished processing conference task for "${confTitle}" (${confAcronym}).`);
        }
    }
}