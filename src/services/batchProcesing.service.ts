// src/services/saveStreamBatch.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs'; // Keep for basic checks like existsSync if needed outside FileSystemService
import path from 'path';
import { Page, BrowserContext, Response } from 'playwright';

// --- Utilities ---
import { normalizeAndJoinLink } from '../utils/crawl/url.utils'; // Use new util
import { extractTextFromPDF } from '../utils/crawl/pdf.utils'; // Use new util

// --- Domain Logic Utils (Keep imports if they are pure functions) ---
import { cleanDOM, traverseNodes, removeExtraEmptyLines } from '../utils/crawl/domProcessing';

// --- Types ---
import { BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData } from '../types/crawl.types';

// --- Service Imports ---
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { GeminiApiService, ApiResponse, GeminiApiParams } from './geminiApi.service';
import { FileSystemService } from './fileSystem.service'; // <<< Inject FileSystemService

// Other Imports
import { Logger } from 'pino';

import { addAcronymSafely } from '../conference/11_utils';



export type LogContextBase = {
    batchIndex: number;
    conferenceAcronym: string | undefined;
    conferenceTitle: string | undefined;
    function: string;
    apiCallNumber?: 1 | 2;
    // Add other fields if they are consistently part of the base context
};

// --- Specific Log Context Type for this Module ---
// Inherit from the base context provided by LoggingService
export interface BatchProcessingLogContext extends LogContextBase {
    // Fields specific to batch processing
    batchIndex: number;
    conferenceAcronym: string;
    conferenceTitle: string;
    fileType?: 'full_links' | 'main_link' | 'update_intermediate' | 'determine_response' | 'extract_response' | 'cfp_response' | 'initial_text';
    aggregationPurpose?: 'determine_api' | 'extract_cfp_api';
    apiType?: 'determine' | 'extract' | 'cfp';
    contentType?: 'main' | 'cfp' | 'imp';
    event_group?: string;

    // --- Fields specific to link processing context ---
    linkIndex?: number;
    originalUrl?: string;
    url?: string;
    finalUrl?: string;
    linkType?: 'main' | 'cfp' | 'imp' | 'modified' | 'original';
    status?: number | null; // HTTP status
}

@singleton()
export class BatchProcessingService {
    private readonly logger: Logger;
    private readonly configService: ConfigService;
    private readonly geminiApiService: GeminiApiService;
    private readonly fileSystemService: FileSystemService;

    // private readonly playwrightService: PlaywrightService; // Inject if creating pages here

    private readonly batchesDir: string;
    private readonly finalOutputPath: string;
    private readonly tempDir: string;
    private readonly errorLogPath: string;
    private readonly year2: number;
    private readonly mainContentKeywords: string[];

    private activeBatchSaves: Set<Promise<boolean>> = new Set();

    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
        @inject(GeminiApiService) geminiApiService: GeminiApiService,
        @inject(FileSystemService) fileSystemService: FileSystemService
        // @inject(PlaywrightService) playwrightService: PlaywrightService // Inject if needed
    ) {
        this.configService = configService;
        this.geminiApiService = geminiApiService;
        this.fileSystemService = fileSystemService;
        // this.playwrightService = playwrightService;
        this.logger = loggingService.getLogger({ service: 'BatchProcessingService' });

        // Derive paths and config values
        this.batchesDir = this.configService.batchesDir;
        this.finalOutputPath = this.configService.finalOutputJsonlPath;
        this.tempDir = this.configService.tempDir;
        this.errorLogPath = this.configService.baseOutputDir;
        this.year2 = this.configService.config.YEAR2;
        this.mainContentKeywords = this.configService.config.MAIN_CONTENT_KEYWORDS ?? [];

        this.logger.info("BatchProcessingService constructed.");
        this.logger.info(`Batches Directory: ${this.batchesDir}`);
        this.logger.info(`Final Output Path: ${this.finalOutputPath}`);
        this.logger.info(`Temp Directory: ${this.tempDir}`);
    }

    /**
     * Extracts text from a given URL, handling HTML and PDF.
     * Integrated logic from original `extractTextFromUrl`.
     */
    private async _extractTextFromUrl(
        page: Page | null, // Page can be null for PDF links
        url: string, // Expect normalized URL
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        logContext: BatchProcessingLogContext
    ): Promise<string> {
        const currentLogContext = { ...logContext, url, useMainContentKeywords, function: '_extractTextFromUrl' };
        this.logger.trace({ ...currentLogContext, event: 'start' });

        // Pre-check for invalid URL (already normalized before calling this)
        if (!url || !/^(https?:\/\/|file:\/\/)/i.test(url)) {
            this.logger.warn({ ...currentLogContext, event: 'skipped_invalid_url_structure' });
            return "";
        }

        try {
            // 1. Handle PDF
            if (url.toLowerCase().endsWith(".pdf")) {
                this.logger.info({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_start' });
                const pdfText = await extractTextFromPDF(url, this.logger); // Use PDF util
                this.logger.info({ ...currentLogContext, type: 'pdf', success: !!pdfText, event: 'pdf_extraction_finish' });
                return pdfText || "";
            }

            // 2. Handle HTML (Requires a valid Page)
            if (!page || page.isClosed()) {
                this.logger.error({ ...currentLogContext, type: 'html', event: 'html_processing_failed', reason: 'Page is null or closed' });
                throw new Error(`Page required for HTML extraction but was null or closed for URL: ${url}`);
            }
            this.logger.info({ ...currentLogContext, type: 'html', event: 'html_processing_start' });

            try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
            } catch (gotoError: unknown) {
                this.logger.error({ ...currentLogContext, type: 'html', err: gotoError, event: 'goto_failed' });
                return ""; // Return empty on navigation error
            }

            let htmlContent: string;
            try {
                htmlContent = await page.content();
            } catch (contentError: unknown) {
                this.logger.error({ ...currentLogContext, type: 'html', err: contentError, event: 'fetch_content_failed' });
                return "";
            }

            // 3. Extract Main Content (Optional)
            let contentToProcess = htmlContent;
            if (useMainContentKeywords && this.mainContentKeywords.length > 0) {
                this.logger.trace({ ...currentLogContext, type: 'html', event: 'main_content_eval_start' });
                try {
                    if (page.isClosed()) throw new Error('Page closed before $$eval');
                    // Use $$eval logic from original file
                    // Robust $$eval: handle potential non-array keywords and element filtering
                    const extractedContentRaw: string | string[] = await page.$$eval("body *", (els, keywords) => {
                        // Type guard inside $$eval
                        const safeKeywords = Array.isArray(keywords) ? keywords.map(k => String(k).toLowerCase()) : [];
                        if (safeKeywords.length === 0) {
                            // FIX: Check for document existence before accessing body
                            return document ? (document.body?.outerHTML || "") : ""; // Fallback if no keywords
                        }

                        return els
                            .filter((el: Element) =>
                                el.hasAttributes() && // Optimization: check if element has attributes first
                                Array.from(el.attributes).some((attr: Attr) =>
                                    safeKeywords.some((keyword: string) =>
                                        attr.name.toLowerCase().includes(keyword) || // Check attribute name
                                        attr.value.toLowerCase().includes(keyword)   // Optionally check attribute value too? (Consider performance)
                                    )
                                )
                            )
                            .map((el: Element) => el.outerHTML) // Get outerHTML of matching elements
                            .join("\n\n"); // Join the HTML strings
                    }, this.mainContentKeywords); // Pass keywords array

                    const extractedContent = Array.isArray(extractedContentRaw) ? extractedContentRaw.join('\n\n') : extractedContentRaw;

                    if (extractedContent && extractedContent.length > 50) {
                        contentToProcess = extractedContent;
                        this.logger.trace({ ...currentLogContext, type: 'html', event: 'main_content_eval_success' });
                    } else {
                        this.logger.debug({ ...logContext, type: 'html', event: 'extractTextFromUrl_main_content_eval_skipped', reason: 'No significant content found' });
                    }
                } catch (evalError: unknown) {
                    this.logger.warn({ ...currentLogContext, type: 'html', err: evalError, event: 'main_content_eval_failed' });
                    // Fallback to full content
                }
            }

            // 4. Clean DOM and Traverse
            this.logger.trace({ ...currentLogContext, type: 'html', event: 'dom_processing_start' });
            const document = cleanDOM(contentToProcess); // Use DOM util
            if (!document?.body) {
                this.logger.warn({ ...logContext, type: 'html', event: 'extractTextFromUrl_dom_processing_failed', reason: 'Cleaned DOM or body is null' });

                return "";
            }
            let fullText = traverseNodes(document.body as HTMLElement, acronym, this.year2); // Use DOM util
            fullText = removeExtraEmptyLines(fullText); // Use DOM util
            this.logger.info({ ...currentLogContext, type: 'html', success: true, textLength: fullText.length, event: 'html_processing_finish' });
            return fullText;

        } catch (error: unknown) {
            this.logger.error({ ...currentLogContext, err: error, event: 'unexpected_error' });
            return "";
        }
    }

    /**
     * Saves content to a temporary file using FileSystemService.
     * Integrated logic from original `saveContentToTempFile`.
     */
    private async _saveContentToTempFile(
        content: string,
        baseName: string,
        logContext: BatchProcessingLogContext
    ): Promise<string | null> {
        const currentLogContext = { ...logContext, baseName, function: '_saveContentToTempFile' };
        if (!content || content.trim().length === 0) {
            this.logger.trace({ ...currentLogContext, event: 'skipped_empty_content' });
            return null;
        }
        try {
            // Use FileSystemService method
            const filePath = await this.fileSystemService.saveTemporaryFile(content, baseName);
            this.logger.trace({ ...currentLogContext, filePath, event: 'success' });
            return filePath;
        } catch (writeError: unknown) {
            this.logger.error({ ...currentLogContext, err: writeError, event: 'failed' });
            return null;
        }
    }

    /**
     * Processes a specific linked page (cfp or imp).
     * Integrated logic from original `processAndSaveLinkedPage`.
     */
    private async _processAndSaveLinkedPage(
        page: Page | null, // Can be null for PDF
        link: string | undefined,
        baseLink: string, // Normalized main website URL
        otherLink: string | undefined | null, // Normalized other link (cfp/imp)
        acronym: string | undefined,
        contentType: 'cfp' | 'imp',
        useMainContentKeywords: boolean,
        logContext: BatchProcessingLogContext
    ): Promise<string | null> {
        const safeAcronym = acronym?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
        // Add batch index to filename for uniqueness within update flow
        const fileBaseName = `${safeAcronym}_${contentType.toLowerCase()}_update_${logContext.batchIndex}`;
        const currentLogContext = { ...logContext, contentType, url: link, fileBaseName, function: '_processAndSaveLinkedPage' };

        // 1. Normalize link and check if saving is needed
        const normalizedLink = normalizeAndJoinLink(baseLink, link, this.logger);
        const normalizedOtherLink = normalizeAndJoinLink(baseLink, otherLink, this.logger);

        if (!normalizedLink || normalizedLink === baseLink || (normalizedOtherLink && normalizedLink === normalizedOtherLink)) {
            let reason = 'Link is empty, None, or could not be normalized';
            if (normalizedLink === baseLink) reason = `Link matches base website (${baseLink})`;
            else if (normalizedOtherLink && normalizedLink === normalizedOtherLink) reason = `Link matches ${contentType === 'cfp' ? 'imp' : 'cfp'} link (${normalizedOtherLink})`;
            this.logger.trace({ ...currentLogContext, reason, event: 'skipped' });
            return null;
        }

        // 2. Extract content using internal helper
        this.logger.trace({ ...currentLogContext, event: 'extract_start' });
        const textContent = await this._extractTextFromUrl(page, normalizedLink, acronym, useMainContentKeywords, currentLogContext);

        // 3. Save content using internal helper
        return await this._saveContentToTempFile(textContent, fileBaseName, currentLogContext);
    }

    /**
     * Fetches and processes the main official website.
     * Integrated logic from original `fetchAndProcessWebsiteInfo`.
     */
    private async _fetchAndProcessWebsiteInfo(
        page: Page,
        officialWebsite: string, // Expect normalized URL
        batchEntry: BatchEntry, // Used for acronym
        logContext: BatchProcessingLogContext
    ): Promise<{ finalUrl: string; textPath: string } | null> {
        const currentLogContext = { ...logContext, url: officialWebsite, function: '_fetchAndProcessWebsiteInfo' };
        this.logger.info({ ...currentLogContext, event: 'start' });
        try {
            if (page.isClosed()) throw new Error(`Page closed before navigating`);
            const response: Response | null = await page.goto(officialWebsite, { waitUntil: 'domcontentloaded', timeout: 25000 });
            if (!response?.ok()) throw new Error(`Non-OK response: ${response?.status()}`);

            const finalUrl = page.url();
            const normalizedFinalUrl = normalizeAndJoinLink(finalUrl, null, this.logger); // Normalize final URL
            if (!normalizedFinalUrl) throw new Error("Could not normalize final URL");
            this.logger.info({ ...currentLogContext, finalUrl: normalizedFinalUrl, event: 'navigated' });

            // Extract text (useMainContentKeywords = false for main page)
            const textContent = await this._extractTextFromUrl(page, normalizedFinalUrl, batchEntry.conferenceAcronym, false, currentLogContext);

            // Save content
            const safeAcronym = batchEntry.conferenceAcronym.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
            // Add batch index for uniqueness
            const fileBaseName = `${safeAcronym}_main_determine_${logContext.batchIndex}`;
            const textPath = await this._saveContentToTempFile(textContent, fileBaseName, currentLogContext);

            if (!textPath) {
                this.logger.warn({ ...currentLogContext, finalUrl: normalizedFinalUrl, event: 'fetch_website_save_failed' });
                // Decide if you want to return null here or continue without textPath
                return null; // Returning null as saving failed // Saving failed
            }
            this.logger.info({ ...currentLogContext, finalUrl: normalizedFinalUrl, textPath, event: 'success' });
            return { finalUrl: normalizedFinalUrl, textPath };

        } catch (error: unknown) {
            this.logger.error({ ...currentLogContext, err: error, event: 'failed' });
            return null;
        }
    }

    /**
     * Handles the logic when a matching entry is found in the batch during determine response processing.
     * Integrated logic from original `_handleMatchingEntry`.
     */
    private async _handleDetermineMatch(
        page: Page,
        matchingEntry: BatchEntry,
        cfpLinkNormalized: string, // Already normalized relative to official website
        impLinkNormalized: string, // Already normalized relative to official website
        logContext: BatchProcessingLogContext
    ): Promise<BatchEntry> {
        const currentLogContext = { ...logContext, matchedLink: matchingEntry.conferenceLink, function: '_handleDetermineMatch' };
        this.logger.info({ ...currentLogContext, event: 'start' });

        // Use the matched entry's link as the base for saving checks
        const baseLink = normalizeAndJoinLink(matchingEntry.conferenceLink, null, this.logger);
        if (!baseLink) {
            this.logger.error({ ...currentLogContext, event: 'invalid_base_link' }, "Could not normalize matched entry link, cannot process linked pages.");
            // Mark links as potentially unprocessed? Or return entry as is?
            matchingEntry.cfpLink = cfpLinkNormalized;
            matchingEntry.impLink = impLinkNormalized;
            return matchingEntry; // Return entry, but linked pages weren't processed
        }


        matchingEntry.cfpLink = cfpLinkNormalized;
        matchingEntry.impLink = impLinkNormalized;
        let cfpSaveError = false;
        let impSaveError = false;

        try {
            // Process and save cfp page (useMainContentKeywords = true)
            matchingEntry.cfpTextPath = await this._processAndSaveLinkedPage(
                page, cfpLinkNormalized, baseLink, impLinkNormalized, matchingEntry.conferenceAcronym, 'cfp', true, currentLogContext
            );
            if (cfpLinkNormalized && !matchingEntry.cfpTextPath && cfpLinkNormalized !== baseLink) cfpSaveError = true;
        } catch (error) {
            this.logger.error({ ...currentLogContext, contentType: 'cfp', err: error, event: 'save_cfp_error' });
            cfpSaveError = true;
        }

        try {
            // Process and save imp page (useMainContentKeywords = false)
            matchingEntry.impTextPath = await this._processAndSaveLinkedPage(
                page, impLinkNormalized, baseLink, cfpLinkNormalized, matchingEntry.conferenceAcronym, 'imp', false, currentLogContext
            );
            if (impLinkNormalized && !matchingEntry.impTextPath && impLinkNormalized !== baseLink && impLinkNormalized !== cfpLinkNormalized) impSaveError = true;
        } catch (error) {
            this.logger.error({ ...currentLogContext, contentType: 'imp', err: error, event: 'save_imp_error' });
            impSaveError = true;
        }

        this.logger.info({ ...currentLogContext, success: !cfpSaveError && !impSaveError, cfpSaveError, impSaveError, event: 'finish' });
        return matchingEntry;
    }

    /**
     * Handles the logic when no matching entry is found during determine response processing.
     * Integrated logic from original `_handleNewEntry`.
     */
    private async _handleDetermineNoMatch(
        page: Page,
        officialWebsiteNormalized: string, // Validated & normalized URL from API 1
        primaryEntry: BatchEntry, // The entry to update (usually batch[0])
        logContext: BatchProcessingLogContext
    ): Promise<BatchEntry> { // Return updated entry (potentially marked as failed)
        const currentLogContext = { ...logContext, initialUrl: officialWebsiteNormalized, function: '_handleDetermineNoMatch' };
        this.logger.info({ ...currentLogContext, event: 'start' });

        // 1. Fetch and process the main website
        const websiteInfo = await this._fetchAndProcessWebsiteInfo(page, officialWebsiteNormalized, primaryEntry, currentLogContext);

        if (!websiteInfo) {
            this.logger.error({ ...currentLogContext, event: 'fetch_main_website_failed' });
            primaryEntry.conferenceLink = "None"; // Mark as failed
            return primaryEntry;
        }
        const { finalUrl, textPath } = websiteInfo;
        primaryEntry.conferenceLink = finalUrl;
        primaryEntry.conferenceTextPath = textPath;

        // 2. Read fetched content for API call 2
        let fullText = '';
        try {
            // Use FileSystemService
            fullText = await this.fileSystemService.readFileContent(textPath);
            this.logger.info({ ...currentLogContext, filePath: textPath, event: 'read_fetched_content_success' });
        } catch (readErr: unknown) {
            this.logger.error({ ...currentLogContext, filePath: textPath, err: readErr, event: 'read_fetched_content_failed' });
            // Continue, but API call 2 might fail or give bad results without content 
        }

        // 3. Call determine_links_api (2nd call) via GeminiApiService
        const batchContentForApi = `Conference full name: ${primaryEntry.conferenceTitle} (${primaryEntry.conferenceAcronym})\n\n1. Website of ${primaryEntry.conferenceAcronym}: ${finalUrl}\nWebsite information of ${primaryEntry.conferenceAcronym}:\n\n${fullText.trim()}`;
        let websiteLinksResponseText: string = "";
        let api2Success = false;
        const api2Context = { ...currentLogContext, apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 2 };
        const api2Params: GeminiApiParams = {
            batch: batchContentForApi,
            batchIndex: logContext.batchIndex,
            title: primaryEntry.conferenceTitle,
            acronym: primaryEntry.conferenceAcronym,
        };

        try {
            this.logger.info({ ...api2Context, event: 'api2_call_start' });
            const websiteLinksResponse = await this.geminiApiService.determineLinks(api2Params); // Use service
            websiteLinksResponseText = websiteLinksResponse.responseText || "";
            // Store metadata if needed: primaryEntry.determineMetaDataApi2 = websiteLinksResponse.metaData;
            api2Success = true;
            this.logger.info({ ...api2Context, responseLength: websiteLinksResponseText.length, event: 'api2_call_success' });
        } catch (determineLinksError: unknown) {
            this.logger.error({ ...api2Context, err: determineLinksError, event: 'api2_call_failed' });
            primaryEntry.conferenceLink = "None"; // Mark as failed
            return primaryEntry;
        }

        // 4. Parse API 2 response
        let websiteLinksData: any;
        try {
            if (!websiteLinksResponseText) throw new Error("API 2 response text is empty.");
            websiteLinksData = JSON.parse(websiteLinksResponseText);
            if (typeof websiteLinksData !== 'object' || websiteLinksData === null) throw new Error("Parsed API 2 response is not a valid object.");
        } catch (parseError: unknown) {
            this.logger.error({ ...currentLogContext, err: parseError, responseTextPreview: websiteLinksResponseText.substring(0, 100), event: 'api2_json_parse_failed' });
            primaryEntry.conferenceLink = "None"; // Mark as failed
            return primaryEntry;
        }

        // 5. Normalize links from API 2 relative to the FINAL URL
        const websiteCfpLinkRaw = String(websiteLinksData?.["Call for papers link"] ?? '').trim();
        const websiteImpDatesLinkRaw = String(websiteLinksData?.["Important dates link"] ?? '').trim();
        const websiteCfpLink = normalizeAndJoinLink(finalUrl, websiteCfpLinkRaw, this.logger);
        const websiteImpDatesLink = normalizeAndJoinLink(finalUrl, websiteImpDatesLinkRaw, this.logger);
        this.logger.trace({ ...currentLogContext, finalUrl, websiteCfpLink, websiteImpDatesLink, event: 'api2_links_normalized' });

        primaryEntry.cfpLink = websiteCfpLink;
        primaryEntry.impLink = websiteImpDatesLink;

        // 6. Save cfp and imp content based on API 2 results
        let cfpSaveError = false;
        let impSaveError = false;
        try {
            primaryEntry.cfpTextPath = await this._processAndSaveLinkedPage(
                page, websiteCfpLink, finalUrl, websiteImpDatesLink, primaryEntry.conferenceAcronym, 'cfp', true, currentLogContext
            );
            if (websiteCfpLink && !primaryEntry.cfpTextPath && websiteCfpLink !== finalUrl) cfpSaveError = true;
        } catch (error) {
            this.logger.error({ ...currentLogContext, contentType: 'CFP', source: 'api2', err: error, event: 'save_cfp_error' });

            cfpSaveError = true;
        }
        try {
            primaryEntry.impTextPath = await this._processAndSaveLinkedPage(
                page, websiteImpDatesLink, finalUrl, websiteCfpLink, primaryEntry.conferenceAcronym, 'imp', false, currentLogContext
            );
            if (websiteImpDatesLink && !primaryEntry.impTextPath && websiteImpDatesLink !== finalUrl && websiteImpDatesLink !== websiteCfpLink) impSaveError = true;
        } catch (error) {
            this.logger.error({ ...currentLogContext, contentType: 'IMP', source: 'api2', err: error, event: 'save_imp_error' });
            impSaveError = true;
        }

        this.logger.info({ ...currentLogContext, success: !cfpSaveError && !impSaveError, cfpSaveError, impSaveError, event: 'finish' });
        // Return the updated primary entry
        return primaryEntry;
    }

    /**
     * Processes the response from the first determine_links_api call.
     * Integrated logic from original `processDetermineLinksResponse`.
     * This is now a private orchestrator called by `_executeAndSaveBatch`.
     */
    private async _processDetermineApiResponse(
        responseText: string,
        batch: BatchEntry[], // Original batch from link processing
        batchIndex: number,
        browserContext: BrowserContext,
        parentLogContext: BatchProcessingLogContext
    ): Promise<BatchEntry[]> { // Returns array with the processed entry (or failed entry)
        const logContext = { ...parentLogContext, function: '_processDetermineApiResponse' };
        this.logger.info({ ...logContext, event: 'start' });

        if (!batch?.[0]) {
            this.logger.error({ batchIndex, event: 'process_determine_invalid_batch' }, "Invalid or empty batch provided.");
            return [];
        }
        const primaryEntry = batch[0]; // Use primary for context and update if no match

        let page: Page | null = null;
        try {
            page = await browserContext.newPage();
            this.logger.info({ ...logContext, event: 'page_created' });

            // Parse API 1 Response
            let linksData: any;
            try {
                if (!responseText) throw new Error("API 1 response text is empty.");
                linksData = JSON.parse(responseText);
                if (typeof linksData !== 'object' || linksData === null) throw new Error("Parsed API 1 response is not object.");
            } catch (parseError: unknown) {
                this.logger.error({ ...logContext, err: parseError, responseTextPreview: String(responseText).substring(0, 100), event: 'process_determine_json_parse_failed' });

                primaryEntry.conferenceLink = "None"; return [primaryEntry];
            }

            // Validate and Normalize Official Website URL from API 1
            const officialWebsiteRaw = linksData?.["Official Website"] ?? null;
            if (!officialWebsiteRaw || typeof officialWebsiteRaw !== 'string' || officialWebsiteRaw.trim().toLowerCase() === "none" || officialWebsiteRaw.trim() === '') {
                this.logger.warn({ ...logContext, officialWebsiteRaw, event: 'process_determine_no_official_website', reason: 'Raw value is null, empty, or "none"' });
                primaryEntry.conferenceLink = "None"; return [primaryEntry];
            }
            const officialWebsiteNormalized = normalizeAndJoinLink(officialWebsiteRaw, null, this.logger);
            if (!officialWebsiteNormalized) {
                this.logger.error({ ...logContext, rawUrl: officialWebsiteRaw, event: 'process_determine_invalid_official_website' }, "Official website URL is invalid after normalization.");
                primaryEntry.conferenceLink = "None"; return [primaryEntry];
            }
            this.logger.info({ ...logContext, officialWebsiteNormalized, event: 'official_website_normalized' });

            // Normalize cfp/imp links from API 1 relative to normalized official website
            const cfpLinkRaw = String(linksData?.["Call for papers link"] ?? '').trim();
            const impLinkRaw = String(linksData?.["Important dates link"] ?? '').trim();
            const cfpLinkNormalized = normalizeAndJoinLink(officialWebsiteNormalized, cfpLinkRaw, this.logger);
            const impLinkNormalized = normalizeAndJoinLink(officialWebsiteNormalized, impLinkRaw, this.logger);
            this.logger.trace({ ...logContext, cfpLinkNormalized, impLinkNormalized, event: 'api1_links_normalized' });

            // Find Matching Entry in original batch
            let matchingEntry: BatchEntry | undefined;
            try {
                matchingEntry = batch.find(entry => {
                    const normalizedEntryLink = normalizeAndJoinLink(entry.conferenceLink, null, this.logger);
                    return normalizedEntryLink && normalizedEntryLink === officialWebsiteNormalized;
                });
            } catch (findError: unknown) {
                this.logger.error({ ...logContext, err: findError, event: 'process_determine_entry_match_error' });
                primaryEntry.conferenceLink = "None"; return [primaryEntry];
            }

            // Delegate to Handlers
            let processedEntry: BatchEntry | null = null;
            if (matchingEntry) {
                this.logger.info({ ...logContext, matchedLink: matchingEntry.conferenceLink, event: 'entry_match_found' });
                processedEntry = await this._handleDetermineMatch(page, matchingEntry, cfpLinkNormalized, impLinkNormalized, logContext);
            } else {
                this.logger.info({ ...logContext, officialWebsite: officialWebsiteNormalized, event: 'entry_match_not_found' });
                processedEntry = await this._handleDetermineNoMatch(page, officialWebsiteNormalized, primaryEntry, logContext);
            }

            // Return Result
            if (processedEntry) {
                const finalStatus = processedEntry.conferenceLink === "None" ? 'failed' : 'success';
                this.logger.info({ ...logContext, finalStatus, event: 'finish' });
                return [processedEntry];
            } else {
                this.logger.error({ ...logContext, event: 'finish_critical_failure' });
                primaryEntry.conferenceLink = "None"; // Ensure marked as failed
                return [primaryEntry];
            }

        } catch (error: unknown) {
            this.logger.error({ ...logContext, err: error, event: 'unhandled_error' });
            primaryEntry.conferenceLink = "None";
            return [primaryEntry];
        } finally {
            // Ensure Page Closure
            if (page && !page.isClosed()) {
                this.logger.info({ ...logContext, event: 'page_closing' });
                await page.close().catch(e => this.logger.error({ ...logContext, err: e, event: 'page_close_failed' }));
            } else if (!page) {
                this.logger.info({ ...logContext, event: 'page_not_created' });
            } else {
                this.logger.info({ ...logContext, event: 'page_already_closed' });
            }
        }
    }

    /**
     * Ensures necessary directories exist.
     */
    private async ensureDirectories(paths: string[]): Promise<void> {
        const logContext = { function: 'ensureDirectories' }; // Base context for this helper
        for (const dirPath of paths) {
            // Handle both file paths and directory paths
            const dir = fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()
                ? dirPath
                : path.dirname(dirPath);

            if (!fs.existsSync(dir)) {
                this.logger.info({ ...logContext, path: dir, event: 'ensure_dir_create' }, `Creating directory`);
                try {
                    await this.fileSystemService.ensureDirExists(dir);
                } catch (mkdirError: unknown) {
                    this.logger.error({ ...logContext, path: dir, err: mkdirError, event: 'ensure_dir_create_failed' }, `Error creating directory`);
                    throw mkdirError; // Re-throw critical error
                }
            }
        }
    }

    /**
     * Reads content from multiple text paths specified in batch entries.
     * Returns an object mapping contentType to its content.
     */
    private async readBatchContentFiles(
        entry: { conferenceTextPath?: string | null, cfpTextPath?: string | null, impTextPath?: string | null },
        parentLogContext: BatchProcessingLogContext // Pass context for logging
    ): Promise<{ mainText: string; cfpText: string; impText: string }> {
        const logContext = { ...parentLogContext, function: 'readBatchContentFiles' };
        const content: { mainText: string; cfpText: string; impText: string } = { mainText: '', cfpText: '', impText: '' };
        const readPromises: Promise<void>[] = [];

        if (entry.conferenceTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(entry.conferenceTextPath) // Use imported helper
                    .then(text => { content.mainText = text; })
                    .catch(e => {
                        this.logger.error({ ...logContext, err: e, filePath: entry.conferenceTextPath, contentType: 'main', event: 'read_content_failed' }, "Failed to read main text file. Cannot proceed.");
                        throw e; // Re-throw critical error for main text
                    })
            );
        } else {
            this.logger.error({ ...logContext, contentType: 'main', event: 'read_content_failed', reason: 'Missing main text path' }, "Main text path is missing. Cannot proceed.");
            throw new Error("Missing main text path for content aggregation.");
        }

        if (entry.cfpTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(entry.cfpTextPath)
                    .then(text => { content.cfpText = text; })
                    .catch(e => this.logger.warn({ ...logContext, err: e, filePath: entry.cfpTextPath, contentType: 'cfp', event: 'read_content_failed_non_critical' }, "Could not read cfp text file"))
            );
        }

        if (entry.impTextPath) {
            readPromises.push(
                this.fileSystemService.readFileContent(entry.impTextPath)
                    .then(text => { content.impText = text; })
                    .catch(e => this.logger.warn({ ...logContext, err: e, filePath: entry.impTextPath, contentType: 'imp', event: 'read_content_failed_non_critical' }, "Could not read imp text file"))
            );
        }

        await Promise.all(readPromises);
        this.logger.debug({ ...logContext, event: 'read_content_complete', hasCfp: !!content.cfpText, hasImp: !!content.impText });
        return content;
    }

    /**
     * Aggregates content for API calls based on available text.
     */
    private aggregateContentForApi(
        title: string,
        acronym: string,
        content: { mainText: string; cfpText: string; impText: string },
        parentLogContext: BatchProcessingLogContext // Pass context for logging
    ): string {
        const logContext = { ...parentLogContext, function: 'aggregateContentForApi' };
        const impContent = content.impText ? ` \n\nImportant Dates information:\n${content.impText.trim()}` : "";
        const cfpContentAggregated = content.cfpText ? ` \n\nCall for Papers information:\n${content.cfpText.trim()}` : "";
        // Structure might need adjustment based on Gemini prompt engineering
        const aggregated = `Conference Title: ${title}\nConference Acronym: ${acronym}\n\nMain Website Content:\n${content.mainText.trim()}${cfpContentAggregated}${impContent}`;
        this.logger.debug({ ...logContext, charCount: aggregated.length, event: 'aggregate_content_complete' });
        return aggregated;
    }

    /**
     * Executes extractInformation and extractCfp APIs in parallel using GeminiApiService.
     */
    private async executeParallelExtractCfpApis(
        contentSendToAPI: string,
        batchIndex: number,
        titleForApis: string,
        acronymForApis: string,
        safeConferenceAcronym: string,
        isUpdate: boolean, // Flag to differentiate filenames/logging
        parentLogContext: BatchProcessingLogContext // Use specific context
    ): Promise<{
        extractResponseTextPath?: string;
        extractMetaData: any | null;
        cfpResponseTextPath?: string;
        cfpMetaData: any | null;
    }> {
        const logContext = { ...parentLogContext, function: 'executeParallelExtractCfpApis', isUpdate };
        const suffix = isUpdate ? `_update_response_${batchIndex}` : `_response_${batchIndex}`;
        const extractFileBase = `${safeConferenceAcronym}_extract${suffix}`;
        const cfpFileBase = `${safeConferenceAcronym}_cfp${suffix}`;

        this.logger.info({ ...logContext, event: 'parallel_apis_start' }, "Starting parallel calls to extract & cfp APIs");

        const commonApiParams: Omit<GeminiApiParams, 'batch'> = { // Base params for Gemini service
            batchIndex,
            title: titleForApis,
            acronym: acronymForApis,
        };

        const extractPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
            const apiContext = { ...logContext, apiType: this.geminiApiService.API_TYPE_EXTRACT };
            this.logger.info({ ...apiContext, inputLength: contentSendToAPI.length, event: 'api_call_start' });
            try {
                const response = await this.geminiApiService.extractInformation({
                    ...commonApiParams,
                    batch: contentSendToAPI,
                });
                const responseText = response.responseText || "";
                // Use the configured tempDir for writing temporary files
                const path = await this.fileSystemService.saveTemporaryFile(responseText, extractFileBase);
                this.logger.info({ ...apiContext, responseLength: responseText.length, filePath: path, event: 'api_call_end', success: true });
                return { responseTextPath: path, metaData: response.metaData };
            } catch (error) {
                this.logger.error({ ...apiContext, err: error, event: 'api_call_failed' }, "extractInformation API call failed");
                return { responseTextPath: undefined, metaData: null }; // Return default on failure
            }
        })();

        const cfpPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
            const apiContext = { ...logContext, apiType: this.geminiApiService.API_TYPE_CFP };
            this.logger.info({ ...apiContext, inputLength: contentSendToAPI.length, event: 'api_call_start' });
            try {
                const response = await this.geminiApiService.extractCfp({
                    ...commonApiParams,
                    batch: contentSendToAPI,
                });
                const responseText = response.responseText || "";
                // Use the configured tempDir for writing temporary files
                const path = await this.fileSystemService.saveTemporaryFile(responseText, cfpFileBase);
                this.logger.info({ ...apiContext, responseLength: responseText.length, filePath: path, event: 'api_call_end', success: true });
                return { responseTextPath: path, metaData: response.metaData };
            } catch (error) {
                this.logger.error({ ...apiContext, err: error, event: 'api_call_failed' }, "extractCfp API call failed");
                return { responseTextPath: undefined, metaData: null }; // Return default on failure
            }
        })();

        // Use Promise.all to await both promises concurrently
        const [extractResult, cfpResult] = await Promise.all([extractPromise, cfpPromise]);
        this.logger.info({ ...logContext, event: 'parallel_apis_finished' }, "Parallel API calls finished");

        if (!extractResult.responseTextPath && !cfpResult.responseTextPath) {
            this.logger.error({ ...logContext, event: 'parallel_apis_both_failed' }, "Both extract and cfp API calls failed to produce results.");
            // Decide whether to throw or continue based on requirements
            // throw new Error("Both extract and cfp API calls failed.");
        }

        return {
            extractResponseTextPath: extractResult.responseTextPath,
            extractMetaData: extractResult.metaData,
            cfpResponseTextPath: cfpResult.responseTextPath,
            cfpMetaData: cfpResult.metaData,
        };
    }

    /**
     * Appends the final processed record to the output JSONL file.
     */
    private async appendFinalRecord(
        record: BatchEntry | BatchUpdateEntry, // Accept either type
        parentLogContext: BatchProcessingLogContext // Pass context for logging
    ): Promise<void> {
        // Use the configured finalOutputPath
        const logContext = { ...parentLogContext, function: 'appendFinalRecord', outputPath: this.finalOutputPath, recordAcronym: record.conferenceAcronym };
        try {
            this.logger.info({ ...logContext, event: 'append_final_record_start' }, "Preparing and appending final record");
            const dataToWrite = JSON.stringify(record) + '\n';
            await this.fileSystemService.appendFile(this.finalOutputPath, dataToWrite);
            this.logger.info({ ...logContext, event: 'append_final_record_success' }, "Successfully appended final record");
        } catch (appendError: unknown) {
            this.logger.error({ ...logContext, err: appendError, event: 'append_final_record_failed' }, "CRITICAL: Failed to append final result to output file");
            throw appendError; // Re-throw critical error
        }
    }

    /**
     * Processes a single link during the initial crawl phase.
     * Handles year replacement, navigation, content extraction, and saving.
     * Returns a BatchEntry on success, null on failure.
     */
    private async _processSingleLink(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number, // Keep year parameter if needed for logic
        existingAcronyms: Set<string>,
        parentLogContext: BatchProcessingLogContext // Pass context
    ): Promise<BatchEntry | null> {
        const linkLogContext: BatchProcessingLogContext = {
            ...parentLogContext,
            linkIndex,
            originalUrl: link,
            event_group: 'link_processing',
            function: '_processSingleLink' // Add function name to context
        };
        this.logger.info({ ...linkLogContext, event: 'start' }, `Processing link ${linkIndex + 1}`);
        let finalLink: string = link;
        let useModifiedLink: boolean = false;
        let modifiedLink: string = link;
        let accessSuccess = false;
        let accessError: unknown = null;
        let responseStatus: number | null = null;
        let accessType: 'modified' | 'original' | null = null;

        try {
            const yearOld1 = year - 1;
            const yearOld2 = year - 2;
            const yearStr = String(year);

            // Year replacement logic (remains the same)
            if (link.includes(String(yearOld1))) {
                modifiedLink = link.replace(new RegExp(String(yearOld1), 'g'), yearStr);
                useModifiedLink = true;
            } else if (link.includes(String(yearOld2))) {
                modifiedLink = link.replace(new RegExp(String(yearOld2), 'g'), yearStr);
                useModifiedLink = true;
            }

            // Try modified link
            if (useModifiedLink) {
                accessType = 'modified';
                this.logger.info({ ...linkLogContext, url: modifiedLink, linkType: accessType, event: 'access_attempt' });
                try {
                    const response = await page.goto(modifiedLink, { waitUntil: "domcontentloaded", timeout: 15000 });
                    responseStatus = response?.status() ?? null;
                    if (response && response.ok()) {
                        finalLink = page.url(); // Update final link on success
                        this.logger.info({ ...linkLogContext, url: modifiedLink, status: responseStatus, finalUrl: finalLink, linkType: accessType, event: 'access_success' });
                        accessSuccess = true;
                    } else {
                        accessError = new Error(`HTTP ${responseStatus} accessing modified link`);
                        this.logger.warn({ ...linkLogContext, url: modifiedLink, status: responseStatus, linkType: accessType, event: 'access_failed' }, "Modified link failed (HTTP status), reverting");
                        useModifiedLink = false; // Revert flag
                        finalLink = link; // Revert finalLink
                    }
                } catch (error: unknown) {
                    accessError = error;
                    this.logger.warn({ ...linkLogContext, url: modifiedLink, linkType: accessType, err: error, event: 'access_failed' }, "Error accessing modified link (exception), will try original");
                    useModifiedLink = false; // Revert flag
                    finalLink = link; // Revert finalLink
                }
            }

            // Try original link if needed
            if (!accessSuccess) {
                accessType = 'original';
                this.logger.info({ ...linkLogContext, url: link, linkType: accessType, event: 'access_attempt' });
                try {
                    const response = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
                    responseStatus = response?.status() ?? null;
                    if (response && response.ok()) {
                        finalLink = page.url(); // Update final link on success
                        this.logger.info({ ...linkLogContext, url: link, status: responseStatus, finalUrl: finalLink, linkType: accessType, event: 'access_success' });
                        accessSuccess = true;
                    } else {
                        accessError = new Error(`HTTP ${responseStatus} accessing original link`);
                        this.logger.error({ ...linkLogContext, url: link, status: responseStatus, linkType: accessType, event: 'access_failed' }, `Original link failed (HTTP ${responseStatus}), skipping link.`);
                        // No need to return here yet, failure handled below
                    }
                } catch (error: unknown) {
                    accessError = error;
                    this.logger.error({ ...linkLogContext, url: link, linkType: accessType, err: error, event: 'access_failed' }, "Error accessing original link (exception), skipping link");
                    // No need to return here yet, failure handled below
                }
            }

            // If access failed completely, return null
            if (!accessSuccess) {
                this.logger.error({ ...linkLogContext, err: accessError, finalStatus: responseStatus, event: 'processing_failed_skip' }, "Failed to access link.");
                return null; // Indicate failure for this link
            }

            // --- Access Success, Proceed ---
            this.logger.info({ ...linkLogContext, finalUrl: finalLink, event: 'access_final_success' });

            // Handle redirects (simple check and wait)
            let intendedUrl = useModifiedLink ? modifiedLink : link;
            if (page.url() !== intendedUrl && page.url() !== finalLink) {
                const redirectedFrom = finalLink; // Store the previous finalLink
                finalLink = page.url(); // Update finalLink again after potential redirect
                this.logger.info({ ...linkLogContext, fromUrl: redirectedFrom, toUrl: finalLink, event: 'redirect_detected' });
                try {
                    await page.waitForLoadState('load', { timeout: 15000 });
                    this.logger.debug({ ...linkLogContext, url: finalLink, event: 'redirect_wait_success' });
                } catch (err: unknown) {
                    this.logger.warn({ ...linkLogContext, url: finalLink, err: err, event: 'redirect_wait_failed' });
                }
            }

            // Fetch content using utility function
            const fetchContext = { ...linkLogContext, url: finalLink, event_group: 'content_extraction' };
            this.logger.debug({ ...fetchContext, event: 'content_fetch_start' });
            const htmlContent = await page.content();
            ;
            this.logger.debug({ ...fetchContext, event: 'content_fetch_success', htmlLength: htmlContent?.length });

            // Clean DOM using utility function
            this.logger.debug({ ...fetchContext, event: 'dom_clean_start' });
            const document = cleanDOM(htmlContent);
            if (!document || !document.body) {
                this.logger.warn({ ...fetchContext, event: 'dom_clean_failed' }, "Cleaned DOM or body is null, skipping link");
                return null;
            }
            this.logger.debug({ ...fetchContext, event: 'dom_clean_success' });

            // Traverse Nodes & Save Text using utility functions
            this.logger.debug({ ...fetchContext, event: 'node_traverse_start' });
            // Assuming traverseNodes and removeExtraEmptyLines are correct
            let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, year);
            fullText = removeExtraEmptyLines(fullText);
            this.logger.debug({ ...fetchContext, textLength: fullText.length, event: 'node_traverse_success' });

            // Save initial text using utility function
            const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
            // Use configured tempDir
            const textPath = await this.fileSystemService.saveTemporaryFile(fullText, `${safeAcronym}_${linkIndex}_initial`);
            this.logger.debug({ ...fetchContext, filePath: textPath, fileType: 'initial_text', event: 'initial_text_saved' });

            // Acronym handling using utility function
            const acronym_index = `${conference.Acronym}_${linkIndex}`;
            const adjustedAcronym = await addAcronymSafely(existingAcronyms, acronym_index);
            let acronym_no_index = adjustedAcronym.replace(/_\d+$/, '');

            // Create Batch Entry
            const batchEntry: BatchEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: acronym_no_index,
                conferenceIndex: String(linkIndex),
                conferenceLink: finalLink, // Use the final URL after potential redirects
                conferenceTextPath: textPath,
                cfpLink: "", impLink: "", // To be filled later
                // Other paths will be filled later
            };

            this.logger.info({ ...linkLogContext, finalUrl: finalLink, textPath, adjustedAcronym, event: 'processing_success' });
            return batchEntry;

        } catch (error: unknown) {
            this.logger.error({ ...linkLogContext, url: link, err: error, event: 'processing_unhandled_error' }, "Unhandled error processing link");
            return null; // Indicate failure for this link
        }
    }


    // --- Private Helpers for UPDATE Flow ---

    private async _processMainLinkUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        baseLogContext: BatchProcessingLogContext
    ): Promise<{ finalUrl: string | null; textPath: string | null }> {
        const url = conference.mainLink;
        const logContext = { ...baseLogContext, linkType: 'main', url, function: '_processMainLinkUpdate' };
        this.logger.info({ ...logContext, event: 'process_start' });
        let finalUrl: string | null = url;
        let textPath: string | null = null;


        if (!url) {
            this.logger.error({ event: 'missing_url' });
            return { finalUrl: null, textPath: null };
        }

        try {
            // Sử dụng page được cung cấp
            if (page.isClosed()) {
                this.logger.warn({ event: 'page_already_closed_before_goto' });
                throw new Error('Page was closed before navigation could start.');
            }
            const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
            finalUrl = page.url();
            this.logger.info({ ...logContext, finalUrl, status: response?.status(), event: 'nav_success' });

            const htmlContent = await page.content();
            const document = cleanDOM(htmlContent); // Uses DOM util

            if (document?.body) {
                let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, this.year2); // Uses DOM util
                fullText = removeExtraEmptyLines(fullText); // Uses DOM util
                if (fullText.trim()) {
                    const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
                    const baseName = `${safeAcronym}_main_update_${baseLogContext.batchIndex}`; // Add batch index
                    textPath = await this.fileSystemService.saveTemporaryFile(fullText.trim(), baseName);
                    if (textPath) { this.logger.info({ ...logContext, path: textPath, event: 'content_saved' }); }
                    else { this.logger.warn({ ...logContext, event: 'content_save_failed' }); }
                } else { this.logger.warn({ ...logContext, event: 'content_empty' }); }
            } else { this.logger.warn({ ...logContext, finalUrl, event: 'dom_invalid' }); }
        } catch (error: unknown) {
            this.logger.error({ ...logContext, finalUrl, err: error, event: 'process_failed' });
            // Append to error log file
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error accessing/processing mainLink ${url} (final: ${finalUrl}): ${error instanceof Error ? error.message : String(error)} for ${conference.Acronym}\n`;
            this.fileSystemService.appendFile(this.errorLogPath, logMessage).catch(e => console.error("Failed to write error log:", e));
            textPath = null; // Ensure null on error
        }
        return { finalUrl: finalUrl ?? null, textPath };
    }

    private async _processCfpLinkUpdate(
        page: Page | null, // Can be null for PDF
        conference: ConferenceUpdateData,
        baseLogContext: BatchProcessingLogContext
    ): Promise<string | null> {
        const url = conference.cfpLink;
        // --- Add explicit type annotation here ---
        const logContext: BatchProcessingLogContext = {
            ...baseLogContext,
            linkType: 'cfp', // 'cfp' is a valid literal for BatchProcessingLogContext['linkType']
            url,
            function: '_processCfpLinkUpdate'
        };
        let textPath: string | null = null;



        if (!url || url.trim().toLowerCase() === "none") {
            this.logger.debug({ event: 'skipped_no_url' });
            return null;
        }
        this.logger.info({ ...logContext, event: 'process_start' });

        try {
            const isPdf = url.toLowerCase().endsWith('.pdf');
            if (!isPdf && (!page || page.isClosed())) {
                this.logger.warn({ ...logContext, event: 'page_null_or_closed_for_html' });
                throw new Error('Page required for non-PDF cfp link but was null or closed.');
            }
            // Now passing logContext is type-safe
            const textContent = await this._extractTextFromUrl(page, url, conference.Acronym, true, logContext);

            if (textContent) {
                const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_cfp_update_${baseLogContext.batchIndex}`;
                textPath = await this.fileSystemService.saveTemporaryFile(textContent, baseName);
                if (textPath) { this.logger.info({ ...logContext, path: textPath, event: 'success' }); }
                else { this.logger.warn({ ...logContext, event: 'failed_to_save_extracted_content' }); }
            } else { this.logger.warn({ ...logContext, event: 'failed_extraction_returned_empty' }); }
        } catch (error: unknown) {
            this.logger.error({ ...logContext, err: error, event: 'failed_exception' });
            textPath = null;
        }
        return textPath;
    }

    private async _processImpLinkUpdate(
        page: Page | null, // Can be null for PDF
        conference: ConferenceUpdateData,
        baseLogContext: BatchProcessingLogContext,
        cfpResultPath: string | null // Pass cfp result to avoid re-processing if same link
    ): Promise<string | null> {
        const url = conference.impLink;
        // --- Add explicit type annotation here ---
        const logContext: BatchProcessingLogContext = {
            ...baseLogContext,
            linkType: 'imp', // 'imp' is a valid literal for BatchProcessingLogContext['linkType']
            url,
            function: '_processImpLinkUpdate'
        };
        let textPath: string | null = null;

        if (!url || url.trim().toLowerCase() === "none") {
            this.logger.debug({ event: 'skipped_no_url' });
            return null;
        }

        // Optimization: If imp link is same as cfp link, return cfp result
        if (url === conference.cfpLink) {
            this.logger.info({ ...logContext, event: 'skipped_same_as_cfp', cfpPath: cfpResultPath });
            return ""; // Return the path obtained from cfp processing
            // Nếu trùng thì không cần lặp lại, gây dư thừa
        }

        this.logger.info({ ...logContext, event: 'process_start' });
        try {
            const isPdf = url.toLowerCase().endsWith('.pdf');
            if (!isPdf && (!page || page.isClosed())) {
                this.logger.warn({ ...logContext, event: 'page_null_or_closed_for_html' });
                throw new Error('Page required for non-PDF imp link but was null or closed.');
            }

            // Now passing logContext is type-safe
            const textContent = await this._extractTextFromUrl(page, url, conference.Acronym, false, logContext);

            if (textContent) {
                const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_imp_update_${baseLogContext.batchIndex}`;
                textPath = await this.fileSystemService.saveTemporaryFile(textContent, baseName);
                if (textPath) { this.logger.info({ ...logContext, path: textPath, event: 'success' }); }
                else { this.logger.warn({ ...logContext, event: 'failed_to_save_extracted_content' }); }
            } else { this.logger.warn({ ...logContext, event: 'failed_extraction_returned_empty' }); }
        } catch (error: unknown) {
            this.logger.error({ ...logContext, err: error, event: 'failed_exception' });
            textPath = null;
        }
        return textPath;
    }

    /**
     * Private method encapsulating the logic of the original `updateBatchToFile`.
     * Called by `processConferenceUpdate`.
     */
    private async _executeAndUpdateBatch(
        batchInput: BatchUpdateEntry,
        batchIndex: number,
        parentLogContext: BatchProcessingLogContext
    ): Promise<boolean> {
        const logContext = { ...parentLogContext, function: '_executeAndUpdateBatch' };
        this.logger.info({ ...logContext, event: 'start' });

        try {
            const safeConferenceAcronym = batchInput.conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');

            // 1. Ensure Directories (optional here if ensured earlier)
            await this.ensureDirectories([this.batchesDir, this.finalOutputPath]); // Uses private helper

            // 2. Read Content Files
            const readContentContext = { ...logContext, event_group: 'read_update_content' };
            this.logger.debug({ ...readContentContext, event: 'start' });
            const content = await this.readBatchContentFiles(batchInput, logContext); // Uses private helper
            this.logger.debug({ ...readContentContext, event: 'end' });

            // 3. Aggregate Content for APIs
            const aggregateContext = { ...logContext, event_group: 'aggregate_update_content' };
            const contentSendToAPI = this.aggregateContentForApi(batchInput.conferenceTitle, batchInput.conferenceAcronym, content, aggregateContext); // Uses private helper

            // Write intermediate update file (async, non-critical)
            const fileUpdateName = `${safeConferenceAcronym}_update_${batchIndex}.txt`;
            const fileUpdatePath = path.join(this.batchesDir, fileUpdateName); // Use configured path
            const fileUpdatePromise = fs.promises.writeFile(fileUpdatePath, contentSendToAPI, "utf8")
                .then(() => this.logger.debug({ ...logContext, filePath: fileUpdatePath, fileType: 'update_intermediate', event: 'write_intermediate_success' }))
                .catch(writeError => this.logger.error({ ...logContext, filePath: fileUpdatePath, fileType: 'update_intermediate', err: writeError, event: 'write_intermediate_failed' }));

            // 4. Execute Parallel Extract/cfp APIs
            // Pass isUpdate=true
            const apiResults = await this.executeParallelExtractCfpApis(
                contentSendToAPI, batchIndex, batchInput.conferenceTitle, batchInput.conferenceAcronym, safeConferenceAcronym, true, logContext
            );

            // Wait for non-critical intermediate write
            await fileUpdatePromise;
            this.logger.debug({ ...logContext, event: 'intermediate_writes_settled' });

            // 5. Prepare and Append Final Record
            const finalRecord: BatchUpdateEntry = {
                ...batchInput,
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpMetaData: apiResults.cfpMetaData,
            };
            await this.appendFinalRecord(finalRecord, logContext); // Uses private helper

            this.logger.info({ ...logContext, event: 'finish_success' });
            return true;

        } catch (error: unknown) {
            this.logger.error({ ...logContext, err: error, event: 'finish_failed' });
            return false;
        }
    }

    private async _closePages(pages: Page[], logContext: BatchProcessingLogContext): Promise<void> {
        this.logger.debug({ ...logContext, count: pages.length, event: 'closing_pages' });
        for (const p of pages) {
            if (p && !p.isClosed()) {
                await p.close().catch(err => this.logger.error({ ...logContext, err: err, event: 'page_close_failed' }));
            }
        }
        this.logger.debug({ ...logContext, event: 'pages_closed' });
    }


    // --- Public Method for UPDATE Flow ---

    /**
     * Orchestrates the processing of an UPDATE conference entry.
     * Manages Playwright pages, processes links in parallel, and calls internal batch processing.
     * Called by HtmlPersistenceService.
     */
    public async processConferenceUpdate(
        browserContext: BrowserContext, // Pass context instead of creating pages here
        conference: ConferenceUpdateData,
        batchIndexRef: { current: number } // Use the shared mutable ref
    ): Promise<boolean> {
        const currentBatchIndex = batchIndexRef.current; // Capture index before incrementing
        const baseLogContext: BatchProcessingLogContext = {
            batchIndex: currentBatchIndex,
            conferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            function: 'processConferenceUpdate'
        };
        this.logger.info({ ...baseLogContext, event: 'start' });

        const pages: Page[] = []; // Track pages to close

        try {
            // --- Create pages needed for parallel navigation ---
            let mainPage: Page | null = null;
            let cfpPage: Page | null = null;
            let impPage: Page | null = null;

            if (conference.mainLink) {
                mainPage = await browserContext.newPage();
                pages.push(mainPage);
                this.logger.info({ ...baseLogContext, event: 'main_page_created' });
            } else {
                this.logger.error({ ...baseLogContext, event: 'main_page_creation_skipped_no_link' });
                // No need to close pages here as none were created yet
                return false; // Cannot proceed without main link
            }

            const cfpLink = conference.cfpLink;
            const needsCfpNav = cfpLink && !cfpLink.toLowerCase().endsWith('.pdf') && cfpLink.trim().toLowerCase() !== 'none';
            if (needsCfpNav) {
                cfpPage = await browserContext.newPage();
                pages.push(cfpPage);
                this.logger.info({ ...baseLogContext, event: 'cfp_page_created' });
            } else {
                this.logger.info({ ...baseLogContext, event: 'cfp_page_creation_skipped', reason: !cfpLink ? 'no link' : cfpLink.toLowerCase().endsWith('.pdf') ? 'pdf link' : 'none link' });
            }

            const impLink = conference.impLink;
            const needsImpNav = impLink && !impLink.toLowerCase().endsWith('.pdf') && impLink.trim().toLowerCase() !== 'none';
            // Determine if IMP is the *same link* as a CFP link that *required navigation*
            const isImpSameAsNavigableCfp = needsImpNav && needsCfpNav && impLink === cfpLink;

            // Only create impPage if needed AND it's not the same page we already created for CFP
            if (needsImpNav && !isImpSameAsNavigableCfp) {
                impPage = await browserContext.newPage();
                pages.push(impPage);
                this.logger.info({ ...baseLogContext, event: 'imp_page_created' });
            } else if (needsImpNav && isImpSameAsNavigableCfp) {
                this.logger.info({ ...baseLogContext, event: 'imp_page_creation_skipped', reason: 'same as navigable cfp link' });
            } else {
                this.logger.info({ ...baseLogContext, event: 'imp_page_creation_skipped', reason: !impLink ? 'no link' : impLink.toLowerCase().endsWith('.pdf') ? 'pdf link' : 'none link' });
            }

            // --- Execute link processing in parallel ---
            this.logger.info({ ...baseLogContext, event: 'parallel_fetch_start' });

            type MainResult = { finalUrl: string | null; textPath: string | null };
            type TextPathResult = string | null;


            // Define the promises with more specific types if possible, otherwise use any
            // Using specific types helps catch errors earlier but requires the functions
            // _process...LinkUpdate to actually return the declared types.
            const promises: [
                Promise<MainResult>, // Main link promise (always present)
                Promise<TextPathResult>, // CFP link promise (conditionally processed)
                Promise<TextPathResult>? // IMP link promise (optional)
            ] = [
                    this._processMainLinkUpdate(mainPage, conference, baseLogContext),
                    this._processCfpLinkUpdate(cfpPage, conference, baseLogContext) // Pass page (can be null)
                ];

            let impPromiseIndex = -1; // Track index if imp promise is added
            // Only add imp promise if it needs navigation AND is NOT the same as the navigable CFP
            if (needsImpNav && !isImpSameAsNavigableCfp) {
                promises.push(this._processImpLinkUpdate(impPage, conference, baseLogContext, null)); // Pass impPage (can be null)
                impPromiseIndex = 2; // imp promise is at index 2
            }

            // Use Promise.allSettled with the typed promises array
            const results = await Promise.allSettled(promises);
            this.logger.info({ ...baseLogContext, event: 'parallel_fetch_settled', count: results.length });

            // --- Process results ---
            let mainResult: MainResult = { finalUrl: null, textPath: null };
            let cfpTextPath: TextPathResult = null;
            let impTextPath: TextPathResult = null;

            // Process Main Result (Index 0)
            const mainPromiseResult = results[0];
            if (mainPromiseResult.status === 'fulfilled') {
                // Type Guard: Inside this block, mainPromiseResult is PromiseFulfilledResult<MainResult>
                mainResult = mainPromiseResult.value; // No 'as' needed if promises array is typed correctly
                this.logger.info({ ...baseLogContext, event: 'main_link_processed', status: 'success', path: mainResult.textPath, finalUrl: mainResult.finalUrl });
            } else {
                // Type Guard: Inside this block, mainPromiseResult is PromiseRejectedResult
                this.logger.error({ ...baseLogContext, event: 'main_link_processed_failed', err: mainPromiseResult.reason });
            }

            // Process CFP Result (Index 1)
            const cfpPromiseResult = results[1];
            if (cfpPromiseResult.status === 'fulfilled') {
                // Type Guard: Inside this block, cfpPromiseResult is PromiseFulfilledResult<TextPathResult>
                cfpTextPath = cfpPromiseResult.value; // No 'as' needed
                this.logger.info({ ...baseLogContext, event: 'cfp_link_processed', status: 'success', path: cfpTextPath });
            } else {
                // Type Guard: Inside this block, cfpPromiseResult is PromiseRejectedResult
                this.logger.error({ ...baseLogContext, event: 'cfp_link_processed_failed', err: cfpPromiseResult.reason });
            }

            // Handle imp result based on whether it was processed separately or is same as cfp
            if (isImpSameAsNavigableCfp) {
                // If IMP link was same as a navigable CFP link, use the CFP result
                impTextPath = cfpTextPath; // Assign cfp result to imp
                this.logger.info({ ...baseLogContext, event: 'imp_link_result_assigned_from_cfp', path: impTextPath });
            } else if (impPromiseIndex !== -1) {
                // If IMP link was processed separately (i.e., it needed navigation and wasn't the same as CFP)

                const impPromiseResult = results[impPromiseIndex];

                if (impPromiseResult) {
                    if (impPromiseResult.status === 'fulfilled') {
                        // Type Guard: Inside this block, TS infers impPromiseResult as potentially PromiseFulfilledResult<MainResult | TextPathResult>
                        // We assert that the value is actually TextPathResult based on our logic.
                        impTextPath = impPromiseResult.value as TextPathResult; // <--- Add 'as TextPathResult'
                        this.logger.info({ ...baseLogContext, event: 'imp_link_processed', status: 'success', path: impTextPath });
                    } else {
                        // Type Guard: Inside this block, impPromiseResult is PromiseRejectedResult
                        this.logger.error({ ...baseLogContext, event: 'imp_link_processed_failed', err: impPromiseResult.reason });
                    }
                } else {
                    this.logger.error({ ...baseLogContext, event: 'imp_result_unexpectedly_missing', index: impPromiseIndex });
                }
            }
            // Else: imp was PDF/None OR same as a non-navigable CFP OR had no link, so impTextPath remains null (or its initial value)

            // --- Critical Check ---
            if (!mainResult.textPath) {
                this.logger.error({ ...baseLogContext, event: 'abort_no_main_text' }, `Skipping update batch processing as main content fetch/save failed.`);
                // Ensure pages are closed before returning
                await this._closePages(pages, baseLogContext);
                return false;
            }

            // --- Prepare and execute the internal batch update logic ---
            const batchData: BatchUpdateEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym,
                conferenceTextPath: mainResult.textPath, // Guaranteed non-null here by the check above
                cfpTextPath: cfpTextPath,
                impTextPath: impTextPath,
            };

            // Increment shared index AFTER capturing current value and BEFORE calling the final processing step
            batchIndexRef.current++;
            this.logger.info({ ...baseLogContext, batchIndex: currentBatchIndex, event: 'calling_internal_update_processor' });

            // Call the private method that handles API calls and final append
            const updateSuccess = await this._executeAndUpdateBatch(batchData, currentBatchIndex, baseLogContext);

            this.logger.info({ ...baseLogContext, event: 'finish', success: updateSuccess });
            return updateSuccess;

        } catch (error: unknown) {
            // Log with the original batch index
            this.logger.error({ ...baseLogContext, err: error, event: 'finish_unhandled_error' });
            return false;
        } finally {
            // Ensure ALL pages created in this scope are closed
            // Log with the original batch index
            await this._closePages(pages, baseLogContext);
        }
    }


    // --- Public Method for SAVE Flow ---

    /**
     * Orchestrates the SAVE flow for a conference.
     */
    public async processConferenceSave(
        browserContext: BrowserContext,
        conference: ConferenceData,
        links: string[],
        batchIndexRef: { current: number },
        existingAcronyms: Set<string>
    ): Promise<boolean> { // Returns boolean indicating initiation success
        const year = this.configService.config.YEAR2;

        const baseLogContext: BatchProcessingLogContext = {
            batchIndex: batchIndexRef.current,
            conferenceAcronym: conference.Acronym,
            conferenceTitle: conference.Title,
            function: 'saveHTMLContent'
        };
        this.logger.info({ ...baseLogContext, linkCount: links.length, year, event: 'start' });

        if (!links || links.length === 0) {
            this.logger.warn({ ...baseLogContext, event: 'skipped_no_links' }, "Called with empty links array.");
            return false; // Nothing to process
        }

        let page: Page | null = null;
        const batch: BatchEntry[] = [];
        let finalAdjustedAcronym = ""; // To store the last adjusted acronym for the batch call
        let linkProcessingSuccessCount = 0;
        let linkProcessingFailedCount = 0;

        try {
            // Create ONE page for all links in this conference
            page = await browserContext.newPage();
            this.logger.info({ ...baseLogContext, event: 'page_created' });

            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                try {
                    // Call the private method _processSingleLink
                    const batchEntry = await this._processSingleLink(
                        page, link, i, conference, year, existingAcronyms, baseLogContext // Pass base context
                    );

                    if (batchEntry) {
                        batch.push(batchEntry);
                        finalAdjustedAcronym = `${batchEntry.conferenceAcronym}_${batchEntry.conferenceIndex}`;
                        linkProcessingSuccessCount++;
                    } else {
                        linkProcessingFailedCount++;
                    }
                } catch (linkError: unknown) {
                    linkProcessingFailedCount++;
                    this.logger.error({ ...baseLogContext, link, linkIndex: i, err: linkError, event: 'link_processing_unexpected_error' }, "Unexpected error during single link processing loop");
                }
            } // End for loop links

            // --- Create Batch Task if any links succeeded ---
            if (batch.length > 0) {
                const currentBatchIndex = batchIndexRef.current;
                batchIndexRef.current++; // Increment for the next conference/batch
                this.logger.info({
                    ...baseLogContext, // Use base context
                    batchIndex: currentBatchIndex, // Log the actual index used
                    entries: batch.length,
                    successCount: linkProcessingSuccessCount,
                    failedCount: linkProcessingFailedCount,
                    event: 'batch_task_initiate'
                }, `Initiating batch task ${currentBatchIndex}`);

                // Call _executeAndSaveBatch asynchronously and track its promise internally
                const batchPromise = this._executeAndSaveBatch(batch, currentBatchIndex, finalAdjustedAcronym, browserContext);

                // Add the promise to the tracking set
                this.activeBatchSaves.add(batchPromise);
                this.logger.debug({ batchIndex: currentBatchIndex, activeCount: this.activeBatchSaves.size, event: 'batch_task_added_to_tracker' });

                // Remove the promise from the set when it settles (regardless of outcome)
                batchPromise.finally(() => {
                    this.activeBatchSaves.delete(batchPromise);
                    this.logger.debug({ batchIndex: currentBatchIndex, activeCount: this.activeBatchSaves.size, event: 'batch_task_removed_from_tracker' });
                });

                this.logger.info({ ...baseLogContext, batchIndex: currentBatchIndex, event: 'batch_task_initiated_async' });
            } else {
                this.logger.warn({
                    ...baseLogContext, // Use base context
                    successCount: linkProcessingSuccessCount,
                    failedCount: linkProcessingFailedCount,
                    event: 'batch_creation_skipped_empty'
                }, "Batch is empty after processing all links. No batch task created.");
            }

            this.logger.info({ ...baseLogContext, event: 'initiation_finish_success' });
            return true; // Indicate successful initiation

        } catch (error: unknown) {
            this.logger.error({ ...baseLogContext, err: error, event: 'initiation_finish_unhandled_error' });
            return false; // Indicate failure during initiation
        } finally {
            // Close the single page used for this conference
            if (page && !page.isClosed()) {
                this.logger.debug({ ...baseLogContext, event: 'page_closing' });
                await page.close().catch(err => this.logger.error({ ...baseLogContext, err: err, event: 'page_close_failed' }, "Error closing page"));
            }
        }
    };

    /**
    * Saves a batch for the SAVE flow (determine links, call APIs, append record). Runs asynchronously.
    * Calls _processDetermineApiResponse internally.
    */
    public async _executeAndSaveBatch(
        batch: BatchEntry[],
        batchIndex: number,
        adjustedAcronym: string,
        browserContext: BrowserContext
    ): Promise<boolean> { // Returns boolean indicating success/failure of this specific batch
        // Use the first entry for primary context, ensure it exists
        if (!batch || batch.length === 0 || !batch[0]?.conferenceAcronym || !batch[0]?.conferenceTitle) {
            this.logger.warn({ batchIndex, function: '_executeAndSaveBatch', event: 'invalid_input' }, "Called with invalid or empty batch. Skipping.");
            return false;
        }
        const primaryEntry = batch[0];
        const baseLogContext: BatchProcessingLogContext = {
            batchIndex,
            conferenceAcronym: primaryEntry.conferenceAcronym,
            conferenceTitle: primaryEntry.conferenceTitle,
            function: '_executeAndSaveBatch'
        };
        this.logger.info({ ...baseLogContext, event: 'start', entryCount: batch.length });

        const safeConferenceAcronym = primaryEntry.conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');


        try {
            // 1. Ensure Directories (Still good practice for base dirs, but less critical for the immediate write)
            // You might simplify this if FileSystemService.writeFile handles it,
            // but keeping it for the final output path's directory is fine.
            await this.ensureDirectories([this.batchesDir, this.finalOutputPath]);
            this.logger.debug({ ...baseLogContext, event: 'directories_ensured', paths: [this.batchesDir, path.dirname(this.finalOutputPath)] });

            // 2. Aggregate Content for determine_links_api
            this.logger.debug({ ...baseLogContext, event: 'aggregate_content_start', purpose: 'determine_api' });
            let batchContentParts: string[] = [];
            const readPromises = batch.map(async (entry, i) => {
                if (!entry.conferenceTextPath) {
                    this.logger.error({ ...baseLogContext, entryIndex: i, link: entry.conferenceLink, event: 'read_content_skipped_no_path', aggregationPurpose: 'determine_api' });
                    return { index: i, content: `${i + 1}. ERROR: Missing text path for ${entry.conferenceLink}\n\n` };
                }
                try {
                    const text = await this.fileSystemService.readFileContent(entry.conferenceTextPath); // Use util
                    const linkIdentifier = `${entry.conferenceAcronym}_${entry.conferenceIndex}`;
                    // Adjust formatting based on prompt needs
                    const formattedText = `Source Link [${i + 1}]: ${entry.conferenceLink}\nContent [${i + 1}]:\n${text.trim()}`;
                    return { index: i, content: formattedText + "\n\n---\n\n" }; // Separator
                } catch (readError: unknown) {
                    this.logger.error({ ...baseLogContext, err: readError, filePath: entry.conferenceTextPath, entryIndex: i, event: 'read_content_failed', aggregationPurpose: 'determine_api' });
                    return { index: i, content: `Source Link [${i + 1}]: ${entry.conferenceLink}\nContent [${i + 1}]:\nERROR READING CONTENT\n\n---\n\n` };
                }
            });
            const readResults = await Promise.all(readPromises);
            readResults.sort((a, b) => a.index - b.index); // Ensure order
            batchContentParts = readResults.map(r => r.content);
            // Prepend conference info
            const batchContentForDetermine = `Conference Info:\nTitle: ${primaryEntry.conferenceTitle}\nAcronym: ${primaryEntry.conferenceAcronym}\n\nCandidate Website Contents:\n${batchContentParts.join("")}`;
            this.logger.debug({ ...baseLogContext, charCount: batchContentForDetermine.length, event: 'aggregate_content_end', purpose: 'determine_api' });

            // --- Write intermediate _full_links.txt using FileSystemService ---
            const fileFullLinksName = `${safeConferenceAcronym}_full_links.txt`;
            const fileFullLinksPath = path.join(this.batchesDir, fileFullLinksName);
            // Use await directly if sequential, or manage promise if truly parallel needed
            const writeFullLinksPromise = this.fileSystemService.writeFile(fileFullLinksPath, batchContentForDetermine)
                .then(() => this.logger.debug({ ...baseLogContext, filePath: fileFullLinksPath, fileType: 'full_links', event: 'write_intermediate_success' }))
                .catch(writeError => {
                    // Log error, but maybe don't make it fatal for intermediate files
                    this.logger.error({ ...baseLogContext, filePath: fileFullLinksPath, fileType: 'full_links', err: writeError, event: 'write_intermediate_failed' });
                    // Potentially throw if this file IS critical: throw writeError;
                });

            // 3. Call determine_links_api via GeminiApiService
            let determineLinksResponse: ApiResponse;
            let determineResponseTextPath: string | undefined;
            const determineApiContext = { ...baseLogContext, apiType: this.geminiApiService.API_TYPE_DETERMINE, apiCallNumber: 1 };
            const determineApiParams: GeminiApiParams = {
                batch: batchContentForDetermine,
                batchIndex: batchIndex,
                title: primaryEntry.conferenceTitle,
                acronym: primaryEntry.conferenceAcronym,
            };
            try {
                this.logger.info({ ...determineApiContext, inputLength: batchContentForDetermine.length, event: 'api_call_start' });
                determineLinksResponse = await this.geminiApiService.determineLinks(determineApiParams);
                // Save response text using FileSystemService
                const determineResponseText = determineLinksResponse.responseText || "";
                const determineResponseTextPath = await this.fileSystemService.saveTemporaryFile(determineResponseText, `${safeConferenceAcronym}_determine_response_${batchIndex}`);
                primaryEntry.determineResponseTextPath = determineResponseTextPath;
                primaryEntry.determineMetaData = determineLinksResponse.metaData;
                this.logger.info({ ...determineApiContext, responseLength: determineResponseText.length, filePath: determineResponseTextPath, fileType: 'determine_response', event: 'api_call_end', success: true });
            } catch (determineLinksError: unknown) {
                // GeminiApiService should handle retries internally and might return a default response
                // Log the error here as the final outcome for this step
                this.logger.error({ ...determineApiContext, err: determineLinksError, event: 'api_call_failed' }, "Determine links API call failed after retries (or threw unexpected error)");
                await writeFullLinksPromise; // Wait for non-critical write
                // Decide if failure is critical. If determine fails, we can't proceed.
                throw new Error(`Determine links API failed for batch ${batchIndex}: ${determineLinksError}`);
            }

            // 4. Process determine_links_api response using utility function
            const processDetermineContext = { ...baseLogContext, event_group: 'process_determine' };
            this.logger.info({ ...processDetermineContext, responseLength: determineLinksResponse.responseText?.length ?? 0, event: 'start' });
            let mainLinkBatchResult: BatchEntry[] | null = null;
            try {
                // Pass the logger instance from this service
                // Assuming processDetermineLinksResponse is updated to accept logger if needed, or uses its own
                mainLinkBatchResult = await this._processDetermineApiResponse(
                    determineLinksResponse.responseText || "", batch, batchIndex, browserContext, baseLogContext
                );
            } catch (processError: unknown) {
                this.logger.error({ ...processDetermineContext, err: processError, event: 'call_failed' }, "Error calling processDetermineLinksResponse");
                throw processError; // Re-throw critical error
            }

            // Validate the result
            if (!mainLinkBatchResult || mainLinkBatchResult.length === 0 || !mainLinkBatchResult[0] || mainLinkBatchResult[0].conferenceLink === "None" || !mainLinkBatchResult[0].conferenceTextPath) {
                this.logger.error({ ...processDetermineContext, mainLinkResult: mainLinkBatchResult?.[0]?.conferenceLink, mainTextPath: mainLinkBatchResult?.[0]?.conferenceTextPath, event: 'invalid_result' }, "Main link/text path is invalid after processing determine response.");
                await writeFullLinksPromise;
                return false; // Indicate failure for this batch
            }
            const mainEntry = mainLinkBatchResult[0]; // Holds correct paths/links
            this.logger.info({ ...processDetermineContext, finalMainLink: mainEntry.conferenceLink, mainTextPath: mainEntry.conferenceTextPath, cfpPath: mainEntry.cfpTextPath, impPath: mainEntry.impTextPath, event: 'success' });

            // 5. Read Content Files based on determined links (using private helper)
            const readContentContext = { ...baseLogContext, event_group: 'read_determined_content' };
            this.logger.debug({ ...readContentContext, event: 'start' });
            const content = await this.readBatchContentFiles(mainEntry, readContentContext);
            this.logger.debug({ ...readContentContext, event: 'end' });

            // 6. Aggregate Content for Extract/cfp APIs (using private helper)
            // Explicitly type the context object here
            const aggregateContext: BatchProcessingLogContext = { // <<< EXPLICIT TYPE
                ...baseLogContext, // Spread the base context first
                event_group: 'aggregate_for_extract_cfp',
                aggregationPurpose: 'extract_cfp_api' // <<< This value is valid for the type
            };
            const contentSendToAPI = this.aggregateContentForApi(mainEntry.conferenceTitle, mainEntry.conferenceAcronym, content, aggregateContext); // <<< Now passes type checking

            // Write intermediate _main_link.txt (async, non-critical)
            const fileMainLinkName = `${safeConferenceAcronym}_main_link.txt`;
            const fileMainLinkPath = path.join(this.batchesDir, fileMainLinkName); // Use configured path
            const fileMainLinkPromise = fs.promises.writeFile(fileMainLinkPath, contentSendToAPI, "utf8")
                .then(() => this.logger.debug({ ...aggregateContext, filePath: fileMainLinkPath, fileType: 'main_link', event: 'write_intermediate_success' }))
                .catch(writeError => this.logger.error({ ...aggregateContext, filePath: fileMainLinkPath, fileType: 'main_link', err: writeError, event: 'write_intermediate_failed' }));

            // 7. Execute Parallel Extract/cfp APIs (using private helper and GeminiApiService)
            const apiResults = await this.executeParallelExtractCfpApis(
                contentSendToAPI, batchIndex, mainEntry.conferenceTitle, mainEntry.conferenceAcronym, safeConferenceAcronym, false, baseLogContext // Pass base context
            );

            // Wait for non-critical intermediate writes
            await Promise.allSettled([writeFullLinksPromise, fileMainLinkPromise]);
            this.logger.debug({ ...baseLogContext, event: 'intermediate_writes_settled' });

            // 8. Prepare and Append Final Record (using private helper)
            const finalRecord: BatchEntry = {
                // Copy all relevant fields from the mainEntry
                ...mainEntry,
                // Add results from the parallel API calls
                extractResponseTextPath: apiResults.extractResponseTextPath,
                extractMetaData: apiResults.extractMetaData,
                cfpResponseTextPath: apiResults.cfpResponseTextPath,
                cfpMetaData: apiResults.cfpMetaData,
                // Ensure determine paths/metadata are included if not already on mainEntry
                determineResponseTextPath: primaryEntry.determineResponseTextPath, // Get from original primary entry
                determineMetaData: primaryEntry.determineMetaData, // Get from original primary entry
            };
            await this.appendFinalRecord(finalRecord, baseLogContext); // Pass base context

            this.logger.info({ ...baseLogContext, event: 'finish_success' }, "Finishing _executeAndSaveBatch successfully");
            return true; // Indicate success for this batch

        } catch (error: unknown) {
            this.logger.error({ ...baseLogContext, err: error, event: 'finish_failed' }, "Error occurred during _executeAndSaveBatch execution");
            return false; // Indicate failure for this batch
        }
    };

    /**
    * Waits for all currently active batch saving tasks (_executeAndSaveBatch) to complete.
    * Should be called by the orchestrator after all tasks have been queued.
    */
    public async awaitCompletion(): Promise<void> {
        const initialCount = this.activeBatchSaves.size;
        if (initialCount === 0) {
            this.logger.info("No active batch save operations to await.");
            return;
        }

        this.logger.info(`Waiting for ${initialCount} active batch save operation(s) to complete...`);

        // Create a snapshot of the current promises to await
        const promisesToAwait = [...this.activeBatchSaves];

        // Wait for all promises in the snapshot to settle
        await Promise.allSettled(promisesToAwait);

        // Check if new tasks were added while waiting (unlikely in the current flow but safe)
        if (this.activeBatchSaves.size > 0) {
            this.logger.warn(`Found ${this.activeBatchSaves.size} new/remaining active batch saves after initial await. Waiting again...`);
            // Recursively call or loop until empty
            await this.awaitCompletion(); // Simple recursion
        } else {
            this.logger.info(`All ${initialCount} active batch save operations have completed.`);
        }
    }

} // End BatchProcessingService class