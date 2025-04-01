// playwright_utils.ts
import fs from 'fs';
import { Page, BrowserContext } from 'playwright'; // Import Playwright types

import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing'; // Assuming .js extension is okay or will be removed by TS
import { extract_information_api, determine_links_api } from './7_gemini_api_utils'; // Assuming .js extension is okay or will be removed by TS
import { init } from './8_data_manager'; // Assuming .js extension is okay or will be removed by TS
import { extractTextFromPDF } from './9_pdf_utils'; // Assuming .js extension is okay or will be removed by TS
import { addAcronymSafely, logger } from './11_utils'; // Assuming .js extension is okay or will be removed by TS
import { MAIN_CONTENT_KEYWORDS, YEAR2 } from '../config'; // Assuming .js extension is okay or will be removed by TS

import { BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData } from './types';

import path from 'path';

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
                await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
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

export const saveHTMLFromCallForPapers = async (page: Page, link: string | null, acronym: string | undefined, year: number): Promise<string | null > => {
    const textContent = await processHTMLContent(page, link, acronym, year, true);
    if (textContent) {
        // Ghi vào file tạm và trả về path
        const safeAcronym = acronym?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
        return await writeTempFile(textContent, `${safeAcronym}_cfp_${year}`);
    }
    return null;
};

export const saveHTMLFromImportantDates = async (page: Page, link: string | null, acronym: string | undefined, year: number): Promise<string | null > => {
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
    // ... (như cũ)
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
        const response = await page.goto(officialWebsite, { waitUntil: 'domcontentloaded', timeout: 15000 });
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

// --- processDetermineLinksResponse làm việc với file paths ---
const processDetermineLinksResponse = async (responseText: string, batch: BatchEntry[], batchIndex: number, browserContext: BrowserContext, year: number): Promise<BatchEntry[]> => {
    const page = await browserContext.newPage();
    try {
        // ... (parse linksData như cũ) ...
        let linksData: any;
        try {
            linksData = JSON.parse(responseText);
        } catch (parseError: any) {
            console.error("Error parsing JSON response from determine_links_api:", parseError);
            console.error("Response text was:", responseText);
            await page.close();
            batch[0].conferenceLink = "None"; // Giữ lại đánh dấu lỗi
            return [batch[0]];
        }

        let officialWebsite: string | undefined = linksData["Official Website"]?.trim();
        let cfpLink: string | undefined = linksData["Call for papers link"]?.trim();
        let impLink: string | undefined = linksData["Important dates link"]?.trim();

        if (!officialWebsite || officialWebsite.toLowerCase() === "none") {
            await page.close();
            console.log("Không xác định được link chính");
            batch[0].conferenceLink = "None";
            return [batch[0]];
        }

        officialWebsite = officialWebsite.endsWith('/') ? officialWebsite.slice(0, -1) : officialWebsite;
        cfpLink = normalizeAndJoinLink(officialWebsite, cfpLink);
        impLink = normalizeAndJoinLink(officialWebsite, impLink);

        let matchingEntry: BatchEntry | undefined = batch.find(entry => {
            // ... (logic tìm matchingEntry như cũ, so sánh conferenceLink) ...
            try {
                // Check if entry.conferenceLink exists before normalizing
                if (!entry.conferenceLink) return false;
                const normalizedEntryLink = entry.conferenceLink.endsWith('/') ? entry.conferenceLink.slice(0, -1) : entry.conferenceLink;
                return normalizedEntryLink === officialWebsite;
            } catch (findError: any) { // Type findError as any or Error
                console.error("Error in find:", findError);
                return false;
            }
        });

        if (matchingEntry) {
            try {
                matchingEntry.cfpLink = cfpLink || "";
                matchingEntry.impLink = impLink || "";

                if (cfpLink && cfpLink.toLowerCase() !== "none") {
                    // Lưu path vào matchingEntry
                    matchingEntry.cfpTextPath = await saveHTMLFromCallForPapers(page, cfpLink, matchingEntry.conferenceAcronym, year);
                }
                if (impLink && impLink.toLowerCase() !== "none") {
                    // Lưu path vào matchingEntry
                    matchingEntry.impTextPath = await saveHTMLFromImportantDates(page, impLink, matchingEntry.conferenceAcronym, year);
                }
            } finally {
                await page.close();
            }
            return [matchingEntry];

        } else {
            // Xử lý trường hợp không khớp: fetch từ officialWebsite mới
            const websiteInfo = await fetchAndProcessWebsiteInfo(page, officialWebsite, batch[0], year);

            if (!websiteInfo) {
                await page.close();
                batch[0].conferenceLink = "None"; // Đánh dấu lỗi
                return [batch[0]];
            }

            const { finalUrl, textPath } = websiteInfo;

            // Đọc lại nội dung từ file path để gửi đi (nếu API cần nội dung)
            const fullText = await readContentFromFile(textPath); // Đọc từ file tạm mới tạo

            const initialFullContent = `1. Website of ${batch[0].conferenceAcronym}_0: ${officialWebsite}\nWebsite information of ${batch[0].conferenceAcronym}_0:\n\n${fullText}`; // Dùng fullText đã đọc
            const batchContentForApi = `Conference full name: ${batch[0].conferenceName} (${batch[0].conferenceAcronym})\n\n` + initialFullContent;
            let websiteLinksResponseText: string = "";
            try {
                // Gọi API lần 2
                const determineLinksResponse = await determine_links_api(batchContentForApi, batchIndex, batch[0].conferenceName, batch[0].conferenceAcronym);
                websiteLinksResponseText = determineLinksResponse.responseText || "";
            } catch (determineLinksError: any) {
                console.error("Error calling determine_links_api (2nd call):", determineLinksError);
                await page.close();
                batch[0].conferenceLink = "None"; // Đánh dấu lỗi
                return [batch[0]];
            }

            let websiteLinksData: any;
            try {
                websiteLinksData = JSON.parse(websiteLinksResponseText);
            } catch (parseError: any) {
                console.error("Error parsing JSON response from determine_links_api (2nd call):", parseError);
                console.error("Response text was (2nd call):", websiteLinksResponseText);
                await page.close();
                batch[0].conferenceLink = "None"; // Đánh dấu lỗi
                return [batch[0]];
            }

            let websiteCfpLink: string | undefined = websiteLinksData["Call for papers link"]?.trim();
            let websiteImpDatesLink: string | undefined = websiteLinksData["Important dates link"]?.trim();

            websiteCfpLink = normalizeAndJoinLink(officialWebsite, websiteCfpLink); // Use the confirmed officialWebsite
            websiteImpDatesLink = normalizeAndJoinLink(officialWebsite, websiteImpDatesLink); // Use the confirmed officialWebsite

            try {
                // Cập nhật entry gốc (batch[0]) với thông tin mới
                batch[0].conferenceLink = finalUrl;
                batch[0].conferenceTextPath = textPath; // Cập nhật đường dẫn file text chính
                batch[0].cfpLink = websiteCfpLink || "";
                batch[0].impLink = websiteImpDatesLink || "";

                if (websiteCfpLink && websiteCfpLink.toLowerCase() !== "none") {
                    batch[0].cfpTextPath = await saveHTMLFromCallForPapers(page, websiteCfpLink, batch[0].conferenceAcronym, year);
                }
                if (websiteImpDatesLink && websiteImpDatesLink.toLowerCase() !== "none") {
                    batch[0].impTextPath = await saveHTMLFromImportantDates(page, websiteImpDatesLink, batch[0].conferenceAcronym, year);
                }
            } finally {
                await page.close();
            }
            return [batch[0]]; // Trả về entry đã cập nhật
        }
    } catch (error: any) { // Type error as any or Error
        console.error("Error in processDetermineLinksResponse:", error);
        console.error(error.stack);

        if (page && !page.isClosed()) {
            try {
                await page.close();
            } catch (closeError: any) { // Type closeError as any or Error
                console.error("Error closing page in outer catch block:", closeError);
            }
        }
        batch[0].conferenceLink = "None";
        return [batch[0]];
    }
};

// --- saveBatchToFile làm việc với file paths ---
export const saveBatchToFile = async (batch: BatchEntry[], batchIndex: number, adjustedAcronym: string, browserContext: BrowserContext): Promise<BatchEntry[] | null> => {
    try {
        await init();

        if (!batch || batch.length === 0 || !batch[0]?.conferenceAcronym || !batch[0]?.conferenceName) {
            console.warn(`saveBatchToFile called with invalid batch. batchIndex: ${batchIndex}`);
            return null;
        }

        // --- Tạo thư mục batches nếu chưa có ---
        const batchesDir = path.join(__dirname, "./data/batches");
        try {
            if (!fs.existsSync(batchesDir)) {
                fs.mkdirSync(batchesDir, { recursive: true });
            }
        } catch (mkdirError: any) {
            console.error("Error creating batches directory:", mkdirError);
            throw mkdirError; // Re-throw critical error
        }

        const conferenceAcronym = batch[0].conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const fileFullLinksName = `${conferenceAcronym}_full_links.txt`;
        const fileFullLinksPath = path.join(__dirname, `./data/batches/${fileFullLinksName}`);
        const fileMainLinkName = `${conferenceAcronym}_main_link.txt`;
        const fileMainLinkPath = path.join(__dirname, `./data/batches/${fileMainLinkName}`);

        let batchContentParts: string[] = [];
        for (let i = 0; i < batch.length; i++) {
            const entry = batch[i];
            const text = await readContentFromFile(entry.conferenceTextPath); // Đọc từ file
            const formattedText = `Website of ${adjustedAcronym}: ${entry.conferenceLink}\nWebsite information of ${adjustedAcronym}:\n\n${text.trim()}`;
            batchContentParts.push(`${i + 1}. ${formattedText}\n\n`);
        }
        const batchContent = `Conference full name: ${batch[0].conferenceName} (${batch[0].conferenceAcronym})\n\n` + batchContentParts.join("");

        // Ghi file _full_links.txt
        const fileFullLinksPromise = fs.promises.writeFile(fileFullLinksPath, batchContent, "utf8");

        // Gọi determine_links_api
        let determineLinksResponse: any;
        try {
            determineLinksResponse = await determine_links_api(batchContent, batchIndex, batch[0].conferenceName, batch[0].conferenceAcronym);
            // Ghi response vào file tạm và lưu path
            const determineResponseText = determineLinksResponse.responseText || "";
            batch[0].determineResponseTextPath = await writeTempFile(determineResponseText, `${conferenceAcronym}_determine_response`);
            batch[0].determineMetaData = determineLinksResponse.metaData; // Giữ lại metadata nếu nhỏ

        } catch (determineLinksError: any) {
            console.error("Error calling determine_links_api from saveBatchToFile:", determineLinksError);
            await fileFullLinksPromise; // Đảm bảo file full_links được ghi nếu có thể
            return null; // Hoặc trả về batch với lỗi?
        }

        // Xử lý kết quả determine_links_api (hàm này sẽ cập nhật paths trong batch[0])
        const mainLinkBatch = await processDetermineLinksResponse(
            await readContentFromFile(batch[0].determineResponseTextPath), // Đọc response từ file
            batch, // Truyền batch gốc (chứa entry với paths)
            batchIndex,
            browserContext,
            YEAR2
        );

        if (!mainLinkBatch || mainLinkBatch.length === 0 || mainLinkBatch[0].conferenceLink === "None") {
            console.warn(`mainLinkBatch is invalid after processDetermineLinksResponse for batchIndex: ${batchIndex}. Skipping main link file and extract API.`);
            await fileFullLinksPromise; // Đảm bảo file full_links được ghi
            // Có thể cần trả về batch gốc với trạng thái lỗi?
            return null;
        }

        // --- Tạo contentSendToAPI bằng cách đọc từ file paths ---
        const mainText = await readContentFromFile(mainLinkBatch[0].conferenceTextPath);
        const cfpText = await readContentFromFile(mainLinkBatch[0].cfpTextPath);
        const impText = await readContentFromFile(mainLinkBatch[0].impTextPath);

        const impContent = impText ? ` \n\nImportant Dates information:\n${impText}` : "";
        const cfpContent = cfpText ? ` \n\nCall for Papers information:\n${cfpText}` : "";
        const contentSendToAPI = `Conference ${mainLinkBatch[0].conferenceAcronym}:\n\n${mainText}${cfpContent}${impContent}`;
        const acronym = mainLinkBatch[0].conferenceAcronym; // Acronym đã chuẩn hóa (không có index)

        // Ghi file _main_link.txt
        const fileMainLinkPromise = fs.promises.writeFile(fileMainLinkPath, contentSendToAPI, "utf8");

        // Gọi extract_information_api
        mainLinkBatch[0].extractResponseTextPath = undefined; // Reset path
        mainLinkBatch[0].extractMetaData = undefined;

        try {
            const extractInformationResponse = await extract_information_api(contentSendToAPI, batchIndex, acronym);
            // Ghi response vào file tạm và lưu path
            const extractResponseText = extractInformationResponse.responseText || "";
            mainLinkBatch[0].extractResponseTextPath = await writeTempFile(extractResponseText, `${conferenceAcronym}_extract_response`);
            mainLinkBatch[0].extractMetaData = extractInformationResponse.metaData; // Giữ metadata

        } catch (extractInformationError: any) {
            console.error("Error calling extract_information_api from saveBatchToFile:", extractInformationError);
            await Promise.all([fileFullLinksPromise, fileMainLinkPromise]).catch(e => console.error("Error finalizing file writes before returning null:", e)); // Đảm bảo file được ghi nếu có thể
            return null; // Hoặc trả về batch với lỗi?
        }

        // Chờ cả hai file được ghi xong
        await Promise.all([fileFullLinksPromise, fileMainLinkPromise]);

        // Trả về batch đã được cập nhật với tất cả các paths
        return mainLinkBatch;

    } catch (error: any) {
        console.error("Error in saveBatchToFile:", error);
        console.error(error.stack);
        return null;
    }
};

// --- saveHTMLContent làm việc với file paths ---
export const saveHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceData,
    links: string[],
    batchIndexRef: { current: number },
    existingAcronyms: Set<string>, // Cần được quản lý cẩn thận nếu dùng chung
    batchPromises: Promise<BatchEntry[] | null>[],
    year: number
): Promise<{ updatedBatches: [] }> => { // Kiểu trả về này có vẻ không đúng, nên bỏ qua?

    try {
        const batch: BatchEntry[] = []; // Batch này giờ chỉ chứa metadata và paths
        if (!links || links.length === 0) {
            console.warn(`saveHTMLContent called with empty or null links for conference: ${conference.Acronym}`);
            return { updatedBatches: [] }; // Hoặc return void/Promise<void>
        }

        let adjustedAcronym = "";
        for (let i = 0; i < links.length; i++) {
            const page = await browserContext.newPage();
            try {
                let originalLink: string = links[i];
                let finalLink: string = originalLink;
                let useModifiedLink: boolean = false;
                let modifiedLink: string = originalLink;

                let yearOld1 = year - 1;
                let yearOld2 = year - 2;

                const yearOld1Str = String(yearOld1);
                const yearOld2Str = String(yearOld2);
                const yearStr = String(year);

                if (originalLink.includes(yearOld1Str)) {
                    modifiedLink = originalLink.replace(new RegExp(yearOld1Str, 'g'), yearStr);
                    useModifiedLink = true;
                } else if (originalLink.includes(yearOld2Str)) {
                    modifiedLink = originalLink.replace(new RegExp(yearOld2Str, 'g'), yearStr);
                    useModifiedLink = true;
                }

                try {
                    if (useModifiedLink) {
                        console.log(`[${conference.Acronym}] Trying modifiedLink: ${modifiedLink}`);
                        const response = await page.goto(modifiedLink, { waitUntil: "domcontentloaded", timeout: 15000 });
                        if (response && response.ok()) {
                            finalLink = page.url(); // Update finalLink even if modified worked
                            // Keep useModifiedLink = true to indicate which link was successful
                        } else {
                            // Modified link failed, reset to try original
                            console.log(`[${conference.Acronym}] Modified link failed (${response?.status()}), reverting to original.`);
                            finalLink = originalLink; // Reset finalLink
                            useModifiedLink = false; // Must try original now
                        }
                    }
                } catch (error: any) {
                    const timestamp = new Date().toISOString();
                    const logMessage = `[${timestamp}] Error accessing modifiedLink: ${error.message} for ${conference.Acronym}\n`;
                    // Log error, but don't necessarily stop; proceed to try original link
                    console.warn(logMessage); // Log as warning, not critical error yet
                    await fs.promises.appendFile('./data/error_access_link_log.txt', logMessage, 'utf8').catch(e => console.error("Failed to write to error log:", e));
                    finalLink = originalLink; // Reset finalLink
                    useModifiedLink = false; // Ensure original link is tried
                }

                // Only try original link if modified wasn't used or failed
                if (!useModifiedLink) {
                    console.log(`[${conference.Acronym}] Trying originalLink: ${originalLink}`);
                    try {
                        const response = await page.goto(originalLink, { waitUntil: "domcontentloaded", timeout: 15000 });
                        if (response && response.ok()) {
                            finalLink = page.url(); // Update finalLink based on actual navigation
                        } else {
                            // Both modified (if tried) and original links failed
                            throw new Error(`HTTP Error accessing originalLink: ${response ? response.status() : 'Unknown'} - ${conference.Acronym}`);
                        }
                    } catch (error: any) {
                        // This link is definitively inaccessible
                        const timestamp = new Date().toISOString();
                        const logMessage = `[${timestamp}] Error accessing originalLink ${originalLink}: ${error.message} for ${conference.Acronym}\n`;
                        console.error(logMessage); // Log as error
                        await fs.promises.appendFile('./data/error_access_link_log.txt', logMessage, 'utf8').catch(e => console.error("Failed to write to error log:", e));
                        // Skip this link and continue to the next one in the loop
                        continue; // <<<<< Important: Continue to next link
                    }
                }

                // Check for redirects (logic might need refinement depending on Playwright version)
                // Simple check: is the final navigated URL different from the one we intended to go to?
                let intendedUrl = useModifiedLink ? modifiedLink : originalLink;
                let isRedirect = page.url() !== intendedUrl;
                if (isRedirect) {
                    finalLink = page.url(); // Update finalLink to the redirected URL
                    console.log(`[${conference.Acronym}] Redirect detected from ${intendedUrl} to ${finalLink}`);
                    // Optionally wait longer after a redirect
                    try {
                        await page.waitForLoadState('load', { timeout: 10000 }); // Shorter wait after initial load
                    } catch (err: any) {
                        console.warn(`[${conference.Acronym}] Timeout or unstable state after redirect to ${finalLink}: ${err.message}`);
                        // Decide whether to proceed or skip. Let's try proceeding.
                    }
                }




                // Fetch and process content
                const htmlContent = await fetchContentWithRetry(page);
                const document = cleanDOM(htmlContent);
                if (!document) {
                    console.warn(`[${conference.Acronym}] Failed to clean DOM for ${finalLink}. Skipping.`);
                    continue;
                }
                let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, year);
                fullText = removeExtraEmptyLines(fullText);

                // Ghi text vào file tạm
                const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_-]/g, '-');
                const textPath = await writeTempFile(fullText, `${safeAcronym}_${i}_initial`);

                // Lấy adjustedAcronym (logic addAcronymSafely cần được kiểm tra lại)
                const acronym_index = `${conference.Acronym}_${i}`;
                adjustedAcronym = await addAcronymSafely(existingAcronyms, acronym_index); // existingAcronyms cần được quản lý đồng bộ đúng cách
                let acronym_no_index = adjustedAcronym.substring(0, adjustedAcronym.lastIndexOf('_'));

                batch.push({
                    conferenceName: conference.Title,
                    conferenceAcronym: acronym_no_index,
                    conferenceSource: conference.Source || "",
                    conferenceRank: conference.Rank || "",
                    conferenceNote: conference.Note || "",
                    conferenceDBLP: conference.DBLP || "",
                    conferencePrimaryFoR: conference.PrimaryFoR || "",
                    conferenceComments: conference.Comments || "",
                    conferenceRating: conference.Rating || "",
                    conferenceDetails: conference.Details || [], // Use the array directly, default to empty array
                    conferenceIndex: String(i),
                    conferenceLink: finalLink, // Link cuối cùng truy cập được
                    conferenceTextPath: textPath, // Chỉ lưu path
                    // Các trường khác sẽ được điền sau trong saveBatchToFile/processDetermineLinksResponse
                    cfpLink: "",
                    impLink: "",
                    // cfpTextPath, impTextPath, etc. sẽ được điền sau
                });

            } catch (loopError: any) {
                console.error(`Error processing link ${links[i]} for conference ${conference.Acronym}:`, loopError);
                // Log lỗi chi tiết hơn nếu cần
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Unhandled loop error for ${conference.Acronym} link ${links[i]}: ${loopError.message}\n${loopError.stack}\n`;
                await fs.promises.appendFile('./data/error_processing_log.txt', logMessage, 'utf8').catch(e => console.error("Failed to write to error log:", e));

            } finally {
                if (page && !page.isClosed()) {
                    try {
                        await page.close();
                    } catch (closeError: any) {
                        console.error("Error closing page:", closeError);
                    }
                }
            }
        } // End for loop links



        if (batch.length > 0) {
            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current++;
            // Gọi saveBatchToFile, promise này sẽ giải quyết thành BatchEntry[] chứa paths
            const batchPromise = saveBatchToFile(batch, currentBatchIndex, adjustedAcronym, browserContext);
            batchPromises.push(batchPromise);
        } else {
            console.log(`Batch is empty for ${conference.Acronym} after processing all links.`);
        }

        // Kiểu trả về { updatedBatches: [] } không còn ý nghĩa vì batchPromises được quản lý bên ngoài
        // Có thể trả về Promise<void>
        return { updatedBatches: [] }; // Giữ lại để không thay đổi signature quá nhiều, nhưng giá trị này không hữu ích

    } catch (error: any) {
        console.error("Error in saveHTMLContent:", error);
        console.error(error.stack);
        return { updatedBatches: [] }; // Hoặc throw lỗi
    }
};



// --- Revised updateHTMLContent ---
export const updateHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceUpdateData, // Use specific interface
    batchIndexRef: { current: number },
    batchPromises: Promise<BatchUpdateEntry[] | null>[] // Promise returns BatchUpdateEntry[]
): Promise<{ updatedBatches: [] }> => { // Return type is minimal

    const taskLogger = logger.child({ acronym: conference.Acronym, function: 'updateHTMLContent' });
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
            await page.goto(mainLink, { waitUntil: "domcontentloaded", timeout: 15000 });
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
            await fs.promises.appendFile('./data/error_access_link_log.txt', logMessage, 'utf8').catch(e => console.error("Failed to write error log:", e));
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
            } catch(cfpError: any) {
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
            } catch(impError: any) {
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
            conferenceName: conference.Title,
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
        const batchPromise = updateBatchToFile(batch, currentBatchIndex);
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
// Remove 'page' parameter
export const updateBatchToFile = async (batch: BatchUpdateEntry, batchIndex: number): Promise<BatchUpdateEntry[] | null> => {
    await init(); // Assuming this is necessary setup
    const taskLogger = logger.child({ acronym: batch.conferenceAcronym, batchIndex, function: 'updateBatchToFile' });

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
            extractApiResponse = await extract_information_api(contentSendToAPI, batchIndex, batch.conferenceAcronym);

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