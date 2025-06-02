
// src/services/batchProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs'; // Keep for ensureDirectories if it stays or for other direct fs use
import path from 'path'; // Keep for path manipulations
import { Page, BrowserContext } from 'playwright';
import { Logger } from 'pino';

// --- Types ---
import {
    ConferenceData, ConferenceUpdateData,
    ApiModels
} from '../types/crawl/crawl.types'; // Adjust path as needed
// Assuming LogContext types are moved and imported
// import { LogContextBase, BatchProcessingLogContext } from '../types/batchProcessing.types'; // Adjust path

// --- Service Imports ---
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
// Removed GeminiApiService, FileSystemService as direct dependencies if fully delegated
// Kept FileSystemService if ensureDirectories or other direct FS ops remain here.
// For now, ensureDirectories is moved, so FileSystemService might not be needed directly by orchestrator.
// Let's remove FileSystemService from orchestrator for now. If any direct use remains, it can be re-added.

import { IConferenceLinkProcessorService } from './batchProcessingServiceChild/conferenceLinkProcessor.service';
// ConferenceDeterminationService and ConferenceDataAggregatorService are used by BatchTaskExecutorService

// --- New Refactored Service Imports ---
import { IBatchTaskExecutorService } from './interfaces/batchTaskExecutor.interface'; // Adjust path
// BatchApiHandlerService is used by BatchTaskExecutorService
// BatchOutputPersistenceService is used by BatchTaskExecutorService

import { BatchEntry, BatchUpdateEntry } from '../types/crawl/crawl.types';
@singleton()
export class BatchProcessingService { // Renaming to BatchProcessingOrchestratorService is a good idea for clarity
    // but problem asks to refactor BatchProcessingService. Keeping name for now.
    private readonly serviceBaseLogger: Logger;
    private readonly configService: ConfigService; // Keep if needed for paths like tempDir
    // Child services that are directly used by the orchestrator's main methods
    private readonly conferenceLinkProcessorService: IConferenceLinkProcessorService;

    // New core task execution service
    private readonly batchTaskExecutorService: IBatchTaskExecutorService;

    private readonly tempDir: string; // Used by orchestrator? Or only by children?
    // Original constructor logged it. If not used, can be removed.
    // Let's assume it might be used for orchestrator-level temp ops or config.

    private globalProcessedAcronymsSet: Set<string> = new Set();
    private activeBatchSaves: Set<Promise<boolean>> = new Set();

    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
        // Inject new core services
        @inject('IBatchTaskExecutorService') batchTaskExecutorService: IBatchTaskExecutorService,
        // Inject existing child services used directly by orchestrator
        @inject('IConferenceLinkProcessorService') conferenceLinkProcessorService: IConferenceLinkProcessorService,
        // @inject('IPageContentExtractorService') pageContentExtractorService: IPageContentExtractorService, // If not used directly by orchestrator
        // @inject('IConferenceDeterminationService') conferenceDeterminationService: IConferenceDeterminationService, // Used by BatchTaskExecutor
        // @inject('IConferenceDataAggregatorService') conferenceDataAggregatorService: IConferenceDataAggregatorService // Used by BatchTaskExecutor
    ) {
        this.configService = configService;
        this.batchTaskExecutorService = batchTaskExecutorService;
        this.conferenceLinkProcessorService = conferenceLinkProcessorService;

        // Note: The service name in logger is 'BatchProcessingServiceOrchestrator' in original.
        // If class name remains BatchProcessingService, this might be slightly confusing but per spec.
        this.serviceBaseLogger = loggingService.getLogger('conference', { service: 'BatchProcessingServiceOrchestrator' });

        // batchesDir is used by BatchTaskExecutorService via ConfigService.
        // tempDir might be used for orchestrator specific temporary files if any, or just for logging.
        this.tempDir = this.configService.tempDir;

        this.serviceBaseLogger.info("BatchProcessingService (Orchestrator) constructed.");
        this.serviceBaseLogger.info(`Batches Directory (via ConfigService): ${this.configService.batchesDir}`);
        this.serviceBaseLogger.info(`Temp Directory: ${this.tempDir}`);
    }

    public resetGlobalAcronyms(logger: Logger) {
        this.globalProcessedAcronymsSet.clear();
        // Ensure logger passed here is appropriate, or use this.serviceBaseLogger
        const effectiveLogger = logger || this.serviceBaseLogger;
        effectiveLogger.info({ event: 'global_processed_acronyms_reset', service: 'BatchProcessingService' }); // Original service name
    }

    // ensureDirectories has been moved to BatchOutputPersistenceService.
    // If the orchestrator needs to ensure some very top-level dirs at startup,
    // it could call that service or have its own minimal version.
    // For now, assuming specific dir creation is handled closer to where files are written.

    // executeFinalExtractionApis has been moved to BatchApiHandlerService,
    // which is called by BatchTaskExecutorService.

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
            batchServiceMethod: 'processConferenceUpdate', // Original method name
            originalConferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            service: 'BatchProcessingServiceOrchestrator' // Original service name for this log
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
                    return cfpPath ? "" : null; // Original logic: empty string if cfpPath exists, else null
                });
            } else {
                impPromiseVal = cfpPromise.then(cfpPath => // Ensure cfpPromise is resolved before processing IMP
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

            // Delegate to BatchTaskExecutorService
            const updateSuccess = await this.batchTaskExecutorService.executeBatchTaskForUpdate(
                batchDataForExecute,
                batchItemIndexFromParent,
                batchRequestIdFromParent,
                apiModels,
                this.globalProcessedAcronymsSet, // Pass the set
                methodLogger // Pass the current logger
            );
            methodLogger.info({ event: 'batch_processing_flow_finish', success: updateSuccess, flow: 'update' });
            return updateSuccess;
        } catch (error: any) {
            methodLogger.error({ err: error, event: 'batch_process_update_unhandled_error', flow: 'update_initiation_error' });
            // Error logging to file is handled by BatchTaskExecutorService or BatchOutputPersistenceService
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

        const year = this.configService.config.YEAR2;
        const methodLogger = parentLogger.child({
            batchServiceMethod: 'processConferenceSave', // Original method name
            originalConferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            service: 'BatchProcessingServiceOrchestrator' // Original service name for this log
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

                // Logger for the task execution itself, will be passed to BatchTaskExecutorService
                const batchTaskLogger = methodLogger.child({
                    // asyncBatchTask: '_executeBatchTaskForSave', // Original context
                    serviceScopedFunction: 'executeBatchTaskForSave', // For BatchTaskExecutorService
                    originalConferenceAcronym: primaryOriginalAcronymForTask,
                    conferenceTitle: taskTitleContext,
                });
                // Log initiation from orchestrator
                methodLogger.info({ entriesInBatch: batchForDetermineApi.length, assignedBatchItemIndex: batchItemIndexFromParent, event: 'batch_task_create_delegation_start', flow: 'save' });

                // Delegate to BatchTaskExecutorService
                // Note: _executeBatchTaskForSave was originally async and its promise added to activeBatchSaves.
                // The new executeBatchTaskForSave should also return a Promise<boolean>.
                const batchPromise = this.batchTaskExecutorService.executeBatchTaskForSave(
                    batchForDetermineApi,
                    batchItemIndexFromParent,
                    primaryOriginalAcronymForTask,
                    browserContext, // Pass browserContext
                    batchRequestIdFromParent,
                    apiModels,
                    this.globalProcessedAcronymsSet, // Pass the set
                    batchTaskLogger // Pass the specific logger for this task execution
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
            methodLogger.error({ err: error, event: 'batch_process_save_unhandled_error', flow: 'save_initiation_error' });
            // Error logging to file is handled by BatchTaskExecutorService or BatchOutputPersistenceService
            return false;
        } finally {
            if (page && !page.isClosed()) await this._closePages([page], methodLogger);
            methodLogger.debug("Finished cleanup in processConferenceSave.");
        }
    }

    // _executeBatchTaskForUpdate and _executeBatchTaskForSave are moved to BatchTaskExecutorService.
    // appendFinalRecord is moved to BatchOutputPersistenceService.

    public async awaitCompletion(parentLogger?: Logger): Promise<void> {
        const logger = (parentLogger || this.serviceBaseLogger).child({
            batchServiceMethod: 'awaitCompletion', // Original method name
            service: 'BatchProcessingServiceOrchestrator' // Original service name
        });
        const initialCount = this.activeBatchSaves.size;
        if (initialCount === 0) {
            logger.info("No active batch save operations to await.");
            return;
        }
        logger.info(`Waiting for ${initialCount} active asynchronous batch save operation(s) to complete...`);
        const promisesToAwait = [...this.activeBatchSaves]; // Snapshot
        const results = await Promise.allSettled(promisesToAwait);

        results.forEach((result, index) => {
            if (result.status === 'fulfilled') {
                logger.debug({ promiseIndexInSnapshot: index, batchTaskResult: result.value, event: 'batch_task_settled_fulfilled_await' });
            } else {
                logger.warn({ promiseIndexInSnapshot: index, batchTaskErrorReason: result.reason instanceof Error ? result.reason.message : String(result.reason), event: 'batch_task_settled_rejected_await' });
            }
        });

        // Check activeBatchSaves again in case new tasks were added while awaiting
        // This recursive call handles tasks added by other concurrent operations, if any.
        if (this.activeBatchSaves.size > 0) {
            // This condition might be tricky if tasks are added *during* the Promise.allSettled.
            // The original logic was to check if the set is non-empty after awaiting the snapshot.
            // This implies that tasks might remove themselves from activeBatchSaves upon completion.
            // The current logic `batchPromise.finally(() => this.activeBatchSaves.delete(batchPromise));` handles this.
            // So, if activeBatchSaves is still > 0, it means new tasks were added *after* the snapshot was taken
            // but before this check, OR some tasks from the snapshot are still somehow in the set (which shouldn't happen with .finally).
            // The most likely scenario for recursion is new tasks added by *other* calls to processConferenceSave
            // that happened concurrently while this awaitCompletion was running.
            logger.warn({ remainingActiveSaves: this.activeBatchSaves.size, event: 'new_active_batch_saves_found_after_await_recursion' });
            await this.awaitCompletion(logger);
        } else {
            logger.info({ initialAwaitedCount: initialCount, event: 'all_tracked_batch_save_operations_completed_await' });
        }
    }

    private async _closePages(pages: Page[], parentLogger: Logger): Promise<void> {
        const logger = parentLogger.child({
            // batchServiceFunction: '_closePages', // Original name
            serviceScopedFunction: '_closePages', // New scope within orchestrator
            service: 'BatchProcessingServiceOrchestrator' // Original service name
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