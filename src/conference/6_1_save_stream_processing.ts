// 6_batch_processing.ts
import fs from 'fs';
import path from 'path';
import { Page, BrowserContext } from 'playwright'; // Import Playwright types

// Local Utils & Types
import { addAcronymSafely, logger as defaultLogger, readContentFromFile, writeTempFile } from './11_utils'; // Consolidate local imports
import { BatchEntry, BatchUpdateEntry, ConferenceData, type ApiResponse } from './types'; // Assuming ProcessedResponseData exists or define it
import { LogContextBase } from './5_playwright_utils'; // Import the base log context type

// Domain Logic Imports
import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing';
import { extract_information_api, cfp_extraction_api, determine_links_api } from './7_gemini_api_utils';
import { processDetermineLinksResponse, fetchContentWithRetry } from './5_playwright_utils';

// Config
import { YEAR2, API_TYPE_CFP, API_TYPE_EXTRACT } from '../config';

// Constants
const BATCHES_DIR = path.join(__dirname, "./data/batches");
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');

// Type alias for logger
type Logger = typeof defaultLogger;

// --- Specific Log Context Type for this Module ---
export interface BatchProcessingLogContext extends LogContextBase {
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

/**
 * Processes a single link during the initial crawl phase.
 * Handles year replacement, navigation, content extraction, and saving.
 * Returns a BatchEntry on success, null on failure.
 */
async function _processSingleLink(
    page: Page,
    link: string,
    linkIndex: number,
    conference: ConferenceData,
    year: number,
    existingAcronyms: Set<string>,
    logger: Logger,
    parentLogContext: BatchProcessingLogContext
): Promise<BatchEntry | null> {
    const linkLogContext: BatchProcessingLogContext = {
        ...parentLogContext,
        linkIndex,
        originalUrl: link,
        event_group: 'link_processing'
    };
    logger.info({ ...linkLogContext, event: 'start' }, `Processing link ${linkIndex + 1}`);
    let finalLink: string = link;
    let useModifiedLink: boolean = false;
    let modifiedLink: string = link;
    let accessSuccess = false;
    let accessError: unknown = null;
    let responseStatus: number | null = null;
    let accessType: 'modified' | 'original' | null = null;

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

        // Try modified link
        if (useModifiedLink) {
            accessType = 'modified';
            logger.info({ ...linkLogContext, url: modifiedLink, type: accessType, event: 'access_attempt' });
            try {
                const response = await page.goto(modifiedLink, { waitUntil: "domcontentloaded", timeout: 15000 });
                responseStatus = response?.status() ?? null;
                if (response && response.ok()) {
                    finalLink = page.url();
                    logger.info({ ...linkLogContext, url: modifiedLink, status: responseStatus, finalUrl: finalLink, type: accessType, event: 'access_success' });
                    accessSuccess = true;
                } else {
                    accessError = new Error(`HTTP ${responseStatus} accessing modified link`);
                    logger.warn({ ...linkLogContext, url: modifiedLink, status: responseStatus, type: accessType, event: 'access_failed' }, "Modified link failed (HTTP status), reverting");
                    useModifiedLink = false; // Revert flag
                    finalLink = link; // Revert finalLink
                }
            } catch (error: unknown) {
                accessError = error;
                logger.warn({ ...linkLogContext, url: modifiedLink, type: accessType, err: error, event: 'access_failed' }, "Error accessing modified link (exception), will try original");
                useModifiedLink = false; // Revert flag
                finalLink = link; // Revert finalLink
                // Log error to separate file if needed
                // const timestamp = new Date().toISOString(); ... log file phụ ...
            }
        }

        // Try original link if needed
        if (!accessSuccess) {
            accessType = 'original';
            logger.info({ ...linkLogContext, url: link, type: accessType, event: 'access_attempt' });
            try {
                const response = await page.goto(link, { waitUntil: "domcontentloaded", timeout: 15000 });
                responseStatus = response?.status() ?? null;
                if (response && response.ok()) {
                    finalLink = page.url();
                    logger.info({ ...linkLogContext, url: link, status: responseStatus, finalUrl: finalLink, type: accessType, event: 'access_success' });
                    accessSuccess = true;
                } else {
                    accessError = new Error(`HTTP ${responseStatus} accessing original link`);
                    logger.error({ ...linkLogContext, url: link, status: responseStatus, type: accessType, event: 'access_failed' }, `Original link failed (HTTP ${responseStatus}), skipping link.`);
                }
            } catch (error: unknown) {
                accessError = error;
                logger.error({ ...linkLogContext, url: link, type: accessType, err: error, event: 'access_failed' }, "Error accessing original link (exception), skipping link");
                // Log error to separate file if needed
                // const timestamp = new Date().toISOString(); ... log file phụ ...
            }
        }

        // If access failed completely, return null
        if (!accessSuccess) {
            logger.error({ ...linkLogContext, err: accessError, finalStatus: responseStatus, event: 'processing_failed_skip' }, "Failed to access link after all attempts.");
            return null;
        }

        // --- Access Success, Proceed ---

        // Handle redirects (simple check and wait)
        let intendedUrl = useModifiedLink ? modifiedLink : link;
        if (page.url() !== intendedUrl && page.url() !== finalLink) {
            finalLink = page.url(); // Update finalLink again
            logger.info({ ...linkLogContext, fromUrl: intendedUrl, toUrl: finalLink, event: 'redirect_detected' });
            try {
                await page.waitForLoadState('load', { timeout: 15000 });
            } catch (err: unknown) {
                logger.warn({ ...linkLogContext, url: finalLink, err: err, event: 'redirect_wait_failed' });
            }
        }

        // Fetch content
        const fetchContext = { ...linkLogContext, url: finalLink };
        logger.debug({ ...fetchContext, event: 'content_fetch_start' });
        const htmlContent = await fetchContentWithRetry(page); // Assumes fetchContentWithRetry throws on total failure
        logger.debug({ ...fetchContext, event: 'content_fetch_success' });

        // Clean DOM
        const cleanContext = { ...linkLogContext, url: finalLink };
        logger.debug({ ...cleanContext, event: 'dom_clean_start' });
        const document = cleanDOM(htmlContent);
        if (!document || !document.body) {
            logger.warn({ ...cleanContext, event: 'dom_clean_failed' }, "Cleaned DOM or body is null, skipping link");
            return null;
        }
        logger.debug({ ...cleanContext, event: 'dom_clean_success' });

        // Traverse Nodes & Save Text
        const traverseContext = { ...linkLogContext, url: finalLink };
        logger.debug({ ...traverseContext, event: 'node_traverse_start' });
        let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, year);
        fullText = removeExtraEmptyLines(fullText);
        logger.debug({ ...traverseContext, textLength: fullText.length, event: 'node_traverse_success' });

        const safeAcronym = conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const textPath = await writeTempFile(fullText, `${safeAcronym}_${linkIndex}_initial`);
        logger.debug({ ...traverseContext, filePath: textPath, event: 'initial_text_saved' });

        // Acronym handling
        const acronym_index = `${conference.Acronym}_${linkIndex}`;
        const adjustedAcronym = await addAcronymSafely(existingAcronyms, acronym_index);
        let acronym_no_index = adjustedAcronym.replace(/_\d+$/, '');

        // Create Batch Entry
        const batchEntry: BatchEntry = {
            conferenceTitle: conference.Title,
            conferenceAcronym: acronym_no_index,
            conferenceIndex: String(linkIndex),
            conferenceLink: finalLink,
            conferenceTextPath: textPath,
            cfpLink: "", impLink: "", // To be filled later
            // Other paths will be filled later
        };

        logger.info({ ...linkLogContext, finalUrl: finalLink, textPath, adjustedAcronym, event: 'processing_success' });
        return batchEntry;

    } catch (error: unknown) {
        logger.error({ ...linkLogContext, url: link, err: error, event: 'processing_unhandled_error' }, "Unhandled error processing link");
        // Log error to separate file if needed
        // const timestamp = new Date().toISOString(); ... log file phụ ...
        return null; // Indicate failure for this link
    }
    // No finally block needed here as page is managed by the caller (`saveHTMLContent`)
}


// --- Main Orchestration Functions ---

// SAVE Stream
/**
 * Crawls initial links for a conference, processes them, and queues batch processing.
 * Manages a single Playwright page for efficiency.
 */
export const saveHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceData,
    links: string[],
    batchIndexRef: { current: number },
    existingAcronyms: Set<string>,
    batchPromises: Promise<boolean>[], // Array to hold promises from saveBatchToFile
    year: number,
    parentLogger: Logger
): Promise<boolean> => {
    const baseLogContext: BatchProcessingLogContext = {
        batchIndex: batchIndexRef.current, // Use current index for context
        conferenceAcronym: conference.Acronym,
        conferenceTitle: conference.Title,
        function: 'saveHTMLContent'
    };
    const taskLogger = parentLogger.child(baseLogContext);
    taskLogger.info({ linkCount: links.length, event: 'start' });

    if (!links || links.length === 0) {
        taskLogger.warn({ event: 'skipped_no_links' }, "Called with empty links array.");
        return false; // Nothing to process
    }

    let page: Page | null = null;
    const batch: BatchEntry[] = [];
    let finalAdjustedAcronym = ""; // To store the last adjusted acronym for the batch call
    let linkProcessingSuccessCount = 0;
    let linkProcessingFailedCount = 0;

    try {
        // *** Create ONE page for all links in this conference ***
        page = await browserContext.newPage();
        taskLogger.info({ event: 'page_created' });

        for (let i = 0; i < links.length; i++) {
            const link = links[i];
            try {
                const batchEntry = await _processSingleLink(
                    page, link, i, conference, year, existingAcronyms, taskLogger, baseLogContext
                );

                if (batchEntry) {
                    batch.push(batchEntry);
                    finalAdjustedAcronym = `${batchEntry.conferenceAcronym}_${batchEntry.conferenceIndex}`; // Update with last successful adjusted acronym
                    linkProcessingSuccessCount++;
                } else {
                    linkProcessingFailedCount++;
                }
            } catch (linkError: unknown) {
                // Catch errors specifically from _processSingleLink if it throws unexpectedly
                linkProcessingFailedCount++;
                taskLogger.error({ link, linkIndex: i, err: linkError, event: 'link_processing_unexpected_error' }, "Unexpected error during single link processing");
            }
        } // End for loop links

        // --- Create Batch Task if any links succeeded ---
        if (batch.length > 0) {
            const currentBatchIndex = batchIndexRef.current;
            batchIndexRef.current++; // Increment for the next conference/batch
            taskLogger.info({
                batchIndex: currentBatchIndex,
                entries: batch.length,
                successCount: linkProcessingSuccessCount,
                failedCount: linkProcessingFailedCount,
                event: 'batch_task_create'
            }, `Creating batch task`);

            // Call saveBatchToFile (which is async) and add its promise to the list
            const batchPromise = saveBatchToFile(batch, currentBatchIndex, finalAdjustedAcronym, browserContext, taskLogger);
            batchPromises.push(batchPromise);
            taskLogger.info({ batchIndex: currentBatchIndex, event: 'batch_task_queued' });
        } else {
            taskLogger.warn({
                successCount: linkProcessingSuccessCount,
                failedCount: linkProcessingFailedCount,
                event: 'batch_creation_skipped_empty'
            }, "Batch is empty after processing all links. No batch task created.");
        }

        taskLogger.info({ event: 'finish_success' }, "Finishing saveHTMLContent");
        return true; // Indicate that the orchestration function itself completed

    } catch (error: unknown) {
        taskLogger.error({ err: error, event: 'finish_unhandled_error' }, "Unhandled error in saveHTMLContent");
        return false; // Indicate failure
    } finally {
        // *** Close the single page used for this conference ***
        if (page && !page.isClosed()) {
            taskLogger.debug({ event: 'page_closing' });
            await page.close().catch(err => taskLogger.error({ err: err, event: 'page_close_failed' }, "Error closing page"));
        }
    }
};

/**
 * Saves a batch by determining the main link, calling APIs, and appending the final record.
 */
export const saveBatchToFile = async (
    batch: BatchEntry[],
    batchIndex: number,
    adjustedAcronym: string, // Keep if needed for identifiers, otherwise remove
    browserContext: BrowserContext,
    parentLogger: Logger
): Promise<boolean> => {
    // Use the first entry for primary context, ensure it exists
    if (!batch || batch.length === 0 || !batch[0]?.conferenceAcronym || !batch[0]?.conferenceTitle) {
        parentLogger.warn({ batchIndex, function: 'saveBatchToFile', event: 'invalid_input' }, "Called with invalid or empty batch. Skipping.");
        return false;
    }
    const primaryEntry = batch[0];
    const baseLogContext: BatchProcessingLogContext = {
        batchIndex,
        conferenceAcronym: primaryEntry.conferenceAcronym,
        conferenceTitle: primaryEntry.conferenceTitle,
        function: 'saveBatchToFile'
    };
    const taskLogger = parentLogger.child(baseLogContext);
    taskLogger.info({ event: 'start', entryCount: batch.length }, "Starting saveBatchToFile");

    try {

        const safeConferenceAcronym = primaryEntry.conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');

        // 1. Ensure Directories
        await ensureDirectories([BATCHES_DIR, FINAL_OUTPUT_PATH], taskLogger, baseLogContext);

        // 2. Aggregate Content for determine_links_api
        taskLogger.debug({ event: 'aggregate_content_start', purpose: 'determine_api' });
        let batchContentParts: string[] = [];
        const readPromises = batch.map(async (entry, i) => {
            try {
                const text = await readContentFromFile(entry.conferenceTextPath);
                // Use entry's own acronym/index for clarity within the aggregated text
                const linkIdentifier = `${entry.conferenceAcronym}_${entry.conferenceIndex}`;
                const formattedText = `Website of ${linkIdentifier}: ${entry.conferenceLink}\nWebsite information of ${linkIdentifier}:\n\n${text.trim()}`;
                return { index: i, content: `${i + 1}. ${formattedText}\n\n` };
            } catch (readError: unknown) {
                taskLogger.error({ ...baseLogContext, err: readError, filePath: entry.conferenceTextPath, entryIndex: i, event: 'read_content_failed', aggregationPurpose: 'determine_api' });
                return { index: i, content: `${i + 1}. ERROR READING CONTENT for ${entry.conferenceLink}\n\n` };
            }
        });
        const readResults = await Promise.all(readPromises);
        readResults.sort((a, b) => a.index - b.index);
        batchContentParts = readResults.map(r => r.content);
        const batchContentForDetermine = `Conference full name: ${primaryEntry.conferenceTitle} (${primaryEntry.conferenceAcronym})\n\n` + batchContentParts.join("");
        taskLogger.debug({ charCount: batchContentForDetermine.length, event: 'aggregate_content_end', purpose: 'determine_api' });

        // Write intermediate _full_links.txt (async, non-critical)
        const fileFullLinksName = `${safeConferenceAcronym}_full_links.txt`;
        const fileFullLinksPath = path.join(BATCHES_DIR, fileFullLinksName);
        const writeFullLinksPromise = fs.promises.writeFile(fileFullLinksPath, batchContentForDetermine, "utf8")
            .then(() => taskLogger.debug({ filePath: fileFullLinksPath, fileType: 'full_links', event: 'write_intermediate_success' }))
            .catch(writeError => taskLogger.error({ filePath: fileFullLinksPath, fileType: 'full_links', err: writeError, event: 'write_intermediate_failed' }));

        // 3. Call determine_links_api
        let determineLinksResponse: ApiResponse;
        let determineResponseTextPath: string | undefined;
        const determineApiContext = { ...baseLogContext, apiType: 'determine' };
        try {
            taskLogger.info({ ...determineApiContext, inputLength: batchContentForDetermine.length, event: 'api_call_start' });
            determineLinksResponse = await determine_links_api(batchContentForDetermine, batchIndex, primaryEntry.conferenceTitle, primaryEntry.conferenceAcronym, taskLogger);
            const determineResponseText = determineLinksResponse.responseText || "";
            determineResponseTextPath = await writeTempFile(determineResponseText, `${safeConferenceAcronym}_determine_response_${batchIndex}`);
            // Store response path and metadata on the primary entry (will be used later)
            primaryEntry.determineResponseTextPath = determineResponseTextPath;
            primaryEntry.determineMetaData = determineLinksResponse.metaData;
            taskLogger.info({ ...determineApiContext, responseLength: determineResponseText.length, filePath: determineResponseTextPath, event: 'api_call_end', success: true });
        } catch (determineLinksError: unknown) {
            taskLogger.error({ ...determineApiContext, err: determineLinksError, event: 'api_call_failed' }, "Error calling determine_links_api");
            await writeFullLinksPromise; // Wait for non-critical write before throwing
            throw determineLinksError; // Re-throw critical error
        }

        // 4. Process determine_links_api response
        const processDetermineContext = { ...baseLogContext, event_group: 'process_determine' };
        taskLogger.info({ ...processDetermineContext, responseLength: determineLinksResponse.responseText?.length ?? 0, event: 'start' });
        let mainLinkBatchResult: BatchEntry[] | null = null;
        try {
            // Pass the logger down
            mainLinkBatchResult = await processDetermineLinksResponse(
                determineLinksResponse.responseText || "", batch, batchIndex, browserContext, YEAR2, 1, taskLogger
            );
        } catch (processError: unknown) {
            taskLogger.error({ ...processDetermineContext, err: processError, event: 'call_failed' }, "Error calling processDetermineLinksResponse");
            throw processError; // Re-throw critical error
        }

        // Validate the result from processDetermineLinksResponse
        if (!mainLinkBatchResult || mainLinkBatchResult.length === 0 || !mainLinkBatchResult[0] || mainLinkBatchResult[0].conferenceLink === "None" || !mainLinkBatchResult[0].conferenceTextPath) {
            taskLogger.error({ ...processDetermineContext, mainLinkResult: mainLinkBatchResult?.[0]?.conferenceLink, mainTextPath: mainLinkBatchResult?.[0]?.conferenceTextPath, event: 'invalid_result' }, "Main link/text path is invalid after processing determine response.");
            await writeFullLinksPromise;
            return false; // Indicate failure for this batch
        }
        const mainEntry = mainLinkBatchResult[0]; // This entry now holds the correct paths/links
        taskLogger.info({ ...processDetermineContext, finalMainLink: mainEntry.conferenceLink, event: 'success' });

        // 5. Read Content Files based on determined links
        const readContentContext = { ...baseLogContext, event_group: 'read_determined_content' };
        taskLogger.debug({ ...readContentContext, event: 'start' });
        const content = await readBatchContentFiles(mainEntry, taskLogger, readContentContext);
        taskLogger.debug({ ...readContentContext, event: 'end' });

        // 6. Aggregate Content for Extract/CFP APIs
        const aggregateContext = { ...baseLogContext, event_group: 'aggregate_for_extract_cfp' };
        const contentSendToAPI = aggregateContentForApi(mainEntry.conferenceTitle, mainEntry.conferenceAcronym, content, taskLogger, aggregateContext);

        // Write intermediate _main_link.txt (async, non-critical)
        const fileMainLinkName = `${safeConferenceAcronym}_main_link.txt`;
        const fileMainLinkPath = path.join(BATCHES_DIR, fileMainLinkName);
        const fileMainLinkPromise = fs.promises.writeFile(fileMainLinkPath, contentSendToAPI, "utf8")
            .then(() => taskLogger.debug({ filePath: fileMainLinkPath, fileType: 'main_link', event: 'write_intermediate_success' }))
            .catch(writeError => taskLogger.error({ filePath: fileMainLinkPath, fileType: 'main_link', err: writeError, event: 'write_intermediate_failed' }));

        // 7. Execute Parallel Extract/CFP APIs
        const apiResults = await executeParallelExtractCfpApis(
            contentSendToAPI, batchIndex, mainEntry.conferenceTitle, mainEntry.conferenceAcronym, safeConferenceAcronym, false, taskLogger, baseLogContext
        );

        // Wait for non-critical intermediate writes
        await Promise.allSettled([writeFullLinksPromise, fileMainLinkPromise]);
        taskLogger.debug({ event: 'intermediate_writes_settled' });

        // 8. Prepare and Append Final Record
        const finalRecord: BatchEntry = {
            // Copy all relevant fields from the mainEntry determined by processDetermineLinksResponse
            ...mainEntry,
            // Add results from the parallel API calls
            extractResponseTextPath: apiResults.extractResponseTextPath,
            extractMetaData: apiResults.extractMetaData,
            cfpResponseTextPath: apiResults.cfpResponseTextPath,
            cfpMetaData: apiResults.cfpMetaData,
        };
        await appendFinalRecord(finalRecord, FINAL_OUTPUT_PATH, taskLogger, baseLogContext);

        taskLogger.info({ event: 'finish_success' }, "Finishing saveBatchToFile successfully");
        return true; // Indicate success

    } catch (error: unknown) {
        // Log errors thrown from helpers or API calls
        taskLogger.error({ err: error, event: 'finish_failed' }, "Error occurred during saveBatchToFile execution");
        // Decide whether to re-throw or return false based on desired behavior
        // throw error; // Option 1: Propagate error up
        return false; // Option 2: Indicate failure without stopping caller immediately
    }
};