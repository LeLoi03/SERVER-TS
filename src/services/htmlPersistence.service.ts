// src/services/htmlPersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { BrowserContext } from 'playwright';
import { PlaywrightService } from './playwright.service';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { BatchProcessingService } from './batchProcessing.service';
import { Logger } from 'pino';
import { ConferenceData, ConferenceUpdateData } from '../types/crawl.types';

@singleton()
export class HtmlPersistenceService {
    private readonly serviceBaseLogger: Logger; // Đổi tên
    private browserContext: BrowserContext | null = null;
    // private readonly year2: number; // Giữ lại nếu cần, nếu không thì bỏ

    private existingAcronyms: Set<string> = new Set();
    private batchIndexRef = { current: 1 };

    constructor(
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(BatchProcessingService) private batchProcessingService: BatchProcessingService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'HtmlPersistenceServiceBase' }); // Đổi tên và context
        // this.year2 = this.configService.config.YEAR2;
        this.serviceBaseLogger.info("HtmlPersistenceService instance created.");
    }

    // Helper để tạo logger cho phương thức (nếu cần thiết cho các phương thức public khác không nhận taskLogger)
    // private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
    //     const base = parentLogger || this.serviceBaseLogger;
    //     return base.child({ serviceMethod: `HtmlPersistenceService.${methodName}`, ...additionalContext });
    // }

    public setBrowserContext(parentLogger?: Logger) { // Nhận parentLogger tùy chọn từ Orchestrator
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.setBrowserContext'}) : this.serviceBaseLogger;
        try {
            // Truyền logger vào getBrowserContext của PlaywrightService nếu nó cũng được cập nhật để nhận logger
            this.browserContext = this.playwrightService.getBrowserContext(logger);
            logger.debug("BrowserContext set for HtmlPersistenceService.");
        } catch (error) {
            logger.error({ err: error }, "Failed to get browser context in HtmlPersistenceService.");
            throw error; // Ném lại lỗi để Orchestrator biết
        }
    }

    private getContext(logger: Logger): BrowserContext { // Nhận logger để log lỗi nếu có
        if (!this.browserContext) {
            const errMsg = "BrowserContext not set in HtmlPersistenceService. Call setBrowserContext first.";
            logger.error({ internalError: errMsg }, "BrowserContext not available."); // Log với logger được truyền vào
            throw new Error(errMsg);
        }
        return this.browserContext;
    }

     async processUpdateFlow(conference: ConferenceUpdateData, taskLogger: Logger): Promise<boolean> {
        // taskLogger đã có context đầy đủ từ ConferenceProcessorService
        // Tạo một child logger cụ thể hơn cho flow này nếu muốn
        const flowLogger = taskLogger.child({ persistenceFlow: 'update' });

        flowLogger.info({ event: 'process_update_start' }, `Processing UPDATE flow by delegating to BatchProcessingService`);

        try {
            const success = await this.batchProcessingService.processConferenceUpdate(
                this.getContext(flowLogger), // Truyền flowLogger để getContext có thể log lỗi đúng context
                conference,
                this.batchIndexRef,
                flowLogger // <--- TRUYỀN flowLogger (hoặc taskLogger) XUỐNG BatchProcessingService
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

    async processSaveFlow(conference: ConferenceData, searchResultLinks: string[], taskLogger: Logger): Promise<void> {
        // taskLogger đã có context đầy đủ từ ConferenceProcessorService
        const flowLogger = taskLogger.child({ persistenceFlow: 'save' });

        flowLogger.info({ linksCount: searchResultLinks.length, event: 'process_save_start' }, `Processing SAVE flow by delegating to BatchProcessingService`);

        if (searchResultLinks.length === 0) {
            flowLogger.warn({ event: 'process_save_skipped_no_links' }, "Skipping save flow as no search links were provided.");
            return;
        }

        try {
            const initiationSuccess = await this.batchProcessingService.processConferenceSave(
                this.getContext(flowLogger), // Truyền flowLogger
                conference,
                searchResultLinks,
                this.batchIndexRef,
                this.existingAcronyms,
                flowLogger // <--- TRUYỀN flowLogger (hoặc taskLogger) XUỐNG BatchProcessingService
            );

            if (initiationSuccess) {
                flowLogger.info({ event: 'process_save_delegation_initiated' }, 'BatchProcessingService.processConferenceSave initiated successfully (batch save running async).');
            } else {
                flowLogger.warn({ event: 'process_save_delegation_initiation_failed' }, 'BatchProcessingService.processConferenceSave reported failure during initiation.');
            }
        } catch (saveError: any) {
            flowLogger.error({ err: saveError, event: 'process_save_delegation_error' }, 'Error occurred while calling BatchProcessingService.processConferenceSave initiation');
        }
    }

    public resetState(parentLogger?: Logger): void { // Nhận parentLogger tùy chọn từ Orchestrator
        const logger = parentLogger ? parentLogger.child({ serviceMethod: 'HtmlPersistenceService.resetState'}) : this.serviceBaseLogger;
        this.existingAcronyms.clear();
        this.batchIndexRef.current = 1;
        logger.info("HtmlPersistenceService state (existingAcronyms, batchIndexRef) reset.");
    }
}