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
import { CrawlModelType, ApiModels } from '../types/crawl.types';
// ------------------------------------------------------------------

@singleton()
export class CrawlOrchestratorService {
    private readonly configApp: AppConfig;
    private readonly baseLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(PlaywrightService) private playwrightService: PlaywrightService,
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(ResultProcessingService) private resultProcessingService: ResultProcessingService,
        @inject(BatchProcessingService) private batchProcessingService: BatchProcessingService,
        @inject(TaskQueueService) private taskQueueService: TaskQueueService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
    ) {
        this.baseLogger = this.loggingService.getLogger({ service: 'CrawlOrchestratorServiceBase' });
        this.configApp = this.configService.config;
    }

    async run(
        conferenceList: ConferenceData[],
        parentLogger: Logger,
        apiModels: ApiModels, // << THAY ĐỔI Ở ĐÂY
        batchRequestId: string
    ): Promise<ProcessedRowData[]> {
        const logger = parentLogger.child({
            service: 'CrawlOrchestratorRun',
            apiModelsUsed: apiModels, // << Log object models
            // batchRequestId đã được kế thừa
        });

        const operationStartTime = Date.now();
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        logger.info({
            event: 'crawl_orchestrator_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString()
        }, `Starting crawl process within orchestrator for batch ${batchRequestId} using API models (${modelsDesc})`);

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

         try {
            logger.info("Phase 0: Resetting state for new batch...");
            this.batchProcessingService.resetGlobalAcronyms(logger);
            this.htmlPersistenceService.resetState(logger);

            logger.info("Phase 1: Preparing environment...");
            await this.fileSystemService.prepareOutputArea(logger);
            await this.fileSystemService.writeConferenceInputList(conferenceList, logger);

            await this.playwrightService.initialize(logger);
            // Giả sử geminiApiService.init được cập nhật để nhận ApiModels
            // Hoặc, bạn có thể không cần init() ở đây nếu model được chọn cho mỗi request riêng lẻ.
            // Nếu GeminiApiService cần biết trước tất cả các model sẽ được dùng, thì truyền apiModels.
            // Nếu không, logic chọn model sẽ nằm ở nơi gọi geminiApiService.request().
            // Tạm thời giả định init không cần apiModels nữa, hoặc nó tự xử lý.
            // Nếu GeminiApiService cần biết model mặc định hoặc các model cụ thể để khởi tạo, bạn sẽ cần truyền:
            // await this.geminiApiService.init(logger, apiModels); // Cần cập nhật GeminiApiService
            await this.geminiApiService.init(logger); // Hoặc nếu init chỉ là khởi tạo chung

            this.htmlPersistenceService.setBrowserContext(logger);

            logger.info("Environment prepared.");

            logger.info("Phase 2: Scheduling conference processing tasks...");
            const tasks = conferenceList.map((conference, itemIndex) => {
                return () => {
                    const processor = container.resolve(ConferenceProcessorService);
                    const itemLogger = logger.child({
                        conferenceAcronym: conference.Acronym,
                        conferenceTitle: conference.Title,
                        batchItemIndex: itemIndex
                    });
                    // Giả sử ConferenceProcessorService.process được cập nhật để nhận ApiModels
                    return processor.process(
                        conference,
                        itemIndex,
                        itemLogger,
                        apiModels, // << TRUYỀN ApiModels
                        batchRequestId
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
            allProcessedData = await this.resultProcessingService.processOutput(logger, batchRequestId);
            logger.info(`ResultProcessingService finished for batch ${batchRequestId}. Collected ${allProcessedData.length} CSV-ready records.`);

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
                apiModels, // << TRUYỀN ApiModels
                batchRequestId,
                logger
            );

            logger.info({ event: 'crawl_orchestrator_end', resultsReturned: allProcessedData.length, batchRequestId }, `Crawl process finished for batch ${batchRequestId}.`);
        }

        if (crawlError) {
            throw crawlError;
        }
        return allProcessedData;
    }

    private async logSummary(
        startTime: number,
        inputCount: number,
        outputCount: number,
        apiModels: ApiModels, // << THAY ĐỔI Ở ĐÂY
        batchRequestId: string,
        logger: Logger
    ): Promise<void> {
        const operationEndTime = Date.now();
        const durationSeconds = Math.round((operationEndTime - startTime) / 1000);
        let finalRecordCountInJsonl = 0;
        const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestId);

        try {
            if (fs.existsSync(jsonlPathForThisBatch)) {
                const content = fs.readFileSync(jsonlPathForThisBatch, 'utf8');
                finalRecordCountInJsonl = content.split('\n').filter(l => l.trim()).length;
            }
        } catch (readError: any) {
            logger.warn({ err: readError, path: jsonlPathForThisBatch, event: 'final_count_read_error', batchRequestId });
        }

        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        logger.info({
            event: 'crawl_summary',
            batchRequestId,
            totalConferencesInput: inputCount,
            finalRecordsInJsonlForThisBatch: finalRecordCountInJsonl,
            csvRecordsReturnedFromProcessing: outputCount,
            apiModelsUsed: apiModels, // << Log object models
            modelsDescription: modelsDesc, // Log mô tả ngắn
            totalGoogleApiRequests: this.apiKeyManager.getTotalRequests(),
            keysExhausted: this.apiKeyManager.areAllKeysExhausted(),
            durationSeconds,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(operationEndTime).toISOString()
        }, `Crawling process summary for batch ${batchRequestId}`);
    }
}