// src/services/batchProcessing/conferenceDetermination.service.ts
import { Page, BrowserContext } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { GeminiApiService } from '../geminiApi.service';
import { IConferenceLinkProcessorService } from './conferenceLinkProcessor.service';
import { BatchEntry, CrawlModelType } from '../../types/crawl/crawl.types';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject, injectable } from 'tsyringe'; // <<< THAY ĐỔI IMPORT
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility
import { GeminiApiParams } from '../../types/crawl';
import { ConfigService } from '../../config/config.service'; // +++ ADD IMPORT
import { withOperationTimeout } from './utils'; // Đảm bảo đã import hàm tiện ích

/**
 * Interface for the service responsible for determining the official website
 * and processing associated links (CFP, Important Dates) for conferences.
 */
export interface IConferenceDeterminationService {
    determineAndProcessOfficialSite(
        api1ResponseText: string,
        originalBatch: BatchEntry[],
        batchIndexForApi: number,
        browserContext: BrowserContext,
        determineModel: CrawlModelType,
        logger: Logger
    ): Promise<BatchEntry[]>;
}

/**
 * Service for determining the official website and processing related links for conferences.
 * It leverages Gemini API calls and Playwright for web scraping and content extraction.
 */
@injectable() // <<< THAY BẰNG DÒNG NÀY
export class ConferenceDeterminationService implements IConferenceDeterminationService {
    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
        @inject('IConferenceLinkProcessorService') private linkProcessorService: IConferenceLinkProcessorService,
        @inject(ConfigService) private readonly configService: ConfigService // +++ INJECT CONFIG

    ) { }

    // +++ MODIFY THIS METHOD'S RETURN TYPE AND LOGIC +++
    private async fetchAndProcessOfficialSiteInternal(
        page: Page,
        officialWebsiteUrl: string,
        acronym: string | undefined,
        title: string | undefined,
        batchIndex: number,
        logger: Logger
    ): Promise<{ finalUrl: string; textPath: string | null; textContent: string | null; imageUrls: string[] } | null> { // <<< CẬP NHẬT
        const childLogger = logger.child({
            service: 'ConferenceDeterminationService',
            function: 'fetchAndProcessOfficialSiteInternal',
            initialOfficialWebsite: officialWebsiteUrl,
            acronym, title, batchIndex
        });
        childLogger.info({ event: 'fetch_main_website_start' }, `Attempting to fetch and process main website: ${officialWebsiteUrl}.`);

        try {
            const safeAcronym = (acronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
            const fileBaseName = `${safeAcronym}_main_determine_${batchIndex}`;

            // +++ NHẬN KẾT QUẢ OBJECT +++
            const { path: textPath, content: textContent, imageUrls } = await this.linkProcessorService.processAndSaveGeneralLink(
                page, officialWebsiteUrl, officialWebsiteUrl, null, acronym, 'main', false, fileBaseName, childLogger
            );

            // We check for content, not just path
            if (!textContent) {
                childLogger.warn({ finalUrl: officialWebsiteUrl, event: 'main_website_content_extraction_or_save_failed' });
                return null;
            }

            const finalUrl = page.url();
            return { finalUrl, textPath, textContent, imageUrls }; // <<< CẬP NHẬT


        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            childLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'fetch_main_website_unhandled_error' }, `Unhandled error while fetching and processing main website: "${errorMessage}".`);
            return null;
        }
    }

    private async handleDetermineMatchInternal(
        browserContext: BrowserContext, // <--- THAY ĐỔI: Nhận vào context thay vì page
        matchingEntry: BatchEntry,
        officialWebsiteNormalized: string,
        cfpLinkFromApi1: string | undefined,
        impLinkFromApi1: string | undefined,
        batchIndex: number,
        logger: Logger
    ): Promise<BatchEntry> {
        const childLogger = logger.child({
            function: 'handleDetermineMatchInternal',
            matchedLink: matchingEntry.mainLink,
            title: matchingEntry.conferenceTitle,
            acronym: matchingEntry.conferenceAcronym,
            batchIndex,
        });
        childLogger.info({ event: 'start_match_handling_isolated_pages' }, `Handling determination match for: ${matchingEntry.mainLink} using isolated pages.`);

        matchingEntry.cfpLink = cfpLinkFromApi1;
        matchingEntry.impLink = impLinkFromApi1;

        const safeAcronym = (matchingEntry.conferenceAcronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

        // +++ THAY ĐỔI QUAN TRỌNG: ÁP DỤNG TIMEOUT CHO TỪNG TÁC VỤ CON +++
        const LINK_PROCESSING_TIMEOUT_MS = 60000;

        // Xử lý CFP Link với timeout riêng
        const cfpPromise = (async () => {
            let cfpPage: Page | null = null;
            try {
                cfpPage = await browserContext.newPage();
                const cfpFileBase = `${safeAcronym}_cfp_determine_match_${batchIndex}`;
                const cfpProcessingPromise = this.linkProcessorService.processAndSaveGeneralLink(
                    cfpPage, cfpLinkFromApi1, officialWebsiteNormalized, null,
                    matchingEntry.conferenceAcronym, 'cfp', true, cfpFileBase,
                    logger.child({ contentType: 'cfp' })
                );
                // Bọc tác vụ xử lý CFP bằng timeout
                return await withOperationTimeout(
                    cfpProcessingPromise,
                    LINK_PROCESSING_TIMEOUT_MS,
                    `Process CFP Link: ${cfpLinkFromApi1}`
                );
            } finally {
                if (cfpPage && !cfpPage.isClosed()) await cfpPage.close();
            }
        })();

        // Xử lý IMP Link với timeout riêng
        const impPromise = (async () => {
            let impPage: Page | null = null;
            try {
                impPage = await browserContext.newPage();
                const impFileBase = `${safeAcronym}_imp_determine_match_${batchIndex}`;
                const impProcessingPromise = this.linkProcessorService.processAndSaveGeneralLink(
                    impPage, impLinkFromApi1, officialWebsiteNormalized, cfpLinkFromApi1,
                    matchingEntry.conferenceAcronym, 'imp', false, impFileBase,
                    logger.child({ contentType: 'imp' })
                );
                // Bọc tác vụ xử lý IMP bằng timeout
                return await withOperationTimeout(
                    impProcessingPromise,
                    LINK_PROCESSING_TIMEOUT_MS,
                    `Process IMP Link: ${impLinkFromApi1}`
                );
            } finally {
                if (impPage && !impPage.isClosed()) await impPage.close();
            }
        })();

        // Promise.allSettled sẽ chờ cả hai hoàn thành (hoặc bị timeout)
        const [cfpResult, impResult] = await Promise.allSettled([cfpPromise, impPromise]);

        if (cfpResult.status === 'fulfilled') {
            matchingEntry.cfpTextPath = cfpResult.value.path;
            matchingEntry.cfpTextContent = cfpResult.value.content;
        } else {
            // Lỗi ở đây sẽ là lỗi timeout chi tiết từ withOperationTimeout
            logger.error({ contentType: 'cfp', err: cfpResult.reason, event: 'save_cfp_error_or_timeout' });
        }

        if (impResult.status === 'fulfilled') {
            matchingEntry.impTextPath = impResult.value.path;
            matchingEntry.impTextContent = impResult.value.content;
        } else {
            logger.error({ contentType: 'imp', err: impResult.reason, event: 'save_imp_error_or_timeout' });
        }

        logger.info({ event: 'finish_match_handling' });
        return matchingEntry;
    }


    private async handleDetermineNoMatchInternal(
        page: Page,
        officialWebsiteNormalizedFromApi1: string,
        primaryEntryToUpdate: BatchEntry,
        batchIndex: number,
        determineModelForApi2: CrawlModelType,
        logger: Logger
    ): Promise<BatchEntry> {
        const childLogger = logger.child({
            function: 'handleDetermineNoMatchInternal',
            initialOfficialWebsite: officialWebsiteNormalizedFromApi1,
            determineModelUsedForApi2: determineModelForApi2,
            title: primaryEntryToUpdate.conferenceTitle,
            acronym: primaryEntryToUpdate.conferenceAcronym,
            batchIndex,
        });
        childLogger.info({ event: 'start_no_match_handling' });

        // +++ BỌC LỜI GỌI NÀY BẰNG TIMEOUT +++
        const WEBSITE_PROCESSING_TIMEOUT_MS = 90000; // 90 giây cho việc xử lý trang web chính
        let websiteInfo: { finalUrl: string; textPath: string | null; textContent: string | null; imageUrls: string[] } | null = null;

        try {
            const processingPromise = this.fetchAndProcessOfficialSiteInternal(
                page, officialWebsiteNormalizedFromApi1, primaryEntryToUpdate.conferenceAcronym,
                primaryEntryToUpdate.conferenceTitle, batchIndex, childLogger
            );

            websiteInfo = await withOperationTimeout(
                processingPromise,
                WEBSITE_PROCESSING_TIMEOUT_MS,
                `Fetch and Process Main Site: ${officialWebsiteNormalizedFromApi1}`
            );
        } catch (fetchError: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(fetchError);
            childLogger.error({ err: { message: errorMessage }, event: 'fetch_main_website_failed_in_no_match_or_timeout' });
            primaryEntryToUpdate.mainLink = "None";
            return primaryEntryToUpdate;
        }
        // +++ KẾT THÚC PHẦN BỌC +++


        if (!websiteInfo || !websiteInfo.textContent) {
            childLogger.error({ event: 'fetch_main_website_failed_in_no_match' });
            primaryEntryToUpdate.mainLink = "None";
            return primaryEntryToUpdate;
        }

        const { finalUrl: actualFinalUrl, textPath: mainTextPath, textContent: mainTextContent, imageUrls: mainImageUrls } = websiteInfo; // <<< LẤY URL ẢNH
        primaryEntryToUpdate.mainLink = actualFinalUrl;
        primaryEntryToUpdate.conferenceTextPath = mainTextPath;
        primaryEntryToUpdate.conferenceTextContent = mainTextContent;
        primaryEntryToUpdate.imageUrls = mainImageUrls; // <<< GÁN VÀO ENTRY

        // 2. Use fetched content for the second API call
        let fullTextForApi2 = mainTextContent;

        // In dev mode, if content is somehow missing, fall back to reading file
        if (!fullTextForApi2 && mainTextPath && !this.configService.isProduction) {
            try {
                fullTextForApi2 = await this.fileSystemService.readFileContent(mainTextPath, childLogger);
            } catch (readErr: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(readErr);
                childLogger.error({ filePath: mainTextPath, err: { message: errorMessage, stack: errorStack }, event: 'save_batch_read_content_failed', contentType: 'main_for_api2_determination', isCritical: true });
                // Continue with empty string, API call will likely be less effective
                fullTextForApi2 = "";
            }
        } // +++ DẤU NGOẶC ĐÓNG CỦA IF ĐƯỢC DI CHUYỂN LÊN ĐÂY +++

        // 3. Call determine_links_api (2nd call) with the fetched content
        const batchContentForApi2 = `Conference full name: ${primaryEntryToUpdate.conferenceTitle} (${primaryEntryToUpdate.conferenceAcronym})\n\n1. Website of ${primaryEntryToUpdate.conferenceAcronym}: ${actualFinalUrl}\nWebsite information of ${primaryEntryToUpdate.conferenceAcronym}:\n\n${(fullTextForApi2 || "").trim()}`;
        let api2ResponseText: string = "";

        const api2LogContext = { apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 2, modelUsed: determineModelForApi2 };
        const api2Params: GeminiApiParams = {
            batch: batchContentForApi2,
            batchIndex: batchIndex,
            title: primaryEntryToUpdate.conferenceTitle,
            acronym: primaryEntryToUpdate.conferenceAcronym,
        };

        try {
            childLogger.info({ ...api2LogContext, inputLength: batchContentForApi2.length, event: 'api2_determine_call_start' });
            const api2Response = await this.geminiApiService.determineLinks(api2Params, determineModelForApi2, childLogger);
            api2ResponseText = api2Response.responseText || "";
            childLogger.info({ ...api2LogContext, responseLength: api2ResponseText.length, event: 'api2_determine_call_success' });
        } catch (determineLinksError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(determineLinksError);
            childLogger.error({ ...api2LogContext, err: { message: errorMessage, stack: errorStack }, event: 'save_batch_determine_api_call_failed', apiCallNumber: 2 });
            primaryEntryToUpdate.mainLink = "None";
            return primaryEntryToUpdate;
        }

        // 4. Parse API 2 response
        let websiteLinksDataFromApi2: any;
        try {
            if (!api2ResponseText) {
                childLogger.warn({ ...api2LogContext, event: 'api2_response_empty_after_call' });
                throw new Error("API 2 response text is empty.");
            }
            websiteLinksDataFromApi2 = JSON.parse(api2ResponseText);
            if (typeof websiteLinksDataFromApi2 !== 'object' || websiteLinksDataFromApi2 === null) {
                childLogger.warn({ ...api2LogContext, responseTextPreview: api2ResponseText.substring(0, 200), event: 'api2_json_parse_invalid_object' });
                throw new Error("Parsed API 2 response is not a valid object.");
            }
            childLogger.debug({ ...api2LogContext, event: 'api2_json_parse_success' });
        } catch (parseError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
            childLogger.error({ ...api2LogContext, err: { message: errorMessage, stack: errorStack }, responseTextPreview: api2ResponseText.substring(0, 200), event: 'save_batch_api_response_parse_failed', apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 2 });
            primaryEntryToUpdate.mainLink = "None";
            return primaryEntryToUpdate;
        }

        // 5. Normalize links from API 2 relative to `actualFinalUrl`
        const websiteCfpLinkRaw = String(websiteLinksDataFromApi2?.["Call for papers link"] ?? '').trim();
        const websiteImpDatesLinkRaw = String(websiteLinksDataFromApi2?.["Important dates link"] ?? '').trim();
        const cfpLinkFromApi2 = normalizeAndJoinLink(actualFinalUrl, websiteCfpLinkRaw, childLogger);
        const impLinkFromApi2 = normalizeAndJoinLink(actualFinalUrl, websiteImpDatesLinkRaw, childLogger);
        childLogger.trace({ finalUrlUsedForNormalization: actualFinalUrl, rawCfp: websiteCfpLinkRaw, normCfp: cfpLinkFromApi2, rawImp: websiteImpDatesLinkRaw, normImp: impLinkFromApi2, event: 'api2_links_normalized' });

        primaryEntryToUpdate.cfpLink = cfpLinkFromApi2;
        primaryEntryToUpdate.impLink = impLinkFromApi2;

        // 6. Save cfp and imp content based on API 2 results
        const safeAcronym = (primaryEntryToUpdate.conferenceAcronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

        const cfpPromise = (async () => {
            const cfpFileBase = `${safeAcronym}_cfp_determine_nomatch_api2_${batchIndex}`;
            return await this.linkProcessorService.processAndSaveGeneralLink(
                page, cfpLinkFromApi2, actualFinalUrl, impLinkFromApi2,
                primaryEntryToUpdate.conferenceAcronym, 'cfp', true, cfpFileBase,
                childLogger.child({ contentType: 'cfp', source: 'api2' })
            );
        })();

        const impPromise = (async () => {
            const impFileBase = `${safeAcronym}_imp_determine_nomatch_api2_${batchIndex}`;
            return await this.linkProcessorService.processAndSaveGeneralLink(
                page, impLinkFromApi2, actualFinalUrl, cfpLinkFromApi2,
                primaryEntryToUpdate.conferenceAcronym, 'imp', false, impFileBase,
                childLogger.child({ contentType: 'imp', source: 'api2' })
            );
        })();

        const [cfpResult, impResult] = await Promise.allSettled([cfpPromise, impPromise]);

        if (cfpResult.status === 'fulfilled') {
            primaryEntryToUpdate.cfpTextPath = cfpResult.value.path;
            primaryEntryToUpdate.cfpTextContent = cfpResult.value.content;
        } else {
            logger.error({ contentType: 'CFP', source: 'api2', err: cfpResult.reason, event: 'save_cfp_content_api2_failed' });
        }

        if (impResult.status === 'fulfilled') {
            primaryEntryToUpdate.impTextPath = impResult.value.path;
            primaryEntryToUpdate.impTextContent = impResult.value.content;
        } else {
            logger.error({ contentType: 'IMP', source: 'api2', err: impResult.reason, event: 'save_imp_content_api2_failed' });
        }

        childLogger.info({ event: 'finish_no_match_handling' });

        // +++ CÂU LỆNH RETURN CUỐI CÙNG ĐẢM BẢO MỌI NHÁNH ĐỀU TRẢ VỀ GIÁ TRỊ +++
        return primaryEntryToUpdate;
    }


    public async determineAndProcessOfficialSite(
        api1ResponseText: string,
        originalBatch: BatchEntry[],
        batchIndexForApi: number,
        browserContext: BrowserContext,
        determineModel: CrawlModelType,
        parentLogger: Logger
    ): Promise<BatchEntry[]> {
        const logger = parentLogger.child({
            function: 'determineAndProcessOfficialSite',
            determineModelUsed: determineModel,
            batchIndex: batchIndexForApi
        });
        logger.info({ responseTextLength: api1ResponseText?.length ?? 0, inputBatchSize: originalBatch.length, event: 'start_processing_determine_api_response' }, `Starting determination process for batch ${batchIndexForApi}.`);

        if (!originalBatch?.[0]) {
            logger.error({ batchIndexForApi, event: 'invalid_or_empty_batch_input' }, "Input batch is invalid or empty. Cannot proceed with determination.");
            return [];
        }
        const primaryEntryForContext = { ...originalBatch[0] };

        try {
            // 1. Parse API 1 response
            let linksDataFromApi1: any;
            try {
                if (!api1ResponseText) {
                    logger.warn({ event: 'api1_response_empty' }, "API 1 response text is empty. Cannot determine official website.");
                    throw new Error("API 1 response text is empty.");
                }
                linksDataFromApi1 = JSON.parse(api1ResponseText);
                if (typeof linksDataFromApi1 !== 'object' || linksDataFromApi1 === null) {
                    logger.warn({ responseTextPreview: String(api1ResponseText).substring(0, 200), event: 'api1_json_parse_invalid_object' }, "Parsed API 1 response is not a valid object.");
                    throw new Error("Parsed API 1 response is not a valid object.");
                }
                logger.debug({ event: 'api1_json_parse_success' }, "Successfully parsed API 1 response JSON.");
            } catch (parseError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
                logger.error({ err: { message: errorMessage, stack: errorStack }, responseTextPreview: String(api1ResponseText).substring(0, 200), event: 'save_batch_api_response_parse_failed', apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 1 }, `Failed to parse API 1 response JSON: "${errorMessage}".`);
                primaryEntryForContext.mainLink = "None";
                return [primaryEntryForContext];
            }

            const officialWebsiteRaw = linksDataFromApi1?.["Official Website"] ?? null;
            if (!officialWebsiteRaw || typeof officialWebsiteRaw !== 'string' || officialWebsiteRaw.trim().toLowerCase() === "none" || officialWebsiteRaw.trim() === '') {
                logger.warn({ officialWebsiteRawFromApi: officialWebsiteRaw, event: 'no_official_website_in_api1_response' }, "API 1 response did not contain a valid 'Official Website' link. Marking entry as 'None'.");
                primaryEntryForContext.mainLink = "None";
                return [primaryEntryForContext];
            }
            const officialWebsiteNormalizedFromApi1 = normalizeAndJoinLink(officialWebsiteRaw, null, logger);
            if (!officialWebsiteNormalizedFromApi1) {
                logger.error({ rawUrlFromApi: officialWebsiteRaw, event: 'official_website_url_invalid_after_normalization' }, `Official website URL from API 1 "${officialWebsiteRaw}" is invalid after normalization. Marking entry as 'None'.`);
                primaryEntryForContext.mainLink = "None";
                return [primaryEntryForContext];
            }
            logger.info({ officialWebsiteNormalizedFromApi1, event: 'official_website_from_api1_normalized' }, `Official website normalized from API 1: ${officialWebsiteNormalizedFromApi1}.`);

            const cfpLinkRawApi1 = String(linksDataFromApi1?.["Call for papers link"] ?? '').trim();
            const impLinkRawApi1 = String(linksDataFromApi1?.["Important dates link"] ?? '').trim();
            const cfpLinkNormalizedApi1 = normalizeAndJoinLink(officialWebsiteNormalizedFromApi1, cfpLinkRawApi1, logger);
            const impLinkNormalizedApi1 = normalizeAndJoinLink(officialWebsiteNormalizedFromApi1, impLinkRawApi1, logger);
            logger.trace({ normCfpApi1: cfpLinkNormalizedApi1, normImpApi1: impLinkNormalizedApi1, event: 'api1_cfp_imp_links_normalized' }, "CFP and Important Dates links normalized from API 1 response.");

            // 2. Check if the official website from API 1 matches any entry in the original batch
            let matchingEntryFromBatch: BatchEntry | undefined = originalBatch.find(entry => {
                const normalizedEntryLink = normalizeAndJoinLink(entry.mainLink, null, logger);
                return normalizedEntryLink && normalizedEntryLink === officialWebsiteNormalizedFromApi1;
            });

            let processedEntry: BatchEntry | null = null;
            if (matchingEntryFromBatch) {
                logger.info({ matchedLinkInBatch: matchingEntryFromBatch.mainLink, event: 'entry_match_found_in_batch' }, `Official website "${officialWebsiteNormalizedFromApi1}" matched an entry in the original batch.`);
                // <--- THAY ĐỔI: Gọi hàm đã sửa đổi ---
                processedEntry = await this.handleDetermineMatchInternal(
                    browserContext, // Truyền context
                    matchingEntryFromBatch,
                    officialWebsiteNormalizedFromApi1,
                    cfpLinkNormalizedApi1,
                    impLinkNormalizedApi1,
                    batchIndexForApi,
                    logger
                );
            } else {
                logger.info({ officialWebsiteFromApi1: officialWebsiteNormalizedFromApi1, event: 'entry_match_not_found_in_batch_proceed_with_api1_link' }, `Official website "${officialWebsiteNormalizedFromApi1}" not found in original batch. Proceeding to process it directly.`);
                let page: Page | null = null;
                try {
                    page = await browserContext.newPage();
                    processedEntry = await this.handleDetermineNoMatchInternal(
                        page,
                        officialWebsiteNormalizedFromApi1,
                        primaryEntryForContext,
                        batchIndexForApi,
                        determineModel,
                        logger
                    );
                } finally {
                    if (page && !page.isClosed()) await page.close();
                }
            }

            // 3. Finalize and return the processed entry
            if (processedEntry) {
                const finalStatus = processedEntry.mainLink === "None" ? 'failed' : 'success';
                logger.info({ finalStatus, finalProcessedConferenceLink: processedEntry.mainLink, event: 'finish_processing_determine_api_response' }, `Finished processing determine API response. Final status: ${finalStatus}.`);
                return [processedEntry];
            } else {
                logger.error({ event: 'processed_entry_is_null_unexpected' }, "Processed entry is null after determination logic. This is unexpected.");
                primaryEntryForContext.mainLink = "None";
                return [primaryEntryForContext];
            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'conference_determination_service_unhandled_error' }, `Unhandled error in conference determination service: "${errorMessage}".`);
            primaryEntryForContext.mainLink = "None";
            return [primaryEntryForContext];
        }
        // Không cần khối finally ở đây nữa vì page được quản lý trong các phạm vi hẹp hơn
    }
}