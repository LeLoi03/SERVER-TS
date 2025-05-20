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
import { ConferenceData, ProcessedRowData } from '../types/crawl.types';
import fs from 'fs';
import { GeminiApiService } from './geminiApi.service';
import { CrawlModelType } from '../types/crawl.types'; // Or wherever you define it

@singleton()
export class CrawlOrchestratorService {
    private readonly config: AppConfig;
    private readonly baseLogger: Logger;

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
        this.baseLogger = this.loggingService.getLogger({ service: 'CrawlOrchestratorServiceBase' });
        this.config = this.configService.config;
    }

    // ++ MODIFIED: Added crawlModel parameter
    async run(
        conferenceList: ConferenceData[],
        parentLogger: Logger,
        crawlModel: CrawlModelType // Or CrawlModelType if you defined it
    ): Promise<ProcessedRowData[]> {
        // Tạo logger cụ thể cho lần chạy này, là con của parentLogger
        // Nó sẽ thừa hưởng requestId và route từ parentLogger, và thêm context mới
        const logger = parentLogger.child({
            service: 'CrawlOrchestratorRun',
            crawlModelUsed: crawlModel // ++ Log the model being used for this run
        });

        const operationStartTime = Date.now();
        logger.info({
            event: 'crawl_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString()
        }, `Starting crawl process within orchestrator using ${crawlModel} model`);

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

        try {
            logger.info("Phase 1: Preparing environment...");
            await this.fileSystemService.prepareOutputArea(logger);
            await this.fileSystemService.writeConferenceInputList(conferenceList, logger);
            await this.playwrightService.initialize(logger);

            // ++ PASS crawlModel to GeminiApiService init if it needs it
            // (Assuming GeminiApiService might use different models or configurations)
            await this.geminiApiService.init(logger, crawlModel);

            this.htmlPersistenceService.setBrowserContext();
            this.htmlPersistenceService.resetState();
            logger.info("Environment prepared.");

            logger.info("Phase 2: Scheduling conference processing tasks...");
            const tasks = conferenceList.map((conference, index) => {
                return () => {
                    const processor = container.resolve(ConferenceProcessorService);
                    // ++ PASS crawlModel to ConferenceProcessorService.process
                    return processor.process(conference, index, logger, crawlModel); // <--- THAY ĐỔI Ở ĐÂY
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
            allProcessedData = await this.resultProcessingService.processOutput(logger);
            logger.info(`ResultProcessingService finished. Collected ${allProcessedData.length} CSV-ready records.`);

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
                    if (fs.existsSync(this.configService.evaluateCsvPath) && fs.statSync(this.configService.evaluateCsvPath).size > 0) {
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
            logger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
            crawlError = error;
            if (error.message?.includes('CSV writing stream') || error.message?.includes('final output processing')) {
                logger.error({ event: 'csv_generation_pipeline_failed', err: error }, "CSV generation pipeline failed at orchestrator level.");
            }
        } finally {
            logger.info("Phase 5: Performing final cleanup...");
            await this.playwrightService.close(logger);
            logger.info("Cleanup finished.");

            // ++ PASS crawlModel to logSummary
            await this.logSummary(operationStartTime, conferenceList.length, allProcessedData.length, crawlModel, logger);

            logger.info({ event: 'crawl_end', resultsReturned: allProcessedData.length }, "Crawl process finished.");
        }

        if (crawlError) {
            throw crawlError;
        }
        return allProcessedData;
    }


    // ++ MODIFIED: Added crawlModel parameter
    private async logSummary(
        startTime: number,
        inputCount: number,
        outputCount: number,
        crawlModel: string, // Or CrawlModelType
        logger: Logger
    ): Promise<void> {
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

        logger.info({
            event: 'crawl_summary',
            totalConferencesInput: inputCount,
            finalRecordsInJsonl: finalRecordCount,
            resultsReturnedFromProcessing: outputCount,
            crawlModelUsed: crawlModel, // ++ Log the model used in summary
            totalGoogleApiRequests: this.apiKeyManager.getTotalRequests(),
            keysExhausted: this.apiKeyManager.areAllKeysExhausted(),
            durationSeconds,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(operationEndTime).toISOString()
        }, "Crawling process summary");
    }
}