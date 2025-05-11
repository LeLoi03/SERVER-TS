// src/services/conferenceDetermination.service.ts
import { Page, BrowserContext } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { GeminiApiService, GeminiApiParams, ApiResponse } from '../geminiApi.service';
import { IConferenceLinkProcessorService } from './conferenceLinkProcessor.service';
import { BatchEntry } from '../../types/crawl.types';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject } from 'tsyringe';

export interface IConferenceDeterminationService {
    determineAndProcessOfficialSite(
        api1ResponseText: string,
        originalBatch: BatchEntry[], // Batch from initial link processing (SAVE flow)
        batchIndexForApi: number,    // Batch index used for the API call
        browserContext: BrowserContext,
        logger: Logger
    ): Promise<BatchEntry[]>; // Returns array with the processed main entry, or original with error
}

@singleton()
export class ConferenceDeterminationService implements IConferenceDeterminationService {
    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject(GeminiApiService) private geminiApiService: GeminiApiService,
        @inject('IConferenceLinkProcessorService') private linkProcessorService: IConferenceLinkProcessorService,
    ) {}

    // --- Helper: was _fetchAndProcessWebsiteInfo ---
    private async fetchAndProcessOfficialSiteInternal(
        page: Page,
        officialWebsiteUrl: string, // Expect normalized URL
        acronym: string | undefined,
        title: string | undefined, // For logging context
        batchIndex: number, // For filename
        logger: Logger
    ): Promise<{ finalUrl: string; textPath: string } | null> {
        const childLogger = logger.child({
            service: 'ConferenceDeterminationService',
            function: 'fetchAndProcessOfficialSiteInternal',
            initialOfficialWebsite: officialWebsiteUrl,
        });
        childLogger.info({ event: 'fetch_main_website_start' });
        try {
            // This method no longer directly calls _extractTextFromUrl or _saveContentToTempFile.
            // It uses ConferenceLinkProcessorService.processAndSaveGeneralLink.
            // It first navigates to ensure the page object is at the correct URL.
            if (page.isClosed()) {
                childLogger.error({ event: 'page_closed_before_navigating_main_website' });
                throw new Error(`Page closed before navigating to main official website: ${officialWebsiteUrl}`);
            }
            const response = await page.goto(officialWebsiteUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
            if (!response) {
                childLogger.error({ event: 'navigation_to_main_website_failed_null_response' });
                throw new Error(`Navigation to ${officialWebsiteUrl} returned a null response.`);
            }
            if (!response.ok()) {
                childLogger.error({ status: response.status(), event: 'navigation_to_main_website_failed_non_ok' });
                throw new Error(`Non-OK response: ${response.status()} for ${officialWebsiteUrl}`);
            }

            const finalUrlAfterGoto = page.url();
            const normalizedFinalUrl = normalizeAndJoinLink(finalUrlAfterGoto, null, childLogger);
            if (!normalizedFinalUrl) {
                childLogger.error({ finalUrlAttempted: finalUrlAfterGoto, event: 'could_not_normalize_final_url_main_website' });
                throw new Error(`Could not normalize final URL: ${finalUrlAfterGoto}`);
            }
            childLogger.info({ finalUrl: normalizedFinalUrl, status: response.status(), event: 'navigated_to_main_website_successfully' });

            const safeAcronym = (acronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
            const fileBaseName = `${safeAcronym}_main_determine_${batchIndex}`;

            // Use ConferenceLinkProcessorService to extract and save
            // For main site determination, useMainContentKeywords is typically false
            const textPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page,                   // Page is already at normalizedFinalUrl
                normalizedFinalUrl,     // Pass the URL for processing
                normalizedFinalUrl,     // Base link is itself
                null,                   // No other link for comparison
                acronym,
                'main',
                false,                  // useMainContentKeywords = false for main site
                fileBaseName,
                childLogger
            );

            if (!textPath) {
                childLogger.warn({ finalUrl: normalizedFinalUrl, event: 'main_website_content_extraction_or_save_failed' });
                return null;
            }
            childLogger.info({ finalUrl: normalizedFinalUrl, textPath, event: 'main_website_processed_successfully' });
            return { finalUrl: normalizedFinalUrl, textPath };

        } catch (error: any) {
            childLogger.error({ err: error, event: 'fetch_main_website_unhandled_error' });
            return null;
        }
    }
    
    // --- Helper: was _handleDetermineMatch ---
    private async handleDetermineMatchInternal(
        page: Page,
        matchingEntry: BatchEntry, // The entry from originalBatch that matched officialWebsiteNormalized
        officialWebsiteNormalized: string, // This is the baseLink for CFP/IMP
        cfpLinkFromApi1: string | undefined, // Normalized
        impLinkFromApi1: string | undefined, // Normalized
        batchIndex: number, // For filenames
        logger: Logger
    ): Promise<BatchEntry> {
        const childLogger = logger.child({
            service: 'ConferenceDeterminationService',
            function: 'handleDetermineMatchInternal',
            matchedLink: matchingEntry.conferenceLink,
        });
        childLogger.info({ event: 'start' });
    
        // Update entry with links from API1 (already normalized relative to officialWebsiteNormalized)
        matchingEntry.cfpLink = cfpLinkFromApi1;
        matchingEntry.impLink = impLinkFromApi1;
    
        const safeAcronym = (matchingEntry.conferenceAcronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');
        let cfpSaveError = false;
        let impSaveError = false;
    
        try {
            const cfpFileBase = `${safeAcronym}_cfp_determine_match_${batchIndex}`;
            matchingEntry.cfpTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page,
                cfpLinkFromApi1,
                officialWebsiteNormalized, // Base link for normalization/comparison
                impLinkFromApi1,           // Other link
                matchingEntry.conferenceAcronym,
                'cfp',
                true, // useMainContentKeywords = true for CFP
                cfpFileBase,
                childLogger.child({contentType: 'cfp'})
            );
            if (cfpLinkFromApi1 && !matchingEntry.cfpTextPath && cfpLinkFromApi1 !== officialWebsiteNormalized) {
                cfpSaveError = true;
            }
        } catch (error) {
            childLogger.error({ contentType: 'cfp', err: error, event: 'save_cfp_error' });
            cfpSaveError = true;
        }
    
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
                childLogger.child({contentType: 'imp'})
            );
            if (impLinkFromApi1 && !matchingEntry.impTextPath && impLinkFromApi1 !== officialWebsiteNormalized && impLinkFromApi1 !== cfpLinkFromApi1) {
                 impSaveError = true;
            }
        } catch (error) {
            childLogger.error({ contentType: 'imp', err: error, event: 'save_imp_error' });
            impSaveError = true;
        }
    
        childLogger.info({ success: !cfpSaveError && !impSaveError, cfpSaveError, impSaveError, event: 'finish' });
        return matchingEntry;
    }

    // --- Helper: was _handleDetermineNoMatch ---
    private async handleDetermineNoMatchInternal(
        page: Page,
        officialWebsiteNormalizedFromApi1: string, // URL from API 1
        primaryEntryToUpdate: BatchEntry,         // The entry to update (usually batch[0])
        batchIndex: number,                       // For API calls and filenames
        logger: Logger
    ): Promise<BatchEntry> {
        const childLogger = logger.child({
            service: 'ConferenceDeterminationService',
            function: 'handleDetermineNoMatchInternal',
            initialOfficialWebsite: officialWebsiteNormalizedFromApi1,
        });
        childLogger.info({ event: 'start_no_match_handling' });

        // 1. Fetch and process the main website (officialWebsiteNormalizedFromApi1)
        const websiteInfo = await this.fetchAndProcessOfficialSiteInternal(
            page, 
            officialWebsiteNormalizedFromApi1, 
            primaryEntryToUpdate.conferenceAcronym,
            primaryEntryToUpdate.conferenceTitle,
            batchIndex,
            childLogger
        );

        if (!websiteInfo) {
            childLogger.error({ event: 'fetch_main_website_failed_in_no_match' });
            primaryEntryToUpdate.conferenceLink = "None";
            return primaryEntryToUpdate;
        }
        const { finalUrl: actualFinalUrl, textPath: mainTextPath } = websiteInfo;
        primaryEntryToUpdate.conferenceLink = actualFinalUrl;
        primaryEntryToUpdate.conferenceTextPath = mainTextPath;

        // 2. Read fetched content for API call 2
        let fullTextForApi2 = '';
        try {
            fullTextForApi2 = await this.fileSystemService.readFileContent(mainTextPath, childLogger);
            childLogger.info({ filePath: mainTextPath, textLength: fullTextForApi2.length, event: 'read_fetched_main_content_success' });
        } catch (readErr: any) {
            childLogger.error({ filePath: mainTextPath, err: readErr, event: 'read_fetched_main_content_failed' });
            // Continue, API 2 might fail or give poor results
        }

        // 3. Call determine_links_api (2nd call)
        const batchContentForApi2 = `Conference full name: ${primaryEntryToUpdate.conferenceTitle} (${primaryEntryToUpdate.conferenceAcronym})\n\n1. Website of ${primaryEntryToUpdate.conferenceAcronym}: ${actualFinalUrl}\nWebsite information of ${primaryEntryToUpdate.conferenceAcronym}:\n\n${fullTextForApi2.trim()}`;
        let api2ResponseText: string = "";

        const api2LogContext = { apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 2 };
        const api2Params: GeminiApiParams = {
            batch: batchContentForApi2,
            batchIndex: batchIndex,
            title: primaryEntryToUpdate.conferenceTitle,
            acronym: primaryEntryToUpdate.conferenceAcronym,
        };

        try {
            childLogger.info({ ...api2LogContext, inputLength: batchContentForApi2.length, event: 'api2_determine_call_start' });
            const api2Response = await this.geminiApiService.determineLinks(api2Params, childLogger);
            api2ResponseText = api2Response.responseText || "";
            // primaryEntryToUpdate.determineMetaDataApi2 = api2Response.metaData; // Store if needed
            childLogger.info({ ...api2LogContext, responseLength: api2ResponseText.length, event: 'api2_determine_call_success' });
        } catch (determineLinksError: any) {
            childLogger.error({ ...api2LogContext, err: determineLinksError, event: 'api2_determine_call_failed' });
            primaryEntryToUpdate.conferenceLink = "None";
            return primaryEntryToUpdate;
        }

        // 4. Parse API 2 response
        let websiteLinksDataFromApi2: any;
        try {
            if (!api2ResponseText) throw new Error("API 2 response text is empty.");
            websiteLinksDataFromApi2 = JSON.parse(api2ResponseText);
            if (typeof websiteLinksDataFromApi2 !== 'object' || websiteLinksDataFromApi2 === null) {
                throw new Error("Parsed API 2 response is not a valid object.");
            }
            childLogger.debug({ ...api2LogContext, event: 'api2_json_parse_success' });
        } catch (parseError: any) {
            childLogger.error({ ...api2LogContext, err: parseError, responseTextPreview: api2ResponseText.substring(0, 200), event: 'api2_json_parse_failed' });
            primaryEntryToUpdate.conferenceLink = "None";
            return primaryEntryToUpdate;
        }

        // 5. Normalize links from API 2 relative to actualFinalUrl
        const websiteCfpLinkRaw = String(websiteLinksDataFromApi2?.["Call for papers link"] ?? '').trim();
        const websiteImpDatesLinkRaw = String(websiteLinksDataFromApi2?.["Important dates link"] ?? '').trim();
        const cfpLinkFromApi2 = normalizeAndJoinLink(actualFinalUrl, websiteCfpLinkRaw, childLogger);
        const impLinkFromApi2 = normalizeAndJoinLink(actualFinalUrl, websiteImpDatesLinkRaw, childLogger);
        childLogger.trace({ finalUrlUsedForNormalization: actualFinalUrl, rawCfp: websiteCfpLinkRaw, normCfp: cfpLinkFromApi2, rawImp: websiteImpDatesLinkRaw, normImp: impLinkFromApi2, event: 'api2_links_normalized' });

        primaryEntryToUpdate.cfpLink = cfpLinkFromApi2;
        primaryEntryToUpdate.impLink = impLinkFromApi2;

        // 6. Save cfp and imp content based on API 2 results
        let cfpSaveError = false;
        let impSaveError = false;
        const safeAcronym = (primaryEntryToUpdate.conferenceAcronym || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '-');

        try {
            const cfpFileBase = `${safeAcronym}_cfp_determine_nomatch_api2_${batchIndex}`;
            primaryEntryToUpdate.cfpTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page, cfpLinkFromApi2, actualFinalUrl, impLinkFromApi2, primaryEntryToUpdate.conferenceAcronym, 'cfp', true, cfpFileBase, childLogger.child({contentType: 'cfp', source: 'api2'})
            );
            if (cfpLinkFromApi2 && !primaryEntryToUpdate.cfpTextPath && cfpLinkFromApi2 !== actualFinalUrl) {
                cfpSaveError = true;
            }
        } catch (error: any) {
            childLogger.error({ contentType: 'CFP', source: 'api2', err: error, event: 'save_cfp_content_api2_failed' });
            cfpSaveError = true;
        }

        try {
            const impFileBase = `${safeAcronym}_imp_determine_nomatch_api2_${batchIndex}`;
            primaryEntryToUpdate.impTextPath = await this.linkProcessorService.processAndSaveGeneralLink(
                page, impLinkFromApi2, actualFinalUrl, cfpLinkFromApi2, primaryEntryToUpdate.conferenceAcronym, 'imp', false, impFileBase, childLogger.child({contentType: 'imp', source: 'api2'})
            );
            if (impLinkFromApi2 && !primaryEntryToUpdate.impTextPath && impLinkFromApi2 !== actualFinalUrl && impLinkFromApi2 !== cfpLinkFromApi2) {
                impSaveError = true;
            }
        } catch (error: any) {
            childLogger.error({ contentType: 'IMP', source: 'api2', err: error, event: 'save_imp_content_api2_failed' });
            impSaveError = true;
        }

        childLogger.info({ success: !cfpSaveError && !impSaveError, cfpSaveError, impSaveError, event: 'finish_no_match_handling' });
        return primaryEntryToUpdate;
    }

    public async determineAndProcessOfficialSite(
        api1ResponseText: string,
        originalBatch: BatchEntry[],
        batchIndexForApi: number,
        browserContext: BrowserContext,
        parentLogger: Logger
    ): Promise<BatchEntry[]> {
        const logger = parentLogger.child({
            service: 'ConferenceDeterminationService',
            function: 'determineAndProcessOfficialSite',
        });
        logger.info({ responseTextLength: api1ResponseText?.length ?? 0, inputBatchSize: originalBatch.length, event: 'start_processing_determine_api_response' });

        if (!originalBatch?.[0]) {
            logger.error({ batchIndexForApi, event: 'invalid_or_empty_batch_input' });
            return []; 
        }
        const primaryEntryForContext = originalBatch[0]; // Used if no match or for context

        let page: Page | null = null;
        try {
            page = await browserContext.newPage();
            logger.info({ event: 'playwright_page_created_for_determination' });

            let linksDataFromApi1: any;
            try {
                if (!api1ResponseText) throw new Error("API 1 response text is empty.");
                linksDataFromApi1 = JSON.parse(api1ResponseText);
                if (typeof linksDataFromApi1 !== 'object' || linksDataFromApi1 === null) {
                     throw new Error("Parsed API 1 response is not a valid object.");
                }
                logger.debug({ event: 'api1_json_parse_success' });
            } catch (parseError: any) {
                logger.error({ err: parseError, responseTextPreview: String(api1ResponseText).substring(0, 200), event: 'api1_json_parse_failed' });
                primaryEntryForContext.conferenceLink = "None";
                return [primaryEntryForContext];
            }

            const officialWebsiteRaw = linksDataFromApi1?.["Official Website"] ?? null;
            if (!officialWebsiteRaw || typeof officialWebsiteRaw !== 'string' || officialWebsiteRaw.trim().toLowerCase() === "none" || officialWebsiteRaw.trim() === '') {
                logger.warn({ officialWebsiteRawFromApi: officialWebsiteRaw, event: 'no_official_website_in_api1_response' });
                primaryEntryForContext.conferenceLink = "None";
                return [primaryEntryForContext];
            }
            const officialWebsiteNormalizedFromApi1 = normalizeAndJoinLink(officialWebsiteRaw, null, logger);
            if (!officialWebsiteNormalizedFromApi1) {
                logger.error({ rawUrlFromApi: officialWebsiteRaw, event: 'official_website_url_invalid_after_normalization' });
                primaryEntryForContext.conferenceLink = "None";
                return [primaryEntryForContext];
            }
            logger.info({ officialWebsiteNormalizedFromApi1, event: 'official_website_from_api1_normalized' });

            const cfpLinkRawApi1 = String(linksDataFromApi1?.["Call for papers link"] ?? '').trim();
            const impLinkRawApi1 = String(linksDataFromApi1?.["Important dates link"] ?? '').trim();
            const cfpLinkNormalizedApi1 = normalizeAndJoinLink(officialWebsiteNormalizedFromApi1, cfpLinkRawApi1, logger);
            const impLinkNormalizedApi1 = normalizeAndJoinLink(officialWebsiteNormalizedFromApi1, impLinkRawApi1, logger);
            logger.trace({ normCfpApi1: cfpLinkNormalizedApi1, normImpApi1: impLinkNormalizedApi1, event: 'api1_cfp_imp_links_normalized' });

            let matchingEntryFromBatch: BatchEntry | undefined = originalBatch.find(entry => {
                const normalizedEntryLink = normalizeAndJoinLink(entry.conferenceLink, null, logger);
                return normalizedEntryLink && normalizedEntryLink === officialWebsiteNormalizedFromApi1;
            });

            let processedEntry: BatchEntry | null = null;
            if (matchingEntryFromBatch) {
                logger.info({ matchedLinkInBatch: matchingEntryFromBatch.conferenceLink, event: 'entry_match_found_in_batch' });
                // If matched, its conferenceTextPath should already exist from initial processing.
                // We just need to process its CFP/IMP links based on API 1.
                processedEntry = await this.handleDetermineMatchInternal(
                    page,
                    matchingEntryFromBatch,
                    officialWebsiteNormalizedFromApi1, // Base for CFP/IMP links
                    cfpLinkNormalizedApi1,
                    impLinkNormalizedApi1,
                    batchIndexForApi,
                    logger
                );
            } else {
                logger.info({ officialWebsiteFromApi1: officialWebsiteNormalizedFromApi1, event: 'entry_match_not_found_in_batch_proceed_with_api1_link' });
                // If no match, we process the officialWebsiteNormalizedFromApi1 from scratch
                processedEntry = await this.handleDetermineNoMatchInternal(
                    page,
                    officialWebsiteNormalizedFromApi1,
                    primaryEntryForContext, // Update this entry
                    batchIndexForApi,
                    logger
                );
            }

            if (processedEntry) {
                const finalStatus = processedEntry.conferenceLink === "None" ? 'failed' : 'success';
                logger.info({ finalStatus, finalProcessedConferenceLink: processedEntry.conferenceLink, event: 'finish_processing_determine_api_response' });
                return [processedEntry];
            } else {
                logger.error({ event: 'processed_entry_is_null_unexpected' });
                primaryEntryForContext.conferenceLink = "None";
                return [primaryEntryForContext];
            }

        } catch (error: any) {
            logger.error({ err: error, event: 'unhandled_error_in_determineAndProcessOfficialSite' });
            primaryEntryForContext.conferenceLink = "None";
            return [primaryEntryForContext];
        } finally {
            if (page && !page.isClosed()) {
                await page.close().catch(e => logger.error({ err: e, event: 'page_close_failed_determination' }));
            }
        }
    }
}