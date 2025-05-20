// src/services/htmlPersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { BrowserContext } from 'playwright';
import { PlaywrightService } from './playwright.service';
// import { ConfigService } from '../config/config.service'; // Chỉ inject nếu thực sự dùng config riêng
import { LoggingService } from './logging.service';
import { BatchProcessingService } from './batchProcessing.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData, CrawlModelType } from '../types/crawl.types';

@singleton()
export class HtmlPersistenceService {
    private readonly serviceBaseLogger: Logger;
    private browserContext: BrowserContext | null = null;
    // private existingAcronyms: Set<string> = new Set(); // ++ BỎ
    // private batchIndexRef = { current: 1 }; // ++ BỎ

    constructor(
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        // @inject(ConfigService) private configService: ConfigService, // Bỏ nếu không dùng
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
        conference: ConferenceUpdateData, // Nên chứa originalRequestId
        taskLogger: Logger, // taskLogger từ ConferenceProcessorService, đã chứa batchRequestId và batchItemIndex
        crawlModel: CrawlModelType
    ): Promise<boolean> {
        const flowLogger = taskLogger.child({
            persistenceFlow: 'update',
            crawlModelUsed: crawlModel
            // batchRequestId và batchItemIndex đã được kế thừa từ taskLogger
        });

        flowLogger.info({ event: 'process_update_start' }, `Processing UPDATE flow (using ${crawlModel} settings)`);

        try {
            // batchIndexRef (batchItemIndex) và existingAcronyms không còn được truyền từ đây nữa.
            // BatchProcessingService.processConferenceUpdate sẽ nhận batchItemIndex qua logger hoặc tham số.
            // Việc quản lý acronym duy nhất sẽ do BatchProcessingService xử lý nội bộ.
            const success = await this.batchProcessingService.processConferenceUpdate(
                this.getContext(flowLogger),
                conference,
                // this.batchIndexRef, // ++ BỎ: batchItemIndex sẽ được quản lý bởi orchestrator/processor
                flowLogger, // flowLogger đã chứa batchRequestId và batchItemIndex
                crawlModel
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
        conference: ConferenceData, // Nên chứa originalRequestId
        searchResultLinks: string[],
        taskLogger: Logger, // taskLogger từ ConferenceProcessorService, đã chứa batchRequestId và batchItemIndex
        crawlModel: CrawlModelType
    ): Promise<boolean> {
        const flowLogger = taskLogger.child({
            persistenceFlow: 'save',
            crawlModelUsed: crawlModel
            // batchRequestId và batchItemIndex đã được kế thừa từ taskLogger
        });

        flowLogger.info({ linksCount: searchResultLinks.length, event: 'save_html_start' }, `Processing SAVE flow (using ${crawlModel} settings) by delegating to BatchProcessingService`);

        if (searchResultLinks.length === 0) {
            flowLogger.warn({ event: 'process_save_skipped_no_links' }, "Skipping save flow as no search links were provided.");
            return false; // Trả về false vì không có gì để xử lý
        }

        try {
            // BatchProcessingService.processConferenceSave sẽ nhận batchItemIndex qua logger hoặc tham số.
            // Việc quản lý acronym duy nhất sẽ do BatchProcessingService xử lý nội bộ.
            const initiationSuccess = await this.batchProcessingService.processConferenceSave(
                this.getContext(flowLogger),
                conference,
                searchResultLinks,
                // this.batchIndexRef,      // ++ BỎ
                // this.existingAcronyms, // ++ BỎ
                flowLogger, // flowLogger đã chứa batchRequestId và batchItemIndex
                crawlModel
            );

            if (initiationSuccess === true) { // Check === true để rõ ràng hơn là boolean
                flowLogger.info({ event: 'process_save_delegation_initiated' }, 'BatchProcessingService.processConferenceSave initiated successfully (batch save running async).');
                return true;
            } else { // initiationSuccess là false hoặc undefined
                flowLogger.warn({ event: 'process_save_delegation_initiation_failed' }, 'BatchProcessingService.processConferenceSave reported failure during initiation.');
                return false; // Trả về false vì khởi tạo không thành công
            }
        } catch (saveError: any) {
            flowLogger.error({ err: saveError, event: 'process_save_delegation_error' }, 'Error occurred while calling BatchProcessingService.processConferenceSave initiation');
            return false; // Trả về false do lỗi
        }
    }

     public resetState(parentLogger?: Logger): void {
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.resetState' }) : this.serviceBaseLogger;
        // this.existingAcronyms.clear(); // ++ BỎ
        // this.batchIndexRef.current = 1; // ++ BỎ
        // Có thể không cần reset gì ở đây nữa nếu nó không quản lý state
        logger.info("HtmlPersistenceService: No local state to reset (acronyms/batchIndex managed elsewhere).");
    }
}