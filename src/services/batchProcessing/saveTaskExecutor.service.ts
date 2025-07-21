// src/services/batchProcessing/saveTaskExecutor.service.ts
import 'reflect-metadata';
import { injectable, inject } from 'tsyringe'; // <<< THAY ĐỔI IMPORT
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
import { withOperationTimeout } from './utils'; // <-- IMPORT HELPER
import { RequestStateService } from '../requestState.service';
import { InMemoryResultCollectorService } from '../inMemoryResultCollector.service'; // <<< THÊM IMPORT

export interface ISaveTaskExecutorService {
    execute(
        initialBatchEntries: BatchEntry[],
        batchItemIndex: number,
        primaryOriginalAcronymForInitialFilesPrefix: string,
        browserContext: BrowserContext,
        batchRequestIdForTask: string,
        apiModels: ApiModels,
        processedAcronymsSet: Set<string>, // <<< NHẬN THAM SỐ
        logger: Logger,
        requestStateService: RequestStateService,
        resultCollector: InMemoryResultCollectorService // <<< THÊM THAM SỐ MỚI

    ): Promise<boolean>;
}

@injectable() // <<< THAY BẰNG @injectable()
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
        @inject('IFinalRecordAppenderService') private readonly finalRecordAppenderService: IFinalRecordAppenderService,
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
        processedAcronymsSet: Set<string>, // <<< NHẬN THAM SỐ
        logger: Logger,
        requestStateService: RequestStateService,
        resultCollector: InMemoryResultCollectorService // <<< NHẬN THAM SỐ MỚI

    ): Promise<boolean> {
        logger.info({ event: 'batch_task_start_execution', flow: 'save', entryCountInBatch: initialBatchEntries.length });

        if (!initialBatchEntries || initialBatchEntries.length === 0 || !initialBatchEntries[0]?.conferenceAcronym || !initialBatchEntries[0]?.conferenceTitle) {
            logger.warn({ event: 'invalid_batch_input_for_save_task' });
            return false;
        }
        const primaryEntryForContext = initialBatchEntries[0];
        const safePrimaryOriginalAcronymForInitialFiles = primaryOriginalAcronymForInitialFilesPrefix.replace(/[^a-zA-Z0-9_.-]/g, '-');

        // --- FIX 2: Change to undefined ---
        let determineResponseTextPath: string | undefined = undefined; // Initialize with undefined
        let determineMetaData: any | null = null;
        let determineLinksResponse: ApiResponse;

        let officialWebsiteFromApi1: string | null = null;
        let cfpLinkFromApi1: string | null = null;
        let impLinkFromApi1: string | null = null;

        try {
            // +++ MODIFIED PART +++
            // Aggregate content directly from memory (`conferenceTextContent`).
            logger.debug({ event: 'aggregate_content_for_determine_api_start_save_task' });
            const batchContentParts = initialBatchEntries.map((entry, i) => {
                if (entry.conferenceTextContent) {
                    return `Source Link [${i + 1}]: ${entry.mainLink}\nContent [${i + 1}]:\n${entry.conferenceTextContent.trim()}\n\n---\n\n`;
                }
                // This fallback should only happen in dev mode if something went wrong
                logger.warn({ event: 'missing_content_in_memory', link: entry.mainLink }, 'Content not available in memory for aggregation, this is unexpected.');
                return `Source Link [${i + 1}]: ${entry.mainLink}\nContent [${i + 1}]:\nERROR: CONTENT NOT AVAILABLE IN MEMORY\n\n---\n\n`;
            });
            const batchContentForDetermine = `Conference Info:\nTitle: ${primaryEntryForContext.conferenceTitle}\nAcronym: ${primaryEntryForContext.conferenceAcronym}\n\nCandidate Website Contents:\n${batchContentParts.join("")}`;
            logger.debug({ charCount: batchContentForDetermine.length, event: 'aggregate_content_for_determine_api_end_save_task' });

            // +++ CONDITIONAL DEBUG FILE WRITE +++
            if (!this.configService.isProduction) {
                const fileFullLinksName = `${safePrimaryOriginalAcronymForInitialFiles}_item${batchItemIndex}_full_links.txt`;
                const fileFullLinksPath = path.join(this.batchesDir, fileFullLinksName);
                const writeFileFullLinksLogger = logger.child({ fileOperation: 'write_intermediate_full_links_save', filePath: fileFullLinksPath });
                // Fire-and-forget in dev mode, no need to await
                this.fileSystemService.writeFile(fileFullLinksPath, batchContentForDetermine, writeFileFullLinksLogger)
                    .catch(writeError => writeFileFullLinksLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_full_links_content' }));
            }

            const determineApiLogger = logger.child({ apiType: this.geminiApiService.API_TYPE_DETERMINE, geminiApiCallNumber: 1 });
            const determineApiParams: GeminiApiParams = {
                batch: batchContentForDetermine, batchIndex: batchItemIndex,
                title: primaryEntryForContext.conferenceTitle,
                acronym: primaryEntryForContext.conferenceAcronym,
            };

            if (!apiModels.determineLinks || !apiModels.extractInfo || !apiModels.extractCfp) {
                logger.error({
                    event: 'batch_task_aborted_missing_models',
                    flow: 'save',
                    hasDetermineLinksModel: !!apiModels.determineLinks,
                    hasExtractInfoModel: !!apiModels.extractInfo,
                    hasCfpModel: !!apiModels.extractCfp,
                }, 'Cannot execute save task without required API models.');
                return false;
            }

            try {

                const determineApiStartTime = performance.now();
                logger.info({ event: 'API_DETERMINE_LINKS_START', model: apiModels.determineLinks });

                determineLinksResponse = await this.geminiApiService.determineLinks(
                    determineApiParams,
                    apiModels.determineLinks,
                    determineApiLogger
                );

                const determineApiDurationMs = performance.now() - determineApiStartTime;
                logger.info({ event: 'API_DETERMINE_LINKS_END', durationMs: Math.round(determineApiDurationMs) });

                // saveTemporaryFile now returns null in production, which is fine as it's assigned to string | undefined
                determineResponseTextPath = await this.fileSystemService.saveTemporaryFile(
                    determineLinksResponse.responseText || "",
                    `${safePrimaryOriginalAcronymForInitialFiles}_item${batchItemIndex}_determine_response`,
                    determineApiLogger.child({ fileOperation: 'save_determine_response_save_task' })
                ) || undefined; // Ensure it's undefined if null is returned
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

                determineApiLogger.info({ responseLength: determineLinksResponse.responseText?.length, filePath: determineResponseTextPath, event: 'gemini_determine_api_call_end_save_task', success: !!determineResponseTextPath || this.configService.isProduction });
            } catch (determineLinksError: any) {
                determineApiLogger.error({ err: determineLinksError, event: 'save_batch_determine_api_call_failed', apiCallNumber: 1 });
                throw new Error(`Critical: Determine links API failed for item ${batchItemIndex} (SAVE): ${determineLinksError.message}`);
            }

            const processDetermineLogger = logger.child({ subOperation: 'process_determine_api_response_save_task' });
            let processedMainEntries: BatchEntry[];

            try {
                // +++ BỌC LỜI GỌI SERVICE BẰNG TIMEOUT +++
                const DETERMINATION_TIMEOUT_MS = 240000;

                const crawlDeterminedStartTime = performance.now();
                logger.info({ event: 'PLAYWRIGHT_CRAWL_DETERMINED_LINKS_START' });

                const determinationPromise = this.conferenceDeterminationService.determineAndProcessOfficialSite(
                    determineLinksResponse.responseText || "",
                    initialBatchEntries,
                    batchItemIndex,
                    browserContext,
                    apiModels.determineLinks,
                    processDetermineLogger
                );

                processedMainEntries = await withOperationTimeout(
                    determinationPromise,
                    DETERMINATION_TIMEOUT_MS,
                    `Determine and Process Official Site for ${primaryEntryForContext.conferenceAcronym}`
                );
                // +++ KẾT THÚC PHẦN BỌC +++


                const crawlDeterminedDurationMs = performance.now() - crawlDeterminedStartTime;
                logger.info({ event: 'PLAYWRIGHT_CRAWL_DETERMINED_LINKS_END', durationMs: Math.round(crawlDeterminedDurationMs) });

            } catch (processError: any) {
                processDetermineLogger.error({ err: processError, event: 'save_batch_process_determine_call_failed' });
                // Ném lỗi ra ngoài để catch block chính của hàm execute xử lý
                throw processError;
            }

            // Check for content in memory first, then path
            if (!processedMainEntries || processedMainEntries.length === 0 || !processedMainEntries[0] || processedMainEntries[0].mainLink === "None" || (!processedMainEntries[0].conferenceTextContent && !processedMainEntries[0].conferenceTextPath)) {
                processDetermineLogger.error({
                    resultCount: processedMainEntries?.length,
                    mainLinkResult: processedMainEntries?.[0]?.mainLink,
                    mainTextPathResult: processedMainEntries?.[0]?.conferenceTextPath,
                    mainTextContentExists: !!processedMainEntries?.[0]?.conferenceTextContent,
                    event: 'save_batch_process_determine_failed_invalid'
                });
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Error in _executeBatchTaskForSave (Determine API processing) for ${primaryEntryForContext.conferenceAcronym} (BatchItemIndex: ${batchItemIndex}): Main link/text invalid.\n`;
                this.fileSystemService.appendFile(this.errorLogPath, logMessage, logger.child({ operation: 'log_save_task_determine_error' })).catch(e => logger.error({ err: e, event: 'failed_to_write_to_error_log' }));
                return false;
            }

            const mainEntryAfterDetermination = processedMainEntries[0];
            const originalAcronymFromDetermination = mainEntryAfterDetermination.conferenceAcronym;
            const imageUrlsForApi = mainEntryAfterDetermination.imageUrls; // <<< LẤY URL ẢNH


            // These will be null in prod, but that's okay. The content is in the entry object.
            let finalCfpTextPath = mainEntryAfterDetermination.cfpTextPath;
            let finalImpTextPath = mainEntryAfterDetermination.impTextPath;

            const internalProcessingAcronym = await addAcronymSafely(processedAcronymsSet, originalAcronymFromDetermination);
            const safeInternalAcronymOfDeterminedConference = internalProcessingAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');

            // +++ MODIFIED PART +++
            // Pass the full entry with content to the aggregator service
            const contentPathsForFinalApi: ContentPaths = {
                conferenceTextPath: mainEntryAfterDetermination.conferenceTextPath,
                conferenceTextContent: mainEntryAfterDetermination.conferenceTextContent,
                cfpTextPath: finalCfpTextPath,
                cfpTextContent: mainEntryAfterDetermination.cfpTextContent,
                impTextPath: finalImpTextPath,
                impTextContent: mainEntryAfterDetermination.impTextContent,
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

            // +++ CONDITIONAL DEBUG FILE WRITE +++
            if (!this.configService.isProduction) {
                const fileMainLinkName = `${safeInternalAcronymOfDeterminedConference}_item${batchItemIndex}_main_link_content.txt`;
                const fileMainLinkPath = path.join(this.batchesDir, fileMainLinkName);
                const writeFileMainLinkLogger = logger.child({ fileOperation: 'write_intermediate_main_link_content_save', filePath: fileMainLinkPath });
                // Fire-and-forget in dev mode
                this.fileSystemService.writeFile(fileMainLinkPath, contentSendToFinalApi, writeFileMainLinkLogger)
                    .catch(writeError => writeFileMainLinkLogger.error({ err: writeError, event: 'save_batch_write_file_failed', fileType: 'intermediate_main_link_content' }));
            }

            // DELEGATE to FinalExtractionApiService
            const finalApiResults = await this.finalExtractionApiService.execute(
                contentSendToFinalApi, batchItemIndex, mainEntryAfterDetermination.conferenceTitle,
                originalAcronymFromDetermination,
                safeInternalAcronymOfDeterminedConference,
                false,
                apiModels.extractInfo,
                apiModels.extractCfp,
                imageUrlsForApi, // <<< TRUYỀN THAM SỐ MỚI
                logger
            );

            // The final record will now contain the content fields, which is acceptable for the final JSONL.
            // If you want to remove them before writing, you can do so here.
            const finalRecord: BatchEntryWithIds = {
                // Spread mainEntryAfterDetermination first to provide base properties
                ...mainEntryAfterDetermination,
                // Then override/add specific properties
                conferenceTitle: mainEntryAfterDetermination.conferenceTitle,
                conferenceAcronym: originalAcronymFromDetermination, // Ensure this specific acronym is used if it differs from mainEntryAfterDetermination.conferenceAcronym
                internalProcessingAcronym: internalProcessingAcronym,
                batchRequestId: batchRequestIdForTask,
                determineResponseTextPath: determineResponseTextPath,
                determineMetaData: determineMetaData,
                extractResponseTextPath: finalApiResults.extractResponseTextPath,
                extractResponseContent: finalApiResults.extractResponseContent, // ADD THIS
                extractMetaData: finalApiResults.extractMetaData,
                cfpResponseTextPath: finalApiResults.cfpResponseTextPath,
                cfpResponseContent: finalApiResults.cfpResponseContent, // ADD THIS
                cfpMetaData: finalApiResults.cfpMetaData,
            };

            // DELEGATE to FinalRecordAppenderService
            // DELEGATE to FinalRecordAppenderService
            // <<< TRUYỀN THAM SỐ MỚI >>>
            await this.finalRecordAppenderService.append(
                finalRecord,
                batchRequestIdForTask,
                logger.child({ subOperation: 'append_final_save_record' }),
                requestStateService,
                resultCollector

            );

            logger.info({ event: 'batch_task_finish_success', flow: 'save' });
            logger.info({ event: 'task_finish', success: true }, `Finished processing conference task for "${finalRecord.conferenceTitle}" (${finalRecord.conferenceAcronym}).`);


            logger.info({ event: 'TASK_END', success: true }, `Finished processing conference task for "${finalRecord.conferenceTitle}" (${finalRecord.conferenceAcronym}).`);

            return true;

        } catch (error: any) {
            // Catch block này sẽ bắt cả lỗi timeout từ withOperationTimeout
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


            logger.error({ event: 'TASK_END', success: false }, `Finished processing conference task with failure.`);


            return false;
        }
    }
}