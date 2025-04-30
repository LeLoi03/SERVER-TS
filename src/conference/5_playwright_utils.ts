// 5_playwright_utils.ts
import { Page, BrowserContext } from 'playwright'; // Import Playwright types

import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing';
import { determine_links_api } from './7_gemini_api_utils';
import { extractTextFromPDF } from './9_pdf_utils';
import { logger } from './11_utils';
import { MAIN_CONTENT_KEYWORDS, YEAR2 } from '../config';

import { BatchEntry} from './types';

import { readContentFromFile, writeTempFile } from './11_utils';

export async function fetchContentWithRetry(page: Page, maxRetries: number = 3): Promise<string> {
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
export const processDetermineLinksResponse = async (
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

        // --- Normalize the official website URL ONCE ---
        officialWebsite = officialWebsite.endsWith('/') ? officialWebsite.slice(0, -1) : officialWebsite;
        const originalOfficialWebsite = officialWebsite; // Keep the initially determined official website URL

        // --- Normalize CFP and IMP links relative to the *original* official website ---
        // Use originalOfficialWebsite as the base for normalization here
        cfpLink = normalizeAndJoinLink(originalOfficialWebsite, cfpLink);
        impLink = normalizeAndJoinLink(originalOfficialWebsite, impLink);
        parentLogger.debug({ ...baseLogContext, officialWebsite: originalOfficialWebsite, cfpLink, impLink, event: 'process_determine_links_normalized' }, "Parsed and normalized initial links");

        let matchingEntry: BatchEntry | undefined;
        try {
            matchingEntry = batch.find(entry => {
                if (!entry.conferenceLink) return false;
                // Ensure comparison uses similarly normalized links
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

        // =============================================
        // === BRANCH 1: MATCHING ENTRY FOUND        ===
        // =============================================
        if (matchingEntry) {
            parentLogger.info({ ...baseLogContext, matchedLink: matchingEntry.conferenceLink, event: 'process_determine_entry_match_found' }, "Found matching entry in batch based on official website");
            let saveErrorOccurred = false;
            try {
                // Use the already normalized official website link from the matching entry
                const matchedOfficialWebsite = matchingEntry.conferenceLink.endsWith('/') ? matchingEntry.conferenceLink.slice(0, -1) : matchingEntry.conferenceLink;

                matchingEntry.cfpLink = cfpLink || "";
                matchingEntry.impLink = impLink || "";

                // --- Check before saving CFP ---
                const shouldSaveCfp = cfpLink && cfpLink.toLowerCase() !== "none" && cfpLink !== matchedOfficialWebsite;
                if (shouldSaveCfp) {
                    const saveContext = { ...baseLogContext, url: cfpLink, contentType: 'CFP' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_matched_start' }, "Saving CFP content for matched entry");
                    matchingEntry.cfpTextPath = await saveHTMLFromCallForPapers(page, cfpLink, matchingEntry.conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: matchingEntry.cfpTextPath, event: 'process_determine_save_matched_success' }, "Saved CFP content for matched entry");
                } else if (cfpLink && cfpLink.toLowerCase() !== "none") {
                    parentLogger.info({ ...baseLogContext, url: cfpLink, contentType: 'CFP', reason: 'CFP link matches official website', event: 'process_determine_save_matched_skipped' }, "Skipping save for CFP content (matches official website)");
                } else {
                     parentLogger.info({ ...baseLogContext, contentType: 'CFP', reason: 'CFP link is None or empty', event: 'process_determine_save_matched_skipped' }, "Skipping save for CFP content (link is None or empty)");
                }

                // --- Check before saving IMP ---
                const shouldSaveImp = impLink && impLink.toLowerCase() !== "none" && impLink !== matchedOfficialWebsite && impLink !== cfpLink;
                 if (shouldSaveImp) {
                    const saveContext = { ...baseLogContext, url: impLink, contentType: 'IMP' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_matched_start' }, "Saving Important Dates content for matched entry");
                    matchingEntry.impTextPath = await saveHTMLFromImportantDates(page, impLink, matchingEntry.conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: matchingEntry.impTextPath, event: 'process_determine_save_matched_success' }, "Saved Important Dates content for matched entry");
                } else if (impLink && impLink.toLowerCase() !== "none") {
                    let skipReason = 'Unknown';
                    if (impLink === matchedOfficialWebsite) skipReason = 'IMP link matches official website';
                    else if (impLink === cfpLink) skipReason = 'IMP link matches CFP link';
                    parentLogger.info({ ...baseLogContext, url: impLink, contentType: 'IMP', reason: skipReason, event: 'process_determine_save_matched_skipped' }, `Skipping save for Important Dates content (${skipReason})`);
                } else {
                     parentLogger.info({ ...baseLogContext, contentType: 'IMP', reason: 'IMP link is None or empty', event: 'process_determine_save_matched_skipped' }, "Skipping save for IMP content (link is None or empty)");
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

        // =============================================
        // === BRANCH 2: NO MATCHING ENTRY FOUND     ===
        // =============================================
        } else {
            parentLogger.info({ ...baseLogContext, officialWebsite: originalOfficialWebsite, event: 'process_determine_entry_match_not_found' }, "No matching entry found. Fetching content from official website directly.");
            let websiteInfo;
            try {
                // Fetch using the originalOfficialWebsite determined by the first API call
                websiteInfo = await fetchAndProcessWebsiteInfo(page, originalOfficialWebsite, batch[0], year);
            } catch (fetchError: any) {
                parentLogger.error({ ...baseLogContext, url: originalOfficialWebsite, err: fetchError, event: 'process_determine_fetch_new_failed' }, "Failed to fetch and process main website info");
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after fetch error"));
                batch[0].conferenceLink = "None";
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Fetch new website failed' }, "Finishing processDetermineLinksResponse with error state");
                return [batch[0]];
            }

            if (!websiteInfo) { // Double check
                parentLogger.error({ ...baseLogContext, url: originalOfficialWebsite, event: 'process_determine_fetch_new_failed' }, "Fetched main website info is null/undefined");
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after null fetch result"));
                batch[0].conferenceLink = "None";
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'Fetch new website returned null' }, "Finishing processDetermineLinksResponse with error state");
                return [batch[0]];
            }

            // --- Use the FINAL URL after potential redirects from fetching ---
            // Normalize the finalUrl as well for reliable comparison
            let finalUrl = websiteInfo.finalUrl.endsWith('/') ? websiteInfo.finalUrl.slice(0, -1) : websiteInfo.finalUrl;
            const textPath = websiteInfo.textPath;
            parentLogger.info({ ...baseLogContext, initialUrl: originalOfficialWebsite, finalUrl, filePath: textPath, event: 'process_determine_fetch_new_success' }, "Successfully fetched and processed main website info");

            let fullText = '';
            try {
                fullText = await readContentFromFile(textPath);
            } catch (readErr: any) {
                parentLogger.error({ ...baseLogContext, filePath: textPath, err: readErr, event: 'process_determine_read_fetched_failed' }, "Failed to read fetched content file");
                // Continue, but API call 2 might fail or give bad results
            }

            const batchContentForApi = `Conference full name: ${batch[0].conferenceTitle} (${batch[0].conferenceAcronym})\n\n1. Website of ${batch[0].conferenceAcronym}: ${finalUrl}\nWebsite information of ${batch[0].conferenceAcronym}:\n\n${fullText.trim()}`;

            let websiteLinksResponseText: string = "";
            let websiteLinksResponse: any;

            try {
                parentLogger.info({ ...baseLogContext, event: 'process_determine_api2_start' }, "Calling determine_links_api (2nd call) for the fetched website");
                websiteLinksResponse = await determine_links_api(batchContentForApi, batchIndex, batch[0].conferenceTitle, batch[0].conferenceAcronym, parentLogger);
                websiteLinksResponseText = websiteLinksResponse.responseText || "";
                parentLogger.info({ ...baseLogContext, responseLength: websiteLinksResponseText.length, event: 'process_determine_api2_end', success: true }, "Received response from determine_links_api (2nd call)");
            } catch (determineLinksError: any) {
                parentLogger.error({ ...baseLogContext, err: determineLinksError, event: 'process_determine_api2_call_failed' }, "Error calling determine_links_api (2nd call)");
                // Don't close the page yet, it might be needed for saving below if API succeeded partially or links were already known
                // If page is needed, we need to handle its closure in the finally block
                batch[0].conferenceLink = "None"; // Mark as error since API failed
                parentLogger.warn({ ...baseLogContext, event: 'process_determine_finish_failed', reason: 'API call 2 failed' }, "Finishing processDetermineLinksResponse with error state after API 2 failure");
                // Ensure page is closed before returning
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page after API 2 error"));
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

            // --- Normalize links from 2nd API call relative to the FINAL fetched URL ---
            websiteCfpLink = normalizeAndJoinLink(finalUrl, websiteCfpLink);
            websiteImpDatesLink = normalizeAndJoinLink(finalUrl, websiteImpDatesLink);
            parentLogger.debug({ ...baseLogContext, websiteCfpLink, websiteImpDatesLink, event: 'process_determine_links_normalized', source: 'api_call_2' }, "Parsed and normalized links from 2nd API call");

            let saveErrorOccurred = false;
            try {
                // Update the primary entry (batch[0])
                batch[0].conferenceLink = finalUrl; // Use the final URL found
                batch[0].conferenceTextPath = textPath;
                batch[0].cfpLink = websiteCfpLink || "";
                batch[0].impLink = websiteImpDatesLink || "";

                // --- Check before saving CFP ---
                const shouldSaveCfp = websiteCfpLink && websiteCfpLink.toLowerCase() !== "none" && websiteCfpLink !== finalUrl;
                if (shouldSaveCfp) {
                    const saveContext = { ...baseLogContext, url: websiteCfpLink, contentType: 'CFP', source: 'api_call_2' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_new_start' }, "Saving CFP content (from 2nd API call)");
                    batch[0].cfpTextPath = await saveHTMLFromCallForPapers(page, websiteCfpLink, batch[0].conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: batch[0].cfpTextPath, event: 'process_determine_save_new_success' }, "Saved CFP content (from 2nd API call)");
                } else if (websiteCfpLink && websiteCfpLink.toLowerCase() !== "none") {
                    parentLogger.info({ ...baseLogContext, url: websiteCfpLink, contentType: 'CFP', source: 'api_call_2', reason: 'CFP link matches final official website', event: 'process_determine_save_new_skipped' }, "Skipping save for CFP content (matches final official website)");
                 } else {
                     parentLogger.info({ ...baseLogContext, contentType: 'CFP', source: 'api_call_2', reason: 'CFP link is None or empty', event: 'process_determine_save_new_skipped' }, "Skipping save for CFP content (link is None or empty)");
                 }


                // --- Check before saving IMP ---
                const shouldSaveImp = websiteImpDatesLink && websiteImpDatesLink.toLowerCase() !== "none" && websiteImpDatesLink !== finalUrl && websiteImpDatesLink !== websiteCfpLink;
                if (shouldSaveImp) {
                    const saveContext = { ...baseLogContext, url: websiteImpDatesLink, contentType: 'IMP', source: 'api_call_2' };
                    parentLogger.info({ ...saveContext, event: 'process_determine_save_new_start' }, "Saving Important Dates content (from 2nd API call)");
                    batch[0].impTextPath = await saveHTMLFromImportantDates(page, websiteImpDatesLink, batch[0].conferenceAcronym, year);
                    parentLogger.info({ ...saveContext, filePath: batch[0].impTextPath, event: 'process_determine_save_new_success' }, "Saved Important Dates content (from 2nd API call)");
                } else if (websiteImpDatesLink && websiteImpDatesLink.toLowerCase() !== "none") {
                     let skipReason = 'Unknown';
                    if (websiteImpDatesLink === finalUrl) skipReason = 'IMP link matches final official website';
                    else if (websiteImpDatesLink === websiteCfpLink) skipReason = 'IMP link matches CFP link';
                     parentLogger.info({ ...baseLogContext, url: websiteImpDatesLink, contentType: 'IMP', source: 'api_call_2', reason: skipReason, event: 'process_determine_save_new_skipped' }, `Skipping save for Important Dates content (${skipReason})`);
                } else {
                     parentLogger.info({ ...baseLogContext, contentType: 'IMP', source: 'api_call_2', reason: 'IMP link is None or empty', event: 'process_determine_save_new_skipped' }, "Skipping save for IMP content (link is None or empty)");
                }

                parentLogger.info({ ...baseLogContext, event: 'process_determine_update_entry_success' }, "Updated original batch entry with new links and paths");

            } catch (saveContentError: any) {
                saveErrorOccurred = true;
                parentLogger.error({ ...baseLogContext, err: saveContentError, websiteCfpLink, websiteImpDatesLink, event: 'process_determine_save_new_failed', source: 'api_call_2' }, "Error saving CFP/IMP content (from 2nd API call)");
            } finally {
                if (page && !page.isClosed()) await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }, "Error closing page for new entry"));
            }
            parentLogger.info({ ...baseLogContext, success: !saveErrorOccurred, event: 'process_determine_finish_success' }, `Finishing processDetermineLinksResponse for new entry (save error: ${saveErrorOccurred})`);
            return [batch[0]]; // Return the updated original entry
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

