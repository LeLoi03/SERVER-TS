import { Page, Frame } from 'playwright'; // <-- Thêm 'Frame' vào import
import { Logger } from 'pino';
import { ConfigService } from '../../config/config.service';
import { IPdfExtractorService } from './pdfExtractor.service';
import { singleton, inject } from 'tsyringe';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { autoScroll } from './utils';
import { IDomTransformationService, IDomTransformationArgs } from './domTransformation.service';
import { IFrameTextExtractorService } from './frameTextExtractor.service';
import { IImageUrlExtractorService } from './imageUrlExtractor.service';
import { withOperationTimeout } from './utils';

type ExtractedContent = {
    text: string;
    imageUrls: string[];
};

export interface IPageContentExtractorService {
    extractContentFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<ExtractedContent>;
}

@singleton()
export class PageContentExtractorService implements IPageContentExtractorService {
    private readonly excludeTexts: string[];
    private readonly cfpTabKeywords: string[];
    private readonly importantDatesTabs: string[];
    private readonly exactKeywords: string[];
    private readonly imageKeywords: string[];
    private readonly MIN_CONTENT_LENGTH_FOR_RETRY = 1000;
    // +++ THÊM HẰNG SỐ GIỚI HẠN ĐỘ SÂU +++
    private readonly MAX_FRAME_DEPTH = 10; // Giới hạn an toàn là 10 cấp

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject('IPdfExtractorService') private pdfExtractorService: IPdfExtractorService,
        @inject('IDomTransformationService') private domTransformationService: IDomTransformationService,
        @inject('IFrameTextExtractorService') private frameTextExtractorService: IFrameTextExtractorService,
        @inject('IImageUrlExtractorService') private imageUrlExtractorService: IImageUrlExtractorService
    ) {
        this.excludeTexts = this.configService.excludeTexts ?? [];
        this.cfpTabKeywords = this.configService.cfpTabKeywords ?? [];
        this.importantDatesTabs = this.configService.importantDatesTabs ?? [];
        this.exactKeywords = this.configService.exactKeywords ?? [];
        this.imageKeywords = this.configService.imageKeywords ?? [];
    }

    // +++ CẬP NHẬT HÀM ĐỆ QUY VỚI GIỚI HẠN ĐỘ SÂU +++

    private _getAllFramesRecursively(frame: Frame, logger: Logger, currentDepth: number): Frame[] {
        // Điều kiện dừng 1: Nếu đã đạt đến độ sâu tối đa
        if (currentDepth >= this.MAX_FRAME_DEPTH) {
            logger.warn({
                frameUrl: frame.url(),
                depth: currentDepth,
                event: 'max_frame_depth_reached'
            }, `Reached max frame depth limit of ${this.MAX_FRAME_DEPTH}. Stopping recursion here.`);
            return [frame]; // Trả về frame hiện tại nhưng không đi sâu hơn
        }

        let allFrames = [frame];
        try {
            const childFrames = frame.childFrames();
            for (const childFrame of childFrames) {
                // Gọi đệ quy và tăng độ sâu lên 1
                const nestedFrames = this._getAllFramesRecursively(childFrame, logger, currentDepth + 1);
                allFrames.push(...nestedFrames);
            }
        } catch (e) {
            // Bỏ qua lỗi nếu không thể truy cập frame con
        }
        return allFrames;
    }

    /**
     * Core extraction logic. This function is now an orchestrator.
     * @private
     */
    private async _extractCore(page: Page, acronym: string | undefined, yearToConsider: number, logger: Logger): Promise<ExtractedContent> {
        const currentLogContext = { function: '_extractCore', service: 'PageContentExtractorService' };
        let fullText = "";
        let allImageUrls: string[] = [];

        // +++ CẬP NHẬT LỜI GỌI HÀM ĐỂ BẮT ĐẦU VỚI ĐỘ SÂU LÀ 0 +++
        const frames = this._getAllFramesRecursively(page.mainFrame(), logger, 0);


        logger.debug({ ...currentLogContext, frameCount: frames.length, event: 'core_extraction_start' }, `Starting core extraction for ${frames.length} frame(s) (including nested).`);

        const transformationArgs: IDomTransformationArgs = {
            acronym: (acronym || "").toLowerCase().trim(),
            year: String(yearToConsider),
            excludeTexts: this.excludeTexts,
            cfpTabKeywords: this.cfpTabKeywords,
            importantDatesTabs: this.importantDatesTabs,
            exactKeywords: this.exactKeywords,
        };

        // +++ THAY ĐỔI LỚN: XỬ LÝ FRAME SONG SONG VỚI TIMEOUT RIÊNG +++
        const FRAME_PROCESSING_TIMEOUT_MS = 10000; // 20 giây cho mỗi frame

        const frameProcessingPromises = frames.map(async (frame) => {
            const frameLogger = logger.child({ frameUrl: frame.url() });
            if (frame.isDetached()) {
                frameLogger.trace({ ...currentLogContext, event: 'skipped_detached_frame' });
                return { text: "", imageUrls: [] };
            }

            try {
                // Bọc toàn bộ logic xử lý frame trong withOperationTimeout
                return await withOperationTimeout(
                    (async () => {
                        await this.domTransformationService.transformFrame(frame, transformationArgs, frameLogger);

                        const [frameText, frameImageUrls] = await Promise.all([
                            this.frameTextExtractorService.extractTextFromFrame(frame, frameLogger),
                            this.imageUrlExtractorService.extractImageUrlsFromFrame(frame, this.imageKeywords)
                        ]);

                        let processedText = frameText;
                        if (frame.parentFrame() && frameText.trim()) {
                            processedText = `iframe="${frame.url()}"\n\n${frameText}`;
                        }

                        return { text: processedText, imageUrls: frameImageUrls };
                    })(),
                    FRAME_PROCESSING_TIMEOUT_MS,
                    `Process frame: ${frame.url()}`
                );
            } catch (e: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(e);
                frameLogger.warn({ ...currentLogContext, err: { message: errorMessage }, event: 'frame_processing_failed_or_timed_out' }, `Could not process frame: ${errorMessage}`);
                return { text: "", imageUrls: [] }; // Trả về kết quả rỗng nếu có lỗi hoặc timeout
            }
        });



        // Chờ tất cả các promise xử lý frame hoàn thành (kể cả khi một vài cái bị lỗi)
        const settledResults = await Promise.allSettled(frameProcessingPromises);

        settledResults.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                if (result.value.text) {
                    fullText += result.value.text;
                }
                if (result.value.imageUrls.length > 0) {
                    allImageUrls.push(...result.value.imageUrls);
                }
            } else if (result.status === 'rejected') {
                logger.error({ ...currentLogContext, err: result.reason, event: 'frame_promise_rejected' });
            }
        });
        // +++ KẾT THÚC THAY ĐỔI +++


        const uniqueImageUrls = [...new Set(allImageUrls)].slice(0, 2);
        logger.info({ foundImageCount: uniqueImageUrls.length, event: 'image_url_extraction_complete' });

        return {
            text: fullText.replace(/(\n\s*){3,}/g, '\n\n').trim(),
            imageUrls: uniqueImageUrls,
        };
    }

    public async extractContentFromUrl(
        page: Page | null,
        url: string,
        acronym: string | undefined,
        useMainContentKeywords: boolean,
        yearToConsider: number,
        logger: Logger
    ): Promise<ExtractedContent> {
        // ... (Phần còn lại của hàm này không cần thay đổi)
        const currentLogContext = { url, acronym, useMainContentKeywords, yearToConsider, function: 'extractContentFromUrl', service: 'PageContentExtractorService' };
        logger.trace({ ...currentLogContext, event: 'extraction_start' }, `Starting content extraction for URL: ${url}.`);

        if (!url || !/^(https?:\/\/|file:\/\/)/i.test(url)) {
            logger.warn({ ...currentLogContext, event: 'skipped_invalid_url_structure' });
            return { text: "", imageUrls: [] };
        }

        try {
            if (url.toLowerCase().endsWith(".pdf")) {
                logger.info({ ...currentLogContext, type: 'pdf', event: 'pdf_extraction_start' }, "Attempting to extract text from PDF URL.");
                const pdfText = await this.pdfExtractorService.extractTextFromPDF(url, logger.child({ operation: 'pdf_extract' }));
                if (pdfText) {
                    logger.info({ ...currentLogContext, type: 'pdf', textLength: pdfText.length, event: 'pdf_extraction_finish', success: true }, `PDF text extraction finished. Length: ${pdfText.length}.`);
                    return { text: pdfText, imageUrls: [] };
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