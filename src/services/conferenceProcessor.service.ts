// src/services/conferenceProcessor.service.ts
import 'reflect-metadata';
import { injectable, inject } from 'tsyringe'; // Dùng injectable thay vì singleton
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GoogleSearchService } from './googleSearch.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { FileSystemService } from './fileSystem.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, GoogleSearchResult } from '../types/crawl.types';
import { filterSearchResults } from '../utils/crawl/linkFiltering';

@injectable() // Không phải singleton
export class ConferenceProcessorService {
    private readonly logger: Logger;
    private readonly searchQueryTemplate: string;
    private readonly year1: number;
    private readonly year2: number;
    private readonly year3: number;
    private readonly unwantedDomains: string[];
    private readonly skipKeywords: string[];
    private readonly maxLinks: number;

    constructor(
        // Inject các service singleton cần thiết
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GoogleSearchService) private googleSearchService: GoogleSearchService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        // Logger này chưa có context của conference, sẽ thêm sau
        this.logger = this.loggingService.getLogger({ service: 'ConferenceProcessor' });
        this.searchQueryTemplate = this.configService.config.SEARCH_QUERY_TEMPLATE;
        this.year1 = this.configService.config.YEAR1;
        this.year2 = this.configService.config.YEAR2;
        this.year3 = this.configService.config.YEAR3;
        this.unwantedDomains = this.configService.config.UNWANTED_DOMAINS;
        this.skipKeywords = this.configService.config.SKIP_KEYWORDS;
        this.maxLinks = this.configService.config.MAX_LINKS;
    }

    // Hàm chính để xử lý một conference
    async process(conference: ConferenceData, taskIndex: number): Promise<void> {
        const confAcronym = conference?.Acronym || `Unknown-${taskIndex}`;
        const confTitle = conference?.Title || `Unknown-${taskIndex}`;
        // Tạo logger con với context của task này
        const taskLogger = this.loggingService.getLogger({
            service: 'ConferenceProcessor',
            title: confTitle,
            acronym: confAcronym,
            taskIndex: taskIndex + 1,
            event_group: 'conference_task'
        });

        taskLogger.info({ event: 'task_start' }, `Processing conference`);

        try {
            const hasAllRequiredKeys = 'mainLink' in conference &&
                                       'cfpLink' in conference &&
                                       'impLink' in conference;

            if (hasAllRequiredKeys) {
                // --- Luồng UPDATE ---
                taskLogger.info({ event: 'update_flow_start' }, `Processing with pre-defined keys (UPDATE flow)`);
                const conferenceUpdateData: ConferenceUpdateData = {
                    Acronym: conference.Acronym,
                    Title: conference.Title,
                    mainLink: conference.mainLink ?? "",
                    cfpLink: conference.cfpLink ?? "",
                    impLink: conference.impLink ?? ""
                };
                // Call the correct method in HtmlPersistenceService
                // Await the result as the update should complete within this task
                const updateSuccess = await this.htmlPersistenceService.processUpdateFlow(conferenceUpdateData, taskLogger);

                taskLogger.info({ event: 'update_flow_finish', success: updateSuccess });
                // No direct output append needed here for UPDATE flow

            } else {
                // --- Luồng SAVE (Search & Process) ---
                taskLogger.info({ event: 'save_flow_start' }, `Searching and processing (SAVE flow)`);
                let searchResultsLinks: string[] = [];

                // 1. Build Search Query
                const searchQuery: string = this.searchQueryTemplate
                    .replace(/\${Title}/g, confTitle) // Sử dụng confTitle đã chuẩn hóa
                    .replace(/\${Acronym}/g, confAcronym) // Sử dụng confAcronym đã chuẩn hóa
                    .replace(/\${Year2}/g, String(this.year2))
                    .replace(/\${Year3}/g, String(this.year3))
                    .replace(/\${Year1}/g, String(this.year1));

                try {
                    // 2. Perform Search
                    const searchResults: GoogleSearchResult[] = await this.googleSearchService.search(searchQuery);

                    // 3. Filter & Limit Results
                    const filteredResults = filterSearchResults(searchResults, this.unwantedDomains, this.skipKeywords);
                    const limitedResults = filteredResults.slice(0, this.maxLinks);
                    searchResultsLinks = limitedResults.map(res => res.link);
                    taskLogger.info({ rawResults: searchResults.length, filteredCount: filteredResults.length, limitedCount: searchResultsLinks.length, event: 'search_results_filtered' }, `Filtered search results`);

                    // 4. (Optional) Write all search links to file
                    const allLinks = searchResults.map(result => result.link);
                    await this.fileSystemService.writeCustomSearchResults(confAcronym, allLinks);

                } catch (searchError) {
                    // Lỗi đã được log bên trong GoogleSearchService
                    taskLogger.error({ err: searchError, event: 'search_ultimately_failed_in_task' }, "Google Search failed for this conference, skipping save HTML step.");
                    searchResultsLinks = []; // Đảm bảo rỗng nếu search lỗi
                }

                // 5. Save HTML Content (nếu có link)
                if (searchResultsLinks.length > 0) {
                    await this.htmlPersistenceService.processSaveFlow(conference, searchResultsLinks, taskLogger);
                } else {
                     taskLogger.warn({ event: 'save_html_skipped_no_links_in_task' }, "Skipping save HTML step as no valid search links were found or processed.")
                }
            } // End SAVE flow

        } catch (taskError: any) {
            taskLogger.error({ err: taskError, stack: taskError.stack, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
            // Quyết định xem có nên ném lỗi ra ngoài để queue biết task bị lỗi không
            // throw taskError;
        } finally {
            taskLogger.info({ event: 'task_finish' }, `Finished processing queue item`);
        }
    }
}