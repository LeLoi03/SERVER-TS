import 'reflect-metadata';
import { singleton, inject, container } from 'tsyringe';
import fs from 'fs';
import { Logger } from 'pino';

// --- Types ---
import { AppConfig } from '../config/types';
import { ConferenceData, ProcessedRowData, ApiModels, InputRowData } from '../types/crawl/crawl.types';

// --- Service Imports ---
import { ConfigService } from '../config';
import { LoggingService } from './logging.service';
import { ApiKeyManager } from './apiKey.manager';
import { PlaywrightService } from './playwright.service';
import { FileSystemService } from './fileSystem.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { ResultProcessingService } from './resultProcessing.service';
import { BatchProcessingOrchestratorService } from './batchProcessingOrchestrator.service';
import { TaskQueueService } from './taskQueue.service';
import { ConferenceProcessorService } from './conferenceProcessor.service';
import { GeminiApiService } from './geminiApi.service';
import { RequestStateService } from './requestState.service'; // <<< IMPORT MỚI
import { getErrorMessageAndStack } from '../utils/errorUtils';
import { InMemoryResultCollectorService } from './inMemoryResultCollector.service'; // <<< IMPORT MỚI

/**
 * Orchestrates the entire crawling and data processing workflow.
 * This service coordinates various sub-services and decides the processing path
 * (file-based vs. in-memory) based on the request state.
 */
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
        @inject(BatchProcessingOrchestratorService) private batchProcessingOrchestratorService: BatchProcessingOrchestratorService,
        @inject(TaskQueueService) private taskQueueService: TaskQueueService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
        @inject(RequestStateService) private readonly requestStateService: RequestStateService,
        @inject(InMemoryResultCollectorService) private readonly resultCollector: InMemoryResultCollectorService, // <<< INJECT MỚI

    ) {
        this.baseLogger = this.loggingService.getLogger('conference', { service: 'CrawlOrchestratorServiceBase' });
        this.configApp = this.configService.rawConfig;
    }

    /**
     * Executes the main crawling and processing pipeline for a list of conferences.
     * This method orchestrates all phases and dynamically chooses the result processing
     * strategy based on the `recordFile` flag managed by RequestStateService.
     *
     * @param conferenceList An array of conference data to be processed.
     * @param parentLogger The parent Pino logger instance for contextual logging.
     * @param apiModels An object specifying which model type to use for each API stage.
     * @param batchRequestId A unique identifier for the current batch processing request.
     * @returns A Promise that resolves with an array of processed conference data.
     */
    async run(
        conferenceList: ConferenceData[],
        parentLogger: Logger,
        apiModels: ApiModels,
        batchRequestId: string
    ): Promise<ProcessedRowData[]> {
        const logger = parentLogger.child({
            service: 'CrawlOrchestratorRun',
            apiModelsUsed: apiModels,
            batchRequestId: batchRequestId,
        });

        const operationStartTime = Date.now();
        const shouldRecordFiles = this.requestStateService.shouldRecordFiles(); // Lấy trạng thái một lần
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;

        logger.info({
            event: 'crawl_orchestrator_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString(),
            modelsDescription: modelsDesc,
            recordFile: shouldRecordFiles, // Log chế độ hoạt động
        }, `Starting crawl process for batch ${batchRequestId}. Record files: ${shouldRecordFiles}.`);

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

        try {
            // Phase 0 & 1: Reset & Prepare Environment (Không thay đổi)
            // <<< THAY ĐỔI NƠI XÓA DỮ LIỆU CŨ >>>
            this.resultCollector.clear(); // Xóa bộ sưu tập khi bắt đầu một lần chạy mới
            this.batchProcessingOrchestratorService.resetGlobalAcronyms(logger);
            this.htmlPersistenceService.resetState(logger);
            await this.fileSystemService.prepareOutputArea(logger);
            await this.playwrightService.initialize(logger);
            await this.geminiApiService.init(logger);
            this.htmlPersistenceService.setBrowserContext(logger);

            // Phase 2: Scheduling tasks (Không thay đổi)
            // Logic bên trong các task sẽ tự động xử lý việc ghi file hay lưu vào bộ nhớ
            // nhờ vào FinalRecordAppenderService đã được cập nhật.
            const tasks = conferenceList.map((conference, itemIndex) => {
                return async () => {
                    const processor = container.resolve(ConferenceProcessorService);
                    const itemLogger = logger.child({
                        conferenceAcronym: conference.Acronym,
                        conferenceTitle: conference.Title,
                        batchItemIndex: itemIndex,
                        originalRequestId: conference.originalRequestId,
                    });
                    return processor.process(
                        conference,
                        itemIndex,
                        itemLogger,
                        apiModels,
                        batchRequestId
                    );
                };
            });
            tasks.forEach(taskFunc => this.taskQueueService.add(taskFunc));

            // Phase 3 & 3.5: Wait for completion (Không thay đổi)
            logger.info("Waiting for all conference processing tasks to complete...");
            await this.taskQueueService.onIdle();
            logger.info("All conference processing tasks finished.");
            logger.info("Waiting for background batch save/append operations to complete...");
            await this.batchProcessingOrchestratorService.awaitCompletion(logger);
            logger.info("All background batch operations finished.");

            // <<< PHASE 4: PROCESSING FINAL OUTPUT (LOGIC RẼ NHÁNH) >>>
            logger.info("Phase 4: Processing final output...");
            if (shouldRecordFiles) {
                // --- LUỒNG CŨ: Ghi file và xử lý từ file ---
                logger.info({ event: 'processing_path_file', batchRequestId }, "Processing results via file I/O path (JSONL -> CSV).");
                allProcessedData = await this.resultProcessingService.processOutput(logger, batchRequestId);
            } else {
                logger.info({ event: 'processing_path_memory' }, "Processing results via in-memory path.");
                // <<< THAY ĐỔI NƠI LẤY DỮ LIỆU >>>
                const rawResults = this.resultCollector.get();
                logger.info({ recordCount: rawResults.length }, "Retrieved raw results from in-memory collector.");
                allProcessedData = await this.resultProcessingService.processInMemoryData(rawResults, logger);
            }
            logger.info(`Result processing finished. Collected ${allProcessedData.length} final records.`);

            // Phần log kiểm tra CSV sau đó vẫn hoạt động. Nếu không ghi file, nó sẽ log là file không tồn tại, điều này là đúng.
            if (allProcessedData.length > 0) {
                logger.info({ event: 'data_collection_success', count: allProcessedData.length }, `Successfully collected ${allProcessedData.length} processed records for the response.`);
            } else {
                logger.warn({ event: 'data_collection_empty' }, "Final processed data collection is empty.");
            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'crawl_fatal_error', batchRequestId }, `Fatal error during crawling process: "${errorMessage}"`);
            crawlError = error instanceof Error ? error : new Error(errorMessage);
        } finally {
            // Phase 5: Cleanup (Không thay đổi)
            logger.info("Phase 5: Performing final cleanup...");
            await this.playwrightService.close(logger);
            if (!this.configService.isProduction) {
                await this.fileSystemService.cleanupTempFiles();
                logger.info("Temp files cleanup finished.");
            }

            logger.info({ event: 'crawl_orchestrator_end', batchRequestId, totalProcessedRecords: allProcessedData.length }, `Crawl process finished for batch ${batchRequestId}.`);
        }

        if (crawlError) {
            throw crawlError;
        }

        // Luôn trả về dữ liệu đã xử lý, đảm bảo log trong controller có đủ thông tin.
        return allProcessedData;
    }
}