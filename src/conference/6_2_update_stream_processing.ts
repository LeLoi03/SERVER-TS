// 6_2_update_batch_processing.ts
import fs from 'fs';
import path from 'path';
import { Page, BrowserContext } from 'playwright'; // Import Playwright types

// Local Utils & Types
import { logger as defaultLogger, readContentFromFile, writeTempFile } from './11_utils'; // Consolidate local imports
import { BatchEntry, BatchUpdateEntry, ConferenceUpdateData } from './types'; // Assuming ProcessedResponseData exists or define it
import { LogContextBase } from './5_playwright_utils'; // Import the base log context type

// Domain Logic Imports
import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing';
import { extract_information_api, cfp_extraction_api } from './7_gemini_api_utils';
import { init as initDataManager } from './8_data_manager'; // Rename init import
import { fetchContentWithRetry, extractTextFromUrl, saveContentToTempFile } from './5_playwright_utils';

// Config
import { YEAR2, API_TYPE_CFP, API_TYPE_EXTRACT } from '../config';

// Constants
const BATCHES_DIR = path.join(__dirname, "./data/batches");
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
const ERROR_ACCESS_LINK_LOG_PATH: string = path.join(__dirname, "./data/error_access_link_log.txt");

// Type alias for logger
type Logger = typeof defaultLogger;

// --- Specific Log Context Type for this Module ---
interface BatchProcessingLogContext extends LogContextBase {
    // Fields specific to batch processing
    fileType?: 'full_links' | 'main_link' | 'update_intermediate';
    aggregationPurpose?: 'determine_api' | 'extract_cfp_api';
    apiType?: 'determine' | 'extract' | 'cfp';
    contentType?: 'main' | 'cfp' | 'imp';
    event_group?: string; // Keep for grouping logs

    // --- Add fields specific to link processing context ---
    linkIndex?: number;      // <<< ADDED: Index of the link being processed
    originalUrl?: string;    // <<< ADDED: The original URL before potential modification
    url?: string;            // Optional: Could be used for current URL being accessed
    finalUrl?: string;       // Optional: Could be used for final URL after redirects
    linkType?: 'main' | 'cfp' | 'imp' | 'modified' | 'original'; // Optional: Type of link being processed
    // Add any other fields frequently added to the context within link processing loops
}
// --- Helper Functions ---

/**
 * Ensures necessary directories exist.
 */
async function ensureDirectories(paths: string[], logger: Logger, logContext: object): Promise<void> {
    for (const dirPath of paths) {
        const dir = path.dirname(dirPath); // Get directory part of the path
        if (!fs.existsSync(dir)) {
            logger.info({ ...logContext, path: dir, event: 'ensure_dir_create' }, `Creating directory`);
            try {
                await fs.promises.mkdir(dir, { recursive: true });
            } catch (mkdirError: unknown) {
                logger.error({ ...logContext, path: dir, err: mkdirError, event: 'ensure_dir_create_failed' }, `Error creating directory`);
                throw mkdirError; // Re-throw critical error
            }
        }
    }
}

/**
 * Reads content from multiple text paths specified in batch entries.
 * Returns an object mapping contentType to its content.
 */
async function readBatchContentFiles(
    entry: { conferenceTextPath?: string | null, cfpTextPath?: string | null, impTextPath?: string | null },
    logger: Logger,
    logContext: object
): Promise<{ mainText: string; cfpText: string; impText: string }> {
    const content: { mainText: string; cfpText: string; impText: string } = { mainText: '', cfpText: '', impText: '' };
    const readPromises: Promise<void>[] = [];

    if (entry.conferenceTextPath) {
        readPromises.push(
            readContentFromFile(entry.conferenceTextPath)
                .then(text => { content.mainText = text; })
                .catch(e => {
                    logger.error({ ...logContext, err: e, filePath: entry.conferenceTextPath, contentType: 'main', event: 'read_content_failed' }, "Failed to read main text file. Cannot proceed.");
                    throw e; // Re-throw critical error for main text
                })
        );
    } else {
        logger.error({ ...logContext, contentType: 'main', event: 'read_content_failed', reason: 'Missing main text path' }, "Main text path is missing. Cannot proceed.");
        throw new Error("Missing main text path for content aggregation.");
    }


    if (entry.cfpTextPath) {
        readPromises.push(
            readContentFromFile(entry.cfpTextPath)
                .then(text => { content.cfpText = text; })
                .catch(e => logger.warn({ ...logContext, err: e, filePath: entry.cfpTextPath, contentType: 'cfp', event: 'read_content_failed_non_critical' }, "Could not read CFP text file"))
        );
    }

    if (entry.impTextPath) {
        readPromises.push(
            readContentFromFile(entry.impTextPath)
                .then(text => { content.impText = text; })
                .catch(e => logger.warn({ ...logContext, err: e, filePath: entry.impTextPath, contentType: 'imp', event: 'read_content_failed_non_critical' }, "Could not read IMP text file"))
        );
    }

    await Promise.all(readPromises);
    logger.debug({ ...logContext, event: 'read_content_complete', hasCfp: !!content.cfpText, hasImp: !!content.impText });
    return content;
}

/**
 * Aggregates content for API calls based on available text.
 */
function aggregateContentForApi(
    title: string,
    acronym: string,
    content: { mainText: string; cfpText: string; impText: string },
    logger: Logger,
    logContext: object
): string {
    const impContent = content.impText ? ` \n\nImportant Dates information:\n${content.impText.trim()}` : "";
    const cfpContentAggregated = content.cfpText ? ` \n\nCall for Papers information:\n${content.cfpText.trim()}` : "";
    const aggregated = `Conference ${title} (${acronym}):\n\n${content.mainText.trim()}${cfpContentAggregated}${impContent}`;
    logger.debug({ ...logContext, charCount: aggregated.length, event: 'aggregate_content_complete' });
    return aggregated;
}

/**
 * Executes extract_information_api and cfp_extraction_api in parallel.
 */
async function executeParallelExtractCfpApis(
    contentSendToAPI: string,
    batchIndex: number,
    titleForApis: string,
    acronymForApis: string,
    safeConferenceAcronym: string,
    isUpdate: boolean, // Flag to differentiate filenames/logging
    logger: Logger,
    logContext: BatchProcessingLogContext // Use specific context
): Promise<{
    extractResponseTextPath?: string;
    extractMetaData: any | null;
    cfpResponseTextPath?: string;
    cfpMetaData: any | null;
}> {
    const suffix = isUpdate ? `_update_response_${batchIndex}` : `_response_${batchIndex}`;
    const extractFileBase = `${safeConferenceAcronym}_extract${suffix}`;
    const cfpFileBase = `${safeConferenceAcronym}_cfp${suffix}`;
    const apiContextBase = { ...logContext, title: titleForApis, acronym: acronymForApis, isUpdate };

    logger.info({ ...apiContextBase, event: 'parallel_apis_start' }, "Starting parallel calls to extract & cfp APIs");

    const extractPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
        const apiContext = { ...apiContextBase, apiType: API_TYPE_EXTRACT };
        logger.info({ ...apiContext, inputLength: contentSendToAPI.length, event: 'api_call_start' }, "Calling extract_information_api");
        const response = await extract_information_api(contentSendToAPI, batchIndex, titleForApis, acronymForApis, logger);
        const responseText = response.responseText || "";
        const path = await writeTempFile(responseText, extractFileBase);
        logger.info({ ...apiContext, responseLength: responseText.length, filePath: path, event: 'api_call_end', success: true }, "extract_information_api call successful");
        return { responseTextPath: path, metaData: response.metaData };
    })();

    const cfpPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
        const apiContext = { ...apiContextBase, apiType: API_TYPE_CFP };
        logger.info({ ...apiContext, inputLength: contentSendToAPI.length, event: 'api_call_start' }, "Calling cfp_extraction_api");
        const response = await cfp_extraction_api(contentSendToAPI, batchIndex, titleForApis, acronymForApis, logger);
        const responseText = response.responseText || "";
        const path = await writeTempFile(responseText, cfpFileBase);
        logger.info({ ...apiContext, responseLength: responseText.length, filePath: path, event: 'api_call_end', success: true }, "cfp_extraction_api call successful");
        return { responseTextPath: path, metaData: response.metaData };
    })();

    const results = await Promise.allSettled([extractPromise, cfpPromise]);
    logger.info({ ...apiContextBase, event: 'parallel_apis_settled' }, "Parallel API calls settled");

    let extractResponseTextPath: string | undefined;
    let extractMetaData: any | null = null;
    let cfpResponseTextPath: string | undefined;
    let cfpMetaData: any | null = null;

    if (results[0].status === 'fulfilled') {
        extractResponseTextPath = results[0].value.responseTextPath;
        extractMetaData = results[0].value.metaData;
    } else {
        logger.error({ ...apiContextBase, apiType: API_TYPE_EXTRACT, err: results[0].reason, event: 'api_call_failed' }, "Error calling extract_information_api");
    }

    if (results[1].status === 'fulfilled') {
        cfpResponseTextPath = results[1].value.responseTextPath;
        cfpMetaData = results[1].value.metaData;
    } else {
        logger.error({ ...apiContextBase, apiType: API_TYPE_CFP, err: results[1].reason, event: 'api_call_failed' }, "Error calling cfp_extraction_api");
    }

    if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        logger.error({ ...apiContextBase, event: 'parallel_apis_both_failed' }, "Both extract and cfp API calls failed.");
        // Decide whether to throw or continue with empty data based on requirements
        // throw new Error("Both extract and cfp API calls failed.");
    }

    return { extractResponseTextPath, extractMetaData, cfpResponseTextPath, cfpMetaData };
}

/**
 * Appends the final processed record to the output JSONL file.
 */
async function appendFinalRecord(
    record: BatchEntry | BatchUpdateEntry, // Accept either type
    outputPath: string,
    logger: Logger,
    logContext: object
): Promise<void> {
    const finalAppendContext = { ...logContext, outputPath, recordAcronym: record.conferenceAcronym };
    try {
        logger.info({ ...finalAppendContext, event: 'append_final_record_start' }, "Preparing and appending final record");
        const dataToWrite = JSON.stringify(record) + '\n';
        await fs.promises.appendFile(outputPath, dataToWrite, 'utf8');
        logger.info({ ...finalAppendContext, event: 'append_final_record_success' }, "Successfully appended final record");
    } catch (appendError: unknown) {
        logger.error({ ...finalAppendContext, err: appendError, event: 'append_final_record_failed' }, "CRITICAL: Failed to append final result to output file");
        throw appendError; // Re-throw critical error
    }
}

// --- Hàm con xử lý Main Link ---
const processMainLinkUpdate = async (
    page: Page, // Nhận page cụ thể
    conference: ConferenceUpdateData,
    year: number,
    baseLogContext: BatchProcessingLogContext,
    parentLogger: Logger
): Promise<{ finalUrl: string | null; textPath: string | null }> => {
    const url = conference.mainLink;
    const logContext = { ...baseLogContext, linkType: 'main', url };
    const taskLogger = parentLogger.child(logContext);
    let finalUrl: string | null = url;
    let textPath: string | null = null;

    if (!url) {
        taskLogger.error({ event: 'missing_url' });
        return { finalUrl: null, textPath: null };
    }

    taskLogger.info({ event: 'process_start' });
    try {
        // Sử dụng page được cung cấp
        if (page.isClosed()) {
            taskLogger.warn({ event: 'page_already_closed_before_goto' });
            throw new Error('Page was closed before navigation could start.');
        }
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }); // Tăng timeout
        finalUrl = page.url();
        taskLogger.info({ finalUrl, status: response?.status(), event: 'nav_success' });

        const htmlContent = await fetchContentWithRetry(page);

        const document = cleanDOM(htmlContent);
        if (document && document.body) {
            let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, year);
            fullText = removeExtraEmptyLines(fullText);
            if (fullText.trim()) {
                const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
                const baseName = `${safeAcronym}_main_update`;
                textPath = await saveContentToTempFile(fullText.trim(), baseName, logContext, taskLogger);
                if (textPath) {
                    taskLogger.info({ path: textPath, event: 'content_saved' });
                } else {
                    taskLogger.warn({ event: 'content_save_failed' });
                }
            } else {
                taskLogger.warn({ event: 'content_empty' });
            }
        } else {
            taskLogger.warn({ finalUrl, event: 'dom_invalid' });
        }
    } catch (error: unknown) {
        taskLogger.error({ finalUrl, err: error, event: 'process_failed' });
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] Error accessing/processing mainLink ${url} (final: ${finalUrl}): ${error instanceof Error ? error.message : String(error)} for ${conference.Acronym}\n`;
        await fs.promises.appendFile(ERROR_ACCESS_LINK_LOG_PATH, logMessage, 'utf8').catch(e => console.error("Failed to write error log:", e));
        textPath = null;
    }
    // Đảm bảo trả về finalUrl ngay cả khi có lỗi xử lý nội dung
    return { finalUrl: finalUrl ?? null, textPath };
};

// --- Hàm con xử lý CFP Link ---
const processCfpLinkUpdate = async (
    page: Page | null, // Có thể là null nếu link là PDF/None
    conference: ConferenceUpdateData,
    year: number,
    baseLogContext: BatchProcessingLogContext,
    parentLogger: Logger
): Promise<string | null> => {
    const url = conference.cfpLink;
    const logContext = { ...baseLogContext, linkType: 'cfp', url };
    const taskLogger = parentLogger.child(logContext);
    let textPath: string | null = null;

    if (!url || url.trim().toLowerCase() === "none") {
        taskLogger.debug({ event: 'skipped_no_url' });
        return null;
    }

    taskLogger.info({ event: 'process_start' });
    try {
        // extractTextFromUrl cần xử lý trường hợp page là null nếu url là PDF
        // Hoặc đảm bảo chỉ truyền page khác null nếu url không phải PDF
        if (!url.toLowerCase().endsWith('.pdf') && (!page || page.isClosed())) {
            taskLogger.warn({ event: 'page_null_or_closed_for_html' });
            throw new Error('Page required for non-PDF CFP link but was null or closed.');
        }
        // Truyền page (có thể null nếu là PDF) vào extractTextFromUrl
        // extractTextFromUrl phải tự kiểm tra page trước khi dùng cho goto
        const textContent = await extractTextFromUrl(page!, url, conference.Acronym, year, true); // Thêm ! để báo TS là đã kiểm tra, hoặc extractTextFromUrl chấp nhận null

        if (textContent) {
            const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
            const baseName = `${safeAcronym}_cfp_update`;
            textPath = await saveContentToTempFile(textContent, baseName, logContext, taskLogger);
            if (textPath) {
                taskLogger.info({ path: textPath, event: 'success' });
            } else {
                taskLogger.warn({ event: 'failed_to_save_extracted_content' });
            }
        } else {
            taskLogger.warn({ event: 'failed_extraction_returned_empty' });
        }
    } catch (error: unknown) {
        taskLogger.error({ err: error, event: 'failed_exception' });
        textPath = null;
    }
    return textPath;
};

// --- Hàm con xử lý IMP Link ---
const processImpLinkUpdate = async (
    page: Page | null, // Có thể là null nếu link là PDF/None
    conference: ConferenceUpdateData,
    year: number,
    baseLogContext: BatchProcessingLogContext,
    parentLogger: Logger
): Promise<string | null> => {
    const url = conference.impLink;
    const logContext = { ...baseLogContext, linkType: 'imp', url };
    const taskLogger = parentLogger.child(logContext);
    let textPath: string | null = null;

    if (!url || url.trim().toLowerCase() === "none") {
        taskLogger.debug({ event: 'skipped_no_url' });
        return null;
    }
    // Kiểm tra trùng link với CFP để tránh xử lý lại nếu không cần thiết
    // (Logic này có thể thêm vào nếu muốn tối ưu, hiện tại vẫn xử lý riêng)
    // if (url === conference.cfpLink) {
    //     taskLogger.info({ event: 'skipped_same_as_cfp' });
    //     // Cần cơ chế lấy kết quả từ CFP nếu có
    //     return null; // Hoặc trả về kết quả CFP đã xử lý
    // }


    taskLogger.info({ event: 'process_start' });
    try {
        if (!url.toLowerCase().endsWith('.pdf') && (!page || page.isClosed())) {
            taskLogger.warn({ event: 'page_null_or_closed_for_html' });
            throw new Error('Page required for non-PDF IMP link but was null or closed.');
        }
        const textContent = await extractTextFromUrl(page!, url, conference.Acronym, year, false); // useMainContentKeywords = false

        if (textContent) {
            const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
            const baseName = `${safeAcronym}_imp_update`;
            textPath = await saveContentToTempFile(textContent, baseName, logContext, taskLogger);
            if (textPath) {
                taskLogger.info({ path: textPath, event: 'success' });
            } else {
                taskLogger.warn({ event: 'failed_to_save_extracted_content' });
            }
        } else {
            taskLogger.warn({ event: 'failed_extraction_returned_empty' });
        }
    } catch (error: unknown) {
        taskLogger.error({ err: error, event: 'failed_exception' });
        textPath = null;
    }
    return textPath;
};


// --- Hàm chính updateHTMLContent (Sử dụng nhiều page) ---
export const updateHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceUpdateData,
    batchIndexRef: { current: number },
    parentLogger: Logger
): Promise<boolean> => {
    const baseLogContext: BatchProcessingLogContext = {
        batchIndex: batchIndexRef.current,
        conferenceAcronym: conference.Acronym,
        conferenceTitle: conference.Title,
        function: 'updateHTMLContent'
    };
    const taskLogger = parentLogger.child(baseLogContext);
    const pages: Page[] = []; // Mảng quản lý các page đã tạo

    try {
        taskLogger.info({ event: 'start' });

        // --- Tạo các page cần thiết cho điều hướng song song ---
        let mainPage: Page | null = null;
        let cfpPage: Page | null = null;
        let impPage: Page | null = null;

        // 1. Page cho Main Link (luôn cần)
        if (conference.mainLink) {
            mainPage = await browserContext.newPage();
            pages.push(mainPage);
            taskLogger.info({ event: 'main_page_created' });
        } else {
            taskLogger.error({ event: 'main_page_creation_skipped_no_link' });
            // Không có main link thì không thể tiếp tục
            return false;
        }


        // 2. Page cho CFP Link (chỉ khi là HTML và khác None)
        const cfpLink = conference.cfpLink;
        const needsCfpNav = cfpLink && !cfpLink.toLowerCase().endsWith('.pdf') && cfpLink.trim().toLowerCase() !== 'none';
        if (needsCfpNav) {
            cfpPage = await browserContext.newPage();
            pages.push(cfpPage);
            taskLogger.info({ event: 'cfp_page_created' });
        } else {
            taskLogger.info({ event: 'cfp_page_creation_skipped', reason: !cfpLink ? 'no link' : cfpLink.toLowerCase().endsWith('.pdf') ? 'pdf link' : 'none link' });
        }

        // 3. Page cho IMP Link (chỉ khi là HTML, khác None và khác CFP link nếu CFP cũng cần điều hướng)
        const impLink = conference.impLink;
        const needsImpNav = impLink && !impLink.toLowerCase().endsWith('.pdf') && impLink.trim().toLowerCase() !== 'none';
        // Tối ưu: Nếu IMP cần điều hướng và link giống hệt CFP (cũng cần điều hướng), không tạo page mới
        const isImpSameAsNavigableCfp = needsImpNav && needsCfpNav && impLink === cfpLink;

        if (needsImpNav && !isImpSameAsNavigableCfp) {
            impPage = await browserContext.newPage();
            pages.push(impPage);
            taskLogger.info({ event: 'imp_page_created' });
        } else if (isImpSameAsNavigableCfp) {
            taskLogger.info({ event: 'imp_page_creation_skipped', reason: 'same as navigable cfp link' });
            // Sẽ dùng kết quả của CFP hoặc xử lý bằng cfpPage
        }
        else {
            taskLogger.info({ event: 'imp_page_creation_skipped', reason: !impLink ? 'no link' : impLink.toLowerCase().endsWith('.pdf') ? 'pdf link' : 'none link' });
        }

        // --- Thực thi song song với các page riêng biệt ---
        taskLogger.info({ event: 'parallel_fetch_start' });

        // Định nghĩa kiểu kết quả mong đợi
        type MainPromiseResultType = { finalUrl: string | null; textPath: string | null };
        type CfpPromiseResultType = string | null;
        type ImpPromiseResultType = string | null;

        const promises: Promise<any>[] = []; // Sử dụng any hoặc định nghĩa kiểu phức tạp hơn

        // 1. Main Link Promise (luôn chạy với mainPage)
        promises.push(processMainLinkUpdate(mainPage, conference, YEAR2, baseLogContext, taskLogger));

        // 2. CFP Link Promise
        // Truyền cfpPage nếu được tạo, nếu không (PDF/None) thì truyền null
        // processCfpLinkUpdate cần xử lý page null nếu là PDF/None
        promises.push(processCfpLinkUpdate(cfpPage, conference, YEAR2, baseLogContext, taskLogger));

        // 3. IMP Link Promise
        // Nếu IMP giống hệt CFP (và cả hai cần nav), ta không xử lý lại IMP ở đây
        // Thay vào đó, ta sẽ gán kết quả CFP cho IMP sau khi promise giải quyết
        if (!isImpSameAsNavigableCfp) {
            // Truyền impPage nếu được tạo, nếu không (PDF/None/SameAsNonNavigableCFP) thì truyền null
            promises.push(processImpLinkUpdate(impPage, conference, YEAR2, baseLogContext, taskLogger));
        } else {
            // Push một promise giả để giữ đúng thứ tự index, sẽ xử lý sau
            promises.push(Promise.resolve(null)); // Placeholder
            taskLogger.info({ event: 'imp_processing_deferred_to_cfp_result' });
        }


        // Chờ tất cả hoàn thành
        const results = await Promise.allSettled(promises);
        taskLogger.info({ event: 'parallel_fetch_settled' });

        // --- Xử lý kết quả ---
        let mainResult: MainPromiseResultType = { finalUrl: null, textPath: null };
        let cfpTextPath: CfpPromiseResultType = null;
        let impTextPath: ImpPromiseResultType = null;

        // Xử lý kết quả Main Link (Index 0)
        const mainPromiseSettledResult = results[0];
        if (mainPromiseSettledResult.status === 'fulfilled') {
            mainResult = mainPromiseSettledResult.value as MainPromiseResultType;
            taskLogger.info({ event: 'main_link_processed', status: 'success', path: mainResult.textPath, finalUrl: mainResult.finalUrl });
        } else {
            taskLogger.error({ event: 'main_link_processed', status: 'failed', err: mainPromiseSettledResult.reason }, "Main link processing failed critically in promise.");
        }

        // Xử lý kết quả CFP Link (Index 1)
        const cfpPromiseSettledResult = results[1];
        if (cfpPromiseSettledResult.status === 'fulfilled') {
            cfpTextPath = cfpPromiseSettledResult.value as CfpPromiseResultType;
            taskLogger.info({ event: 'cfp_link_processed', status: 'success', path: cfpTextPath });
        } else {
            taskLogger.error({ event: 'cfp_link_processed', status: 'failed', err: cfpPromiseSettledResult.reason }, "CFP link processing failed in promise.");
        }

        // Xử lý kết quả IMP Link (Index 2)
        const impPromiseSettledResult = results[2];
        if (isImpSameAsNavigableCfp) {
            // Nếu IMP giống CFP, lấy kết quả từ CFP
            impTextPath = cfpTextPath;
            taskLogger.info({ event: 'imp_link_processed', status: 'fulfilled_from_cfp', path: impTextPath });
        } else if (impPromiseSettledResult.status === 'fulfilled') {
            // Nếu xử lý riêng và thành công
            impTextPath = impPromiseSettledResult.value as ImpPromiseResultType;
            taskLogger.info({ event: 'imp_link_processed', status: 'success', path: impTextPath });
        } else if (impPromiseSettledResult.status === 'rejected') {
            // Nếu xử lý riêng và thất bại
            taskLogger.error({ event: 'imp_link_processed', status: 'failed', err: impPromiseSettledResult.reason }, "IMP link processing failed in promise.");
        }
        // Trường hợp placeholder Promise.resolve(null) sẽ không bao giờ reject

        // --- Kiểm tra điều kiện tiên quyết ---
        if (!mainResult.textPath) {
            taskLogger.error({ event: 'abort_no_main_text' }, `Skipping update batch processing as main content fetch/save failed.`);
            return false;
        }

        // --- Chuẩn bị và gọi updateBatchToFile ---
        const batchData: BatchUpdateEntry = {
            conferenceTitle: conference.Title,
            conferenceAcronym: conference.Acronym,
            // finalMainLinkUrl: mainResult.finalUrl, // Có thể thêm nếu cần
            conferenceTextPath: mainResult.textPath, // Đã đảm bảo khác null
            cfpTextPath: cfpTextPath,
            impTextPath: impTextPath,
        };

        const currentBatchIndex = batchIndexRef.current++;
        taskLogger.info({ batchIndex: currentBatchIndex, event: 'calling_update_batch_processor' });
        const updateSuccess = await updateBatchToFile(batchData, currentBatchIndex, taskLogger);

        taskLogger.info({ event: 'finish', success: updateSuccess });
        return updateSuccess;

    } catch (error: unknown) {
        taskLogger.error({ err: error, event: 'finish_unhandled_error' }, "Unhandled error in updateHTMLContent");
        return false;
    } finally {
        // Đảm bảo đóng TẤT CẢ các page đã tạo
        taskLogger.debug(`Closing ${pages.length} page instances.`);
        for (const p of pages) {
            if (p && !p.isClosed()) {
                await p.close().catch(err => taskLogger.error({ err: err, event: 'page_close_failed' }, `Error closing page`));
            }
        }
    }
};


// // Update Stream
// /**
//  * Fetches updated content for a conference and queues the update batch processing.
//  */
// export const updateHTMLContent = async (
//     browserContext: BrowserContext,
//     conference: ConferenceUpdateData,
//     batchIndexRef: { current: number },
//     parentLogger: Logger
// ): Promise<boolean> => {
//     const baseLogContext: BatchProcessingLogContext = {
//         batchIndex: batchIndexRef.current,
//         conferenceAcronym: conference.Acronym,
//         conferenceTitle: conference.Title,
//         function: 'updateHTMLContent'
//     };
//     const taskLogger = parentLogger.child(baseLogContext);
//     let page: Page | null = null;

//     try {
//         taskLogger.info({ event: 'start' });
//         page = await browserContext.newPage();
//         taskLogger.info({ event: 'page_created' });

//         let mainTextPath: string | undefined | null = undefined;
//         let cfpTextPath: string | undefined | null = undefined;
//         let impTextPath: string | undefined | null = undefined;
//         let finalMainLinkUrl = conference.mainLink;

//         // 1. Process Main Link
//         const mainLink = conference.mainLink;
//         if (!mainLink) {
//             taskLogger.error({ event: 'missing_main_link' });
//             return false; // Cannot proceed without main link
//         }
//         const mainLinkContext = { ...baseLogContext, linkType: 'main', url: mainLink };
//         try {
//             taskLogger.info({ ...mainLinkContext, event: 'process_start' });
//             const response = await page.goto(mainLink, { waitUntil: "domcontentloaded", timeout: 25000 });
//             finalMainLinkUrl = page.url(); // Update final URL
//             taskLogger.info({ ...mainLinkContext, finalUrl: finalMainLinkUrl, status: response?.status(), event: 'nav_success' });

//             const htmlContent = await fetchContentWithRetry(page);
//             const document = cleanDOM(htmlContent);
//             if (document && document.body) {
//                 let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, YEAR2);
//                 fullText = removeExtraEmptyLines(fullText);
//                 if (fullText.trim()) {
//                     // Use safe acronym for filename
//                     const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
//                     const baseName = `${safeAcronym}_main_update`;
//                     // Use saveContentToTempFile directly
//                     mainTextPath = await saveContentToTempFile(fullText.trim(), baseName, mainLinkContext, taskLogger);
//                     if (mainTextPath) {
//                         taskLogger.info({ ...mainLinkContext, path: mainTextPath, event: 'content_saved' });
//                     } else {
//                         // saveContentToTempFile logs the error internally
//                         taskLogger.warn({ ...mainLinkContext, event: 'content_save_failed' });
//                     }
//                 } else {
//                     taskLogger.warn({ ...mainLinkContext, event: 'content_empty' });
//                 }
//             } else {
//                 taskLogger.warn({ ...mainLinkContext, finalUrl: finalMainLinkUrl, event: 'dom_invalid' });
//             }
//         } catch (error: unknown) {
//             taskLogger.error({ ...mainLinkContext, finalUrl: finalMainLinkUrl, err: error, event: 'process_failed' });
//             const timestamp = new Date().toISOString();
//             const logMessage = `[${timestamp}] Error accessing/processing mainLink ${mainLink} (final: ${finalMainLinkUrl}): ${error instanceof Error ? error.message : String(error)} for ${conference.Acronym}\n`;
//             await fs.promises.appendFile(ERROR_ACCESS_LINK_LOG_PATH, logMessage, 'utf8').catch(e => console.error("Failed to write error log:", e));
//         }

//         // Abort if main content failed critically (no path was generated)
//         if (!mainTextPath) {
//             taskLogger.error({ event: 'abort_no_main_text' }, `Skipping update as main content failed.`);
//             if (page && !page.isClosed()) await page.close().catch(e => taskLogger.error({ err: e, event: 'page_close_failed' })); // Close page before returning
//             return false;
//         }

//         // --- ADJUSTMENT FOR CFP Link ---
//         const cfpLink = conference.cfpLink;
//         const cfpLinkContext = { ...baseLogContext, linkType: 'cfp', url: cfpLink };
//         if (cfpLink && cfpLink.trim().toLowerCase() !== "none") {
//             taskLogger.info({ ...cfpLinkContext, event: 'process_start' });
//             try {
//                 // Step 1: Extract text using the refactored helper
//                 // Remember: useMainContentKeywords = true for CFP
//                 const textContent = await extractTextFromUrl(page, cfpLink, conference.Acronym, YEAR2, true);

//                 // Step 2: Save the extracted text if successful
//                 if (textContent) {
//                     const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
//                     const baseName = `${safeAcronym}_cfp_update`; // Specific base name for update CFP
//                     cfpTextPath = await saveContentToTempFile(textContent, baseName, cfpLinkContext, taskLogger);
//                     if (cfpTextPath) {
//                         taskLogger.info({ ...cfpLinkContext, path: cfpTextPath, event: 'success' });
//                     } else {
//                         taskLogger.warn({ ...cfpLinkContext, event: 'failed_to_save_extracted_content' });
//                     }
//                 } else {
//                     taskLogger.warn({ ...cfpLinkContext, event: 'failed_extraction_returned_empty' });
//                 }
//             } catch (cfpError: unknown) {
//                 taskLogger.error({ ...cfpLinkContext, err: cfpError, event: 'failed_exception' });
//             }
//         } else {
//             taskLogger.debug({ ...cfpLinkContext, event: 'skipped' });
//         }
//         // --- END ADJUSTMENT FOR CFP Link ---

//         // --- ADJUSTMENT FOR IMP Link ---
//         const impLink = conference.impLink;
//         const impLinkContext = { ...baseLogContext, linkType: 'imp', url: impLink };
//         if (impLink && impLink.trim().toLowerCase() !== "none") {
//             taskLogger.info({ ...impLinkContext, event: 'process_start' });
//             try {
//                 // Step 1: Extract text using the refactored helper
//                 // Remember: useMainContentKeywords = false for IMP
//                 const textContent = await extractTextFromUrl(page, impLink, conference.Acronym, YEAR2, false);

//                 // Step 2: Save the extracted text if successful
//                 if (textContent) {
//                     const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
//                     const baseName = `${safeAcronym}_imp_update`; // Specific base name for update IMP
//                     impTextPath = await saveContentToTempFile(textContent, baseName, impLinkContext, taskLogger);
//                     if (impTextPath) {
//                         taskLogger.info({ ...impLinkContext, path: impTextPath, event: 'success' });
//                     } else {
//                         taskLogger.warn({ ...impLinkContext, event: 'failed_to_save_extracted_content' });
//                     }
//                 } else {
//                     taskLogger.warn({ ...impLinkContext, event: 'failed_extraction_returned_empty' });
//                 }
//             } catch (impError: unknown) {
//                 taskLogger.error({ ...impLinkContext, err: impError, event: 'failed_exception' });
//             }
//         } else {
//             taskLogger.debug({ ...impLinkContext, event: 'skipped' });
//         }
//         // --- END ADJUSTMENT FOR IMP Link ---


//         // 4. Prepare Batch Data (remains the same)
//         const batchData: BatchUpdateEntry = {
//             conferenceTitle: conference.Title,
//             conferenceAcronym: conference.Acronym,
//             conferenceTextPath: mainTextPath, // Must exist at this point
//             cfpTextPath: cfpTextPath, // Will be null if saving failed
//             impTextPath: impTextPath, // Will be null if saving failed
//         };

//         // 5. Call updateBatchToFile (remains the same)
//         const currentBatchIndex = batchIndexRef.current;
//         batchIndexRef.current++;
//         taskLogger.info({ batchIndex: currentBatchIndex, event: 'calling_update_batch_processor' });
//         const updateSuccess = await updateBatchToFile(batchData, currentBatchIndex, taskLogger);

//         taskLogger.info({ event: 'finish', success: updateSuccess }, `Finishing updateHTMLContent.`);
//         return updateSuccess;

//     } catch (error: unknown) {
//         taskLogger.error({ err: error, event: 'finish_unhandled_error' }, "Unhandled error in updateHTMLContent");
//         return false;
//     } finally {
//         if (page && !page.isClosed()) {
//             taskLogger.debug("Closing page instance.");
//             await page.close().catch(err => taskLogger.error({ err: err, event: 'page_close_failed' }, "Error closing page"));
//         }
//     }
// };

/**
 * Processes an update batch: reads files, calls APIs in parallel, appends result.
 */
export const updateBatchToFile = async (
    batchInput: BatchUpdateEntry,
    batchIndex: number,
    parentLogger: Logger
): Promise<boolean> => { // Return boolean indicating success/failure
    const baseLogContext: BatchProcessingLogContext = {
        batchIndex,
        conferenceAcronym: batchInput.conferenceAcronym,
        conferenceTitle: batchInput.conferenceTitle,
        function: 'updateBatchToFile'
    };
    const taskLogger = parentLogger.child(baseLogContext);

    try {
        await initDataManager(); // Ensure initialized if needed

        if (!batchInput.conferenceTextPath) { // Critical check
            taskLogger.error({ event: 'invalid_input', reason: 'Missing main text path' }, "Cannot process update batch without main text path.");
            return false;
        }
        taskLogger.info({ event: 'start' });

        const safeConferenceAcronym = batchInput.conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');

        // 1. Ensure Directories
        await ensureDirectories([BATCHES_DIR, FINAL_OUTPUT_PATH], taskLogger, baseLogContext);

        // 2. Read Content Files
        const readContentContext = { ...baseLogContext, event_group: 'read_update_content' };
        taskLogger.debug({ ...readContentContext, event: 'start' });
        const content = await readBatchContentFiles(batchInput, taskLogger, readContentContext); // Reuses helper
        taskLogger.debug({ ...readContentContext, event: 'end' });

        // 3. Aggregate Content for APIs
        const aggregateContext = { ...baseLogContext, event_group: 'aggregate_update_content' };
        const contentSendToAPI = aggregateContentForApi(batchInput.conferenceTitle, batchInput.conferenceAcronym, content, taskLogger, aggregateContext); // Reuses helper

        // Write intermediate update file (async, non-critical)
        const fileUpdateName = `${safeConferenceAcronym}_update_${batchIndex}.txt`;
        const fileUpdatePath = path.join(BATCHES_DIR, fileUpdateName);
        const fileUpdatePromise = fs.promises.writeFile(fileUpdatePath, contentSendToAPI, "utf8")
            .then(() => taskLogger.debug({ filePath: fileUpdatePath, fileType: 'update_intermediate', event: 'write_intermediate_success' }))
            .catch(writeError => taskLogger.error({ filePath: fileUpdatePath, fileType: 'update_intermediate', err: writeError, event: 'write_intermediate_failed' }));

        // 4. Execute Parallel Extract/CFP APIs
        const apiResults = await executeParallelExtractCfpApis(
            contentSendToAPI, batchIndex, batchInput.conferenceTitle, batchInput.conferenceAcronym, safeConferenceAcronym, true, taskLogger, baseLogContext // Pass isUpdate=true
        );

        // Wait for non-critical intermediate write
        await fileUpdatePromise;
        taskLogger.debug({ event: 'intermediate_writes_settled' });

        // 5. Prepare and Append Final Record
        // Ensure the final record structure matches BatchUpdateEntry or the expected update format
        const finalRecord: BatchUpdateEntry = {
            ...batchInput, // Start with input data
            // Add API results
            extractResponseTextPath: apiResults.extractResponseTextPath,
            extractMetaData: apiResults.extractMetaData,
            cfpResponseTextPath: apiResults.cfpResponseTextPath,
            cfpMetaData: apiResults.cfpMetaData,
            // Remove fields if they shouldn't be in the final update record
        };
        await appendFinalRecord(finalRecord, FINAL_OUTPUT_PATH, taskLogger, baseLogContext); // Reuses helper

        taskLogger.info({ event: 'finish_success' }, "Finishing updateBatchToFile successfully");
        return true; // Indicate success

    } catch (error: unknown) {
        taskLogger.error({ err: error, event: 'finish_failed' }, "Error occurred during updateBatchToFile execution");
        return false; // Indicate failure
    }
};