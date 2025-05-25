// src/services/batchProcessingServiceChild/conferenceLinkProcessor.service.ts
import { Page } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { IPageContentExtractorService } from './pageContentExtractor.service';
import { ConfigService } from '../../config/config.service';
import { ConferenceData, ConferenceUpdateData, BatchEntry } from '../../types/crawl';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Interface for the service responsible for processing and managing conference links.
 * This includes fetching content, saving it to files, and handling different link types
 * (initial, main, CFP, Important Dates) in both SAVE and UPDATE flows.
 */
export interface IConferenceLinkProcessorService {
    /**
     * Processes an initial conference link in the SAVE flow (when first discovering links).
     * It attempts to access the link, potentially adjusts it for the current year,
     * extracts content, and saves it to a file, returning a `BatchEntry`.
     *
     * @param {Page} page - The Playwright Page object.
     * @param {string} link - The initial conference link to process.
     * @param {number} linkIndex - The index of this link within its batch.
     * @param {ConferenceData} conference - The conference data associated with this link.
     * @param {number} year - The target year for the conference.
     * @param {Logger} parentProcessLogger - The logger from the parent batch processing service.
     * @returns {Promise<BatchEntry | null>} A Promise that resolves to a `BatchEntry` on success, or `null` on failure.
     */
    processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number,
        parentProcessLogger: Logger
    ): Promise<BatchEntry | null>;

    /**
     * Processes the main conference link during an UPDATE flow.
     * It navigates to the link, extracts content, and saves it to a file.
     *
     * @param {Page} page - The Playwright Page object.
     * @param {ConferenceUpdateData} conference - The conference update data.
     * @param {Logger} parentLogger - The logger from the parent update process.
     * @returns {Promise<{ finalUrl: string | null; textPath: string | null }>} A Promise that resolves with the final URL and content file path, or `null` for either on failure.
     */
    processMainLinkForUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<{ finalUrl: string | null; textPath: string | null }>;

    /**
     * Processes the Call for Papers (CFP) link during an UPDATE flow.
     * It extracts content from the CFP link and saves it to a file.
     *
     * @param {Page | null} page - The Playwright Page object (can be null if already closed).
     * @param {ConferenceUpdateData} conference - The conference update data.
     * @param {Logger} parentLogger - The logger from the parent update process.
     * @returns {Promise<string | null>} A Promise that resolves with the content file path on success, or `null` on failure.
     */
    processCfpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<string | null>;

    /**
     * Processes the Important Dates (IMP) link during an UPDATE flow.
     * It checks if the link is the same as CFP to avoid redundant processing,
     * then extracts content and saves it to a file.
     *
     * @param {Page | null} page - The Playwright Page object (can be null if already closed).
     * @param {ConferenceUpdateData} conference - The conference update data.
     * @param {string | null} cfpResultPath - The file path of the processed CFP content, for comparison.
     * @param {Logger} parentLogger - The logger from the parent update process.
     * @returns {Promise<string | null>} A Promise that resolves with the content file path on success, or `null` on failure.
     */
    processImpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        cfpResultPath: string | null,
        parentLogger: Logger
    ): Promise<string | null>;

    /**
     * A general-purpose method to process and save content from any given link.
     * It handles URL normalization, content extraction, and file saving.
     * It includes logic to skip processing if links are redundant (e.g., CFP same as main).
     *
     * @param {Page | null} page - The Playwright Page object.
     * @param {string | undefined} linkToProcess - The URL to navigate to and extract content from.
     * @param {string} baseLink - The base URL (e.g., official website) for relative link normalization.
     * @param {string | undefined | null} otherLinkForComparison - Another related link (e.g., CFP if processing IMP) to avoid redundant processing.
     * @param {string | undefined} acronym - The conference acronym for logging and filename generation.
     * @param {'cfp' | 'imp' | 'main'} contentType - The type of content being processed ('cfp', 'imp', or 'main').
     * @param {boolean} useMainContentKeywords - If true, extractor will look for keywords specific to main content.
     * @param {string} fileBaseNamePrefix - A prefix for the temporary file name (e.g., "CONFACRO_final_itemX_main_determine").
     * @param {Logger} logger - The logger instance for contextual logging.
     * @returns {Promise<string | null>} A Promise that resolves to the path of the saved content file, or `null` on failure or if skipped.
     */
    processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined,
        baseLink: string,
        otherLinkForComparison: string | undefined | null,
        acronym: string | undefined,
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string,
        logger: Logger
    ): Promise<string | null>;
}

/**
 * Service for processing and saving conference links and their content.
 * It integrates with Playwright for web navigation and content extraction,
 * and with FileSystemService for persistent storage.
 */
@singleton()
export class ConferenceLinkProcessorService implements IConferenceLinkProcessorService {
    private readonly year2: number; // Configured year (e.g., current year)

    /**
     * Constructs an instance of ConferenceLinkProcessorService.
     * @param {FileSystemService} fileSystemService - Injected service for file system operations.
     * @param {IPageContentExtractorService} pageContentExtractorService - Injected service for extracting text content from web pages.
     * @param {ConfigService} configService - Injected configuration service to get `YEAR2`.
     */
    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject('IPageContentExtractorService') private pageContentExtractorService: IPageContentExtractorService,
        @inject(ConfigService) private configService: ConfigService
    ) {
        this.year2 = this.configService.config.YEAR2;
    }

    /**
     * Helper method to save extracted text content to a temporary file.
     * @param {string} content - The text content to save.
     * @param {string} baseName - The base name for the file (excluding extension).
     * @param {Logger} logger - The logger instance.
     * @returns {Promise<string | null>} Path to the saved file, or `null` if content is empty or saving fails.
     */
    private async saveContentToFile(
        content: string,
        baseName: string,
        logger: Logger
    ): Promise<string | null> {
        const currentLogContext = { baseName, function: 'saveContentToFile', service: 'ConferenceLinkProcessorService' };
        if (!content || content.trim().length === 0) {
            logger.trace({ ...currentLogContext, event: 'skipped_empty_content' }, `Skipped saving content for "${baseName}" as it was empty.`);
            return null;
        }
        try {
            const filePath = await this.fileSystemService.saveTemporaryFile(content, baseName, logger);
            logger.trace({ ...currentLogContext, filePath, event: 'save_content_success' }, `Content for "${baseName}" saved successfully to: ${filePath}.`);
            return filePath;
        } catch (writeError: unknown) { // Catch as unknown for type safety
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(writeError);
            logger.error({ ...currentLogContext, err: { message: errorMessage, stack: errorStack }, event: 'save_content_failed' }, `Failed to save content for "${baseName}": "${errorMessage}".`);
            return null;
        }
    }

    /**
     * A general-purpose method to process and save content from any given link.
     * It handles URL normalization, content extraction, and file saving.
     * It includes logic to skip processing if links are redundant (e.g., CFP same as main).
     *
     * @param {Page | null} page - The Playwright Page object. Can be `null` if the page is already closed or not available for a specific link type.
     * @param {string | undefined} linkToProcess - The URL to navigate to and extract content from.
     * @param {string} baseLink - The base URL (e.g., official website) for relative link normalization.
     * @param {string | undefined | null} otherLinkForComparison - Another related link (e.g., CFP if processing IMP) to avoid redundant processing.
     * @param {string | undefined} acronym - The conference acronym for logging and filename generation.
     * @param {'cfp' | 'imp' | 'main'} contentType - The type of content being processed ('cfp', 'imp', or 'main').
     * @param {boolean} useMainContentKeywords - If true, extractor will look for keywords specific to main content.
     * @param {string} fileBaseNamePrefix - A prefix for the temporary file name (e.g., "CONFACRO_final_itemX_main_determine"). This should already be safe for filenames.
     * @param {Logger} logger - The logger instance for contextual logging.
     * @returns {Promise<string | null>} A Promise that resolves to the path of the saved content file, or `null` on failure or if skipped.
     */
    public async processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined,
        baseLink: string,
        otherLinkForComparison: string | undefined | null,
        acronym: string | undefined,
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string,
        logger: Logger
    ): Promise<string | null> {
        const childLogger = logger.child({
            service: 'ConferenceLinkProcessorService',
            linkProcessingFunction: 'processAndSaveGeneralLink',
            contentTypeProcessing: contentType,
            processingUrlInput: linkToProcess,
            acronym,
            fileBaseNamePrefix // Include for context
        });

        const normalizedLink = normalizeAndJoinLink(baseLink, linkToProcess, childLogger);
        const normalizedOtherLink = normalizeAndJoinLink(baseLink, otherLinkForComparison, childLogger);

        if (!normalizedLink) {
            childLogger.trace({ reason: 'Link is empty, None, or could not be normalized', normalizedLinkAttempted: linkToProcess, event: 'skipped_processing_general_link' }, `Skipping processing for ${contentType} link: input was empty or could not be normalized.`);
            return null;
        }

        // Skip processing if the link is redundant (same as base or other relevant link)
        if (contentType !== 'main') { // Main content link can often be the base link
            if (normalizedLink === baseLink) {
                childLogger.trace({ reason: `Link matches base website (${baseLink})`, event: 'skipped_processing_general_link' }, `Skipping processing for ${contentType} link: it is the same as the base website.`);
                return null;
            }
            if (normalizedOtherLink && normalizedLink === normalizedOtherLink) {
                childLogger.trace({ reason: `Link matches ${contentType === 'cfp' ? 'imp' : 'cfp'} link (${normalizedOtherLink})`, event: 'skipped_processing_general_link' }, `Skipping processing for ${contentType} link: it is the same as the ${contentType === 'cfp' ? 'imp' : 'cfp'} link.`);
                return null;
            }
        }

        if (!page || page.isClosed()) {
            childLogger.warn({ event: 'page_not_available_for_general_link_processing' }, `Playwright page is not available or closed for ${contentType} link: ${normalizedLink}.`);
            return null; // Cannot proceed without a valid page
        }

        childLogger.trace({ normalizedLinkToProcess: normalizedLink, event: 'extract_text_from_general_link_start' }, `Attempting to extract text content from ${contentType} link: ${normalizedLink}.`);

        const textContent = await this.pageContentExtractorService.extractTextFromUrl(
            page,
            normalizedLink,
            acronym, // Use the provided acronym
            useMainContentKeywords,
            this.year2,
            childLogger
        );

        if (!textContent || textContent.trim().length === 0) {
            childLogger.warn({ normalizedLinkProcessed: normalizedLink, event: 'no_content_extracted_from_general_link' }, `No content extracted from ${contentType} link: ${normalizedLink}.`);
            return null;
        }

        childLogger.trace({ normalizedLinkProcessed: normalizedLink, baseNameForSave: fileBaseNamePrefix, event: 'save_content_for_general_link_start' }, `Attempting to save content for ${contentType} link.`);
        return await this.saveContentToFile(
            textContent,
            fileBaseNamePrefix, // `fileBaseNamePrefix` is expected to be safe (e.g., `CONFACRO_final_itemX_main_determine`)
            childLogger
        );
    }

    /**
     * Processes an initial conference link for the SAVE flow.
     * This involves attempting to access the link (with year adjustment logic),
     * extracting its content, and saving it.
     *
     * @param {Page} page - The Playwright Page object.
     * @param {string} link - The initial conference link to process.
     * @param {number} linkIndex - The index of this link in the current batch.
     * @param {ConferenceData} conference - The original conference data.
     * @param {number} year - The target year for the conference.
     * @param {Logger} parentProcessLogger - The logger from the `BatchProcessingService`.
     * @returns {Promise<BatchEntry | null>} A `BatchEntry` on success, or `null` if the link cannot be accessed or content extracted/saved.
     */
    public async processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number,
        parentProcessLogger: Logger
    ): Promise<BatchEntry | null> {
        const batchItemIndexFromLogger = parentProcessLogger.bindings().batchItemIndex as number | string || 'unknownItemIdx';
        const linkLogger = parentProcessLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processInitialLinkForSave',
            linkBeingProcessedIndex: linkIndex, // Using raw index for context
            originalUrlForLink: link,
            conferenceTitle: conference.Title,
            conferenceAcronym: conference.Acronym,
            batchItemIndex: batchItemIndexFromLogger,
        });

        linkLogger.info({ event: 'single_link_processing_start' }, `Starting processing of link ${linkIndex + 1} for batch item ${batchItemIndexFromLogger}.`);
        let finalLink: string = link;
        let accessSuccess = false;
        let accessError: Error | null = null;
        let responseStatus: number | null = null;

        try {
            const yearOld1 = year - 1;
            const yearOld2 = year - 2;
            const yearStr = String(year);
            let modifiedLinkAttempt: string | null = null;

            // Attempt to replace years in the link if older years are present
            if (link.includes(String(yearOld1))) {
                modifiedLinkAttempt = link.replace(new RegExp(String(yearOld1), 'g'), yearStr);
            } else if (link.includes(String(yearOld2))) {
                modifiedLinkAttempt = link.replace(new RegExp(String(yearOld2), 'g'), yearStr);
            }

            if (modifiedLinkAttempt) {
                linkLogger.info({ urlToAccess: modifiedLinkAttempt, event: 'access_attempt_modified_link' }, `Attempting to access modified link: ${modifiedLinkAttempt}.`);
                try {
                    const response = await page.goto(modifiedLinkAttempt, { waitUntil: "domcontentloaded", timeout: 15000 });
                    responseStatus = response?.status() ?? null;
                    if (response && response.ok()) {
                        finalLink = page.url(); // Get the final URL after redirects
                        linkLogger.info({ accessedUrl: modifiedLinkAttempt, status: responseStatus, finalUrlAfterAccess: finalLink, event: 'access_modified_link_success' }, `Successfully accessed modified link. Final URL: ${finalLink}.`);
                        accessSuccess = true;
                    } else {
                        accessError = new Error(`HTTP ${responseStatus} accessing modified link: ${modifiedLinkAttempt}`);
                        linkLogger.warn({ accessedUrl: modifiedLinkAttempt, status: responseStatus, event: 'access_modified_link_failed_http_status' }, `Failed to access modified link with non-OK HTTP status ${responseStatus}.`);
                    }
                } catch (error: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(error);
                    accessError = error instanceof Error ? error : new Error(errorMessage);
                    linkLogger.warn({ accessedUrl: modifiedLinkAttempt, err: { message: errorMessage }, event: 'access_modified_link_failed_exception' }, `Exception accessing modified link: "${errorMessage}".`);
                }
            }

            // If modified link failed or was not attempted, try original link
            if (!accessSuccess) {
                finalLink = link; // Revert to original link
                linkLogger.info({ urlToAccess: link, event: 'access_attempt_original_link' }, `Attempting to access original link: ${link}.`);
                try {
                    const response = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
                    responseStatus = response?.status() ?? null;
                    if (response && response.ok()) {
                        finalLink = page.url();
                        linkLogger.info({ accessedUrl: link, status: responseStatus, finalUrlAfterAccess: finalLink, event: 'access_original_link_success' }, `Successfully accessed original link. Final URL: ${finalLink}.`);
                        accessSuccess = true;
                    } else {
                        accessError = new Error(`HTTP ${responseStatus} accessing original link: ${link}`);
                        linkLogger.error({ accessedUrl: link, status: responseStatus, event: 'access_original_link_failed_http_status' }, `Failed to access original link with non-OK HTTP status ${responseStatus}.`);
                    }
                } catch (error: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(error);
                    accessError = error instanceof Error ? error : new Error(errorMessage);
                    linkLogger.error({ accessedUrl: link, err: { message: errorMessage }, event: 'access_original_link_failed_exception' }, `Exception accessing original link: "${errorMessage}".`);
                }
            }

            if (!accessSuccess) {
                linkLogger.error({ finalAttemptedUrl: finalLink, errMessage: accessError?.message, finalStatus: responseStatus, event: 'single_link_processing_failed_to_access_link' }, `Failed to access link after all attempts. Original: ${link}, Final Attempt: ${finalLink}.`);
                return null;
            }

            // At this point, `finalLink` is the URL of the successfully loaded page
            linkLogger.info({ finalUrlAfterAllAccessAttempts: finalLink, event: 'link_access_final_success' }, `Link access successful. Final URL: ${finalLink}.`);

            // Extract text content from the loaded page
            const fullText = await this.pageContentExtractorService.extractTextFromUrl(
                page, // Page is already at `finalLink`
                finalLink, // Pass `finalLink` for context and normalization
                conference.Acronym,
                false, // For initial SAVE flow, typically don't use main content keywords
                year,
                linkLogger.child({ operation: 'extract_initial_text' })
            );

            if (!fullText || fullText.trim().length === 0) {
                linkLogger.warn({ event: 'no_text_extracted_after_dom_processing' }, "No text content extracted after DOM processing.");
                return null;
            }

            // Sanitize acronym for filename
            const safeAcronym = (conference.Acronym || `conf-${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
            const textFileBaseName = `${safeAcronym}_item${batchItemIndexFromLogger}_link${linkIndex}_initialtext`;
            const textPath = await this.saveContentToFile(
                fullText,
                textFileBaseName,
                linkLogger.child({ operation: 'save_initial_text' })
            );

            if (!textPath) {
                linkLogger.error({ baseName: textFileBaseName, event: 'failed_to_save_initial_text' }, `Failed to save initial text content for "${textFileBaseName}".`);
                return null;
            }
            linkLogger.debug({ filePath: textPath, event: 'initial_text_saved_successfully' }, `Initial text content saved to: ${textPath}.`);

            const batchEntry: BatchEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym, // Use the original Acronym
                mainLink: finalLink,
                conferenceTextPath: textPath,
                originalRequestId: conference.originalRequestId,
                linkOrderIndex: linkIndex,
            };

            linkLogger.info({
                finalUrlProcessed: finalLink, textPath,
                event: 'single_link_processing_success'
            }, `Successfully processed initial link and created BatchEntry for ${conference.Acronym}.`);
            return batchEntry;

        } catch (error: unknown) { // Catch any unhandled errors in this public method
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            linkLogger.error({ originalUrl: link, err: { message: errorMessage, stack: errorStack }, event: 'single_link_processing_unhandled_error' }, `Unhandled error during initial link processing: "${errorMessage}".`);
            return null;
        }
    }

    /**
     * Processes the main link for an UPDATE operation.
     * @param {Page} page - The Playwright Page object.
     * @param {ConferenceUpdateData} conference - The conference data to update.
     * @param {Logger} parentLogger - The logger from the parent update process.
     * @returns {Promise<{ finalUrl: string | null; textPath: string | null }>} Object with final URL and content path.
     */
    public async processMainLinkForUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<{ finalUrl: string | null; textPath: string | null }> {
        const batchItemIndexFromLogger = parentLogger.bindings().batchItemIndex as number | string || 'itemX_update';
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processMainLinkForUpdate',
            linkTypeToProcess: 'main',
            initialUrl: conference.mainLink,
            conferenceAcronym: conference.Acronym,
            batchItemIndex: batchItemIndexFromLogger,
        });

        let finalUrl: string | null = conference.mainLink; // Initialize with the input link
        let textPath: string | null = null;

        if (!conference.mainLink) {
            logger.error({ event: 'conference_link_processor_link_missing_for_update', linkType: 'main' }, "Main link is missing for update operation.");
            return { finalUrl: null, textPath: null };
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'main' }, `Starting main link update processing for ${conference.Acronym}.`);

        try {
            if (page.isClosed()) {
                logger.warn({ event: 'html_processing_failed', reason: 'Page already closed', linkType: 'main' }, "Playwright page is already closed. Cannot process main link for update.");
                return { finalUrl: null, textPath: null };
            }
            const response = await page.goto(conference.mainLink, { waitUntil: "domcontentloaded", timeout: 45000 });
            finalUrl = page.url(); // Update `finalUrl` after successful navigation

            logger.info({ finalUrlAfterGoto: finalUrl, status: response?.status(), event: 'conference_link_processor_navigation_success', linkType: 'main' }, `Successfully navigated to main link. Final URL: ${finalUrl}.`);

            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, finalUrl, conference.Acronym, false, this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'main' })
            );

            if (textContent && textContent.trim()) {
                const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_main_update_item${batchItemIndexFromLogger}`;
                textPath = await this.saveContentToFile(
                    textContent.trim(), baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'main' })
                );
                if (textPath) {
                    logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'main' }, `Main content saved to: ${textPath}.`);
                } else {
                    logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'main' }, "Failed to save main content, path is null.");
                }
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'main' }, "No text content extracted for main link.");
            }
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            const errDetails = { name: error instanceof Error ? error.name : 'UnknownError', message: errorMessage, stack: errorStack?.substring(0, 300) };
            if (errorMessage?.includes('Navigation timeout') || errorMessage?.includes('Target page, context or browser has been closed')) {
                logger.error({ finalUrlAtError: finalUrl, err: errDetails, event: 'goto_failed', linkType: 'main' }, `Navigation failed for main link: "${errorMessage}".`);
            } else {
                logger.error({ finalUrlAtError: finalUrl, err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'main' }, `Error processing main link for update: "${errorMessage}".`);
            }
            textPath = null;
            finalUrl = null; // Set finalUrl to null if a critical error occurs
        }
        return { finalUrl: finalUrl ?? null, textPath }; // Ensure null is returned explicitly if finalUrl is null
    }

    /**
     * Processes the CFP link for an UPDATE operation.
     * @param {Page | null} page - The Playwright Page object.
     * @param {ConferenceUpdateData} conference - The conference data to update.
     * @param {Logger} parentLogger - The logger from the parent update process.
     * @returns {Promise<string | null>} Content path on success, or `null` on failure/skip.
     */
    public async processCfpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<string | null> {
        const batchItemIndexFromLogger = parentLogger.bindings().batchItemIndex as number | string || 'itemX_update_cfp';
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processCfpLinkForUpdate',
            linkTypeToProcess: 'cfp',
            initialUrl: conference.cfpLink,
            conferenceAcronym: conference.Acronym,
            batchItemIndex: batchItemIndexFromLogger,
        });
        let textPath: string | null = null;

        if (!conference.cfpLink || conference.cfpLink.trim().toLowerCase() === "none") {
            logger.debug({ event: 'conference_link_processor_skipped_link_no_url_or_none', linkType: 'cfp' }, "Skipping CFP link processing: URL is missing or explicitly 'none'.");
            return null;
        }
        // If page is null or closed, cannot proceed
        if (!page || page.isClosed()) {
            logger.warn({ event: 'page_not_available_for_cfp_link_processing' }, `Playwright page is not available or closed for CFP link: ${conference.cfpLink}.`);
            return null;
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'cfp' }, `Starting CFP link update processing for ${conference.Acronym}.`);

        try {
            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, conference.cfpLink, conference.Acronym, true, this.year2, // useMainContentKeywords = true for CFP
                logger.child({ operation: 'extract_update_text', linkType: 'cfp' })
            );
            if (textContent && textContent.trim().length > 0) {
                const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_cfp_update_item${batchItemIndexFromLogger}`;
                textPath = await this.saveContentToFile(
                    textContent, baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'cfp' })
                );
                if (textPath) {
                    logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'cfp' }, `CFP content saved to: ${textPath}.`);
                } else {
                    logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'cfp' }, "Failed to save CFP content, path is null.");
                }
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'cfp' }, "No text content extracted for CFP link.");
            }
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            const errDetails = { name: error instanceof Error ? error.name : 'UnknownError', message: errorMessage, stack: errorStack?.substring(0, 300) };
            logger.error({ err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'cfp' }, `Error processing CFP link for update: "${errorMessage}".`);
            textPath = null;
        }
        return textPath;
    }

    /**
     * Processes the Important Dates (IMP) link for an UPDATE operation.
     * @param {Page | null} page - The Playwright Page object.
     * @param {ConferenceUpdateData} conference - The conference data to update.
     * @param {string | null} cfpResultPath - The file path of the processed CFP content (to check for identical links).
     * @param {Logger} parentLogger - The logger from the parent update process.
     * @returns {Promise<string | null>} Content path on success, or `null` on failure/skip.
     */
    public async processImpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        cfpResultPath: string | null,
        parentLogger: Logger
    ): Promise<string | null> {
        const batchItemIndexFromLogger = parentLogger.bindings().batchItemIndex as number | string || 'itemX_update_imp';
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processImpLinkForUpdate',
            linkTypeToProcess: 'imp',
            initialUrl: conference.impLink,
            conferenceAcronym: conference.Acronym,
            batchItemIndex: batchItemIndexFromLogger,
        });
        let textPath: string | null = null;

        if (!conference.impLink || conference.impLink.trim().toLowerCase() === "none") {
            logger.debug({ event: 'conference_link_processor_skipped_link_no_url_or_none', linkType: 'imp' }, "Skipping Important Dates link processing: URL is missing or explicitly 'none'.");
            return null;
        }
        // If IMP link is the same as CFP link and CFP content was successfully retrieved, skip IMP.
        if (conference.impLink === conference.cfpLink && cfpResultPath !== null) {
            logger.info({ event: 'conference_link_processor_skipped_link_same_as_other', linkType: 'imp', otherLinkType: 'cfp' }, "Skipping Important Dates link as it's identical to CFP link, and CFP content was processed.");
            return ""; // Return empty string as per original logic, meaning "no new content path"
        }
        // If page is null or closed, cannot proceed
        if (!page || page.isClosed()) {
            logger.warn({ event: 'page_not_available_for_imp_link_processing' }, `Playwright page is not available or closed for Important Dates link: ${conference.impLink}.`);
            return null;
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'imp' }, `Starting Important Dates link update processing for ${conference.Acronym}.`);

        try {
            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, conference.impLink, conference.Acronym, false, this.year2, // useMainContentKeywords = false for IMP
                logger.child({ operation: 'extract_update_text', linkType: 'imp' })
            );
            if (textContent && textContent.trim().length > 0) {
                const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_imp_update_item${batchItemIndexFromLogger}`;
                textPath = await this.saveContentToFile(
                    textContent, baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'imp' })
                );
                if (textPath) {
                    logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'imp' }, `Important Dates content saved to: ${textPath}.`);
                } else {
                    logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'imp' }, "Failed to save Important Dates content, path is null.");
                }
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'imp' }, "No text content extracted for Important Dates link.");
            }
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            const errDetails = { name: error instanceof Error ? error.name : 'UnknownError', message: errorMessage, stack: errorStack?.substring(0, 300) };
            logger.error({ err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'imp' }, `Error processing Important Dates link for update: "${errorMessage}".`);
            textPath = null;
        }
        return textPath;
    }
}