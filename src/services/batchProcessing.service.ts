// src/services/batchProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import { Page, BrowserContext } from 'playwright';

// --- Types ---
import {
    BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData,
    BatchEntryWithIds, BatchUpdateDataWithIds, // Assuming these are updated as per suggestion
    ApiModels,
    CrawlModelType
} from '../types/crawl';

// --- Service Imports ---
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GeminiApiService } from './geminiApi.service';
import { FileSystemService } from './fileSystem.service';
import { IPageContentExtractorService } from './batchProcessingServiceChild/pageContentExtractor.service';
import { IConferenceLinkProcessorService } from './batchProcessingServiceChild/conferenceLinkProcessor.service';
import { IConferenceDeterminationService } from './batchProcessingServiceChild/conferenceDetermination.service';
import { IConferenceDataAggregatorService, ContentPaths } from './batchProcessingServiceChild/conferenceDataAggregator.service';
import { normalizeAndJoinLink } from '../utils/crawl/url.utils';
import { Logger } from 'pino';
import { addAcronymSafely } from '../utils/crawl/addAcronymSafely';
import { GeminiApiParams, ApiResponse } from '../types/crawl';

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
        this.serviceBaseLogger = loggingService.getLogger('conference', { service: 'BatchProcessingServiceOrchestrator' });
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
        originalAcronymForApis: string, // CHANGED: This is the original acronym
        safeConferenceAcronymForFiles: string, // CHANGED: This is the sanitized internal processing acronym for file naming
        isUpdate: boolean,
        extractModel: CrawlModelType,
        cfpModel: CrawlModelType,
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
            extractModelUsed: extractModel,
            cfpModelUsed: cfpModel,
            originalConferenceAcronym: originalAcronymForApis, // Log original acronym
            fileNameBaseAcronym: safeConferenceAcronymForFiles // Log acronym used for files
        });

        const suffix = isUpdate ? `_update_response_${batchItemIndex}` : `_response_${batchItemIndex}`;
        // Files are named using the safe, unique-for-run acronym
        const extractFileBase = `${safeConferenceAcronymForFiles}_extract${suffix}`;
        const cfpFileBase = `${safeConferenceAcronymForFiles}_cfp${suffix}`;

        logger.info({ event: 'batch_processing_parallel_final_apis_start', flow: isUpdate ? 'update' : 'save' });

        const commonApiParams: Omit<GeminiApiParams, 'batch'> = {
            batchIndex: batchItemIndex,
            title: titleForApis,
            acronym: originalAcronymForApis, // API call uses the original acronym
        };

        const extractPromise = (async () => {
            const extractApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_EXTRACT });
            extractApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_extract_api_call_start' });
            try {
                const response = await this.geminiApiService.extractInformation(
                    { ...commonApiParams, batch: contentSendToAPI },
                    extractModel,
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
        conference: ConferenceUpdateData, // Acronym here is original
        parentLogger: Logger,
        apiModels: ApiModels
    ): Promise<boolean> {
        const batchRequestIdFromParent = parentLogger.bindings().batchRequestId as string;
        const batchItemIndexFromParent = parentLogger.bindings().batchItemIndex as number;

        if (!batchRequestIdFromParent || batchItemIndexFromParent === undefined) {
            parentLogger.error({ event: 'batch_processing_missing_ids_from_parent_logger', flow: 'update', conferenceAcronym: conference.Acronym });
            return false;
        }

        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceUpdate',
            originalConferenceAcronym: conference.Acronym, // Log original
            conferenceTitle: conference.Title,
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

            // conference.Acronym is the original acronym
            const batchDataForExecute: BatchUpdateEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym, // Pass ORIGINAL acronym
                mainLink: conference.mainLink,
                impLink: conference.impLink,
                cfpLink: conference.cfpLink,
                conferenceTextPath: mainResult.textPath,
                cfpTextPath: cfpTextPath,
                impTextPath: impTextPath,
                originalRequestId: conference.originalRequestId,
            };
            const updateSuccess = await this._executeBatchTaskForUpdate(
                batchDataForExecute,
                batchItemIndexFromParent,
                batchRequestIdFromParent,
                apiModels,
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
        conference: ConferenceData, // Acronym here is original
        links: string[],
        parentLogger: Logger,
        apiModels: ApiModels
    ): Promise<boolean> {
        const batchRequestIdFromParent = parentLogger.bindings().batchRequestId as string;
        const batchItemIndexFromParent = parentLogger.bindings().batchItemIndex as number; // Index của item ConferenceData này

        if (!batchRequestIdFromParent || batchItemIndexFromParent === undefined) {
            parentLogger.error({ event: 'batch_processing_missing_ids_from_parent_logger', flow: 'save', conferenceAcronym: conference.Acronym });
            return false;
        }

        const year = this.configService.year2;
        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceSave',
            originalConferenceAcronym: conference.Acronym, // Log original
            conferenceTitle: conference.Title,
            service: 'BatchProcessingServiceOrchestrator'
        });

        const modelsDesc = `DL: ${apiModels.determineLinks}, EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
        methodLogger.info({ event: 'batch_processing_flow_start', flow: 'save_initiation', modelsForSave: modelsDesc });

        if (!links || links.length === 0) {
            methodLogger.warn({ event: 'batch_processing_skipped_no_links_for_save' }); return false;
        }

        let page: Page | null = null;
        const batchForDetermineApi: BatchEntry[] = []; // BatchEntry.conferenceAcronym is original
        let linkProcessingSuccessCount = 0;
        let linkProcessingFailedCount = 0;


        try {
            page = await browserContext.newPage();
            methodLogger.info({ event: 'page_created_for_save_flow' });

            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const singleLinkLogger = methodLogger.child({ linkProcessingIndex: i, originalLinkForProcessing: link });

                try {
                    // conferenceLinkProcessorService.processInitialLinkForSave should return BatchEntry
                    // where conferenceAcronym is the original one from 'conference' input
                    const batchEntry = await this.conferenceLinkProcessorService.processInitialLinkForSave(
                        page, link, i, conference, year, singleLinkLogger
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
                // Use original acronym from the first entry for initial file naming context if needed
                // This is the 'batchAcronymForFiles' concept
                const primaryOriginalAcronymForTask = batchForDetermineApi[0]?.conferenceAcronym || conference.Acronym;
                const taskTitleContext = batchForDetermineApi[0]?.conferenceTitle || conference.Title;

                const batchTaskLogger = methodLogger.child({
                    asyncBatchTask: '_executeBatchTaskForSave',
                    // Log original acronym for context of this task
                    originalConferenceAcronym: primaryOriginalAcronymForTask,
                    conferenceTitle: taskTitleContext,
                });
                batchTaskLogger.info({ entriesInBatch: batchForDetermineApi.length, event: 'initiating_async_batch_task_for_save' });
                methodLogger.info({ entriesInBatch: batchForDetermineApi.length, assignedBatchItemIndex: batchItemIndexFromParent, event: 'batch_task_create_delegation_start', flow: 'save' });

                const batchPromise = this._executeBatchTaskForSave(
                    batchForDetermineApi, // Contains original acronyms
                    batchItemIndexFromParent,
                    primaryOriginalAcronymForTask, // This is for pre-determination file prefix
                    browserContext,
                    batchRequestIdFromParent,
                    apiModels,
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
        batchInput: BatchUpdateEntry, // batchInput.conferenceAcronym is ORIGINAL
        batchItemIndex: number,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        parentLogger: Logger
    ): Promise<boolean> {
        const originalAcronym = batchInput.conferenceAcronym;

        const logger = parentLogger.child({
            batchServiceFunction: '_executeBatchTaskForUpdate',
        });
        logger.info({ event: 'batch_task_start_execution', flow: 'update' });

        try {
            // Generate internal processing acronym and its safe version for file naming
            const internalProcessingAcronym = await addAcronymSafely(this.globalProcessedAcronymsSet, originalAcronym);
            const safeInternalAcronymForFiles = internalProcessingAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
            logger.info({ internalProcessingAcronym, safeInternalAcronymForFiles, event: 'acronym_generated_for_update_files' });


            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForTask);
            await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], logger);


            const contentPaths: ContentPaths = {
                conferenceTextPath: batchInput.conferenceTextPath,
                cfpTextPath: batchInput.cfpTextPath,
                impTextPath: batchInput.impTextPath,
            };
            const aggregatedFileContent = await this.conferenceDataAggregatorService.readContentFiles(contentPaths, logger);
            // Aggregate content using ORIGINAL acronym
            const contentSendToAPI = this.conferenceDataAggregatorService.aggregateContentForApi(
                batchInput.conferenceTitle, originalAcronym, aggregatedFileContent, logger
            );

            const fileUpdateLogger = logger.child({ asyncOperation: 'write_intermediate_update_file' });
            // Name intermediate file using the safe internal acronym
            const fileUpdateName = `${safeInternalAcronymForFiles}_update_item${batchItemIndex}.txt`;
            const fileUpdatePath = path.join(this.batchesDir, fileUpdateName);
            const fileUpdatePromise = this.fileSystemService.writeFile(fileUpdatePath, contentSendToAPI, fileUpdateLogger)
                .then(() => fileUpdateLogger.debug({ filePath: fileUpdatePath, event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => fileUpdateLogger.error({ filePath: fileUpdatePath, err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_update_content' }));

            // 2. Execute Final Extraction APIs
            // Execute APIs using ORIGINAL acronym for API call, and safe internal acronym for response file naming
            const apiResults = await this.executeFinalExtractionApis(
                contentSendToAPI, batchItemIndex, batchInput.conferenceTitle,
                originalAcronym, // Pass ORIGINAL acronym to API
                safeInternalAcronymForFiles, // Pass safe internal acronym for file naming
                true,
                apiModels.extractInfo,
                apiModels.extractCfp,
                logger
            );

            await fileUpdatePromise; // Wait for non-critical write
            logger.debug({ event: 'intermediate_update_file_write_settled' });


            // 3. Prepare and Append Final Record

            // An toàn hóa acronym nếu cần (thường không cần cho update vì acronym ít thay đổi)
            // const finalAcronym = await addAcronymSafely(this.globalProcessedAcronymsSet, batchInput.conferenceAcronym);

            // Trong _executeBatchTaskForUpdate
            const finalRecord: BatchUpdateDataWithIds = {
                conferenceTitle: batchInput.conferenceTitle,
                conferenceAcronym: originalAcronym,
                // ++ THÊM CÁC LINK VÀO ĐÂY CHO UPDATE FLOW ++
                mainLink: batchInput.mainLink, // Giả sử BatchUpdateEntry có mainLink
                cfpLink: batchInput.cfpLink,   // Giả sử BatchUpdateEntry có cfpLink
                impLink: batchInput.impLink,   // Giả sử BatchUpdateEntry có impLink
                // ++ ------------------------------------ ++
                conferenceTextPath: batchInput.conferenceTextPath,
                cfpTextPath: batchInput.cfpTextPath,
                impTextPath: batchInput.impTextPath,
                originalRequestId: batchInput.originalRequestId,

                internalProcessingAcronym: internalProcessingAcronym, // Store the generated internal acronym
                batchRequestId: batchRequestIdForTask,
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpMetaData: apiResults.cfpMetaData,
            };

            await this.appendFinalRecord(finalRecord, batchRequestIdForTask, logger.child({ subOperation: 'append_final_update_record' }));


            logger.info({ event: 'batch_task_finish_success', flow: 'update' }); // Sửa event

            // >>> VỊ TRÍ ĐẶT LOG TASK_FINISH KHI THÀNH CÔNG <<<
            logger.info({ event: 'task_finish', success: true }, `Finished processing conference task for "${finalRecord.conferenceTitle}" (${finalRecord.conferenceAcronym}).`);

            return true;
        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'update' }); // Sửa event

            // >>> VỊ TRÍ ĐẶT LOG TASK_FINISH KHI THẤT BẠI <<<
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({
                err: error,
                event: 'task_finish', // Sử dụng cùng event
                success: false,
                error_details: errorMessage
            }, `Finished processing conference task  with failure.`); // for "${batchInput.conferenceAcronym}"

            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForUpdate for ${batchInput.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}, BatchRequestID: ${batchRequestIdForTask}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_update_task_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }
    public async _executeBatchTaskForSave(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        primaryOriginalAcronymForInitialFilesPrefix: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        logger: Logger
    ): Promise<boolean> {
        logger.info({ event: 'batch_task_start_execution', flow: 'save', entryCountInBatch: initialBatchEntries.length });

        if (!initialBatchEntries || initialBatchEntries.length === 0 || !initialBatchEntries[0]?.conferenceAcronym || !initialBatchEntries[0]?.conferenceTitle) {
            logger.warn({ event: 'invalid_batch_input_for_save_task' });
            return false;
        }
        const primaryEntryForContext = initialBatchEntries[0]; // Used for initial title/acronym context
        // Sanitize the primary original acronym for naming initial aggregate files (pre-determination)
        const safePrimaryOriginalAcronymForInitialFiles = primaryOriginalAcronymForInitialFilesPrefix.replace(/[^a-zA-Z0-9_.-]/g, '-');

        let determineResponseTextPath: string | undefined = undefined;
        let determineMetaData: any | null = null;
        let determineLinksResponse: ApiResponse;


        // ++ Biến để lưu trữ các link từ API 1 ++
        let officialWebsiteFromApi1: string | null = null;
        let cfpLinkFromApi1: string | null = null;
        let impLinkFromApi1: string | null = null;
        // ++ Path của text từ API 1 (nếu có match ban đầu) ++
        let cfpTextPathFromApi1Match: string | null = null;
        let impTextPathFromApi1Match: string | null = null;

        try {
            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForTask);
            await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], logger.child({ subOperation: 'ensure_directories_save_task' }));

            // 1. Aggregate content from initialBatchEntries for determine_links_api
            logger.debug({ event: 'aggregate_content_for_determine_api_start_save_task' });
            let batchContentParts: string[] = [];
            // This part could also be a method in ConferenceDataAggregatorService if complex/reused
            const readPromises = initialBatchEntries.map(async (entry, i) => {
                const entryLogger = logger.child({ entryIndexInBatch: i, entryLink: entry.mainLink });
                if (!entry.conferenceTextPath) {
                    entryLogger.warn({ event: 'read_content_skipped_no_path_for_determine_aggregation_save_task' });
                    return { index: i, content: `${i + 1}. WARNING: Missing text path for ${entry.mainLink}\n\n` }; // Less critical here
                }
                try {
                    const text = await this.fileSystemService.readFileContent(entry.conferenceTextPath, entryLogger);
                    return { index: i, content: `Source Link [${i + 1}]: ${entry.mainLink}\nContent [${i + 1}]:\n${text.trim()}\n\n---\n\n` };
                } catch (readError: any) {
                    entryLogger.error({ err: readError, filePath: entry.conferenceTextPath, event: 'read_content_failed_for_determine_aggregation_save_task' });
                    return { index: i, content: `Source Link [${i + 1}]: ${entry.mainLink}\nContent [${i + 1}]:\nERROR READING CONTENT\n\n---\n\n` };
                }
            });
            const readResults = await Promise.all(readPromises);
            readResults.sort((a, b) => a.index - b.index);
            batchContentParts = readResults.map(r => r.content);
            // Use original acronym from primary entry for this aggregation
            const batchContentForDetermine = `Conference Info:\nTitle: ${primaryEntryForContext.conferenceTitle}\nAcronym: ${primaryEntryForContext.conferenceAcronym}\n\nCandidate Website Contents:\n${batchContentParts.join("")}`;
            logger.debug({ charCount: batchContentForDetermine.length, event: 'aggregate_content_for_determine_api_end_save_task' });

            // Name this intermediate file using the sanitized primary original acronym for initial files
            const fileFullLinksName = `${safePrimaryOriginalAcronymForInitialFiles}_item${batchItemIndex}_full_links.txt`;
            const fileFullLinksPath = path.join(this.batchesDir, fileFullLinksName);
            const writeFileFullLinksLogger = logger.child({ fileOperation: 'write_intermediate_full_links_save', filePath: fileFullLinksPath });
            const writeFullLinksPromise = this.fileSystemService.writeFile(fileFullLinksPath, batchContentForDetermine, writeFileFullLinksLogger)
                .then(() => writeFileFullLinksLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => writeFileFullLinksLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_full_links_content' }));


            // 2. Call determine_links_api (API 1)
            // let determineLinksResponse: ApiResponse; // Đã khai báo ở trên
            const determineApiLogger = logger.child({ apiType: this.geminiApiService.API_TYPE_DETERMINE, geminiApiCallNumber: 1 });
            // Call determine_links_api (sử dụng batchItemIndex)
            const determineApiParams: GeminiApiParams = {
                batch: batchContentForDetermine, batchIndex: batchItemIndex,
                title: primaryEntryForContext.conferenceTitle,
                acronym: primaryEntryForContext.conferenceAcronym, // Use ORIGINAL acronym for API
            };

            try {
                determineLinksResponse = await this.geminiApiService.determineLinks(
                    determineApiParams,
                    apiModels.determineLinks, // << SỬ DỤNG apiModels.determineLinks
                    determineApiLogger
                );
                // Name determine response file using the sanitized primary original acronym for initial files
                determineResponseTextPath = await this.fileSystemService.saveTemporaryFile(
                    determineLinksResponse.responseText || "",
                    `${safePrimaryOriginalAcronymForInitialFiles}_item${batchItemIndex}_determine_response`,
                    determineApiLogger.child({ fileOperation: 'save_determine_response_save_task' })
                );
                determineMetaData = determineLinksResponse.metaData;

                // ++ Parse và lưu trữ các link từ API 1 ngay sau khi gọi ++
                if (determineLinksResponse.responseText) {
                    try {
                        const parsedApi1Data = JSON.parse(determineLinksResponse.responseText);
                        const rawOfficialWebsite = parsedApi1Data?.["Official Website"] ?? null;
                        if (rawOfficialWebsite && typeof rawOfficialWebsite === 'string' && rawOfficialWebsite.trim().toLowerCase() !== "none" && rawOfficialWebsite.trim() !== '') {
                            officialWebsiteFromApi1 = normalizeAndJoinLink(rawOfficialWebsite, null, determineApiLogger.child({ linkParseContext: 'api1_official' }));
                        }

                        if (officialWebsiteFromApi1) { // Chỉ parse CFP/IMP nếu có official website hợp lệ từ API 1
                            const rawCfpLink = String(parsedApi1Data?.["Call for papers link"] ?? '').trim();
                            cfpLinkFromApi1 = normalizeAndJoinLink(officialWebsiteFromApi1, rawCfpLink, determineApiLogger.child({ linkParseContext: 'api1_cfp' }));

                            const rawImpLink = String(parsedApi1Data?.["Important dates link"] ?? '').trim();
                            impLinkFromApi1 = normalizeAndJoinLink(officialWebsiteFromApi1, rawImpLink, determineApiLogger.child({ linkParseContext: 'api1_imp' }));
                        }
                        determineApiLogger.info({ officialWebsiteFromApi1, cfpLinkFromApi1, impLinkFromApi1, event: 'api1_links_parsed_for_fallback_consideration' });

                    } catch (parseError) {
                        determineApiLogger.error({ err: parseError, event: 'api1_response_parse_failed_for_fallback_links' });
                        // Không throw, để flow tiếp tục, các link fallback sẽ là null
                    }
                }

                determineApiLogger.info({ responseLength: determineLinksResponse.responseText?.length, filePath: determineResponseTextPath, event: 'gemini_determine_api_call_end_save_task', success: !!determineResponseTextPath }); // Log sau khi có kết quả
            } catch (determineLinksError: any) {
                determineApiLogger.error({ err: determineLinksError, event: 'save_batch_determine_api_call_failed', apiCallNumber: 1 });
                await writeFullLinksPromise;
                throw new Error(`Critical: Determine links API failed for item ${batchItemIndex} (SAVE): ${determineLinksError.message}`); // Sửa lỗi "batch" thành "item"
            }

            // 3. Process determine_links_api response using ConferenceDeterminationService
            const processDetermineLogger = logger.child({ subOperation: 'process_determine_api_response_save_task' });
            let processedMainEntries: BatchEntry[];

            try {
                // conferenceDeterminationService should return BatchEntry with original acronym
                processedMainEntries = await this.conferenceDeterminationService.determineAndProcessOfficialSite(
                    determineLinksResponse.responseText || "",
                    initialBatchEntries, // Pass entries with original acronyms
                    batchItemIndex,
                    browserContext,
                    apiModels.determineLinks,
                    processDetermineLogger
                );
            } catch (processError: any) {
                processDetermineLogger.error({ err: processError, event: 'save_batch_process_determine_call_failed' });
                throw processError; // Re-throw để bắt ở khối catch lớn hơn của _executeBatchTaskForSave
            }

            if (!processedMainEntries || processedMainEntries.length === 0 || !processedMainEntries[0] || processedMainEntries[0].mainLink === "None" || !processedMainEntries[0].conferenceTextPath) {
                processDetermineLogger.error({ // Sử dụng processDetermineLogger đã khởi tạo
                    resultCount: processedMainEntries?.length,
                    mainLinkResult: processedMainEntries?.[0]?.mainLink,
                    mainTextPathResult: processedMainEntries?.[0]?.conferenceTextPath,
                    event: 'save_batch_process_determine_failed_invalid'
                });
                await writeFullLinksPromise;
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave (Determine API processing) for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}): Main link/text path invalid.\n`;
                this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_determine_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
                return false;
            }

            const mainEntryAfterDetermination = processedMainEntries[0]; // mainEntryAfterDetermination.conferenceAcronym is ORIGINAL
            const originalAcronymFromDetermination = mainEntryAfterDetermination.conferenceAcronym;


            // ++ Logic fallback cho cfpLink, impLink, cfpTextPath, impTextPath ++
            let finalCfpLink = mainEntryAfterDetermination.cfpLink;
            let finalImpLink = mainEntryAfterDetermination.impLink;
            let finalCfpTextPath = mainEntryAfterDetermination.cfpTextPath;
            let finalImpTextPath = mainEntryAfterDetermination.impTextPath;

            // Kiểm tra xem có "match" ban đầu không để lấy cfpTextPath/impTextPath từ API 1
            // Điều này giả định rằng nếu có match, conferenceDeterminationService đã xử lý và lưu text path
            // cho các link từ API 1 vào `matchingEntryFromBatch`
            const matchedEntryFromApi1Processing = initialBatchEntries.find(entry => {
                const normalizedEntryLink = normalizeAndJoinLink(entry.mainLink, null, logger);
                return normalizedEntryLink && officialWebsiteFromApi1 && normalizedEntryLink === officialWebsiteFromApi1;
            });

            if (matchedEntryFromApi1Processing) {
                // Nếu có match, `mainEntryAfterDetermination` chính là `matchedEntryFromApi1Processing` đã được cập nhật
                // `mainEntryAfterDetermination.cfpTextPath` và `impTextPath` đã là của API 1 rồi.
                // Không cần làm gì thêm ở đây cho text path nếu là match.
                // Tuy nhiên, link có thể đã được chuẩn hóa lại, nên vẫn ưu tiên link từ mainEntryAfterDetermination
                // nếu nó không null/rỗng.
                processDetermineLogger.info({
                    event: 'api1_match_detected_for_fallback_context',
                    api1_cfp: cfpLinkFromApi1, api1_imp: impLinkFromApi1,
                    determined_cfp: mainEntryAfterDetermination.cfpLink, determined_imp: mainEntryAfterDetermination.impLink
                });
            }


            // Generate internal processing acronym from the determined original acronym
            const internalProcessingAcronym = await addAcronymSafely(this.globalProcessedAcronymsSet, originalAcronymFromDetermination);
            // Create a safe version of this internal acronym for post-determination file naming
            const safeInternalAcronymOfDeterminedConference = internalProcessingAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');

            // Log both original determined and the internal processing acronym
            logger.info({
                originalDeterminedAcronym: originalAcronymFromDetermination,
                internalProcessingAcronymForFiles: internalProcessingAcronym,
                safeInternalAcronymForFiles: safeInternalAcronymOfDeterminedConference,
                event: 'acronym_safely_adjusted_for_save' // Event name kept same
            });

            processDetermineLogger.info({
                finalMainLink: mainEntryAfterDetermination.mainLink,
                mainTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpPath: mainEntryAfterDetermination.cfpTextPath,
                impPath: mainEntryAfterDetermination.impTextPath,
                originalAcronymAfterDetermination: originalAcronymFromDetermination, // Log original
                internalProcessingAcronymForFiles: internalProcessingAcronym, // Log internal for files
                event: 'successfully_processed_determine_response_save_task'
            });


            // 4. Read and Aggregate Content for Final APIs
            const contentPathsForFinalApi: ContentPaths = {
                conferenceTextPath: mainEntryAfterDetermination.conferenceTextPath, // Luôn là của trang chính thức đã xác định
                cfpTextPath: finalCfpTextPath, // Sử dụng text path đã có thể được fallback/reset
                impTextPath: finalImpTextPath, // Sử dụng text path đã có thể được fallback/reset
            };
            const aggregatedContentForFinalApi = await this.conferenceDataAggregatorService.readContentFiles(
                contentPathsForFinalApi, logger.child({ subOperation: 'read_determined_content_files_save_task' })
            );
            // Aggregate content using ORIGINAL determined acronym
            const contentSendToFinalApi = this.conferenceDataAggregatorService.aggregateContentForApi(
                mainEntryAfterDetermination.conferenceTitle,
                originalAcronymFromDetermination,
                aggregatedContentForFinalApi,
                logger.child({ subOperation: 'aggregate_for_extract_cfp_apis_save_task' })
            );

            // Name main link content file using the safe internal acronym of the determined conference
            const fileMainLinkName = `${safeInternalAcronymOfDeterminedConference}_item${batchItemIndex}_main_link_content.txt`;
            const fileMainLinkPath = path.join(this.batchesDir, fileMainLinkName);
            const writeFileMainLinkLogger = logger.child({ fileOperation: 'write_intermediate_main_link_content_save', filePath: fileMainLinkPath });
            const fileMainLinkPromise = this.fileSystemService.writeFile(fileMainLinkPath, contentSendToFinalApi, writeFileMainLinkLogger)
                .then(() => writeFileMainLinkLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => writeFileMainLinkLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_main_link_content' }));

            // 5. Execute Final Extraction APIs
            // Execute final APIs using ORIGINAL determined acronym for API, and safe internal acronym for response file naming
            const finalApiResults = await this.executeFinalExtractionApis(
                contentSendToFinalApi, batchItemIndex, mainEntryAfterDetermination.conferenceTitle,
                originalAcronymFromDetermination, // Pass ORIGINAL acronym
                safeInternalAcronymOfDeterminedConference, // Pass safe internal acronym for file naming
                false,
                apiModels.extractInfo,
                apiModels.extractCfp,
                logger
            );

            await Promise.allSettled([writeFullLinksPromise, fileMainLinkPromise]);
            logger.debug({ event: 'intermediate_file_writes_settled_save_task' });

            // 6. Prepare and Append Final Record
            // 6. Prepare and Append Final Record
            const finalRecord: BatchEntryWithIds = {
                conferenceTitle: mainEntryAfterDetermination.conferenceTitle,
                conferenceAcronym: originalAcronymFromDetermination,
                mainLink: mainEntryAfterDetermination.mainLink, // Link chính thức
                conferenceTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpLink: finalCfpLink, // Sử dụng link đã fallback
                cfpTextPath: finalCfpTextPath, // Sử dụng text path đã fallback/reset
                impLink: finalImpLink, // Sử dụng link đã fallback
                impTextPath: finalImpTextPath, // Sử dụng text path đã fallback/reset
                linkOrderIndex: mainEntryAfterDetermination.linkOrderIndex,
                originalRequestId: mainEntryAfterDetermination.originalRequestId,
                internalProcessingAcronym: internalProcessingAcronym,
                batchRequestId: batchRequestIdForTask,
                determineResponseTextPath: determineResponseTextPath, // Vẫn là của API 1
                determineMetaData: determineMetaData,                 // Vẫn là của API 1
                extractResponseTextPath: finalApiResults.extractResponseTextPath,
                extractMetaData: finalApiResults.extractMetaData,
                cfpResponseTextPath: finalApiResults.cfpResponseTextPath,
                cfpMetaData: finalApiResults.cfpMetaData,
            };
            await this.appendFinalRecord(finalRecord, batchRequestIdForTask, logger.child({ subOperation: 'append_final_save_record' }));

            logger.info({ event: 'batch_task_finish_success', flow: 'save' });

            // >>> VỊ TRÍ ĐẶT LOG TASK_FINISH KHI THÀNH CÔNG <<<
            logger.info({ event: 'task_finish', success: true }, `Finished processing conference task for "${finalRecord.conferenceTitle}" (${finalRecord.conferenceAcronym}).`);

            return true;

        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'save' });

            // >>> VỊ TRÍ ĐẶT LOG TASK_FINISH KHI THẤT BẠI <<<
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({
                err: error,
                event: 'task_finish', // Sử dụng cùng event
                success: false,
                error_details: errorMessage
            }, `Finished processing conference task with failure.`);

            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}, BatchRequestID: ${batchRequestIdForTask}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_main_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }

    private async appendFinalRecord(
        record: BatchEntryWithIds | BatchUpdateDataWithIds, // These types now include internalProcessingAcronym
        batchRequestIdForFile: string,
        parentLogger: Logger
    ): Promise<void> {
        const jsonlPathForBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForFile);
        const logger = parentLogger.child({
            batchServiceFunction: 'appendFinalRecord',
            outputPath: jsonlPathForBatch,
            recordOriginalAcronymForAppend: record.conferenceAcronym, // Log original acronym
            recordInternalAcronymForAppend: record.internalProcessingAcronym, // Log internal acronym
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


