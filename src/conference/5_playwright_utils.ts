// 5_playwright_utils.ts
import { Page, BrowserContext, Response } from 'playwright'; // Import Playwright types
import { URL } from 'url'; // Use Node's built-in URL for robust parsing/joining

import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing';
import { determine_links_api } from './7_gemini_api_utils';
import { extractTextFromPDF } from './9_pdf_utils';
import { logger as defaultLogger } from './11_utils'; // Rename default import
import { MAIN_CONTENT_KEYWORDS } from '../config'; // YEAR2 seems unused here?

import { BatchEntry } from './types';

import { readContentFromFile, writeTempFile } from './11_utils';

// Type alias for logger for easier usage
type Logger = typeof defaultLogger;

export type LogContextBase = {
    batchIndex: number;
    conferenceAcronym: string | undefined;
    conferenceTitle: string | undefined;
    function: string;
    apiCallNumber?: 1 | 2;
    // Add other fields if they are consistently part of the base context
};

// --- Helper Functions (Existing and New) ---

/**
 * Fetches page content with retry mechanism.
 */
export async function fetchContentWithRetry(page: Page, maxRetries: number = 3): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            // Ensure page is not closed before attempting to get content
            if (page.isClosed()) {
                throw new Error("Page is closed, cannot fetch content.");
            }
            return await page.content();
        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error(`[Attempt ${attempt}] Error fetching page content: ${errorMessage}`);
            if (attempt === maxRetries || page.isClosed()) { // Also stop if page closed during wait
                // Re-throw the original error or a new one with context
                if (err instanceof Error) throw err;
                throw new Error(`Failed to fetch content after ${maxRetries} attempts: ${errorMessage}`);
            }
            // Avoid waiting if the page is already closed
            if (!page.isClosed()) {
                await page.waitForTimeout(2000);
            }
        }
    }
    // This should theoretically not be reached if maxRetries >= 1
    // but needed for TS compiler and as a fallback.
    throw new Error("fetchContentWithRetry failed unexpectedly after loop.");
}



/**
 * Normalizes a URL or joins a potentially relative link with a base URL.
 * Uses URL constructor for robustness.
 *
 * Logic:
 * 1. If 'link' is explicitly invalid (null, undefined, empty, "none"), return "".
 * 2. If 'link' is a valid absolute URL, return 'link'.
 * 3. If 'link' is relative and 'baseUrl' is a valid absolute HTTP/HTTPS URL, join them. Return result or "" on error.
 * 4. If 'link' was NOT provided (null/undefined) AND 'baseUrl' is valid, return 'baseUrl' (for normalizing base URL itself).
 * 5. Otherwise (e.g., relative link without base, invalid base), return "".
 */
const normalizeAndJoinLink = (baseUrl: string | undefined | null, link: string | undefined | null): string => {
    const trimmedLink = (typeof link === 'string' ? link.trim() : '');
    const trimmedBaseUrl = (typeof baseUrl === 'string' ? baseUrl.trim() : '');
    // Check if the 'link' argument was actually provided vs being null/undefined
    const wasLinkArgumentProvided = link !== null && link !== undefined;
    const isLinkEffectivelyEmpty = !trimmedLink || trimmedLink.toLowerCase() === "none";

    // --- Case 1: Link argument was provided but is effectively empty/invalid ---
    if (wasLinkArgumentProvided && isLinkEffectivelyEmpty) {
        // Logger.debug(`normalizeAndJoinLink: Link is explicitly invalid ('${link}'). Returning empty string.`);
        return ""; // Explicitly no link provided, return empty string.
    }

    // --- Case 2: Link looks like a valid absolute URL ---
    // Check this only if link wasn't effectively empty
    if (!isLinkEffectivelyEmpty && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedLink)) {
        try {
            new URL(trimmedLink); // Validate parsing
            // Logger.debug(`normalizeAndJoinLink: Link ('${trimmedLink}') is absolute and valid.`);
            return trimmedLink; // It's absolute and valid
        } catch (e) {
            console.warn(`normalizeAndJoinLink: Link "${trimmedLink}" looks absolute but failed URL parsing. Treating as invalid.`);
            return ""; // Treat as invalid if parsing fails
        }
    }

    // --- Case 3: Link is relative, try joining with a valid Base URL ---
    // Check this only if link wasn't effectively empty and base URL is valid for joining
    if (!isLinkEffectivelyEmpty && trimmedBaseUrl && /^https?:\/\//i.test(trimmedBaseUrl)) {
        try {
            const base = new URL(trimmedBaseUrl);
            // Ensure base URL ends with '/' for correct relative resolution if needed, URL constructor handles this well
            const resolvedUrl = new URL(trimmedLink, base); // Use base object directly
            // Logger.debug(`normalizeAndJoinLink: Joined relative link '${trimmedLink}' with base '${trimmedBaseUrl}' to '${resolvedUrl.toString()}'.`);
            return resolvedUrl.toString(); // Successfully joined.
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`normalizeAndJoinLink: Error joining base "${trimmedBaseUrl}" and link "${trimmedLink}": ${errorMessage}.`);
            return ""; // Return empty if joining failed
        }
    }

    // --- Case 4: Only Base URL was relevant (link argument was null/undefined) ---
    // This handles the case normalizeAndJoinLink(baseUrl, null)
    if (!wasLinkArgumentProvided && trimmedBaseUrl && /^(https?:\/\/|mailto:|tel:)/i.test(trimmedBaseUrl)) {
         try {
            new URL(trimmedBaseUrl); // Validate parsing
            // Logger.debug(`normalizeAndJoinLink: Normalizing base URL '${trimmedBaseUrl}'.`);
            return trimmedBaseUrl; // Return normalized base URL
         } catch (e) {
             console.warn(`normalizeAndJoinLink: Base URL "${trimmedBaseUrl}" failed URL parsing when normalizing. Treating as invalid.`);
             return "";
         }
    }

    // --- Default: All other cases ---
    // (e.g., relative link without base, invalid base, link was provided but couldn't be resolved/joined)
    if (!isLinkEffectivelyEmpty && wasLinkArgumentProvided && !trimmedBaseUrl) {
         console.warn(`normalizeAndJoinLink: Cannot resolve relative link "${trimmedLink}" without a valid absolute base URL.`);
    } else if (!isLinkEffectivelyEmpty && wasLinkArgumentProvided && trimmedBaseUrl && !/^https?:\/\//i.test(trimmedBaseUrl)) {
         console.warn(`normalizeAndJoinLink: Cannot resolve relative link "${trimmedLink}" with non-HTTP/HTTPS base URL "${trimmedBaseUrl}".`);
    }
    // Logger.debug(`normalizeAndJoinLink: No valid URL determined for link ('${link}') and base ('${baseUrl}'). Returning empty string.`);
    return ""; // Return empty string otherwise.
};

export async function extractTextFromUrl(page: Page, url: string, acronym: string | undefined, year: number, useMainContentKeywords: boolean = false): Promise<string> {
    const logContext = { url, acronym, year, useMainContentKeywords };
    defaultLogger.debug({ ...logContext, event: 'extractTextFromUrl_start' });

    // --- NEW: Pre-check for invalid URL ---
    if (!url || typeof url !== 'string' || url.trim() === '' || !/^(https?:\/\/|file:\/\/)/i.test(url)) {
        // Allow http, https, and potentially file URLs (for local PDFs if needed), reject others/empty.
        // Note: We don't handle mailto: or tel: here as they aren't fetchable pages.
        // normalizeAndJoinLink should prevent mailto/tel from reaching here unless explicitly passed.
        let reason = "URL is empty, null, or not a string.";
        if (url && typeof url === 'string' && url.trim() !== '') {
            reason = `URL is not a valid fetchable (http/https/file) URL: ${url}`;
        }
        defaultLogger.warn({ ...logContext, reason, event: 'extractTextFromUrl_skipped_invalid_url' });
        return ""; // Return empty string immediately for invalid URLs
    }
    // --- End NEW ---

    try {
        // 1. Handle PDF (Check extension AFTER ensuring it's a valid URL structure)
        if (url.toLowerCase().endsWith(".pdf")) {
            defaultLogger.info({ ...logContext, type: 'pdf', event: 'extractTextFromUrl_pdf_start' });
            try {
                const pdfText = await extractTextFromPDF(url);
                defaultLogger.info({ ...logContext, type: 'pdf', success: true, event: 'extractTextFromUrl_pdf_success' });
                return pdfText || "";
            } catch (pdfError: unknown) {
                defaultLogger.error({ ...logContext, type: 'pdf', err: pdfError, event: 'extractTextFromUrl_pdf_failed' });
                return ""; // Return empty on PDF extraction error
            }
        }

        // 2. Handle HTML
        defaultLogger.info({ ...logContext, type: 'html', event: 'extractTextFromUrl_html_start' });
        try {
            // Check if page is closed before navigation
            if (page.isClosed()) {
                throw new Error(`Page closed before navigating to ${url}`);
            }
            await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
        } catch (gotoError: unknown) {
            defaultLogger.error({ ...logContext, type: 'html', err: gotoError, event: 'extractTextFromUrl_goto_failed' });
            return ""; // Return empty on navigation error
        }

        let htmlContent: string;
        try {
            // Use retry mechanism for fetching content
            htmlContent = await fetchContentWithRetry(page, 3);
        } catch (contentError: unknown) {
            defaultLogger.error({ ...logContext, type: 'html', err: contentError, event: 'extractTextFromUrl_fetch_content_failed' });
            return ""; // Return empty if content fetch fails
        }


        // 3. Extract Main Content (Optional)
        let mainContentHTML = htmlContent;
        if (useMainContentKeywords && MAIN_CONTENT_KEYWORDS && MAIN_CONTENT_KEYWORDS.length > 0) {
            defaultLogger.debug({ ...logContext, type: 'html', event: 'extractTextFromUrl_main_content_eval_start' });
            try {
                // Ensure page is usable for evaluation
                if (page.isClosed()) {
                    throw new Error(`Page closed before $$eval on ${url}`);
                }

                // Robust $$eval: handle potential non-array keywords and element filtering
                const extractedContentRaw: string | string[] = await page.$$eval("body *", (els, keywords) => {
                    // Type guard inside $$eval
                    const safeKeywords = Array.isArray(keywords) ? keywords.map(k => String(k).toLowerCase()) : [];
                    if (safeKeywords.length === 0) {
                        // FIX: Check for document existence before accessing body
                        return document ? (document.body?.outerHTML || "") : ""; // Fallback if no keywords
                    }

                    return els
                        .filter((el: Element) =>
                            el.hasAttributes() && // Optimization: check if element has attributes first
                            Array.from(el.attributes).some((attr: Attr) =>
                                safeKeywords.some((keyword: string) =>
                                    attr.name.toLowerCase().includes(keyword) || // Check attribute name
                                    attr.value.toLowerCase().includes(keyword)   // Optionally check attribute value too? (Consider performance)
                                )
                            )
                        )
                        .map((el: Element) => el.outerHTML) // Get outerHTML of matching elements
                        .join("\n\n"); // Join the HTML strings
                }, MAIN_CONTENT_KEYWORDS); // Pass keywords array

                // Ensure extractedContent is a string
                const extractedContent = Array.isArray(extractedContentRaw)
                    ? extractedContentRaw.join('\n\n')
                    : extractedContentRaw;

                if (extractedContent && extractedContent.length > 50) { // Use a threshold to ensure meaningful content was extracted
                    mainContentHTML = extractedContent;
                    defaultLogger.debug({ ...logContext, type: 'html', event: 'extractTextFromUrl_main_content_eval_success', usedExtracted: true });
                } else {
                    defaultLogger.debug({ ...logContext, type: 'html', event: 'extractTextFromUrl_main_content_eval_skipped', reason: 'No significant content found' });
                }
            } catch (evalError: unknown) {
                // Log error but continue with full HTML content as fallback
                defaultLogger.warn({ ...logContext, type: 'html', err: evalError, event: 'extractTextFromUrl_main_content_eval_failed' });
            }
        }

        // 4. Clean DOM and Traverse
        defaultLogger.debug({ ...logContext, type: 'html', event: 'extractTextFromUrl_dom_processing_start' });
        const document = cleanDOM(mainContentHTML);
        if (!document || !document.body) {
            defaultLogger.warn({ ...logContext, type: 'html', event: 'extractTextFromUrl_dom_processing_failed', reason: 'Cleaned DOM or body is null' });
            return "";
        }
        let fullText = traverseNodes(document.body as HTMLElement, acronym, year);
        fullText = removeExtraEmptyLines(fullText);
        defaultLogger.info({ ...logContext, type: 'html', success: true, textLength: fullText.length, event: 'extractTextFromUrl_html_success' });
        return fullText;

    } catch (error: unknown) {
        defaultLogger.error({ ...logContext, err: error, event: 'extractTextFromUrl_unexpected_error' });
        console.error("Stack trace for extractTextFromUrl error:", error instanceof Error ? error.stack : 'N/A');
        return ""; // Return empty on any unexpected error
    }
}

/**
 * Saves content to a temporary file if the content is not empty.
 * Returns the file path or null.
 */
export async function saveContentToTempFile(
    content: string,
    baseName: string,
    logContext: object,
    logger: Logger
): Promise<string | null> {
    if (!content || content.trim().length === 0) {
        logger.info({ ...logContext, event: 'saveContentToTempFile_skipped', reason: 'Content is empty' });
        return null;
    }
    try {
        const filePath = await writeTempFile(content, baseName);
        logger.info({ ...logContext, filePath, event: 'saveContentToTempFile_success' });
        return filePath;
    } catch (writeError: unknown) {
        logger.error({ ...logContext, err: writeError, event: 'saveContentToTempFile_failed' });
        return null; // Indicate failure to save
    }
}

/**
 * Processes a specific URL (CFP or IMP), extracts text, and saves it.
 */
async function processAndSaveLinkedPage(
    page: Page,
    link: string | undefined | null,
    baseLink: string, // The main official website URL (normalized)
    otherLink: string | undefined | null, // The *other* link (e.g., CFP link when processing IMP)
    acronym: string | undefined,
    year: number,
    contentType: 'CFP' | 'IMP',
    useMainContentKeywords: boolean,
    logContext: LogContextBase, // FIX: Use specific type
    logger: Logger
): Promise<string | null> {
    const safeAcronym = acronym?.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
    const fileBaseName = `${safeAcronym}_${contentType.toLowerCase()}_${year}`;
    const currentLogContext = { ...logContext, contentType, url: link, fileBaseName };

    // 1. Check if saving is needed
    const normalizedLink = normalizeAndJoinLink(baseLink, link); // Normalize here for comparison
    const normalizedBaseLink = baseLink; // Already normalized
    const normalizedOtherLink = normalizeAndJoinLink(baseLink, otherLink); // Normalize other link too

    if (!normalizedLink || normalizedLink === normalizedBaseLink || (normalizedOtherLink && normalizedLink === normalizedOtherLink)) {
        let reason = 'Link is empty or None';
        if (normalizedLink === normalizedBaseLink) reason = `Link matches official website (${normalizedBaseLink})`;
        else if (normalizedOtherLink && normalizedLink === normalizedOtherLink) reason = `Link matches ${contentType === 'CFP' ? 'IMP' : 'CFP'} link (${normalizedOtherLink})`;
        logger.info({ ...currentLogContext, reason, event: 'processAndSaveLinkedPage_skipped' });
        return null;
    }

    // 2. Extract content
    logger.info({ ...currentLogContext, event: 'processAndSaveLinkedPage_extract_start' });
    const textContent = await extractTextFromUrl(page, normalizedLink, acronym, year, useMainContentKeywords);

    // 3. Save content
    return await saveContentToTempFile(textContent, fileBaseName, currentLogContext, logger);
}

/**
 * Fetches and processes the main official website.
 * Returns the final URL and the path to the saved text content.
 */
const fetchAndProcessWebsiteInfo = async (
    page: Page,
    officialWebsite: string, // Expect normalized URL
    batchEntry: BatchEntry,
    year: number,
    logContext: LogContextBase, // FIX: Use specific type
    logger: Logger
): Promise<{ finalUrl: string; textPath: string } | null> => {
    const currentLogContext = { ...logContext, url: officialWebsite, function: 'fetchAndProcessWebsiteInfo' };
    logger.info({ ...currentLogContext, event: 'fetch_website_start' });
    try {
        // Check page status before navigation
        if (page.isClosed()) {
            throw new Error(`Page closed before navigating to main website ${officialWebsite}`);
        }
        const response: Response | null = await page.goto(officialWebsite, { waitUntil: 'domcontentloaded', timeout: 25000 });

        if (!response || !response.ok()) {
            logger.error({ ...currentLogContext, status: response?.status(), event: 'fetch_website_failed', reason: 'Non-OK response' });
            return null;
        }

        const finalUrl = page.url(); // Get URL after potential redirects
        const normalizedFinalUrl = finalUrl.endsWith('/') ? finalUrl.slice(0, -1) : finalUrl; // Normalize final URL

        logger.info({ ...currentLogContext, finalUrl: normalizedFinalUrl, event: 'fetch_website_navigated' });

        // Extract text content (using the helper function, no main content keywords for main page)
        const textContent = await extractTextFromUrl(page, normalizedFinalUrl, batchEntry.conferenceAcronym, year, false);

        // Save content to temp file
        const safeAcronym = batchEntry.conferenceAcronym.replace(/[^a-zA-Z0-9_-]/g, '-') || 'unknown';
        const fileBaseName = `${safeAcronym}_main_${year}`;
        const textPath = await saveContentToTempFile(textContent, fileBaseName, currentLogContext, logger);

        if (!textPath) {
            logger.warn({ ...currentLogContext, finalUrl: normalizedFinalUrl, event: 'fetch_website_save_failed' });
            // Decide if you want to return null here or continue without textPath
            return null; // Returning null as saving failed
        }

        logger.info({ ...currentLogContext, finalUrl: normalizedFinalUrl, textPath, event: 'fetch_website_success' });
        return { finalUrl: normalizedFinalUrl, textPath };

    } catch (error: unknown) {
        logger.error({ ...currentLogContext, err: error, event: 'fetch_website_error' });
        console.error("Stack trace for fetchAndProcessWebsiteInfo error:", error instanceof Error ? error.stack : 'N/A');
        return null;
    }
};

// --- Private Helper Functions for processDetermineLinksResponse ---

/**
 * Handles the logic when a matching entry is found in the batch.
 */
async function _handleMatchingEntry(
    page: Page,
    matchingEntry: BatchEntry,
    cfpLink: string, // Already normalized relative to original official website
    impLink: string, // Already normalized relative to original official website
    year: number,
    logContext: LogContextBase, // FIX: Use specific type
    logger: Logger
): Promise<BatchEntry> {
    const currentLogContext = { ...logContext, matchedLink: matchingEntry.conferenceLink, function: '_handleMatchingEntry' };
    logger.info({ ...currentLogContext, event: 'start' });

    // Use the matched entry's link as the base for saving checks
    const baseLink = matchingEntry.conferenceLink.endsWith('/') ? matchingEntry.conferenceLink.slice(0, -1) : matchingEntry.conferenceLink;

    matchingEntry.cfpLink = cfpLink; // Store the normalized link
    matchingEntry.impLink = impLink; // Store the normalized link

    let cfpSaveError = false;
    let impSaveError = false;

    try {
        // Process and save CFP page (useMainContentKeywords = true)
        matchingEntry.cfpTextPath = await processAndSaveLinkedPage(
            page, cfpLink, baseLink, impLink, matchingEntry.conferenceAcronym, year, 'CFP', true, currentLogContext, logger
        );
        if (cfpLink && !matchingEntry.cfpTextPath && cfpLink !== baseLink) cfpSaveError = true; // Mark error if saving was expected but failed

    } catch (error) {
        logger.error({ ...currentLogContext, contentType: 'CFP', err: error, event: 'save_cfp_error' });
        cfpSaveError = true;
    }

    try {
        // Process and save IMP page (useMainContentKeywords = false)
        // Pass cfpLink as the 'otherLink' to avoid saving if IMP == CFP
        matchingEntry.impTextPath = await processAndSaveLinkedPage(
            page, impLink, baseLink, cfpLink, matchingEntry.conferenceAcronym, year, 'IMP', false, currentLogContext, logger
        );
        if (impLink && !matchingEntry.impTextPath && impLink !== baseLink && impLink !== cfpLink) impSaveError = true; // Mark error if saving was expected but failed

    } catch (error) {
        logger.error({ ...currentLogContext, contentType: 'IMP', err: error, event: 'save_imp_error' });
        impSaveError = true;
    }

    const success = !cfpSaveError && !impSaveError;
    logger.info({ ...currentLogContext, success, cfpSaveError, impSaveError, event: 'finish' });
    return matchingEntry; // Return the updated entry
}

/**
 * Handles the logic when no matching entry is found (fetch new, call API 2, save).
 */
async function _handleNewEntry(
    page: Page,
    originalOfficialWebsite: string, // Normalized URL from API 1
    batchEntry: BatchEntry, // The entry to update (usually batch[0])
    year: number,
    logContext: LogContextBase, // FIX: Use specific type
    logger: Logger
): Promise<BatchEntry | null> { // Return null on critical failure
    const currentLogContext = { ...logContext, initialUrl: originalOfficialWebsite, function: '_handleNewEntry' };
    logger.info({ ...currentLogContext, event: 'start' });

    // 1. Fetch and process the main website
    const websiteInfo = await fetchAndProcessWebsiteInfo(page, originalOfficialWebsite, batchEntry, year, currentLogContext, logger);

    if (!websiteInfo) {
        logger.error({ ...currentLogContext, event: 'fetch_main_website_failed' });
        batchEntry.conferenceLink = "None"; // Mark as failed
        return batchEntry; // Return the entry marked as failed
    }

    const { finalUrl, textPath } = websiteInfo; // finalUrl is already normalized by fetchAndProcessWebsiteInfo
    batchEntry.conferenceLink = finalUrl;
    batchEntry.conferenceTextPath = textPath;

    // 2. Read fetched content for API call 2
    let fullText = '';
    try {
        fullText = await readContentFromFile(textPath);
        logger.info({ ...currentLogContext, filePath: textPath, event: 'read_fetched_content_success' });
    } catch (readErr: unknown) {
        logger.error({ ...currentLogContext, filePath: textPath, err: readErr, event: 'read_fetched_content_failed' });
        // Continue, but API call 2 might fail or give bad results without content
    }


    // 3. Call determine_links_api (2nd call)
    const batchContentForApi = `Conference full name: ${batchEntry.conferenceTitle} (${batchEntry.conferenceAcronym})\n\n1. Website of ${batchEntry.conferenceAcronym}: ${finalUrl}\nWebsite information of ${batchEntry.conferenceAcronym}:\n\n${fullText.trim()}`;
    let websiteLinksResponseText: string = "";
    let api2Success = false;

    try {
        logger.info({ ...currentLogContext, event: 'api2_call_start' });
        // FIX: logContext now correctly typed, access is safe
        const websiteLinksResponse = await determine_links_api(batchContentForApi, logContext.batchIndex, batchEntry.conferenceTitle, batchEntry.conferenceAcronym, logger);
        websiteLinksResponseText = websiteLinksResponse.responseText || "";
        api2Success = true;
        logger.info({ ...currentLogContext, responseLength: websiteLinksResponseText.length, event: 'api2_call_success' });
    } catch (determineLinksError: unknown) {
        logger.error({ ...currentLogContext, err: determineLinksError, event: 'api2_call_failed' });
        // Don't mark as "None" yet, maybe we can still save based on API 1 links?
        // Or decide here: if API 2 fails, the whole process for this entry fails.
        // Let's mark as failed if API 2 fails critically.
        batchEntry.conferenceLink = "None"; // Mark as failed due to API 2 error
        return batchEntry;
    }

    // 4. Parse API 2 response
    let websiteLinksData: any;
    try {
        // Add similar robust parsing as in processDetermineLinksResponse
        if (typeof websiteLinksResponseText !== 'string' || websiteLinksResponseText.trim() === '') {
            throw new Error("API 2 response text is empty or not a string.");
        }
        websiteLinksData = JSON.parse(websiteLinksResponseText);
        if (typeof websiteLinksData !== 'object' || websiteLinksData === null) {
            throw new Error("Parsed API 2 response is not a valid object.");
        }
    } catch (parseError: unknown) {
        logger.error({ ...currentLogContext, err: parseError, responseTextPreview: String(websiteLinksResponseText).substring(0, 100), event: 'api2_json_parse_failed' });
        batchEntry.conferenceLink = "None"; // Mark as failed if parsing fails
        return batchEntry;
    }

    // 5. Normalize links from API 2 relative to the FINAL URL
    // Use safe access and String conversion
    const websiteCfpLinkRaw = String(websiteLinksData?.["Call for papers link"] ?? '').trim();
    const websiteImpDatesLinkRaw = String(websiteLinksData?.["Important dates link"] ?? '').trim();

    // Normalize using the finalUrl as base. Result is "" if raw link is invalid or cannot be joined.
    const websiteCfpLink = normalizeAndJoinLink(finalUrl, websiteCfpLinkRaw);
    const websiteImpDatesLink = normalizeAndJoinLink(finalUrl, websiteImpDatesLinkRaw);
    logger.debug({ ...currentLogContext, finalUrl, websiteCfpLinkRaw, websiteCfpLink, websiteImpDatesLinkRaw, websiteImpDatesLink, event: 'api2_links_normalized' });

    batchEntry.cfpLink = websiteCfpLink; // Store the normalized link (or "")
    batchEntry.impLink = websiteImpDatesLink; // Store the normalized link (or "")

    // 6. Save CFP and IMP content based on API 2 results
    let cfpSaveError = false;
    let impSaveError = false;

    try {
        // Process and save CFP page (useMainContentKeywords = true)
        batchEntry.cfpTextPath = await processAndSaveLinkedPage(
            page, websiteCfpLink, finalUrl, websiteImpDatesLink, batchEntry.conferenceAcronym, year, 'CFP', true, currentLogContext, logger
        );
        if (websiteCfpLink && !batchEntry.cfpTextPath && websiteCfpLink !== finalUrl) cfpSaveError = true;

    } catch (error) {
        logger.error({ ...currentLogContext, contentType: 'CFP', source: 'api2', err: error, event: 'save_cfp_error' });
        cfpSaveError = true;
    }

    try {
        // Process and save IMP page (useMainContentKeywords = false)
        batchEntry.impTextPath = await processAndSaveLinkedPage(
            page, websiteImpDatesLink, finalUrl, websiteCfpLink, batchEntry.conferenceAcronym, year, 'IMP', false, currentLogContext, logger
        );
        if (websiteImpDatesLink && !batchEntry.impTextPath && websiteImpDatesLink !== finalUrl && websiteImpDatesLink !== websiteCfpLink) impSaveError = true;

    } catch (error) {
        logger.error({ ...currentLogContext, contentType: 'IMP', source: 'api2', err: error, event: 'save_imp_error' });
        impSaveError = true;
    }

    const success = !cfpSaveError && !impSaveError; // Overall success depends on saving steps too
    logger.info({ ...currentLogContext, success, cfpSaveError, impSaveError, event: 'finish' });

    // Even if saving failed, we return the entry with the fetched info and attempted links
    return batchEntry;
}


// --- Main Orchestrating Function ---

/**
 * Processes the response from the first determine_links_api call.
 * Finds matching entries or fetches new website info, potentially calls API again,
 * and saves relevant content (CFP, IMP dates).
 * Manages Playwright page lifecycle.
 */
export const processDetermineLinksResponse = async (
    responseText: string,
    batch: BatchEntry[],
    batchIndex: number,
    browserContext: BrowserContext,
    year: number,
    apiCallNumber: 1 | 2 = 1, // Keep for context, though logic focuses on call 1 response
    parentLogger: Logger // Use the specific Logger type
): Promise<BatchEntry[]> => {

    // Ensure batch has at least one entry to process
    if (!batch || batch.length === 0 || !batch[0]) {
        parentLogger.error({ batchIndex, year, apiCallNumber, event: 'process_determine_invalid_batch' }, "Invalid or empty batch provided.");
        return []; // Return empty array for invalid input
    }

    const primaryEntry = batch[0]; // Work primarily with the first entry for context/logging
    const baseLogContext = {
        batchIndex,
        conferenceAcronym: primaryEntry.conferenceAcronym,
        conferenceTitle: primaryEntry.conferenceTitle,
        function: 'processDetermineLinksResponse',
        apiCallNumber
    };
    parentLogger.info({ ...baseLogContext, event: 'process_determine_start' });

    let page: Page | null = null;

    try {
        // 1. Create Playwright Page
        try {
            page = await browserContext.newPage();
            parentLogger.info({ ...baseLogContext, event: 'page_created' });
        } catch (pageError: unknown) {
            parentLogger.error({ ...baseLogContext, err: pageError, event: 'page_creation_failed' });
            primaryEntry.conferenceLink = "None"; // Mark as failed if page cannot be created
            return [primaryEntry];
        }


        // 2. Parse Initial API Response
        let linksData: any;
        try {
            // Handle potential non-string responseText gracefully
            if (typeof responseText !== 'string' || responseText.trim() === '') {
                throw new Error("API response text is empty or not a string.");
            }
            linksData = JSON.parse(responseText);
            // Basic check if it's an object
            if (typeof linksData !== 'object' || linksData === null) {
                throw new Error("Parsed API response is not a valid object.");
            }
        } catch (parseError: unknown) {
            parentLogger.error({ ...baseLogContext, err: parseError, responseTextPreview: String(responseText).substring(0, 100), event: 'process_determine_json_parse_failed' });
            primaryEntry.conferenceLink = "None";
            return [primaryEntry];
        }

        // 3. Extract and Validate Official Website from API 1
        // Use optional chaining and nullish coalescing for safer access
        const officialWebsiteRaw = linksData?.["Official Website"] ?? null; // Get value or null

        // Check if raw value indicates no valid URL BEFORE normalization
        if (!officialWebsiteRaw || typeof officialWebsiteRaw !== 'string' || officialWebsiteRaw.trim().toLowerCase() === "none" || officialWebsiteRaw.trim() === '') {
            parentLogger.warn({ ...baseLogContext, officialWebsiteRaw, event: 'process_determine_no_official_website', reason: 'Raw value is null, empty, or "none"' });
            primaryEntry.conferenceLink = "None";
            return [primaryEntry];
        }

        // 4. Normalize URLs from API 1 Response
        // Normalize the official website URL. Pass null for the 'link' argument to normalize the base URL itself.
        const officialWebsiteNormalized = normalizeAndJoinLink(officialWebsiteRaw, null);

        // Check if normalization resulted in a valid URL
        if (!officialWebsiteNormalized) {
            parentLogger.error({ ...baseLogContext, rawUrl: officialWebsiteRaw, event: 'process_determine_invalid_official_website' }, "Official website URL is invalid after normalization.");
            primaryEntry.conferenceLink = "None";
            return [primaryEntry];
        }
        parentLogger.info({ ...baseLogContext, officialWebsiteNormalized, event: 'process_determine_official_website_normalized' });


        // Extract and normalize CFP/IMP links relative to the *normalized* official website
        // Use String() to handle potential non-string values gracefully before trim()
        const cfpLinkRaw = String(linksData?.["Call for papers link"] ?? linksData?.["call_for_papers_link"] ?? '').trim();
        const impLinkRaw = String(linksData?.["Important dates link"] ?? linksData?.["important_dates_link"] ?? '').trim();

        // Normalize. Result will be "" if raw link is invalid ("none", empty, etc.) or cannot be joined.
        const cfpLinkNormalized = normalizeAndJoinLink(officialWebsiteNormalized, cfpLinkRaw);
        const impLinkNormalized = normalizeAndJoinLink(officialWebsiteNormalized, impLinkRaw);
        parentLogger.debug({ ...baseLogContext, officialWebsiteNormalized, cfpLinkRaw, cfpLinkNormalized, impLinkRaw, impLinkNormalized, event: 'process_determine_links_normalized' });

        // 5. Find Matching Entry in Batch based on the *normalized* official website
        let matchingEntry: BatchEntry | undefined;
        try {
            matchingEntry = batch.find(entry => {
                if (!entry.conferenceLink) return false;
                // Normalize the entry's link for comparison using the same logic
                const normalizedEntryLink = normalizeAndJoinLink(entry.conferenceLink, null);
                // Compare non-empty normalized links
                return normalizedEntryLink && normalizedEntryLink === officialWebsiteNormalized;
            });
        } catch (findError: unknown) {
            parentLogger.error({ ...baseLogContext, err: findError, event: 'process_determine_entry_match_error' });
            primaryEntry.conferenceLink = "None"; // Mark primary as failed
            return [primaryEntry]; // Return only the failed primary entry
        }


        // 6. Delegate to Helper Functions based on Match
        let processedEntry: BatchEntry | null = null; // Store the entry that was actually processed

        if (matchingEntry) {
            parentLogger.info({ ...baseLogContext, matchedLink: matchingEntry.conferenceLink, event: 'process_determine_entry_match_found' });
            // Pass the *normalized* official website and CFP/IMP links
            processedEntry = await _handleMatchingEntry(
                page,
                matchingEntry, // Pass the specific entry that matched
                cfpLinkNormalized,
                impLinkNormalized,
                year,
                baseLogContext,
                parentLogger
            );
        } else {
            parentLogger.info({ ...baseLogContext, officialWebsite: officialWebsiteNormalized, event: 'process_determine_entry_match_not_found' });
            // If no match, handle the officialWebsite as a new entry, updating the primary entry (batch[0])
            // Pass the *normalized* official website. If CFP/IMP links should be processed even for new
            // entries, they need to be passed here too.
            processedEntry = await _handleNewEntry(
                page,
                officialWebsiteNormalized, // Pass the validated & normalized URL
                primaryEntry, // Pass the primary entry to be updated
                year,
                baseLogContext,
                parentLogger
                // Pass cfpLinkNormalized, impLinkNormalized here if needed for new entries
            );
            // Note: _handleNewEntry modifies primaryEntry in place, so processedEntry === primaryEntry (unless it returned null)
        }

        // 7. Return Result
        if (processedEntry) {
            // If the processed entry failed (link set to "None"), log it as failed status
            const finalStatus = processedEntry.conferenceLink === "None" ? 'failed' : 'success';
            parentLogger.info({ ...baseLogContext, finalStatus, event: 'process_determine_finish' });
            // Return an array containing the single entry that was processed (either the match or the updated primary)
            return [processedEntry];
        } else {
            // This case implies _handleNewEntry returned null (critical fetch failure)
            parentLogger.error({ ...baseLogContext, event: 'process_determine_finish_critical_failure' });
            // primaryEntry should already be marked as "None" by _handleNewEntry
            return [primaryEntry];
        }

    } catch (error: unknown) {
        // Catch any unexpected errors during the main orchestration
        parentLogger.error({ ...baseLogContext, err: error, event: 'process_determine_unhandled_error' });
        console.error("Stack trace for processDetermineLinksResponse unhandled error:", error instanceof Error ? error.stack : 'N/A');
        // Ensure the primary entry is marked as failed
        primaryEntry.conferenceLink = "None";
        return [primaryEntry];
    } finally {
        // 8. Ensure Page Closure
        if (page && !page.isClosed()) {
            parentLogger.info({ ...baseLogContext, event: 'page_closing' });
            await page.close().catch(e => parentLogger.error({ ...baseLogContext, err: e, event: 'page_close_failed' }));
        } else if (!page) {
            parentLogger.info({ ...baseLogContext, event: 'page_not_created' });
        } else {
            parentLogger.info({ ...baseLogContext, event: 'page_already_closed' });
        }
    }
};