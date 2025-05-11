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
        // Khởi tạo analysisResults sớm để có thể truyền vào các bước nếu cần
        // Hoặc, service phân tích log sẽ tự tạo đối tượng này khi xử lý file log.
        // Ở đây, chúng ta giả định service phân tích log sẽ tạo nó.

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

            logger.info("Phase 4: Processing final output (JSONL to CSV)...");
            // ResultProcessingService.processOutput sẽ log các event nội bộ của nó
            // như csv_record_processed_for_writing, csv_stream_collect_success/failed
            allProcessedData = await this.resultProcessingService.processOutput(logger);
            logger.info(`ResultProcessingService finished. Collected ${allProcessedData.length} CSV-ready records.`);

            // Sau khi processOutput hoàn tất, chúng ta log event cho từng record CSV thành công
            // để các handler có thể cập nhật ConferenceAnalysisDetail.
            if (allProcessedData.length > 0) {
                allProcessedData.forEach(csvRow => {
                    // Event này sẽ được bắt bởi handleCsvWriteSuccess
                    logger.info({
                        event: 'csv_write_record_success', // Event cho handler phân tích log
                        service: 'CrawlOrchestratorService', // Nguồn log event này
                        conferenceAcronym: csvRow.acronym,
                        conferenceTitle: csvRow.title,
                        // Không cần truyền confDetail ở đây, handler sẽ tự tìm
                    }, `CSV record for ${csvRow.acronym} considered successfully written.`);
                });
                // Event báo hiệu toàn bộ quá trình tạo CSV (từ góc độ Orchestrator) là thành công
                // (nếu không có lỗi nghiêm trọng từ processOutput)
                // Event 'csv_stream_collect_success' từ ResultProcessingService đã báo hiệu điều này ở mức độ stream.
                // Có thể không cần log thêm event ở đây nếu 'csv_stream_collect_success' đã đủ.
            } else {
                // Kiểm tra xem file CSV có được tạo không (trường hợp JSONL rỗng nhưng CSV header vẫn được tạo)
                // Hoặc nếu processOutput trả về [] do lỗi nhưng không throw
                let csvActuallyGenerated = false;
                try {
                    if (fs.existsSync(this.configService.evaluateCsvPath) && fs.statSync(this.configService.evaluateCsvPath).size > 0) {
                        csvActuallyGenerated = true;
                    }
                } catch (e) { /* ignore stat error if file doesn't exist */ }

                if (csvActuallyGenerated) {
                    logger.info({ event: 'csv_generation_empty_but_file_exists' }, "CSV file generated but no data rows (possibly only headers).");
                    // Event này có thể được handle bởi handleCsvProcessingEvent để set csvFileGenerated = true
                } else {
                    logger.info({ event: 'csv_generation_failed_or_empty' }, "CSV file generation failed or resulted in an empty file (no data and possibly no file).");
                    // Event này sẽ được handle bởi handleCsvProcessingEvent để set csvFileGenerated = false
                }
            }

        } catch (error: any) {
            logger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
            crawlError = error;
            // Nếu lỗi xảy ra ở Phase 4 (ResultProcessingService), log event báo hiệu toàn bộ CSV pipeline thất bại
            if (error.message?.includes('CSV writing stream') || error.message?.includes('final output processing')) {
                logger.error({ event: 'csv_generation_pipeline_failed', err: error }, "CSV generation pipeline failed at orchestrator level.");
                // Event này sẽ được handle bởi handleCsvProcessingEvent
            }
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
            logger.info({ err: readError, path: jsonlPath, event: 'final_count_read_error' }, "Could not read final output file to count records.")
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