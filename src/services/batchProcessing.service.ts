// src/services/batchProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import { Page, BrowserContext } from 'playwright';

// --- Types ---
import {
    BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData,
    BatchEntryWithIds, BatchUpdateDataWithIds,
    ApiModels, // << IMPORT ApiModels
    CrawlModelType // Vẫn cần CrawlModelType cho các lệnh gọi Gemini cụ thể
} from '../types/crawl.types';

// --- Service Imports ---
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GeminiApiService, ApiResponse, GeminiApiParams } from './geminiApi.service';
import { FileSystemService } from './fileSystem.service';
import { IPageContentExtractorService } from './batchProcessingServiceChild/pageContentExtractor.service';
import { IConferenceLinkProcessorService } from './batchProcessingServiceChild/conferenceLinkProcessor.service';
import { IConferenceDeterminationService } from './batchProcessingServiceChild/conferenceDetermination.service';
import { IConferenceDataAggregatorService, ContentPaths } from './batchProcessingServiceChild/conferenceDataAggregator.service';

import { Logger } from 'pino';
import { addAcronymSafely } from '../utils/crawl/addAcronymSafely';


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
    private readonly tempDir: string;
    private readonly errorLogPath: string;

    private globalProcessedAcronymsSet: Set<string> = new Set(); // ++ Thêm Set toàn cục
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
        this.serviceBaseLogger = loggingService.getLogger('main', { service: 'BatchProcessingServiceOrchestrator' });
        this.batchesDir = this.configService.batchesDir;
        this.tempDir = this.configService.tempDir;
        this.errorLogPath = path.join(this.configService.baseOutputDir, 'batch_processing_errors.log');
        this.serviceBaseLogger.info("BatchProcessingService constructed.");
        this.serviceBaseLogger.info(`Batches Directory: ${this.batchesDir}`);
        this.serviceBaseLogger.info(`Temp Directory: ${this.tempDir}`);
        // Khởi tạo globalProcessedAcronymsSet nếu cần (ví dụ, đọc từ file nếu muốn duy trì giữa các lần chạy app)
        // Hoặc đơn giản là để nó trống cho mỗi lần service được tạo.
    }

    // resetGlobalAcronyms có thể được gọi từ một service quản lý phiên crawl cao hơn
    public resetGlobalAcronyms(logger: Logger) {
        this.globalProcessedAcronymsSet.clear();
        logger.info({ event: 'global_processed_acronyms_reset', service: 'BatchProcessingService' });
    }

    private async ensureDirectories(paths: string[], loggerToUse?: Logger): Promise<void> {
        const logger = loggerToUse || this.serviceBaseLogger;
        const logContext = { function: 'ensureDirectories', service: 'BatchProcessingServiceOrchestrator' };
        for (const dirPath of paths) {
            // Đảm bảo dirPath là một thư mục, không phải file
            let effectiveDirPath = dirPath;
            try {
                if (fs.existsSync(dirPath) && fs.statSync(dirPath).isFile()) {
                    effectiveDirPath = path.dirname(dirPath);
                } else if (!fs.existsSync(dirPath)) {
                    effectiveDirPath = path.dirname(dirPath); // Nếu path không tồn tại, giả sử nó là file để lấy dirname
                }
            } catch (e) { /* ignore error, path.dirname will handle it or mkdir will fail */
                effectiveDirPath = path.dirname(dirPath);
            }


            if (!fs.existsSync(effectiveDirPath)) {
                logger.info({ ...logContext, path: effectiveDirPath, event: 'batch_processing_ensure_dir_create_attempt' });
                try {
                    await this.fileSystemService.ensureDirExists(effectiveDirPath, logger);
                } catch (mkdirError: unknown) {
                    logger.error({ ...logContext, path: effectiveDirPath, err: mkdirError, event: 'batch_dir_create_failed' }); // Sửa event
                    throw mkdirError;
                }
            }
        }
    }


    /**
       * Executes extractInformation and extractCfp APIs in parallel using GeminiApiService.
       * This remains in the orchestrator as it's a distinct final API step.
       */
    private async executeFinalExtractionApis(
        contentSendToAPI: string,
        batchItemIndex: number,
        titleForApis: string,
        acronymForApis: string,
        safeConferenceAcronym: string,
        isUpdate: boolean,
        extractModel: CrawlModelType, // << Model cho extractInfo
        cfpModel: CrawlModelType,     // << Model cho ExtractCfp
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
            extractModelUsed: extractModel, // Log model cụ thể
            cfpModelUsed: cfpModel,         // Log model cụ thể
        });

        const suffix = isUpdate ? `_update_response_${batchItemIndex}` : `_response_${batchItemIndex}`;
        const extractFileBase = `${safeConferenceAcronym}_extract${suffix}`;
        const cfpFileBase = `${safeConferenceAcronym}_cfp${suffix}`;

        logger.info({ event: 'batch_processing_parallel_final_apis_start', flow: isUpdate ? 'update' : 'save' });

        const commonApiParams: Omit<GeminiApiParams, 'batch'> = {
            batchIndex: batchItemIndex,
            title: titleForApis,
            acronym: acronymForApis,
        };

        const extractPromise = (async () => {
            const extractApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_EXTRACT });
            extractApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_extract_api_call_start' });
            try {
                const response = await this.geminiApiService.extractInformation(
                    { ...commonApiParams, batch: contentSendToAPI },
                    extractModel, // << SỬ DỤNG extractModel
                    extractApiLogger
                );
                const pathValue = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", extractFileBase, extractApiLogger
                );
                extractApiLogger.info({ responseLength: response.responseText?.length, filePath: pathValue, event: 'batch_processing_final_extract_api_call_end', success: !!pathValue });
                return { responseTextPath: pathValue, metaData: response.metaData };
            } catch (error: any) {
                extractApiLogger.error({ err: error, event: 'batch_extract_api_call_failed', apiType: this.geminiApiService.API_TYPE_EXTRACT });
                return { responseTextPath: undefined, metaData: null };
            }
        })();

        const cfpPromise = (async () => {
            const cfpApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_CFP });
            cfpApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_cfp_api_call_start' });
            try {
                const response = await this.geminiApiService.extractCfp(
                    { ...commonApiParams, batch: contentSendToAPI },
                    cfpModel, // << SỬ DỤNG cfpModel
                    cfpApiLogger
                );
                const pathValue = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", cfpFileBase, cfpApiLogger
                );
                cfpApiLogger.info({ responseLength: response.responseText?.length, filePath: pathValue, event: 'batch_processing_final_cfp_api_call_end', success: !!pathValue });
                return { responseTextPath: pathValue, metaData: response.metaData };
            } catch (error: any) {
                cfpApiLogger.error({ err: error, event: 'batch_cfp_api_call_failed', apiType: this.geminiApiService.API_TYPE_CFP });
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
            logger.error({ event: 'batch_parallel_final_apis_both_failed', flow: isUpdate ? 'update' : 'save' });
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
        parentLogger: Logger,
        apiModels: ApiModels // << THAY ĐỔI Ở ĐÂY
    ): Promise<boolean> {
        const batchRequestIdFromParent = parentLogger.bindings().batchRequestId as string;
        const batchItemIndexFromParent = parentLogger.bindings().batchItemIndex as number;

        if (!batchRequestIdFromParent || batchItemIndexFromParent === undefined) {
            parentLogger.error({ event: 'batch_processing_missing_ids_from_parent_logger', flow: 'update', conferenceAcronym: conference.Acronym });
            return false;
        }

        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceUpdate',
            // conferenceAcronym: conference.Acronym,
            // conferenceTitle: conference.Title,
            service: 'BatchProcessingServiceOrchestrator'
        });
        const modelsDesc = `EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`; // Chỉ log model liên quan đến update
        methodLogger.info({ event: 'batch_processing_flow_start', flow: 'update', modelsForUpdate: modelsDesc });
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
            let impPromiseVal: Promise<string | null>; // Sửa tên biến để tránh xung đột
            if (isImpSameAsNavigableCfp) {
                impPromiseVal = cfpPromise.then(cfpPath => {
                    methodLogger.info({ event: 'imp_link_resolved_as_same_as_cfp_update', cfpPath });
                    return cfpPath ? "" : null;
                });
            } else {
                // If impPage is null (e.g. PDF or no link), service handles it
                impPromiseVal = cfpPromise.then(cfpPath =>
                    this.conferenceLinkProcessorService.processImpLinkForUpdate(impPage, conference, cfpPath, methodLogger.child({ linkType: 'imp_update' }))
                );
            }


            const results = await Promise.allSettled([mainPromise, cfpPromise, impPromiseVal]);
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
                methodLogger.error({ event: 'batch_processing_abort_no_main_text', flow: 'update', reason: 'Main text path missing' }); // Sửa event
                return false; // Không await _closePages ở đây, finally sẽ làm
            }

            const batchDataForExecute: BatchUpdateEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym, // Acronym gốc
                conferenceTextPath: mainResult.textPath,
                cfpTextPath: cfpTextPath,
                impTextPath: impTextPath,
                originalRequestId: conference.originalRequestId,
            };

            const updateSuccess = await this._executeBatchTaskForUpdate(
                batchDataForExecute,
                batchItemIndexFromParent,
                batchRequestIdFromParent,
                apiModels, // << TRUYỀN apiModels
                methodLogger
            );
            methodLogger.info({ event: 'batch_processing_flow_finish', success: updateSuccess, flow: 'update' });
            return updateSuccess;
        } catch (error: any) {
            methodLogger.error({ err: error, event: 'batch_process_update_unhandled_error', flow: 'update_initiation_error' });
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
        parentLogger: Logger,
        apiModels: ApiModels // << THAY ĐỔI Ở ĐÂY
    ): Promise<boolean> {
        const batchRequestIdFromParent = parentLogger.bindings().batchRequestId as string;
        const batchItemIndexFromParent = parentLogger.bindings().batchItemIndex as number; // Index của item ConferenceData này

        if (!batchRequestIdFromParent || batchItemIndexFromParent === undefined) {
            parentLogger.error({ event: 'batch_processing_missing_ids_from_parent_logger', flow: 'save', conferenceAcronym: conference.Acronym });
            return false;
        }

        const year = this.configService.config.YEAR2;
        const methodLogger = parentLogger.child({ // parentLogger là flowLogger (từ HtmlPersistence)
            batchServiceMethod: 'processConferenceSave',
            service: 'BatchProcessingServiceOrchestrator' // Ghi đè service, OK
        });
        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        methodLogger.info({ event: 'batch_processing_flow_start', flow: 'save_initiation', modelsForSave: modelsDesc });

        if (!links || links.length === 0) {
            methodLogger.warn({ event: 'batch_processing_skipped_no_links_for_save' }); return false;
        }

        let page: Page | null = null;
        const batchForDetermineApi: BatchEntry[] = [];
        let linkProcessingSuccessCount = 0;
        let linkProcessingFailedCount = 0;


        try {
            page = await browserContext.newPage();
            methodLogger.info({ event: 'page_created_for_save_flow' });

            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                // Truyền methodLogger (đã chứa batchItemIndex của ConferenceData hiện tại)
                const singleLinkLogger = methodLogger.child({ linkProcessingIndex: i, originalLinkForProcessing: link });
                try {
                    const batchEntry = await this.conferenceLinkProcessorService.processInitialLinkForSave(
                        page, link, i, conference, year, /* existingAcronyms BỎ */ singleLinkLogger
                    );
                    if (batchEntry) {
                        batchForDetermineApi.push(batchEntry);
                        linkProcessingSuccessCount++;
                    } else { linkProcessingFailedCount++; }
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
                // currentBatchItemIndex là batchItemIndexFromParent (index của ConferenceData này)
                // batchIndexRef.current++ không còn ở đây

                const taskAcronymContext = batchForDetermineApi[0]?.conferenceAcronym || conference.Acronym;
                const taskTitleContext = batchForDetermineApi[0]?.conferenceTitle || conference.Title;

                const batchTaskLogger = methodLogger.child({
                    asyncBatchTask: '_executeBatchTaskForSave',
                    conferenceAcronym: taskAcronymContext, // Acronym cho context của task này
                    conferenceTitle: taskTitleContext,
                });
                batchTaskLogger.info({ entriesInBatch: batchForDetermineApi.length, event: 'initiating_async_batch_task_for_save' });
                methodLogger.info({ entriesInBatch: batchForDetermineApi.length, assignedBatchItemIndex: batchItemIndexFromParent, event: 'batch_task_create_delegation_start', flow: 'save' });

                const batchPromise = this._executeBatchTaskForSave(
                    batchForDetermineApi,
                    batchItemIndexFromParent,
                    taskAcronymContext,
                    browserContext,
                    batchRequestIdFromParent,
                    apiModels, // << TRUYỀN apiModels
                    batchTaskLogger
                );
                this.activeBatchSaves.add(batchPromise);
                batchPromise.finally(() => this.activeBatchSaves.delete(batchPromise));
                methodLogger.info({ assignedBatchItemIndex: batchItemIndexFromParent, event: 'batch_task_create_delegation_finish', flow: 'save' });
            } else {
                methodLogger.warn({ event: 'batch_processing_skipped_empty_after_link_processing_save_flow' });
            }
            methodLogger.info({ event: 'batch_processing_flow_finish', success: true, flow: 'save_initiation' });
            return true;
        } catch (error: any) {
            methodLogger.error({ err: error, event: 'batch_process_save_unhandled_error', flow: 'save_initiation_error' }); // Sửa event
            return false;
        } finally {
            if (page && !page.isClosed()) await this._closePages([page], methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceSave.");
        }
    }


    private async _executeBatchTaskForUpdate(
        batchInput: BatchUpdateEntry,
        batchItemIndex: number,
        batchRequestIdForTask: string,
        apiModels: ApiModels, // << THAY ĐỔI Ở ĐÂY
        parentLogger: Logger
    ): Promise<boolean> {
        const logger = parentLogger.child({
            batchServiceFunction: '_executeBatchTaskForUpdate',
        });
        logger.info({ event: 'batch_task_start_execution', flow: 'update' });

        try {
            const safeConferenceAcronym = (batchInput.conferenceAcronym || 'unknownAcro').replace(/[^a-zA-Z0-9_.-]/g, '-');
            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForTask);
            await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], logger);

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
            const fileUpdateName = `${safeConferenceAcronym}_update_item${batchItemIndex}.txt`; // Sửa tên file
            const fileUpdatePath = path.join(this.batchesDir, fileUpdateName);
            const fileUpdatePromise = this.fileSystemService.writeFile(fileUpdatePath, contentSendToAPI, fileUpdateLogger)
                .then(() => fileUpdateLogger.debug({ filePath: fileUpdatePath, event: 'batch_processing_write_intermediate_success' }))
                // SỬA EVENT NAME (nếu fileSystemService không log event này)
                .catch(writeError => fileUpdateLogger.error({ filePath: fileUpdatePath, err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_update_content' }));

            // 2. Execute Final Extraction APIs
            const apiResults = await this.executeFinalExtractionApis(
                contentSendToAPI, batchItemIndex, batchInput.conferenceTitle, batchInput.conferenceAcronym,
                safeConferenceAcronym, true,
                apiModels.extractInfo, // << Model cho extract
                apiModels.extractCfp,  // << Model cho CFP
                logger
            );

            await fileUpdatePromise; // Wait for non-critical write
            logger.debug({ event: 'intermediate_update_file_write_settled' });


            // 3. Prepare and Append Final Record

            // An toàn hóa acronym nếu cần (thường không cần cho update vì acronym ít thay đổi)
            // const finalAcronym = await addAcronymSafely(this.globalProcessedAcronymsSet, batchInput.conferenceAcronym);

            const finalRecord: BatchUpdateDataWithIds = {
                ...batchInput, // conferenceAcronym ở đây là gốc, hoặc đã được an toàn hóa nếu bạn làm vậy
                batchRequestId: batchRequestIdForTask,
                // originalRequestId đã có trong batchInput
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpMetaData: apiResults.cfpMetaData,
            };
            await this.appendFinalRecord(finalRecord, batchRequestIdForTask, logger.child({ subOperation: 'append_final_update_record' }));
            logger.info({ event: 'batch_task_finish_success', flow: 'update' }); // Sửa event
            return true;
        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'update' }); // Sửa event
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForUpdate for ${batchInput.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}, BatchRequestID: ${batchRequestIdForTask}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_update_task_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }
    public async _executeBatchTaskForSave(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        batchAcronymForFiles: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels, // Nhận toàn bộ ApiModels
        logger: Logger
    ): Promise<boolean> {
        logger.info({ event: 'batch_task_start_execution', flow: 'save', entryCountInBatch: initialBatchEntries.length });

        if (!initialBatchEntries || initialBatchEntries.length === 0 || !initialBatchEntries[0]?.conferenceAcronym || !initialBatchEntries[0]?.conferenceTitle) {
            logger.warn({ event: 'invalid_batch_input_for_save_task' });
            return false;
        }
        const primaryEntryForContext = initialBatchEntries[0];
        const safeBatchAcronym = batchAcronymForFiles.replace(/[^a-zA-Z0-9_.-]/g, '-');
        // originalRequestIdFromSource không cần thiết nếu mainEntryAfterDetermination đã mang nó từ ConferenceLinkProcessorService

        let determineResponseTextPath: string | undefined = undefined;
        let determineMetaData: any | null = null;
        let determineLinksResponse: ApiResponse;

        try {
            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForTask);
            await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], logger.child({ subOperation: 'ensure_directories_save_task' }));

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
            const fileFullLinksName = `${safeBatchAcronym}_item${batchItemIndex}_full_links.txt`; // Sửa tên file
            const fileFullLinksPath = path.join(this.batchesDir, fileFullLinksName);
            const writeFileFullLinksLogger = logger.child({ fileOperation: 'write_intermediate_full_links_save', filePath: fileFullLinksPath });
            const writeFullLinksPromise = this.fileSystemService.writeFile(fileFullLinksPath, batchContentForDetermine, writeFileFullLinksLogger)
                .then(() => writeFileFullLinksLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                // SỬA EVENT NAME (nếu fileSystemService không log event này)
                .catch(writeError => writeFileFullLinksLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_full_links_content' }));


            // 2. Call determine_links_api (API 1)
            // let determineLinksResponse: ApiResponse; // Đã khai báo ở trên
            const determineApiLogger = logger.child({ apiType: this.geminiApiService.API_TYPE_DETERMINE, geminiApiCallNumber: 1 });
            // Call determine_links_api (sử dụng batchItemIndex)
            const determineApiParams: GeminiApiParams = {
                batch: batchContentForDetermine, batchIndex: batchItemIndex, // batchItemIndex của ConferenceData hiện tại
                title: primaryEntryForContext.conferenceTitle, acronym: primaryEntryForContext.conferenceAcronym,
            };

            try {
                determineLinksResponse = await this.geminiApiService.determineLinks(
                    determineApiParams,
                    apiModels.determineLinks, // << SỬ DỤNG apiModels.determineLinks
                    determineApiLogger
                );
                determineResponseTextPath = await this.fileSystemService.saveTemporaryFile(
                    determineLinksResponse.responseText || "",
                    `${safeBatchAcronym}_item${batchItemIndex}_determine_response`, // Sửa tên file
                    determineApiLogger.child({ fileOperation: 'save_determine_response_save_task' })
                );
                determineMetaData = determineLinksResponse.metaData;
                determineApiLogger.info({ responseLength: determineLinksResponse.responseText?.length, filePath: determineResponseTextPath, event: 'gemini_determine_api_call_end_save_task', success: !!determineResponseTextPath }); // Log sau khi có kết quả
            } catch (determineLinksError: any) {
                determineApiLogger.error({ err: determineLinksError, event: 'save_batch_determine_api_call_failed', apiCallNumber: 1 });
                await writeFullLinksPromise;
                throw new Error(`Critical: Determine links API failed for item ${batchItemIndex} (SAVE): ${determineLinksError.message}`); // Sửa lỗi "batch" thành "item"
            }

            // 3. Process determine_links_api response using ConferenceDeterminationService
            // ++ KHỞI TẠO processDetermineLogger Ở ĐÂY
            const processDetermineLogger = logger.child({ subOperation: 'process_determine_api_response_save_task' });
            let processedMainEntries: BatchEntry[];

            try {
                // determineLinksResponse đã có giá trị từ khối try ở trên
                processedMainEntries = await this.conferenceDeterminationService.determineAndProcessOfficialSite(
                    determineLinksResponse.responseText || "",
                    initialBatchEntries,
                    batchItemIndex,
                    browserContext,
                    apiModels.determineLinks, // << TRUYỀN MODEL CHO DETERMINE Ở ĐÂY
                    processDetermineLogger // ++ TRUYỀN LOGGER ĐÃ KHỞI TẠO
                );
            } catch (processError: any) {
                processDetermineLogger.error({ err: processError, event: 'save_batch_process_determine_call_failed' });
                throw processError; // Re-throw để bắt ở khối catch lớn hơn của _executeBatchTaskForSave
            }

            if (!processedMainEntries || processedMainEntries.length === 0 || !processedMainEntries[0] || processedMainEntries[0].conferenceLink === "None" || !processedMainEntries[0].conferenceTextPath) {
                processDetermineLogger.error({ // Sử dụng processDetermineLogger đã khởi tạo
                    resultCount: processedMainEntries?.length,
                    mainLinkResult: processedMainEntries?.[0]?.conferenceLink,
                    mainTextPathResult: processedMainEntries?.[0]?.conferenceTextPath,
                    event: 'save_batch_process_determine_failed_invalid'
                });
                await writeFullLinksPromise;
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave (Determine API processing) for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}): Main link/text path invalid.\n`;
                this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_determine_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
                return false;
            }

            const mainEntryAfterDetermination = processedMainEntries[0];

            // AN TOÀN HÓA ACRONYM
            const baseAcronymFromDetermination = mainEntryAfterDetermination.conferenceAcronym;
            const finalSafeAcronym = await addAcronymSafely(this.globalProcessedAcronymsSet, baseAcronymFromDetermination);
            mainEntryAfterDetermination.conferenceAcronym = finalSafeAcronym;
            logger.info({ originalDetAcronym: baseAcronymFromDetermination, finalSafeAcronym, event: 'acronym_safely_adjusted_for_save' });

            processDetermineLogger.info({ // Sử dụng processDetermineLogger đã khởi tạo
                finalMainLink: mainEntryAfterDetermination.conferenceLink,
                mainTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpPath: mainEntryAfterDetermination.cfpTextPath,
                impPath: mainEntryAfterDetermination.impTextPath,
                acronymAfterSafetyCheck: finalSafeAcronym, // Log acronym đã an toàn
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
                mainEntryAfterDetermination.conferenceTitle,
                mainEntryAfterDetermination.conferenceAcronym, // Sử dụng acronym đã an toàn
                aggregatedContentForFinalApi,
                logger.child({ subOperation: 'aggregate_for_extract_cfp_apis_save_task' })
            );

            // Intermediate file write (non-critical)
            const fileMainLinkName = `${safeBatchAcronym}_item${batchItemIndex}_main_link_content.txt`; // Sửa tên file
            const fileMainLinkPath = path.join(this.batchesDir, fileMainLinkName);
            const writeFileMainLinkLogger = logger.child({ fileOperation: 'write_intermediate_main_link_content_save', filePath: fileMainLinkPath });
            const fileMainLinkPromise = this.fileSystemService.writeFile(fileMainLinkPath, contentSendToFinalApi, writeFileMainLinkLogger)
                .then(() => writeFileMainLinkLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                // SỬA EVENT NAME (nếu fileSystemService không log event này)
                .catch(writeError => writeFileMainLinkLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_main_link_content' }));

            // 5. Execute Final Extraction APIs
            const finalApiResults = await this.executeFinalExtractionApis(
                contentSendToFinalApi, batchItemIndex, mainEntryAfterDetermination.conferenceTitle,
                mainEntryAfterDetermination.conferenceAcronym,
                safeBatchAcronym,
                false,
                apiModels.extractInfo, // << Model cho extract
                apiModels.extractCfp,  // << Model cho CFP
                logger
            );

            await Promise.allSettled([writeFullLinksPromise, fileMainLinkPromise]);
            logger.debug({ event: 'intermediate_file_writes_settled_save_task' });

            // 6. Prepare and Append Final Record
            const finalRecord: BatchEntryWithIds = {
                ...mainEntryAfterDetermination, // Đã chứa acronym an toàn và originalRequestId
                batchRequestId: batchRequestIdForTask,
                // originalRequestId đã có trong mainEntryAfterDetermination
                determineResponseTextPath: determineResponseTextPath,
                determineMetaData: determineMetaData,
                extractResponseTextPath: finalApiResults.extractResponseTextPath,
                extractMetaData: finalApiResults.extractMetaData,
                cfpResponseTextPath: finalApiResults.cfpResponseTextPath,
                cfpMetaData: finalApiResults.cfpMetaData,
            };
            await this.appendFinalRecord(finalRecord, batchRequestIdForTask, logger.child({ subOperation: 'append_final_save_record' }));

            logger.info({ event: 'batch_task_finish_success', flow: 'save' });
            return true;

        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'save' });
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}, BatchRequestID: ${batchRequestIdForTask}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_main_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }

    private async appendFinalRecord(
        record: BatchEntryWithIds | BatchUpdateDataWithIds,
        batchRequestIdForFile: string,
        parentLogger: Logger
    ): Promise<void> {
        const jsonlPathForBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForFile);
        const logger = parentLogger.child({
            batchServiceFunction: 'appendFinalRecord',
            outputPath: jsonlPathForBatch,
            recordAcronymForAppend: record.conferenceAcronym,
        });
        try {
            logger.info({ event: 'append_final_record_start' }, `Appending to ${path.basename(jsonlPathForBatch)}`);
            await this.fileSystemService.ensureDirExists(path.dirname(jsonlPathForBatch), logger);
            const dataToWrite = JSON.stringify(record) + '\n';
            await this.fileSystemService.appendFile(jsonlPathForBatch, dataToWrite, logger);
            logger.info({ event: 'append_final_record_success' });
        } catch (appendError: any) {
            logger.error({ err: appendError, event: 'append_final_record_failed' });
            throw appendError;
        }
    }


    public async awaitCompletion(parentLogger?: Logger): Promise<void> {
        // Logic không đổi, chỉ cần đảm bảo logger được truyền đúng
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