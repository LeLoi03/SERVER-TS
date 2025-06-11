// src/services/batchProcessing/conferenceDetermination.service.ts
import { Page, BrowserContext } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { GeminiApiService } from '../geminiApi.service';
import { IConferenceLinkProcessorService } from './conferenceLinkProcessor.service';
import { BatchEntry, CrawlModelType } from '../../types/crawl/crawl.types';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility
import { GeminiApiParams } from '../../types/crawl';
/**
 * Interface for the service responsible for determining the official website
 * and processing associated links (CFP, Important Dates) for conferences.
 */
export interface IConferenceDeterminationService {
    /**
     * Determines the official conference website from an API response,
     * processes its content, and potentially extracts CFP/Important Dates links.
     * This is a core part of the "SAVE" flow where initial links are not yet confirmed.
     *
     * @param {string} api1ResponseText - The text response from the first Gemini API call (determine_links_api).
     * @param {BatchEntry[]} originalBatch - The original batch of conference entries being processed.
     * @param {number} batchIndexForApi - The index of the current batch for API calls and logging.
     * @param {BrowserContext} browserContext - The Playwright browser context to create new pages.
     * @param {CrawlModelType} determineModel - The type of model (e.g., 'tuned', 'non-tuned') to use for Gemini API calls.
     * @param {Logger} logger - The logger instance for contextual logging.
     * @returns {Promise<BatchEntry[]>} A Promise that resolves to an array containing the updated `BatchEntry`
     *                                   (usually the first entry of the original batch, or the matched one).
     */
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
@singleton()
export class ConferenceDeterminationService implements IConferenceDeterminationService {
    /**
     * Constructs an instance of ConferenceDeterminationService.
     * @param {FileSystemService} fileSystemService - Injected service for file system operations.
     * @param {GeminiApiService} geminiApiService - Injected service for making Gemini API calls.
     * @param {IConferenceLinkProcessorService} linkProcessorService - Injected service for processing and saving links.
     */
    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
        @inject('IConferenceLinkProcessorService') private linkProcessorService: IConferenceLinkProcessorService,
    ) { }

    /**
     * Fetches the content of an official website URL and saves it.
     * This is an internal helper used by both `handleDetermineMatchInternal` and `handleDetermineNoMatchInternal`.
     *
     * @param {Page} page - The Playwright Page object to use for navigation.
     * @param {string} officialWebsiteUrl - The URL of the official website (expected to be normalized).
     * @param {string | undefined} acronym - The conference acronym for logging/filename.
     * @param {string | undefined} title - The conference title for logging context.
     * @param {number} batchIndex - The batch index for logging/filename.
     * @param {Logger} logger - The parent logger instance.
     * @returns {Promise<{ finalUrl: string; textPath: string } | null>} A Promise that resolves with the final URL and saved text path, or `null` on failure.
     */
    private async fetchAndProcessOfficialSiteInternal(
        page: Page,
        officialWebsiteUrl: string,
        acronym: string | undefined,
        title: string | undefined,
        batchIndex: number,
        logger: Logger
    ): Promise<{ finalUrl: string; textPath: string } | null> {
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

            // === THAY ĐỔI CỐT LÕI ===
            // Ủy thác hoàn toàn việc điều hướng, trích xuất và lưu file cho LinkProcessorService.
            // LinkProcessorService sẽ tự xử lý page.goto.
            const textPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page,
                officialWebsiteUrl,     // URL cần vào
                officialWebsiteUrl,     // Base link là chính nó
                null,                   // Không có link để so sánh
                acronym,
                'main',
                false,                  // Không dùng keyword cho trang chính
                fileBaseName,
                childLogger
            );

            if (!textPath) {
                childLogger.warn({ finalUrl: officialWebsiteUrl, event: 'main_website_content_extraction_or_save_failed' }, `Content extraction or saving failed for main website: ${officialWebsiteUrl}.`);
                return null;
            }

            // Sau khi LinkProcessorService chạy xong, page.url() sẽ là URL cuối cùng.
            const finalUrl = page.url();
            childLogger.info({ finalUrl, textPath, event: 'main_website_processed_successfully' }, `Main website processed successfully. Content saved to: ${textPath}.`);
            return { finalUrl, textPath };

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            childLogger.error({ err: { message: errorMessage, stack: errorStack }, event: 'fetch_main_website_unhandled_error' }, `Unhandled error while fetching and processing main website: "${errorMessage}".`);
            return null;
        }
    }

    /**
     * Handles the scenario where the official website from API 1 matches an entry in the original batch.
     * It updates the matching entry with CFP/IMP links from API 1 and processes their content.
     *
     * @param {Page} page - The Playwright Page object.
     * @param {BatchEntry} matchingEntry - The `BatchEntry` from the original batch that matched the official website.
     * @param {string} officialWebsiteNormalized - The normalized official website URL from API 1.
     * @param {string | undefined} cfpLinkFromApi1 - Normalized CFP link from API 1.
     * @param {string | undefined} impLinkFromApi1 - Normalized Important Dates link from API 1.
     * @param {number} batchIndex - The batch index for logging/filenames.
     * @param {Logger} logger - The parent logger instance.
     * @returns {Promise<BatchEntry>} A Promise that resolves with the updated `BatchEntry`.
     */
    private async handleDetermineMatchInternal(
        page: Page,
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
        childLogger.info({ event: 'start_match_handling' }, `Handling determination match for: ${matchingEntry.mainLink}.`);

        // Update entry with links from API1 (already normalized relative to officialWebsiteNormalized)
        matchingEntry.cfpLink = cfpLinkFromApi1;
        matchingEntry.impLink = impLinkFromApi1;

        const safeAcronym = (matchingEntry.conferenceAcronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
        let cfpSaveError = false;
        let impSaveError = false;

        // Process and save CFP content
        try {
            const cfpFileBase = `${safeAcronym}_cfp_determine_match_${batchIndex}`;
            matchingEntry.cfpTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page,
                cfpLinkFromApi1,
                officialWebsiteNormalized, // Base link for normalization/comparison
                impLinkFromApi1,           // Other link for comparison
                matchingEntry.conferenceAcronym,
                'cfp',
                true, // useMainContentKeywords = true for CFP (to find content like "Call for Papers")
                cfpFileBase,
                childLogger.child({ contentType: 'cfp' })
            );
            // Log warning if CFP link was provided but content could not be saved
            if (cfpLinkFromApi1 && !matchingEntry.cfpTextPath && cfpLinkFromApi1 !== officialWebsiteNormalized) {
                cfpSaveError = true;
                childLogger.warn({ cfpLinkFromApi1, event: 'cfp_content_save_failed_no_path' }, "CFP link provided but content could not be processed or saved. Path is null.");
            } else if (matchingEntry.cfpTextPath) {
                childLogger.debug({ cfpTextPath: matchingEntry.cfpTextPath, event: 'cfp_content_saved_success' }, "CFP content saved successfully.");
            }
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            childLogger.error({ contentType: 'cfp', err: { message: errorMessage, stack: errorStack }, event: 'save_cfp_error' }, `Error processing and saving CFP content: "${errorMessage}".`);
            cfpSaveError = true;
        }

        // Process and save Important Dates content
        try {
            const impFileBase = `${safeAcronym}_imp_determine_match_${batchIndex}`;
            matchingEntry.impTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page,
                impLinkFromApi1,
                officialWebsiteNormalized, // Base link
                cfpLinkFromApi1,           // Other link
                matchingEntry.conferenceAcronym,
                'imp',
                false, // useMainContentKeywords = false for IMP
                impFileBase,
                childLogger.child({ contentType: 'imp' })
            );
            // Log warning if IMP link was provided but content could not be saved
            if (impLinkFromApi1 && !matchingEntry.impTextPath && impLinkFromApi1 !== officialWebsiteNormalized && impLinkFromApi1 !== cfpLinkFromApi1) {
                impSaveError = true;
                childLogger.warn({ impLinkFromApi1, event: 'imp_content_save_failed_no_path' }, "Important Dates link provided but content could not be processed or saved. Path is null.");
            } else if (matchingEntry.impTextPath) {
                childLogger.debug({ impTextPath: matchingEntry.impTextPath, event: 'imp_content_saved_success' }, "Important Dates content saved successfully.");
            }
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            childLogger.error({ contentType: 'imp', err: { message: errorMessage, stack: errorStack }, event: 'save_imp_error' }, `Error processing and saving Important Dates content: "${errorMessage}".`);
            impSaveError = true;
        }

        childLogger.info({ success: !cfpSaveError && !impSaveError, cfpSaveError, impSaveError, event: 'finish_match_handling' }, `Finished handling determination match. CFP save error: ${cfpSaveError}, IMP save error: ${impSaveError}.`);
        return matchingEntry;
    }

    /**
     * Handles the scenario where the official website from API 1 does NOT match any entry in the original batch.
     * It fetches the content of the API-provided official website, then calls a second Gemini API
     * (determine_links_api) to re-extract CFP/IMP links from this new content, and finally processes them.
     *
     * @param {Page} page - The Playwright Page object.
     * @param {string} officialWebsiteNormalizedFromApi1 - The normalized official website URL from API 1.
     * @param {BatchEntry} primaryEntryToUpdate - The primary `BatchEntry` (usually `originalBatch[0]`) to update.
     * @param {number} batchIndex - The batch index for API calls and filenames.
     * @param {CrawlModelType} determineModelForApi2 - The type of model to use for the second `determine_links` API call.
     * @param {Logger} logger - The parent logger instance.
     * @returns {Promise<BatchEntry>} A Promise that resolves with the updated `BatchEntry`.
     */
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
            determineModelUsedForApi2: determineModelForApi2, // Log model used for API 2
            title: primaryEntryToUpdate.conferenceTitle,
            acronym: primaryEntryToUpdate.conferenceAcronym,
            batchIndex,
        });
        childLogger.info({ event: 'start_no_match_handling' }, `Handling determination no-match. Processing official website from API 1 and calling API 2.`);

        // 1. Fetch and process the main website (`officialWebsiteNormalizedFromApi1`)
        const websiteInfo = await this.fetchAndProcessOfficialSiteInternal(
            page,
            officialWebsiteNormalizedFromApi1,
            primaryEntryToUpdate.conferenceAcronym,
            primaryEntryToUpdate.conferenceTitle,
            batchIndex,
            childLogger
        );

        if (!websiteInfo) {
            childLogger.error({ event: 'fetch_main_website_failed_in_no_match' }, "Failed to fetch/process main website in no-match scenario. Marking entry as 'None'.");
            primaryEntryToUpdate.mainLink = "None"; // Mark as failed to find official site
            return primaryEntryToUpdate;
        }
        const { finalUrl: actualFinalUrl, textPath: mainTextPath } = websiteInfo;
        primaryEntryToUpdate.mainLink = actualFinalUrl; // Update with the actual final URL
        primaryEntryToUpdate.conferenceTextPath = mainTextPath; // Save the path to the main content

        // 2. Read fetched content for the second API call
        let fullTextForApi2 = '';
        try {
            fullTextForApi2 = await this.fileSystemService.readFileContent(mainTextPath, childLogger);
            childLogger.info({ filePath: mainTextPath, textLength: fullTextForApi2.length, event: 'read_fetched_main_content_success' }, `Successfully read main website content for API 2: ${mainTextPath}.`);
        } catch (readErr: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(readErr);
            childLogger.error({ filePath: mainTextPath, err: { message: errorMessage, stack: errorStack }, event: 'save_batch_read_content_failed', contentType: 'main_for_api2_determination', isCritical: true }, `Critical: Failed to read main content for API 2 determination: "${errorMessage}".`);
            // Continue execution, but API 2 might fail or give poor results due to missing content
        }

        // 3. Call determine_links_api (2nd call) with the fetched content
        const batchContentForApi2 = `Conference full name: ${primaryEntryToUpdate.conferenceTitle} (${primaryEntryToUpdate.conferenceAcronym})\n\n1. Website of ${primaryEntryToUpdate.conferenceAcronym}: ${actualFinalUrl}\nWebsite information of ${primaryEntryToUpdate.conferenceAcronym}:\n\n${fullTextForApi2.trim()}`;
        let api2ResponseText: string = "";

        const api2LogContext = { apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 2, modelUsed: determineModelForApi2 };
        const api2Params: GeminiApiParams = {
            batch: batchContentForApi2,
            batchIndex: batchIndex,
            title: primaryEntryToUpdate.conferenceTitle,
            acronym: primaryEntryToUpdate.conferenceAcronym,
        };

        try {
            childLogger.info({ ...api2LogContext, inputLength: batchContentForApi2.length, event: 'api2_determine_call_start' }, "Initiating second determine_links API call for no-match scenario.");
            // Pass the model type explicitly for the API call
            const api2Response = await this.geminiApiService.determineLinks(api2Params, determineModelForApi2, childLogger);
            api2ResponseText = api2Response.responseText || "";
            childLogger.info({ ...api2LogContext, responseLength: api2ResponseText.length, event: 'api2_determine_call_success' }, "Second determine_links API call successful.");
        } catch (determineLinksError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(determineLinksError);
            childLogger.error({ ...api2LogContext, err: { message: errorMessage, stack: errorStack }, event: 'save_batch_determine_api_call_failed', apiCallNumber: 2 }, `Failed on second determine_links API call: "${errorMessage}".`);
            primaryEntryToUpdate.mainLink = "None"; // Mark as failed
            return primaryEntryToUpdate;
        }

        // 4. Parse API 2 response
        let websiteLinksDataFromApi2: any;
        try {
            if (!api2ResponseText) {
                childLogger.warn({ ...api2LogContext, event: 'api2_response_empty_after_call' }, "API 2 response text is empty after successful call, cannot parse.");
                throw new Error("API 2 response text is empty.");
            }
            websiteLinksDataFromApi2 = JSON.parse(api2ResponseText);
            if (typeof websiteLinksDataFromApi2 !== 'object' || websiteLinksDataFromApi2 === null) {
                childLogger.warn({ ...api2LogContext, responseTextPreview: api2ResponseText.substring(0, 200), event: 'api2_json_parse_invalid_object' }, "Parsed API 2 response is not a valid object.");
                throw new Error("Parsed API 2 response is not a valid object.");
            }
            childLogger.debug({ ...api2LogContext, event: 'api2_json_parse_success' }, "Successfully parsed API 2 response JSON.");
        } catch (parseError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
            childLogger.error({ ...api2LogContext, err: { message: errorMessage, stack: errorStack }, responseTextPreview: api2ResponseText.substring(0, 200), event: 'save_batch_api_response_parse_failed', apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 2 }, `Failed to parse API 2 response JSON: "${errorMessage}".`);
            primaryEntryToUpdate.mainLink = "None"; // Mark as failed due to parse error
            return primaryEntryToUpdate;
        }

        // 5. Normalize links from API 2 relative to `actualFinalUrl`
        const websiteCfpLinkRaw = String(websiteLinksDataFromApi2?.["Call for papers link"] ?? '').trim();
        const websiteImpDatesLinkRaw = String(websiteLinksDataFromApi2?.["Important dates link"] ?? '').trim();
        const cfpLinkFromApi2 = normalizeAndJoinLink(actualFinalUrl, websiteCfpLinkRaw, childLogger);
        const impLinkFromApi2 = normalizeAndJoinLink(actualFinalUrl, websiteImpDatesLinkRaw, childLogger);
        childLogger.trace({ finalUrlUsedForNormalization: actualFinalUrl, rawCfp: websiteCfpLinkRaw, normCfp: cfpLinkFromApi2, rawImp: websiteImpDatesLinkRaw, normImp: impLinkFromApi2, event: 'api2_links_normalized' }, "Normalized CFP and Important Dates links from API 2 response.");

        primaryEntryToUpdate.cfpLink = cfpLinkFromApi2;
        primaryEntryToUpdate.impLink = impLinkFromApi2;

        // 6. Save cfp and imp content based on API 2 results
        let cfpSaveError = false;
        let impSaveError = false;
        const safeAcronym = (primaryEntryToUpdate.conferenceAcronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

        try {
            const cfpFileBase = `${safeAcronym}_cfp_determine_nomatch_api2_${batchIndex}`;
            primaryEntryToUpdate.cfpTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page, cfpLinkFromApi2, actualFinalUrl, impLinkFromApi2, primaryEntryToUpdate.conferenceAcronym, 'cfp', true, cfpFileBase, childLogger.child({ contentType: 'cfp', source: 'api2' })
            );
            if (cfpLinkFromApi2 && !primaryEntryToUpdate.cfpTextPath && cfpLinkFromApi2 !== actualFinalUrl) {
                cfpSaveError = true;
                childLogger.warn({ cfpLinkFromApi2, event: 'cfp_content_save_failed_api2_no_path' }, "CFP link from API 2 provided but content could not be processed or saved.");
            } else if (primaryEntryToUpdate.cfpTextPath) {
                childLogger.debug({ cfpTextPath: primaryEntryToUpdate.cfpTextPath, event: 'cfp_content_saved_api2_success' }, "CFP content saved successfully from API 2 link.");
            }
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            childLogger.error({ contentType: 'CFP', source: 'api2', err: { message: errorMessage, stack: errorStack }, event: 'save_cfp_content_api2_failed' }, `Error processing and saving CFP content from API 2: "${errorMessage}".`);
            cfpSaveError = true;
        }

        try {
            const impFileBase = `${safeAcronym}_imp_determine_nomatch_api2_${batchIndex}`;
            primaryEntryToUpdate.impTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page, impLinkFromApi2, actualFinalUrl, cfpLinkFromApi2, primaryEntryToUpdate.conferenceAcronym, 'imp', false, impFileBase, childLogger.child({ contentType: 'imp', source: 'api2' })
            );
            if (impLinkFromApi2 && !primaryEntryToUpdate.impTextPath && impLinkFromApi2 !== actualFinalUrl && impLinkFromApi2 !== cfpLinkFromApi2) {
                impSaveError = true;
                childLogger.warn({ impLinkFromApi2, event: 'imp_content_save_failed_api2_no_path' }, "Important Dates link from API 2 provided but content could not be processed or saved.");
            } else if (primaryEntryToUpdate.impTextPath) {
                childLogger.debug({ impTextPath: primaryEntryToUpdate.impTextPath, event: 'imp_content_saved_api2_success' }, "Important Dates content saved successfully from API 2 link.");
            }
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            childLogger.error({ contentType: 'IMP', source: 'api2', err: { message: errorMessage, stack: errorStack }, event: 'save_imp_content_api2_failed' }, `Error processing and saving Important Dates content from API 2: "${errorMessage}".`);
            impSaveError = true;
        }

        childLogger.info({ success: !cfpSaveError && !impSaveError, cfpSaveError, impSaveError, event: 'finish_no_match_handling' }, `Finished handling determination no-match. CFP save error: ${cfpSaveError}, IMP save error: ${impSaveError}.`);
        return primaryEntryToUpdate;
    }

    /**
     * Orchestrates the determination and processing of official conference sites.
     * This public method integrates parsing API responses, fetching web content,
     * and potentially making secondary API calls to refine link extraction.
     *
     * @param {string} api1ResponseText - The JSON response text from the first determine_links API call.
     * @param {BatchEntry[]} originalBatch - The initial batch of entries provided by the `BatchProcessingService`.
     * @param {number} batchIndexForApi - The current batch index.
     * @param {BrowserContext} browserContext - The Playwright browser context to create a new page.
     * @param {CrawlModelType} determineModel - The model type to use for Gemini API calls in this determination process.
     * @param {Logger} parentLogger - The logger passed from the parent `BatchProcessingService`.
     * @returns {Promise<BatchEntry[]>} A Promise resolving to an array containing the updated `BatchEntry`
     *                                   which includes the determined official site and associated content paths.
     */
    public async determineAndProcessOfficialSite(
        api1ResponseText: string,
        originalBatch: BatchEntry[],
        batchIndexForApi: number,
        browserContext: BrowserContext,
        determineModel: CrawlModelType, // Received model type
        parentLogger: Logger
    ): Promise<BatchEntry[]> {
        const logger = parentLogger.child({
            function: 'determineAndProcessOfficialSite',
            determineModelUsed: determineModel, // Log the model type used for this determination flow
            batchIndex: batchIndexForApi
        });
        logger.info({ responseTextLength: api1ResponseText?.length ?? 0, inputBatchSize: originalBatch.length, event: 'start_processing_determine_api_response' }, `Starting determination process for batch ${batchIndexForApi}.`);

        if (!originalBatch?.[0]) {
            logger.error({ batchIndexForApi, event: 'invalid_or_empty_batch_input' }, "Input batch is invalid or empty. Cannot proceed with determination.");
            return []; // Return empty array as per original logic if batch is invalid
        }
        const primaryEntryForContext = { ...originalBatch[0] }; // Clone to avoid direct modification before return decisions

        let page: Page | null = null;
        try {
            page = await browserContext.newPage();
            logger.info({ event: 'playwright_page_created_for_determination' }, "Playwright page created for conference determination.");

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
            } catch (parseError: unknown) { // Catch as unknown
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
                logger.error({ err: { message: errorMessage, stack: errorStack }, responseTextPreview: String(api1ResponseText).substring(0, 200), event: 'save_batch_api_response_parse_failed', apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 1 }, `Failed to parse API 1 response JSON: "${errorMessage}".`);
                primaryEntryForContext.mainLink = "None"; // Mark as failed
                return [primaryEntryForContext];
            }

            const officialWebsiteRaw = linksDataFromApi1?.["Official Website"] ?? null;
            // Validate official website from API 1
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

            // Normalize CFP and Important Dates links from API 1 relative to the official website
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
                processedEntry = await this.handleDetermineMatchInternal(
                    page,
                    matchingEntryFromBatch, // Pass the actual matching entry
                    officialWebsiteNormalizedFromApi1,
                    cfpLinkNormalizedApi1,
                    impLinkNormalizedApi1,
                    batchIndexForApi,
                    logger
                );
            } else {
                logger.info({ officialWebsiteFromApi1: officialWebsiteNormalizedFromApi1, event: 'entry_match_not_found_in_batch_proceed_with_api1_link' }, `Official website "${officialWebsiteNormalizedFromApi1}" not found in original batch. Proceeding to process it directly.`);
                processedEntry = await this.handleDetermineNoMatchInternal(
                    page,
                    officialWebsiteNormalizedFromApi1,
                    primaryEntryForContext, // Use the primary entry for updating
                    batchIndexForApi,
                    determineModel, // Pass the model type for the potential second API call
                    logger
                );
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

        } catch (error: unknown) { // Catch any unhandled errors in this public method
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ err: { message: errorMessage, stack: errorStack }, event: 'conference_determination_service_unhandled_error' }, `Unhandled error in conference determination service: "${errorMessage}".`);
            primaryEntryForContext.mainLink = "None"; // Ensure entry is marked as failed on critical error
            return [primaryEntryForContext]; // Return the primary entry with failure status
        } finally {
            // Ensure the Playwright page is closed
            if (page && !page.isClosed()) {
                await page.close().catch(e => {
                    const { message: closeErrMsg, stack: closeErrStack } = getErrorMessageAndStack(e);
                    logger.error({ err: { message: closeErrMsg, stack: closeErrStack }, event: 'page_close_failed_determination' }, `Error closing Playwright page after determination: "${closeErrMsg}".`);
                });
            }
        }
    }
}