// src/services/batchProcessing/saveTaskExecutor.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { Logger } from 'pino';
import { BrowserContext } from 'playwright';

// --- Types ---
import { BatchEntry, BatchEntryWithIds, ApiModels, GeminiApiParams, ApiResponse } from '../../types/crawl';
import { ContentPaths } from '../batchProcessing/conferenceDataAggregator.service';

// --- Service Imports ---
import { ConfigService } from '../../config/config.service';
import { FileSystemService } from '../fileSystem.service';
import { GeminiApiService } from '../geminiApi.service';
import { IConferenceDataAggregatorService } from '../batchProcessing/conferenceDataAggregator.service';
import { IConferenceDeterminationService } from '../batchProcessing/conferenceDetermination.service';
import { IFinalExtractionApiService } from './finalExtractionApi.service';
import { IFinalRecordAppenderService } from './finalRecordAppender.service';
import { addAcronymSafely } from '../../utils/crawl/addAcronymSafely';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';

export interface ISaveTaskExecutorService {
    execute(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        primaryOriginalAcronymForInitialFilesPrefix: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>,
        logger: Logger
    ): Promise<boolean>;
}

@singleton()
export class SaveTaskExecutorService implements ISaveTaskExecutorService {
    private readonly batchesDir: string;
    private readonly errorLogPath: string;

    constructor(
        @inject(ConfigService) private readonly configService: ConfigService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService,
        @inject(GeminiApiService) private readonly geminiApiService: GeminiApiService,
        @inject('IConferenceDataAggregatorService') private readonly conferenceDataAggregatorService: IConferenceDataAggregatorService,
        @inject('IConferenceDeterminationService') private readonly conferenceDeterminationService: IConferenceDeterminationService,
        @inject('IFinalExtractionApiService') private readonly finalExtractionApiService: IFinalExtractionApiService,
        @inject('IFinalRecordAppenderService') private readonly finalRecordAppenderService: IFinalRecordAppenderService
    ) {
        this.batchesDir = this.configService.batchesDir;
        this.errorLogPath = path.join(this.configService.baseOutputDir, 'batch_processing_errors.log');
    }

    public async execute(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        primaryOriginalAcronymForInitialFilesPrefix: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        globalProcessedAcronymsSet: Set<string>,
        logger: Logger
    ): Promise<boolean> {
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
            const fileFullLinksPath = path.join(this.batchesDir, fileFullLinksName);
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


            // +++ SỬA LỖI: THÊM GUARD CLAUSE TẠI ĐÂY (CHO CẢ 3 MODELS) +++
            if (!apiModels.determineLinks || !apiModels.extractInfo || !apiModels.extractCfp) {
                 logger.error({
                    event: 'batch_task_aborted_missing_models',
                    flow: 'save',
                    hasDetermineLinksModel: !!apiModels.determineLinks,
                    hasExtractInfoModel: !!apiModels.extractInfo,
                    hasCfpModel: !!apiModels.extractCfp,
                }, 'Cannot execute save task without required API models.');
                return false; // Dừng tác vụ một cách an toàn
            }
            // +++ KẾT THÚC SỬA LỖI +++

            
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
                await writeFullLinksPromise;
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
                await writeFullLinksPromise;
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave (Determine API processing) for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}): Main link/text path invalid.\n`;
                this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_determine_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
                return false;
            }

            const mainEntryAfterDetermination = processedMainEntries[0];
            const originalAcronymFromDetermination = mainEntryAfterDetermination.conferenceAcronym;

            let finalCfpLink = mainEntryAfterDetermination.cfpLink;
            let finalImpLink = mainEntryAfterDetermination.impLink;
            let finalCfpTextPath = mainEntryAfterDetermination.cfpTextPath;
            let finalImpTextPath = mainEntryAfterDetermination.impTextPath;

            const matchedEntryFromApi1Processing = initialBatchEntries.find(entry => {
                const normalizedEntryLink = normalizeAndJoinLink(entry.mainLink, null, logger);
                return normalizedEntryLink && officialWebsiteFromApi1 && normalizedEntryLink === officialWebsiteFromApi1;
            });

            if (matchedEntryFromApi1Processing) {
                processDetermineLogger.info({
                    event: 'api1_match_detected_for_fallback_context',
                    api1_cfp: cfpLinkFromApi1, api1_imp: impLinkFromApi1,
                    determined_cfp: mainEntryAfterDetermination.cfpLink, determined_imp: mainEntryAfterDetermination.impLink
                });
            }

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
                cfpPath: mainEntryAfterDetermination.cfpTextPath,
                impPath: mainEntryAfterDetermination.impTextPath,
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
            const fileMainLinkPath = path.join(this.batchesDir, fileMainLinkName);
            const writeFileMainLinkLogger = logger.child({ fileOperation: 'write_intermediate_main_link_content_save', filePath: fileMainLinkPath });
            const fileMainLinkPromise = this.fileSystemService.writeFile(fileMainLinkPath, contentSendToFinalApi, writeFileMainLinkLogger)
                .then(() => writeFileMainLinkLogger.debug({ event: 'batch_processing_write_intermediate_success' }))
                .catch(writeError => writeFileMainLinkLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_main_link_content' }));

            // DELEGATE to FinalExtractionApiService
            const finalApiResults = await this.finalExtractionApiService.execute(
                contentSendToFinalApi, batchItemIndex, mainEntryAfterDetermination.conferenceTitle,
                originalAcronymFromDetermination,
                safeInternalAcronymOfDeterminedConference,
                false,
                apiModels.extractInfo,
                apiModels.extractCfp,
                logger
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

            // DELEGATE to FinalRecordAppenderService
            await this.finalRecordAppenderService.append(finalRecord, batchRequestIdForTask, logger.child({ subOperation: 'append_final_save_record' }));

            logger.info({ event: 'batch_task_finish_success', flow: 'save' });
            logger.info({ event: 'task_finish', success: true }, `Finished processing conference task for "${finalRecord.conferenceTitle}" (${finalRecord.conferenceAcronym}).`);

            return true;

        } catch (error: any) {
            logger.error({ err: error, event: 'batch_task_execution_failed', flow: 'save' });
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.error({
                err: error,
                event: 'task_finish',
                success: false,
                error_details: errorMessage
            }, `Finished processing conference task with failure.`);

            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}, BatchRequestID: ${batchRequestIdForTask}): ${error instanceof Error ? error.message : String(error)}\nStack: ${error?.stack}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_main_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
            return false;
        }
    }
}