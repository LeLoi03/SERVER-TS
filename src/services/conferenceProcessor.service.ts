// src/services/conferenceProcessor.service.ts
import 'reflect-metadata';
import { injectable, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service'; // Vẫn cần LoggingService để lấy logger cơ sở nếu không có parentLogger
import { GoogleSearchService } from './googleSearch.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { FileSystemService } from './fileSystem.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, GoogleSearchResult } from '../types/crawl.types';
import { filterSearchResults } from '../utils/crawl/linkFiltering';

@injectable()
export class ConferenceProcessorService {
    // private readonly logger: Logger; // Logger này sẽ được tạo trong từng method process
    private readonly searchQueryTemplate: string;
    private readonly year1: number;
    private readonly year2: number;
    private readonly year3: number;
    private readonly unwantedDomains: string[];
    private readonly skipKeywords: string[];
    private readonly maxLinks: number;
    private readonly serviceBaseLogger: Logger; // Logger cơ sở cho service, nếu cần

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService, // Giữ lại để tạo logger cơ sở
        @inject(GoogleSearchService) private googleSearchService: GoogleSearchService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(FileSystemService) private fileSystemService: FileSystemService
    ) {
        // Logger cơ sở, không có context request hoặc task cụ thể
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

    // Hàm chính để xử lý một conference
    // Nhận parentLogger từ CrawlOrchestratorService
    async process(conference: ConferenceData, taskIndex: number, parentLogger: Logger): Promise<void> {
        const confAcronym = conference?.Acronym || `UnknownAcronym-${taskIndex}`;
        const confTitle = conference?.Title || `UnknownTitle-${taskIndex}`;

        // Tạo taskLogger là con của parentLogger (đã có requestId, route, service:CrawlOrchestratorRun)
        // Thêm context cụ thể của task này
        const taskLogger = parentLogger.child({
            // service: 'ConferenceProcessorTask', // Hoặc để parentLogger đã có context service=CrawlOrchestratorRun
            // và thêm một context khác như:
            processorTask: 'ConferenceProcessor', // Để phân biệt với service cha
            title: confTitle,
            acronym: confAcronym,
            taskIndex: taskIndex + 1, // Giữ nguyên taskIndex + 1 cho dễ đọc
            event_group: 'conference_task_processing' // Đổi tên event_group một chút cho rõ hơn
        });

        taskLogger.info({ event: 'task_start' }, `Processing conference task`);
        let taskSuccessfullyCompleted = true; // Giả định thành công ban đầu
        let specificTaskError: any = null;     // Để lưu lỗi cụ thể nếu có

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
                // Truyền taskLogger (đã có context đầy đủ) xuống service con
                const updateSuccess = await this.htmlPersistenceService.processUpdateFlow(conferenceUpdateData, taskLogger);
                taskLogger.info({ event: 'update_flow_finish', success: updateSuccess }, `Update flow finished.`);
                if (!updateSuccess) {
                    taskSuccessfullyCompleted = false; // Nếu update flow không thành công
                    specificTaskError = new Error("Update flow did not complete successfully."); // Tạo lỗi mô tả
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
                    // Truyền taskLogger xuống GoogleSearchService
                    const searchResults: GoogleSearchResult[] = await this.googleSearchService.search(searchQuery, taskLogger);
                    const filteredResults = filterSearchResults(searchResults, this.unwantedDomains, this.skipKeywords);
                    const limitedResults = filteredResults.slice(0, this.maxLinks);
                    searchResultsLinks = limitedResults.map(res => res.link);
                    taskLogger.info({
                        searchQueryUsed: searchQuery, // Log thêm query cho dễ debug
                        rawResultsCount: searchResults.length,
                        filteredResultsCount: filteredResults.length,
                        limitedResultsCount: searchResultsLinks.length,
                        event: 'search_results_filtered'
                    }, `Filtered search results`);

                    const allLinks = searchResults.map(result => result.link);
                    // Truyền taskLogger xuống FileSystemService
                    await this.fileSystemService.writeCustomSearchResults(confAcronym, allLinks, taskLogger);
                } catch (searchError: any) {
                    // GoogleSearchService đã log chi tiết lỗi với logger được truyền vào (taskLogger)
                    // Log ở đây chỉ là thông báo cuối cùng ở cấp task
                    taskLogger.error({ err: searchError, event: 'search_ultimately_failed_in_task' }, "Google Search failed for this conference, skipping save HTML step.");
                    searchResultsLinks = [];
                }

                if (searchResultsLinks.length > 0) {
                    // Truyền taskLogger xuống HtmlPersistenceService
                    // Giả sử processSaveFlow có thể trả về boolean hoặc throw lỗi
                    const saveSuccess = await this.htmlPersistenceService.processSaveFlow(conference, searchResultsLinks, taskLogger);
                    if (saveSuccess === false) { // Nếu processSaveFlow trả về false
                        taskSuccessfullyCompleted = false;
                        specificTaskError = new Error("Save flow did not complete successfully (processSaveFlow returned false).");
                    }
                } else {
                    taskLogger.warn({ event: 'save_html_skipped_no_links_in_task' }, "Skipping save HTML step as no valid search links were found or processed.");
                    taskSuccessfullyCompleted = false;
                    specificTaskError = new Error("Save HTML step as no valid search links were found or processed.");

                }
            }
            // Nếu không có lỗi nào được ném hoặc cờ taskSuccessfullyCompleted không bị set false,
            // thì task coi như thành công ở điểm này (trước khi vào finally).

        } catch (taskError: any) {
            taskSuccessfullyCompleted = false; // Bất kỳ lỗi nào bắt được ở đây đều làm task fail
            specificTaskError = taskError;     // Lưu lỗi để có thể log trong finally nếu cần
            taskLogger.error({ err: taskError, stack: taskError.stack, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
            // Event 'task_unhandled_error' sẽ set status='failed' và endTime trong handler của nó.
        } finally {
            // Log 'task_finish' với status dựa trên taskSuccessfullyCompleted.
            // Handler của 'task_unhandled_error' đã set status='failed' và endTime nếu có lỗi.
            // Nếu không có 'task_unhandled_error', thì 'task_finish' sẽ set endTime.
            const finishContext: { event: string; success?: boolean; error_details?: string } = { event: 'task_finish' };
            if (!specificTaskError) { // Nếu không có lỗi cụ thể nào được ghi nhận VÀ không có unhandled error
                finishContext.success = taskSuccessfullyCompleted;
            } else if (specificTaskError && taskSuccessfullyCompleted === false && !taskLogger.bindings().err) {
                // Trường hợp taskSuccessfullyCompleted = false do lỗi logic (không phải unhandled exception)
                // và chưa có lỗi nào được log ở 'task_unhandled_error'
                finishContext.success = false;
                finishContext.error_details = specificTaskError instanceof Error ? specificTaskError.message : String(specificTaskError);
            }
            // Nếu đã có 'task_unhandled_error', thì finishContext.success sẽ không được set (để handler không ghi đè status)

            taskLogger.info(finishContext, `Finished processing conference task.`);
        }
    }
}