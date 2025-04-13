// playwright_utils.ts
import fs from 'fs';
import { Page, BrowserContext } from 'playwright'; // Import Playwright types

import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing';
import { extract_information_api, determine_links_api } from './7_gemini_api_utils';
import { init } from './8_data_manager';
import { extractTextFromPDF } from './9_pdf_utils';
import { addAcronymSafely, logger } from './11_utils';
import { MAIN_CONTENT_KEYWORDS, YEAR2 } from '../config';

import { BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData } from './types';

import path from 'path';

const ERROR_ACCESS_LINK_LOG_PATH: string = path.join(__dirname, "./data/error_access_link_log.txt");

import { readContentFromFile, writeTempFile } from './11_utils';

async function fetchContentWithRetry(page: Page, maxRetries: number = 3): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await page.content();
        } catch (err: any) { // Type err as any or Error
            console.error(`[Attempt ${attempt}] Error fetching page content: ${err.message}`);
            if (attempt === maxRetries) throw err;
            await page.waitForTimeout(2000);
        }
    }
    return ""; // Should not reach here, but to satisfy return type
}

// --- processHTMLContent trả về text, nơi gọi sẽ ghi file ---
async function processHTMLContent(page: Page, link: string | null, acronym: string | undefined, year: number, useMainContentKeywords: boolean = false): Promise<string> {
    try {
        if (link && link.toLowerCase().endsWith(".pdf")) {
            try {
                const pdfText = await extractTextFromPDF(link);
                return pdfText || "";
            } catch (pdfError: any) { // Type pdfError as any or Error
                console.error(`Error extracting text from PDF ${link}:`, pdfError);
                return "";
            }
        }

        if (link) {
            try {
                await page.goto(link, { waitUntil: "domcontentloaded", timeout: 25000 });
            } catch (gotoError: any) { // Type gotoError as any or Error
                console.error(`Error navigating to ${link}:`, gotoError);
                return "";
            }
        }

        let mainContentHTML: string = await page.content();

        if (useMainContentKeywords) {
            try {
                const extractedContentRaw: string | string[] = await page.$$eval("*", (els, keywords) => { // Changed type to string | string[]
                    if (!Array.isArray(keywords)) {
                        return document ? document.body.outerHTML : "";
                    }
                    return els
                        .filter((el: Element) =>
                            Array.from(el.attributes).some((attr: Attr) =>
                                keywords.some((keyword: string) =>
                                    attr.name.toLowerCase().includes(keyword)
                                )
                            )
                        )
                        .map((el: Element) => el.outerHTML)
                        .join("\n\n");
                }, MAIN_CONTENT_KEYWORDS);

                let extractedContent: string; // Declare extractedContent as string
                if (Array.isArray(extractedContentRaw)) {
                    extractedContent = extractedContentRaw.join('\n\n'); // Join array elements into a string if it's an array
                } else {
                    extractedContent = extractedContentRaw; // Otherwise, it's already a string
                }


                if (extractedContent.length > 0) {
                    mainContentHTML = extractedContent;
                }
            } catch (evalError: any) {
                console.error("Error extracting main content:", evalError);
            }
        }

        const document = cleanDOM(mainContentHTML);
        if (!document) {
            return "";
        }
        let fullText = traverseNodes(document.body as HTMLElement, acronym, year);
        fullText = removeExtraEmptyLines(fullText);
        return fullText;

    } catch (error: any) { // Type error as any or Error
        console.error("Error in processHTMLContent:", error);
        console.error(error.stack);
        return "";
    }
}

export const saveHTMLFromCallForPapers = async (page: Page, link: string | null, acronym: string | undefined, year: number): Promise<string | null> => {
    const textContent = await processHTMLContent(page, link, acronym, year, true);
    if (textContent) {
        // Ghi vào file tạm và trả về path
        const safeAcronym = acronym?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
        return await writeTempFile(textContent, `${safeAcronym}_cfp_${year}`);
    }
    return null;
};

export const saveHTMLFromImportantDates = async (page: Page, link: string | null, acronym: string | undefined, year: number): Promise<string | null> => {
    const textContent = await processHTMLContent(page, link, acronym, year, false);
    if (textContent) {
        // Ghi vào file tạm và trả về path
        const safeAcronym = acronym?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
        return await writeTempFile(textContent, `${safeAcronym}_imp_${year}`);
    }
    return null;
};

// --- normalizeAndJoinLink giữ nguyên ---
const normalizeAndJoinLink = (baseUrl: string, link: string | undefined): string => {
    try {
        if (!link || link.toLowerCase() === "none") {
            return link || ""; // Return empty string if link is null or undefined after checking "none"
        }
        if (link.startsWith('http')) {
            return link;
        }

        let normalizedLinkPart: string = link;
        normalizedLinkPart = normalizedLinkPart.replace(/^[^a-zA-Z0-9]+/, '');
        // Ensure baseUrl doesn't end with '/' if normalizedLinkPart doesn't start with '/'
        if (baseUrl.endsWith('/') && !normalizedLinkPart.startsWith('/')) {
            baseUrl = baseUrl.slice(0, -1);
        } else if (!baseUrl.endsWith('/') && normalizedLinkPart.startsWith('/')) {
            // This case should ideally not happen if normalize removes leading non-alphanum
            // but just in case, remove the leading '/' from link part
            normalizedLinkPart = normalizedLinkPart.substring(1);
        } else if (baseUrl.endsWith('/') && normalizedLinkPart.startsWith('/')) {
            // Avoid double slash if both end/start with slash
            normalizedLinkPart = normalizedLinkPart.substring(1);
        }

        // Simple concatenation might still fail for relative paths like '../'
        // Using URL constructor is more robust
        try {
            return new URL(normalizedLinkPart, baseUrl + (baseUrl.endsWith('/') ? '' : '/')).toString();
        } catch (urlError) {
            console.warn(`Could not construct URL from base "${baseUrl}" and link "${link}". Falling back to simple join.`);
            // Fallback to previous logic if URL constructor fails (e.g., invalid base)
            return `${baseUrl}/${normalizedLinkPart}`;
        }
    } catch (normalizeError: any) {
        console.error("Error normalizing and joining link:", normalizeError);
        return "";
    }
};

// --- fetchAndProcessWebsiteInfo trả về { finalUrl, textPath } ---
const fetchAndProcessWebsiteInfo = async (page: Page, officialWebsite: string, batchEntry: BatchEntry, year: number): Promise<{ finalUrl: string; textPath: string } | null> => {
    try {
        const response = await page.goto(officialWebsite, { waitUntil: 'domcontentloaded', timeout: 25000 });
        if (!response || !response.ok()) {
            console.error(`Failed to load ${officialWebsite}. Status code: ${response ? response.status() : 'Unknown'}`);
            return null;
        }
        const finalUrl = page.url();
        const htmlContent = await page.content(); // Hoặc fetchContentWithRetry
        const document = cleanDOM(htmlContent);
        if (!document) return null;
        let fullText = traverseNodes(document.body as HTMLElement, batchEntry.conferenceAcronym, year);
        fullText = removeExtraEmptyLines(fullText);

        // Ghi vào file tạm và trả về path
        const safeAcronym = batchEntry.conferenceAcronym.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
        const textPath = await writeTempFile(fullText, `${safeAcronym}_main_${year}`);

        return { finalUrl, textPath };
    } catch (error: any) {
        console.error("Error fetching and processing website info:", error);
        console.error(error.stack);
        return null;
    }
};

// --- processDetermineLinksResponse ---
const processDetermineLinksResponse = async (
    responseText: string,
    batch: BatchEntry[],
    batchIndex: number,
    browserContext: BrowserContext,
    year: number,
    apiCallNumber: 1 | 2 = 1, // Thêm tham số để biết đây là lần gọi API thứ mấy
    parentLogger: typeof logger

): Promise<BatchEntry[]> => {
    // Base context cho function này
    const baseLogContext = {
        batchIndex,
        conferenceAcronym: batch[0]?.conferenceAcronym,
        conferenceTitle: batch[0]?.conferenceTitle,
        function: 'processDetermineLinksResponse',
        apiCallNumber // Thêm số lần gọi API vào context
    };
    parentLogger.info({ ...baseLogContext, event: 'process_determine_start' }, "Starting processDetermineLinksResponse");
    let page: Page | null = null;

    try {
        page = await browserContext.newPage();
        let linksData: any;
        try {
            linksData = JSON.parse(responseText);
        } catch (parseError: any) {
            parentLogger.error({ ...baseLogContext, err: parseError, responseTextPreview: responseText.substring(0, 100), event: 'process_determine_json_parse_failed' }, `Error parsing JSON response from determine_links_api (call ${apiCallNumber})`);
            if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after JSON parse error"));
            batch[0].conferenceLink = "None"; // Mark as error
            parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'JSON parse failed' }, "Finishing processDetermineLinksResponse with error state");
            return [batch[0]];
        }

        let officialWebsite: string | undefined = linksData["Official Website"]?.trim();
        let cfpLink: string | undefined = linksData["Call for papers link"]?.trim();
        let impLink: string | undefined = linksData["Important dates link"]?.trim();

        if (!officialWebsite || officialWebsite.toLowerCase() === "none") {
            parentLogger.warn({ ...baseLogContext, linksData, event: 'process_determine_no_official_website' }, "Official website link not found or 'None' in determine_links_api response");
            if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after no official website"));
            batch[0].conferenceLink = "None";
            parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'No official website' }, "Finishing processDetermineLinksResponse with error state");
            return [batch[0]];
        }

        officialWebsite = officialWebsite.endsWith('/') ? officialWebsite.slice(0, -1) : officialWebsite;
        const originalOfficialWebsite = officialWebsite;
        cfpLink = normalizeAndJoinLink(officialWebsite, cfpLink);
        impLink = normalizeAndJoinLink(officialWebsite, impLink);
        parentLogger.debug({ ...baseLogContext, officialWebsite, cfpLink, impLink, event: 'process_determine_links_normalized' }, "Parsed and normalized initial links");

        let matchingEntry: BatchEntry | undefined;
        try {
            matchingEntry = batch.find(entry => {
                if (!entry.conferenceLink) return false;
                const normalizedEntryLink = entry.conferenceLink.endsWith('/') ? entry.conferenceLink.slice(0, -1) : entry.conferenceLink;
                return normalizedEntryLink === originalOfficialWebsite;
            });
        } catch (findError: any) {
            parentLogger.error({ ...baseLogContext, err: findError, event: 'process_determine_entry_match_error' }, "Error during batch.find matching entry");
            if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after find error"));
            batch[0].conferenceLink = "None";
            parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Error finding matching entry' }, "Finishing processDetermineLinksResponse with error state");
            return [batch[0]];
        }


        if (matchingEntry) {
            parentLogger.info({ ...baseLogContext, matchedLink: matchingEntry.conferenceLink, event: 'process_determine_entry_match_found' }, "Found matching entry in batch based on official website");
            let saveErrorOccurred = false;
            try {
                matchingEntry.cfpLink = cfpLink || "";
                matchingEntry.impLink = impLink || "";

                if (cfpLink && cfpLink.toLowerCase() !== "none") {
                    const saveContext = { ...baseLogContext, url: cfpLink, contentType: 'CFP' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_matched_start' }, "Saving CFP content for matched entry");
                    matchingEntry.cfpTextPath = await saveHTMLFromCallForPapers(page, cfpLink, matchingEntry.conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: matchingEntry.cfpTextPath, event: 'process_determine_save_matched_success' }, "Saved CFP content for matched entry");
                }
                if (impLink && impLink.toLowerCase() !== "none") {
                    const saveContext = { ...baseLogContext, url: impLink, contentType: 'IMP' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_matched_start' }, "Saving Important Dates content for matched entry");
                    matchingEntry.impTextPath = await saveHTMLFromImportantDates(page, impLink, matchingEntry.conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: matchingEntry.impTextPath, event: 'process_determine_save_matched_success' }, "Saved Important Dates content for matched entry");
                }
            } catch (saveContentError: any) {
                saveErrorOccurred = true;
                parentLogger.error({ ...baseLogContext, err: saveContentError, cfpLink, impLink, event: 'process_determine_save_matched_failed' }, "Error saving CFP/IMP content for matched entry");
            } finally {
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page for matched entry"));
            }
            // Vẫn trả về entry ngay cả khi lưu lỗi, nhưng log trạng thái cuối cùng
            parentLogger.info({ ...baseLogContext, success: !saveErrorOccurred, event: 'process_determine_finish_success' }, `Finishing processDetermineLinksResponse for matched entry (save error: ${saveErrorOccurred})`);
            return [matchingEntry];

        } else {
            parentLogger.info({ ...baseLogContext, officialWebsite: originalOfficialWebsite, event: 'process_determine_entry_match_not_found' }, "No matching entry found. Fetching content from official website directly.");
            let websiteInfo;
            try {
                websiteInfo = await fetchAndProcessWebsiteInfo(page, originalOfficialWebsite, batch[0], year);
            } catch (fetchError: any) {
                parentLogger.error({ ...baseLogContext, url: originalOfficialWebsite, err: fetchError, event: 'process_determine_fetch_new_failed' }, "Failed to fetch and process main website info");
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after fetch error"));
                batch[0].conferenceLink = "None";
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Fetch new website failed' }, "Finishing processDetermineLinksResponse with error state");
                return [batch[0]];
            }


            if (!websiteInfo) { // Double check in case fetchAndProcessWebsiteInfo returns null without error
                parentLogger.error({ ...baseLogContext, url: originalOfficialWebsite, event: 'process_determine_fetch_new_failed' }, "Fetched main website info is null/undefined");
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after null fetch result"));
                batch[0].conferenceLink = "None";
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Fetch new website returned null' }, "Finishing processDetermineLinksResponse with error state");
                return [batch[0]];
            }

            const { finalUrl, textPath } = websiteInfo;
            parentLogger.info({ ...baseLogContext, initialUrl: originalOfficialWebsite, finalUrl, filePath: textPath, event: 'process_determine_fetch_new_success' }, "Successfully fetched and processed main website info");

            let fullText = '';
            try {
                fullText = await readContentFromFile(textPath);
            } catch (readErr: any) {
                parentLogger.error({ ...baseLogContext, filePath: textPath, err: readErr, event: 'process_determine_read_fetched_failed' }, "Failed to read fetched content file");
                // Consider failing the process here? For now, continue, API call will likely fail.
            }

            // Corrected structure for determine_links_api (assuming it expects this format)
            const batchContentForApi = `Conference full name: ${batch[0].conferenceTitle} (${batch[0].conferenceAcronym})\n\n1. Website of ${batch[0].conferenceAcronym}: ${finalUrl}\nWebsite information of ${batch[0].conferenceAcronym}:\n\n${fullText.trim()}`;

            let websiteLinksResponseText: string = "";
            let websiteLinksResponse: any;

            try {
                parentLogger.info({ ...baseLogContext, event: 'process_determine_api2_start' }, "Calling determine_links_api (2nd call) for the fetched website");
                // Pass correct conference name/acronym
                websiteLinksResponse = await determine_links_api(batchContentForApi, batchIndex, batch[0].conferenceTitle, batch[0].conferenceAcronym, parentLogger);
                websiteLinksResponseText = websiteLinksResponse.responseText || "";
                parentLogger.info({ ...baseLogContext, responseLength: websiteLinksResponseText.length, event: 'process_determine_api2_end', success: true }, "Received response from determine_links_api (2nd call)");
            } catch (determineLinksError: any) {
                parentLogger.error({ ...baseLogContext, err: determineLinksError, event: 'process_determine_api2_call_failed' }, "Error calling determine_links_api (2nd call)");
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after API 2 error"));
                batch[0].conferenceLink = "None";
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'API call 2 failed' }, "Finishing processDetermineLinksResponse with error state");
                return [batch[0]];
            }

            let websiteLinksData: any;
            try {
                websiteLinksData = JSON.parse(websiteLinksResponseText);
            } catch (parseError: any) {
                parentLogger.error({ ...baseLogContext, err: parseError, responseTextPreview: websiteLinksResponseText.substring(0, 100), event: 'process_determine_json_parse_failed', apiCallNumber: 2 }, "Error parsing JSON response from determine_links_api (2nd call)");
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after JSON parse 2 error"));
                batch[0].conferenceLink = "None";
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'JSON parse 2 failed' }, "Finishing processDetermineLinksResponse with error state");
                return [batch[0]];
            }

            let websiteCfpLink: string | undefined = websiteLinksData["Call for papers link"]?.trim();
            let websiteImpDatesLink: string | undefined = websiteLinksData["Important dates link"]?.trim();

            websiteCfpLink = normalizeAndJoinLink(finalUrl, websiteCfpLink);
            websiteImpDatesLink = normalizeAndJoinLink(finalUrl, websiteImpDatesLink);
            parentLogger.debug({ ...baseLogContext, websiteCfpLink, websiteImpDatesLink, event: 'process_determine_links_normalized', source: 'api_call_2' }, "Parsed and normalized links from 2nd API call");

            let saveErrorOccurred = false;
            try {
                batch[0].conferenceLink = finalUrl;
                batch[0].conferenceTextPath = textPath;
                batch[0].cfpLink = websiteCfpLink || "";
                batch[0].impLink = websiteImpDatesLink || "";

                if (websiteCfpLink && websiteCfpLink.toLowerCase() !== "none") {
                    const saveContext = { ...baseLogContext, url: websiteCfpLink, contentType: 'CFP', source: 'api_call_2' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_new_start' }, "Saving CFP content (from 2nd API call)");
                    batch[0].cfpTextPath = await saveHTMLFromCallForPapers(page, websiteCfpLink, batch[0].conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: batch[0].cfpTextPath, event: 'process_determine_save_new_success' }, "Saved CFP content (from 2nd API call)");
                }
                if (websiteImpDatesLink && websiteImpDatesLink.toLowerCase() !== "none") {
                    const saveContext = { ...baseLogContext, url: websiteImpDatesLink, contentType: 'IMP', source: 'api_call_2' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_new_start' }, "Saving Important Dates content (from 2nd API call)");
                    batch[0].impTextPath = await saveHTMLFromImportantDates(page, websiteImpDatesLink, batch[0].conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: batch[0].impTextPath, event: 'process_determine_save_new_success' }, "Saved Important Dates content (from 2nd API call)");
                }
                parentLogger.info({ ...baseLogContext, event: 'process_determine_update_entry_success' }, "Updated original batch entry with new links and paths");
            } catch (saveContentError: any) {
                saveErrorOccurred = true;
                parentLogger.error({ ...baseLogContext, err: saveContentError, websiteCfpLink, websiteImpDatesLink, event: 'process_determine_save_new_failed', source: 'api_call_2' }, "Error saving CFP/IMP content (from 2nd API call)");
            } finally {
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page for new entry"));
            }
            parentLogger.info({ ...baseLogContext, success: !saveErrorOccurred, event: 'process_determine_finish_success' }, `Finishing processDetermineLinksResponse for new entry (save error: ${saveErrorOccurred})`);
            return [batch[0]];
        }
    } catch (error: any) {
        parentLogger.error({ ...baseLogContext, err: error, event: 'process_determine_unhandled_error' }, "Unhandled error in processDetermineLinksResponse");
        if (page && !page.isClosed()) {
            await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page in outer catch block"));
        }
        if (batch && batch[0]) {
            batch[0].conferenceLink = "None";
            parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Unhandled error' }, "Finishing processDetermineLinksResponse with error state due to unhandled error");
            return [batch[0]];
        }
        parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Unhandled error and invalid batch' }, "Finishing processDetermineLinksResponse empty due to unhandled error and invalid batch");
        return [];
    }
};


const BATCHES_DIR = path.join(__dirname, "./data/batches");
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');

// --- saveBatchToFile ---
export const saveBatchToFile = async (
    batch: BatchEntry[], // Batch các entry thành công từ saveHTMLContent
    batchIndex: number,
    adjustedAcronym: string, // không còn cần thiết trực tiếp ở đây nếu thông tin có trong batch
    browserContext: BrowserContext,
    parentLogger: typeof logger
): Promise<void> => { // <--- Thay đổi kiểu trả về thành Promise<void>
    const baseLogContext = { batchIndex, function: 'saveBatchToFile' };
    parentLogger.info({ ...baseLogContext, event: 'save_batch_start', entryCount: batch.length }, "Starting saveBatchToFile");

    let conferenceAcronym = 'unknown';
    let conferenceTitle = 'unknown';
    let safeConferenceAcronym = 'unknown';

    try {
        await init(); // Khởi tạo API client nếu cần

        if (!batch || batch.length === 0 || !batch[0]?.conferenceAcronym || !batch[0]?.conferenceTitle) {
            parentLogger.warn({ ...baseLogContext, event: 'save_batch_invalid_input' }, "Called with invalid or empty batch. Skipping.");
            // Không cần làm gì thêm, promise sẽ resolve (không reject)
            return;
        }

        // Lấy thông tin cơ bản từ entry đầu tiên (giả định tất cả entry trong batch là của cùng 1 conference)
        conferenceAcronym = batch[0].conferenceAcronym;
        conferenceTitle = batch[0].conferenceTitle;
        safeConferenceAcronym = conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const logContext = { ...baseLogContext, conferenceAcronym, conferenceTitle };

         // --- Đảm bảo thư mục tồn tại ---
         try {
            // Đảm bảo thư mục batches tồn tại (cho file trung gian)
            if (!fs.existsSync(BATCHES_DIR)) {
                parentLogger.info({ ...logContext, path: BATCHES_DIR, event: 'save_batch_dir_create' }, "Creating batches directory");
                fs.mkdirSync(BATCHES_DIR, { recursive: true });
            }
            // Đảm bảo thư mục chứa file output cuối cùng tồn tại
            const finalOutputDir = path.dirname(FINAL_OUTPUT_PATH);
            if (!fs.existsSync(finalOutputDir)) {
                 parentLogger.info({ ...logContext, path: finalOutputDir, event: 'save_batch_final_dir_create' }, "Creating final output directory");
                 fs.mkdirSync(finalOutputDir, { recursive: true });
            }
        } catch (mkdirError: any) {
            parentLogger.error({ ...logContext, err: mkdirError, event: 'save_batch_dir_create_failed' }, "Error creating necessary directories");
            throw mkdirError; // Lỗi nghiêm trọng, dừng xử lý batch này
        }
        // --- Hết đảm bảo thư mục ---

        const fileFullLinksName = `${safeConferenceAcronym}_full_links.txt`;
        const fileFullLinksPath = path.join(BATCHES_DIR, fileFullLinksName);
        const fileMainLinkName = `${safeConferenceAcronym}_main_link.txt`;
        const fileMainLinkPath = path.join(BATCHES_DIR, fileMainLinkName);

        // --- Aggregation 1 (for determine_links_api) ---
        parentLogger.debug({ ...logContext, event: 'save_batch_aggregate_content_start', purpose: 'determine_api' }, "Aggregating content for full_links file / determine_api");
        let batchContentParts: string[] = [];
        const readPromises = batch.map(async (entry, i) => {
            try {
                const text = await readContentFromFile(entry.conferenceTextPath);
                 // Sử dụng adjustedAcronymForText nếu có, hoặc tự tạo lại nếu cần
                const linkIdentifier = adjustedAcronym || `${entry.conferenceAcronym}_${entry.conferenceIndex}`;
                const formattedText = `Website of ${linkIdentifier}: ${entry.conferenceLink}\nWebsite information of ${linkIdentifier}:\n\n${text.trim()}`;
                return { index: i, content: `${i + 1}. ${formattedText}\n\n` };
            } catch (readError: any) {
                parentLogger.error({ ...logContext, err: readError, filePath: entry.conferenceTextPath, entryIndex: i, event: 'save_batch_read_content_failed', aggregationPurpose: 'determine_api' }, "Error reading content file for batch aggregation");
                return { index: i, content: `${i + 1}. ERROR READING CONTENT for ${entry.conferenceLink}\n\n` }; // Placeholder
            }
        });
        const readResults = await Promise.all(readPromises);
        readResults.sort((a, b) => a.index - b.index); // Đảm bảo thứ tự
        batchContentParts = readResults.map(r => r.content);
        const batchContentForDetermine = `Conference full name: ${conferenceTitle} (${conferenceAcronym})\n\n` + batchContentParts.join("");
        parentLogger.debug({ ...logContext, charCount: batchContentForDetermine.length, event: 'save_batch_aggregate_content_end', purpose: 'determine_api' }, "Finished aggregating content for determine_api");
        // --- End Aggregation 1 ---

    
         // Ghi file _full_links.txt (vẫn hữu ích cho debug, chạy bất đồng bộ)
         const writeFullLinksContext = { ...logContext, filePath: fileFullLinksPath, fileType: 'full_links' };
         parentLogger.debug({ ...writeFullLinksContext, event: 'save_batch_write_file_start' }, "Writing full links content (async)");
         const fileFullLinksPromise = fs.promises.writeFile(fileFullLinksPath, batchContentForDetermine, "utf8")
             .then(() => {
                 parentLogger.debug({ ...writeFullLinksContext, event: 'save_batch_write_file_success' }, "Successfully wrote full links file");
             })
             .catch(writeError => {
                 // Chỉ log lỗi, không dừng tiến trình chính trừ khi file này là bắt buộc
                 parentLogger.error({ ...writeFullLinksContext, err: writeError, event: 'save_batch_write_file_failed' }, "Error writing full_links file (non-critical)");
             });
 
         // --- Gọi determine_links_api ---
         let determineLinksResponse: any;
         let determineResponseTextPath: string | undefined;
         const determineApiContext = { ...logContext, apiType: 'determine' };
         try {
             parentLogger.info({ ...determineApiContext, inputLength: batchContentForDetermine.length, event: 'save_batch_determine_api_start' }, "Calling determine_links_api");
             determineLinksResponse = await determine_links_api(batchContentForDetermine, batchIndex, conferenceTitle, conferenceAcronym, parentLogger);
             const determineResponseText = determineLinksResponse.responseText || "";
             determineResponseTextPath = await writeTempFile(determineResponseText, `${safeConferenceAcronym}_determine_response_${batchIndex}`); // Thêm batchIndex để tránh ghi đè nếu có lỗi retry
             // Cập nhật thông tin vào entry đầu tiên của batch gốc (hoặc tạo một cấu trúc riêng nếu cần)
             // Lưu ý: Việc sửa đổi batch gốc có thể không an toàn nếu batch được dùng ở nơi khác. Cân nhắc tạo bản sao.
              batch[0].determineResponseTextPath = determineResponseTextPath;
              batch[0].determineMetaData = determineLinksResponse.metaData;
             parentLogger.info({ ...determineApiContext, responseLength: determineResponseText.length, filePath: determineResponseTextPath, event: 'save_batch_determine_api_end', success: true }, "determine_links_api call successful, response saved");
         } catch (determineLinksError: any) {
             parentLogger.error({ ...determineApiContext, err: determineLinksError, event: 'save_batch_determine_api_call_failed' }, "Error calling determine_links_api");
             await fileFullLinksPromise; // Đảm bảo file log (nếu ghi) đã xong
             throw determineLinksError; // Ném lỗi để Promise bị reject
         }
 
         // Đọc lại response từ file (đảm bảo dữ liệu nhất quán)
         if (!determineResponseTextPath) {
             // Trường hợp này không nên xảy ra nếu API call thành công
              parentLogger.error({ ...logContext, event: 'save_batch_missing_determine_path' }, "Determine response path is missing unexpectedly after successful API call");
              await fileFullLinksPromise;
              throw new Error("Internal error: Missing determine response path");
         }
         let determineResponseFromFile = '';
         try {
             determineResponseFromFile = await readContentFromFile(determineResponseTextPath);
         } catch (readErr: any) {
             parentLogger.error({ ...logContext, err: readErr, filePath: determineResponseTextPath, event: 'save_batch_read_determine_failed' }, "Error reading determine response file");
             await fileFullLinksPromise;
             throw readErr; // Ném lỗi
         }
         // --- Hết determine_links_api ---
 
 
    
         // --- Xử lý kết quả determine_links_api ---
         const processDetermineContext = { ...logContext, event_group: 'process_determine_in_save_batch' };
         parentLogger.info({ ...processDetermineContext, responseLength: determineResponseFromFile.length, event: 'save_batch_process_determine_start' }, "Processing determine_links_api response");
         let mainLinkBatch: BatchEntry[] | null = null;
         try {
             // Hàm này cần trả về batch đã được cập nhật với path của main, cfp, imp text
             mainLinkBatch = await processDetermineLinksResponse(
                 determineResponseFromFile,
                 batch, // Truyền batch gốc vào để nó có thể cập nhật hoặc sử dụng thông tin
                 batchIndex,
                 browserContext,
                 YEAR2, // Hoặc giá trị năm phù hợp
                 1, // Giả sử đây là lần xử lý đầu tiên
                 parentLogger
             );
         } catch (processError: any) {
             parentLogger.error({ ...processDetermineContext, err: processError, event: 'save_batch_process_determine_call_failed' }, "Error calling processDetermineLinksResponse");
              throw processError; // Ném lỗi
         }
 
         // Kiểm tra kết quả xử lý
         if (!mainLinkBatch || mainLinkBatch.length === 0 || !mainLinkBatch[0] || mainLinkBatch[0].conferenceLink === "None" || !mainLinkBatch[0].conferenceTextPath) {
             parentLogger.warn({ ...processDetermineContext, mainLinkResult: mainLinkBatch?.[0]?.conferenceLink, mainTextPath: mainLinkBatch?.[0]?.conferenceTextPath, event: 'save_batch_process_determine_failed_invalid' }, "Main link/text path is invalid after processing determine_links response. Skipping further processing and final append for this batch.");
             await fileFullLinksPromise; // Đợi ghi file log
             return; // Kết thúc thành công (không có lỗi), nhưng không ghi gì vào output cuối cùng
         }
         const foundMainLink = mainLinkBatch[0].conferenceLink;
         parentLogger.info({ ...processDetermineContext, finalMainLink: foundMainLink, event: 'save_batch_process_determine_success' }, "Successfully processed determine_links_api response");
         // --- Hết xử lý determine ---
 
 
         // --- Aggregation 2 (for extract_information_api) ---
         const aggregateExtractContext = { ...logContext, event_group: 'aggregate_for_extract' };
         parentLogger.debug({ ...aggregateExtractContext, event: 'save_batch_aggregate_extract_start' }, "Aggregating content for extract_information_api");
         let mainText = '', cfpText = '', impText = '';
         const mainEntry = mainLinkBatch[0]; // Entry chứa thông tin link chính, cfp, imp
 
         try { mainText = await readContentFromFile(mainEntry.conferenceTextPath); }
         catch (e: any) { parentLogger.warn({ ...aggregateExtractContext, err: e, filePath: mainEntry.conferenceTextPath, contentType: 'main', event: 'save_batch_aggregate_extract_read_failed' }, "Could not read main text file"); }
         // Chỉ đọc nếu có đường dẫn
         if (mainEntry.cfpTextPath) {
             try { cfpText = await readContentFromFile(mainEntry.cfpTextPath); }
             catch (e: any) { parentLogger.warn({ ...aggregateExtractContext, err: e, filePath: mainEntry.cfpTextPath, contentType: 'cfp', event: 'save_batch_aggregate_extract_read_failed' }, "Could not read CFP text file"); }
         } else {
              parentLogger.debug({ ...aggregateExtractContext, contentType: 'cfp', event: 'save_batch_aggregate_extract_read_skipped' }, "CFP text path not available, skipping read.");
         }
         if (mainEntry.impTextPath) {
             try { impText = await readContentFromFile(mainEntry.impTextPath); }
             catch (e: any) { parentLogger.warn({ ...aggregateExtractContext, err: e, filePath: mainEntry.impTextPath, contentType: 'imp', event: 'save_batch_aggregate_extract_read_failed' }, "Could not read IMP text file"); }
         } else {
             parentLogger.debug({ ...aggregateExtractContext, contentType: 'imp', event: 'save_batch_aggregate_extract_read_skipped' }, "IMP text path not available, skipping read.");
         }
 
 
         const impContent = impText ? ` \n\nImportant Dates information:\n${impText.trim()}` : "";
         const cfpContent = cfpText ? ` \n\nCall for Papers information:\n${cfpText.trim()}` : "";
         // Sử dụng title và acronym từ mainEntry để đảm bảo nhất quán
         const contentSendToAPI = `Conference ${mainEntry.conferenceTitle} (${mainEntry.conferenceAcronym}):\n\n${mainText.trim()}${cfpContent}${impContent}`;
         const titleForExtract = mainEntry.conferenceTitle;
         const acronymForExtract = mainEntry.conferenceAcronym; // Acronym gốc
         parentLogger.debug({ ...aggregateExtractContext, charCount: contentSendToAPI.length, event: 'save_batch_aggregate_extract_end' }, "Finished aggregating content for extract_api");
         // --- End Aggregation 2 ---
 
 
         // Ghi file _main_link.txt (vẫn hữu ích cho debug, chạy bất đồng bộ)
         const writeMainLinkContext = { ...logContext, filePath: fileMainLinkPath, fileType: 'main_link' };
         parentLogger.debug({ ...writeMainLinkContext, event: 'save_batch_write_file_start' }, "Writing main link aggregated content (async)");
         const fileMainLinkPromise = fs.promises.writeFile(fileMainLinkPath, contentSendToAPI, "utf8")
             .then(() => {
                 parentLogger.debug({ ...writeMainLinkContext, event: 'save_batch_write_file_success' }, "Successfully wrote main link file");
             })
             .catch(writeError => {
                 parentLogger.error({ ...writeMainLinkContext, err: writeError, event: 'save_batch_write_file_failed' }, "Error writing main_link file (non-critical)");
             });
 
         // --- Gọi extract_information_api ---
         let extractResponseTextPath: string | undefined;
         let extractInformationResponse: any;
         const extractApiContext = { ...logContext, apiType: 'extract', title: titleForExtract, acronym: acronymForExtract };
         try {
             parentLogger.info({ ...extractApiContext, inputLength: contentSendToAPI.length, event: 'save_batch_extract_api_start' }, "Calling extract_information_api");
             extractInformationResponse = await extract_information_api(contentSendToAPI, batchIndex, titleForExtract, acronymForExtract, parentLogger);
             const extractResponseText = extractInformationResponse.responseText || "";
             extractResponseTextPath = await writeTempFile(extractResponseText, `${safeConferenceAcronym}_extract_response_${batchIndex}`);
             // Cập nhật thông tin vào mainEntry
             mainEntry.extractResponseTextPath = extractResponseTextPath;
             mainEntry.extractMetaData = extractInformationResponse.metaData;
             parentLogger.info({ ...extractApiContext, responseLength: extractResponseText.length, filePath: extractResponseTextPath, event: 'save_batch_extract_api_end', success: true }, "extract_information_api call successful, response saved");
         } catch (extractInformationError: any) {
             parentLogger.error({ ...extractApiContext, err: extractInformationError, event: 'save_batch_extract_api_call_failed' }, "Error calling extract_information_api");
             await Promise.allSettled([fileFullLinksPromise, fileMainLinkPromise]); // Chờ ghi file log xong
             throw extractInformationError; // Ném lỗi để Promise bị reject
         }
         // --- Hết extract_information_api ---
 
 
         // --- Chờ các file trung gian ghi xong (không bắt buộc, nhưng đảm bảo chúng hoàn tất trước khi ghi final) ---
         const intermediateWrites = await Promise.allSettled([fileFullLinksPromise, fileMainLinkPromise]);
         intermediateWrites.forEach((result, index) => {
             if (result.status === 'rejected') {
                  parentLogger.warn({ ...logContext, fileIndex: index, reason: result.reason, event: 'save_batch_intermediate_write_settled_failed' }, `Intermediate file write ${index === 0 ? '_full_links' : '_main_link'} failed (logged earlier).`);
             }
         });
         parentLogger.info({ ...logContext, event: 'save_batch_intermediate_files_settled' }, "Finished waiting for intermediate batch files (_full_links, _main_link) writes.");


         // --- Chuẩn bị và Ghi bản ghi cuối cùng ---
        const finalAppendContext = { ...logContext, outputPath: FINAL_OUTPUT_PATH };
        try {
            parentLogger.info({ ...finalAppendContext, event: 'save_batch_prepare_final_record' }, "Preparing final record for appending");
            // Tạo object dữ liệu cuối cùng theo cấu trúc ProcessedResponseData
            const finalRecord: BatchEntry = { // Sử dụng kiểu dữ liệu cuối cùng của bạn
                conferenceTitle: mainLinkBatch[0].conferenceTitle,
                conferenceAcronym: mainLinkBatch[0].conferenceAcronym, // Acronym gốc, không có index
                conferenceIndex: mainLinkBatch[0].conferenceIndex, // Index gốc, không có acronym
                
                // conferenceSource: mainLinkBatch[0].conferenceSource, // Lấy từ batch gốc nếu cần
                // conferenceRank: mainLinkBatch[0].conferenceRank, // Lấy từ batch gốc nếu cần
                conferenceLink: mainLinkBatch[0].conferenceLink,
                cfpLink: mainLinkBatch[0].cfpLink || "",
                impLink: mainLinkBatch[0].impLink || "",
                // Đường dẫn đến các file text gốc nếu cần giữ lại
                conferenceTextPath: mainLinkBatch[0].conferenceTextPath,
                cfpTextPath: mainLinkBatch[0].cfpTextPath,
                impTextPath: mainLinkBatch[0].impTextPath,
                // Đường dẫn đến file response API (quan trọng)
                determineResponseTextPath: mainLinkBatch[0].determineResponseTextPath,
                extractResponseTextPath: mainLinkBatch[0].extractResponseTextPath,
                // Metadata từ API nếu cần
                determineMetaData: mainLinkBatch[0].determineMetaData,
                extractMetaData: mainLinkBatch[0].extractMetaData,

            };

            const dataToWrite = JSON.stringify(finalRecord) + '\n'; // Định dạng JSON Lines

            parentLogger.info({ ...finalAppendContext, recordAcronym: finalRecord.conferenceAcronym, event: 'save_batch_append_start' }, "Appending final result to output file");
            await fs.promises.appendFile(FINAL_OUTPUT_PATH, dataToWrite, 'utf8');
            parentLogger.info({ ...finalAppendContext, recordAcronym: finalRecord.conferenceAcronym, event: 'save_batch_append_success' }, "Successfully appended final result");

        } catch (appendError: any) {
            parentLogger.error({ ...finalAppendContext, err: appendError, event: 'save_batch_append_final_failed' }, "CRITICAL: Failed to append final result to output file");
            // Ném lỗi này vì đây là bước quan trọng nhất
            throw appendError;
        }
        // --- Hết ghi bản ghi cuối cùng ---

        parentLogger.info({ ...logContext, event: 'save_batch_finish_success' }, "Finishing saveBatchToFile successfully");
        return; // <--- Kết thúc thành công (Promise<void>)

    } catch (error: any) {
        // Bắt các lỗi được ném từ các bước trước (API calls, file read/write errors, append error)
        parentLogger.error({ ...baseLogContext, conferenceAcronym, err: error, event: 'save_batch_unhandled_error_or_rethrown' }, "Error occurred during saveBatchToFile execution");
        // Không cần return gì cả, chỉ cần đảm bảo lỗi được ném ra
        // để Promise tương ứng trong crawlConferences bị reject
        throw error; // Ném lại lỗi để Promise reject
    }
};


// --- saveHTMLContent ---
export const saveHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceData,
    links: string[],
    batchIndexRef: { current: number },
    existingAcronyms: Set<string>,
    batchPromises: Promise<void>[],
    year: number,
    parentLogger: typeof logger
): Promise<void> => {
    // Context kế thừa từ taskLogger của crawlConferences, thêm function name
    const baseLogContext = { conferenceAcronym: conference.Acronym, conferenceTitle: conference.Title, function: 'saveHTMLContent' };
    parentLogger.info({ ...baseLogContext, linkCount: links.length, event: 'save_html_start' }, "Starting saveHTMLContent");

    try {
        const batch: BatchEntry[] = [];
        if (!links || links.length === 0) {
            parentLogger.warn({ ...baseLogContext, event: 'save_html_skipped_no_links' }, "Called with empty or null links array, skipping.");
            parentLogger.info({ ...baseLogContext, event: 'save_html_finish' }, "Finishing saveHTMLContent (no links)"); // Log kết thúc
            return;
        }

        let finalAdjustedAcronym = "";
        let linkProcessingSuccessCount = 0;
        let linkProcessingFailedCount = 0;

        // Không log "Processing links" nữa vì đã có log start

        for (let i = 0; i < links.length; i++) {
            const linkIndex = i;
            // Log context riêng cho từng link
            const linkLogContext = { ...baseLogContext, linkIndex, originalUrl: links[i], event_group: 'link_processing' };
            parentLogger.info({ ...linkLogContext, event: 'link_processing_start' }, `Processing link ${i + 1}/${links.length}`);
            let page: Page | null = null;
            let linkProcessedSuccessfully = false; // Cờ cho link hiện tại

            try {
                page = await browserContext.newPage();
                let originalLink: string = links[i];
                let finalLink: string = originalLink;
                let useModifiedLink: boolean = false;
                let modifiedLink: string = originalLink;

                const yearOld1 = year - 1;
                const yearOld2 = year - 2;
                const yearStr = String(year);

                if (originalLink.includes(String(yearOld1))) {
                    modifiedLink = originalLink.replace(new RegExp(String(yearOld1), 'g'), yearStr);
                    useModifiedLink = true;
                } else if (originalLink.includes(String(yearOld2))) {
                    modifiedLink = originalLink.replace(new RegExp(String(yearOld2), 'g'), yearStr);
                    useModifiedLink = true;
                }

                let accessSuccess = false;
                let accessError: any = null;
                let responseStatus: number | null = null;
                let accessType: 'modified' | 'original' | null = null;

                // Try modified link
                if (useModifiedLink) {
                    accessType = 'modified';
                    parentLogger.info({ ...linkLogContext, url: modifiedLink, type: accessType, event: 'link_access_attempt' }, "Attempting modified link");
                    try {
                        const response = await page.goto(modifiedLink, { waitUntil: "domcontentloaded", timeout: 25000 });
                        responseStatus = response?.status() ?? null;
                        if (response && response.ok()) {
                            finalLink = page.url(); // Cập nhật finalLink ngay khi thành công
                            parentLogger.info({ ...linkLogContext, url: modifiedLink, status: responseStatus, finalUrl: finalLink, type: accessType, event: 'link_access_success' }, "Modified link access successful");
                            accessSuccess = true;
                        } else {
                            accessError = new Error(`HTTP ${responseStatus} accessing modified link`);
                            parentLogger.warn({ ...linkLogContext, url: modifiedLink, status: responseStatus, type: accessType, event: 'link_access_failed' }, "Modified link failed (HTTP status), reverting to original");
                            useModifiedLink = false;
                            finalLink = originalLink;
                        }
                    } catch (error: any) {
                        accessError = error;
                        parentLogger.warn({ ...linkLogContext, url: modifiedLink, type: accessType, err: error, event: 'link_access_failed' }, "Error accessing modified link (exception), will try original");
                        useModifiedLink = false;
                        finalLink = originalLink;
                        // Ghi log phụ nếu cần
                        // const timestamp = new Date().toISOString(); ... log file phụ ...
                    }
                }

                // Try original link if needed
                if (!accessSuccess) {
                    accessType = 'original';
                    parentLogger.info({ ...linkLogContext, url: originalLink, type: accessType, event: 'link_access_attempt' }, "Attempting original link");
                    try {
                        const response = await page.goto(originalLink, { waitUntil: "domcontentloaded", timeout: 25000 });
                        responseStatus = response?.status() ?? null;
                        if (response && response.ok()) {
                            finalLink = page.url();
                            parentLogger.info({ ...linkLogContext, url: originalLink, status: responseStatus, finalUrl: finalLink, type: accessType, event: 'link_access_success' }, "Original link access successful");
                            accessSuccess = true;
                        } else {
                            accessError = new Error(`HTTP ${responseStatus} accessing originalLink`);
                            parentLogger.error({ ...linkLogContext, url: originalLink, status: responseStatus, type: accessType, event: 'link_access_failed' }, `Original link failed (HTTP ${responseStatus}), skipping link`);
                        }
                    } catch (error: any) {
                        accessError = error;
                        parentLogger.error({ ...linkLogContext, url: originalLink, type: accessType, err: error, event: 'link_access_failed' }, "Error accessing original link (exception), skipping link");
                        // Ghi log phụ nếu cần
                        // const timestamp = new Date().toISOString(); ... log file phụ ...
                    }
                }

                // If access failed completely for this link, log and continue
                if (!accessSuccess) {
                    linkProcessingFailedCount++;
                    parentLogger.error({ ...linkLogContext, err: accessError, finalStatus: responseStatus, event: 'link_processing_failed_skip' }, "Failed to access link after all attempts, skipping this link.");
                    continue; // Skip to the next link in the loop
                }

                // --- Access Success, Proceed ---

                // Check for redirects and wait if necessary
                let intendedUrl = useModifiedLink ? modifiedLink : originalLink;
                // Check if page.url() is different from the *intended* target (could be modified or original)
                if (page.url() !== intendedUrl && page.url() !== finalLink) {
                    finalLink = page.url(); // Update finalLink again to the absolute final URL
                    parentLogger.info({ ...linkLogContext, fromUrl: intendedUrl, toUrl: finalLink, event: 'redirect_detected' }, "Redirect detected");
                    try {
                        await page.waitForLoadState('load', { timeout: 10000 });
                        parentLogger.debug({ ...linkLogContext, url: finalLink, event: 'redirect_wait_success' }, "Waited for load state after redirect.");
                    } catch (err: any) {
                        parentLogger.warn({ ...linkLogContext, url: finalLink, err: err, event: 'redirect_wait_failed' }, "Timeout or unstable state after redirect.");
                    }
                }

                // Fetch content
                let htmlContent;
                const fetchContext = { ...linkLogContext, url: finalLink };
                try {
                    parentLogger.debug({ ...fetchContext, event: 'content_fetch_start' }, "Fetching content");
                    htmlContent = await fetchContentWithRetry(page); // Assume this handles retries and logs internally
                    parentLogger.debug({ ...fetchContext, event: 'content_fetch_success' }, "Content fetched");
                } catch (fetchErr: any) {
                    linkProcessingFailedCount++;
                    parentLogger.error({ ...fetchContext, err: fetchErr, event: 'content_fetch_failed' }, "Failed to fetch content, skipping link.");
                    continue; // Skip this link
                }


                // Clean DOM
                let document;
                const cleanContext = { ...linkLogContext, url: finalLink };
                try {
                    parentLogger.debug({ ...cleanContext, event: 'dom_clean_start' }, "Cleaning DOM");
                    document = cleanDOM(htmlContent);
                    if (!document || !document.body) {
                        throw new Error("Cleaned DOM or document body is null");
                    }
                    parentLogger.debug({ ...cleanContext, event: 'dom_clean_success' }, "DOM cleaned");
                } catch (cleanErr: any) {
                    linkProcessingFailedCount++;
                    parentLogger.warn({ ...cleanContext, err: cleanErr, event: 'dom_clean_failed' }, "Failed to clean DOM or body is null, skipping link");
                    continue; // Skip this link
                }


                // Traverse Nodes & Save Text
                let fullText = '';
                let textPath = '';
                const traverseContext = { ...linkLogContext, url: finalLink };
                try {
                    parentLogger.debug({ ...traverseContext, event: 'node_traverse_start' }, "Traversing nodes");
                    fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, year);
                    fullText = removeExtraEmptyLines(fullText);
                    parentLogger.debug({ ...traverseContext, textLength: fullText.length, event: 'node_traverse_success' }, "Nodes traversed");

                    const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
                    // Sử dụng safeAcronym cho tên file tạm
                    textPath = await writeTempFile(fullText, `${safeAcronym}_${linkIndex}_initial`);
                    parentLogger.debug({ ...traverseContext, filePath: textPath, event: 'initial_text_saved' }, "Saved initial text to temp file");
                } catch (traverseSaveErr: any) {
                    linkProcessingFailedCount++;
                    parentLogger.error({ ...traverseContext, err: traverseSaveErr, event: 'node_traverse_or_save_failed' }, "Error traversing nodes or saving text, skipping link.");
                    continue; // Skip this link
                }


                // Acronym handling (giữ nguyên)
                const acronym_index = `${conference.Acronym}_${linkIndex}`;
                const adjustedAcronym = await addAcronymSafely(existingAcronyms, acronym_index);
                finalAdjustedAcronym = adjustedAcronym;
                let acronym_no_index = adjustedAcronym.replace(/_\d+$/, '');

                // Add to batch
                batch.push({
                    conferenceTitle: conference.Title,
                    conferenceAcronym: acronym_no_index,
                    // conferenceSource: conference.Source || "",
                    // conferenceRank: conference.Rank || "",
                    // conferenceNote: conference.Note || "",
                    // conferenceDBLP: conference.DBLP || "",
                    // conferencePrimaryFoR: conference.PrimaryFoR || "",
                    // conferenceComments: conference.Comments || "",
                    // conferenceRating: conference.Rating || "",
                    // conferenceDetails: conference.Details || [],
                    conferenceIndex: String(linkIndex),
                    conferenceLink: finalLink, // Final successful URL
                    conferenceTextPath: textPath,
                    cfpLink: "", impLink: "", // To be filled by saveBatchToFile
                    // Các path khác sẽ được điền bởi saveBatchToFile
                });

                linkProcessedSuccessfully = true; // Đánh dấu link này xử lý thành công
                linkProcessingSuccessCount++;
                parentLogger.info({ ...linkLogContext, finalUrl: finalLink, textPath, adjustedAcronym, event: 'link_processing_success' }, "Successfully processed link and added to batch");

            } catch (loopError: any) {
                linkProcessingFailedCount++; // Đếm lỗi không xác định trong vòng lặp
                parentLogger.error({ ...linkLogContext, url: links[i], err: loopError, event: 'link_loop_unhandled_error' }, "Unhandled error processing link in loop");
                // Ghi log phụ nếu cần
                // const timestamp = new Date().toISOString(); ... log file phụ ...
                // Continue to next link implicitly

            } finally {
                parentLogger.debug({ ...linkLogContext, success: linkProcessedSuccessfully, event: 'link_processing_end' }, `Finished processing link ${i + 1}`);
                if (page && !page.isClosed()) {
                    try {
                        await page.close();
                    } catch (closeError: any) {
                        parentLogger.error({ ...linkLogContext, err: closeError, event: 'page_close_failed' }, "Error closing page in finally block");
                    }
                }
            }
        } // End for loop links

        // --- Create Batch Task ---
        if (batch.length > 0) {
            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current++;
            // Log sự kiện tạo batch task
            parentLogger.info({
                ...baseLogContext,
                batchIndex: currentBatchIndex,
                entries: batch.length,
                linksProcessedSuccessfully: linkProcessingSuccessCount, // Thêm thông tin
                linksProcessingFailed: linkProcessingFailedCount, // Thêm thông tin
                event: 'batch_task_create'
            }, `Creating batch task`);
            // Hàm saveBatchToFile sẽ log chi tiết bên trong
            const batchPromise = saveBatchToFile(batch, currentBatchIndex, finalAdjustedAcronym, browserContext, parentLogger);
            batchPromises.push(batchPromise);
        } else {
            parentLogger.warn({
                ...baseLogContext,
                linksProcessedSuccessfully: linkProcessingSuccessCount,
                linksProcessingFailed: linkProcessingFailedCount,
                event: 'batch_creation_skipped_empty'
            }, "Batch is empty after processing all links (all failed or skipped). No batch task created.");
        }

        parentLogger.info({ ...baseLogContext, event: 'save_html_finish' }, "Finishing saveHTMLContent"); // Log kết thúc hàm
        return;

    } catch (error: any) {
        parentLogger.error({ ...baseLogContext, err: error, event: 'save_html_unhandled_error' }, "Unhandled error in saveHTMLContent main try block");
        // Không re-throw để không làm dừng toàn bộ crawlConferences nếu không cần thiết
        parentLogger.info({ ...baseLogContext, event: 'save_html_finish_failed' }, "Finishing saveHTMLContent due to unhandled error");
        return;
    }
};



// --- Revised updateHTMLContent ---
export const updateHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceUpdateData, // Use specific interface
    batchIndexRef: { current: number },
    batchPromises: Promise<BatchUpdateEntry[] | null>[], // Promise returns BatchUpdateEntry[]
    parentLogger: typeof logger
): Promise<{ updatedBatches: [] }> => { // Return type is minimal

    const taskLogger = parentLogger.child({ title: conference.Title, acronym: conference.Acronym, function: 'updateHTMLContent' });
    let page: Page | null = null; // Declare page outside try

    try {
        page = await browserContext.newPage();
        taskLogger.info(`Processing update for ${conference.Acronym}`);

        let mainTextPath: string | undefined = undefined;
        let cfpTextPath: string | undefined | null;
        let impTextPath: string | undefined | null;

        // 1. Process Main Link
        const mainLink = conference.mainLink;
        try {
            taskLogger.debug({ link: mainLink }, `Navigating to main link`);
            await page.goto(mainLink, { waitUntil: "domcontentloaded", timeout: 25000 });
            const htmlContent = await fetchContentWithRetry(page);
            const document = cleanDOM(htmlContent);
            if (document) {
                let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, YEAR2);
                fullText = removeExtraEmptyLines(fullText);
                if (fullText.trim()) {
                    mainTextPath = await writeTempFile(fullText.trim(), `${conference.Acronym}_main_update`);
                    taskLogger.info(`Main content processed and saved to path.`);
                } else {
                    taskLogger.warn("Main content extracted was empty.");
                }
            } else {
                taskLogger.warn(`Failed to clean DOM for main link: ${mainLink}`);
            }
        } catch (error: any) {
            const timestamp = new Date().toISOString();
            const logMessage = `[${timestamp}] Error accessing/processing mainLink ${mainLink}: ${error.message} for ${conference.Acronym}\n`;
            taskLogger.error({ link: mainLink, error: error.message }, `Error accessing/processing main link`);
            await fs.promises.appendFile(ERROR_ACCESS_LINK_LOG_PATH, logMessage, 'utf8').catch(e => console.error("Failed to write error log:", e));
            // Decide if we should continue without main content? Let's assume yes for now.
        }

        // Use the SAME page instance to fetch CFP and IMP if links exist
        // 2. Process CFP Link (if exists)
        if (conference.cfpLink && conference.cfpLink.toLowerCase() !== "none") {
            try {
                taskLogger.debug({ link: conference.cfpLink }, `Processing CFP link`);
                // Use the existing 'saveHTML...' which now returns a path
                cfpTextPath = await saveHTMLFromCallForPapers(page, conference.cfpLink, conference.Acronym, YEAR2);
                if (cfpTextPath) {
                    taskLogger.info(`CFP content processed and saved to path.`);
                } else {
                    taskLogger.warn(`Failed to process CFP content from link: ${conference.cfpLink}`);
                }
            } catch (cfpError: any) {
                taskLogger.error({ link: conference.cfpLink, error: cfpError.message }, `Error processing CFP link`);
            }
        }

        // 3. Process IMP Link (if exists)
        if (conference.impLink && conference.impLink.toLowerCase() !== "none") {
            try {
                taskLogger.debug({ link: conference.impLink }, `Processing IMP link`);
                // Use the existing 'saveHTML...' which now returns a path
                impTextPath = await saveHTMLFromImportantDates(page, conference.impLink, conference.Acronym, YEAR2);
                if (impTextPath) {
                    taskLogger.info(`IMP content processed and saved to path.`);
                } else {
                    taskLogger.warn(`Failed to process IMP content from link: ${conference.impLink}`);
                }
            } catch (impError: any) {
                taskLogger.error({ link: conference.impLink, error: impError.message }, `Error processing IMP link`);
            }
        }

        // Only proceed if we have at least the main content path
        if (!mainTextPath) {
            taskLogger.error(`Skipping batch creation as main content could not be processed for ${conference.Acronym}`);
            return { updatedBatches: [] };
        }

        // 4. Create Batch Entry with Paths
        const batch: BatchUpdateEntry = {
            conferenceTitle: conference.Title,
            conferenceAcronym: conference.Acronym,
            // Store paths
            conferenceTextPath: mainTextPath,
            cfpTextPath: cfpTextPath,
            impTextPath: impTextPath,
            // Store links for reference if needed later
            cfpLink: conference.cfpLink,
            impLink: conference.impLink,
            // extractResponseTextPath will be added in updateBatchToFile
        };

        // 5. Add promise to the queue (DO NOT pass 'page')
        const currentBatchIndex = batchIndexRef.current;
        batchIndexRef.current++;
        taskLogger.info({ batchIndex: currentBatchIndex }, `Adding update batch task to queue`);
        // Pass only the batch data (with paths)
        const batchPromise = updateBatchToFile(batch, currentBatchIndex, parentLogger);
        batchPromises.push(batchPromise);


        return { updatedBatches: [] }; // Return minimal object

    } catch (error: any) {
        taskLogger.error(error, "Unhandled error in updateHTMLContent");
        console.error("Error in updateHTMLContent:", error); // Keep console for visibility
        console.error(error.stack);
        return { updatedBatches: [] };
    } finally {
        // Ensure page is closed
        if (page && !page.isClosed()) {
            taskLogger.debug("Closing page instance.");
            await page.close().catch(err => taskLogger.error(err, "Error closing page in finally block"));
        }
    }
};


// --- Revised updateBatchToFile ---
export const updateBatchToFile = async (batch: BatchUpdateEntry, batchIndex: number, parentLogger: typeof logger): Promise<BatchUpdateEntry[] | null> => {
    await init(); // Assuming this is necessary setup
    const taskLogger = parentLogger.child({ title: batch.conferenceTitle, acronym: batch.conferenceAcronym, batchIndex, function: 'updateBatchToFile' });

    try {
        // Basic validation
        if (!batch || !batch.conferenceAcronym || !batch.conferenceTextPath) {
            taskLogger.warn(`updateBatchToFile called with invalid batch data (missing acronym or main text path).`, { batch });
            return null;
        }
        taskLogger.info(`Processing update batch`);

        // Ensure output directory exists
        const batchesDir = path.join(__dirname, "./data/batches");
        try {
            await fs.promises.mkdir(batchesDir, { recursive: true });
        } catch (mkdirError: any) {
            taskLogger.error(mkdirError, "Error creating batches directory");
            throw mkdirError; // Rethrow critical error
        }

        // Define final output file path
        const conferenceAcronym = batch.conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const fileUpdateName = `${conferenceAcronym}_update.txt`;
        const fileUpdatePath = path.join(batchesDir, fileUpdateName);

        // 1. Read content from file paths
        taskLogger.debug("Reading content from temporary files...");
        const mainText = await readContentFromFile(batch.conferenceTextPath);
        // Read CFP/IMP only if paths exist
        const cfpText = batch.cfpTextPath ? await readContentFromFile(batch.cfpTextPath) : "";
        const impText = batch.impTextPath ? await readContentFromFile(batch.impTextPath) : "";

        if (!mainText && !cfpText && !impText) {
            taskLogger.error("All text content (main, cfp, imp) is empty after reading files. Cannot proceed.");
            return null; // Or handle as appropriate
        }

        // 2. Construct content for API
        const impContent = impText ? ` \n\nImportant Dates information:\n${impText}` : "";
        const cfpContent = cfpText ? ` \n\nCall for Papers information:\n${cfpText}` : "";
        // Use mainText read from file
        const contentSendToAPI = `Conference ${batch.conferenceAcronym}:\n\n${mainText}${cfpContent}${impContent}`;

        // 3. Write the constructed content to the final output file (_update.txt)
        taskLogger.debug({ path: fileUpdatePath }, "Writing constructed content to final update file");
        const fileUpdatePromise = fs.promises.writeFile(fileUpdatePath, contentSendToAPI, "utf8");

        // 4. Call Extraction API
        batch.extractResponseTextPath = undefined; // Reset path
        batch.extractMetaData = undefined;

        let extractApiResponse: any;
        try {
            taskLogger.info("Calling extract_information_api");
            extractApiResponse = await extract_information_api(contentSendToAPI, batchIndex, batch.conferenceTitle, batch.conferenceAcronym, parentLogger);

            // 5. Save API response text to a temporary file
            const responseText = extractApiResponse.responseText || "";
            if (responseText) {
                batch.extractResponseTextPath = await writeTempFile(responseText, `${conferenceAcronym}_extract_update_response`);
                batch.extractMetaData = extractApiResponse.metaData; // Keep metadata
                taskLogger.info(`API response saved to path.`);
            } else {
                taskLogger.warn("API response text was empty.");
            }

        } catch (apiError: any) {
            taskLogger.error(apiError, "Error calling extract_information_api");
            // Decide if batch should be considered failed - returning null here
            await fileUpdatePromise.catch(e => taskLogger.error(e, "Error writing final update file even after API error")); // Ensure file write attempt finishes
            return null;
        }

        // 6. Wait for the final file write to complete
        await fileUpdatePromise;
        taskLogger.info({ path: fileUpdatePath }, "Successfully wrote final update file.");

        // 7. Return the batch entry containing all paths
        taskLogger.info("Update batch processing successful.");
        return [batch]; // Return array consistent with other batch function

    } catch (error: any) {
        taskLogger.error(error, "Unhandled error in updateBatchToFile");
        console.error("Error in updateBatchToFile:", error); // Keep console
        console.error(error.stack);
        return null; // Indicate failure
    }
};


