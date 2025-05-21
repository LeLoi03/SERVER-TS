// src/services/batchProcessingServiceChild/conferenceLinkProcessor.service.ts
import { Page } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { IPageContentExtractorService } from './pageContentExtractor.service';
import { ConfigService } from '../../config/config.service';
import { ConferenceData, ConferenceUpdateData, BatchEntry } from '../../types/crawl.types'; // Đảm bảo BatchEntry có linkOrderIndex
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject } from 'tsyringe';

export interface IConferenceLinkProcessorService {
    processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number,
        parentLogger: Logger // Logger này từ BatchProcessingService, có batchRequestId và batchItemIndex
    ): Promise<BatchEntry | null>;

    processMainLinkForUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<{ finalUrl: string | null; textPath: string | null }>;

    processCfpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<string | null>;

    processImpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        cfpResultPath: string | null,
        parentLogger: Logger
    ): Promise<string | null>;

    processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined,
        baseLink: string,
        otherLinkForComparison: string | undefined | null,
        acronym: string | undefined, // Acronym này nên là acronym gốc hoặc đã được an toàn hóa bởi nơi gọi
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string, // Ví dụ: "CONFACRO_final_itemX_main_determine"
        logger: Logger
    ): Promise<string | null>;
}

@singleton()
export class ConferenceLinkProcessorService implements IConferenceLinkProcessorService {
    private readonly year2: number;

    constructor(
        @inject(FileSystemService) private fileSystemService: FileSystemService,
        @inject('IPageContentExtractorService') private pageContentExtractorService: IPageContentExtractorService,
        @inject(ConfigService) private configService: ConfigService
    ) {
        this.year2 = this.configService.config.YEAR2;
    }

    // --- Helper ---
    private async saveContentToFile(
        content: string,
        baseName: string,
        logger: Logger
    ): Promise<string | null> {
        const currentLogContext = { baseName, function: 'saveContentToFile', service: 'ConferenceLinkProcessorService' };
        if (!content || content.trim().length === 0) {
            logger.trace({ ...currentLogContext, event: 'skipped_empty_content' });
            return null;
        }
        try {
            const filePath = await this.fileSystemService.saveTemporaryFile(content, baseName, logger);
            logger.trace({ ...currentLogContext, filePath, event: 'success' });
            return filePath;
        } catch (writeError: unknown) {
            logger.error({ ...currentLogContext, err: writeError, event: 'failed' });
            return null;
        }
    }

    public async processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined,
        baseLink: string,
        otherLinkForComparison: string | undefined | null,
        acronym: string | undefined, // Acronym truyền vào đây nên là acronym đã được "an toàn hóa" nếu cần
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string, // Ví dụ: "CONFACRO_final_itemX_main_determine" (đã có itemIndex và có thể là acronym an toàn)
        logger: Logger
    ): Promise<string | null> {
        const childLogger = logger.child({
            service: 'ConferenceLinkProcessorService',
            linkProcessingFunction: 'processAndSaveGeneralLink',
            contentTypeProcessing: contentType,
            processingUrlInput: linkToProcess,
        });

        const normalizedLink = normalizeAndJoinLink(baseLink, linkToProcess, childLogger);
        const normalizedOtherLink = normalizeAndJoinLink(baseLink, otherLinkForComparison, childLogger);

        if (!normalizedLink) {
            childLogger.trace({ reason: 'Link is empty, None, or could not be normalized', normalizedLinkAttempted: linkToProcess, event: 'skipped_processing_general_link' });
            return null;
        }
        // For 'main' type, it's okay if it's the same as baseLink (it usually is initially)
        // For 'cfp'/'imp', skip if it's same as base or other
        if (contentType !== 'main') {
            if (normalizedLink === baseLink) {
                childLogger.trace({ reason: `Link matches base website (${baseLink})`, event: 'skipped_processing_general_link' });
                return null;
            }
            if (normalizedOtherLink && normalizedLink === normalizedOtherLink) {
                childLogger.trace({ reason: `Link matches ${contentType === 'cfp' ? 'imp' : 'cfp'} link (${normalizedOtherLink})`, event: 'skipped_processing_general_link' });
                return null;
            }
        }

        childLogger.trace({ normalizedLinkToProcess: normalizedLink, event: 'extract_text_from_general_link_start' });

        const textContent = await this.pageContentExtractorService.extractTextFromUrl(
            page,
            normalizedLink,
            acronym, // Sử dụng acronym được truyền vào
            useMainContentKeywords,
            this.year2,
            childLogger
        );

        if (!textContent || textContent.trim().length === 0) {
            childLogger.warn({ normalizedLinkProcessed: normalizedLink, event: 'no_content_extracted_from_general_link' });
            return null;
        }

        childLogger.trace({ normalizedLinkProcessed: normalizedLink, baseNameForSave: fileBaseNamePrefix, event: 'save_content_for_general_link_start' });
        return await this.saveContentToFile(
            textContent,
            fileBaseNamePrefix, // fileBaseNamePrefix đã được tạo ở nơi gọi, bao gồm ID cần thiết
            childLogger
        );
    }

    public async processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number,
        // existingAcronyms: Set<string>, // ++ BỎ THAM SỐ NÀY
        parentProcessLogger: Logger
    ): Promise<BatchEntry | null> {
        const batchItemIndexFromLogger = parentProcessLogger.bindings().batchItemIndex as number | string || 'unknownItemIdx';
        const linkLogger = parentProcessLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processInitialLinkForSave',
            linkBeingProcessedIndex: linkIndex + 1,
            originalUrlForLink: link,
        });

        linkLogger.info({ event: 'single_link_processing_start' }, `Processing link ${linkIndex + 1} for item ${batchItemIndexFromLogger}`);
        let finalLink: string = link;
        let useModifiedLink: boolean = false;
        let modifiedLink: string = link;
        let accessSuccess = false;
        let accessError: Error | null = null;
        let responseStatus: number | null = null;

        try {
            const yearOld1 = year - 1;
            const yearOld2 = year - 2;
            const yearStr = String(year);

            if (link.includes(String(yearOld1))) {
                modifiedLink = link.replace(new RegExp(String(yearOld1), 'g'), yearStr);
                useModifiedLink = true;
            } else if (link.includes(String(yearOld2))) {
                modifiedLink = link.replace(new RegExp(String(yearOld2), 'g'), yearStr);
                useModifiedLink = true;
            }

            if (useModifiedLink) {
                linkLogger.info({ urlToAccess: modifiedLink, event: 'access_attempt_modified_link' });
                try {
                    const response = await page.goto(modifiedLink, { waitUntil: "domcontentloaded", timeout: 15000 });
                    responseStatus = response?.status() ?? null;
                    if (response && response.ok()) {
                        finalLink = page.url(); // page.url() is the reliable source after goto
                        linkLogger.info({ accessedUrl: modifiedLink, status: responseStatus, finalUrlAfterAccess: finalLink, event: 'access_modified_link_success' });
                        accessSuccess = true;
                    } else {
                        accessError = new Error(`HTTP ${responseStatus} accessing modified link: ${modifiedLink}`);
                        linkLogger.warn({ accessedUrl: modifiedLink, status: responseStatus, event: 'access_modified_link_failed_http_status' });
                    }
                } catch (error: any) {
                    accessError = error;
                    linkLogger.warn({ accessedUrl: modifiedLink, err: error, event: 'access_modified_link_failed_exception' });
                }
            }

            if (!accessSuccess) {
                finalLink = link; // Reset to original if modified failed or wasn't attempted
                useModifiedLink = false;
                linkLogger.info({ urlToAccess: link, event: 'access_attempt_original_link' });
                try {
                    const response = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
                    responseStatus = response?.status() ?? null;
                    if (response && response.ok()) {
                        finalLink = page.url();
                        linkLogger.info({ accessedUrl: link, status: responseStatus, finalUrlAfterAccess: finalLink, event: 'access_original_link_success' });
                        accessSuccess = true;
                    } else {
                        accessError = new Error(`HTTP ${responseStatus} accessing original link: ${link}`);
                        linkLogger.error({ accessedUrl: link, status: responseStatus, event: 'access_original_link_failed_http_status' });
                    }
                } catch (error: any) {
                    accessError = error;
                    linkLogger.error({ accessedUrl: link, err: error, event: 'access_original_link_failed_exception' });
                }
            }

            if (!accessSuccess) {
                // linkLogger.fatal("DEBUG: Entering !accessSuccess block for 'single_link_processing_failed_to_access_link'"); // DEBUG
                linkLogger.error({ finalAttemptedUrl: finalLink, errMessage: accessError?.message, finalStatus: responseStatus, event: 'single_link_processing_failed_to_access_link' });
                return null;
            }
            // At this point, finalLink is the URL of the successfully loaded page
            linkLogger.info({ finalUrlAfterAllAccessAttempts: finalLink, event: 'link_access_final_success' });

            // Extract text from finalLink (which is already the URL of the current page content)
            // For initial save, useMainContentKeywords is false.
            const fullText = await this.pageContentExtractorService.extractTextFromUrl(
                page, // Page is already at finalLink
                finalLink, // Pass finalLink for context, though page.goto was already done
                conference.Acronym,
                false, // For initial SAVE flow, typically don't use main content keywords
                year, // Pass the processing year
                linkLogger.child({ operation: 'extract_initial_text' })
            );

            if (!fullText || fullText.trim().length === 0) {
                linkLogger.warn({ event: 'no_text_extracted_after_dom_processing' });
                return null;
            }

            const safeAcronym = (conference.Acronym || `conf-${linkIndex}`).replace(/[^a-zA-Z0-9_.-]/g, '-');
            const textFileBaseName = `${safeAcronym}_item${batchItemIndexFromLogger}_link${linkIndex}_initialtext`;
            const textPath = await this.saveContentToFile(
                fullText,
                textFileBaseName,
                linkLogger.child({ operation: 'save_initial_text' })
            );

            if (!textPath) {
                linkLogger.error({ baseName: textFileBaseName, event: 'failed_to_save_initial_text' });
                return null;
            }
            linkLogger.debug({ filePath: textPath, event: 'initial_text_saved_successfully' });

            // ++ BỎ PHẦN addAcronymSafely ở đây
            // const acronymForEntryBasedOnLink = `${conference.Acronym}_link${linkIndex}`;
            // const adjustedAcronymForEntry = await addAcronymSafely(existingAcronyms, acronymForEntryBasedOnLink); // Bỏ

            const batchEntry: BatchEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: conference.Acronym, // Luôn sử dụng Acronym gốc ở đây
                conferenceLink: finalLink,
                conferenceTextPath: textPath,
                originalRequestId: conference.originalRequestId, // Đã truyền đúng
                linkOrderIndex: linkIndex,                      // Đã truyền đúng
            };

            linkLogger.info({
                finalUrlProcessed: finalLink, textPath,
                // createdAcronymForEntry: adjustedAcronymForEntry, // Bỏ log này
                event: 'single_link_processing_success'
            });
            return batchEntry;

        } catch (error: any) {
            // linkLogger.fatal("DEBUG: Entering CATCH block for 'single_link_processing_unhandled_error'"); // DEBUGF
            linkLogger.error({ originalUrl: link, err: error, event: 'single_link_processing_unhandled_error' });
            return null;
        }
    }


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
            conferenceAcronym: conference.Acronym
        });

        let finalUrl: string | null = conference.mainLink;
        let textPath: string | null = null;

        if (!conference.mainLink) {
            logger.error({ event: 'conference_link_processor_link_missing_for_update', linkType: 'main' });
            return { finalUrl: null, textPath: null };
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'main' });

        try {
            if (page.isClosed()) {
                logger.warn({ event: 'html_processing_failed', reason: 'Page already closed', linkType: 'main' });
                return { finalUrl: null, textPath: null };
            }
            const response = await page.goto(conference.mainLink, { waitUntil: "domcontentloaded", timeout: 45000 });
            finalUrl = page.url();
            logger.info({ finalUrlAfterGoto: finalUrl, status: response?.status(), event: 'conference_link_processor_navigation_success', linkType: 'main' });

            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, finalUrl, conference.Acronym, false, this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'main' })
            );

            if (textContent && textContent.trim()) {
                const safeAcronym = (conference.Acronym || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_main_update_item${batchItemIndexFromLogger}`; // ++ Sửa tên file
                textPath = await this.saveContentToFile(
                    textContent.trim(), baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'main' })
                );
                if (textPath) logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'main' });
                else logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'main' });
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'main' });
            }
        } catch (error: any) {
            const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            if (error.message?.includes('Navigation timeout') || error.message?.includes('Target page, context or browser has been closed')) {
                logger.error({ finalUrlAtError: finalUrl, err: errDetails, event: 'goto_failed', linkType: 'main' });
            } else {
                logger.error({ finalUrlAtError: finalUrl, err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'main' });
            }
            textPath = null;
            finalUrl = null; // Đặt finalUrl về null nếu có lỗi nghiêm trọng
        }
        return { finalUrl: finalUrl ?? null, textPath };
    }



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
            conferenceAcronym: conference.Acronym
        });
        let textPath: string | null = null;

        if (!conference.cfpLink || conference.cfpLink.trim().toLowerCase() === "none") {
            logger.debug({ event: 'conference_link_processor_skipped_link_no_url_or_none', linkType: 'cfp' });
            return null;
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'cfp' });

        try {
            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, conference.cfpLink, conference.Acronym, true, this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'cfp' })
            );
            if (textContent && textContent.trim().length > 0) {
                const safeAcronym = (conference.Acronym || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_cfp_update_item${batchItemIndexFromLogger}`; // ++ Sửa tên file
                textPath = await this.saveContentToFile(
                    textContent, baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'cfp' })
                );
                if (textPath) logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'cfp' });
                else logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'cfp' });
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'cfp' });
            }
        } catch (error: any) {
            const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            logger.error({ err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'cfp' });
            textPath = null;
        }
        return textPath;
    }

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
            conferenceAcronym: conference.Acronym
        });
        let textPath: string | null = null;

        if (!conference.impLink || conference.impLink.trim().toLowerCase() === "none") {
            logger.debug({ event: 'conference_link_processor_skipped_link_no_url_or_none', linkType: 'imp' });
            return null;
        }
        if (conference.impLink === conference.cfpLink && cfpResultPath !== null) {
            logger.info({ event: 'conference_link_processor_skipped_link_same_as_other', linkType: 'imp', otherLinkType: 'cfp' });
            return "";
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'imp' });

        try {
            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, conference.impLink, conference.Acronym, false, this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'imp' })
            );
            if (textContent && textContent.trim().length > 0) {
                const safeAcronym = (conference.Acronym || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_imp_update_item${batchItemIndexFromLogger}`; // ++ Sửa tên file
                textPath = await this.saveContentToFile(
                    textContent, baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'imp' })
                );
                if (textPath) logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'imp' });
                else logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'imp' });
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'imp' });
            }
        } catch (error: any) {
            const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            logger.error({ err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'imp' });
            textPath = null;
        }
        return textPath;
    }
}