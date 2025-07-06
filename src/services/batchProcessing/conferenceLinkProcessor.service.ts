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

// +++ CẬP NHẬT KIỂU DỮ LIỆU TRẢ VỀ +++
export type ProcessedContentResult = {
    path: string | null;
    content: string | null;
    imageUrls: string[]; // <<< THÊM MỚI
};

/**
 * Interface for the service responsible for processing and managing conference links.
 * This includes fetching content, saving it to files, and handling different link types
 * (initial, main, CFP, Important Dates) in both SAVE and UPDATE flows.
 */
export interface IConferenceLinkProcessorService {
    processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number,
        parentProcessLogger: Logger
    ): Promise<BatchEntry | null>;

    // +++ UPDATE THIS METHOD SIGNATURE +++
    processMainLinkForUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<{ finalUrl: string | null; textPath: string | null; textContent: string | null }>; // Add textContent

    // +++ UPDATE THIS METHOD SIGNATURE +++
    processCfpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<ProcessedContentResult>; // Use the new type

    // +++ UPDATE THIS METHOD SIGNATURE +++
    processImpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        cfpResultPath: string | null,
        parentLogger: Logger
    ): Promise<ProcessedContentResult>; // Use the new type

    processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined | null,
        baseLink: string,
        otherLinkForComparison: string | undefined | null,
        acronym: string | undefined,
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string,
        logger: Logger
    ): Promise<ProcessedContentResult>
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

    // +++ CẬP NHẬT HELPER +++
    private async saveContentAndGetResult(
        content: string,
        imageUrls: string[], // <<< THÊM THAM SỐ
        baseName: string,
        logger: Logger
    ): Promise<ProcessedContentResult> {
        const currentLogContext = { baseName, function: 'saveContentAndGetResult', service: 'ConferenceLinkProcessorService' };
        if (!content || content.trim().length === 0) {
            logger.trace({ ...currentLogContext, event: 'skipped_empty_content' });
            return { path: null, content: null, imageUrls: [] };
        }
        try {
            // FileSystemService will handle the production/development logic internally
            const filePath = await this.fileSystemService.saveTemporaryFile(content, baseName, logger);
            logger.trace({ ...currentLogContext, filePath, event: 'save_content_result' });
            // Return both the path (which will be null in prod) and the content
            return { path: filePath, content: content, imageUrls: imageUrls }; // <<< TRẢ VỀ CẢ URL ẢNH
        } catch (writeError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(writeError);
            logger.error({ ...currentLogContext, err: { message: errorMessage, stack: errorStack }, event: 'save_content_failed' });
            // Still return the content even if file write fails, so prod logic can continue
            return { path: null, content: content, imageUrls: imageUrls };
        }
    }

    public async processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined | null,
        baseLink: string,
        otherLinkForComparison: string | undefined | null,
        acronym: string | undefined,
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string,
        logger: Logger
    ): Promise<ProcessedContentResult> { // <--- CHANGE RETURN TYPE
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
            return { path: null, content: null, imageUrls: [] }; // <<< CẬP NHẬT
        }


        // === LOGIC SKIP ĐÃ ĐƯỢC HOÀN THIỆN ===
        if (contentType !== 'main') {
            // 1. PHỤC HỒI LOGIC KIỂM TRA TRÙNG VỚI LINK CHÍNH
            // So sánh chuỗi một cách chính xác. Nếu impLink giống hệt official website, bỏ qua.
            // Vì `normalizeAndJoinLink` đã trả về URL đầy đủ, phép so sánh này sẽ đúng cho cả
            // trường hợp "AJCAI" (trả về true) và "ANT" (trả về false).
            if (normalizedLink === baseLink) {
                childLogger.trace({ reason: `Link (${normalizedLink}) matches base website EXACTLY. Skipping.`, event: 'skipped_processing_general_link_as_base' });
                return { path: null, content: null, imageUrls: [] }; // <<< CẬP NHẬT

            }

            // 2. GIỮ LẠI LOGIC KIỂM TRA TRÙNG VỚI LINK PHỤ CÒN LẠI
            // Ví dụ: IMP vs CFP
            if (normalizedOtherLink && normalizedLink === normalizedOtherLink) {
                childLogger.trace({ reason: `Link (${normalizedLink}) matches other link EXACTLY (${normalizedOtherLink}). Skipping.`, event: 'skipped_processing_general_link_as_other' });
                return { path: null, content: null, imageUrls: [] }; // <<< CẬP NHẬT

            }
        }
        // === KẾT THÚC THAY ĐỔI ===

        if (!page || page.isClosed()) {
            childLogger.warn({ event: 'page_not_available_for_general_link_processing' });
            return { path: null, content: null, imageUrls: [] }; // <<< CẬP NHẬT

        }

        // Sử dụng hàm accessUrl đã được chuẩn hóa
        const accessResult: AccessResult = await accessUrl(page, normalizedLink, childLogger);
        if (!accessResult.success) { // Chỉ cần kiểm tra success là đủ
            const errorMessage = accessResult.error?.message ?? `HTTP status ${accessResult.response?.status()}`;
            childLogger.error({ err: { message: errorMessage }, event: 'general_link_access_failed' }, `Failed to navigate to general link: ${errorMessage}`);
            return { path: null, content: null, imageUrls: [] }; // <<< CẬP NHẬT

        }
        childLogger.info({ finalUrl: accessResult.finalUrl, event: 'general_link_access_success' });

        // +++ GỌI HÀM MỚI VÀ NHẬN KẾT QUẢ LÀ OBJECT +++
        const { text: textContent, imageUrls } = await this.pageContentExtractorService.extractContentFromUrl( // <<< ĐỔI TÊN HÀM
            page,
            accessResult.finalUrl!,
            acronym,
            useMainContentKeywords,
            this.year2,
            childLogger
        );

        if (!textContent || textContent.trim().length === 0) {
            childLogger.warn({ normalizedLinkProcessed: normalizedLink, event: 'no_content_extracted_from_general_link' });
            return { path: null, content: null, imageUrls: [] }; // <<< CẬP NHẬT

        }

        // +++ TRUYỀN URL ẢNH VÀO HELPER +++
        return await this.saveContentAndGetResult(textContent, imageUrls, fileBaseNamePrefix, childLogger);
    }

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

        const nextYear = year + 1;


        const yearStr = String(year);
        const nextYearStr = String(nextYear);

        const urlsToTry: string[] = [];

        if (link.includes(String(yearOld1))) {
            urlsToTry.push(link.replace(new RegExp(String(yearOld1), 'g'), yearStr));
            urlsToTry.push(link.replace(new RegExp(String(yearOld1), 'g'), nextYearStr));

        } else if (link.includes(String(yearOld2))) {
            urlsToTry.push(link.replace(new RegExp(String(yearOld2), 'g'), yearStr));
            urlsToTry.push(link.replace(new RegExp(String(yearOld2), 'g'), nextYearStr));

        } else if (link.includes(String(yearStr))) {
            urlsToTry.push(link.replace(new RegExp(String(yearStr), 'g'), nextYearStr));
        }

        urlsToTry.push(link);
        const uniqueUrlsToTry = [...new Set(urlsToTry)];

        for (const urlToTry of uniqueUrlsToTry) {
            try {
                const safeAcronym = (conference.Acronym || `conf-${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
                const textFileBaseName = `${safeAcronym}_item${batchItemIndexFromLogger}_link${linkIndex}_initialtext`;

                // +++ NHẬN KẾT QUẢ OBJECT TỪ processAndSaveGeneralLink +++
                const { path: textPath, content: textContent, imageUrls } = await this.processAndSaveGeneralLink(
                    page, urlToTry, urlToTry, null, conference.Acronym, 'main', false, textFileBaseName, linkLogger
                );

                if (textContent) { // We check for content, not path
                    const finalLink = page.url();

                    // +++++++++++++++++++++ BEGIN: LOGIC ĐIỀU CHỈNH MỚI +++++++++++++++++++++
                    // Chỉ áp dụng logic này cho các URL đã được thay thế, không phải URL gốc.
                    if (urlToTry !== link) {
                        let isInvalidRedirect = false;
                        // Sử dụng regex để tìm tất cả các số có 4 chữ số trong URL cuối cùng
                        const fourDigitNumbers = finalLink.match(/\b\d{4}\b/g);

                        if (fourDigitNumbers) {
                            for (const numStr of fourDigitNumbers) {
                                const yearInUrl = parseInt(numStr, 10);
                                // Kiểm tra nếu năm trong URL nhỏ hơn ngưỡng năm cũ thứ 2
                                if (yearInUrl < yearOld2) {
                                    linkLogger.warn({
                                        attemptedUrl: urlToTry,
                                        finalUrl: finalLink,
                                        detectedYear: yearInUrl,
                                        thresholdYear: yearOld2,
                                        event: 'invalid_redirect_to_old_year'
                                    }, `URL thay thế đã redirect tới một trang của năm cũ (${yearInUrl} < ${yearOld2}). Bỏ qua URL này.`);
                                    isInvalidRedirect = true;
                                    break; // Tìm thấy một năm không hợp lệ, không cần kiểm tra thêm
                                }
                            }
                        }

                        // Nếu URL bị đánh dấu là không hợp lệ, bỏ qua và thử URL tiếp theo
                        if (isInvalidRedirect) {
                            continue; // Bỏ qua lần lặp này và đi đến urlToTry tiếp theo
                        }
                    }
                    // ++++++++++++++++++++++ END: LOGIC ĐIỀU CHỈNH MỚI +++++++++++++++++++++++

                    linkLogger.info({ finalUrlProcessed: finalLink, textPath, hasContent: !!textContent, event: 'single_link_processing_success' });
                    return {
                        conferenceTitle: conference.Title,
                        conferenceAcronym: conference.Acronym,
                        mainLink: finalLink,
                        conferenceTextPath: textPath, // Will be null in prod
                        conferenceTextContent: textContent, // Will contain data in prod
                        imageUrls: imageUrls, // <<< THÊM VÀO BATCH ENTRY
                        originalRequestId: conference.originalRequestId,
                        linkOrderIndex: linkIndex,
                    };
                }
                // Nếu textContent là null, vòng lặp sẽ tự động thử URL tiếp theo.
                linkLogger.warn({ urlAttempted: urlToTry, event: 'initial_link_attempt_failed_no_content' }, `Attempt to process ${urlToTry} resulted in no content, trying next URL if available.`);

            } catch (error: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(error);
                linkLogger.error({ urlAttempted: urlToTry, err: { message: errorMessage }, event: 'initial_link_attempt_unhandled_error' });
            }
        }

        linkLogger.error({ event: 'all_initial_link_attempts_failed' }, "All attempts to process initial link failed.");
        return null;
    }

    public async processMainLinkForUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<{ finalUrl: string | null; textPath: string | null; textContent: string | null; imageUrls: string[] }> { // <<< CẬP NHẬT KIỂU TRẢ VỀ
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
            return { finalUrl: null, textPath: null, textContent: null, imageUrls: [] }; // <<< CẬP NHẬT
        }

        const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
        const baseName = `${safeAcronym}_main_update_item${batchItemIndexFromLogger}`;

        // Lấy cả 3 giá trị từ hàm helper
        const { path: textPath, content: textContent, imageUrls } = await this.processAndSaveGeneralLink(
            page, conference.mainLink, conference.mainLink!, null, conference.Acronym, 'main', false, baseName, logger
        );

        if (textContent) {
            // Trả về cả imageUrls
            return { finalUrl: page.url(), textPath, textContent, imageUrls }; // <<< CẬP NHẬT
        } else {
            return { finalUrl: null, textPath: null, textContent: null, imageUrls: [] }; // <<< CẬP NHẬT
        }
    }

    public async processCfpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<ProcessedContentResult> { // <<< SỬ DỤNG LẠI TYPE CHUNG
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

        // processAndSaveGeneralLink sẽ trả về imageUrls là mảng rỗng nếu không tìm thấy gì
        const result = await this.processAndSaveGeneralLink(
            page, conference.cfpLink, conference.mainLink!, null, conference.Acronym, 'cfp', true, baseName, logger
        );

        // Đơn giản là trả về toàn bộ kết quả
        return result;
    }



    public async processImpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        cfpResultPath: string | null, // Giữ lại để so sánh link
        parentLogger: Logger
    ): Promise<ProcessedContentResult> { // <<< SỬ DỤNG LẠI TYPE CHUNG
        const batchItemIndexFromLogger = parentLogger.bindings().batchItemIndex as number | string || 'itemX_update_imp';
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processImpLinkForUpdate',
            linkTypeToProcess: 'imp',
            initialUrl: conference.impLink,
            conferenceAcronym: conference.Acronym,
            batchItemIndex: batchItemIndexFromLogger,
        });

        // Logic kiểm tra trùng link vẫn cần thiết và hoạt động đúng
        if (conference.impLink && conference.impLink === conference.cfpLink) {
            logger.info({ event: 'conference_link_processor_skipped_link_same_as_other', link: conference.impLink });
            // Trả về một kết quả "trống" nhưng hợp lệ
            return { path: null, content: null, imageUrls: [] };
        }

        const safeAcronym = (conference.Acronym || `unknown_item${batchItemIndexFromLogger}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
        const baseName = `${safeAcronym}_imp_update_item${batchItemIndexFromLogger}`;

        const result = await this.processAndSaveGeneralLink(
            page, conference.impLink, conference.mainLink!, conference.cfpLink, conference.Acronym, 'imp', false, baseName, logger
        );

        return result;
    }
}