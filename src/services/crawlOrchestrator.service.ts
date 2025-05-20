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
import { BatchProcessingService } from './batchProcessing.service';
import { TaskQueueService } from './taskQueue.service';
import { ConferenceProcessorService } from './conferenceProcessor.service';
import { Logger } from 'pino';
import { ConferenceData, ProcessedRowData, CrawlModelType } from '../types/crawl.types';
import fs from 'fs';
import { GeminiApiService } from './geminiApi.service';

@singleton()
export class CrawlOrchestratorService {
    private readonly configApp: AppConfig; // Đổi tên để tránh nhầm lẫn với configService
    private readonly baseLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService, // Service để lấy các đường dẫn động
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(ResultProcessingService) private resultProcessingService: ResultProcessingService,
        @inject(BatchProcessingService) private batchProcessingService: BatchProcessingService, // Đã sửa tên biến
        @inject(TaskQueueService) private taskQueueService: TaskQueueService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
    ) {
        this.baseLogger = this.loggingService.getLogger({ service: 'CrawlOrchestratorServiceBase' });
        this.configApp = this.configService.config; // Lấy config tĩnh nếu cần
    }

    async run(
        conferenceList: ConferenceData[],
        parentLogger: Logger,
        crawlModel: CrawlModelType,
        batchRequestId: string
    ): Promise<ProcessedRowData[]> {
        const logger = parentLogger.child({
            service: 'CrawlOrchestratorRun',
            crawlModelUsed: crawlModel,
            // batchRequestId đã được kế thừa
        });


        const operationStartTime = Date.now();
        logger.info({
            event: 'crawl_orchestrator_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString()
        }, `Starting crawl process within orchestrator for batch ${batchRequestId} using ${crawlModel} model`);

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

         try {
            logger.info("Phase 0: Resetting state for new batch...");
            // ++ RESET GLOBAL ACRONYMS FOR THIS BATCH RUN
            this.batchProcessingService.resetGlobalAcronyms(logger);
            this.htmlPersistenceService.resetState(logger); // htmlPersistenceService giờ không còn quản lý acronym nữa
                                                            // nhưng có thể có state khác cần reset (ví dụ browser context nếu tạo lại)

            logger.info("Phase 1: Preparing environment...");
            // Tạo thư mục output cho batch này nếu ConfigService hỗ trợ
            // await this.fileSystemService.ensureDirExists(this.configService.getBatchOutputDir(batchRequestId), logger); // Ví dụ
            await this.fileSystemService.prepareOutputArea(logger); // Giữ lại nếu prepareOutputArea đủ chung chung

            // Ghi input list vào một file có tên theo batchRequestId (tùy chọn)
            // const inputListPath = path.join(this.configService.getBatchOutputDir(batchRequestId), `input_${batchRequestId}.json`);
            // await this.fileSystemService.writeFile(inputListPath, JSON.stringify(conferenceList, null, 2), logger);
            await this.fileSystemService.writeConferenceInputList(conferenceList, logger); // Giữ lại nếu nó ghi vào một nơi chung


            await this.playwrightService.initialize(logger);
            await this.geminiApiService.init(logger, crawlModel);
            this.htmlPersistenceService.setBrowserContext(logger); // Gọi setBrowserContext với logger hiện tại
            // htmlPersistenceService.resetState() đã được gọi ở trên

            logger.info("Environment prepared.");

            logger.info("Phase 2: Scheduling conference processing tasks...");
            const tasks = conferenceList.map((conference, itemIndex) => { // itemIndex là batchItemIndex
                return () => {
                    const processor = container.resolve(ConferenceProcessorService);
                    // Tạo logger con cho mỗi item, bao gồm batchRequestId và batchItemIndex
                    const itemLogger = logger.child({
                        conferenceAcronym: conference.Acronym,
                        conferenceTitle: conference.Title,
                        batchItemIndex: itemIndex // ++ TRUYỀN batchItemIndex
                    });
                    return processor.process(
                        conference,
                        itemIndex,        // ++ TRUYỀN batchItemIndex
                        itemLogger,       // ++ TRUYỀN itemLogger (đã có batchRequestId và batchItemIndex)
                        crawlModel,
                        batchRequestId    // batchRequestId chung cho cả batch API
                        // ConferenceProcessorService sẽ lấy batchItemIndex từ itemLogger.bindings()
                    );
                };
            });

            tasks.forEach(taskFunc => this.taskQueueService.add(taskFunc));
            logger.info(`Scheduled ${tasks.length} tasks.`);

            logger.info("Phase 3: Waiting for all conference processing tasks to complete...");
            await this.taskQueueService.onIdle();
            logger.info("All conference processing tasks finished.");

            logger.info("Phase 3.5: Waiting for background batch save operations to complete...");
            await this.batchProcessingService.awaitCompletion(logger);
            logger.info("All background batch save operations finished.");

            logger.info("Phase 4: Processing final output (JSONL to CSV)...");
            // ++ TRUYỀN batchRequestId cho processOutput
            allProcessedData = await this.resultProcessingService.processOutput(logger, batchRequestId);
            logger.info(`ResultProcessingService finished for batch ${batchRequestId}. Collected ${allProcessedData.length} CSV-ready records.`);

            // ++ SỬA ĐƯỜNG DẪN CSV KHI KIỂM TRA
            const csvPathForThisBatch = this.configService.getEvaluateCsvPathForBatch(batchRequestId);

            if (allProcessedData.length > 0) {
                allProcessedData.forEach(csvRow => {
                    logger.info({
                        event: 'csv_write_record_success',
                        service: 'CrawlOrchestratorService',
                        conferenceAcronym: csvRow.acronym,
                        conferenceTitle: csvRow.title,
                    }, `CSV record for ${csvRow.acronym} considered successfully written.`);
                });
             } else {
                let csvActuallyGenerated = false;
                try {
                    // Kiểm tra file CSV cụ thể của batch này
                    if (fs.existsSync(csvPathForThisBatch) && fs.statSync(csvPathForThisBatch).size > 0) {
                        csvActuallyGenerated = true;
                    }
                } catch (e) { /* ignore stat error if file doesn't exist */ }

                if (csvActuallyGenerated) {
                    logger.info({ event: 'csv_generation_empty_but_file_exists' }, "CSV file generated but no data rows (possibly only headers).");
                } else {
                    logger.info({ event: 'csv_generation_failed_or_empty' }, "CSV file generation failed or resulted in an empty file (no data and possibly no file).");
                }
            }

        } catch (error: any) {
            logger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error', batchRequestId }, `Fatal error during crawling process for batch ${batchRequestId}`);
            crawlError = error;
            if (error.message?.includes('CSV writing stream') || error.message?.includes('final output processing')) {
                logger.error({ event: 'csv_generation_pipeline_failed', err: error }, "CSV generation pipeline failed at orchestrator level.");
            }
        } finally {
            logger.info("Phase 5: Performing final cleanup...");
            await this.playwrightService.close(logger);
            logger.info("Cleanup finished.");

            await this.logSummary(
                operationStartTime,
                conferenceList.length,
                allProcessedData.length,
                crawlModel,
                batchRequestId, // Pass batchRequestId to summary
                logger // Logger này đã có batchRequestId
            );

            logger.info({ event: 'crawl_orchestrator_end', resultsReturned: allProcessedData.length, batchRequestId }, `Crawl process finished for batch ${batchRequestId}.`);
        }

        if (crawlError) {
            throw crawlError;
        }
        // ProcessedRowData nên chứa newRequestId (có thể là batchRequestId hoặc ID con) và thông tin input ban đầu (bao gồm originalRequestId)
        return allProcessedData;
    }

    private async logSummary(
        startTime: number,
        inputCount: number,
        outputCount: number, // Số record trong allProcessedData (từ CSV của batch này)
        crawlModel: CrawlModelType,
        batchRequestId: string,
        logger: Logger
    ): Promise<void> {
        const operationEndTime = Date.now();
        const durationSeconds = Math.round((operationEndTime - startTime) / 1000);
        let finalRecordCountInJsonl = 0;

        // ++ LẤY ĐƯỜNG DẪN JSONL CỤ THỂ CHO BATCH NÀY
        const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestId);

        try {
            if (fs.existsSync(jsonlPathForThisBatch)) {
                const content = fs.readFileSync(jsonlPathForThisBatch, 'utf8');
                finalRecordCountInJsonl = content.split('\n').filter(l => l.trim()).length;
            }
        } catch (readError: any) {
            logger.warn({ err: readError, path: jsonlPathForThisBatch, event: 'final_count_read_error', batchRequestId });
        }

        logger.info({
            event: 'crawl_summary',
            batchRequestId,
            totalConferencesInput: inputCount,
            finalRecordsInJsonlForThisBatch: finalRecordCountInJsonl, // Số record trong JSONL của batch này
            csvRecordsReturnedFromProcessing: outputCount, // Số record trong CSV của batch này
            crawlModelUsed: crawlModel,
            totalGoogleApiRequests: this.apiKeyManager.getTotalRequests(), // Vẫn là global counter
            keysExhausted: this.apiKeyManager.areAllKeysExhausted(),
            durationSeconds,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(operationEndTime).toISOString()
        }, `Crawling process summary for batch ${batchRequestId}`);
    }
}