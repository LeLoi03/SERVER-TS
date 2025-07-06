// src/services/batchProcessing/pageContentExtractor.service.ts
import { Page, Frame } from 'playwright';
import { Logger } from 'pino';
import { ConfigService } from '../../config/config.service';
import { extractTextFromPDF } from '../../utils/crawl/pdf.utils';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { autoScroll } from './utils';

// +++ THAY ĐỔI KIỂU DỮ LIỆU TRẢ VỀ +++
type ExtractedContent = {
    text: string;
    imageUrls: string[];
};


export interface IPageContentExtractorService {
    extractContentFromUrl( // <<< ĐỔI TÊN HÀM CHO RÕ NGHĨA HƠN
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<ExtractedContent>; // <<< THAY ĐỔI KIỂU TRẢ VỀ
}

@singleton()
export class PageContentExtractorService implements IPageContentExtractorService {
    private readonly excludeTexts: string[];
    private readonly cfpTabKeywords: string[];
    private readonly importantDatesTabs: string[];
    private readonly exactKeywords: string[];
    private readonly imageKeywords: string[]; // <<< THÊM MỚI
    private readonly MIN_CONTENT_LENGTH_FOR_RETRY = 1000;

    constructor(@inject(ConfigService) private configService: ConfigService) {
        this.excludeTexts = this.configService.excludeTexts ?? [];
        this.cfpTabKeywords = this.configService.cfpTabKeywords ?? [];
        this.importantDatesTabs = this.configService.importantDatesTabs ?? [];
        this.exactKeywords = this.configService.exactKeywords ?? [];
        this.imageKeywords = this.configService.imageKeywords ?? []; // <<< THÊM MỚI
    }

    /**
     * Core extraction logic. This function is designed to be called multiple times
     * (e.g., before and after scrolling).
     * @private
     */
    // +++ THAY ĐỔI HÀM _extractCore ĐỂ TRẢ VỀ OBJECT +++
    private async _extractCore(page: Page, acronym: string | undefined, yearToConsider: number, logger: Logger): Promise<ExtractedContent> {
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
            imageKeywords: this.imageKeywords, // <<< TRUYỀN TỪ KHÓA ẢNH
        };

        // +++ THÊM LOGIC LẤY URL ẢNH +++
        let allImageUrls: string[] = [];

        for (const frame of frames) {
            if (frame.isDetached()) {
                logger.trace({ ...currentLogContext, frameUrl: frame.url(), event: 'skipped_detached_frame' });
                continue;
            }

            const frameLogger = logger.child({ frameUrl: frame.url() });

            try {
                // Bước 1: Tiền xử lý DOM vẫn giữ nguyên, nó rất quan trọng
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

                    // --- BẮT ĐẦU ĐOẠN CODE CẦN THAY THẾ ---
                    document.querySelectorAll('del, s, strike').forEach(el => {
                        const text = el.textContent;
                        if (text && text.trim()) {
                            const trimmedText = text.trim();
                            const replacementSpan = document.createElement('span');

                            // Kiểm tra xem nội dung có chứa số hay không
                            const containsNumber = /\d/.test(trimmedText);

                            if (containsNumber) {
                                // Nếu có số (thường là ngày tháng), thêm ghi chú
                                replacementSpan.textContent = ` [Changed or passed: ${trimmedText}] `;
                            } else {
                                // Nếu không có số, chỉ giữ lại nội dung gốc
                                replacementSpan.textContent = ` ${trimmedText} `; // Thêm khoảng trắng để không bị dính chữ
                            }

                            // Thay thế thẻ <del>/<s> bằng thẻ <span> đã được xử lý
                            el.parentNode?.replaceChild(replacementSpan, el);
                        }
                    });
                    // --- KẾT THÚC ĐOẠN CODE CẦN THAY THẾ ---

                    // --- BẮT ĐẦU ĐOẠN CODE CẦN THAY THẾ ---
                    document.querySelectorAll('a').forEach(anchor => {
                        let effectiveHref = anchor.getAttribute('href'); // Bắt đầu với href gốc
                        const text = anchor.textContent;

                        // Nếu href là một placeholder (như '#', 'javascript:void(0);', etc.)
                        // thì thử tìm URL thật trong thuộc tính 'onclick'.
                        const hrefIsPlaceholder = !effectiveHref || effectiveHref.trim() === '#' || effectiveHref.trim().toLowerCase().startsWith('javascript:');

                        if (hrefIsPlaceholder) {
                            const onclickAttr = anchor.getAttribute('onclick');
                            if (onclickAttr) {
                                // Dùng regex để trích xuất URL từ các hàm như location.href='...', window.location='...'
                                const match = onclickAttr.match(/(?:location\.href|window\.location)\s*=\s*['"]([^'"]+)['"]/);
                                if (match && match[1]) {
                                    effectiveHref = match[1]; // Tìm thấy URL thật, gán lại cho effectiveHref
                                }
                            }
                        }

                        // Bây giờ, sử dụng effectiveHref (có thể là href gốc hoặc link từ onclick) để kiểm tra và thay thế
                        if (isRelevant(text, effectiveHref)) {
                            const replacementSpan = document.createElement('span');
                            // Sử dụng `effectiveHref` đã được xử lý
                            replacementSpan.textContent = ` href="${effectiveHref || ''}" - ${text?.trim()} `;
                            anchor.parentNode?.replaceChild(replacementSpan, anchor);
                        }
                    });
                    // --- KẾT THÚC ĐOẠN CODE CẦN THAY THẾ ---

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

                // BƯỚC 2: THAY ĐỔI CỐT LÕI - LUÔN LẤY TỪ BODY
                // Bỏ hoàn toàn logic try/catch với 'specialContentSelector'
                let frameText = "";
                try {
                    frameLogger.trace({ ...currentLogContext, event: 'extracting_text_from_body' }, "Extracting text from the entire body.");
                    // Luôn lấy text từ toàn bộ body của frame
                    frameText = await frame.locator('body').innerText({ timeout: 20000 });

                    if (frameText && frameText.trim()) {
                        frameLogger.debug({ ...currentLogContext, textLength: frameText.length, event: 'frame_text_extracted_from_body' });
                        fullText += frameText.trim() + '\n\n';
                    }
                } catch (bodyError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(bodyError);
                    frameLogger.warn({ ...currentLogContext, err: { message: errorMessage }, event: 'body_extraction_failed' }, `Could not extract text from frame's body: ${errorMessage}`);
                }


                // +++ LOGIC MỚI: LẤY URL ẢNH TỪ FRAME +++
                const frameImageUrls = await frame.evaluate((args) => {
                    const foundUrls = new Set<string>();
                    const { imageKeywords } = args;

                    document.querySelectorAll('img').forEach(img => {
                        if (foundUrls.size >= 2) return; // Lấy tối đa 2 ảnh

                        const src = img.getAttribute('src');
                        if (!src) return;

                        const alt = img.getAttribute('alt') || '';
                        const className = img.className || '';
                        const id = img.id || '';

                        const combinedAttributes = `${src} ${alt} ${className} ${id}`.toLowerCase();

                        const hasKeyword = imageKeywords.some(keyword => combinedAttributes.includes(keyword.toLowerCase()));

                        if (hasKeyword) {
                            try {
                                // Chuyển đổi URL tương đối thành tuyệt đối
                                const absoluteUrl = new URL(src, document.baseURI).href;
                                foundUrls.add(absoluteUrl);
                            } catch (e) {
                                // Bỏ qua nếu URL không hợp lệ
                            }
                        }
                    });
                    return Array.from(foundUrls);
                }, { imageKeywords: this.imageKeywords });

                allImageUrls.push(...frameImageUrls);


            } catch (e: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(e);
                frameLogger.warn({ ...currentLogContext, err: { message: errorMessage }, event: 'frame_processing_failed' }, `Could not process frame: ${errorMessage}`);
            }
        }
        const uniqueImageUrls = [...new Set(allImageUrls)].slice(0, 2); // Đảm bảo duy nhất và chỉ lấy 2
        logger.info({ foundImageCount: uniqueImageUrls.length, event: 'image_url_extraction_complete' });

        return {
            text: fullText.replace(/(\n\s*){3,}/g, '\n\n').trim(),
            imageUrls: uniqueImageUrls,
        };
    }


    // +++ SỬA LỖI: ĐỔI TÊN HÀM NÀY ĐỂ KHỚP VỚI INTERFACE +++
    public async extractContentFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<ExtractedContent> {
        // Thay đổi tên ở đây từ extractTextFromUrl thành extractContentFromUrl
        const currentLogContext = { url, acronym, useMainContentKeywords, yearToConsider, function: 'extractContentFromUrl', service: 'PageContentExtractorService' }; // Cập nhật tên hàm trong log context cho nhất quán
        logger.trace({ ...currentLogContext, event: 'extraction_start' }, `Starting content extraction for URL: ${url}.`);

        if (!url || !/^(https?:\/\/|file:\/\/)/i.test(url)) {
            logger.warn({ ...currentLogContext, event: 'skipped_invalid_url_structure' });
            return { text: "", imageUrls: [] };
        }

        try {
            if (url.toLowerCase().endsWith(".pdf")) {
                logger.info({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_start' }, "Attempting to extract text from PDF URL.");
                const pdfText = await extractTextFromPDF(url, logger.child({ operation: 'pdf_extract' }));
                if (pdfText) {
                    logger.info({ ...currentLogContext, type: 'pdf', textLength: pdfText.length, event: 'pdf_extraction_finish', success: true }, `PDF text extraction finished. Length: ${pdfText.length}.`);
                    return { text: pdfText, imageUrls: [] }; // PDF không có ảnh
                } else {
                    logger.warn({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_finish', success: false }, "PDF text extraction finished but no content was extracted.");
                    return { text: "", imageUrls: [] };
                }
            }

            if (!page || page.isClosed()) {
                const errorMsg = `Playwright page is null or closed for HTML extraction from URL: ${url}.`;
                logger.error({ ...currentLogContext, type: 'html', event: 'html_processing_failed', reason: 'Page is null or closed' }, errorMsg);
                throw new Error(errorMsg);
            }
            logger.info({ ...currentLogContext, type: 'html', event: 'html_processing_start' }, "Attempting to extract text from an already-loaded HTML page, including iframes.");

            // Attempt 1:
            let extractedContent = await this._extractCore(page, acronym, yearToConsider, logger);

            // Attempt 2:
            if (extractedContent.text.length < this.MIN_CONTENT_LENGTH_FOR_RETRY) {
                await autoScroll(page, logger);
                extractedContent = await this._extractCore(page, acronym, yearToConsider, logger);
            }

            logger.info({ ...currentLogContext, type: 'html', success: true, textLength: extractedContent.text.length, imageUrlCount: extractedContent.imageUrls.length, event: 'html_processing_finish_hybrid' });
            return extractedContent;

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger.error({ ...currentLogContext, err: { message: errorMessage, stack: errorStack }, event: 'unexpected_error' }, `An unexpected error occurred during content extraction: "${errorMessage}".`);
            return { text: "", imageUrls: [] };
        }
    }
}