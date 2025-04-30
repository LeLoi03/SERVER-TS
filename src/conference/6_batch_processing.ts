
// playwright_utils.ts
import { addAcronymSafely, logger } from './11_utils';
import fs from 'fs';
import { Page, BrowserContext } from 'playwright'; // Import Playwright types

import { cleanDOM, traverseNodes, removeExtraEmptyLines } from './2_dom_processing';
import { extract_information_api, cfp_extraction_api, determine_links_api } from './7_gemini_api_utils';
import { init } from './8_data_manager';
import { YEAR2, API_TYPE_CFP, API_TYPE_EXTRACT } from '../config';

import { BatchEntry, BatchUpdateEntry, ConferenceData, ConferenceUpdateData, type ApiResponse } from './types';
import path from 'path';

const ERROR_ACCESS_LINK_LOG_PATH: string = path.join(__dirname, "./data/error_access_link_log.txt");

import { readContentFromFile, writeTempFile } from './11_utils';
import { processDetermineLinksResponse, fetchContentWithRetry, saveHTMLFromCallForPapers, saveHTMLFromImportantDates } from './5_playwright_utils';


const BATCHES_DIR = path.join(__dirname, "./data/batches");
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');


// --- saveBatchToFile (Modified for Parallel API Calls) ---
export const saveBatchToFile = async (
    batch: BatchEntry[],
    batchIndex: number,
    adjustedAcronym: string, // Still used for some identifiers if needed
    browserContext: BrowserContext,
    parentLogger: typeof logger
): Promise<boolean> => {
    const baseLogContext = { batchIndex, function: 'saveBatchToFile' };
    parentLogger.info({ ...baseLogContext, event: 'save_batch_start', entryCount: batch.length }, "Starting saveBatchToFile");

    let conferenceAcronym = 'unknown';
    let conferenceTitle = 'unknown';
    let safeConferenceAcronym = 'unknown';

    try {
        await init();

        if (!batch || batch.length === 0 || !batch[0]?.conferenceAcronym || !batch[0]?.conferenceTitle) {
            parentLogger.warn({ ...baseLogContext, event: 'save_batch_invalid_input' }, "Called with invalid or empty batch. Skipping.");
            return false;
        }

        conferenceAcronym = batch[0].conferenceAcronym;
        conferenceTitle = batch[0].conferenceTitle;
        safeConferenceAcronym = conferenceAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const logContext = { ...baseLogContext, conferenceAcronym, conferenceTitle };

        // --- Directory setup (remains the same) ---
        try {
            if (!fs.existsSync(BATCHES_DIR)) {
                parentLogger.info({ ...logContext, path: BATCHES_DIR, event: 'save_batch_dir_create' }, "Creating batches directory");
                fs.mkdirSync(BATCHES_DIR, { recursive: true });
            }
            const finalOutputDir = path.dirname(FINAL_OUTPUT_PATH);
            if (!fs.existsSync(finalOutputDir)) {
                 parentLogger.info({ ...logContext, path: finalOutputDir, event: 'save_batch_final_dir_create' }, "Creating final output directory");
                 fs.mkdirSync(finalOutputDir, { recursive: true });
            }
        } catch (mkdirError: any) {
            parentLogger.error({ ...logContext, err: mkdirError, event: 'save_batch_dir_create_failed' }, "Error creating necessary directories");
            throw mkdirError;
        }
        // --- End Directory Setup ---

        const fileFullLinksName = `${safeConferenceAcronym}_full_links.txt`;
        const fileFullLinksPath = path.join(BATCHES_DIR, fileFullLinksName);
        const fileMainLinkName = `${safeConferenceAcronym}_main_link.txt`;
        const fileMainLinkPath = path.join(BATCHES_DIR, fileMainLinkName);

        // --- Aggregation 1 (for determine_links_api) ---
        // (Remains the same as before)
        parentLogger.debug({ ...logContext, event: 'save_batch_aggregate_content_start', purpose: 'determine_api' }, "Aggregating content for full_links file / determine_api");
        let batchContentParts: string[] = [];
        const readPromises = batch.map(async (entry, i) => {
            try {
                const text = await readContentFromFile(entry.conferenceTextPath);
                const linkIdentifier = adjustedAcronym || `${entry.conferenceAcronym}_${entry.conferenceIndex}`; // Use adjustedAcronym if available
                const formattedText = `Website of ${linkIdentifier}: ${entry.conferenceLink}\nWebsite information of ${linkIdentifier}:\n\n${text.trim()}`;
                return { index: i, content: `${i + 1}. ${formattedText}\n\n` };
            } catch (readError: any) {
                parentLogger.error({ ...logContext, err: readError, filePath: entry.conferenceTextPath, entryIndex: i, event: 'save_batch_read_content_failed', aggregationPurpose: 'determine_api' }, "Error reading content file for batch aggregation");
                return { index: i, content: `${i + 1}. ERROR READING CONTENT for ${entry.conferenceLink}\n\n` };
            }
        });
        const readResults = await Promise.all(readPromises);
        readResults.sort((a, b) => a.index - b.index);
        batchContentParts = readResults.map(r => r.content);
        const batchContentForDetermine = `Conference full name: ${conferenceTitle} (${conferenceAcronym})\n\n` + batchContentParts.join("");
        parentLogger.debug({ ...logContext, charCount: batchContentForDetermine.length, event: 'save_batch_aggregate_content_end', purpose: 'determine_api' }, "Finished aggregating content for determine_api");
        // --- End Aggregation 1 ---

        // Ghi file _full_links.txt (async)
        const writeFullLinksContext = { ...logContext, filePath: fileFullLinksPath, fileType: 'full_links' };
        parentLogger.debug({ ...writeFullLinksContext, event: 'save_batch_write_file_start' }, "Writing full links content (async)");
        const fileFullLinksPromise = fs.promises.writeFile(fileFullLinksPath, batchContentForDetermine, "utf8")
             .then(() => parentLogger.debug({ ...writeFullLinksContext, event: 'save_batch_write_file_success' }, "Successfully wrote full links file"))
             .catch(writeError => parentLogger.error({ ...writeFullLinksContext, err: writeError, event: 'save_batch_write_file_failed' }, "Error writing full_links file (non-critical)"));

        // --- Gọi determine_links_api ---
        // (Remains the same as before - updates batch[0])
        let determineLinksResponse: ApiResponse; // Use ApiResponse type
        let determineResponseTextPath: string | undefined;
        const determineApiContext = { ...logContext, apiType: 'determine' };
        try {
            parentLogger.info({ ...determineApiContext, inputLength: batchContentForDetermine.length, event: 'save_batch_determine_api_start' }, "Calling determine_links_api");
            determineLinksResponse = await determine_links_api(batchContentForDetermine, batchIndex, conferenceTitle, conferenceAcronym, parentLogger);
            const determineResponseText = determineLinksResponse.responseText || "";
            determineResponseTextPath = await writeTempFile(determineResponseText, `${safeConferenceAcronym}_determine_response_${batchIndex}`);
             batch[0].determineResponseTextPath = determineResponseTextPath;
             batch[0].determineMetaData = determineLinksResponse.metaData;
            parentLogger.info({ ...determineApiContext, responseLength: determineResponseText.length, filePath: determineResponseTextPath, event: 'save_batch_determine_api_end', success: true }, "determine_links_api call successful, response saved");
        } catch (determineLinksError: any) {
            parentLogger.error({ ...determineApiContext, err: determineLinksError, event: 'save_batch_determine_api_call_failed' }, "Error calling determine_links_api");
            await fileFullLinksPromise;
            throw determineLinksError;
        }

        let determineResponseFromFile = '';
        try {
            determineResponseFromFile = await readContentFromFile(determineResponseTextPath);
        } catch (readErr: any) {
            parentLogger.error({ ...logContext, err: readErr, filePath: determineResponseTextPath, event: 'save_batch_read_determine_failed' }, "Error reading determine response file");
            await fileFullLinksPromise;
            throw readErr;
        }
        // --- Hết determine_links_api ---

        // --- Xử lý kết quả determine_links_api ---
        // (Remains the same as before - returns updated mainLinkBatch)
        const processDetermineContext = { ...logContext, event_group: 'process_determine_in_save_batch' };
        parentLogger.info({ ...processDetermineContext, responseLength: determineResponseFromFile.length, event: 'save_batch_process_determine_start' }, "Processing determine_links_api response");
        let mainLinkBatch: BatchEntry[] | null = null;
        try {
            mainLinkBatch = await processDetermineLinksResponse(
                determineResponseFromFile, batch, batchIndex, browserContext, YEAR2, 1, parentLogger
            );
        } catch (processError: any) {
            parentLogger.error({ ...processDetermineContext, err: processError, event: 'save_batch_process_determine_call_failed' }, "Error calling processDetermineLinksResponse");
             throw processError;
        }
        if (!mainLinkBatch || mainLinkBatch.length === 0 || !mainLinkBatch[0] || mainLinkBatch[0].conferenceLink === "None" || !mainLinkBatch[0].conferenceTextPath) {
            parentLogger.error({ ...processDetermineContext, mainLinkResult: mainLinkBatch?.[0]?.conferenceLink, mainTextPath: mainLinkBatch?.[0]?.conferenceTextPath, event: 'save_batch_process_determine_failed_invalid' }, "Main link/text path is invalid after processing determine response.");
            await fileFullLinksPromise;
            return false;
           }
        const foundMainLink = mainLinkBatch[0].conferenceLink;
        parentLogger.info({ ...processDetermineContext, finalMainLink: foundMainLink, event: 'save_batch_process_determine_success' }, "Successfully processed determine_links_api response");
        // --- Hết xử lý determine ---

        // --- Aggregation 2 (for extract & cfp apis) ---
        // (Remains the same as before)
        const aggregateExtractContext = { ...logContext, event_group: 'aggregate_for_extract_cfp' };
        parentLogger.debug({ ...aggregateExtractContext, event: 'save_batch_aggregate_extract_cfp_start' }, "Aggregating content for extract & cfp apis");
        let mainText = '', cfpText = '', impText = '';
        const mainEntry = mainLinkBatch[0]; // Should be the entry with all paths

        try { mainText = await readContentFromFile(mainEntry.conferenceTextPath); }
        catch (e: any) { parentLogger.warn({ ...aggregateExtractContext, err: e, filePath: mainEntry.conferenceTextPath, contentType: 'main', event: 'save_batch_aggregate_read_failed' }, "Could not read main text file"); }
        if (mainEntry.cfpTextPath) {
            try { cfpText = await readContentFromFile(mainEntry.cfpTextPath); }
            catch (e: any) { parentLogger.warn({ ...aggregateExtractContext, err: e, filePath: mainEntry.cfpTextPath, contentType: 'cfp', event: 'save_batch_aggregate_read_failed' }, "Could not read CFP text file"); }
        }
        if (mainEntry.impTextPath) {
            try { impText = await readContentFromFile(mainEntry.impTextPath); }
            catch (e: any) { parentLogger.warn({ ...aggregateExtractContext, err: e, filePath: mainEntry.impTextPath, contentType: 'imp', event: 'save_batch_aggregate_read_failed' }, "Could not read IMP text file"); }
        }

        const impContent = impText ? ` \n\nImportant Dates information:\n${impText.trim()}` : "";
        const cfpContentAggregated = cfpText ? ` \n\nCall for Papers information:\n${cfpText.trim()}` : ""; // Renamed for clarity
        const contentSendToAPI = `Conference ${mainEntry.conferenceTitle} (${mainEntry.conferenceAcronym}):\n\n${mainText.trim()}${cfpContentAggregated}${impContent}`;
        const titleForApis = mainEntry.conferenceTitle; // Use consistent title
        const acronymForApis = mainEntry.conferenceAcronym; // Use consistent acronym
        parentLogger.debug({ ...aggregateExtractContext, charCount: contentSendToAPI.length, event: 'save_batch_aggregate_extract_cfp_end' }, "Finished aggregating content for extract & cfp apis");
        // --- End Aggregation 2 ---

        // Ghi file _main_link.txt (async - content used by both APIs)
        const writeMainLinkContext = { ...logContext, filePath: fileMainLinkPath, fileType: 'main_link' };
        parentLogger.debug({ ...writeMainLinkContext, event: 'save_batch_write_file_start' }, "Writing main link aggregated content (async)");
        const fileMainLinkPromise = fs.promises.writeFile(fileMainLinkPath, contentSendToAPI, "utf8")
             .then(() => parentLogger.debug({ ...writeMainLinkContext, event: 'save_batch_write_file_success' }, "Successfully wrote main link file"))
             .catch(writeError => parentLogger.error({ ...writeMainLinkContext, err: writeError, event: 'save_batch_write_file_failed' }, "Error writing main_link file (non-critical)"));


        // --- *** PARALLEL API CALLS (EXTRACT & CFP) *** ---
        let extractResponseTextPath: string | undefined;
        let extractMetaData: any | null = null;
        let cfpResponseTextPath: string | undefined;
        let cfpMetaData: any | null = null;

        const extractApiContext = { ...logContext, apiType: API_TYPE_EXTRACT, title: titleForApis, acronym: acronymForApis };
        const cfpApiContext = { ...logContext, apiType: API_TYPE_CFP, title: titleForApis, acronym: acronymForApis };

        parentLogger.info({ ...logContext, event: 'save_batch_parallel_apis_start' }, "Starting parallel calls to extract_information_api and cfp_extraction_api");

        // Define promises for each API call
        const extractPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
            parentLogger.info({ ...extractApiContext, inputLength: contentSendToAPI.length, event: 'save_batch_extract_api_start' }, "Calling extract_information_api");
            const response = await extract_information_api(contentSendToAPI, batchIndex, titleForApis, acronymForApis, parentLogger);
            const responseText = response.responseText || "";
            const path = await writeTempFile(responseText, `${safeConferenceAcronym}_extract_response_${batchIndex}`);
            parentLogger.info({ ...extractApiContext, responseLength: responseText.length, filePath: path, event: 'save_batch_extract_api_end', success: true }, "extract_information_api call successful, response saved");
            return { responseTextPath: path, metaData: response.metaData };
        })();

        const cfpPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
            parentLogger.info({ ...cfpApiContext, inputLength: contentSendToAPI.length, event: 'save_batch_cfp_api_start' }, "Calling cfp_extraction_api");
            const response = await cfp_extraction_api(contentSendToAPI, batchIndex, titleForApis, acronymForApis, parentLogger);
            const responseText = response.responseText || "";
            const path = await writeTempFile(responseText, `${safeConferenceAcronym}_cfp_response_${batchIndex}`); // Distinct filename
            parentLogger.info({ ...cfpApiContext, responseLength: responseText.length, filePath: path, event: 'save_batch_cfp_api_end', success: true }, "cfp_extraction_api call successful, response saved");
            return { responseTextPath: path, metaData: response.metaData };
        })();

        // Wait for both promises to settle
        const results = await Promise.allSettled([extractPromise, cfpPromise]);
        parentLogger.info({ ...logContext, event: 'save_batch_parallel_apis_settled' }, "Parallel API calls settled");

        // Process results
        if (results[0].status === 'fulfilled') {
            extractResponseTextPath = results[0].value.responseTextPath;
            extractMetaData = results[0].value.metaData;
            parentLogger.debug({ ...extractApiContext, event: 'save_batch_extract_api_result_processed' }, "Processed extract_information_api result");
        } else {
            parentLogger.error({ ...extractApiContext, err: results[0].reason, event: 'save_batch_extract_api_call_failed' }, "Error calling extract_information_api (parallel)");
            // Set defaults or handle error as needed (e.g., throw if critical)
            extractResponseTextPath = undefined;
            extractMetaData = null;
        }

        if (results[1].status === 'fulfilled') {
            cfpResponseTextPath = results[1].value.responseTextPath;
            cfpMetaData = results[1].value.metaData;
            parentLogger.debug({ ...cfpApiContext, event: 'save_batch_cfp_api_result_processed' }, "Processed cfp_extraction_api result");
        } else {
            parentLogger.error({ ...cfpApiContext, err: results[1].reason, event: 'save_batch_cfp_api_call_failed' }, "Error calling cfp_extraction_api (parallel)");
            // Set defaults or handle error as needed
            cfpResponseTextPath = undefined;
            cfpMetaData = null;
        }

        // Optionally, check if *both* failed and throw an error if that's unacceptable
        if (results[0].status === 'rejected' && results[1].status === 'rejected') {
             parentLogger.error({ ...logContext, event: 'save_batch_parallel_apis_both_failed' }, "Both extract and cfp API calls failed.");
             // Decide whether to throw or continue with empty data
             // throw new Error("Both extract and cfp API calls failed.");
        }
        // --- *** END PARALLEL API CALLS *** ---


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
            // *** UPDATE finalRecord to include CFP results ***
            const finalRecord: BatchEntry = {
                conferenceTitle: mainEntry.conferenceTitle,
                conferenceAcronym: mainEntry.conferenceAcronym,
                conferenceIndex: mainEntry.conferenceIndex,
                conferenceLink: mainEntry.conferenceLink,
                cfpLink: mainEntry.cfpLink || "",
                impLink: mainEntry.impLink || "",
                conferenceTextPath: mainEntry.conferenceTextPath,
                cfpTextPath: mainEntry.cfpTextPath,
                impTextPath: mainEntry.impTextPath,
                determineResponseTextPath: mainEntry.determineResponseTextPath, // Already set from batch[0] earlier
                extractResponseTextPath: extractResponseTextPath, // From parallel call result
                extractMetaData: extractMetaData,               // From parallel call result
                cfpResponseTextPath: cfpResponseTextPath,     // <<< NEW: From parallel call result
                cfpMetaData: cfpMetaData,                 // <<< NEW: From parallel call result
            };

            const dataToWrite = JSON.stringify(finalRecord) + '\n';

            parentLogger.info({ ...finalAppendContext, recordAcronym: finalRecord.conferenceAcronym, event: 'save_batch_append_start' }, "Appending final result to output file");
            await fs.promises.appendFile(FINAL_OUTPUT_PATH, dataToWrite, 'utf8');
            parentLogger.info({ ...finalAppendContext, recordAcronym: finalRecord.conferenceAcronym, event: 'save_batch_append_success' }, "Successfully appended final result");

        } catch (appendError: any) {
            parentLogger.error({ ...finalAppendContext, err: appendError, event: 'save_batch_append_failed' }, "CRITICAL: Failed to append final result to output file");
            throw appendError;
        }
        // --- Hết ghi bản ghi cuối cùng ---

        parentLogger.info({ ...logContext, event: 'save_batch_finish_success' }, "Finishing saveBatchToFile successfully");
        return true; // Indicate success

    } catch (error: any) {
        parentLogger.error({ ...baseLogContext, conferenceAcronym, err: error, event: 'save_batch_unhandled_error_or_rethrown' }, "Error occurred during saveBatchToFile execution");
        throw error; // Re-throw error to ensure the calling promise rejects
    }
};


// --- saveHTMLContent ---
export const saveHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceData,
    links: string[],
    batchIndexRef: { current: number },
    existingAcronyms: Set<string>,
    batchPromises: Promise<boolean>[],
    year: number,
    parentLogger: typeof logger
): Promise<boolean> => {
    // Context kế thừa từ taskLogger của crawlConferences, thêm function name
    const baseLogContext = { conferenceAcronym: conference.Acronym, conferenceTitle: conference.Title, function: 'saveHTMLContent' };
    parentLogger.info({ ...baseLogContext, linkCount: links.length, event: 'save_html_start' }, "Starting saveHTMLContent");

    try {
        const batch: BatchEntry[] = [];
        if (!links || links.length === 0) {
            parentLogger.error({ ...baseLogContext, event: 'save_html_skipped_no_links' }, "Called with empty or null links array, skipping.");
            parentLogger.info({ ...baseLogContext, event: 'save_html_finish' }, "Finishing saveHTMLContent (no links)"); // Log kết thúc
            return false;
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
        return true;

    } catch (error: any) {
        parentLogger.error({ ...baseLogContext, err: error, event: 'save_html_unhandled_error' }, "Unhandled error in saveHTMLContent main try block");
        // Không re-throw để không làm dừng toàn bộ crawlConferences nếu không cần thiết
        parentLogger.info({ ...baseLogContext, event: 'save_html_finish_failed' }, "Finishing saveHTMLContent due to unhandled error");
        return false;
    }
};


// --- Revised updateHTMLContent ---
export const updateHTMLContent = async (
    browserContext: BrowserContext,
    conference: ConferenceUpdateData,
    batchIndexRef: { current: number },
    parentLogger: typeof logger
): Promise<boolean> => { // <<<--- Đổi kiểu trả về
    const taskLogger = parentLogger.child({ title: conference.Title, acronym: conference.Acronym, function: 'updateHTMLContent' });
    let page: Page | null = null;

    try {
        page = await browserContext.newPage();
        taskLogger.info({ event: 'update_start' }, `Starting updateHTMLContent`);

        let mainTextPath: string | undefined = undefined;
        let cfpTextPath: string | undefined | null = undefined;
        let impTextPath: string | undefined | null = undefined;
        let finalMainLinkUrl = conference.mainLink;

        // 1. Process Main Link (như cũ, nhưng return null nếu thất bại)
        const mainLink = conference.mainLink;
        if (!mainLink) {
            taskLogger.error({ event: 'update_missing_main_link' }, "Main link is missing.");
            return false; // <<<--- return null
        }
        try {
            // ... (logic goto, fetch, clean, traverse, writeTempFile như cũ) ...
             const response = await page.goto(mainLink, { waitUntil: "domcontentloaded", timeout: 25000 });
             finalMainLinkUrl = page.url();
             taskLogger.info({ originalLink: mainLink, finalLink: finalMainLinkUrl, status: response?.status(), event: 'update_main_nav_success' }, `Navigation to main link successful.`);
             const htmlContent = await fetchContentWithRetry(page);
             const document = cleanDOM(htmlContent);
             if (document && document.body) {
                 let fullText = traverseNodes(document.body as HTMLElement, conference.Acronym, YEAR2);
                 fullText = removeExtraEmptyLines(fullText);
                 if (fullText.trim()) {
                     mainTextPath = await writeTempFile(fullText.trim(), `${conference.Acronym}_main_update`);
                     taskLogger.info({ path: mainTextPath, event: 'update_main_content_saved' }, `Main content processed and saved.`);
                 } else { taskLogger.warn({ event: 'update_main_content_empty' }); }
             } else { taskLogger.warn({ link: finalMainLinkUrl, event: 'update_main_dom_invalid' }); }
        } catch (error: any) {
            // ... (log lỗi như cũ) ...
            taskLogger.error({ link: mainLink, finalUrl: finalMainLinkUrl, err: error, event: 'update_main_link_failed' }, `Error accessing/processing main link`);
            // Ghi log phụ nếu cần
             const timestamp = new Date().toISOString();
             const logMessage = `[${timestamp}] Error accessing/processing mainLink ${mainLink} (final: ${finalMainLinkUrl}): ${error.message} for ${conference.Acronym}\n`;
             await fs.promises.appendFile(ERROR_ACCESS_LINK_LOG_PATH, logMessage, 'utf8').catch(e => console.error("Failed to write error log:", e));
             // return null; // Có thể quyết định dừng hẳn ở đây nếu main link lỗi là nghiêm trọng
        }

        // Chỉ tiếp tục nếu có mainTextPath (như cũ)
        if (!mainTextPath) {
            taskLogger.error({ event: 'update_abort_no_main_text' }, `Skipping update as main content failed.`);
            return false; // <<<--- return null
        }

        // 2. Process CFP Link (như cũ)
        if (conference.cfpLink && conference.cfpLink.trim().toLowerCase() !== "none") {
            try {
                cfpTextPath = await saveHTMLFromCallForPapers(page, conference.cfpLink, conference.Acronym, YEAR2);
                 if (cfpTextPath) taskLogger.info({ path: cfpTextPath, event: 'update_cfp_success' });
                 else taskLogger.warn({ link: conference.cfpLink, event: 'update_cfp_failed_no_path' });
            } catch (cfpError: any) { taskLogger.error({ link: conference.cfpLink, err: cfpError, event: 'update_cfp_failed_exception' }); }
        } else { taskLogger.debug({ event: 'update_cfp_skipped' }); }


        // 3. Process IMP Link (như cũ)
        if (conference.impLink && conference.impLink.trim().toLowerCase() !== "none") {
             try {
                 impTextPath = await saveHTMLFromImportantDates(page, conference.impLink, conference.Acronym, YEAR2);
                 if (impTextPath) taskLogger.info({ path: impTextPath, event: 'update_imp_success' });
                 else taskLogger.warn({ link: conference.impLink, event: 'update_imp_failed_no_path' });
             } catch (impError: any) { taskLogger.error({ link: conference.impLink, err: impError, event: 'update_imp_failed_exception' }); }
         } else { taskLogger.debug({ event: 'update_imp_skipped' }); }

        // 4. Create Batch Entry (như cũ)
        const batchData: BatchUpdateEntry = {
            conferenceTitle: conference.Title,
            conferenceAcronym: conference.Acronym,
            conferenceTextPath: mainTextPath,
            cfpTextPath: cfpTextPath,
            impTextPath: impTextPath,
        };

        // 5. *** GỌI VÀ CHỜ updateBatchToFile ***
        const currentBatchIndex = batchIndexRef.current;
        batchIndexRef.current++;
        taskLogger.info({ batchIndex: currentBatchIndex, event: 'update_calling_batch_processor' }, `Calling updateBatchToFile`);

        // Gọi hàm updateBatchToFile và đợi kết quả (ProcessedResponseData | null)
        const batchResult = await updateBatchToFile(batchData, currentBatchIndex, parentLogger);

        taskLogger.info({ event: 'update_finish_success', hasResult: batchResult !== null }, `Finishing updateHTMLContent.`);
        return true; // <<<--- Trả về kết quả từ updateBatchToFile

    } catch (error: any) {
        taskLogger.error({ err: error, event: 'update_unhandled_error' }, "Unhandled error in updateHTMLContent");
        return false; // <<<--- Trả về null nếu có lỗi không mong muốn
    } finally {
        if (page && !page.isClosed()) {
            taskLogger.debug("Closing page instance.");
            await page.close().catch(err => taskLogger.error({ err: err, event: 'update_page_close_failed' }, "Error closing page"));
        }
    }
};


// --- updateBatchToFile (Modified for Parallel API Calls) ---
export const updateBatchToFile = async (
    batchInput: BatchUpdateEntry, // Assuming BatchUpdateEntry might now also need cfpResponseTextPath etc.
    batchIndex: number,
    parentLogger: typeof logger
): Promise<boolean> => {
    const baseLogContext = { batchIndex, function: 'updateBatchToFile' };
    let taskLogger = parentLogger.child(baseLogContext);

    try {
        await init(); // Initialize if needed

        if (!batchInput || !batchInput.conferenceAcronym || !batchInput.conferenceTitle || !batchInput.conferenceTextPath) {
            taskLogger.warn({ event: 'update_batch_invalid_input', batchInput }, "Called with invalid batch data. Skipping.");
            return false; // Return false for invalid input
        }

        // Update logger context with acronym/title
        taskLogger = parentLogger.child({ ...baseLogContext, acronym: batchInput.conferenceAcronym, title: batchInput.conferenceTitle });
        taskLogger.info({ event: 'update_batch_start' }, `Processing update batch`);

        // --- Directory setup (remains the same) ---
        try {
            if (!fs.existsSync(BATCHES_DIR)) fs.mkdirSync(BATCHES_DIR, { recursive: true });
            const finalOutputDir = path.dirname(FINAL_OUTPUT_PATH);
            if (!fs.existsSync(finalOutputDir)) fs.mkdirSync(finalOutputDir, { recursive: true });
        } catch (mkdirError: any) {
            taskLogger.error({ err: mkdirError, event: 'update_batch_dir_create_failed' }, "Error creating necessary directories");
            throw mkdirError; // Re-throw critical error
        }
        // --- End Directory Setup ---

        // --- Read content from files (remains the same) ---
        taskLogger.debug({ event: 'update_batch_read_start' }, "Reading content from temporary files");
        let mainText = '', cfpText = '', impText = '';
        try {
            mainText = await readContentFromFile(batchInput.conferenceTextPath);
            if (batchInput.cfpTextPath) cfpText = await readContentFromFile(batchInput.cfpTextPath).catch(e => { taskLogger.warn({ err: e, path: batchInput.cfpTextPath, type: 'cfp' }, "Non-critical: Could not read CFP"); return ""; });
            if (batchInput.impTextPath) impText = await readContentFromFile(batchInput.impTextPath).catch(e => { taskLogger.warn({ err: e, path: batchInput.impTextPath, type: 'imp' }, "Non-critical: Could not read IMP"); return ""; });
        } catch (e: any) {
            taskLogger.error({ err: e, path: batchInput.conferenceTextPath, type: 'main', event: 'update_batch_read_failed' }, "Failed to read main text file. Cannot proceed.");
            throw e; // Re-throw critical error
        }
        taskLogger.debug({ event: 'update_batch_read_end' }, "Finished reading content");
        // --- End Reading Content ---

        // --- Aggregate content for APIs (remains the same) ---
        const impContent = impText ? ` \n\nImportant Dates information:\n${impText.trim()}` : "";
        const cfpContentAggregated = cfpText ? ` \n\nCall for Papers information:\n${cfpText.trim()}` : "";
        const contentSendToAPI = `Conference ${batchInput.conferenceTitle} (${batchInput.conferenceAcronym}):\n\n${mainText.trim()}${cfpContentAggregated}${impContent}`;
        const titleForApis = batchInput.conferenceTitle;
        const acronymForApis = batchInput.conferenceAcronym;
        // --- End Aggregation ---

        // Ghi file trung gian (optional, async)
        const safeConferenceAcronym = acronymForApis.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const fileUpdateName = `${safeConferenceAcronym}_update_${batchIndex}.txt`; // Intermediate content file
        const fileUpdatePath = path.join(BATCHES_DIR, fileUpdateName);
        const fileUpdatePromise = fs.promises.writeFile(fileUpdatePath, contentSendToAPI, "utf8").catch(writeError => {
            taskLogger.error({ filePath: fileUpdatePath, err: writeError, event: 'update_batch_write_intermediate_failed' }, "Error writing intermediate update file (non-critical)");
        });


        // --- *** PARALLEL API CALLS (EXTRACT & CFP) FOR UPDATE *** ---
        let extractResponseTextPath: string | undefined;
        let extractMetaData: any | null = null;
        let cfpResponseTextPath: string | undefined;
        let cfpMetaData: any | null = null;

        const extractApiContext = { apiType: API_TYPE_EXTRACT, title: titleForApis, acronym: acronymForApis };
        const cfpApiContext = { apiType: API_TYPE_CFP, title: titleForApis, acronym: acronymForApis };

        taskLogger.info({ event: 'update_batch_parallel_apis_start' }, "Starting parallel calls to extract_information_api and cfp_extraction_api for update");

        // Define promises for each API call
        const extractPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
            taskLogger.info({ ...extractApiContext, inputLength: contentSendToAPI.length, event: 'update_batch_extract_api_start' }, "Calling extract_information_api");
            const response = await extract_information_api(contentSendToAPI, batchIndex, titleForApis, acronymForApis, taskLogger);
            const responseText = response.responseText || "";
            const path = await writeTempFile(responseText, `${safeConferenceAcronym}_extract_update_response_${batchIndex}`); // Distinct filename for update extract
            taskLogger.info({ ...extractApiContext, responseLength: responseText.length, filePath: path, event: 'update_batch_extract_api_end', success: true }, "extract_information_api call successful, response saved");
            return { responseTextPath: path, metaData: response.metaData };
        })();

        const cfpPromise = (async (): Promise<{ responseTextPath?: string; metaData: any | null }> => {
            taskLogger.info({ ...cfpApiContext, inputLength: contentSendToAPI.length, event: 'update_batch_cfp_api_start' }, "Calling cfp_extraction_api");
            const response = await cfp_extraction_api(contentSendToAPI, batchIndex, titleForApis, acronymForApis, taskLogger);
            const responseText = response.responseText || "";
            const path = await writeTempFile(responseText, `${safeConferenceAcronym}_cfp_update_response_${batchIndex}`); // Distinct filename for update cfp
            taskLogger.info({ ...cfpApiContext, responseLength: responseText.length, filePath: path, event: 'update_batch_cfp_api_end', success: true }, "cfp_extraction_api call successful, response saved");
            return { responseTextPath: path, metaData: response.metaData };
        })();

        // Wait for both promises to settle
        const results = await Promise.allSettled([extractPromise, cfpPromise]);
        taskLogger.info({ event: 'update_batch_parallel_apis_settled' }, "Parallel API calls settled for update");

        // Process results
        if (results[0].status === 'fulfilled') {
            extractResponseTextPath = results[0].value.responseTextPath;
            extractMetaData = results[0].value.metaData;
            taskLogger.debug({ ...extractApiContext, event: 'update_batch_extract_api_result_processed' }, "Processed extract_information_api result");
        } else {
            taskLogger.error({ ...extractApiContext, err: results[0].reason, event: 'update_batch_extract_api_call_failed' }, "Error calling extract_information_api (parallel)");
            extractResponseTextPath = undefined;
            extractMetaData = null;
        }

        if (results[1].status === 'fulfilled') {
            cfpResponseTextPath = results[1].value.responseTextPath;
            cfpMetaData = results[1].value.metaData;
            taskLogger.debug({ ...cfpApiContext, event: 'update_batch_cfp_api_result_processed' }, "Processed cfp_extraction_api result");
        } else {
            taskLogger.error({ ...cfpApiContext, err: results[1].reason, event: 'update_batch_cfp_api_call_failed' }, "Error calling cfp_extraction_api (parallel)");
            cfpResponseTextPath = undefined;
            cfpMetaData = null;
        }

        // Optionally handle if both failed
        if (results[0].status === 'rejected' && results[1].status === 'rejected') {
             taskLogger.error({ event: 'update_batch_parallel_apis_both_failed' }, "Both extract and cfp API calls failed during update.");
             // Decide if this constitutes a failure for the update process
             // throw new Error("Both extract and cfp API calls failed during update.");
        }
        // --- *** END PARALLEL API CALLS FOR UPDATE *** ---

        // Wait for intermediate file write if it hasn't finished
        await fileUpdatePromise;

        // --- Append Final Record ---
        const finalAppendContext = { outputPath: FINAL_OUTPUT_PATH };
        try {
            taskLogger.info({ ...finalAppendContext, event: 'update_batch_prepare_final_record' }, "Preparing final record for appending");

            // *** UPDATE finalRecord to include CFP results for update ***
            // Ensure the structure matches what final_output.jsonl expects for update records.
            // You might only need a subset of fields for updates. Adjust as needed.
            const finalRecord: BatchUpdateEntry = { // Use BatchUpdateEntry type or a specific update type
                // Core identifiers
                conferenceTitle: batchInput.conferenceTitle,
                conferenceAcronym: batchInput.conferenceAcronym,

                // Input paths (might be useful for reference)
                conferenceTextPath: batchInput.conferenceTextPath,
                cfpTextPath: batchInput.cfpTextPath,
                impTextPath: batchInput.impTextPath,

                // API Results
                extractResponseTextPath: extractResponseTextPath, // From parallel call result
                extractMetaData: extractMetaData,               // From parallel call result
                cfpResponseTextPath: cfpResponseTextPath,     // <<< NEW: From parallel call result
                cfpMetaData: cfpMetaData,                 // <<< NEW: From parallel call result

                // Include other fields from BatchUpdateEntry if necessary
                // conferenceIndex: batchInput.conferenceIndex, // If needed
                // conferenceLink: batchInput.conferenceLink,   // If needed
                // ... etc.
            };

            const dataToWrite = JSON.stringify(finalRecord) + '\n';
            taskLogger.info({ ...finalAppendContext, recordAcronym: finalRecord.conferenceAcronym, event: 'update_batch_append_start' }, "Appending final update result to output file");
            await fs.promises.appendFile(FINAL_OUTPUT_PATH, dataToWrite, 'utf8');
            taskLogger.info({ ...finalAppendContext, recordAcronym: finalRecord.conferenceAcronym, event: 'update_batch_append_success' }, "Successfully appended final update result");

        } catch (appendError: any) {
            taskLogger.error({ ...finalAppendContext, err: appendError, event: 'update_batch_append_final_failed' }, "CRITICAL: Failed to append final update result to output file");
            throw appendError; // Re-throw critical error
        }
        // --- End Appending Final Record ---

        taskLogger.info({ event: 'update_batch_finish_success' }, "Finishing updateBatchToFile successfully");
        return true; // Indicate success

    } catch (error: any) {
        // Catch errors re-thrown from previous steps
        const finalAcronym = batchInput?.conferenceAcronym || 'unknown'; // Safely get acronym for logging
        taskLogger.error({ err: error, finalAcronym, event: 'update_batch_unhandled_error_or_rethrown' }, "Error occurred during updateBatchToFile execution");
        // Re-throw the error so the calling promise rejects
        throw error;
        // Alternatively, if you want it to return false on error:
        // return false;
    }
};