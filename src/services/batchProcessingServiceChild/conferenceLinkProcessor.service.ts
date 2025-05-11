// src/services/batchProcessingServiceChild/conferenceLinkProcessor.service.ts
import { Page } from 'playwright';
import { Logger } from 'pino';
import { FileSystemService } from '../fileSystem.service';
import { IPageContentExtractorService } from './pageContentExtractor.service';
import { ConfigService } from '../../config/config.service';
import { ConferenceData, ConferenceUpdateData, BatchEntry } from '../../types/crawl.types';
import { addAcronymSafely } from '../../conference/11_utils';
import { normalizeAndJoinLink } from '../../utils/crawl/url.utils';
import { singleton, inject } from 'tsyringe';

export interface IConferenceLinkProcessorService {
    processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData, // Original ConferenceData
        year: number,
        existingAcronyms: Set<string>,
        logger: Logger
    ): Promise<BatchEntry | null>;

    processMainLinkForUpdate(
        page: Page,
        conference: ConferenceUpdateData,
        logger: Logger
    ): Promise<{ finalUrl: string | null; textPath: string | null }>;

    processCfpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        logger: Logger
    ): Promise<string | null>;

    processImpLinkForUpdate(
        page: Page | null,
        conference: ConferenceUpdateData,
        cfpResultPath: string | null,
        logger: Logger
    ): Promise<string | null>;

    // General purpose link processor, used by determination service
    processAndSaveGeneralLink(
        page: Page | null,
        linkToProcess: string | undefined,
        baseLink: string, // Normalized main website URL this link is relative to
        otherLinkForComparison: string | undefined | null, // e.g., if processing CFP, this is IMP
        acronym: string | undefined,
        contentType: 'cfp' | 'imp' | 'main', // 'main' for the main website itself
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string, // e.g., "acronym_main_determine"
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
        acronym: string | undefined,
        contentType: 'cfp' | 'imp' | 'main',
        useMainContentKeywords: boolean,
        fileBaseNamePrefix: string, // Example: "CONFACRO_main_determine_batch1"
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
            acronym,
            useMainContentKeywords,
            this.year2, // Assuming year2 is relevant for all extraction
            childLogger
        );

        if (!textContent || textContent.trim().length === 0) {
            childLogger.warn({ normalizedLinkProcessed: normalizedLink, event: 'no_content_extracted_from_general_link' });
            return null;
        }

        childLogger.trace({ normalizedLinkProcessed: normalizedLink, baseNameForSave: fileBaseNamePrefix, event: 'save_content_for_general_link_start' });
        // fileBaseNamePrefix already includes acronym, type, flow, batchIndex
        return await this.saveContentToFile(
            textContent,
            fileBaseNamePrefix,
            childLogger
        );
    }

    public async processInitialLinkForSave(
        page: Page,
        link: string,
        linkIndex: number,
        conference: ConferenceData,
        year: number,
        existingAcronyms: Set<string>,
        parentProcessLogger: Logger // <--- THAY ĐỔI: Nhận logger cha từ processConferenceSave
    ): Promise<BatchEntry | null> {
        const linkLogger = parentProcessLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processInitialLinkForSave',
            linkBeingProcessedIndex: linkIndex + 1,
            originalUrlForLink: link,
        });

        linkLogger.info({ event: 'single_link_processing_start' }, `Processing link ${linkIndex + 1}`);
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
            // batchIndex is not directly available here, it's managed by the orchestrator for API calls.
            // The filename for initial text can be simpler.
            const textFileBaseName = `${safeAcronym}_initial_${linkIndex}`;
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

            const acronymForEntry = `${conference.Acronym}_${linkIndex}`;
            const adjustedAcronym = await addAcronymSafely(existingAcronyms, acronymForEntry);
            let acronymWithoutIndex = adjustedAcronym.replace(/_\d+$/, '');

            const batchEntry: BatchEntry = {
                conferenceTitle: conference.Title,
                conferenceAcronym: acronymWithoutIndex,
                conferenceIndex: String(linkIndex),
                conferenceLink: finalLink, // URL after successful navigation and potential redirects
                conferenceTextPath: textPath,
                cfpLink: "", // Will be filled by determination service
                impLink: "", // Will be filled by determination service
            };

            linkLogger.info({ finalUrlProcessed: finalLink, textPath, adjustedAcronymUsed: adjustedAcronym, event: 'single_link_processing_success' });
            return batchEntry;

        } catch (error: any) {
            linkLogger.error({ originalUrl: link, err: error, event: 'single_link_processing_unhandled_error' });
            return null;
        }
    }

    public async processMainLinkForUpdate(
        page: Page, // Page is expected to be valid and open here
        conference: ConferenceUpdateData,
        parentLogger: Logger // <--- CHANGED: Receive parentLogger
    ): Promise<{ finalUrl: string | null; textPath: string | null }> {
        const url = conference.mainLink;
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processMainLinkForUpdate', // Sửa tên cho nhất quán
            linkTypeToProcess: 'main',
            initialUrl: url,
            conferenceAcronym: conference.Acronym // Thêm context
        });

        logger.info({ event: 'conference_link_processor_update_link_start' });
        let finalUrl: string | null = url;
        let textPath: string | null = null;

        if (!url) {
            // ĐỔI THÀNH ERROR VÀ EVENT SẼ ĐƯỢC MAP VÀO BATCH REJECTION
            logger.error({ event: 'conference_link_processor_link_missing_for_update', linkType: 'main', reason: 'Main link URL is missing for update process.' });
            return { finalUrl: null, textPath: null }; // Logic vẫn trả về, nhưng BatchProcessingService sẽ thấy lỗi này và có thể quyết định dừng
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'main' });

        try {
            if (page.isClosed()) {
                // EVENT CHO PLAYWRIGHT HANDLER
                logger.warn({ event: 'html_processing_failed', reason: 'Page already closed before goto', linkType: 'main' });
                // Không throw lỗi ở đây nếu pageContentExtractorService sẽ xử lý và log lỗi khi page closed
                // Tuy nhiên, nếu muốn dừng sớm, có thể throw
                return { finalUrl: null, textPath: null }; // Hoặc throw
            }

            const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
            finalUrl = page.url();
            logger.info({ finalUrlAfterGoto: finalUrl, status: response?.status(), event: 'conference_link_processor_navigation_success', linkType: 'main' });

            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page, finalUrl, conference.Acronym, false, this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'main' })
            );

            if (textContent && textContent.trim()) {
                const safeAcronym = (conference.Acronym || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
                const batchIndexForFile = (logger as any).bindings().batchIndex || 'unknownBatchIdx';
                const baseName = `${safeAcronym}_main_update_${batchIndexForFile}`;

                // saveContentToFile nên log 'save_batch_write_file_failed' nếu có lỗi
                textPath = await this.saveContentToFile(
                    textContent.trim(), baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'main' })
                );

                if (textPath) {
                    logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'main' });
                } else {
                    // Lỗi đã được log bởi saveContentToFile (nếu có)
                    logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'main' });
                }
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'main' });
                // Quyết định: Nội dung rỗng có làm fail batch không? Nếu có, log event lỗi nghiêm trọng.
                // Hiện tại, chỉ là warning.
            }
        } catch (error: any) {
            const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            if (error.message?.includes('Navigation timeout') || error.message?.includes('Target page, context or browser has been closed')) {
                logger.error({ finalUrlAtError: finalUrl, err: errDetails, event: 'goto_failed', linkType: 'main' });
            } else {
                // EVENT NÀY SẼ ĐƯỢC MAP VÀO BATCH REJECTION
                logger.error({ finalUrlAtError: finalUrl, err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'main' });
            }
            textPath = null;
            finalUrl = null;
        }
        return { finalUrl: finalUrl ?? null, textPath };
    }


    public async processCfpLinkForUpdate(
        page: Page | null, // Can be null for PDF
        conference: ConferenceUpdateData,
        parentLogger: Logger
    ): Promise<string | null> {
        const url = conference.cfpLink;
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processCfpLinkForUpdate',
            linkTypeToProcess: 'cfp',
            initialUrl: url,
            conferenceAcronym: conference.Acronym // Thêm context
        });
        let textPath: string | null = null;

        if (!url || url.trim().toLowerCase() === "none") {
            // NẾU VIỆC THIẾU CFP LÀ NGHIÊM TRỌNG
            // logger.error({ event: 'conference_link_processor_link_missing_for_update', linkType: 'cfp', reason: 'CFP link URL is missing or "none".' });
            // return null;
            // HIỆN TẠI: Coi CFP là tùy chọn, chỉ debug log
            logger.debug({ event: 'conference_link_processor_skipped_link_no_url_or_none', linkType: 'cfp' });
            return null;
        }
        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'cfp' });

        try {
            // `pageContentExtractorService.extractTextFromUrl` sẽ log các lỗi Playwright (goto_failed, fetch_content_failed, html_processing_failed)
            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page,
                url,
                conference.Acronym,
                true, // useMainContentKeywords = true for CFP
                this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'cfp' })
            );

            if (textContent && textContent.trim().length > 0) {
                const safeAcronym = (conference.Acronym || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
                // Cố gắng lấy batchIndex từ logger cha nếu có
                const batchIndexContext = (logger as any).bindings()?.batchIndex;
                const batchIndexForFile = batchIndexContext !== undefined ? String(batchIndexContext) : 'unknownBatchIdx';
                const baseName = `${safeAcronym}_cfp_update_${batchIndexForFile}`;

                // saveContentToFile nên log 'save_batch_write_file_failed' nếu có lỗi
                textPath = await this.saveContentToFile(
                    textContent,
                    baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'cfp' })
                );

                if (textPath) {
                    logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'cfp' });
                } else {
                    // Lỗi đã được log bởi saveContentToFile (nếu có) là 'save_batch_write_file_failed'
                    logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'cfp', reason: 'saveContentToFile returned null' });
                }
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'cfp' });
                // Quyết định: Nội dung CFP rỗng có làm fail batch không?
            }
        } catch (error: any) {
            const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            // EVENT NÀY SẼ ĐƯỢC MAP VÀO BATCH REJECTION (NẾU LỖI XỬ LÝ CFP LÀ NGHIÊM TRỌNG)
            logger.error({ err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'cfp' });
            textPath = null;
        }
        return textPath;
    }

    public async processImpLinkForUpdate(
        page: Page | null, // Can be null for PDF
        conference: ConferenceUpdateData,
        cfpResultPath: string | null,
        parentLogger: Logger
    ): Promise<string | null> {
        const url = conference.impLink;
        const logger = parentLogger.child({
            service: 'ConferenceLinkProcessorService',
            function: 'processImpLinkForUpdate',
            linkTypeToProcess: 'imp',
            initialUrl: url,
            conferenceAcronym: conference.Acronym // Thêm context
        });
        let textPath: string | null = null;

        if (!url || url.trim().toLowerCase() === "none") {
            // NẾU VIỆC THIẾU IMP LÀ NGHIÊM TRỌNG
            // logger.error({ event: 'conference_link_processor_link_missing_for_update', linkType: 'imp', reason: 'Important Dates link URL is missing or "none".' });
            // return null;
            // HIỆN TẠI: Coi IMP là tùy chọn, chỉ debug log
            logger.debug({ event: 'conference_link_processor_skipped_link_no_url_or_none', linkType: 'imp' });
            return null;
        }

        // Nếu IMP link giống CFP link và CFP đã được xử lý (có cfpResultPath), trả về ""
        // "" cho biết không cần xử lý lại nhưng cũng không phải lỗi.
        // Nếu cfpResultPath là null (CFP link không tồn tại hoặc xử lý lỗi), thì vẫn cần xử lý IMP riêng.
        if (url === conference.cfpLink && cfpResultPath !== null) {
            logger.info({ event: 'conference_link_processor_skipped_link_same_as_other', linkType: 'imp', otherLinkType: 'cfp', resolvedOtherPath: cfpResultPath });
            return ""; // Dấu hiệu đã xử lý (giống CFP)
        }

        logger.info({ event: 'conference_link_processor_update_link_start', linkType: 'imp' });
        try {
            // `pageContentExtractorService.extractTextFromUrl` sẽ log các lỗi Playwright
            const textContent = await this.pageContentExtractorService.extractTextFromUrl(
                page,
                url,
                conference.Acronym,
                false, // useMainContentKeywords = false for IMP
                this.year2,
                logger.child({ operation: 'extract_update_text', linkType: 'imp' })
            );

            if (textContent && textContent.trim().length > 0) {
                const safeAcronym = (conference.Acronym || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
                const batchIndexContext = (logger as any).bindings()?.batchIndex;
                const batchIndexForFile = batchIndexContext !== undefined ? String(batchIndexContext) : 'unknownBatchIdx';
                const baseName = `${safeAcronym}_imp_update_${batchIndexForFile}`;

                // saveContentToFile nên log 'save_batch_write_file_failed' nếu có lỗi
                textPath = await this.saveContentToFile(
                    textContent,
                    baseName,
                    logger.child({ operation: 'save_update_text', linkType: 'imp' })
                );

                if (textPath) {
                    logger.info({ filePath: textPath, event: 'conference_link_processor_content_saved', linkType: 'imp' });
                } else {
                    logger.warn({ event: 'conference_link_processor_content_save_failed_null_path', linkType: 'imp', reason: 'saveContentToFile returned null' });
                }
            } else {
                logger.warn({ event: 'conference_link_processor_content_empty', linkType: 'imp' });
                // Quyết định: Nội dung IMP rỗng có làm fail batch không?
            }
        } catch (error: any) {
            const errDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
            // EVENT NÀY SẼ ĐƯỢC MAP VÀO BATCH REJECTION (NẾU LỖI XỬ LÝ IMP LÀ NGHIÊM TRỌNG)
            logger.error({ err: errDetails, event: 'conference_link_processor_update_link_failed', linkType: 'imp' });
            textPath = null;
        }
        return textPath;
    }
}