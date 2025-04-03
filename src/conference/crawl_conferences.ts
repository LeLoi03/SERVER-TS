import fs from 'fs';
import path from 'path';


import { searchGoogleCSE } from './1_google_search';
import { filterSearchResults } from './4_link_filtering';
import { saveHTMLContent, updateHTMLContent } from './6_playwright_utils';
import { setupPlaywright } from './12_playwright_setup';
import { writeCSVFile } from './10_response_processing';
import { cleanupTempFiles } from './11_utils';

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


export const crawlConferences = async (conferenceList: ConferenceData[]): Promise<ProcessedResponseData[]> => {
    const QUEUE = await queuePromise; // IMPORTANT: Wait for the queue

    const operationStartTime = Date.now(); // Ghi lại thời điểm bắt đầu
    logger.info({
        event: 'crawl_start', // Thêm event type để dễ lọc
        totalConferences: conferenceList.length,
        startTime: new Date(operationStartTime).toISOString()
    }, 'Starting crawlConferences process');

    let playwrightBrowser: Browser | null = null; // Đổi tên biến để tránh trùng với 'browser' import
    let allBatches: BatchEntry[] = [];

    // --- Khởi tạo lại trạng thái API key cho mỗi lần chạy ---
    currentKeyIndex = 0;
    currentKeyUsageCount = 0;
    totalGoogleApiRequests = 0;
    allKeysExhausted = false;
    // -------------------------------------------------------

    const MAX_SEARCH_RETRIES: number = 2;
    const RETRY_DELAY_MS: number = 2000;

    if (!GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
        logger.fatal({ event: 'config_error' }, "CRITICAL: GOOGLE_CUSTOM_SEARCH_API_KEYS is empty or not defined. Searches will be skipped.");
        allKeysExhausted = true; // Đặt cờ này vẫn hợp lý
    }

    try {
        logger.info({ event: 'playwright_setup_start' }, "Setting up Playwright...");
        // Đổi tên biến trả về để không trùng
        const { browser: pwBrowser, browserContext } = await setupPlaywright();
        playwrightBrowser = pwBrowser; // Gán vào biến phạm vi ngoài
        const browserCtx = browserContext;

        if (!playwrightBrowser || !browserCtx) {
            // Log lỗi đã có trong setupPlaywright nếu cần, ở đây chỉ cần throw
            logger.error({ event: 'playwright_setup_failed' }, "Playwright setup failed. Exiting crawlConferences.");
            throw new Error("Playwright setup failed");
        }
        logger.info({ event: 'playwright_setup_success' }, "Playwright setup successful.");

        const existingAcronyms: Set<string> = new Set();
        const batchIndexRef = { current: 1 }; // Ref để tạo batch index duy nhất
        const batchPromises: Promise<BatchEntry[] | null>[] = [];
        const customSearchPath = path.join(__dirname, "./data/custom_search");
        const sourceRankPath = path.join(__dirname, "./data/source_rank");

        // --- Tạo thư mục ---
        try {
            logger.debug({ customSearchPath, sourceRankPath, event: 'ensure_dirs' }, 'Ensuring output directories exist');
            if (!fs.existsSync(customSearchPath)) {
                fs.mkdirSync(customSearchPath, { recursive: true });
                logger.info({ path: customSearchPath, event: 'dir_created' }, 'Created directory');
            }
            if (!fs.existsSync(sourceRankPath)) {
                fs.mkdirSync(sourceRankPath, { recursive: true });
                logger.info({ path: sourceRankPath, event: 'dir_created' }, 'Created directory');
            }
        } catch (mkdirError: any) {
            logger.error({ err: mkdirError, event: 'dir_create_error' }, "Error creating directories");
            throw mkdirError; // Ném lỗi nghiêm trọng
        }
        // ------------------

        logger.info({ concurrency: QUEUE.concurrency, event: 'queue_start' }, "Starting conference processing queue");

        // --- Ghi file input ban đầu ---
        try {
            logger.debug({ path: CONFERENCE_OUTPUT_PATH, event: 'write_initial_list' }, 'Writing initial conference list');
            await fs.promises.writeFile(CONFERENCE_OUTPUT_PATH, JSON.stringify(conferenceList, null, 2), "utf8");
        } catch (writeFileError: any) {
            logger.warn({ err: writeFileError, path: CONFERENCE_OUTPUT_PATH, event: 'write_initial_list_failed' }, `Could not write initial conference list`);
        }
        // ----------------------------

        // --- Xử lý từng conference trong Queue ---
        const conferenceTasks = conferenceList.map((conference, index) => {
            return QUEUE.add(async () => {
                const confAcronym = conference?.Acronym || `Unknown-${index}`;
                // Child logger để tự động thêm acronym và taskIndex vào mỗi log của task này
                const taskLogger = logger.child({ acronym: confAcronym, taskIndex: index + 1, event_group: 'conference_task' });
                taskLogger.info({ event: 'task_start' }, `Processing conference`);
                let taskHasError = false; // Cờ để đánh dấu lỗi trong task

                try {
                    if (conference.mainLink && conference.cfpLink && conference.impLink) {
                        taskLogger.info({ event: 'process_predefined_links' }, `Processing with pre-defined links`);
                        const conferenceUpdateData: ConferenceUpdateData = { /* ... như cũ ... */ Acronym: conference.Acronym, Title: conference.Title, mainLink: conference.mainLink || "", cfpLink: conference.cfpLink || "", impLink: conference.impLink || "", conferenceText: "", cfpText: "", impText: "" };
                        try {
                            // Giả sử updateHTMLContent log chi tiết bên trong
                            await updateHTMLContent(browserCtx, conferenceUpdateData, batchIndexRef, batchPromises);
                            taskLogger.info({ event: 'process_predefined_links_success' }, "Predefined links processing step completed.");
                        } catch (updateError: any) {
                            taskHasError = true;
                            taskLogger.error({ err: updateError, event: 'process_predefined_links_failed' }, "Error during predefined links processing.");
                        }

                    } else {
                        taskLogger.info({ event: 'search_and_process_start' }, `Searching and processing`);
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

                        // --- Google Search Loop ---
                        for (let attempt = 1; attempt <= MAX_SEARCH_RETRIES + 1; attempt++) {
                            if (allKeysExhausted) {
                                taskLogger.warn({ attempt, event: 'search_skip_all_keys_exhausted' }, `Skipping Google Search attempt - All API keys exhausted.`);
                                // Không cần biến đếm skippedSearchCount++;
                                lastSearchError = new Error("All API keys exhausted during search attempts.");
                                break; // Thoát vòng lặp tìm kiếm
                            }

                            const apiKey = await getNextApiKey(); // Hàm này nên log key index và total requests nếu cần

                            if (!apiKey) {
                                taskLogger.warn({ attempt, event: 'search_skip_no_key' }, `Skipping Google Search attempt - Failed to get valid API key.`);
                                // Không cần biến đếm skippedSearchCount++;
                                lastSearchError = new Error("Failed to get API key for search attempt.");
                                break; // Thoát vòng lặp tìm kiếm
                            }

                            // Log khi bắt đầu thử search (đã có trong code gốc, giữ nguyên)
                            taskLogger.info({ attempt, maxAttempts: MAX_SEARCH_RETRIES + 1, keyIndex: currentKeyIndex + 1, totalRequestsAtAttempt: totalGoogleApiRequests, event: 'search_attempt' }, `Attempting Google Search`);

                            try {
                                searchResults = await searchGoogleCSE(apiKey, GOOGLE_CSE_ID!, searchQuery);
                                searchSuccess = true;
                                // Log thành công (đã có trong code gốc, giữ nguyên)
                                taskLogger.info({ keyIndex: currentKeyIndex + 1, usage: currentKeyUsageCount, attempt, resultsCount: searchResults.length, event: 'search_success' }, `Google Search successful on attempt ${attempt}`);
                                break; // Thoát vòng lặp khi thành công

                            } catch (searchError: any) {
                                lastSearchError = searchError; // Lưu lỗi cuối cùng
                                // Log lỗi search attempt (đã có trong code gốc, giữ nguyên)
                                taskLogger.warn({ attempt, maxAttempts: MAX_SEARCH_RETRIES + 1, keyIndex: currentKeyIndex + 1, err: searchError, details: searchError.details, event: 'search_attempt_failed' }, `Google Search attempt ${attempt} failed`);

                                const isQuotaError = searchError.details?.status === 429 || /* ... như cũ ... */ searchError.details?.googleErrorCode === 429 || searchError.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'quotaExceeded');

                                // Xử lý Quota Error và xoay key (đã có, giữ nguyên logic log)
                                if (isQuotaError && attempt <= MAX_SEARCH_RETRIES) {
                                    taskLogger.warn({ attempt, event: 'search_quota_error_detected' }, `Quota/Rate limit error (429) detected. Forcing API key rotation.`);
                                    const rotated = await forceRotateApiKey(); // Hàm này nên log nếu xoay thành công/thất bại
                                    if (!rotated) {
                                        taskLogger.error({ event: 'search_key_rotation_failed' }, "Failed to rotate key after quota error, stopping retries for this conference.");
                                        break; // Dừng retry nếu không xoay được key
                                    }
                                }

                                // Log khi hết số lần thử (đã có, giữ nguyên)
                                if (attempt > MAX_SEARCH_RETRIES) {
                                    taskLogger.error({ finalAttempt: attempt, err: searchError, details: searchError.details, event: 'search_failed_max_retries' }, `Google Search failed after maximum retries.`);
                                    // Không cần failedSearchCount++;
                                } else if (!allKeysExhausted) {
                                    // Log chờ retry (đã có, giữ nguyên)
                                    taskLogger.info({ attempt, delaySeconds: RETRY_DELAY_MS / 1000, event: 'search_retry_wait' }, `Waiting before retry attempt ${attempt + 1}...`);
                                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                                }
                            }
                        } // Kết thúc for loop search

                        // --- Xử lý kết quả Search ---
                        if (searchSuccess) {
                            // Log lọc kết quả (đã có, giữ nguyên)
                            const filteredResults = filterSearchResults(searchResults, UNWANTED_DOMAINS, SKIP_KEYWORDS);
                            const limitedResults = filteredResults.slice(0, MAX_LINKS || 4);
                            searchResultsLinks = limitedResults.map(res => res.link);
                            taskLogger.info({ rawResults: searchResults.length, filteredResults: limitedResults.length, event: 'search_results_filtered' }, `Filtered search results`);

                            // Ghi file links (đã có, giữ nguyên logic log)
                            const allLinks = searchResults.map(result => result.link);
                            const allLinksOutputPath = path.join(__dirname, `./data/custom_search/${confAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-')}_links.json`);
                            try {
                                taskLogger.debug({ path: allLinksOutputPath, event: 'write_search_links' }, 'Writing search result links to file');
                                fs.writeFileSync(allLinksOutputPath, JSON.stringify(allLinks, null, 2), "utf8");
                            } catch (writeLinksError: any) {
                                taskLogger.warn({ err: writeLinksError, path: allLinksOutputPath, event: 'write_search_links_failed' }, `Could not write search result links`);
                            }
                        } else {
                            // Log search thất bại cuối cùng (đã có, giữ nguyên)
                            // Đảm bảo log này được ghi KHI searchSuccess là false sau vòng lặp
                            taskLogger.error({ err: lastSearchError, details: lastSearchError?.details, event: 'search_ultimately_failed' }, "Google Search ultimately failed for this conference.");
                            searchResultsLinks = []; // Đảm bảo links rỗng
                        }
                        // --------------------------

                        // --- Lưu HTML Content ---
                        // Log bắt đầu lưu (đã có, giữ nguyên)
                        taskLogger.info({ linksToCrawl: searchResultsLinks.length, event: 'save_html_start' }, `Attempting to save HTML content`);
                        try {
                            // Hàm saveHTMLContent sẽ log chi tiết bên trong (thành công/thất bại từng link)
                            await saveHTMLContent(browserCtx, conference, searchResultsLinks, batchIndexRef, existingAcronyms, batchPromises, YEAR2);
                            // Log khi bước lưu hoàn tất (không phân biệt có link hay không)
                            taskLogger.info({ event: 'save_html_step_completed' }, 'Save HTML content step completed.');
                            // Không cần successfulSaveCount++;
                        } catch (saveError: any) {
                            taskHasError = true; // Đánh dấu lỗi cho task này
                            // Log lỗi lưu (đã có, giữ nguyên)
                            taskLogger.error({ err: saveError, event: 'save_html_failed' }, 'Save HTML content failed');
                            // Không cần failedSaveCount++;
                        }
                        // ----------------------
                    }

                    // Không cần processedConferenceCount++ ở đây

                } catch (taskError: any) {
                    taskHasError = true; // Đánh dấu lỗi cho task này
                    // Log lỗi không xác định trong task (đã có, giữ nguyên)
                    taskLogger.error({ err: taskError, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
                    // Không cần processedConferenceCount++ ở đây
                } finally {
                    // Log kết thúc xử lý task, thêm trạng thái hoàn thành/thất bại -> Chỉ là hoàn thành, còn thành công hay công là do extract api
                    taskLogger.info({ event: 'task_finish', status: (!taskHasError === true) ? "completed" : "failed" }, `Finished processing queue item`);
                }
            });
        }); // Kết thúc map conferenceList

        // --- Chờ tất cả task trong queue hoàn thành ---
        await Promise.all(conferenceTasks);
        logger.info({ event: 'queue_finished' }, "All conference processing tasks added to queue have finished.");
        // --------------------------------------------

        // --- Chờ và tổng hợp kết quả Batch ---
        logger.info({ promiseCount: batchPromises.length, event: 'batch_aggregation_start' }, "Waiting for all batch operations to settle...");
        const settledResults = await Promise.allSettled(batchPromises);
        logger.info({ event: 'batch_aggregation_settled' }, "All batch operations settled. Aggregating results...");

        allBatches = []; // Xóa batch cũ trước khi tổng hợp

        // Phân tích kết quả batch và log chi tiết từng cái
        let aggregatedSuccessCount = 0;
        let aggregatedFailedCount = 0;
        settledResults.forEach((result, i) => {
            const batchLogContext = { batchPromiseIndex: i }; // Index của promise trong mảng batchPromises
            if (result.status === 'fulfilled' && result.value) {
                if (Array.isArray(result.value) && result.value.length > 0) { // Phải là mảng không rỗng
                    allBatches.push(...result.value);
                    aggregatedSuccessCount++;
                    logger.info({ ...batchLogContext, batchCount: result.value.length, status: result.status, event: 'batch_aggregation_item_success' }, "Batch promise fulfilled with data.");
                } else {
                    // Resolved thành null hoặc mảng rỗng -> coi là thất bại logic
                    aggregatedFailedCount++;
                    logger.warn({ ...batchLogContext, status: result.status, valueType: typeof result.value, isEmptyArray: Array.isArray(result.value), event: 'batch_aggregation_item_failed_logic' }, "Batch promise resolved to null or empty array.");
                }
            } else if (result.status === 'rejected') {
                aggregatedFailedCount++;
                // Log lỗi từ batch promise (đã có, giữ nguyên)
                logger.error({ ...batchLogContext, reason: result.reason, status: result.status, event: 'batch_aggregation_item_failed_rejected' }, "Batch operation promise rejected");
            } else {
                // Trường hợp fulfilled nhưng value là null/undefined (đã xử lý ở trên)
                aggregatedFailedCount++; // Xử lý như một thất bại
                logger.warn({ ...batchLogContext, status: result.status, value: result.value, event: 'batch_aggregation_item_failed_nodata' }, "Batch promise fulfilled but with no value.");
            }
        });

        // Log kết quả tổng hợp batch cuối cùng (sử dụng biến đếm *cục bộ* trong vòng lặp trên)
        logger.info({
            successfulBatches: aggregatedSuccessCount,
            failedBatches: aggregatedFailedCount,
            aggregatedCount: allBatches.length, // Số lượng entry thực tế được thêm
            event: 'batch_aggregation_finished'
        }, "Finished aggregating batch results.");
        // Không cần successfulBatches, failedBatches ở phạm vi ngoài
        // ------------------------------------

        // --- Ghi file output cuối cùng ---
        logger.info({ event: 'final_output_start' }, "Writing final outputs...");
        const allBatchesFilePath = path.join(__dirname, `./data/allBatches.json`);
        const evaluateFilePath = path.join(__dirname, './data/evaluate.csv');

        // Ghi allBatches.json (đã có, giữ nguyên logic log)
        try {
            logger.info({ path: allBatchesFilePath, count: allBatches.length, event: 'write_allbatches_json' }, 'Writing aggregated results (allBatches) to JSON file');
            await fs.promises.writeFile(allBatchesFilePath, JSON.stringify(allBatches, null, 2), "utf8");
            logger.info({ path: allBatchesFilePath, event: 'write_allbatches_json_success' }, 'Successfully wrote allBatches JSON file.');
        } catch (writeBatchesError: any) {
            logger.error({ err: writeBatchesError, path: allBatchesFilePath, event: 'write_allbatches_json_failed' }, `Error writing allBatches to JSON file`);
        }

        // Ghi evaluate.csv (đã có, giữ nguyên logic log)
        let finalProcessedData: ProcessedResponseData[] = [];
        if (allBatches && allBatches.length > 0) {
            try {
                logger.info({ path: evaluateFilePath, recordCount: allBatches.length, event: 'write_evaluate_csv' }, 'Writing final results to CSV file');
                finalProcessedData = await writeCSVFile(evaluateFilePath, allBatches); // Hàm này nên log bên trong nếu có lỗi
                logger.info({ path: evaluateFilePath, event: 'write_evaluate_csv_success' }, 'Successfully wrote CSV file.');
            } catch (csvError: any) {
                logger.error({ err: csvError, path: evaluateFilePath, event: 'write_evaluate_csv_failed' }, `Error writing final CSV file`);
            }
        } else {
            logger.warn({ event: 'write_evaluate_csv_skipped' }, "No data available in allBatches to write to CSV.");
        }
        // ------------------------------

        // Trả về dữ liệu cuối cùng
        return finalProcessedData;

    } catch (error: any) {
        // Log lỗi nghiêm trọng của toàn bộ quá trình (đã có, giữ nguyên)
        logger.fatal({ err: error, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
        return []; // Trả về mảng rỗng
    } finally {
        // --- Luôn thực hiện cleanup ---
        logger.info({ event: 'cleanup_start' }, "Performing final cleanup...");

        // 1. Dọn dẹp file tạm (đã có, giữ nguyên)
        await cleanupTempFiles(); // Hàm này nên log bên trong

        // 2. Đóng trình duyệt (đã có, giữ nguyên logic log)
        if (playwrightBrowser) {
            logger.info({ event: 'playwright_close_start' }, "Closing Playwright browser...");
            try {
                await playwrightBrowser.close();
                logger.info({ event: 'playwright_close_success' }, "Playwright browser closed successfully.");
            } catch (closeError: any) {
                logger.error({ err: closeError, event: 'playwright_close_failed' }, "Error closing Playwright browser");
            }
        }

        // 3. Log thông tin tổng kết - LOẠI BỎ CÁC BIẾN ĐẾM
        const operationEndTime = Date.now();
        const durationSeconds = Math.round((operationEndTime - operationStartTime) / 1000);
        logger.info({
            event: 'crawl_summary', // Đổi tên event
            totalConferencesInput: conferenceList.length,
            totalGoogleApiRequests: totalGoogleApiRequests,
            durationSeconds,
            endTime: new Date(operationEndTime).toISOString()
        }, "Crawling process summary"); // Giữ message này

        logger.info({ event: 'crawl_end_success' }, "crawlConferences process finished.");
        // --- Kết thúc cleanup ---
    }
};