import 'reflect-metadata';
import { singleton, inject, DependencyContainer } from 'tsyringe';
import { Logger } from 'pino';

// --- Types ---
import { AppConfig } from '../config/types';
import { ConferenceData, ProcessedRowData, ApiModels } from '../types/crawl/crawl.types';

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
import { RequestStateService } from './requestState.service';
import { InMemoryResultCollectorService } from './inMemoryResultCollector.service';
import { getErrorMessageAndStack } from '../utils/errorUtils';
import { withOperationTimeout } from './batchProcessing/utils';

// <<< THAY ĐỔI 1: IMPORT GLOBAL CONCURRENCY MANAGER >>>
import { GlobalConcurrencyManagerService } from './globalConcurrencyManager.service';

/**
 * Orchestrates the entire crawling and data processing workflow.
 * This service coordinates various sub-services and decides the processing path
 * (file-based vs. in-memory) based on the request state.
 * It uses a request-specific TaskQueueService for task isolation and a global
 * GlobalConcurrencyManagerService to control the overall system load.
 */
@singleton()
export class CrawlOrchestratorService {
    private readonly configApp: AppConfig;
    private readonly baseLogger: Logger;
    private readonly conferenceProcessingTimeoutMs: number;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(HtmlPersistenceService) private htmlPersistenceService: HtmlPersistenceService,
        @inject(BatchProcessingOrchestratorService) private batchProcessingOrchestratorService: BatchProcessingOrchestratorService,
        // TaskQueueService không còn được inject ở đây vì nó sẽ được resolve theo từng request
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
        // <<< THAY ĐỔI 2: INJECT GLOBAL CONCURRENCY MANAGER (SINGLETON) >>>
        @inject(GlobalConcurrencyManagerService) private globalConcurrencyManager: GlobalConcurrencyManagerService
    ) {
        this.baseLogger = this.loggingService.getLogger('conference', { service: 'CrawlOrchestratorServiceBase' });
        this.configApp = this.configService.rawConfig;
        this.conferenceProcessingTimeoutMs = 5 * 60 * 1000; // 5 phút
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
    * @param requestStateService The state service specific to this request.
    * @param requestContainer The dependency container specific to this request.
    * @returns A Promise that resolves with an array of processed conference data.
    */
    async run(
        conferenceList: ConferenceData[],
        parentLogger: Logger,
        apiModels: ApiModels,
        batchRequestId: string,
        requestStateService: RequestStateService,
        requestContainer: DependencyContainer
    ): Promise<ProcessedRowData[]> {
        const logger = parentLogger.child({
            service: 'CrawlOrchestratorRun',
            apiModelsUsed: apiModels,
            batchRequestId: batchRequestId,
        });

        // <<< THAY ĐỔI CỐT LÕI: RESOLVE CÁC SERVICE TỪ REQUEST CONTAINER >>>
        const requestTaskQueue = requestContainer.resolve(TaskQueueService);
        const resultCollector = requestContainer.resolve(InMemoryResultCollectorService);
        const resultProcessingService = requestContainer.resolve(ResultProcessingService);
        // <<< KẾT THÚC THAY ĐỔI >>>

        // const operationStartTime = Date.now();
        const operationStartTime = performance.now(); // Sử dụng performance.now() để có độ chính xác cao hơn

        const shouldRecordFiles = requestStateService.shouldRecordFiles();
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;


        logger.info({
            event: 'crawl_orchestrator_start',
            totalConferences: conferenceList.length,
            requestQueueConcurrency: requestTaskQueue.concurrency, // Log concurrency của queue request
            globalQueueConcurrency: this.globalConcurrencyManager.size, // Log concurrency của queue toàn cục
            startTime: new Date(operationStartTime).toISOString(),
            modelsDescription: modelsDesc,
            recordFile: shouldRecordFiles,
            conferenceTimeoutMs: this.conferenceProcessingTimeoutMs,
        }, `Starting crawl process for batch ${batchRequestId}.`);


        logger.info({
            event: 'ORCHESTRATOR_START', // Đã có sẵn, đổi tên cho nhất quán
            // ...
        }, `Starting crawl process for batch ${batchRequestId}.`);


        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null;

        try {
            // Phase 0 & 1: Reset & Prepare Environment
            resultCollector.clear(); // <<< SỬ DỤNG INSTANCE ĐÃ RESOLVE
            this.batchProcessingOrchestratorService.resetGlobalAcronyms(logger);
            this.htmlPersistenceService.resetState(logger);
            await this.fileSystemService.prepareOutputArea(logger);
            await this.geminiApiService.init(logger);
            this.htmlPersistenceService.setBrowserContext(logger);

            // Phase 2: Scheduling tasks
            const tasks = conferenceList.map((conference, itemIndex) => {
                // <<< THAY ĐỔI: CHUẨN HÓA TITLE VÀ ACRONYM TẠI ĐÂY >>>
                // Regex `/\s*\(.*?\)/g` tìm kiếm:
                // \s*      : khoảng trắng (0 hoặc nhiều) đứng trước dấu (
                // \(.*_?\)  : nội dung bất kỳ bên trong cặp ()
                // g        : global, để thay thế tất cả các lần xuất hiện
                // .trim()  : loại bỏ khoảng trắng thừa ở đầu/cuối chuỗi sau khi thay thế
                const normalizedConference: ConferenceData = {
                    ...conference,
                    Title: conference.Title.replace(/\s*\(.*?\)/g, '').trim(),
                    Acronym: conference.Acronym.replace(/\s*\(.*?\)/g, '').trim(),
                };

                // Hàm task này sẽ được thêm vào hàng đợi của request.
                return async () => {
                    const itemLogger = logger.child({
                        // <<< THAY ĐỔI: SỬ DỤNG DỮ LIỆU ĐÃ CHUẨN HÓA ĐỂ LOGGING >>>
                        conferenceAcronym: normalizedConference.Acronym,
                        conferenceTitle: normalizedConference.Title,
                        batchItemIndex: itemIndex,
                        originalRequestId: normalizedConference.originalRequestId,
                    });
                    const operationName = `Conference Processing: ${normalizedConference.Acronym || normalizedConference.Title || `Item ${itemIndex}`}`;

                    // <<< THAY ĐỔI 4: BỌC LOGIC XỬ LÝ THỰC TẾ VÀO GLOBAL MANAGER >>>
                    // Lệnh `await` ở đây là mấu chốt. Nó đảm bảo rằng task trong hàng đợi của request
                    // (requestTaskQueue) chỉ được coi là hoàn thành (resolved) khi tác vụ bên trong
                    // hàng đợi toàn cục (globalConcurrencyManager) đã thực sự chạy xong.
                    await this.globalConcurrencyManager.run(async () => {
                        try {
                            // Logic xử lý một conference, được resolve từ container của request
                            const processor = requestContainer.resolve(ConferenceProcessorService);
                            await withOperationTimeout(
                                processor.process( // <<< Đảm bảo lời gọi hàm có đủ tham số
                                    normalizedConference,
                                    itemIndex,
                                    itemLogger,
                                    apiModels,
                                    batchRequestId,
                                    requestStateService,
                                    requestContainer // <<< THAM SỐ QUAN TRỌNG CẦN TRUYỀN
                                ),
                                this.conferenceProcessingTimeoutMs,
                                operationName
                            );
                        } catch (processingError: unknown) {
                            // Bắt lỗi từ withOperationTimeout hoặc processor.process
                            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(processingError);
                            itemLogger.error({
                                err: { message: errorMessage, stack: errorStack },
                                event: 'conference_processing_failed_within_gate',
                                operationName: operationName
                            }, `Conference processing task failed inside the global concurrency gate: ${errorMessage}`);
                            // Không re-throw để các task khác trong batch vẫn tiếp tục
                        }
                    });
                };
            });



            // Thêm tất cả các task
            const queueingStartTime = performance.now();
            tasks.forEach(taskFunc => requestTaskQueue.add(taskFunc));
            const queueingDurationMs = performance.now() - queueingStartTime;
            logger.info({
                event: 'ALL_TASKS_QUEUED',
                durationMs: Math.round(queueingDurationMs),
                taskCount: tasks.length
            }, `All ${tasks.length} tasks have been added to the request queue.`);



            // Phase 3 & 3.5: Wait for completion
            logger.info("Waiting for all conference processing tasks in this request to complete...");
            const waitTasksStartTime = performance.now();
            await requestTaskQueue.onIdle();
            const waitTasksDurationMs = performance.now() - waitTasksStartTime;
            logger.info({
                event: 'ALL_TASKS_COMPLETED',
                durationMs: Math.round(waitTasksDurationMs)
            }, "All conference processing tasks for this request have finished.");

            logger.info("Waiting for any background batch save/append operations to complete...");
            await this.batchProcessingOrchestratorService.awaitCompletion(logger);
            logger.info("All background batch operations finished.");

            // Phase 4: Processing Final Output
            logger.info("Phase 4: Processing final output...");
            const finalProcessingStartTime = performance.now();
            if (shouldRecordFiles) {
                logger.info({ event: 'processing_path_file', batchRequestId }, "Processing results via file I/O path (JSONL -> CSV).");
                // Sử dụng instance đã resolve
                allProcessedData = await resultProcessingService.processOutput(logger, batchRequestId);
            } else {
                logger.info({ event: 'processing_path_memory' }, "Processing results via in-memory path.");
                const rawResults = resultCollector.get(); // <<< SỬ DỤNG INSTANCE ĐÃ RESOLVE
                logger.info({ recordCount: rawResults.length }, "Retrieved raw results from in-memory collector.");
                // Sử dụng instance đã resolve
                allProcessedData = await resultProcessingService.processInMemoryData(rawResults, logger);
            }
            const finalProcessingDurationMs = performance.now() - finalProcessingStartTime;
            logger.info({
                event: 'FINAL_PROCESSING_END',
                durationMs: Math.round(finalProcessingDurationMs),
                finalRecordCount: allProcessedData.length
            }, `Result processing finished. Collected ${allProcessedData.length} final records.`);


        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'crawl_fatal_error', batchRequestId }, `Fatal error during crawling process: "${errorMessage}"`);
            crawlError = error instanceof Error ? error : new Error(errorMessage);
        } finally {
            // Phase 5: Cleanup
            logger.info("Phase 5: Performing final cleanup...");
            if (!this.configService.isProduction) {
                await this.fileSystemService.cleanupTempFiles();
                logger.info("Temp files cleanup finished.");
            }
            const totalOrchestratorDurationMs = performance.now() - operationStartTime;


            logger.info({
                event: 'crawl_orchestrator_end',
                durationMs: Math.round(totalOrchestratorDurationMs),
                batchRequestId,
                totalProcessedRecords: allProcessedData.length
            }, `Crawl process finished for batch ${batchRequestId}.`);


            logger.info({
                event: 'ORCHESTRATOR_END', // Đã có sẵn, đổi tên
                durationMs: Math.round(totalOrchestratorDurationMs),
                batchRequestId,
                totalProcessedRecords: allProcessedData.length
            }, `Crawl process finished for batch ${batchRequestId}.`);

        }

        if (crawlError) {
            throw crawlError;
        }

        return allProcessedData;
    }
}