import fs from 'fs';
import path from 'path';


import { searchGoogleCSE } from './1_google_search';
import { filterSearchResults } from './4_link_filtering';
import { saveHTMLContent, updateHTMLContent } from './6_playwright_utils';
import { setupPlaywright } from './12_playwright_setup';
import { writeCSVFile } from './10_response_processing';

// Import config chung
import {
    queuePromise, YEAR1, YEAR2, YEAR3, SEARCH_QUERY_TEMPLATE, MAX_LINKS, GOOGLE_CUSTOM_SEARCH_API_KEYS,
    GOOGLE_CSE_ID,
    MAX_USAGE_PER_KEY,
    KEY_ROTATION_DELAY_MS, UNWANTED_DOMAINS, SKIP_KEYWORDS
} from '../config';

import { logger } from './11_utils';

import { GoogleSearchResult, ConferenceData, BatchEntry, ConferenceUpdateData, ProcessedResponseData } from './types';
import { Browser } from 'playwright';

// --- Conference Specific ---
export const CONFERENCE_OUTPUT_PATH: string = path.join(__dirname, './data/conference_list.json');


// --- Biến quản lý trạng thái Key API ---
let currentKeyIndex: number = 0;
let currentKeyUsageCount: number = 0;
let totalGoogleApiRequests: number = 0;
let allKeysExhausted: boolean = false;

// --- Hàm trợ giúp để xoay key API NGAY LẬP TỨC ---
async function forceRotateApiKey(): Promise<boolean> {
    if (allKeysExhausted) {
        logger.warn("Cannot force rotate key, all keys are already marked as exhausted.");
        return false;
    }

    logger.warn({ oldKeyIndex: currentKeyIndex + 1 }, "Forcing rotation to next API key due to error (e.g., 429 or quota limit).");

    currentKeyIndex++;
    currentKeyUsageCount = 0;

    if (currentKeyIndex >= GOOGLE_CUSTOM_SEARCH_API_KEYS.length) {
        logger.warn("Forced rotation failed: Reached end of API key list. Marking all keys as exhausted.");
        allKeysExhausted = true;
        return false;
    }

    logger.info({ newKeyIndex: currentKeyIndex + 1 }, "Successfully forced rotation to new API key.");
    return true;
}


// --- Hàm trợ giúp để lấy API Key tiếp theo ---
async function getNextApiKey(): Promise<string | null> {
    if (allKeysExhausted || !GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
        if (!allKeysExhausted) {
            logger.warn("No Google API Keys configured or all keys have been exhausted. Cannot perform searches.");
            allKeysExhausted = true;
        }
        return null;
    }

    if (currentKeyUsageCount >= MAX_USAGE_PER_KEY) {
        logger.info({
            keyIndex: currentKeyIndex + 1,
            usage: currentKeyUsageCount,
            limit: MAX_USAGE_PER_KEY
        }, 'API key usage limit reached, attempting rotation.');

        currentKeyIndex++;
        currentKeyUsageCount = 0;

        if (currentKeyIndex >= GOOGLE_CUSTOM_SEARCH_API_KEYS.length) {
            logger.warn("All Google API keys have reached their usage limits.");
            allKeysExhausted = true;
            return null;
        }

        logger.info({
            delaySeconds: KEY_ROTATION_DELAY_MS / 1000,
            nextKeyIndex: currentKeyIndex + 1
        }, `Waiting before switching API key...`);
        await new Promise(resolve => setTimeout(resolve, KEY_ROTATION_DELAY_MS));
        logger.info({ newKeyIndex: currentKeyIndex + 1 }, `Switching to API key`);
    }

    const apiKey = GOOGLE_CUSTOM_SEARCH_API_KEYS[currentKeyIndex];
    currentKeyUsageCount++;
    totalGoogleApiRequests++;

    logger.debug({
        keyIndex: currentKeyIndex + 1,
        currentUsage: currentKeyUsageCount,
        limit: MAX_USAGE_PER_KEY,
        totalRequests: totalGoogleApiRequests
    }, 'Using API key');

    return apiKey;
}

export const crawlConferences = async (conferenceList: ConferenceData[]): Promise<ProcessedResponseData[]> => { // Updated conferenceList type to Conference[]
    // IMPORTANT: Wait for the queue to be ready
    const QUEUE = await queuePromise;

    logger.info({ totalConferences: conferenceList.length }, 'Starting crawlConferences process');

    let browser = null;
    let allBatches: BatchEntry[] = [];
    let processedConferenceCount: number = 0;
    let successfulSearchCount: number = 0;
    let failedSearchCount: number = 0;
    let skippedSearchCount: number = 0;
    let successfulSaveCount: number = 0;
    let failedSaveCount: number = 0;

    currentKeyIndex = 0;
    currentKeyUsageCount = 0;
    totalGoogleApiRequests = 0;
    allKeysExhausted = false;

    const MAX_SEARCH_RETRIES: number = 2;
    const RETRY_DELAY_MS: number = 2000;

    if (!GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
        logger.fatal("CRITICAL: GOOGLE_CUSTOM_SEARCH_API_KEYS is empty or not defined. Searches will be skipped.");
        allKeysExhausted = true;
    }

    try {
        logger.info("Setting up Playwright...");
        const { browser, browserContext } = await setupPlaywright();
        const browserCtx = browserContext;
        if (!browser || !browserCtx) {
            logger.error("Playwright setup failed. Exiting crawlConferences.");
            throw new Error("Playwright setup failed");
        }
        logger.info("Playwright setup successful.");

        const existingAcronyms: Set<string> = new Set();
        const batchIndexRef = { current: 1 };
        const batchPromises: Promise<BatchEntry[] | null>[] = [];
        const customSearchPath = path.join(__dirname, "./data/custom_search");
        const sourceRankPath = path.join(__dirname, "./data/source_rank");

        try {
            logger.debug({ customSearchPath, sourceRankPath }, 'Ensuring output directories exist');
            if (!fs.existsSync(customSearchPath)) {
                fs.mkdirSync(customSearchPath, { recursive: true });
                logger.info({ path: customSearchPath }, 'Created directory');
            }
            if (!fs.existsSync(sourceRankPath)) {
                fs.mkdirSync(sourceRankPath, { recursive: true });
                logger.info({ path: sourceRankPath }, 'Created directory');
            }

        } catch (mkdirError: any) {
            logger.error(mkdirError, "Error creating directories");
            throw mkdirError;
        }

        logger.info({ concurrency: QUEUE.concurrency }, "Starting conference processing queue");

        try {
            logger.debug({ path: CONFERENCE_OUTPUT_PATH }, 'Writing initial conference list');
            await fs.promises.writeFile(CONFERENCE_OUTPUT_PATH, JSON.stringify(conferenceList, null, 2), "utf8");
        } catch (writeFileError: any) {
            logger.warn(writeFileError, `Could not write initial conference list to file: ${CONFERENCE_OUTPUT_PATH}`);
        }

        const conferenceTasks = conferenceList.map((conference, index) => {
            return QUEUE.add(async () => {
                const confAcronym = conference?.Acronym || `Unknown-${index}`;
                const taskLogger = logger.child({ acronym: confAcronym, taskIndex: index + 1 });
                taskLogger.info(`Processing conference`);

                try {
                    if (conference.hasOwnProperty('Title') && conference.hasOwnProperty('Acronym') && conference.hasOwnProperty('mainLink')
                        && conference.hasOwnProperty('cfpLink') && conference.hasOwnProperty('impLink')) {
                        taskLogger.info(`Processing with pre-defined links`);
                        // Create ConferenceUpdateData object
                        const conferenceUpdateData: ConferenceUpdateData = {
                            Acronym: conference.Acronym,
                            Title: conference.Title,
                            mainLink: conference.mainLink || "", // Ensure mainLink is not undefined
                            cfpLink: conference.cfpLink || "",   // Ensure cfpLink is not undefined
                            impLink: conference.impLink || "",   // Ensure impLink is not undefined
                            conferenceText: "", // Initialize as empty, will be updated
                            cfpText: "",        // Initialize as empty, will be updated
                            impText: ""         // Initialize as empty, will be updated
                        };
                        await updateHTMLContent(browserCtx, conferenceUpdateData, batchIndexRef, batchPromises); // Pass ConferenceUpdateData

                    } else {
                        taskLogger.info(`Searching and processing`);
                        let searchResults: GoogleSearchResult[] = [];
                        let searchResultsLinks: string[] = [];
                        let searchSuccess: boolean = false;
                        let lastSearchError: any = null;

                        const searchQueryTemplate: string = SEARCH_QUERY_TEMPLATE;
                        const searchQuery: string = searchQueryTemplate
                            .replace(/\${Title}/g, conference.Title)
                            .replace(/\${Acronym}/g, conference.Acronym)
                            .replace(/\${Year2}/g, String(YEAR2))
                            .replace(/\${Year3}/g, String(YEAR3))
                            .replace(/\${Year1}/g, String(YEAR1));


                        for (let attempt = 1; attempt <= MAX_SEARCH_RETRIES + 1; attempt++) {
                            if (allKeysExhausted) {
                                taskLogger.warn(`Skipping Google Search attempt ${attempt} - All API keys are exhausted.`);
                                skippedSearchCount++;
                                lastSearchError = new Error("All API keys exhausted during search attempts.");
                                break;
                            }

                            const apiKey = await getNextApiKey();

                            if (!apiKey) {
                                taskLogger.warn(`Skipping Google Search attempt ${attempt} - Failed to get a valid API key.`);
                                skippedSearchCount++;
                                lastSearchError = new Error("Failed to get API key for search attempt.");
                                break;
                            }

                            taskLogger.info({
                                attempt,
                                maxAttempts: MAX_SEARCH_RETRIES + 1,
                                keyIndex: currentKeyIndex + 1,
                                totalRequests: totalGoogleApiRequests
                            }, `Attempting Google Search`);

                            try {
                                searchResults = await searchGoogleCSE(apiKey, GOOGLE_CSE_ID!, searchQuery);                                
                                searchSuccess = true;
                                successfulSearchCount++;
                                taskLogger.info({
                                    keyIndex: currentKeyIndex + 1,
                                    usage: currentKeyUsageCount,
                                    attempt,
                                    resultsCount: searchResults.length
                                }, `Google Search successful on attempt ${attempt}`);


                                break;

                            } catch (searchError: any) {
                                lastSearchError = searchError;
                                taskLogger.warn({
                                    attempt,
                                    maxAttempts: MAX_SEARCH_RETRIES + 1,
                                    keyIndex: currentKeyIndex + 1,
                                    err: searchError.message,
                                    details: searchError.details
                                }, `Google Search attempt ${attempt} failed`);

                                const isQuotaError = searchError.details?.status === 429 ||
                                    searchError.details?.googleErrorCode === 429 ||
                                    searchError.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'quotaExceeded');

                                let rotated = false;
                                if (isQuotaError && attempt <= MAX_SEARCH_RETRIES) {
                                    taskLogger.warn(`Quota/Rate limit error (429) detected on attempt ${attempt}. Forcing API key rotation.`);
                                    rotated = await forceRotateApiKey();
                                    if (!rotated) {
                                        taskLogger.error("Failed to rotate key after quota error, stopping retries for this conference.");
                                        break;
                                    }
                                }

                                if (attempt > MAX_SEARCH_RETRIES) {
                                    taskLogger.error({
                                        finalAttempt: attempt,
                                        err: searchError.message,
                                        details: searchError.details
                                    }, `Google Search failed after maximum retries.`);
                                } else if (!allKeysExhausted) {
                                    taskLogger.info({ attempt, delaySeconds: RETRY_DELAY_MS / 1000 }, `Waiting before retry attempt ${attempt + 1}...`);
                                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                                }
                            }
                        }

                        if (searchSuccess) {
                            const filteredResults = filterSearchResults(searchResults, UNWANTED_DOMAINS, SKIP_KEYWORDS);
                            const limitedResults = filteredResults.slice(0, MAX_LINKS || 4);
                            searchResultsLinks = limitedResults.map(res => res.link);

                            taskLogger.info({
                                rawResults: searchResults.length,
                                filteredResults: limitedResults.length
                            }, `Filtered search results`);

                            const allLinks = searchResults.map(result => result.link);
                            const allLinksOutputPath = path.join(__dirname, `./data/custom_search/${conference.Acronym.replace(/[^a-zA-Z0-9_.-]/g, '-')}_links.json`);
                            try {
                                taskLogger.debug({ path: allLinksOutputPath }, 'Writing search result links to file');
                                fs.writeFileSync(allLinksOutputPath, JSON.stringify(allLinks, null, 2), "utf8");
                            } catch (writeLinksError: any) {
                                taskLogger.warn(writeLinksError, `Could not write search result links to file: ${allLinksOutputPath}`);
                            }


                        } else {
                            failedSearchCount++;
                            taskLogger.error({ err: lastSearchError?.message, details: lastSearchError?.details }, "Google Search ultimately failed for this conference.");
                            searchResultsLinks = [];
                        }

                        taskLogger.info({ linksToCrawl: searchResultsLinks.length }, `Attempting to save HTML content`);
                        try {
                            await saveHTMLContent(browserCtx, conference, searchResultsLinks, batchIndexRef, existingAcronyms, batchPromises, YEAR2);
                            if (searchResultsLinks.length > 0) successfulSaveCount++;
                            taskLogger.info('Save HTML content step completed.');
                        } catch (saveError: any) {
                            failedSaveCount++;
                            taskLogger.error(saveError, 'Save HTML content failed');
                        }
                    }
                    processedConferenceCount++;

                } catch (taskError: any) {
                    processedConferenceCount++;
                    taskLogger.error(taskError, `Unhandled error processing conference task`);
                } finally {
                    taskLogger.debug(`Finished processing queue item`);
                }
            });
        });

        await Promise.all(conferenceTasks);
        logger.info("All conference processing tasks added to queue have finished.");

        logger.info("Waiting for all batch write operations to settle...");
        const settledResults = await Promise.allSettled(batchPromises);
        let successfulBatches: number = 0;
        let failedBatches: number = 0;

        logger.info("Aggregating results from batches...");
        for (const result of settledResults) {
            if (result.status === 'fulfilled' && result.value) {
                allBatches.push(...result.value);
                successfulBatches++;


            } else if (result.status === 'rejected') {
                failedBatches++;
                logger.error({ reason: result.reason }, "Batch write operation failed");
            }
        }


        logger.info("Crawler processing finished. Writing final outputs...");

        const allBatchesFilePath = path.join(__dirname, `./data/allBatches.json`);
        const evaluateFilePath = path.join(__dirname, './data/evaluate.csv');

        try {
            logger.info({ path: allBatchesFilePath, count: allBatches.length }, 'Writing aggregated results (allBatches) to JSON file');
            await fs.promises.writeFile(
                allBatchesFilePath,
                JSON.stringify(allBatches, null, 2),
                "utf8"
            );
            logger.info('Successfully wrote allBatches JSON file.');
        } catch (writeBatchesError: any) {
            logger.error(writeBatchesError, `Error writing allBatches to JSON file: ${allBatchesFilePath}`);
        }

        if (allBatches && allBatches.length > 0) {
            try {
                logger.info({ path: evaluateFilePath, recordCount: allBatches.length }, 'Writing final results to CSV file');
                const processedBatches: ProcessedResponseData[] = await writeCSVFile(evaluateFilePath, allBatches); // Expect ProcessedResponseData[]
                logger.info('Successfully wrote CSV file.');
                return processedBatches; // Return ProcessedResponseData[]
            } catch (csvError: any) {
                logger.error(csvError, `Error writing final CSV file: ${evaluateFilePath}`);
                throw csvError;
            }
        } else {
            logger.warn("No data available in allBatches to write to CSV.");
            return []; // Return empty ProcessedResponseData[] array
        }

    } catch (error: any) {
        logger.fatal(error, "Fatal error during crawling process");
        return [];
    } finally {
        logger.info({
            totalConferencesInput: conferenceList.length,
            processedConferences: processedConferenceCount,
            totalGoogleApiRequests: totalGoogleApiRequests,
            successfulSearches: successfulSearchCount,
            failedSearches: failedSearchCount,
            skippedSearches: skippedSearchCount,
        }, "Crawling process summary");

        if (browser) { //  Check if browser is not null/undefined
            logger.info("Closing Playwright browser...");
            try {
                await (browser as Browser).close();  // Type assertion: Tell TypeScript to treat 'browser' as a 'Browser' here
                logger.info("Playwright browser closed successfully.");
            } catch (closeError: any) {
                logger.error(closeError, "Error closing Playwright browser");
            }
        }
        logger.info("crawlConferences process finished.");
    }
};