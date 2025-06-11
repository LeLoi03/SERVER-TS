// src/services/crawlOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject, container } from 'tsyringe';
// Import AppConfig from the new types file
import { AppConfig } from '../config/types'; // Changed path
import { ConfigService } from '../config'; // Assuming index.ts in config folder
import { LoggingService } from './logging.service';
import { ApiKeyManager } from './apiKey.manager';
import { PlaywrightService } from './playwright.service';
import { FileSystemService } from './fileSystem.service';
import { HtmlPersistenceService } from './htmlPersistence.service';
import { ResultProcessingService } from './resultProcessing.service';
import { BatchProcessingOrchestratorService } from './batchProcessingOrchestrator.service';
import { TaskQueueService } from './taskQueue.service';
import { ConferenceProcessorService } from './conferenceProcessor.service'; // Assuming this is used later
import { Logger } from 'pino';
import { ConferenceData, ProcessedRowData, ApiModels } from '../types/crawl/crawl.types';
import fs from 'fs';
import { GeminiApiService } from './geminiApi.service';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Orchestrates the entire crawling and data processing workflow.
 * This service coordinates various sub-services like Playwright for crawling,
 * Gemini API for data extraction, file system operations, and result processing.
 * It manages the lifecycle of a batch crawling operation from start to finish.
 */
@singleton()
export class CrawlOrchestratorService {
    private readonly configApp: AppConfig; // This will now hold the rawConfig
    private readonly baseLogger: Logger;

    /**
     * Constructs an instance of CrawlOrchestratorService.
     * Dependencies are injected via tsyringe.
     * @param {ConfigService} configService - Service for application configuration.
     * @param {LoggingService} loggingService - Service for logging operations.
     * @param {ApiKeyManager} apiKeyManager - Manages API keys (e.g., Google Custom Search).
     * @param {PlaywrightService} playwrightService - Handles web scraping using Playwright.
     * @param {FileSystemService} fileSystemService - Manages file and directory operations.
     * @param {HtmlPersistenceService} htmlPersistenceService - Manages saving HTML content.
     * @param {ResultProcessingService} resultProcessingService - Processes raw API outputs into structured data.
     * @param {BatchProcessingOrchestratorService} batchProcessingOrchestratorService - Manages batch processing of conferences.
     * @param {TaskQueueService} taskQueueService - Manages concurrent tasks.
     * @param {GeminiApiService} geminiApiService - Handles interactions with the Gemini API.
     */
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
    ) {
        this.baseLogger = this.loggingService.getLogger('conference', { service: 'CrawlOrchestratorServiceBase' });
        // Initialize configApp with rawConfig from ConfigService
        this.configApp = this.configService.rawConfig; // Corrected
    }

    /**
     * Executes the main crawling and processing pipeline for a list of conferences.
     * This method orchestrates all phases: environment setup, task scheduling,
     * waiting for completion, result processing, and cleanup.
     *
     * @param {ConferenceData[]} conferenceList - An array of conference data to be processed.
     * @param {Logger} parentLogger - The parent Pino logger instance for contextual logging.
     * @param {ApiModels} apiModels - An object specifying which model type ('tuned' or 'non-tuned') to use for each API stage.
     * @param {string} batchRequestId - A unique identifier for the current batch processing request.
     * @returns {Promise<ProcessedRowData[]>} A Promise that resolves with an array of processed conference data,
     *                                      ready for CSV output or frontend display.
     * @throws {Error} If a fatal error occurs during the crawling process.
     */
    async run(
        conferenceList: ConferenceData[],
        parentLogger: Logger,
        apiModels: ApiModels,
        batchRequestId: string
    ): Promise<ProcessedRowData[]> {
        const logger = parentLogger.child({
            service: 'CrawlOrchestratorRun',
            apiModelsUsed: apiModels, // Log the API models used for this run
            batchRequestId: batchRequestId, // Ensure batchRequestId is explicitly bound for all child logs
        });

        const operationStartTime = Date.now();
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        logger.info({
            event: 'crawl_orchestrator_start',
            totalConferences: conferenceList.length,
            concurrency: this.taskQueueService.concurrency,
            startTime: new Date(operationStartTime).toISOString(),
            modelsDescription: modelsDesc,
        }, `Starting crawl process within orchestrator for batch ${batchRequestId} using API models (${modelsDesc}).`);

        let allProcessedData: ProcessedRowData[] = [];
        let crawlError: Error | null = null; // Store any fatal error to re-throw later

        try {
            logger.info("Phase 0: Resetting service states for new batch...");
            this.batchProcessingOrchestratorService.resetGlobalAcronyms(logger); // Clears global acronyms set
            this.htmlPersistenceService.resetState(logger); // Clears temporary HTML file mappings

            logger.info("Phase 1: Preparing environment (filesystem, playwright, Gemini API)...");
            await this.fileSystemService.prepareOutputArea(logger); // Ensures output directories exist and are clean
            await this.fileSystemService.writeConferenceInputList(conferenceList, logger); // Writes the input list to a file for record-keeping

            await this.playwrightService.initialize(logger); // Initializes Playwright browser context
            // Note: GeminiApiService.init() might not need `apiModels` directly,
            // as specific model selection often happens per-request within `GeminiApiService.request()`.
            // We pass `apiModels` to `ConferenceProcessorService` which then uses it for each API call.
            await this.geminiApiService.init(logger); // Initializes Gemini API client (e.g., sets up credentials)

            this.htmlPersistenceService.setBrowserContext(logger); // Sets Playwright browser context for HTML saving

            logger.info("Environment prepared successfully.");

            logger.info("Phase 2: Scheduling conference processing tasks...");
            const tasks = conferenceList.map((conference, itemIndex) => {
                return async () => { // Make sure the task function is async
                    // Resolve ConferenceProcessorService instance for each task to ensure it's stateless or has fresh state
                    const processor = container.resolve(ConferenceProcessorService);
                    const itemLogger = logger.child({
                        conferenceAcronym: conference.Acronym,
                        conferenceTitle: conference.Title,
                        batchItemIndex: itemIndex,
                        originalRequestId: conference.originalRequestId, // Carry original request ID if available
                    });
                    // Call the processor's process method, passing the specific API models for this batch
                    return processor.process(
                        conference,
                        itemIndex,
                        itemLogger,
                        apiModels, // Pass the ApiModels object to the processor
                        batchRequestId
                    );
                };
            });

            tasks.forEach(taskFunc => this.taskQueueService.add(taskFunc));
            logger.info(`Scheduled ${tasks.length} conference processing tasks with concurrency ${this.taskQueueService.concurrency}.`);

            logger.info("Phase 3: Waiting for all conference processing tasks to complete...");
            await this.taskQueueService.onIdle(); // Waits until all scheduled tasks are finished
            logger.info("All conference processing tasks finished.");

            logger.info("Phase 3.5: Waiting for background batch save operations to complete...");
            await this.batchProcessingOrchestratorService.awaitCompletion(logger); // Ensures all background JSONL writes are done
            logger.info("All background batch save operations finished.");

            logger.info("Phase 4: Processing final output (reading JSONL and writing CSV)...");
            // This step converts the raw JSONL outputs into the final CSV-ready format
            allProcessedData = await this.resultProcessingService.processOutput(logger, batchRequestId);
            logger.info(`ResultProcessingService finished for batch ${batchRequestId}. Collected ${allProcessedData.length} CSV-ready records.`);

            const csvPathForThisBatch = this.configService.getEvaluateCsvPathForBatch(batchRequestId);

            // Additional check to log the state of the CSV output file
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


        } catch (error: unknown) { // Catch as unknown for consistent error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'crawl_fatal_error', batchRequestId }, `Fatal error during crawling process for batch ${batchRequestId}: "${errorMessage}"`);
            crawlError = error instanceof Error ? error : new Error(errorMessage); // Ensure it's an Error object if re-throwing

            // Specific logging for CSV pipeline failures if error message matches
            if (errorMessage?.includes('CSV writing stream') || errorMessage?.includes('final output processing')) {
                logger.error({ event: 'csv_generation_pipeline_failed', err: { message: errorMessage, stack: errorStack } }, "CSV generation pipeline failed at orchestrator level due to stream or final processing error.");
            }
        } finally {
            logger.info("Phase 5: Performing final cleanup (closing browser, etc.)...");
            await this.playwrightService.close(logger); // Ensures Playwright browser is closed
            logger.info("Cleanup finished.");

            // Log a summary of the entire crawl operation
            await this.logSummary(
                operationStartTime,
                conferenceList.length,
                allProcessedData.length,
                apiModels,
                batchRequestId,
                logger
            );

            logger.info({ event: 'crawl_orchestrator_end', batchRequestId, totalProcessedRecords: allProcessedData.length }, `Crawl process finished for batch ${batchRequestId}.`);
        }

        // Re-throw the stored fatal error if one occurred
        if (crawlError) {
            throw crawlError;
        }
        return allProcessedData;
    }

    /**
     * Logs a summary of the completed crawling operation.
     * This includes metrics like duration, input/output counts, model usage, and API key status.
     *
     * @param {number} startTime - The Unix timestamp (milliseconds) when the `run` method started.
     * @param {number} inputCount - The number of conference items initially provided as input.
     * @param {number} outputCount - The number of processed records returned by `ResultProcessingService`.
     * @param {ApiModels} apiModels - The object specifying which model type was used for each API stage.
     * @param {string} batchRequestId - The unique identifier for the current batch.
     * @param {Logger} logger - The logger instance for logging the summary.
     * @returns {Promise<void>} A Promise that resolves when the summary has been logged.
     */
    private async logSummary(
        startTime: number,
        inputCount: number,
        outputCount: number,
        apiModels: ApiModels,
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
        } catch (readError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(readError);
            logger.warn({ err: { message: errorMessage, stack: errorStack }, path: jsonlPathForThisBatch, event: 'final_jsonl_count_read_error', batchRequestId }, `Warning: Could not read final JSONL record count for batch ${batchRequestId}: "${errorMessage}".`);
        }

        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        logger.info({
            event: 'crawl_summary',
            totalConferencesInput: inputCount,
            finalRecordsInJsonlForThisBatch: finalRecordCountInJsonl,
            csvRecordsReturnedFromProcessing: outputCount,
            modelsDescription: modelsDesc,
            totalGoogleApiRequests: this.apiKeyManager.getTotalRequests(),
            keysExhausted: this.apiKeyManager.areAllKeysExhausted(),
            durationSeconds,
            startTime: new Date(startTime).toISOString(),
            endTime: new Date(operationEndTime).toISOString(),
            batchRequestId: batchRequestId, // Ensure batchRequestId is in the log context
        }, `Crawling process summary for batch ${batchRequestId}.`);
    }
}