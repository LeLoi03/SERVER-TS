// src/services/batchTaskExecutor.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { Page, BrowserContext } from 'playwright';
import { Logger } from 'pino';

// --- Types ---
import {
    BatchEntry, BatchUpdateEntry,
    BatchEntryWithIds, BatchUpdateDataWithIds,
    ApiModels
} from '../../types/crawl/crawl.types'; // Adjust path
// Assuming LogContext types are moved and imported
// import { BatchProcessingLogContext } from '../types/batchProcessing.types'; // Adjust path

// --- Service Imports ---
import { ConfigService } from '../../config/config.service'; // Adjust path
import { LoggingService } from '../logging.service'; // Adjust path
import { GeminiApiService } from '../geminiApi.service'; // Adjust path
import { FileSystemService } from '../fileSystem.service'; // Adjust path
import { IConferenceDataAggregatorService, ContentPaths } from './conferenceDataAggregator.service'; // Adjust path
import { IConferenceDeterminationService } from './conferenceDetermination.service'; // Adjust path
import { IBatchTaskExecutorService } from '../interfaces/batchTaskExecutor.interface'; // Adjust path
import { IBatchApiHandlerService } from '../interfaces/batchApiHandler.interface'; // Adjust path
import { IBatchOutputPersistenceService } from '../interfaces/batchOutputPersistence.interface'; // Adjust path
import { GeminiApiParams,ApiResponse } from '../../types/crawl';
// --- Utils ---
import { addAcronymSafely } from '../../utils/crawl/addAcronymSafely'; // Adjust path
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils'; // Adjust path


@singleton()
export class BatchTaskExecutorService implements IBatchTaskExecutorService {
    private readonly serviceLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService, // For determineLinks
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject('IConferenceDataAggregatorService') private conferenceDataAggregatorService: IConferenceDataAggregatorService,
        @inject('IConferenceDeterminationService') private conferenceDeterminationService: IConferenceDeterminationService,
        @inject('IBatchApiHandlerService') private batchApiHandlerService: IBatchApiHandlerService,
        @inject('IBatchOutputPersistenceService') private batchOutputPersistenceService: IBatchOutputPersistenceService
    ) {
        this.serviceLogger = loggingService.getLogger('main', { service: 'BatchTaskExecutorService' });
        this.serviceLogger.info("BatchTaskExecutorService constructed.");
    }

    public async executeBatchTaskForUpdate(
        batchInput: BatchUpdateEntry,
        batchItemIndex: number,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>,
        parentLogger: Logger
    ): Promise<boolean> {
        const originalAcronym = batchInput.conferenceAcronym;

        // Original function name was '_executeBatchTaskForUpdate'
        const logger = parentLogger.child({
            // batchServiceFunction: '_executeBatchTaskForUpdate', // Original name
            serviceScopedFunction: 'executeBatchTaskForUpdate', // New scope
            // originalConferenceAcronym: originalAcronym, // Already in parentLogger
            // conferenceTitle: batchInput.conferenceTitle, // Already in parentLogger
        });
        logger.info({ event: 'batch_task_start_execution', flow: 'update' });

        try {
            const internalProcessingAcronym = await addAcronymSafely(globalProcessedAcronymsSet, originalAcronym);
            const safeInternalAcronymForFiles = internalProcessingAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
            logger.info({ internalProcessingAcronym, safeInternalAcronymForFiles, event: 'acronym_generated_for_update_files' });

            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForTask);
            // Use BatchOutputPersistenceService for ensuring directories
            await this.batchOutputPersistenceService.ensureDirectories(
                [this.configService.batchesDir, path.dirname(jsonlPathForThisBatch)],
                logger
            );

            const contentPaths: ContentPaths = {
                conferenceTextPath: batchInput.conferenceTextPath,
                cfpTextPath: batchInput.cfpTextPath,
                impTextPath: batchInput.impTextPath,
            };
            const aggregatedFileContent = await this.conferenceDataAggregatorService.readContentFiles(contentPaths, logger);
            const contentSendToAPI = this.conferenceDataAggregatorService.aggregateContentForApi(
                batchInput.conferenceTitle, originalAcronym, aggregatedFileContent, logger
            );

            const fileUpdateLogger = logger.child({ asyncOperation: 'write_intermediate_update_file' });
            const fileUpdateName = `${safeInternalAcronymForFiles}_update_item${batchItemIndex}.txt`;
            const fileUpdatePath = path.join(this.configService.batchesDir, fileUpdateName); // Use configService for batchesDir
            const fileUpdatePromise = this.fileSystemService.writeFile(fileUpdatePath, contentSendToAPI, fileUpdateLogger)
                .then(() => fileUpdateLogger.debug({ filePath: fileUpdatePath, event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => fileUpdateLogger.error({ filePath: fileUpdatePath, err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_update_content' }));

            const apiResults = await this.batchApiHandlerService.executeFinalExtractionApis(
                contentSendToAPI, batchItemIndex, batchInput.conferenceTitle,
                originalAcronym,
                safeInternalAcronymForFiles,
                true,
                apiModels.extractInfo,
                apiModels.extractCfp,
                logger // Pass current logger which has full context
            );

            await fileUpdatePromise;
            logger.debug({ event: 'intermediate_update_file_write_settled' });

            const finalRecord: BatchUpdateDataWithIds = {
                conferenceTitle: batchInput.conferenceTitle,
                conferenceAcronym: originalAcronym,
                mainLink: batchInput.mainLink,
                cfpLink: batchInput.cfpLink,
                impLink: batchInput.impLink,
                conferenceTextPath: batchInput.conferenceTextPath,
                cfpTextPath: batchInput.cfpTextPath,
                impTextPath: batchInput.impTextPath,
                originalRequestId: batchInput.originalRequestId,
                internalProcessingAcronym: internalProcessingAcronym,
                batchRequestId: batchRequestIdForTask,
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpMetaData: apiResults.cfpMetaData,
            };

            await this.batchOutputPersistenceService.appendFinalRecord(
                finalRecord,
                batchRequestIdForTask,
                logger.child({ subOperation: 'append_final_update_record' })
            );
            logger.info({ event: 'batch_task_finish_success', flow: 'update' });
            return true;
        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'update' });
            await this.batchOutputPersistenceService.logBatchProcessingError(
                { conferenceAcronym: batchInput.conferenceAcronym, batchItemIndex, batchRequestId: batchRequestIdForTask, flow: 'update' },
                error,
                logger // Pass current logger
            );
            return false;
        }
    }

    public async executeBatchTaskForSave(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        primaryOriginalAcronymForInitialFilesPrefix: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>,
        parentLogger: Logger
    ): Promise<boolean> {
        // Original function name was '_executeBatchTaskForSave'
        const logger = parentLogger.child({
            // batchServiceFunction: '_executeBatchTaskForSave', // Original name
            serviceScopedFunction: 'executeBatchTaskForSave', // New scope
        });
        logger.info({ event: 'batch_task_start_execution', flow: 'save', entryCountInBatch: initialBatchEntries.length });

        if (!initialBatchEntries || initialBatchEntries.length === 0 || !initialBatchEntries[0]?.conferenceAcronym || !initialBatchEntries[0]?.conferenceTitle) {
            logger.warn({ event: 'invalid_batch_input_for_save_task' });
            return false;
        }
        const primaryEntryForContext = initialBatchEntries[0];
        const safePrimaryOriginalAcronymForInitialFiles = primaryOriginalAcronymForInitialFilesPrefix.replace(/[^a-zA-Z0-9_.-]/g, '-');

        let determineResponseTextPath: string | undefined = undefined;
        let determineMetaData: any | null = null;
        let determineLinksResponse: ApiResponse;

        let officialWebsiteFromApi1: string | null = null;
        let cfpLinkFromApi1: string | null = null;
        let impLinkFromApi1: string | null = null;

        try {
            const jsonlPathForThisBatch = this.configService.getFinalOutputJsonlPathForBatch(batchRequestIdForTask);
            await this.batchOutputPersistenceService.ensureDirectories(
                [this.configService.batchesDir, path.dirname(jsonlPathForThisBatch)],
                logger.child({ subOperation: 'ensure_directories_save_task' })
            );

            logger.debug({ event: 'aggregate_content_for_determine_api_start_save_task' });
            let batchContentParts: string[] = [];
            const readPromises = initialBatchEntries.map(async (entry, i) => {
                const entryLogger = logger.child({ entryIndexInBatch: i, entryLink: entry.mainLink });
                if (!entry.conferenceTextPath) {
                    entryLogger.warn({ event: 'read_content_skipped_no_path_for_determine_aggregation_save_task' });
                    return { index: i, content: `${i + 1}. WARNING: Missing text path for ${entry.mainLink}\n\n` };
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
            const batchContentForDetermine = `Conference Info:\nTitle: ${primaryEntryForContext.conferenceTitle}\nAcronym: ${primaryEntryForContext.conferenceAcronym}\n\nCandidate Website Contents:\n${batchContentParts.join("")}`;
            logger.debug({ charCount: batchContentForDetermine.length, event: 'aggregate_content_for_determine_api_end_save_task' });

            const fileFullLinksName = `${safePrimaryOriginalAcronymForInitialFiles}_item${batchItemIndex}_full_links.txt`;
            const fileFullLinksPath = path.join(this.configService.batchesDir, fileFullLinksName);
            const writeFileFullLinksLogger = logger.child({ fileOperation: 'write_intermediate_full_links_save', filePath: fileFullLinksPath });
            const writeFullLinksPromise = this.fileSystemService.writeFile(fileFullLinksPath, batchContentForDetermine, writeFileFullLinksLogger)
                .then(() => writeFileFullLinksLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => writeFileFullLinksLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_full_links_content' }));

            const determineApiLogger = logger.child({ apiType: this.geminiApiService.API_TYPE_DETERMINE, geminiApiCallNumber: 1 });
            const determineApiParams: GeminiApiParams = {
                batch: batchContentForDetermine, batchIndex: batchItemIndex,
                title: primaryEntryForContext.conferenceTitle,
                acronym: primaryEntryForContext.conferenceAcronym,
            };

            try {
                determineLinksResponse = await this.geminiApiService.determineLinks(
                    determineApiParams,
                    apiModels.determineLinks,
                    determineApiLogger
                );
                determineResponseTextPath = await this.fileSystemService.saveTemporaryFile(
                    determineLinksResponse.responseText || "",
                    `${safePrimaryOriginalAcronymForInitialFiles}_item${batchItemIndex}_determine_response`,
                    determineApiLogger.child({ fileOperation: 'save_determine_response_save_task' })
                );
                determineMetaData = determineLinksResponse.metaData;

                if (determineLinksResponse.responseText) {
                    try {
                        const parsedApi1Data = JSON.parse(determineLinksResponse.responseText);
                        const rawOfficialWebsite = parsedApi1Data?.["Official Website"] ?? null;
                        if (rawOfficialWebsite && typeof rawOfficialWebsite === 'string' && rawOfficialWebsite.trim().toLowerCase() !== "none" && rawOfficialWebsite.trim() !== '') {
                            officialWebsiteFromApi1 = normalizeAndJoinLink(rawOfficialWebsite, null, determineApiLogger.child({ linkParseContext: 'api1_official' }));
                        }

                        if (officialWebsiteFromApi1) {
                            const rawCfpLink = String(parsedApi1Data?.["Call for papers link"] ?? '').trim();
                            cfpLinkFromApi1 = normalizeAndJoinLink(officialWebsiteFromApi1, rawCfpLink, determineApiLogger.child({ linkParseContext: 'api1_cfp' }));

                            const rawImpLink = String(parsedApi1Data?.["Important dates link"] ?? '').trim();
                            impLinkFromApi1 = normalizeAndJoinLink(officialWebsiteFromApi1, rawImpLink, determineApiLogger.child({ linkParseContext: 'api1_imp' }));
                        }
                        determineApiLogger.info({ officialWebsiteFromApi1, cfpLinkFromApi1, impLinkFromApi1, event: 'api1_links_parsed_for_fallback_consideration' });

                    } catch (parseError) {
                        determineApiLogger.error({ err: parseError, event: 'api1_response_parse_failed_for_fallback_links' });
                    }
                }
                determineApiLogger.info({ responseLength: determineLinksResponse.responseText?.length, filePath: determineResponseTextPath, event: 'gemini_determine_api_call_end_save_task', success: !!determineResponseTextPath });
            } catch (determineLinksError: any) {
                determineApiLogger.error({ err: determineLinksError, event: 'save_batch_determine_api_call_failed', apiCallNumber: 1 });
                await writeFullLinksPromise; // Ensure this non-critical write is attempted
                throw new Error(`Critical: Determine links API failed for item ${batchItemIndex} (SAVE): ${determineLinksError.message}`);
            }

            const processDetermineLogger = logger.child({ subOperation: 'process_determine_api_response_save_task' });
            let processedMainEntries: BatchEntry[];
            try {
                processedMainEntries = await this.conferenceDeterminationService.determineAndProcessOfficialSite(
                    determineLinksResponse.responseText || "",
                    initialBatchEntries,
                    batchItemIndex,
                    browserContext,
                    apiModels.determineLinks,
                    processDetermineLogger
                );
            } catch (processError: any) {
                processDetermineLogger.error({ err: processError, event: 'save_batch_process_determine_call_failed' });
                throw processError;
            }

            if (!processedMainEntries || processedMainEntries.length === 0 || !processedMainEntries[0] || processedMainEntries[0].mainLink === "None" || !processedMainEntries[0].conferenceTextPath) {
                processDetermineLogger.error({
                    resultCount: processedMainEntries?.length,
                    mainLinkResult: processedMainEntries?.[0]?.mainLink,
                    mainTextPathResult: processedMainEntries?.[0]?.conferenceTextPath,
                    event: 'save_batch_process_determine_failed_invalid'
                });
                await writeFullLinksPromise; // Ensure this non-critical write is attempted
                // Log specific error before returning false
                await this.batchOutputPersistenceService.logBatchProcessingError(
                    { conferenceAcronym: primaryEntryForContext.conferenceAcronym, batchItemIndex, batchRequestId: batchRequestIdForTask, flow: 'save' },
                    new Error('Main link/text path invalid after determine API processing.'),
                    processDetermineLogger
                );
                return false;
            }

            const mainEntryAfterDetermination = processedMainEntries[0];
            const originalAcronymFromDetermination = mainEntryAfterDetermination.conferenceAcronym;

            let finalCfpLink = mainEntryAfterDetermination.cfpLink; // These are already potentially from API1 if matched
            let finalImpLink = mainEntryAfterDetermination.impLink;
            let finalCfpTextPath = mainEntryAfterDetermination.cfpTextPath;
            let finalImpTextPath = mainEntryAfterDetermination.impTextPath;

            // Fallback logic was complex and seems to be handled by conferenceDeterminationService now.
            // The key is that mainEntryAfterDetermination should have the correct links and paths.
            // If a fallback to API1 links was intended if determination service didn't find better ones,
            // that logic would need to be explicit here or within conferenceDeterminationService.
            // The current code seems to imply conferenceDeterminationService handles this.
            // For now, we trust mainEntryAfterDetermination.

            const internalProcessingAcronym = await addAcronymSafely(globalProcessedAcronymsSet, originalAcronymFromDetermination);
            const safeInternalAcronymOfDeterminedConference = internalProcessingAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');

            logger.info({
                originalDeterminedAcronym: originalAcronymFromDetermination,
                internalProcessingAcronymForFiles: internalProcessingAcronym,
                safeInternalAcronymForFiles: safeInternalAcronymOfDeterminedConference,
                event: 'acronym_safely_adjusted_for_save'
            });
            processDetermineLogger.info({
                finalMainLink: mainEntryAfterDetermination.mainLink,
                mainTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpPath: finalCfpTextPath, // Use potentially updated finalCfpTextPath
                impPath: finalImpTextPath, // Use potentially updated finalImpTextPath
                originalAcronymAfterDetermination: originalAcronymFromDetermination,
                internalProcessingAcronymForFiles: internalProcessingAcronym,
                event: 'successfully_processed_determine_response_save_task'
            });

            const contentPathsForFinalApi: ContentPaths = {
                conferenceTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpTextPath: finalCfpTextPath,
                impTextPath: finalImpTextPath,
            };
            const aggregatedContentForFinalApi = await this.conferenceDataAggregatorService.readContentFiles(
                contentPathsForFinalApi, logger.child({ subOperation: 'read_determined_content_files_save_task' })
            );
            const contentSendToFinalApi = this.conferenceDataAggregatorService.aggregateContentForApi(
                mainEntryAfterDetermination.conferenceTitle,
                originalAcronymFromDetermination,
                aggregatedContentForFinalApi,
                logger.child({ subOperation: 'aggregate_for_extract_cfp_apis_save_task' })
            );

            const fileMainLinkName = `${safeInternalAcronymOfDeterminedConference}_item${batchItemIndex}_main_link_content.txt`;
            const fileMainLinkPath = path.join(this.configService.batchesDir, fileMainLinkName);
            const writeFileMainLinkLogger = logger.child({ fileOperation: 'write_intermediate_main_link_content_save', filePath: fileMainLinkPath });
            const fileMainLinkPromise = this.fileSystemService.writeFile(fileMainLinkPath, contentSendToFinalApi, writeFileMainLinkLogger)
                .then(() => writeFileMainLinkLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => writeFileMainLinkLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_main_link_content' }));

            const finalApiResults = await this.batchApiHandlerService.executeFinalExtractionApis(
                contentSendToFinalApi, batchItemIndex, mainEntryAfterDetermination.conferenceTitle,
                originalAcronymFromDetermination,
                safeInternalAcronymOfDeterminedConference,
                false,
                apiModels.extractInfo,
                apiModels.extractCfp,
                logger // Pass current logger
            );

            await Promise.allSettled([writeFullLinksPromise, fileMainLinkPromise]);
            logger.debug({ event: 'intermediate_file_writes_settled_save_task' });

            const finalRecord: BatchEntryWithIds = {
                conferenceTitle: mainEntryAfterDetermination.conferenceTitle,
                conferenceAcronym: originalAcronymFromDetermination,
                mainLink: mainEntryAfterDetermination.mainLink,
                conferenceTextPath: mainEntryAfterDetermination.conferenceTextPath,
                cfpLink: finalCfpLink,
                cfpTextPath: finalCfpTextPath,
                impLink: finalImpLink,
                impTextPath: finalImpTextPath,
                linkOrderIndex: mainEntryAfterDetermination.linkOrderIndex,
                originalRequestId: mainEntryAfterDetermination.originalRequestId,
                internalProcessingAcronym: internalProcessingAcronym,
                batchRequestId: batchRequestIdForTask,
                determineResponseTextPath: determineResponseTextPath,
                determineMetaData: determineMetaData,
                extractResponseTextPath: finalApiResults.extractResponseTextPath,
                extractMetaData: finalApiResults.extractMetaData,
                cfpResponseTextPath: finalApiResults.cfpResponseTextPath,
                cfpMetaData: finalApiResults.cfpMetaData,
            };
            await this.batchOutputPersistenceService.appendFinalRecord(
                finalRecord,
                batchRequestIdForTask,
                logger.child({ subOperation: 'append_final_save_record' })
            );

            logger.info({ event: 'batch_task_finish_success', flow: 'save' });
            return true;

        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'save' });
            await this.batchOutputPersistenceService.logBatchProcessingError(
                { conferenceAcronym: primaryEntryForContext.conferenceAcronym, batchItemIndex, batchRequestId: batchRequestIdForTask, flow: 'save' },
                error,
                logger // Pass current logger
            );
            return false;
        }
    }
}