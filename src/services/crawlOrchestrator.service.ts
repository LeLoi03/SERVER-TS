// src/services/crawlOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject, container } from 'tsyringe'; // Import container để resolve service không phải singleton
import { ConfigService, AppConfig } from '../config/config.service';
import { LoggingService } from './logging.service';
import { ApiKeyManager } from './apiKey.manager';
import { PlaywrightService } from './playwright.service';
import { FileSystemService } from './fileSystem.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { ResultProcessingService } from './resultProcessing.service';
import { BatchProcessingService } from './batchProcesing.service';
import { TaskQueueService } from './taskQueue.service';
import { ConferenceProcessorService } from './conferenceProcessor.service'; // Import service xử lý task
import { Logger } from 'pino';
import { ConferenceData, ProcessedRowData } from '../types/crawl.types';
import fs from 'fs'; // Import fs để đọc file JSONL đếm record cuối
import { GeminiApiService } from './geminiApi.service';

@singleton()
export class CrawlOrchestratorService {
    private readonly logger: Logger;
    private readonly config: AppConfig;

    constructor(
        // Inject tất cả các service cần thiết
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager, // Vẫn inject để lấy thông tin summary
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(ResultProcessingService) private resultProcessingService: ResultProcessingService,
        @inject(BatchProcessingService) private saveBatchProcessingService: BatchProcessingService, 
        @inject(TaskQueueService) private taskQueueService: TaskQueueService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
    ) {
        this.logger = this.loggingService.getLogger({ service: 'CrawlOrchestrator' });
        this.config = this.configService.config;
    }

    // Hàm chính thay thế cho crawlConferences gốc
    async run(conferenceList: ConferenceData[]): Promise<ProcessedRowData[]> {
        const operationStartTime = Date.now();
        this.logger.info({
            event: 'crawl_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString()
        }, 'Starting crawl process');

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

        try {
            // --- 1. Chuẩn bị môi trường ---
            this.logger.info("Phase 1: Preparing environment...");
            await this.fileSystemService.prepareOutputArea();
            await this.fileSystemService.writeConferenceInputList(conferenceList); // Ghi file input (optional)
            await this.playwrightService.initialize(); // Khởi tạo Playwright
            await this.geminiApiService.init(); // Khởi tạo Gemini api
            this.htmlPersistenceService.setBrowserContext(); // Cung cấp context cho service HTML
            this.htmlPersistenceService.resetState(); // Reset lại state nếu cần chạy nhiều lần
            this.logger.info("Environment prepared.");

            // --- 2. Lên lịch các Task ---
            this.logger.info("Phase 2: Scheduling conference processing tasks...");
            const tasks = conferenceList.map((conference, index) => {
                return () => {
                     // Resolve một instance MỚI của ConferenceProcessorService cho mỗi task
                     const processor = container.resolve(ConferenceProcessorService);
                     return processor.process(conference, index);
                };
            });

            // Thêm tất cả task vào queue
            tasks.forEach(taskFunc => this.taskQueueService.add(taskFunc));
            this.logger.info(`Scheduled ${tasks.length} tasks. Queue size: ${this.taskQueueService.size}, Pending: ${this.taskQueueService.pending}`);

             // --- 3. Chờ Queue (Task Processing) hoàn thành ---
             this.logger.info("Phase 3: Waiting for all conference processing tasks in queue to complete...");
             await this.taskQueueService.onIdle(); // Wait for all processor tasks
             this.logger.info("All conference processing tasks finished.");
 
             // --- 3.5. Chờ Batch Saving hoàn thành --- <<<< NEW STEP >>>>
             this.logger.info("Phase 3.5: Waiting for all background batch save operations to complete...");
             await this.saveBatchProcessingService.awaitCompletion(); // Wait for saveBatchToFile tasks
             this.logger.info("All background batch save operations finished.");
 
             // --- 4. Xử lý Output cuối cùng ---
             this.logger.info("Phase 4: Processing final output...");
             allProcessedData = await this.resultProcessingService.processOutput();
             this.logger.info(`Processed final output. Collected ${allProcessedData.length} records.`);

        } catch (error: any) {
            this.logger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
            crawlError = error; // Lưu lỗi để ném lại sau cleanup
            // Không ném lỗi ở đây để cleanup vẫn chạy
        } finally {
            // --- 5. Cleanup ---
            this.logger.info("Phase 5: Performing final cleanup...");
            await this.playwrightService.close(); // Đóng Playwright
            // await this.fileSystemService.cleanupTempFiles(); // Dọn dẹp file tạm (nếu có)
            this.logger.info("Cleanup finished.");

            // --- 6. Log Tổng kết ---
            await this.logSummary(operationStartTime, conferenceList.length, allProcessedData.length);

            this.logger.info({ event: 'crawl_end', resultsReturned: allProcessedData.length }, "Crawl process finished.");
        }

         // Ném lỗi nếu có lỗi xảy ra trong quá trình crawl
         if (crawlError) {
             throw crawlError;
         }

        // Trả về kết quả cuối cùng
        return allProcessedData;
    }


    private async logSummary(startTime: number, inputCount: number, outputCount: number): Promise<void> {
         const operationEndTime = Date.now();
         const durationSeconds = Math.round((operationEndTime - startTime) / 1000);
         let finalRecordCount = 0;
         const jsonlPath = this.configService.finalOutputJsonlPath;

         try {
             if (fs.existsSync(jsonlPath)) {
                 // Đọc file đồng bộ ở đây chấp nhận được vì chỉ là summary cuối cùng
                 const content = fs.readFileSync(jsonlPath, 'utf8');
                 finalRecordCount = content.split('\n').filter(l => l.trim()).length;
             }
         } catch (readError: any) {
             this.logger.warn({ err: readError, path: jsonlPath, event: 'final_count_read_error' }, "Could not read final output file to count records.")
         }

         this.logger.info({
             event: 'crawl_summary',
             totalConferencesInput: inputCount,
             finalRecordsInJsonl: finalRecordCount, // Số dòng thực tế trong file JSONL
             resultsReturnedFromProcessing: outputCount, // Số record service xử lý trả về
             totalGoogleApiRequests: this.apiKeyManager.getTotalRequests(),
             keysExhausted: this.apiKeyManager.areAllKeysExhausted(),
             durationSeconds,
             startTime: new Date(startTime).toISOString(),
             endTime: new Date(operationEndTime).toISOString()
         }, "Crawling process summary");
    }
}