// src/services/crawlOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject, container } from 'tsyringe';
import { ConfigService, AppConfig } from '../config/config.service';
import { LoggingService } from './logging.service';
import { ApiKeyManager } from './apiKey.manager';
import { PlaywrightService } from './playwright.service';
import { FileSystemService } from './fileSystem.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { ResultProcessingService } from './resultProcessing.service';
import { BatchProcessingService } from './batchProcessing.service'; // Renamed in original for consistency? saveBatchProcessingService
import { TaskQueueService } from './taskQueue.service';
import { ConferenceProcessorService } from './conferenceProcessor.service';
import { Logger } from 'pino'; // Keep this
import { ConferenceData, ProcessedRowData } from '../types/crawl.types';
import fs from 'fs';
import { GeminiApiService } from './geminiApi.service';

@singleton()
export class CrawlOrchestratorService {
    // private readonly logger: Logger; // Logger này là logger chung của service, có thể giữ lại cho các mục đích khác nếu cần
    private readonly config: AppConfig;
    private readonly baseLogger: Logger; // Logger cơ sở của service này

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(ResultProcessingService) private resultProcessingService: ResultProcessingService,
        @inject(BatchProcessingService) private saveBatchProcessingService: BatchProcessingService,
        @inject(TaskQueueService) private taskQueueService: TaskQueueService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
    ) {
        // this.logger = this.loggingService.getLogger({ service: 'CrawlOrchestrator' }); // Logger chung, không có requestId
        this.baseLogger = this.loggingService.getLogger({ service: 'CrawlOrchestratorServiceBase' }); // Logger cơ sở cho service
        this.config = this.configService.config;
    }

    // Hàm chính thay thế cho crawlConferences gốc
    // Chấp nhận parentLogger (chính là routeLogger từ controller)
    async run(conferenceList: ConferenceData[], parentLogger: Logger): Promise<ProcessedRowData[]> {
        // Tạo logger cụ thể cho lần chạy này, là con của parentLogger
        // Nó sẽ thừa hưởng requestId và route từ parentLogger
        const logger = parentLogger.child({ service: 'CrawlOrchestratorRun' });

        const operationStartTime = Date.now();
        logger.info({
            event: 'crawl_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString()
        }, 'Starting crawl process within orchestrator');

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

        try {
            logger.info("Phase 1: Preparing environment...");
            await this.fileSystemService.prepareOutputArea(logger); // Truyền logger nếu service con cần
            await this.fileSystemService.writeConferenceInputList(conferenceList, logger);
            await this.playwrightService.initialize(logger);
            await this.geminiApiService.init(logger);
            this.htmlPersistenceService.setBrowserContext();
            this.htmlPersistenceService.resetState();
            logger.info("Environment prepared.");

            logger.info("Phase 2: Scheduling conference processing tasks...");
            const tasks = conferenceList.map((conference, index) => {
                return () => {
                     const processor = container.resolve(ConferenceProcessorService);
                     // Truyền logger (con của routeLogger) vào từng task processor
                     return processor.process(conference, index, logger); // <--- THAY ĐỔI Ở ĐÂY
                };
            });

            tasks.forEach(taskFunc => this.taskQueueService.add(taskFunc));
            logger.info(`Scheduled ${tasks.length} tasks. Queue size: ${this.taskQueueService.size}, Pending: ${this.taskQueueService.pending}`);

             logger.info("Phase 3: Waiting for all conference processing tasks in queue to complete...");
             await this.taskQueueService.onIdle();
             logger.info("All conference processing tasks finished.");

             logger.info("Phase 3.5: Waiting for all background batch save operations to complete...");
             await this.saveBatchProcessingService.awaitCompletion();
             logger.info("All background batch save operations finished.");

             logger.info("Phase 4: Processing final output...");
             allProcessedData = await this.resultProcessingService.processOutput(logger);
             logger.info(`Processed final output. Collected ${allProcessedData.length} records.`);

        } catch (error: any) {
            logger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
            crawlError = error;
        } finally {
            logger.info("Phase 5: Performing final cleanup...");
            await this.playwrightService.close(logger);
            logger.info("Cleanup finished.");

            // Truyền logger vào logSummary để nó cũng có context đúng
            await this.logSummary(operationStartTime, conferenceList.length, allProcessedData.length, logger); // <--- THAY ĐỔI Ở ĐÂY

            logger.info({ event: 'crawl_end', resultsReturned: allProcessedData.length }, "Crawl process finished.");
        }

         if (crawlError) {
             throw crawlError;
         }
        return allProcessedData;
    }


    private async logSummary(startTime: number, inputCount: number, outputCount: number, logger: Logger): Promise<void> { // <--- THAY ĐỔI Ở ĐÂY
         const operationEndTime = Date.now();
         const durationSeconds = Math.round((operationEndTime - startTime) / 1000);
         let finalRecordCount = 0;
         const jsonlPath = this.configService.finalOutputJsonlPath;

         try {
             if (fs.existsSync(jsonlPath)) {
                 const content = fs.readFileSync(jsonlPath, 'utf8');
                 finalRecordCount = content.split('\n').filter(l => l.trim()).length;
             }
         } catch (readError: any) {
             logger.warn({ err: readError, path: jsonlPath, event: 'final_count_read_error' }, "Could not read final output file to count records.")
         }

         // Logger này đã có requestId và route từ controller, cộng thêm service: 'CrawlOrchestratorRun'
         logger.info({
             event: 'crawl_summary',
             totalConferencesInput: inputCount,
             finalRecordsInJsonl: finalRecordCount,
             resultsReturnedFromProcessing: outputCount,
             totalGoogleApiRequests: this.apiKeyManager.getTotalRequests(),
             keysExhausted: this.apiKeyManager.areAllKeysExhausted(),
             durationSeconds,
             startTime: new Date(startTime).toISOString(),
             endTime: new Date(operationEndTime).toISOString()
         }, "Crawling process summary");
    }
}