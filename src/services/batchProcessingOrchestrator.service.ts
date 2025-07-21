// src/services/batchProcessingOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject, DependencyContainer } from 'tsyringe'; // <<< THÊM DependencyContainer
import fs from 'fs';
import path from 'path';
import { Page, BrowserContext } from 'playwright';
import { Logger } from 'pino';

// --- Types ---
import {
    BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData, ApiModels,
} from '../types/crawl';

// --- Service Imports ---
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { FileSystemService } from './fileSystem.service';
import { IConferenceLinkProcessorService } from './batchProcessing/conferenceLinkProcessor.service';
// --- NEW SERVICE IMPORTS ---
import { IUpdateTaskExecutorService } from './batchProcessing/updateTaskExecutor.service';
import { ISaveTaskExecutorService } from './batchProcessing/saveTaskExecutor.service';
import { withOperationTimeout } from './batchProcessing/utils';
import { RequestStateService } from './requestState.service';

@singleton()
export class BatchProcessingOrchestratorService { // <<< RENAMED
    private readonly serviceBaseLogger: Logger;
    private readonly batchesDir: string;
    private readonly tempDir: string;
    private readonly errorLogPath: string;

    private globalProcessedAcronymsSet: Set<string> = new Set();
    private activeBatchSaves: Set<Promise<boolean>> = new Set();

    constructor(
        @inject(ConfigService) private readonly configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService,
        @inject('IConferenceLinkProcessorService') private readonly conferenceLinkProcessorService: IConferenceLinkProcessorService,
        // --- INJECT NEW SERVICES ---
        // @inject('IUpdateTaskExecutorService') private readonly updateTaskExecutorService: IUpdateTaskExecutorService,
        // @inject('ISaveTaskExecutorService') private readonly saveTaskExecutorService: ISaveTaskExecutorService
    ) {
        this.serviceBaseLogger = loggingService.getLogger('conference', { service: 'BatchProcessingServiceOrchestrator' });
        this.batchesDir = this.configService.batchesDir;
        this.tempDir = this.configService.tempDir;
        this.errorLogPath = path.join(this.configService.baseOutputDir, 'batch_processing_errors.log');
        this.serviceBaseLogger.info("BatchProcessingOrchestratorService constructed."); // <<< UPDATED
        this.serviceBaseLogger.info(`Batches Directory: ${this.batchesDir}`);
        this.serviceBaseLogger.info(`Temp Directory: ${this.tempDir}`);
    }

    public resetGlobalAcronyms(logger: Logger) {
        this.globalProcessedAcronymsSet.clear();
        logger.info({ event: 'global_processed_acronyms_reset', service: 'BatchProcessingService' }); // Giữ nguyên service name trong log
    }

    private async ensureDirectories(paths: string[], loggerToUse?: Logger): Promise<void> {
        const logger = loggerToUse || this.serviceBaseLogger;
        const logContext = { function: 'ensureDirectories', service: 'BatchProcessingServiceOrchestrator' };
        for (const dirPath of paths) {
            let effectiveDirPath = dirPath;
            try {
                if (fs.existsSync(dirPath) && fs.statSync(dirPath).isFile()) {
                    effectiveDirPath = path.dirname(dirPath);
                } else if (!fs.existsSync(dirPath)) {
                    effectiveDirPath = path.dirname(dirPath);
                }
            } catch (e) {
                effectiveDirPath = path.dirname(dirPath);
            }

            if (!fs.existsSync(effectiveDirPath)) {
                logger.info({ ...logContext, path: effectiveDirPath, event: 'batch_processing_ensure_dir_create_attempt' });
                try {
                    await this.fileSystemService.ensureDirExists(effectiveDirPath, logger);
                } catch (mkdirError: unknown) {
                    logger.error({ ...logContext, path: effectiveDirPath, err: mkdirError, event: 'batch_dir_create_failed' });
                    throw mkdirError;
                }
            }
        }
    }

    // <<< METHOD executeFinalExtractionApis REMOVED (moved to FinalExtractionApiService) >>>
    // <<< METHOD appendFinalRecord REMOVED (moved to FinalRecordAppenderService) >>>

    public async processConferenceUpdate(
        browserContext: BrowserContext,
        conference: ConferenceUpdateData,
        parentLogger: Logger,
        apiModels: ApiModels,
        requestStateService: RequestStateService,
        requestContainer: DependencyContainer // <<< THAM SỐ MỚI


    ): Promise<boolean> {
        const batchRequestIdFromParent = parentLogger.bindings().batchRequestId as string;
        const batchItemIndexFromParent = parentLogger.bindings().batchItemIndex as number;

        if (!batchRequestIdFromParent || batchItemIndexFromParent === undefined) {
            parentLogger.error({ event: 'batch_processing_missing_ids_from_parent_logger', flow: 'update', conferenceAcronym: conference.Acronym });
            return false;
        }

        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceUpdate',
            originalConferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            service: 'BatchProcessingServiceOrchestrator'
        });

        const modelsDesc = `EI: ${apiModels.extractInfo}, EC: ${apiModels.extractCfp}`;
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


            // --- ĐỊNH NGHĨA TIMEOUT CHO TỪNG NHIỆM VỤ ---
            const OPERATION_TIMEOUT_MS = 60000; // 60 giây cho mỗi link

            // +++ DEFINE THE CORRECT PROMISE TYPES +++
            type MainLinkResult = { finalUrl: string | null; textPath: string | null; textContent: string | null; imageUrls: string[] };
            type SubLinkResult = { path: string | null; content: string | null }; // This is our ProcessedContentResult

            // +++ BỌC CÁC PROMISE BẰNG withOperationTimeout +++
            const mainPromise = mainPage
                ? withOperationTimeout(
                    this.conferenceLinkProcessorService.processMainLinkForUpdate(mainPage, conference, methodLogger.child({ linkType: 'main_update' })),
                    OPERATION_TIMEOUT_MS,
                    `Process Main Link for ${conference.Acronym}`
                )
                : Promise.resolve({ finalUrl: null, textPath: null, textContent: null });


            const cfpPromise = withOperationTimeout(
                this.conferenceLinkProcessorService.processCfpLinkForUpdate(cfpPage, conference, methodLogger.child({ linkType: 'cfp_update' })),
                OPERATION_TIMEOUT_MS,
                `Process CFP Link for ${conference.Acronym}`
            );

            let impPromiseVal: Promise<SubLinkResult>;
            if (isImpSameAsNavigableCfp) {
                // If IMP is same as CFP, we wait for CFP to finish.
                // The result of cfpPromise is a SubLinkResult. We just pass it along.
                impPromiseVal = cfpPromise.then(cfpResult => {
                    methodLogger.info({ event: 'imp_link_resolved_as_same_as_cfp_update', cfpResult });
                    // Return an empty but valid result to indicate it was handled.
                    return { path: "", content: "" };
                });
            } else {
                // Bọc cả promise lồng nhau
                impPromiseVal = cfpPromise.then(cfpResult =>
                    withOperationTimeout(
                        this.conferenceLinkProcessorService.processImpLinkForUpdate(impPage, conference, cfpResult.path, methodLogger.child({ linkType: 'imp_update' })),
                        OPERATION_TIMEOUT_MS,
                        `Process IMP Link for ${conference.Acronym}`
                    )
                );
            }

            methodLogger.info({ event: 'PLAYWRIGHT_CRAWL_UPDATE_LINKS_START' });
            const crawlStartTime = performance.now();


            // Promise.allSettled sẽ nhận được lỗi reject từ timeout và tiếp tục
            const results = await Promise.allSettled([mainPromise, cfpPromise, impPromiseVal]);
            methodLogger.info({ event: 'parallel_link_fetch_settled_update_flow' });

            const crawlDurationMs = performance.now() - crawlStartTime;
            methodLogger.info({ event: 'PLAYWRIGHT_CRAWL_UPDATE_LINKS_END', durationMs: Math.round(crawlDurationMs) });

            // +++ PROCESS THE NEW RESULT TYPES +++
            let mainResult: MainLinkResult = { finalUrl: null, textPath: null, textContent: null, imageUrls: [] }; // Khởi tạo với mảng rỗng
            if (results[0].status === 'fulfilled') {
                mainResult = (results[0] as PromiseFulfilledResult<MainLinkResult>).value;
            } else {
                methodLogger.error({ event: 'main_link_processing_failed_update', err: (results[0] as PromiseRejectedResult).reason });
            }

            let cfpResult: SubLinkResult = { path: null, content: null };
            if (results[1].status === 'fulfilled') {
                cfpResult = (results[1] as PromiseFulfilledResult<SubLinkResult>).value;
            } else {
                methodLogger.error({ event: 'cfp_link_processing_failed_update', err: (results[1] as PromiseRejectedResult).reason });
            }

            let impResult: SubLinkResult = { path: null, content: null };
            if (results[2].status === 'fulfilled') {
                impResult = (results[2] as PromiseFulfilledResult<SubLinkResult>).value;
            } else {
                methodLogger.error({ event: 'imp_link_processing_failed_update', err: (results[2] as PromiseRejectedResult).reason });
            }

            // +++ UPDATE THE ABORT CONDITION +++
            // We check for content in production, and path in development.
            // A simple check for either is sufficient and safer.
            if (!mainResult.textContent && !mainResult.textPath) {
                methodLogger.error({ event: 'batch_processing_abort_no_main_text', flow: 'update', reason: 'Main text content/path missing' });
                return false;
            }


            const batchDataForExecute: BatchUpdateEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym,
                mainLink: conference.mainLink,
                impLink: conference.impLink,
                cfpLink: conference.cfpLink,
                conferenceTextPath: mainResult.textPath, // Will be null in prod
                conferenceTextContent: mainResult.textContent, // Will have data in prod
                imageUrls: mainResult.imageUrls, // <<< THÊM DÒNG NÀY
                cfpTextPath: cfpResult.path,
                cfpTextContent: cfpResult.content,
                impTextPath: impResult.path,
                impTextContent: impResult.content,
                originalRequestId: conference.originalRequestId,
            };

            // --- DELEGATE TO NEW SERVICE ---
            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdFromParent);
            await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], methodLogger);

            // <<< THAY ĐỔI CỐT LÕI: RESOLVE EXECUTOR TỪ REQUEST CONTAINER >>>
            const updateTaskExecutor = requestContainer.resolve<IUpdateTaskExecutorService>('IUpdateTaskExecutorService');

            const updateSuccess = await updateTaskExecutor.execute( // <<< DÙNG INSTANCE VỪA RESOLVE
                batchDataForExecute,
                batchItemIndexFromParent,
                batchRequestIdFromParent,
                apiModels,
                this.globalProcessedAcronymsSet,
                methodLogger,
                requestStateService
            );
            // -----------------------------

            methodLogger.info({ event: 'batch_processing_flow_finish', success: updateSuccess, flow: 'update' });
            return updateSuccess;
        } catch (error: any) {
            methodLogger.error({ err: error, event: 'batch_process_update_unhandled_error', flow: 'update_initiation_error' });
            return false;
        } finally {
            // Block này GIỜ ĐÂY sẽ luôn được gọi, ngay cả khi một trong các promise ở trên bị timeout
            await this._closePages(pages, methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceUpdate.");
        }
    }

    public async processConferenceSave(
        browserContext: BrowserContext,
        conference: ConferenceData,
        links: string[],
        parentLogger: Logger,
        apiModels: ApiModels,
        requestStateService: RequestStateService,
        requestContainer: DependencyContainer // <<< THAM SỐ MỚI


    ): Promise<boolean> {
        const batchRequestIdFromParent = parentLogger.bindings().batchRequestId as string;
        const batchItemIndexFromParent = parentLogger.bindings().batchItemIndex as number;

        if (!batchRequestIdFromParent || batchItemIndexFromParent === undefined) {
            parentLogger.error({ event: 'batch_processing_missing_ids_from_parent_logger', flow: 'save', conferenceAcronym: conference.Acronym });
            return false;
        }

        const year = this.configService.year2;
        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceSave',
            originalConferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            service: 'BatchProcessingOrchestratorService',
            // === THÊM DÒNG NÀY ===
            batchItemIndex: batchItemIndexFromParent,
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

            // --- ĐỊNH NGHĨA TIMEOUT CHO MỖI LINK ---
            const LINK_PROCESSING_TIMEOUT_MS = 60000; // 60 giây cho mỗi link


            const crawlStartTime = performance.now();
            methodLogger.info({ event: 'PLAYWRIGHT_CRAWL_INITIAL_LINKS_START', linkCount: links.length });


            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const singleLinkLogger = methodLogger.child({ linkProcessingIndex: i, originalLinkForProcessing: link });

                try {
                    // +++ BỌC LỜI GỌI SERVICE BẰNG TIMEOUT +++
                    const operationPromise = this.conferenceLinkProcessorService.processInitialLinkForSave(
                        page, link, i, conference, this.configService.year2, singleLinkLogger
                    );

                    const batchEntry = await withOperationTimeout(
                        operationPromise,
                        LINK_PROCESSING_TIMEOUT_MS,
                        `Process Initial Link [${i}]: ${link}`
                    );
                    // +++ KẾT THÚC PHẦN BỌC +++

                    if (batchEntry) {
                        batchForDetermineApi.push(batchEntry);
                        linkProcessingSuccessCount++;
                    } else {
                        // Trường hợp service trả về null (không tìm thấy content) chứ không phải lỗi
                        linkProcessingFailedCount++;
                    }
                } catch (linkError: any) {
                    // Bắt lỗi từ withOperationTimeout hoặc từ chính service
                    linkProcessingFailedCount++;
                    singleLinkLogger.error({ err: linkError, event: 'link_processing_loop_unhandled_error_or_timeout' });
                }
            }

            methodLogger.info({
                linksProcessed: links.length, successfulLinks: linkProcessingSuccessCount,
                failedLinks: linkProcessingFailedCount, batchEntriesCreated: batchForDetermineApi.length,
                event: 'all_links_processed_for_save_flow'
            });


            const crawlDurationMs = performance.now() - crawlStartTime;
            methodLogger.info({
                event: 'PLAYWRIGHT_CRAWL_INITIAL_LINKS_END',
                durationMs: Math.round(crawlDurationMs),
                // ...
            });


            if (batchForDetermineApi.length > 0) {
                const primaryOriginalAcronymForTask = batchForDetermineApi[0]?.conferenceAcronym || conference.Acronym;
                const taskTitleContext = batchForDetermineApi[0]?.conferenceTitle || conference.Title;

                const batchTaskLogger = methodLogger.child({
                    asyncBatchTask: '_executeBatchTaskForSave', // Giữ nguyên tên log
                    originalConferenceAcronym: primaryOriginalAcronymForTask,
                    conferenceTitle: taskTitleContext,
                });
                batchTaskLogger.info({ entriesInBatch: batchForDetermineApi.length, event: 'initiating_async_batch_task_for_save' });
                methodLogger.info({ entriesInBatch: batchForDetermineApi.length, assignedBatchItemIndex: batchItemIndexFromParent, event: 'batch_task_create_delegation_start', flow: 'save' });

                // --- DELEGATE TO NEW SERVICE ---
                const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdFromParent);
                await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], batchTaskLogger);


                // <<< THAY ĐỔI CỐT LÕI: RESOLVE EXECUTOR TỪ REQUEST CONTAINER >>>
                const saveTaskExecutor = requestContainer.resolve<ISaveTaskExecutorService>('ISaveTaskExecutorService');

                const batchPromise = saveTaskExecutor.execute( // <<< DÙNG INSTANCE VỪA RESOLVE
                    batchForDetermineApi,
                    batchItemIndexFromParent,
                    primaryOriginalAcronymForTask,
                    browserContext,
                    batchRequestIdFromParent,
                    apiModels,
                    this.globalProcessedAcronymsSet,
                    batchTaskLogger,
                    requestStateService
                );
                // -----------------------------
                // -----------------------------

                this.activeBatchSaves.add(batchPromise);
                batchPromise.finally(() => this.activeBatchSaves.delete(batchPromise));
                methodLogger.info({ assignedBatchItemIndex: batchItemIndexFromParent, event: 'batch_task_create_delegation_finish', flow: 'save' });
            } else {
                methodLogger.warn({ event: 'batch_processing_skipped_empty_after_link_processing_save_flow' });
            }
            methodLogger.info({ event: 'batch_processing_flow_finish', success: true, flow: 'save_initiation' });


            return true;
        } catch (error: any) {
            methodLogger.error({ err: error, event: 'batch_process_save_unhandled_error', flow: 'save_initiation_error' });
            return false;
        } finally {
            // Block này giờ đây sẽ luôn được gọi, đóng page dùng cho việc lặp qua các link
            if (page && !page.isClosed()) await this._closePages([page], methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceSave.");
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
            await this.awaitCompletion(logger);
        } else {
            logger.info({ initialAwaitedCount: initialCount, event: 'all_tracked_batch_save_operations_completed_await' });
        }
    }

    private async _closePages(pages: Page[], parentLogger: Logger): Promise<void> {
        const logger = parentLogger.child({
            batchServiceFunction: '_closePages',
            service: 'BatchProcessingServiceOrchestrator'
        });
        const pagesToClose = pages.filter(p => p && !p.isClosed());
        if (pagesToClose.length === 0) {
            logger.debug({ initialPageCount: pages.length, openPageCount: 0, event: 'no_pages_to_close_or_already_closed' });
            return;
        }

        logger.debug({ initialPageCount: pages.length, openPageCount: pagesToClose.length, event: 'closing_pages_start' });

        const closePromises = pagesToClose.map(p => {
            const closePromise = (async () => {
                try {
                    // Đặt timeout cho việc đóng page, ví dụ 5 giây
                    await Promise.race([
                        p.close(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Page close timed out after 5s')), 5000))
                    ]);
                    logger.trace({ pageId: (p as any)._guid, event: 'page_close_success' });
                } catch (err: any) {
                    logger.error({ pageId: (p as any)._guid, err: err, event: 'page_close_failed_in_loop' });
                }
            })();
            return closePromise;
        });

        // Chờ tất cả các thao tác đóng hoàn tất
        await Promise.all(closePromises);

        logger.debug({ attemptedToClose: pagesToClose.length, event: 'closing_pages_finish' });
    }
}