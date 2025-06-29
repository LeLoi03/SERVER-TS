// src/services/batchProcessingServiceChild/pageContentExtractor.service.ts
import { Page, Frame } from 'playwright'; // Thêm import Frame
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
    private readonly excludeTexts: string[];
    private readonly cfpTabKeywords: string[];
    private readonly importantDatesTabs: string[];
    private readonly exactKeywords: string[];

    constructor(@inject(ConfigService) private configService: ConfigService) {
        this.mainContentKeywords = this.configService.mainContentKeywords ?? [];
        // Lấy các config cần thiết cho việc xử lý link
        this.excludeTexts = this.configService.excludeTexts ?? [];
        this.cfpTabKeywords = this.configService.cfpTabKeywords ?? [];
        this.importantDatesTabs = this.configService.importantDatesTabs ?? [];
        this.exactKeywords = this.configService.exactKeywords ?? [];
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

            if (!page || page.isClosed()) {
                const errorMsg = `Playwright page is null or closed for HTML extraction from URL: ${url}.`;
                logger.error({ ...currentLogContext, type: 'html', event: 'html_processing_failed', reason: 'Page is null or closed' }, errorMsg);
                throw new Error(errorMsg);
            }
            logger.info({ ...currentLogContext, type: 'html', event: 'html_processing_start' }, "Attempting to extract text from an already-loaded HTML page, including iframes.");

            try {
                logger.debug({ ...currentLogContext, event: 'wait_for_networkidle_start' }, "Waiting for network to be idle to ensure all dynamic content is loaded.");
                await page.waitForLoadState('networkidle', { timeout: 20000 });
                logger.debug({ ...currentLogContext, event: 'wait_for_networkidle_success' }, "Network is idle.");
            } catch (waitError: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(waitError);
                logger.warn({ ...currentLogContext, err: { message: errorMessage }, event: 'wait_for_networkidle_timed_out' }, "Timed out waiting for network idle. Proceeding with available content.");
            }

            // let mainPageHtml = '';
            // try {
            //     mainPageHtml = await page.content();
            //     logger.debug({ ...currentLogContext, event: 'fetch_main_content_success', length: mainPageHtml.length }, "Successfully fetched main page HTML content.");
            // } catch (contentError: unknown) {
            //     const { message: errorMessage } = getErrorMessageAndStack(contentError);
            //     logger.error({ ...currentLogContext, type: 'html', err: { message: errorMessage }, event: 'fetch_main_content_failed' }, `Failed to fetch main page content: "${errorMessage}".`);
            // }

            // const allFrames = page.frames();
            // const iframeHtmls: string[] = [];
            // if (allFrames.length > 1) {
            //     logger.info({ ...currentLogContext, frameCount: allFrames.length - 1, event: 'iframe_detection_start' }, `Found ${allFrames.length - 1} iframe(s). Attempting to extract their content.`);
            //     for (let i = 1; i < allFrames.length; i++) {
            //         const frame = allFrames[i];
            //         if (frame.url() === 'about:blank' || frame.isDetached()) {
            //             logger.trace({ ...currentLogContext, frameUrl: frame.url(), frameIndex: i, event: 'skipped_iframe' }, 'Skipping blank or detached iframe.');
            //             continue;
            //         }
            //         try {
            //             await frame.waitForLoadState('domcontentloaded', { timeout: 10000 });
            //             const frameHtml = await frame.content();
            //             iframeHtmls.push(frameHtml);
            //             logger.debug({ ...currentLogContext, frameUrl: frame.url(), frameIndex: i, length: frameHtml.length, event: 'fetch_iframe_content_success' }, `Successfully fetched content from iframe #${i}.`);
            //         } catch (frameError: unknown) {
            //             const { message: errorMessage } = getErrorMessageAndStack(frameError);
            //             logger.warn({ ...currentLogContext, frameUrl: frame.url(), frameIndex: i, err: { message: errorMessage }, event: 'fetch_iframe_content_failed' }, `Failed to fetch content from iframe #${i}.`);
            //         }
            //     }
            // }

            // const combinedHtml = [mainPageHtml, ...iframeHtmls].join('\n');
            // let contentToProcess = combinedHtml;

            // // Apply main content keyword filtering
            // if (useMainContentKeywords && this.mainContentKeywords.length > 0) {
            //     logger.trace({ ...currentLogContext, type: 'html', event: 'main_content_eval_start' }, "Attempting to extract main content using keywords.");
            //     try {
            //         if (page.isClosed()) {
            //             throw new Error('Playwright page closed during $$eval operation.');
            //         }
            //         const extractedContentRaw: string | string[] = await page.$$eval("body *", (elements, keywords) => {
            //             const safeKeywords = Array.isArray(keywords) ? keywords.map(k => String(k).toLowerCase()) : [];
            //             if (safeKeywords.length === 0) {
            //                 return document ? (document.body?.outerHTML || "") : "";
            //             }
            //             const relevantElements = elements.filter((el: Element) => {
            //                 return el.hasAttributes() &&
            //                     Array.from(el.attributes).some((attr: Attr) =>
            //                         safeKeywords.some((keyword: string) =>
            //                             attr.name.toLowerCase().includes(keyword) ||
            //                             attr.value.toLowerCase().includes(keyword)
            //                         )
            //                     );
            //             });
            //             return relevantElements.map((el: Element) => el.outerHTML).join("\n\n");
            //         }, this.mainContentKeywords);

            //         const extractedContent = Array.isArray(extractedContentRaw) ? extractedContentRaw.join('\n\n') : extractedContentRaw;

            //         if (extractedContent && extractedContent.trim().length > 50) {
            //             contentToProcess = extractedContent;
            //             logger.trace({ ...currentLogContext, type: 'html', extractedLength: contentToProcess.length, event: 'main_content_eval_success' }, `Main content extraction successful. Length: ${contentToProcess.length}.`);
            //         } else {
            //             logger.debug({ ...currentLogContext, type: 'html', event: 'main_content_eval_skipped', reason: 'No significant content found' }, "Main content extraction by keywords found no significant content. Using full HTML.");
            //         }
            //     } catch (evalError: unknown) {
            //         const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(evalError);
            //         logger.warn({ ...currentLogContext, type: 'html', err: { message: errorMessage, stack: errorStack }, event: 'main_content_eval_failed' }, `Failed to evaluate main content using keywords: "${errorMessage}". Proceeding with full HTML.`);

            //         // SỬA LỖI Ở ĐÂY:
            //         // Fallback về nội dung tổng hợp nếu lọc keyword thất bại.
            //         contentToProcess = combinedHtml;
            //     }
            // }

            // // Clean and traverse DOM for final text extraction
            // logger.trace({ ...currentLogContext, type: 'html', event: 'dom_processing_start' }, "Starting DOM cleaning and text traversal on combined content.");
            // const document = cleanDOM(contentToProcess);
            // if (!document?.body) {
            //     logger.warn({ ...currentLogContext, type: 'html', event: 'dom_processing_failed', reason: 'Cleaned DOM or body is null' }, "DOM processing failed: Cleaned document or body was null/undefined.");
            //     return "";
            // }
            // let fullText = traverseNodes(document.body as HTMLElement, acronym, yearToConsider);
            // fullText = removeExtraEmptyLines(fullText);

            // logger.info({ ...currentLogContext, type: 'html', success: true, textLength: fullText.length, event: 'html_processing_finish' }, `HTML text extraction finished. Total Length: ${fullText.length}.`);
            // return fullText;


            // === BƯỚC 1: TIÊM SCRIPT ĐỂ BIẾN ĐỔI CÁC THẺ <a> VÀ <option> ===
            const argsForEvaluate = {
                acronym: (acronym || "").toLowerCase().trim(),
                year: String(yearToConsider),
                excludeTexts: this.excludeTexts,
                cfpTabKeywords: this.cfpTabKeywords,
                importantDatesTabs: this.importantDatesTabs,
                exactKeywords: this.exactKeywords,
            };

            await page.evaluate((args) => {
                // Hàm này chạy trong môi trường của trình duyệt
                const { acronym, year, excludeTexts, cfpTabKeywords, importantDatesTabs, exactKeywords } = args;

                // Hàm trợ giúp để kiểm tra một link/option có phù hợp không
                const isRelevant = (text, valueOrHref) => {
                    const lowerText = (text || "").toLowerCase().trim();
                    const lowerValue = (valueOrHref || "").toLowerCase();

                    if (excludeTexts.some(keyword => lowerText.includes(keyword))) return false;
                    if (exactKeywords.includes(lowerText) || exactKeywords.includes(lowerValue)) return true;
                    if (lowerText.includes(acronym) || lowerValue.includes(acronym)) return true;
                    if (lowerText.includes(year) || lowerValue.includes(year)) return true;
                    if (cfpTabKeywords.some(k => lowerText.includes(k) || lowerValue.includes(k))) return true;
                    if (importantDatesTabs.some(k => lowerText.includes(k) || lowerValue.includes(k))) return true;

                    return false;
                };

                // Xử lý các thẻ <a>
                document.querySelectorAll('a').forEach(anchor => {
                    const href = anchor.getAttribute('href');
                    const text = anchor.textContent;
                    if (isRelevant(text, href)) {
                        // Thay thế thẻ a bằng một thẻ span chứa text đã được định dạng
                        const replacementSpan = document.createElement('span');
                        replacementSpan.textContent = ` href="${href || ''}" - ${text.trim()} `;
                        anchor.parentNode?.replaceChild(replacementSpan, anchor);
                    }
                });

                // Xử lý các thẻ <option>
                document.querySelectorAll('option').forEach(option => {
                    const value = option.getAttribute('value');
                    const text = option.textContent;
                    if (isRelevant(text, value)) {
                        // Thay thế thẻ option bằng một thẻ span
                        const replacementSpan = document.createElement('span');
                        replacementSpan.textContent = ` value="${value || ''}" - ${text.trim()} `;
                        option.parentNode?.replaceChild(replacementSpan, option);
                    }
                });

            }, argsForEvaluate);

            logger.debug({ ...currentLogContext, event: 'dom_preprocessing_complete' }, "DOM preprocessing to format links and options is complete.");

            // === BƯỚC 2: TRÍCH XUẤT TEXT BẰNG innerText SAU KHI ĐÃ BIẾN ĐỔI ===
            // Chúng ta sẽ lấy text từ body, bao gồm cả các iframe
            let fullText = "";
            const frames = page.frames();
            for (const frame of frames) {
                if (frame.isDetached()) continue;
                try {
                    // Lấy innerText từ body của mỗi frame
                    const frameText = await frame.locator('body').innerText({ timeout: 15000 });
                    fullText += frameText + '\n\n';
                } catch (e) {
                    logger.warn({ ...currentLogContext, frameUrl: frame.url(), event: 'frame_innerText_extraction_failed' }, `Could not extract innerText from frame: ${frame.url()}`);
                }
            }

            // Dọn dẹp các dòng trống thừa
            fullText = fullText.replace(/(\n\s*){3,}/g, '\n\n').trim();


            logger.info({ ...currentLogContext, type: 'html', success: true, textLength: fullText.length, event: 'html_processing_finish_hybrid' }, `HYBRID HTML text extraction finished. Total Length: ${fullText.length}.`);
            return fullText;

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ ...currentLogContext, err: { message: errorMessage, stack: errorStack }, event: 'unexpected_error' }, `An unexpected error occurred during content extraction: "${errorMessage}".`);
            return "";
        }
    }
}