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

export const saveHTMLFromCallForPapers = async (page: Page, link: string | null, acronym: string | undefined, year: number): Promise<string> => {
    return processHTMLContent(page, link, acronym, year, true);
};

export const saveHTMLFromImportantDates = async (page: Page, link: string | null, acronym: string | undefined, year: number): Promise<string> => {
    return processHTMLContent(page, link, acronym, year, false);
};

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
        return `${baseUrl}/${normalizedLinkPart}`;
    } catch (normalizeError: any) { // Type normalizeError as any or Error
        console.error("Error normalizing and joining link:", normalizeError);
        return "";
    }
};

const fetchAndProcessWebsiteInfo = async (page: Page, officialWebsite: string, batchEntry: BatchEntry, year: number): Promise<{ finalUrl: string; fullText: string } | null> => {
    try {
        const response = await page.goto(officialWebsite, { waitUntil: 'domcontentloaded', timeout: 15000 });
        if (!response || !response.ok()) {
            console.error(`Failed to load ${officialWebsite}. Status code: ${response ? response.status() : 'Unknown'}`);
            return null;
        }
        const finalUrl = page.url();
        const htmlContent = await page.content();
        const document = cleanDOM(htmlContent);
        if (!document) return null;
        let fullText = traverseNodes(document.body as HTMLElement, batchEntry.conferenceAcronym, year);
        fullText = removeExtraEmptyLines(fullText);
        return { finalUrl, fullText };
    } catch (error: any) { // Type error as any or Error
        console.error("Error fetching and processing website info:", error);
        console.error(error.stack);
        return null;
    }
};

const processDetermineLinksResponse = async (responseText: string, batch: BatchEntry[], batchIndex: number, browserContext: BrowserContext, year: number): Promise<BatchEntry[]> => {
    const page = await browserContext.newPage();
    try {
        let linksData: any; // Type as any initially, refine if JSON structure is well-defined
        try {
            linksData = JSON.parse(responseText);
        } catch (parseError: any) { // Type parseError as any or Error
            console.error("Error parsing JSON response from determine_links_api:", parseError);
            console.error("Response text was:", responseText);
            await page.close();
            batch[0].conferenceLink = "None";
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
            try {
                const normalizedEntryLink = entry.conferenceLink.endsWith('/') ? entry.conferenceLink.slice(0, -1) : entry.conferenceLink;
                return normalizedEntryLink === officialWebsite;
            } catch (findError: any) { // Type findError as any or Error
                console.error("Error in find:", findError);
                return false;
            }
        });

        if (matchingEntry) {
            try {
                matchingEntry.cfpLink = cfpLink || ""; // Ensure default empty string if undefined
                matchingEntry.impLink = impLink || ""; // Ensure default empty string if undefined

                if (cfpLink && cfpLink.toLowerCase() !== "none") {
                    matchingEntry.cfpText = await saveHTMLFromCallForPapers(page, cfpLink, matchingEntry.conferenceAcronym, year) || "";
                }
                if (impLink && impLink.toLowerCase() !== "none") {
                    matchingEntry.impText = await saveHTMLFromImportantDates(page, impLink, matchingEntry.conferenceAcronym, year) || "";
                }
            } finally {
                await page.close();
            }
            return [matchingEntry];

        } else {

            const websiteInfo = await fetchAndProcessWebsiteInfo(page, officialWebsite, batch[0], year);

            if (!websiteInfo) {
                await page.close();
                batch[0].conferenceLink = "None";
                return [batch[0]];
            }

            const { finalUrl, fullText } = websiteInfo;
            const initialFullContent = `1. Website of ${batch[0].conferenceAcronym}_0: ${officialWebsite}\nWebsite information of ${batch[0].conferenceAcronym}_0:\n\n${fullText}`;
            const batchContent = `Conference full name: ${batch[0].conferenceName} (${batch[0].conferenceAcronym})\n\n` + initialFullContent;

            let websiteLinksResponseText: string = ""; // Initialize as empty string
            try {
                const determineLinksResponse = await determine_links_api(batchContent, batchIndex, batch[0].conferenceName, batch[0].conferenceAcronym);
                websiteLinksResponseText = determineLinksResponse.responseText || ""; // Ensure string and handle undefined
            } catch (determineLinksError: any) { // Type determineLinksError as any or Error
                console.error("Error calling determine_links_api (2nd call):", determineLinksError);
                await page.close();
                batch[0].conferenceLink = "None";
                return [batch[0]];
            }

            let websiteLinksData: any; // Type as any, refine later if structure known
            try {
                websiteLinksData = JSON.parse(websiteLinksResponseText);
            } catch (parseError: any) { // Type parseError as any or Error
                console.error("Error parsing JSON response from determine_links_api (2nd call):", parseError);
                console.error("Response text was (2nd call):", websiteLinksResponseText);
                await page.close();
                batch[0].conferenceLink = "None";
                return [batch[0]];
            }

            let websiteCfpLink: string | undefined = websiteLinksData["Call for papers link"]?.trim();
            let websiteImpDatesLink: string | undefined = websiteLinksData["Important dates link"]?.trim();

            websiteCfpLink = normalizeAndJoinLink(officialWebsite, websiteCfpLink);
            websiteImpDatesLink = normalizeAndJoinLink(officialWebsite, websiteImpDatesLink);

            try {
                batch[0].conferenceLink = finalUrl;
                batch[0].conferenceText = fullText;
                batch[0].cfpLink = websiteCfpLink || ""; // Ensure default empty string if undefined
                batch[0].impLink = websiteImpDatesLink || ""; // Ensure default empty string if undefined

                if (websiteCfpLink && websiteCfpLink.toLowerCase() !== "none") {
                    batch[0].cfpText = await saveHTMLFromCallForPapers(page, websiteCfpLink, batch[0].conferenceAcronym, year) || "";
                }
                if (websiteImpDatesLink && websiteImpDatesLink.toLowerCase() !== "none") {
                    batch[0].impText = await saveHTMLFromImportantDates(page, websiteImpDatesLink, batch[0].conferenceAcronym, year) || "";
                }
            } finally {
                await page.close();
            }
            return [batch[0]];
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

export const saveBatchToFile = async (batch: BatchEntry[], batchIndex: number, browserContext: BrowserContext): Promise<BatchEntry[] | null> => {
    try {
        await init();

        if (!batch || batch.length === 0) {
            console.warn(`saveBatchToFile called with an empty or null batch. batchIndex: ${batchIndex}`);
            return null;
        }
        if (!batch[0] || !batch[0].conferenceAcronym || !batch[0].conferenceName) {
            console.warn(`saveBatchToFile: batch[0] or its properties are undefined. batchIndex: ${batchIndex}`);
            return null;
        }

        try {
            if (!fs.existsSync("./conference/data/batches")) {
                fs.mkdirSync("./conference/data/batches", { recursive: true });
            }
        } catch (mkdirError: any) { // Type mkdirError as any or Error
            console.error("Error creating batches directory:", mkdirError);
            throw mkdirError;
        }

        const conferenceAcronym = batch[0].conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const fileFullLinksName = `${batchIndex}_${conferenceAcronym}_full_links.txt`;
        const fileFullLinksPath = `./conference/data/batches/${fileFullLinksName}`;
        const fileMainLinkName = `${batchIndex}_${conferenceAcronym}_main_link.txt`;
        const fileMainLinkPath = `./conference/data/batches/${fileMainLinkName}`;

        let batchContent = batch
            .map((entry, index) => `${index + 1}. ${entry.formatConferenceText}\n\n`)
            .join("");

        batchContent = `Conference full name: ${batch[0].conferenceName} (${batch[0].conferenceAcronym})\n\n` + batchContent;

        const fileFullLinksPromise = fs.promises.writeFile(fileFullLinksPath, batchContent, "utf8");

        let determineLinksResponse: any; // Type as any, refine later based on determine_links_api return type
        try {
            determineLinksResponse = await determine_links_api(batchContent, batchIndex, batch[0].conferenceName, batch[0].conferenceAcronym);
        } catch (determineLinksError: any) { // Type determineLinksError as any or Error
            console.error("Error calling determine_links_api from saveBatchToFile:", determineLinksError);
            return null;
        }

        const mainLinkBatch = await processDetermineLinksResponse(determineLinksResponse.responseText || "", batch, batchIndex, browserContext, YEAR2); // Ensure string and handle undefined

        if (!mainLinkBatch || mainLinkBatch.length === 0) {
            console.warn(`mainLinkBatch is empty or undefined for batchIndex: ${batchIndex}. Skipping fileMainLink and extract_information_api.`);
            return null;
        }

        mainLinkBatch[0].determineResponseText = determineLinksResponse.responseText;
        mainLinkBatch[0].determineMetaData = determineLinksResponse.metaData;

        const impContent = ` \n\nImportant Dates information:\n${mainLinkBatch[0].impText}` || "";
        const cfpContent = ` \n\nCall for Papers information:\n${mainLinkBatch[0].cfpText}` || "";
        const contentSendToAPI = `Conference ${mainLinkBatch[0].conferenceAcronym}:\n\n${mainLinkBatch[0].conferenceText}${cfpContent}${impContent}`;
        const acronym = mainLinkBatch[0].conferenceAcronym;

        const fileMainLinkPromise = fs.promises.writeFile(fileMainLinkPath, contentSendToAPI, "utf8");

        mainLinkBatch[0].extractResponseText = "";
        mainLinkBatch[0].extractMetaData = "";

        let extractInformationResponse: any; // Type as any, refine later based on extract_information_api return type
        try {
            extractInformationResponse = await extract_information_api(contentSendToAPI, batchIndex, acronym)
            mainLinkBatch[0].extractResponseText = extractInformationResponse.responseText;
            mainLinkBatch[0].extractMetaData = extractInformationResponse.metaData;
        } catch (extractInformationError: any) { // Type extractInformationError as any or Error
            console.error("Error calling extract_information_api from saveBatchToFile:", extractInformationError);
            return null;
        }

        await Promise.all([fileFullLinksPromise, fileMainLinkPromise]);
        return mainLinkBatch;

    } catch (error: any) { // Type error as any or Error
        console.error("Error in saveBatchToFile:", error);
        console.error(error.stack);
        return null;
    }
};

export const saveHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceData,
    links: string[],
    batchIndexRef: { current: number },
    existingAcronyms: Set<string>,
    batchPromises: Promise<BatchEntry[] | null>[],
    year: number
): Promise<{ updatedBatches: [] }> => {

    try {
        const batch: BatchEntry[] = [];
        if (!links || links.length === 0) {
            console.warn(`saveHTMLContent called with empty or null links for conference: ${conference.Acronym}`);
            return { updatedBatches: [] };
        }
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
                            finalLink = page.url();
                            useModifiedLink = true;
                        } else {
                            useModifiedLink = false;
                        }
                    }
                } catch (error: any) { // Type error as any or Error
                    const timestamp = new Date().toISOString();
                    const logMessage = `[${timestamp}] Error accessing modifiedLink: ${error.message} for ${conference.Acronym}\n`;
                    await fs.promises.appendFile('./conference/data/error_access_link_log.txt', logMessage, 'utf8');
                    useModifiedLink = false;
                }

                if (!useModifiedLink) {
                    console.log(`[${conference.Acronym}] Trying originalLink: ${originalLink}`);
                    try {
                        const response = await page.goto(originalLink, { waitUntil: "domcontentloaded", timeout: 15000 });
                        if (response && response.ok()) {
                            finalLink = page.url();
                        } else {
                            throw new Error(`HTTP Error accessing originalLink: ${response ? response.status() : 'Unknown'} - ${conference.Acronym}`);
                        }
                    } catch (error: any) { // Type error as any or Error
                        const timestamp = new Date().toISOString();
                        const logMessage = `[${timestamp}] Error accessing originalLink: ${error.message} for ${conference.Acronym}\n`;
                        await fs.promises.appendFile('./conference/data/error_access_link_log.txt', logMessage, 'utf8');
                        continue;
                    }
                }

                let errorDetails: string | null = null;
                const timestamp = new Date().toISOString();
                let isRedirect: boolean = false;

                page.on('framenavigated', (frame) => {
                    try {
                        if (frame === page.mainFrame() && frame.url() !== (useModifiedLink ? modifiedLink : originalLink) && frame.url() !== finalLink) {
                            isRedirect = true;
                            finalLink = frame.url();
                        }
                    } catch (frameNavigatedError: any) { // Type frameNavigatedError as any or Error
                        console.error("Error in framenavigated event handler:", frameNavigatedError);
                    }
                });

                if (isRedirect) {
                    try {
                        await page.waitForLoadState('load', { timeout: 15000 });
                    } catch (err: any) { // Type err as any or Error
                        errorDetails = `Timeout or unstable state after redirect: ${err.message}`;
                        const logMessage = `[${new Date().toISOString()}] Acronym: ${conference.Acronym} | Link: ${originalLink} | Modified Link: ${useModifiedLink ? modifiedLink : 'N/A'} | Final Link: ${finalLink} | Error: ${errorDetails}\n`;
                        await fs.promises.appendFile('./conference/data/error_access_link_log.txt', logMessage, 'utf8');
                        continue;
                    }
                }

                if (page.url() === finalLink || isRedirect) {
                    const htmlContent = await fetchContentWithRetry(page);
                    const document = cleanDOM(htmlContent);
                    if (!document) continue;
                    let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, year);
                    fullText = removeExtraEmptyLines(fullText);

                    const acronym_index = `${conference.Acronym}_${i}`;
                    let adjustedAcronym = await addAcronymSafely(existingAcronyms, acronym_index);
                    const fullContent = `Website of ${adjustedAcronym}: ${finalLink}\nWebsite information of ${adjustedAcronym}:\n\n${fullText}`;

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
                        conferenceIndex: String(i) || "", // Ensure index is string
                        conferenceLink: finalLink || "No conference link available.",
                        formatConferenceText: fullContent.trim(),
                        conferenceText: fullText.trim(),
                        cfpLink: "",
                        impLink: "",
                        cfpText: "",
                        impText: ""
                    });
                    
                } else {
                    errorDetails = 'Unexpected URL after navigation.';
                    const logMessage = `[${timestamp}] Acronym: ${conference.Acronym} | Link: ${originalLink} | Modified Link: ${useModifiedLink ? modifiedLink : 'N/A'} | Final Link: ${finalLink} | Error: ${errorDetails}\n`;
                    await fs.promises.appendFile('./conference/data/error_access_link_log.txt', logMessage, 'utf8');
                    continue;
                }

            } catch (loopError: any) { // Type loopError as any or Error
                console.error(`Error processing link ${links[i]} for conference ${conference.Acronym}:`, loopError);
            } finally {
                if (page && !page.isClosed()) {
                    try {
                        await page.close();
                    } catch (closeError: any) { // Type closeError as any or Error
                        console.error("Error closing page:", closeError);
                    }
                }
            }

        }

        if (batch.length > 0) {
            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current++;
            const batchPromise = saveBatchToFile(batch, currentBatchIndex, browserContext);
            batchPromises.push(batchPromise);

        } else {
            console.log(`Batch is empty for ${conference.Acronym}`);
        }
        return { updatedBatches: [] };

    } catch (error: any) { // Type error as any or Error
        console.error("Error in saveHTMLContent:", error);
        console.error(error.stack);
        return { updatedBatches: [] };
    }
};


export const updateHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceUpdateData, // Sử dụng interface ConferenceUpdateData
    batchIndexRef: { current: number },
    batchPromises: Promise<BatchUpdateEntry[] | null>[] // Promise trả về BatchUpdateEntry[] | null
): Promise<{ updatedBatches: [] }> => {

    try {
        const page = await browserContext.newPage();
        try {
            const mainLink = conference.mainLink;

            try {
                await page.goto(mainLink, { waitUntil: "domcontentloaded", timeout: 15000 });
            } catch (error: any) {
                const timestamp = new Date().toISOString();
                const logMessage = `[${timestamp}] Error accessing mainLink: ${error.message} for ${conference.Acronym}\n`;
                await fs.promises.appendFile('./conference/data/error_access_link_log.txt', logMessage, 'utf8');
                return { updatedBatches: [] };
            }

            const htmlContent = await fetchContentWithRetry(page);
            const document = cleanDOM(htmlContent);
            if (!document) return { updatedBatches: [] };

            let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, YEAR2);
            fullText = removeExtraEmptyLines(fullText);

            const batch: BatchUpdateEntry = { // Batch entry type is now BatchUpdateEntry
                conferenceName: conference.Title,
                conferenceAcronym: conference.Acronym,
                conferenceText: fullText.trim(),
                cfpLink: conference.cfpLink,
                impLink: conference.impLink,
                cfpText: "",
                impText: "",
            };

            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current++;
            const batchPromise = updateBatchToFile(batch, currentBatchIndex, page); // Pass page
            batchPromises.push(batchPromise);

        } finally { // Use finally to ensure page close
            if (page && !page.isClosed()) {
                await page.close();
            }
        }
        return { updatedBatches: [] };

    } catch (error: any) {
        console.error("Error in updateHTMLContent:", error);
        console.error(error.stack);
        return { updatedBatches: [] };
    }
};

export const updateBatchToFile = async (batch: BatchUpdateEntry, batchIndex: number, page: Page): Promise<BatchUpdateEntry[] | null> => { // Return type is Promise<BatchUpdateEntry[] | null>
    await init();

    try {
        if (!batch || Object.keys(batch).length === 0) {
            console.warn(`updateBatchToFile called with an empty or null batch. batchIndex: ${batchIndex}`);
            return null;
        }
        if (!batch.conferenceAcronym) {
            console.warn(`updateBatchToFile: batch.conferenceAcronym is undefined. batchIndex: ${batchIndex}`);
            return null;
        }

        try {
            if (!fs.existsSync("./conference/data/batches")) {
                fs.mkdirSync("./conference/data/batches", { recursive: true });
            }
        } catch (mkdirError: any) {
            console.error("Error creating batches directory:", mkdirError);
            throw mkdirError;
        }

        const conferenceAcronym = batch.conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const fileUpdateName = `${conferenceAcronym}_update_${batchIndex}.txt`;
        const fileUpdatePath = `./conference/data/batches/${fileUpdateName}`;

        if (batch.cfpLink && batch.cfpLink.toLowerCase() !== "none") {
            try {
                batch.cfpText = await saveHTMLFromCallForPapers(page, batch.cfpLink, batch.conferenceAcronym, YEAR2) || "";
            } catch (cfpError: any) {
                console.error("Error in saveHTMLFromCallForPapers", cfpError);
            }
        }
        if (batch.impLink && batch.impLink.toLowerCase() !== "none") {
            try {
                batch.impText = await saveHTMLFromImportantDates(page, batch.impLink, batch.conferenceAcronym, YEAR2) || "";
            } catch (impError: any) {
                console.error("Error in saveHTMLFromImportantDates", impError);
            }
        }

        const impContent = ` \n\nImportant Dates information:\n${batch.impText}` || "";
        const cfpContent = ` \n\nCall for Papers information:\n${batch.cfpText}` || "";
        const contentSendToAPI = `Conference ${batch.conferenceAcronym}:\n\n${batch.conferenceText}${cfpContent}${impContent}`;

        const fileUpdatePromise = fs.promises.writeFile(fileUpdatePath, contentSendToAPI, "utf8");

        batch.extractResponseText = "";
        batch.extractMetaData = "";

        let extractApiResponse: any;
        try {
            extractApiResponse = await extract_information_api(contentSendToAPI, batchIndex, batch.conferenceAcronym);
            batch.extractResponseText = extractApiResponse.responseText;
            batch.extractMetaData = extractApiResponse.metaData;
        } catch (apiError: any) {
            console.error("Error calling extract_information_api from updateBatchToFile:", apiError);
        }

        await Promise.all([fileUpdatePromise]);
        return [batch];

    } catch (error: any) {
        console.error("Error in updateBatchToFile:", error);
        console.error(error.stack);
        return null;
    }
};