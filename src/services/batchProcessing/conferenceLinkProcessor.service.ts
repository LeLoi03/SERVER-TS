// src/services/batchProcessing/conferenceLinkProcessor.service.ts
import { Page } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { IPageContentExtractorService } from './pageContentExtractor.service';
import { ConfigService } from '../../config/config.service';
import { ConferenceData, ConferenceUpdateData, BatchEntry } from '../../types/crawl';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility
import { accessUrl, AccessResult } from './utils';



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
        this.year2 = this.configService.year2;
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
            fileBaseNamePrefix
        });

        const normalizedLink = normalizeAndJoinLink(baseLink, linkToProcess, childLogger);
        const normalizedOtherLink = normalizeAndJoinLink(baseLink, otherLinkForComparison, childLogger);

        if (!normalizedLink) {
            childLogger.trace({ reason: 'Link is empty, None, or could not be normalized', event: 'skipped_processing_general_link' });
            return null;
        }


         // === THAY ĐỔI CỐT LÕI NẰM Ở ĐÂY ===
        if (contentType !== 'main') {
            // 1. LOẠI BỎ khối kiểm tra so sánh với baseLink
            // Khối code này đã bị xóa:
            /*
            if (normalizedLink === baseLink) { // Hoặc một phép so sánh tương đương gây ra lỗi
                childLogger.trace({ reason: `Link matches base website (${baseLink})`, event: 'skipped_processing_general_link' });
                return null;
            }
            */

            // 2. GIỮ LẠI khối kiểm tra so sánh với link còn lại (ví dụ: IMP vs CFP)
            // Logic này vẫn hữu ích để tránh xử lý 2 link giống hệt nhau
            if (normalizedOtherLink && normalizedLink === normalizedOtherLink) {
                childLogger.trace({ reason: `Link matches other link (${normalizedOtherLink})`, event: 'skipped_processing_general_link' });
                return null;
            }
        }
        // === KẾT THÚC THAY ĐỔI ===

        if (!page || page.isClosed()) {
            childLogger.warn({ event: 'page_not_available_for_general_link_processing' });
            return null;
        }

        // Sử dụng hàm accessUrl đã được chuẩn hóa
        const accessResult: AccessResult = await accessUrl(page, normalizedLink, childLogger);
        if (!accessResult.success) { // Chỉ cần kiểm tra success là đủ
            const errorMessage = accessResult.error?.message ?? `HTTP status ${accessResult.response?.status()}`;
            childLogger.error({ err: { message: errorMessage }, event: 'general_link_access_failed' }, `Failed to navigate to general link: ${errorMessage}`);
            return null;
        }
        childLogger.info({ finalUrl: accessResult.finalUrl, event: 'general_link_access_success' });

         // Gọi PageContentExtractorService (phiên bản hybrid đã sửa)
        const textContent = await this.pageContentExtractorService.extractTextFromUrl(
            page,
            accessResult.finalUrl!,
            acronym,
            useMainContentKeywords,
            this.year2,
            childLogger
        );

        if (!textContent || textContent.trim().length === 0) {
            childLogger.warn({ normalizedLinkProcessed: normalizedLink, event: 'no_content_extracted_from_general_link' });
            return null;
        }

        // === BƯỚC 3: LƯU (Gọi saveContentToFile) ===
        return await this.saveContentToFile(textContent, fileBaseNamePrefix, childLogger);
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
            linkBeingProcessedIndex: linkIndex,
            originalUrlForLink: link,
            conferenceTitle: conference.Title,
            conferenceAcronym: conference.Acronym,
            batchItemIndex: batchItemIndexFromLogger,
        });

        linkLogger.info({ event: 'single_link_processing_start' });

        const yearOld1 = year - 1;
        const yearOld2 = year - 2;
        const yearStr = String(year);
        const urlsToTry: string[] = [];

        if (link.includes(String(yearOld1))) {
            urlsToTry.push(link.replace(new RegExp(String(yearOld1), 'g'), yearStr));
        } else if (link.includes(String(yearOld2))) {
            urlsToTry.push(link.replace(new RegExp(String(yearOld2), 'g'), yearStr));
        }
        urlsToTry.push(link);
        const uniqueUrlsToTry = [...new Set(urlsToTry)];

        for (const urlToTry of uniqueUrlsToTry) {
            try {
                const safeAcronym = (conference.Acronym || `conf-${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
                const textFileBaseName = `${safeAcronym}_item${batchItemIndexFromLogger}_link${linkIndex}_initialtext`;

                // Gọi hàm lõi để thực hiện toàn bộ công việc
                const textPath = await this.processAndSaveGeneralLink(
                    page, urlToTry, urlToTry, null, conference.Acronym, 'main', false, textFileBaseName, linkLogger
                );

                if (textPath) {
                    const finalLink = page.url();
                    linkLogger.info({ finalUrlProcessed: finalLink, textPath, event: 'single_link_processing_success' });
                    return {
                        conferenceTitle: conference.Title,
                        conferenceAcronym: conference.Acronym,
                        mainLink: finalLink,
                        conferenceTextPath: textPath,
                        originalRequestId: conference.originalRequestId,
                        linkOrderIndex: linkIndex,
                    };
                }
                // Nếu textPath là null, vòng lặp sẽ tự động thử URL tiếp theo.
                linkLogger.warn({ urlAttempted: urlToTry, event: 'initial_link_attempt_failed_no_content' }, `Attempt to process ${urlToTry} resulted in no content, trying next URL if available.`);

            } catch (error: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(error);
                linkLogger.error({ urlAttempted: urlToTry, err: { message: errorMessage }, event: 'initial_link_attempt_unhandled_error' });
            }
        }

        linkLogger.error({ event: 'all_initial_link_attempts_failed' }, "All attempts to process initial link failed.");
        return null;
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

        if (!conference.mainLink) {
            logger.error({ event: 'conference_link_processor_link_missing_for_update' });
            return { finalUrl: null, textPath: null };
        }

        const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
        const baseName = `${safeAcronym}_main_update_item${batchItemIndexFromLogger}`;

        const textPath = await this.processAndSaveGeneralLink(
            page, conference.mainLink, conference.mainLink, null, conference.Acronym, 'main', false, baseName, logger
        );

        if (textPath) {
            return { finalUrl: page.url(), textPath };
        } else {
            return { finalUrl: null, textPath: null };
        }
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

        const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
        const baseName = `${safeAcronym}_cfp_update_item${batchItemIndexFromLogger}`;

        return await this.processAndSaveGeneralLink(
            page, conference.cfpLink, conference.mainLink!, null, conference.Acronym, 'cfp', true, baseName, logger
        );
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

        // Logic kiểm tra trùng link vẫn cần thiết
        if (conference.impLink === conference.cfpLink && cfpResultPath !== null) {
            logger.info({ event: 'conference_link_processor_skipped_link_same_as_other' });
            return "";
        }

        const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
        const baseName = `${safeAcronym}_imp_update_item${batchItemIndexFromLogger}`;

        return await this.processAndSaveGeneralLink(
            page, conference.impLink, conference.mainLink!, conference.cfpLink, conference.Acronym, 'imp', false, baseName, logger
        );
    }
}