// src/services/batchProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs'; // Keep for basic checks like existsSync if needed
import path from 'path';
import { Page, BrowserContext, Response } from 'playwright'; // Response might not be needed here anymore

// --- Utilities ---
// normalizeAndJoinLink is now used by specific services if they need it directly

// --- Domain Logic Utils (Kept as imports if pure functions, now mostly used by sub-services) ---
// import { cleanDOM, traverseNodes, removeExtraEmptyLines } from '../utils/crawl/domProcessing'; // Used by PageContentExtractorService

// --- Types ---
import { BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData } from '../types/crawl.types';
export { BatchEntry, BatchUpdateEntry }; // Re-export if needed by consumers of this service

// --- Service Imports ---
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service'; // For base logger
import { GeminiApiService, ApiResponse, GeminiApiParams } from './geminiApi.service';
import { FileSystemService } from './fileSystem.service';
import { IPageContentExtractorService } from './batchProcessingServiceChild/pageContentExtractor.service';
import { IConferenceLinkProcessorService } from './batchProcessingServiceChild/conferenceLinkProcessor.service';
import { IConferenceDeterminationService } from './batchProcessingServiceChild/conferenceDetermination.service';
import { IConferenceDataAggregatorService, ContentPaths } from './batchProcessingServiceChild/conferenceDataAggregator.service';


// Other Imports
import { Logger } from 'pino';


// LogContext types might need to be adjusted or made more generic if they are to be shared
export type LogContextBase = {
    batchIndex: number;
    conferenceAcronym: string | undefined;
    conferenceTitle: string | undefined;
    function: string;
    apiCallNumber?: 1 | 2;
    // Add other fields if they are consistently part of the base context
};

// --- Specific Log Context Type for this Module ---
// Inherit from the base context provided by LoggingService
export interface BatchProcessingLogContext extends LogContextBase {
    // Fields specific to batch processing
    batchIndex: number;
    conferenceAcronym: string;
    conferenceTitle: string;
    fileType?: 'full_links' | 'main_link' | 'update_intermediate' | 'determine_response' | 'extract_response' | 'cfp_response' | 'initial_text';
    aggregationPurpose?: 'determine_api' | 'extract_cfp_api';
    apiType?: 'determine' | 'extract' | 'cfp';
    contentType?: 'main' | 'cfp' | 'imp';
    event_group?: string;

    // --- Fields specific to link processing context ---
    linkIndex?: number;
    originalUrl?: string;
    url?: string;
    finalUrl?: string;
    linkType?: 'main' | 'cfp' | 'imp' | 'modified' | 'original';
    status?: number | null; // HTTP status
}
@singleton()
export class BatchProcessingService {
    private readonly serviceBaseLogger: Logger;
    private readonly configService: ConfigService;
    private readonly geminiApiService: GeminiApiService;
    private readonly fileSystemService: FileSystemService;
    private readonly pageContentExtractorService: IPageContentExtractorService;
    private readonly conferenceLinkProcessorService: IConferenceLinkProcessorService;
    private readonly conferenceDeterminationService: IConferenceDeterminationService;
    private readonly conferenceDataAggregatorService: IConferenceDataAggregatorService;


    private readonly batchesDir: string;
    private readonly finalOutputPath: string;
    private readonly tempDir: string;
    private readonly errorLogPath: string;

    private activeBatchSaves: Set<Promise<boolean>> = new Set();

    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
        @inject(GeminiApiService) geminiApiService: GeminiApiService,
        @inject(FileSystemService) fileSystemService: FileSystemService,
        @inject('IPageContentExtractorService') pageContentExtractorService: IPageContentExtractorService,
        @inject('IConferenceLinkProcessorService') conferenceLinkProcessorService: IConferenceLinkProcessorService,
        @inject('IConferenceDeterminationService') conferenceDeterminationService: IConferenceDeterminationService,
        @inject('IConferenceDataAggregatorService') conferenceDataAggregatorService: IConferenceDataAggregatorService
    ) {
        this.configService = configService;
        this.geminiApiService = geminiApiService;
        this.fileSystemService = fileSystemService;
        this.pageContentExtractorService = pageContentExtractorService;
        this.conferenceLinkProcessorService = conferenceLinkProcessorService;
        this.conferenceDeterminationService = conferenceDeterminationService;
        this.conferenceDataAggregatorService = conferenceDataAggregatorService;

        this.serviceBaseLogger = loggingService.getLogger({ service: 'BatchProcessingServiceOrchestrator' });

        this.batchesDir = this.configService.batchesDir;
        this.finalOutputPath = this.configService.finalOutputJsonlPath;
        this.tempDir = this.configService.tempDir;
        this.errorLogPath = path.join(this.configService.baseOutputDir, 'batch_processing_errors.log'); // More specific error log

        this.serviceBaseLogger.info("BatchProcessingService constructed.");
        this.serviceBaseLogger.info(`Batches Directory: ${this.batchesDir}`);
        this.serviceBaseLogger.info(`Final Output Path: ${this.finalOutputPath}`);
        this.serviceBaseLogger.info(`Temp Directory: ${this.tempDir}`);
    }

    private async ensureDirectories(paths: string[], loggerToUse?: Logger): Promise<void> {
        const logger = loggerToUse || this.serviceBaseLogger;
        const logContext = { function: 'ensureDirectories', service: 'BatchProcessingServiceOrchestrator' };
        for (const dirPath of paths) {
            const dir = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
                ? dirPath
                : path.dirname(dirPath);

            if (!fs.existsSync(dir)) {
                logger.info({ ...logContext, path: dir, event: 'batch_processing_ensure_dir_create_attempt' }); // Đổi event cho rõ
                try {
                    await this.fileSystemService.ensureDirExists(dir, logger);
                } catch (mkdirError: unknown) {
                    // SỬA EVENT NAME
                    logger.error({ ...logContext, path: dir, err: mkdirError, event: 'save_batch_dir_create_failed' });
                    throw mkdirError;
                }
            }
        }
    }

    /**
    * Executes extractInformation and extractCfp APIs in parallel using GeminiApiService.
    * This remains in the orchestrator as it's a distinct final API step.
    */
    private async executeFinalExtractionApis( // Renamed for clarity
        contentSendToAPI: string,
        batchIndex: number,
        titleForApis: string,
        acronymForApis: string,
        safeConferenceAcronym: string,
        isUpdate: boolean,
        parentLogger: Logger
    ): Promise<{
        extractResponseTextPath?: string;
        extractMetaData: any | null;
        cfpResponseTextPath?: string;
        cfpMetaData: any | null;
    }> {
        const logger = parentLogger.child({
            batchServiceFunction: 'executeFinalExtractionApis',
            isUpdateContext: isUpdate,
            service: 'BatchProcessingServiceOrchestrator'
        });

        const suffix = isUpdate ? `_update_response_${batchIndex}` : `_response_${batchIndex}`;
        const extractFileBase = `${safeConferenceAcronym}_extract${suffix}`;
        const cfpFileBase = `${safeConferenceAcronym}_cfp${suffix}`;

        // SỬA EVENT NAME (thêm flow)
        logger.info({ event: 'batch_processing_parallel_final_apis_start', flow: isUpdate ? 'update' : 'save' });

        const commonApiParams: Omit<GeminiApiParams, 'batch'> = {
            batchIndex, title: titleForApis, acronym: acronymForApis,
        };

        const extractPromise = (async () => {
            const extractApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_EXTRACT });
            extractApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_extract_api_call_start' });
            try {
                const response = await this.geminiApiService.extractInformation(
                    { ...commonApiParams, batch: contentSendToAPI, }, extractApiLogger
                );
                const path = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", extractFileBase, extractApiLogger
                );
                extractApiLogger.info({ responseLength: response.responseText?.length, filePath: path, event: 'batch_processing_final_extract_api_call_end', success: !!path });
                return { responseTextPath: path, metaData: response.metaData };
            } catch (error: any) {
                // SỬA EVENT NAME và thêm context
                extractApiLogger.error({ err: error, event: 'save_batch_extract_api_call_failed', apiType: this.geminiApiService.API_TYPE_EXTRACT });
                return { responseTextPath: undefined, metaData: null };
            }
        })();

        const cfpPromise = (async () => {
            const cfpApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_CFP });
            cfpApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_cfp_api_call_start' });
            try {
                const response = await this.geminiApiService.extractCfp(
                    { ...commonApiParams, batch: contentSendToAPI, }, cfpApiLogger
                );
                const path = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", cfpFileBase, cfpApiLogger
                );
                cfpApiLogger.info({ responseLength: response.responseText?.length, filePath: path, event: 'batch_processing_final_cfp_api_call_end', success: !!path });
                return { responseTextPath: path, metaData: response.metaData };
            } catch (error: any) {
                // SỬA EVENT NAME và thêm context
                cfpApiLogger.error({ err: error, event: 'save_batch_cfp_api_call_failed', apiType: this.geminiApiService.API_TYPE_CFP });
                return { responseTextPath: undefined, metaData: null };
            }
        })();

        const [extractResult, cfpResult] = await Promise.all([extractPromise, cfpPromise]);
        logger.info({
            event: 'batch_processing_parallel_final_apis_finished',
            extractSuccess: !!extractResult.responseTextPath,
            cfpSuccess: !!cfpResult.responseTextPath,
            flow: isUpdate ? 'update' : 'save'
        });
        if (!extractResult.responseTextPath && !cfpResult.responseTextPath) {
            // SỬA EVENT NAME
            logger.error({ event: 'save_batch_parallel_final_apis_both_failed', flow: isUpdate ? 'update' : 'save' });
        }
        return {
            extractResponseTextPath: extractResult.responseTextPath,
            extractMetaData: extractResult.metaData,
            cfpResponseTextPath: cfpResult.responseTextPath,
            cfpMetaData: cfpResult.metaData,
        };
    }





    public async processConferenceUpdate(
        browserContext: BrowserContext,
        conference: ConferenceUpdateData,
        batchIndexRef: { current: number },
        parentLogger: Logger
    ): Promise<boolean> {
        const currentBatchIndex = batchIndexRef.current;
        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceUpdate',
            batchIndex: currentBatchIndex,
            conferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            service: 'BatchProcessingServiceOrchestrator'
        });
        methodLogger.info({ event: 'batch_processing_flow_start', flow: 'update' }); // Tổng quát hơn
        const pages: Page[] = [];

        try {
            let mainPage: Page | null = null, cfpPage: Page | null = null, impPage: Page | null = null;

            if (conference.mainLink) {
                mainPage = await browserContext.newPage(); pages.push(mainPage); methodLogger.info({ event: 'main_page_created' });
            } else {
                methodLogger.error({ event: 'main_page_creation_skipped_no_link' }); return false;
            }

            const needsCfpNav = conference.cfpLink && !conference.cfpLink.toLowerCase().endsWith('.pdf') && conference.cfpLink.trim().toLowerCase() !== 'none';
            if (needsCfpNav) {
                cfpPage = await browserContext.newPage(); pages.push(cfpPage); methodLogger.info({ event: 'cfp_page_created' });
            } else {
                methodLogger.info({ event: 'cfp_page_creation_skipped', reason: !conference.cfpLink ? 'no link' : (conference.cfpLink.toLowerCase().endsWith('.pdf') ? 'pdf link' : 'none link') });
            }

            const needsImpNav = conference.impLink && !conference.impLink.toLowerCase().endsWith('.pdf') && conference.impLink.trim().toLowerCase() !== 'none';
            const isImpSameAsNavigableCfp = needsImpNav && needsCfpNav && conference.impLink === conference.cfpLink;

            if (needsImpNav && !isImpSameAsNavigableCfp) {
                impPage = await browserContext.newPage(); pages.push(impPage); methodLogger.info({ event: 'imp_page_created' });
            } else if (needsImpNav && isImpSameAsNavigableCfp) {
                methodLogger.info({ event: 'imp_page_creation_skipped', reason: 'same as navigable cfp link' });
            } else {
                methodLogger.info({ event: 'imp_page_creation_skipped', reason: !conference.impLink ? 'no link' : (conference.impLink.toLowerCase().endsWith('.pdf') ? 'pdf link' : 'none link') });
            }

            methodLogger.info({ event: 'parallel_link_fetch_start_update_flow' });

            // Pass child loggers to service calls
            const mainPromise = mainPage ? this.conferenceLinkProcessorService.processMainLinkForUpdate(mainPage, conference, methodLogger.child({ linkType: 'main_update' })) : Promise.resolve({ finalUrl: null, textPath: null });
            // For CFP/IMP, if no page was created (e.g. PDF), pass null for page. The service handles it.
            const cfpPromise = this.conferenceLinkProcessorService.processCfpLinkForUpdate(cfpPage, conference, methodLogger.child({ linkType: 'cfp_update' }));

            // IMP processing depends on CFP result for path if they are the same
            let impPromise: Promise<string | null>;
            if (isImpSameAsNavigableCfp) {
                // If imp is same as cfp, its result path will be cfp's result path.
                // No separate processing needed beyond what cfpPromise does.
                // We'll use the result of cfpPromise later.
                impPromise = cfpPromise.then(cfpPath => {
                    methodLogger.info({ event: 'imp_link_resolved_as_same_as_cfp_update', cfpPath });
                    return cfpPath ? "" : null; // "" if cfp had content, null if cfp also failed
                });
            } else {
                // If impPage is null (e.g. PDF or no link), service handles it
                impPromise = cfpPromise.then(cfpPath => // ensure cfpPromise settled to get cfpPath
                    this.conferenceLinkProcessorService.processImpLinkForUpdate(impPage, conference, cfpPath, methodLogger.child({ linkType: 'imp_update' }))
                );
            }


            const results = await Promise.allSettled([mainPromise, cfpPromise, impPromise]);
            methodLogger.info({ event: 'parallel_link_fetch_settled_update_flow' });

            let mainResult = { finalUrl: null, textPath: null };
            if (results[0].status === 'fulfilled') mainResult = (results[0] as PromiseFulfilledResult<any>).value;
            else methodLogger.error({ event: 'main_link_processing_failed_update', err: (results[0] as PromiseRejectedResult).reason });

            let cfpTextPath: string | null = null;
            if (results[1].status === 'fulfilled') cfpTextPath = (results[1] as PromiseFulfilledResult<string | null>).value;
            else methodLogger.error({ event: 'cfp_link_processing_failed_update', err: (results[1] as PromiseRejectedResult).reason });

            let impTextPath: string | null = null;
            if (results[2].status === 'fulfilled') impTextPath = (results[2] as PromiseFulfilledResult<string | null>).value;
            else methodLogger.error({ event: 'imp_link_processing_failed_update', err: (results[2] as PromiseRejectedResult).reason });


            if (!mainResult.textPath) {
                // SỬA EVENT NAME
                methodLogger.error({ event: 'batch_processing_abort_no_main_text', flow: 'update', reason: 'Main text path missing after link processing' });
                await this._closePages(pages, methodLogger);
                return false;
            }

            const batchData: BatchUpdateEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym,
                conferenceTextPath: mainResult.textPath,
                cfpTextPath: cfpTextPath,
                impTextPath: impTextPath,
            };

            batchIndexRef.current++; // Increment for next task
            methodLogger.info({ nextBatchIndex: batchIndexRef.current, event: 'batch_index_incremented_update_flow' });

            const updateSuccess = await this._executeBatchTaskForUpdate(batchData, currentBatchIndex, methodLogger);
            // SỬA EVENT NAME
            methodLogger.info({ event: 'batch_processing_flow_finish', success: updateSuccess, flow: 'update' });
            return updateSuccess;
        } catch (error: any) {
            // SỬA EVENT NAME
            methodLogger.error({ err: error, event: 'save_batch_unhandled_error_or_rethrown', flow: 'update_initiation_error' });
            return false;
        } finally {
            await this._closePages(pages, methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceUpdate.");
        }
    }

    public async processConferenceSave(
        browserContext: BrowserContext,
        conference: ConferenceData,
        links: string[],
        batchIndexRef: { current: number },
        existingAcronyms: Set<string>,
        parentLogger: Logger
    ): Promise<boolean> {
        const year = this.configService.config.YEAR2;
        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceSave',
            initialLinkCount: links.length,
            processingYear: year,
            conferenceAcronym: conference.Acronym, // From original conference data
            conferenceTitle: conference.Title,     // From original conference data
            service: 'BatchProcessingServiceOrchestrator'
        });
        methodLogger.info({ event: 'batch_processing_flow_start', flow: 'save_initiation' });

        if (!links || links.length === 0) {
            methodLogger.warn({ event: 'batch_processing_skipped_no_links_for_save' }); return false; // Event cụ thể hơn
        }

        let page: Page | null = null;
        const batchForDetermineApi: BatchEntry[] = []; // Collect results from linkProcessorService
        let linkProcessingSuccessCount = 0;
        let linkProcessingFailedCount = 0;

        try {
            page = await browserContext.newPage();
            methodLogger.info({ event: 'page_created_for_save_flow' });

            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const singleLinkLogger = methodLogger.child({ linkProcessingIndex: i, originalLinkForProcessing: link });
                try {
                    // SỬA Ở ĐÂY: Truyền tham số riêng lẻ
                    const batchEntry = await this.conferenceLinkProcessorService.processInitialLinkForSave(
                        page,                         // page
                        link,                         // link
                        i,                            // linkIndex
                        conference,                   // conference
                        year,                         // year
                        existingAcronyms,             // existingAcronyms
                        singleLinkLogger              // logger
                    );

                    if (batchEntry) {
                        batchForDetermineApi.push(batchEntry);
                        linkProcessingSuccessCount++;
                    } else {
                        linkProcessingFailedCount++;
                    }
                } catch (linkError: any) {
                    linkProcessingFailedCount++;
                    singleLinkLogger.error({ err: linkError, event: 'link_processing_loop_unhandled_error_save_flow' });
                }
            }
            methodLogger.info({
                linksProcessed: links.length, successfulLinks: linkProcessingSuccessCount,
                failedLinks: linkProcessingFailedCount, batchEntriesCreated: batchForDetermineApi.length,
                event: 'all_links_processed_for_save_flow'
            });

            if (batchForDetermineApi.length > 0) {
                const currentBatchIndexForThisTask = batchIndexRef.current;
                batchIndexRef.current++;

                // Use acronym from the first successful entry for task logging context, or original if none.
                const taskAcronymContext = batchForDetermineApi[0]?.conferenceAcronym || conference.Acronym;
                const taskTitleContext = batchForDetermineApi[0]?.conferenceTitle || conference.Title;

                const batchTaskLogger = methodLogger.child({
                    asyncBatchTask: '_executeBatchTaskForSave',
                    batchIndexForAsyncTask: currentBatchIndexForThisTask,
                    // These ensure the logger for the async task has the right conference context
                    // even if methodLogger's direct conferenceAcronym/Title was from the overall job.
                    conferenceAcronym: taskAcronymContext,
                    conferenceTitle: taskTitleContext,
                });
                batchTaskLogger.info({ entriesInBatch: batchForDetermineApi.length, event: 'initiating_async_batch_task_for_save' });

                // BỔ SUNG EVENT
                methodLogger.info({ entriesInBatch: batchForDetermineApi.length, assignedBatchIndex: currentBatchIndexForThisTask, event: 'batch_task_create_delegation_start', flow: 'save' });

                const batchPromise = this._executeBatchTaskForSave(
                    batchForDetermineApi, currentBatchIndexForThisTask,
                    taskAcronymContext, // Pass adjusted/derived acronym for file naming etc.
                    browserContext, batchTaskLogger
                );
                this.activeBatchSaves.add(batchPromise);
                batchPromise.finally(() => this.activeBatchSaves.delete(batchPromise));
                methodLogger.info({ assignedBatchIndex: currentBatchIndexForThisTask, event: 'batch_task_create_delegation_finish', flow: 'save' });
            } else {
                methodLogger.warn({ event: 'batch_processing_skipped_empty_after_link_processing_save_flow' });
            }
            methodLogger.info({ event: 'batch_processing_flow_finish', success: true, flow: 'save_initiation' }); // success: true vì chỉ khởi tạo, task chạy async
            return true;
        } catch (error: any) {
            // SỬA EVENT NAME
            methodLogger.error({ err: error, event: 'save_batch_unhandled_error_or_rethrown', flow: 'save_initiation_error' });
            return false;
        } finally {
            if (page && !page.isClosed()) await this._closePages([page], methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceSave.");
        }
    }


    private async _executeBatchTaskForUpdate(
        batchInput: BatchUpdateEntry, // This already has conferenceTextPath, cfpTextPath, impTextPath
        batchIndex: number,
        parentLogger: Logger
    ): Promise<boolean> {
        const logger = parentLogger.child({
            batchServiceFunction: '_executeBatchTaskForUpdate',
            service: 'BatchProcessingServiceOrchestrator'
        });
        logger.info({ event: 'batch_task_create', flow: 'update', batchIndex });

        try {
            const safeConferenceAcronym = (batchInput.conferenceAcronym || 'unknownAcro').replace(/[^a-zA-Z0-9_.-]/g, '-');
            await this.ensureDirectories([this.batchesDir, path.dirname(this.finalOutputPath)], logger);

            // 1. Read and Aggregate Content
            const contentPaths: ContentPaths = {
                conferenceTextPath: batchInput.conferenceTextPath,
                cfpTextPath: batchInput.cfpTextPath,
                impTextPath: batchInput.impTextPath,
            };
            const aggregatedFileContent = await this.conferenceDataAggregatorService.readContentFiles(contentPaths, logger);
            const contentSendToAPI = this.conferenceDataAggregatorService.aggregateContentForApi(
                batchInput.conferenceTitle, batchInput.conferenceAcronym, aggregatedFileContent, logger
            );

            // Intermediate file write (non-critical)
            const fileUpdateLogger = logger.child({ asyncOperation: 'write_intermediate_update_file' });
            const fileUpdateName = `${safeConferenceAcronym}_update_${batchIndex}.txt`;
            const fileUpdatePath = path.join(this.batchesDir, fileUpdateName);
            const fileUpdatePromise = this.fileSystemService.writeFile(fileUpdatePath, contentSendToAPI, fileUpdateLogger)
                .then(() => fileUpdateLogger.debug({ filePath: fileUpdatePath, event: 'batch_processing_write_intermediate_success' }))
                // SỬA EVENT NAME (nếu fileSystemService không log event này)
                .catch(writeError => fileUpdateLogger.error({ filePath: fileUpdatePath, err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_update_content' }));

            // 2. Execute Final Extraction APIs
            const apiResults = await this.executeFinalExtractionApis(
                contentSendToAPI, batchIndex, batchInput.conferenceTitle, batchInput.conferenceAcronym,
                safeConferenceAcronym, true, logger
            );

            await fileUpdatePromise; // Wait for non-critical write
            logger.debug({ event: 'intermediate_update_file_write_settled' });

            // 3. Prepare and Append Final Record
            const finalRecord: BatchUpdateEntry = {
                ...batchInput, // Contains original text paths
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpMetaData: apiResults.cfpMetaData,
            };
            await this.appendFinalRecord(finalRecord, logger.child({ subOperation: 'append_final_update_record' }));

            // SỬA EVENT NAME và thêm context
            logger.info({ event: 'save_batch_finish_success', flow: 'update', batchIndex });
            return true;
        } catch (error: any) {
            logger.error({ err: error, event: 'save_batch_unhandled_error_or_rethrown', flow: 'update', batchIndex });
            // Log detailed error to a specific file if needed
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForUpdate for ${batchInput.conferenceAcronym} (BatchIndex: ${batchIndex}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_update_task_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }

    public async _executeBatchTaskForSave(
        initialBatchEntries: BatchEntry[], // Results from ConferenceLinkProcessorService.processInitialLinkForSave
        batchIndex: number,
        batchAcronymForFiles: string, // Acronym used for generating filenames for this batch
        browserContext: BrowserContext,
        logger: Logger // Logger already has rich context
    ): Promise<boolean> {
        logger.info({ event: 'batch_task_create', flow: 'save', entryCountInBatch: initialBatchEntries.length, batchIndex });

        if (!initialBatchEntries || initialBatchEntries.length === 0 || !initialBatchEntries[0]?.conferenceAcronym || !initialBatchEntries[0]?.conferenceTitle) {
            logger.warn({ event: 'invalid_batch_input_for_save_task' });
            return false;
        }
        const primaryEntryForContext = initialBatchEntries[0]; // For overall title/acronym if needed
        const safeBatchAcronym = batchAcronymForFiles.replace(/[^a-zA-Z0-9_.-]/g, '-');

        try {
            await this.ensureDirectories([this.batchesDir, this.finalOutputPath], logger.child({ subOperation: 'ensure_directories_save_task' }));

            // 1. Aggregate content from initialBatchEntries for determine_links_api
            logger.debug({ event: 'aggregate_content_for_determine_api_start_save_task' });
            let batchContentParts: string[] = [];
            // This part could also be a method in ConferenceDataAggregatorService if complex/reused
            const readPromises = initialBatchEntries.map(async (entry, i) => {
                const entryLogger = logger.child({ entryIndexInBatch: i, entryLink: entry.conferenceLink });
                if (!entry.conferenceTextPath) {
                    entryLogger.warn({ event: 'read_content_skipped_no_path_for_determine_aggregation_save_task' });
                    return { index: i, content: `${i + 1}. WARNING: Missing text path for ${entry.conferenceLink}\n\n` }; // Less critical here
                }
                try {
                    const text = await this.fileSystemService.readFileContent(entry.conferenceTextPath, entryLogger);
                    return { index: i, content: `Source Link [${i + 1}]: ${entry.conferenceLink}\nContent [${i + 1}]:\n${text.trim()}\n\n---\n\n` };
                } catch (readError: any) {
                    entryLogger.error({ err: readError, filePath: entry.conferenceTextPath, event: 'read_content_failed_for_determine_aggregation_save_task' });
                    return { index: i, content: `Source Link [${i + 1}]: ${entry.conferenceLink}\nContent [${i + 1}]:\nERROR READING CONTENT\n\n---\n\n` };
                }
            });
            const readResults = await Promise.all(readPromises);
            readResults.sort((a, b) => a.index - b.index); // Ensure order
            batchContentParts = readResults.map(r => r.content);
            const batchContentForDetermine = `Conference Info:\nTitle: ${primaryEntryForContext.conferenceTitle}\nAcronym: ${primaryEntryForContext.conferenceAcronym}\n\nCandidate Website Contents:\n${batchContentParts.join("")}`;
            logger.debug({ charCount: batchContentForDetermine.length, event: 'aggregate_content_for_determine_api_end_save_task' });

            // Intermediate file write (non-critical)
            const fileFullLinksName = `${safeBatchAcronym}_full_links_batch_${batchIndex}.txt`;
            const fileFullLinksPath = path.join(this.batchesDir, fileFullLinksName);
            const writeFileFullLinksLogger = logger.child({ fileOperation: 'write_intermediate_full_links_save', filePath: fileFullLinksPath });
            const writeFullLinksPromise = this.fileSystemService.writeFile(fileFullLinksPath, batchContentForDetermine, writeFileFullLinksLogger)
                .then(() => writeFileFullLinksLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                // SỬA EVENT NAME (nếu fileSystemService không log event này)
                .catch(writeError => writeFileFullLinksLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_full_links_content' }));


            // 2. Call determine_links_api (API 1)
            let determineLinksResponse: ApiResponse;
            const determineApiLogger = logger.child({ geminiApiType: this.geminiApiService.API_TYPE_DETERMINE, geminiApiCallNumber: 1 });
            const determineApiParams: GeminiApiParams = {
                batch: batchContentForDetermine, batchIndex: batchIndex,
                title: primaryEntryForContext.conferenceTitle, acronym: primaryEntryForContext.conferenceAcronym,
            };
            try {
                determineApiLogger.info({ inputLength: batchContentForDetermine.length, event: 'gemini_determine_api_call_start_save_task' });
                determineLinksResponse = await this.geminiApiService.determineLinks(determineApiParams, determineApiLogger);
                const tempResponsePath = await this.fileSystemService.saveTemporaryFile(
                    determineLinksResponse.responseText || "",
                    `${safeBatchAcronym}_determine_response_batch_${batchIndex}`,
                    determineApiLogger.child({ fileOperation: 'save_determine_response_save_task' })
                );
                // Store this path on the primary entry or a temporary object if primaryEntry is from a list
                // For now, let's assume we'll pass this to the final record.
                (primaryEntryForContext as any).determineResponseTextPath = tempResponsePath; // Temporary holding
                (primaryEntryForContext as any).determineMetaData = determineLinksResponse.metaData; // Temporary holding
                determineApiLogger.info({ responseLength: determineLinksResponse.responseText?.length, event: 'gemini_determine_api_call_end_save_task', success: true });
            } catch (determineLinksError: any) {
                determineApiLogger.error({ err: determineLinksError, event: 'save_batch_determine_api_call_failed', apiCallNumber: 1 });
                await writeFullLinksPromise;
                throw new Error(`Critical: Determine links API failed for batch ${batchIndex} (SAVE): ${determineLinksError}`);
            }

            // 3. Process determine_links_api response using ConferenceDeterminationService
            const processDetermineLogger = logger.child({ subOperation: 'process_determine_api_response_save_task' });
            let processedMainEntries: BatchEntry[]; // Array of one entry or empty/failed
            try {
                processedMainEntries = await this.conferenceDeterminationService.determineAndProcessOfficialSite(
                    determineLinksResponse.responseText || "",
                    initialBatchEntries, // Pass the original batch of candidates
                    batchIndex,
                    browserContext,
                    processDetermineLogger
                );
            } catch (processError: any) {
                processDetermineLogger.error({ err: processError, event: 'save_batch_process_determine_call_failed' });
                throw processError;
            }

            if (!processedMainEntries || processedMainEntries.length === 0 || !processedMainEntries[0] || processedMainEntries[0].conferenceLink === "None" || !processedMainEntries[0].conferenceTextPath) {
                processDetermineLogger.error({
                    resultCount: processedMainEntries?.length,
                    mainLinkResult: processedMainEntries?.[0]?.conferenceLink,
                    mainTextPathResult: processedMainEntries?.[0]?.conferenceTextPath,
                    event: 'save_batch_process_determine_failed_invalid'
                });
                await writeFullLinksPromise;
                // Log error to specific file
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave (Determine API processing) for ${primaryEntryForContext.conferenceAcronym} (BatchIndex: ${batchIndex}): Main link/text path invalid.\n`;
                this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_determine_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));

                return false;
            }
            const mainEntryAfterDetermination = processedMainEntries[0]; // This is the key entry now
            processDetermineLogger.info({
                finalMainLink: mainEntryAfterDetermination.conferenceLink,
                mainTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpPath: mainEntryAfterDetermination.cfpTextPath,
                impPath: mainEntryAfterDetermination.impTextPath,
                event: 'successfully_processed_determine_response_save_task'
            });

            // 4. Read and Aggregate Content for Final APIs (based on mainEntryAfterDetermination)
            const contentPathsForFinalApi: ContentPaths = {
                conferenceTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpTextPath: mainEntryAfterDetermination.cfpTextPath,
                impTextPath: mainEntryAfterDetermination.impTextPath,
            };
            const aggregatedContentForFinalApi = await this.conferenceDataAggregatorService.readContentFiles(
                contentPathsForFinalApi, logger.child({ subOperation: 'read_determined_content_files_save_task' })
            );
            const contentSendToFinalApi = this.conferenceDataAggregatorService.aggregateContentForApi(
                mainEntryAfterDetermination.conferenceTitle, mainEntryAfterDetermination.conferenceAcronym,
                aggregatedContentForFinalApi, logger.child({ subOperation: 'aggregate_for_extract_cfp_apis_save_task' })
            );

            // Intermediate file write (non-critical)
            const fileMainLinkName = `${safeBatchAcronym}_main_link_content_batch_${batchIndex}.txt`;
            const fileMainLinkPath = path.join(this.batchesDir, fileMainLinkName);
            const writeFileMainLinkLogger = logger.child({ fileOperation: 'write_intermediate_main_link_content_save', filePath: fileMainLinkPath });
            const fileMainLinkPromise = this.fileSystemService.writeFile(fileMainLinkPath, contentSendToFinalApi, writeFileMainLinkLogger)
                .then(() => writeFileMainLinkLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                // SỬA EVENT NAME (nếu fileSystemService không log event này)
                .catch(writeError => writeFileMainLinkLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_main_link_content' }));

            // 5. Execute Final Extraction APIs
            const finalApiResults = await this.executeFinalExtractionApis(
                contentSendToFinalApi, batchIndex, mainEntryAfterDetermination.conferenceTitle,
                mainEntryAfterDetermination.conferenceAcronym, safeBatchAcronym, false, logger
            );

            await Promise.allSettled([writeFullLinksPromise, fileMainLinkPromise]);
            logger.debug({ event: 'intermediate_file_writes_settled_save_task' });

            // 6. Prepare and Append Final Record
            const finalRecord: BatchEntry = {
                ...mainEntryAfterDetermination, // Contains all determined links and their text paths
                extractResponseTextPath: finalApiResults.extractResponseTextPath,
                extractMetaData: finalApiResults.extractMetaData,
                cfpResponseTextPath: finalApiResults.cfpResponseTextPath,
                cfpMetaData: finalApiResults.cfpMetaData,
                // Add determine API metadata from earlier step
                determineResponseTextPath: (primaryEntryForContext as any).determineResponseTextPath,
                determineMetaData: (primaryEntryForContext as any).determineMetaData,
            };
            await this.appendFinalRecord(finalRecord, logger.child({ subOperation: 'append_final_save_record' }));

            logger.info({ event: 'save_batch_finish_success', flow: 'save', batchIndex });
            return true;

        } catch (error: any) {
            // SỬA EVENT NAME và thêm context
            logger.error({ err: error, event: 'save_batch_unhandled_error_or_rethrown', flow: 'save', batchIndex });
            // Log detailed error to a specific file
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave for ${primaryEntryForContext.conferenceAcronym} (BatchIndex: ${batchIndex}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_main_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }

    
    private async appendFinalRecord(
        record: BatchEntry | BatchUpdateEntry,
        parentLogger: Logger
    ): Promise<void> {
        const logger = parentLogger.child({
            batchServiceFunction: 'appendFinalRecord',
            outputPath: this.finalOutputPath,
            recordAcronymForAppend: record.conferenceAcronym,
            service: 'BatchProcessingServiceOrchestrator'
        });
        try {
            logger.info({ event: 'append_final_record_start' });
            const dataToWrite = JSON.stringify(record) + '\n';
            await this.fileSystemService.appendFile(this.finalOutputPath, dataToWrite, logger);
            logger.info({ event: 'append_final_record_success' });
        } catch (appendError: any) {
            logger.error({ err: appendError, event: 'append_final_record_failed' });
            throw appendError;
        }
    }
    
    public async awaitCompletion(parentLogger?: Logger): Promise<void> {
        const logger = (parentLogger || this.serviceBaseLogger).child({
            batchServiceMethod: 'awaitCompletion',
            service: 'BatchProcessingServiceOrchestrator'
        });
        const initialCount = this.activeBatchSaves.size;
        if (initialCount === 0) {
            logger.info("No active batch save operations to await.");
            return;
        }
        logger.info(`Waiting for ${initialCount} active asynchronous batch save operation(s) to complete...`);
        const promisesToAwait = [...this.activeBatchSaves];
        const results = await Promise.allSettled(promisesToAwait);

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                logger.debug({ promiseIndexInSnapshot: index, batchTaskResult: result.value, event: 'batch_task_settled_fulfilled_await' });
            } else {
                logger.warn({ promiseIndexInSnapshot: index, batchTaskErrorReason: result.reason instanceof Error ? result.reason.message : String(result.reason), event: 'batch_task_settled_rejected_await' });
            }
        });

        if (this.activeBatchSaves.size > 0) {
            logger.warn({ remainingActiveSaves: this.activeBatchSaves.size, event: 'new_active_batch_saves_found_after_await_recursion' });
            await this.awaitCompletion(logger); // Recursive call with the same logger
        } else {
            logger.info({ initialAwaitedCount: initialCount, event: 'all_tracked_batch_save_operations_completed_await' });
        }
    }

    private async _closePages(pages: Page[], parentLogger: Logger): Promise<void> {
        const logger = parentLogger.child({
            batchServiceFunction: '_closePages',
            service: 'BatchProcessingServiceOrchestrator'
        });
        const pageCount = pages.filter(p => p && !p.isClosed()).length;
        if (pageCount === 0) {
            logger.debug({ initialPageCount: pages.length, openPageCount: 0, event: 'no_pages_to_close_or_already_closed' });
            return;
        }

        logger.debug({ initialPageCount: pages.length, openPageCount: pageCount, event: 'closing_pages_start' });
        let closedCount = 0;
        let failedCount = 0;

        for (const p of pages) {
            if (p && !p.isClosed()) {
                try {
                    await p.close();
                    closedCount++;
                } catch (err: any) {
                    failedCount++;
                    logger.error({ pageId: (p as any)._guid, err: err, event: 'page_close_failed_in_loop' });
                }
            }
        }
        logger.debug({ closedCount, failedCount, totalAttemptedToClose: pageCount, event: 'closing_pages_finish' });
    }
}