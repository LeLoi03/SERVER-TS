// src/services/batchProcessingServiceChild/PageContentExtractor.service.ts
import { Page } from 'playwright';
import { Logger } from 'pino';
import { ConfigService } from '../../config/config.service';
import { extractTextFromPDF } from '../../utils/crawl/pdf.utils';
import { cleanDOM, traverseNodes, removeExtraEmptyLines } from '../../utils/crawl/domProcessing';
import { singleton, inject } from 'tsyringe';

export interface IPageContentExtractorService {
    extractTextFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number, // Added for clarity
        logger: Logger
    ): Promise<string>;
}

@singleton()
export class PageContentExtractorService implements IPageContentExtractorService {
    private readonly mainContentKeywords: string[];

    constructor(@inject(ConfigService) private configService: ConfigService) {
        this.mainContentKeywords = this.configService.config.MAIN_CONTENT_KEYWORDS ?? [];
    }

    public async extractTextFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number, // YEAR2 from original config
        logger: Logger
    ): Promise<string> {
        const currentLogContext = { url, useMainContentKeywords, function: 'extractTextFromUrl', service: 'PageContentExtractorService' };
        logger.trace({ ...currentLogContext, event: 'start' });

        if (!url || !/^(https?:\/\/|file:\/\/)/i.test(url)) {
            logger.warn({ ...currentLogContext, event: 'skipped_invalid_url_structure' });
            return "";
        }

        try {
            if (url.toLowerCase().endsWith(".pdf")) {
                logger.info({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_start' });
                const pdfText = await extractTextFromPDF(url, logger);
                logger.info({ ...currentLogContext, type: 'pdf', success: !!pdfText, event: 'pdf_extraction_finish' });
                return pdfText || "";
            }

            if (!page || page.isClosed()) {
                logger.error({ ...currentLogContext, type: 'html', event: 'html_processing_failed', reason: 'Page is null or closed' });
                throw new Error(`Page required for HTML extraction but was null or closed for URL: ${url}`);
            }
            logger.info({ ...currentLogContext, type: 'html', event: 'html_processing_start' });

            try {
                await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
            } catch (gotoError: unknown) {
                logger.error({ ...currentLogContext, type: 'html', err: gotoError, event: 'goto_failed' });
                return "";
            }

            let htmlContent: string;
            try {
                htmlContent = await page.content();
            } catch (contentError: unknown) {
                logger.error({ ...currentLogContext, type: 'html', err: contentError, event: 'fetch_content_failed' });
                return "";
            }

            let contentToProcess = htmlContent;
            if (useMainContentKeywords && this.mainContentKeywords.length > 0) {
                logger.trace({ ...currentLogContext, type: 'html', event: 'main_content_eval_start' });
                try {
                    if (page.isClosed()) throw new Error('Page closed before $$eval');
                    const extractedContentRaw: string | string[] = await page.$$eval("body *", (els, keywords) => {
                        const safeKeywords = Array.isArray(keywords) ? keywords.map(k => String(k).toLowerCase()) : [];
                        if (safeKeywords.length === 0) {
                            return document ? (document.body?.outerHTML || "") : "";
                        }
                        return els
                            .filter((el: Element) =>
                                el.hasAttributes() &&
                                Array.from(el.attributes).some((attr: Attr) =>
                                    safeKeywords.some((keyword: string) =>
                                        attr.name.toLowerCase().includes(keyword) ||
                                        attr.value.toLowerCase().includes(keyword)
                                    )
                                )
                            )
                            .map((el: Element) => el.outerHTML)
                            .join("\n\n");
                    }, this.mainContentKeywords);

                    const extractedContent = Array.isArray(extractedContentRaw) ? extractedContentRaw.join('\n\n') : extractedContentRaw;
                    if (extractedContent && extractedContent.length > 50) {
                        contentToProcess = extractedContent;
                        logger.trace({ ...currentLogContext, type: 'html', event: 'main_content_eval_success' });
                    } else {
                        logger.debug({ ...currentLogContext, type: 'html', event: 'main_content_eval_skipped', reason: 'No significant content found' });
                    }
                } catch (evalError: unknown) {
                    logger.warn({ ...currentLogContext, type: 'html', err: evalError, event: 'main_content_eval_failed' });
                }
            }

            logger.trace({ ...currentLogContext, type: 'html', event: 'dom_processing_start' });
            const document = cleanDOM(contentToProcess);
            if (!document?.body) {
                logger.warn({ ...currentLogContext, type: 'html', event: 'dom_processing_failed', reason: 'Cleaned DOM or body is null' });
                return "";
            }
            let fullText = traverseNodes(document.body as HTMLElement, acronym, yearToConsider);
            fullText = removeExtraEmptyLines(fullText);
            logger.info({ ...currentLogContext, type: 'html', success: true, textLength: fullText.length, event: 'html_processing_finish' });
            return fullText;

        } catch (error: unknown) {
            logger.error({ ...currentLogContext, err: error, event: 'unexpected_error' });
            return "";
        }
    }
}