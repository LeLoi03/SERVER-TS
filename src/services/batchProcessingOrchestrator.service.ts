// src/services/batchProcessingOrchestrator.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
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
        @inject('IUpdateTaskExecutorService') private readonly updateTaskExecutorService: IUpdateTaskExecutorService,
        @inject('ISaveTaskExecutorService') private readonly saveTaskExecutorService: ISaveTaskExecutorService
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

            const mainPromise = mainPage ? this.conferenceLinkProcessorService.processMainLinkForUpdate(mainPage, conference, methodLogger.child({ linkType: 'main_update' })) : Promise.resolve({ finalUrl: null, textPath: null });
            const cfpPromise = this.conferenceLinkProcessorService.processCfpLinkForUpdate(cfpPage, conference, methodLogger.child({ linkType: 'cfp_update' }));

            let impPromiseVal: Promise<string | null>;
            if (isImpSameAsNavigableCfp) {
                impPromiseVal = cfpPromise.then(cfpPath => {
                    methodLogger.info({ event: 'imp_link_resolved_as_same_as_cfp_update', cfpPath });
                    return cfpPath ? "" : null;
                });
            } else {
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
                methodLogger.error({ event: 'batch_processing_abort_no_main_text', flow: 'update', reason: 'Main text path missing' });
                return false;
            }

            const batchDataForExecute: BatchUpdateEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym,
                mainLink: conference.mainLink,
                impLink: conference.impLink,
                cfpLink: conference.cfpLink,
                conferenceTextPath: mainResult.textPath,
                cfpTextPath: cfpTextPath,
                impTextPath: impTextPath,
                originalRequestId: conference.originalRequestId,
            };

            // --- DELEGATE TO NEW SERVICE ---
            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdFromParent);
            await this.ensureDirectories([this.batchesDir, path.dirname(jsonlPathForThisBatch)], methodLogger);

            const updateSuccess = await this.updateTaskExecutorService.execute(
                batchDataForExecute,
                batchItemIndexFromParent,
                batchRequestIdFromParent,
                apiModels,
                this.globalProcessedAcronymsSet, // Pass the global set
                methodLogger
            );
            // -----------------------------

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
        apiModels: ApiModels
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
            service: 'BatchProcessingServiceOrchestrator'
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
                const singleLinkLogger = methodLogger.child({ linkProcessingIndex: i, originalLinkForProcessing: link });

                try {
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

                const batchPromise = this.saveTaskExecutorService.execute(
                    batchForDetermineApi,
                    batchItemIndexFromParent,
                    primaryOriginalAcronymForTask,
                    browserContext,
                    batchRequestIdFromParent,
                    apiModels,
                    this.globalProcessedAcronymsSet, // Pass the global set
                    batchTaskLogger
                );
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
            if (page && !page.isClosed()) await this._closePages([page], methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceSave.");
        }
    }

    // <<< METHOD _executeBatchTaskForUpdate REMOVED (moved to UpdateTaskExecutorService) >>>
    // <<< METHOD _executeBatchTaskForSave REMOVED (moved to SaveTaskExecutorService) >>>

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