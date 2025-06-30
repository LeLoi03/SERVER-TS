import { Page, Frame } from 'playwright';
import { Logger } from 'pino';
import { ConfigService } from '../../config/config.service';
import { extractTextFromPDF } from '../../utils/crawl/pdf.utils';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

// --- Helper Function for Conditional Scrolling ---
/**
 * Scrolls the page to the bottom to trigger lazy-loaded content.
 * Includes a total timeout and a max attempts limit to prevent infinite loops.
 * @param page The Playwright Page object.
 * @param logger The logger instance.
 */
async function autoScroll(page: Page, logger: Logger) {
    logger.trace({ event: 'auto_scroll_start' });
    try {
        // Add an overall timeout for the entire scrolling operation.
        await page.evaluate(async (timeoutMs) => {
            await Promise.race([
                new Promise<void>((resolve) => {
                    let totalHeight = 0;
                    const distance = 100;
                    let scrollAttempts = 0;
                    const maxScrollAttempts = 100; // Limit to 100 scrolls (e.g., 10000px)

                    const timer = setInterval(() => {
                        const scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, distance);
                        totalHeight += distance;
                        scrollAttempts++;

                        if (totalHeight >= scrollHeight || scrollAttempts >= maxScrollAttempts) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 100); // Scroll every 100ms
                }),
                // A separate promise that rejects after a timeout
                new Promise<void>((_, reject) => 
                    setTimeout(() => reject(new Error(`Auto-scrolling timed out after ${timeoutMs}ms`)), timeoutMs)
                )
            ]);
        }, 15000); // Set a 15-second timeout for the entire scroll operation

        // Wait a moment for animations to complete after scrolling
        await page.waitForTimeout(2000);
        logger.trace({ event: 'auto_scroll_success' });
    } catch (error) {
        logger.warn({ err: error, event: 'auto_scroll_failed_or_timed_out' }, "Auto-scrolling failed or timed out, content might be incomplete.");
    }
}

/**
 * Interface for the service responsible for extracting text content from web pages and PDFs.
 */
export interface IPageContentExtractorService {
    extractTextFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<string>;
}

@singleton()
export class PageContentExtractorService implements IPageContentExtractorService {
    private readonly excludeTexts: string[];
    private readonly cfpTabKeywords: string[];
    private readonly importantDatesTabs: string[];
    private readonly exactKeywords: string[];
    private readonly MIN_CONTENT_LENGTH_FOR_RETRY = 1000;

    constructor(@inject(ConfigService) private configService: ConfigService) {
        this.excludeTexts = this.configService.excludeTexts ?? [];
        this.cfpTabKeywords = this.configService.cfpTabKeywords ?? [];
        this.importantDatesTabs = this.configService.importantDatesTabs ?? [];
        this.exactKeywords = this.configService.exactKeywords ?? [];
    }

    /**
     * Core extraction logic. This function is designed to be called multiple times
     * (e.g., before and after scrolling).
     * @private
     */
    private async _extractCore(page: Page, acronym: string | undefined, yearToConsider: number, logger: Logger): Promise<string> {
        const currentLogContext = { function: '_extractCore', service: 'PageContentExtractorService' };
        let fullText = "";
        const frames = page.frames();
        logger.debug({ ...currentLogContext, frameCount: frames.length, event: 'core_extraction_start' }, `Starting core extraction for ${frames.length} frame(s).`);

        const argsForEvaluate = {
            acronym: (acronym || "").toLowerCase().trim(),
            year: String(yearToConsider),
            excludeTexts: this.excludeTexts,
            cfpTabKeywords: this.cfpTabKeywords,
            importantDatesTabs: this.importantDatesTabs,
            exactKeywords: this.exactKeywords,
        };

        for (const frame of frames) {
            if (frame.isDetached()) {
                logger.trace({ ...currentLogContext, frameUrl: frame.url(), event: 'skipped_detached_frame' });
                continue;
            }

            const frameLogger = logger.child({ frameUrl: frame.url() });

            try {
                await frame.evaluate((args) => {
                    document.querySelectorAll('script, style').forEach(el => el.remove());

                    document.querySelectorAll('*').forEach(el => {
                        const style = window.getComputedStyle(el);
                        if (style.display === 'none') {
                            (el as HTMLElement).style.display = 'block';
                        }
                        if (style.visibility === 'hidden') {
                            (el as HTMLElement).style.visibility = 'visible';
                        }
                    });

                    const { acronym, year, excludeTexts, cfpTabKeywords, importantDatesTabs, exactKeywords } = args;
                    const isRelevant = (text: string | null, valueOrHref: string | null): boolean => {
                        const lowerText = (text || "").toLowerCase().trim();
                        const lowerValue = (valueOrHref || "").toLowerCase();
                        if (excludeTexts.some(keyword => lowerText.includes(keyword))) return false;
                        if (exactKeywords.includes(lowerText) || exactKeywords.includes(lowerValue)) return true;
                        if (acronym && (lowerText.includes(acronym) || lowerValue.includes(acronym))) return true;
                        if (year && (lowerText.includes(year) || lowerValue.includes(year))) return true;
                        if (cfpTabKeywords.some(k => lowerText.includes(k) || lowerValue.includes(k))) return true;
                        if (importantDatesTabs.some(k => lowerText.includes(k) || lowerValue.includes(k))) return true;
                        return false;
                    };

                    document.querySelectorAll('del, s').forEach(el => {
                        const text = el.textContent;
                        if (text && text.trim()) {
                            const replacementSpan = document.createElement('span');
                            replacementSpan.textContent = ` [GẠCH BỎ: ${text.trim()}] `;
                            el.parentNode?.replaceChild(replacementSpan, el);
                        }
                    });

                    document.querySelectorAll('a').forEach(anchor => {
                        const href = anchor.getAttribute('href');
                        const text = anchor.textContent;
                        if (isRelevant(text, href)) {
                            const replacementSpan = document.createElement('span');
                            replacementSpan.textContent = ` href="${href || ''}" - ${text?.trim()} `;
                            anchor.parentNode?.replaceChild(replacementSpan, anchor);
                        }
                    });

                    document.querySelectorAll('select').forEach(selectElement => {
                        const optionsToExtract: HTMLElement[] = [];
                        selectElement.querySelectorAll('option').forEach(option => {
                            const value = option.getAttribute('value');
                            const text = option.textContent;
                            if (isRelevant(text, value)) {
                                const replacementDiv = document.createElement('div');
                                replacementDiv.textContent = ` value="${value || ''}" - ${text?.trim()} `;
                                optionsToExtract.push(replacementDiv);
                            }
                        });

                        if (optionsToExtract.length > 0) {
                            for (let i = optionsToExtract.length - 1; i >= 0; i--) {
                                selectElement.parentNode?.insertBefore(optionsToExtract[i], selectElement.nextSibling);
                            }
                        }
                    });
                }, argsForEvaluate);
                frameLogger.trace({ ...currentLogContext, event: 'dom_preprocessing_complete' });

                let frameText = "";
                const specialContentSelector = '.main-content, #app';
                try {
                    const elementHandle = await frame.waitForSelector(specialContentSelector, { timeout: 5000, state: 'attached' });
                    frameLogger.trace({ ...currentLogContext, selector: specialContentSelector, event: 'special_content_container_found' });
                    const specialContentText = await elementHandle.innerText();
                    if (specialContentText && specialContentText.trim()) {
                        frameText = specialContentText;
                        frameLogger.debug({ ...currentLogContext, textLength: frameText.length, event: 'frame_text_extracted_from_special_container' });
                    }
                } catch (e) {
                    frameLogger.trace({ ...currentLogContext, selector: specialContentSelector, event: 'special_content_container_not_found' }, "No special content container found, will fallback to body.");
                }

                if (!frameText.trim()) {
                    frameLogger.trace({ ...currentLogContext, event: 'executing_fallback_to_body' }, "Executing fallback: extracting text from the entire body.");
                    frameText = await frame.locator('body').innerText({ timeout: 20000 });
                    if (frameText && frameText.trim()) {
                        frameLogger.debug({ ...currentLogContext, textLength: frameText.length, event: 'frame_text_extracted_from_body' });
                    }
                }
                
                if (frameText && frameText.trim()) {
                    fullText += frameText.trim() + '\n\n';
                }
            } catch (e: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(e);
                frameLogger.warn({ ...currentLogContext, err: { message: errorMessage }, event: 'frame_processing_failed' }, `Could not process frame: ${errorMessage}`);
            }
        }
        return fullText.replace(/(\n\s*){3,}/g, '\n\n').trim();
    }

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
            logger.warn({ ...currentLogContext, event: 'skipped_invalid_url_structure' });
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

            // Attempt 1: Extract without scrolling (optimistic case)
            logger.debug({ ...currentLogContext, attempt: 1, event: 'extraction_attempt_without_scroll' });
            let extractedText = await this._extractCore(page, acronym, yearToConsider, logger);

            // Attempt 2: If content is too short, retry with scrolling
            if (extractedText.length < this.MIN_CONTENT_LENGTH_FOR_RETRY) {
                logger.warn({
                    ...currentLogContext,
                    attempt: 2,
                    textLength: extractedText.length,
                    threshold: this.MIN_CONTENT_LENGTH_FOR_RETRY,
                    event: 'content_too_short_retrying_with_scroll'
                }, "Initial content is very short. Retrying with auto-scroll to trigger lazy-loaded elements.");

                await autoScroll(page, logger);
                extractedText = await this._extractCore(page, acronym, yearToConsider, logger);
            }

            logger.info({ ...currentLogContext, type: 'html', success: true, textLength: extractedText.length, event: 'html_processing_finish_hybrid' }, `HYBRID HTML text extraction finished. Total Length: ${extractedText.length}.`);
            return extractedText;

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ ...currentLogContext, err: { message: errorMessage, stack: errorStack }, event: 'unexpected_error' }, `An unexpected error occurred during content extraction: "${errorMessage}".`);
            return "";
        }
    }
}