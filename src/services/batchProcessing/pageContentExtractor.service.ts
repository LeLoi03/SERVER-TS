// src/services/batchProcessingServiceChild/pageContentExtractor.service.ts
import { Page } from 'playwright';
import { Logger } from 'pino';
import { ConfigService } from '../../config/config.service';
import { extractTextFromPDF } from '../../utils/crawl/pdf.utils'; // Utility for PDF extraction
import { cleanDOM, traverseNodes, removeExtraEmptyLines } from '../../utils/crawl/domProcessing'; // Utilities for DOM processing
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Interface for the service responsible for extracting text content from web pages and PDFs.
 */
export interface IPageContentExtractorService {
    /**
     * Extracts readable text content from a given URL.
     * This method assumes the Playwright Page object is already at the correct URL for HTML pages.
     * It handles both HTML pages and PDF files.
     * Content can be focused using main content keywords if specified.
     *
     * @param {Page | null} page - The Playwright Page object. It must be pre-navigated to the target URL for HTML extraction.
     * @param {string} url - The URL from which to extract content. Used for PDF detection and logging context.
     * @param {string | undefined} acronym - The conference acronym, used for logging context.
     * @param {boolean} useMainContentKeywords - If `true`, the extractor will attempt to focus on main content areas based on configured keywords.
     * @param {number} yearToConsider - The target year for content processing (e.g., to filter out older dates).
     * @param {Logger} logger - The logger instance for contextual logging.
     * @returns {Promise<string>} A Promise that resolves to the extracted text content, or an empty string if extraction fails.
     */
    extractTextFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<string>;
}

/**
 * Service to extract clean text content from web pages (HTML) or PDF documents.
 * It assumes the page is already navigated for HTML and uses a separate utility for PDF extraction.
 * It can also filter content based on configured main content keywords.
 */
@singleton()
export class PageContentExtractorService implements IPageContentExtractorService {
    private readonly mainContentKeywords: string[]; // Keywords used for focusing on main content areas

    /**
     * Constructs an instance of PageContentExtractorService.
     * @param {ConfigService} configService - The injected configuration service to get `MAIN_CONTENT_KEYWORDS`.
     */
    constructor(@inject(ConfigService) private configService: ConfigService) {
        this.mainContentKeywords = this.configService.mainContentKeywords ?? [];
    }

    /**
     * Extracts readable text content from a given URL.
     * It intelligently handles PDF files by delegating to a PDF utility.
     * For HTML pages, it assumes the page is already at the target URL, extracts the DOM, cleans it, and traverses for text.
     * It can also prioritize content based on `mainContentKeywords` if `useMainContentKeywords` is true.
     *
     * @param {Page | null} page - The Playwright Page object. Required and must be pre-navigated for HTML extraction.
     * @param {string} url - The URL to extract content from. Used for PDF detection and logging.
     * @param {string | undefined} acronym - The conference acronym (for logging context).
     * @param {boolean} useMainContentKeywords - Whether to use configured keywords to focus content extraction.
     * @param {number} yearToConsider - The target year for filtering/processing content (e.g., in `traverseNodes`).
     * @param {Logger} logger - The logger instance for contextual logging.
     * @returns {Promise<string>} The extracted clean text content, or an empty string if extraction fails or content is not found.
     */
    public async extractTextFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<string> {
        const currentLogContext = { url, acronym, useMainContentKeywords, yearToConsider, function: 'extractTextFromUrl', service: 'PageContentExtractorService' };
        logger.trace({ ...currentLogContext, event: 'extraction_start' }, `Starting content extraction for URL: ${url}.`);

        if (!url || !/^(https?:\/\/|file:\/\/)/i.test(url)) {
            logger.warn({ ...currentLogContext, event: 'skipped_invalid_url_structure' }, "Skipped extraction due to invalid URL structure.");
            return "";
        }

        try {
            // Handle PDF files (Logic is unchanged)
            if (url.toLowerCase().endsWith(".pdf")) {
                logger.info({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_start' }, "Attempting to extract text from PDF URL.");
                const pdfText = await extractTextFromPDF(url, logger.child({ operation: 'pdf_extract' }));
                if (pdfText) {
                    logger.info({ ...currentLogContext, type: 'pdf', textLength: pdfText.length, event: 'pdf_extraction_finish', success: true }, `PDF text extraction finished. Length: ${pdfText.length}.`);
                    return pdfText;
                } else {
                    logger.warn({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_finish', success: false }, "PDF text extraction finished but no content was extracted.");
                    return "";
                }
            }

            // Handle HTML pages
            if (!page || page.isClosed()) {
                const errorMsg = `Playwright page is null or closed for HTML extraction from URL: ${url}.`;
                logger.error({ ...currentLogContext, type: 'html', event: 'html_processing_failed', reason: 'Page is null or closed' }, errorMsg);
                throw new Error(errorMsg);
            }
            logger.info({ ...currentLogContext, type: 'html', event: 'html_processing_start' }, "Attempting to extract text from an already-loaded HTML page.");

            // === KHỐI `page.goto` ĐÃ ĐƯỢC LOẠI BỎ HOÀN TOÀN ===
            // Trách nhiệm điều hướng đã được chuyển cho hàm gọi.

            // Get HTML content from the pre-navigated page
            let htmlContent: string;
            try {
                // Thêm một bước chờ ngắn để đảm bảo trang đã ổn định trước khi lấy nội dung
                await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
                htmlContent = await page.content();
                logger.debug({ ...currentLogContext, event: 'fetch_content_success' }, "Successfully fetched page HTML content.");
            } catch (contentError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(contentError);
                logger.error({ ...currentLogContext, type: 'html', err: { message: errorMessage, stack: errorStack }, event: 'fetch_content_failed' }, `Failed to fetch page content: "${errorMessage}".`);
                return "";
            }

            let contentToProcess = htmlContent;
            // Apply main content keyword filtering (Logic is unchanged)
            if (useMainContentKeywords && this.mainContentKeywords.length > 0) {
                logger.trace({ ...currentLogContext, type: 'html', event: 'main_content_eval_start' }, "Attempting to extract main content using keywords.");
                try {
                    if (page.isClosed()) {
                         throw new Error('Playwright page closed during $$eval operation.');
                    }
                    const extractedContentRaw: string | string[] = await page.$$eval("body *", (elements, keywords) => {
                        const safeKeywords = Array.isArray(keywords) ? keywords.map(k => String(k).toLowerCase()) : [];
                        if (safeKeywords.length === 0) {
                            return document ? (document.body?.outerHTML || "") : "";
                        }
                        const relevantElements = elements.filter((el: Element) => {
                            return el.hasAttributes() &&
                                Array.from(el.attributes).some((attr: Attr) =>
                                    safeKeywords.some((keyword: string) =>
                                        attr.name.toLowerCase().includes(keyword) ||
                                        attr.value.toLowerCase().includes(keyword)
                                    )
                                );
                        });
                        return relevantElements.map((el: Element) => el.outerHTML).join("\n\n");
                    }, this.mainContentKeywords);

                    const extractedContent = Array.isArray(extractedContentRaw) ? extractedContentRaw.join('\n\n') : extractedContentRaw;

                    if (extractedContent && extractedContent.trim().length > 50) {
                        contentToProcess = extractedContent;
                        logger.trace({ ...currentLogContext, type: 'html', extractedLength: contentToProcess.length, event: 'main_content_eval_success' }, `Main content extraction successful. Length: ${contentToProcess.length}.`);
                    } else {
                        logger.debug({ ...currentLogContext, type: 'html', event: 'main_content_eval_skipped', reason: 'No significant content found' }, "Main content extraction by keywords found no significant content. Using full HTML.");
                    }
                } catch (evalError: unknown) {
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(evalError);
                    logger.warn({ ...currentLogContext, type: 'html', err: { message: errorMessage, stack: errorStack }, event: 'main_content_eval_failed' }, `Failed to evaluate main content using keywords: "${errorMessage}". Proceeding with full HTML.`);
                    contentToProcess = htmlContent;
                }
            }

            // Clean and traverse DOM for final text extraction (Logic is unchanged)
            logger.trace({ ...currentLogContext, type: 'html', event: 'dom_processing_start' }, "Starting DOM cleaning and text traversal.");
            const document = cleanDOM(contentToProcess);
            if (!document?.body) {
                logger.warn({ ...currentLogContext, type: 'html', event: 'dom_processing_failed', reason: 'Cleaned DOM or body is null' }, "DOM processing failed: Cleaned document or body was null/undefined.");
                return "";
            }
            let fullText = traverseNodes(document.body as HTMLElement, acronym, yearToConsider);
            fullText = removeExtraEmptyLines(fullText);
            logger.info({ ...currentLogContext, type: 'html', success: true, textLength: fullText.length, event: 'html_processing_finish' }, `HTML text extraction finished. Length: ${fullText.length}.`);
            return fullText;

        } catch (error: unknown) { // Catch any unexpected errors in the overall method execution
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ ...currentLogContext, err: { message: errorMessage, stack: errorStack }, event: 'unexpected_error' }, `An unexpected error occurred during content extraction: "${errorMessage}".`);
            return "";
        }
    }
}