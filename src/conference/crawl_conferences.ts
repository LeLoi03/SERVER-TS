import fs from 'fs';
import path from 'path';
import readline from 'readline'; // Cần readline để đọc file jsonl hiệu quả


import { searchGoogleCSE } from './1_google_search';
import { filterSearchResults } from './4_link_filtering';
import { saveHTMLContent, updateHTMLContent } from './6_playwright_utils';
import { setupPlaywright } from './12_playwright_setup';
import { writeCSVStream } from './10_response_processing';
import { cleanupTempFiles } from './11_utils';

// Import config chung
import {
    queuePromise, YEAR1, YEAR2, YEAR3, SEARCH_QUERY_TEMPLATE, MAX_LINKS, GOOGLE_CUSTOM_SEARCH_API_KEYS,
    GOOGLE_CSE_ID,
    MAX_USAGE_PER_KEY,
    KEY_ROTATION_DELAY_MS, UNWANTED_DOMAINS, SKIP_KEYWORDS
} from '../config';

import { logger } from './11_utils';

import { GoogleSearchResult, ConferenceData, ProcessedResponseData, ConferenceUpdateData, BatchUpdateEntry } from './types';
import { Browser } from 'playwright';

// --- Conference Specific ---
export const CONFERENCE_OUTPUT_PATH: string = path.join(__dirname, './data/conference_list.json');


// --- Biến quản lý trạng thái Key API ---
let currentKeyIndex: number = 0;
let currentKeyUsageCount: number = 0;
let totalGoogleApiRequests: number = 0;
let allKeysExhausted: boolean = false;

// --- Hàm trợ giúp để xoay key API NGAY LẬP TỨC ---
async function forceRotateApiKey(parentLogger: typeof logger // Kiểu dữ liệu có thể là pino.Logger hoặc tương tự
): Promise<boolean> {
    if (allKeysExhausted) {
        parentLogger.warn("Cannot force rotate key, all keys are already marked as exhausted.");
        return false;
    }

    parentLogger.warn({ oldKeyIndex: currentKeyIndex + 1 }, "Forcing rotation to next API key due to error (e.g., 429 or quota limit).");

    currentKeyIndex++;
    currentKeyUsageCount = 0;

    if (currentKeyIndex >= GOOGLE_CUSTOM_SEARCH_API_KEYS.length) {
        parentLogger.warn("Forced rotation failed: Reached end of API key list. Marking all keys as exhausted.");
        allKeysExhausted = true;
        return false;
    }

    parentLogger.info({ newKeyIndex: currentKeyIndex + 1 }, "Successfully forced rotation to new API key.");
    return true;
}


// --- Hàm trợ giúp để lấy API Key tiếp theo ---
async function getNextApiKey(parentLogger: typeof logger // Kiểu dữ liệu có thể là pino.Logger hoặc tương tự
): Promise<string | null> {
    if (allKeysExhausted || !GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
        if (!allKeysExhausted) {
            parentLogger.warn("No Google API Keys configured or all keys have been exhausted. Cannot perform searches.");
            allKeysExhausted = true;
        }
        return null;
    }

    if (currentKeyUsageCount >= MAX_USAGE_PER_KEY) {
        parentLogger.info({
            keyIndex: currentKeyIndex + 1,
            usage: currentKeyUsageCount,
            limit: MAX_USAGE_PER_KEY
        }, 'API key usage limit reached, attempting rotation.');

        currentKeyIndex++;
        currentKeyUsageCount = 0;

        if (currentKeyIndex >= GOOGLE_CUSTOM_SEARCH_API_KEYS.length) {
            parentLogger.warn("All Google API keys have reached their usage limits.");
            allKeysExhausted = true;
            return null;
        }

        parentLogger.info({
            delaySeconds: KEY_ROTATION_DELAY_MS / 1000,
            nextKeyIndex: currentKeyIndex + 1
        }, `Waiting before switching API key...`);
        await new Promise(resolve => setTimeout(resolve, KEY_ROTATION_DELAY_MS));
        parentLogger.info({ newKeyIndex: currentKeyIndex + 1 }, `Switching to API key`);
    }

    const apiKey = GOOGLE_CUSTOM_SEARCH_API_KEYS[currentKeyIndex];
    currentKeyUsageCount++;
    totalGoogleApiRequests++;

    parentLogger.debug({
        keyIndex: currentKeyIndex + 1,
        currentUsage: currentKeyUsageCount,
        limit: MAX_USAGE_PER_KEY,
        totalRequests: totalGoogleApiRequests
    }, 'Using API key');

    return apiKey;
}

// Đường dẫn file output .jsonl (cần thống nhất với saveBatchToFile)
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
const EVALUATE_CSV_PATH = path.join(__dirname, './data/evaluate.csv'); // Đường dẫn file CSV

// Thêm tham số parentLogger vào định nghĩa hàm
export const crawlConferences = async (
    conferenceList: ConferenceData[],
    parentLogger: typeof logger
): Promise<void> => { // <<<--- Thành Promise<void> vì không trả về dữ liệu nữa
    const QUEUE = await queuePromise;

    const operationStartTime = Date.now();
    parentLogger.info({
        event: 'crawl_start',
        totalConferences: conferenceList.length,
        startTime: new Date(operationStartTime).toISOString()
    }, 'Starting crawlConferences process');

    let playwrightBrowser: Browser | null = null;

    // --- Khởi tạo trạng thái API key ---
    currentKeyIndex = 0;
    currentKeyUsageCount = 0;
    totalGoogleApiRequests = 0;
    allKeysExhausted = false;
    // ---

    // Chỉ đếm và log lỗi, không thu thập dữ liệu ở đây
    let successfulBatchOperations = 0;
    let failedBatchOperations = 0;

    const MAX_SEARCH_RETRIES: number = 2;
    const RETRY_DELAY_MS: number = 2000;

    if (!GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
        parentLogger.fatal({ event: 'config_error' }, "CRITICAL: GOOGLE_CUSTOM_SEARCH_API_KEYS is empty or not defined. Searches will be skipped.");
        allKeysExhausted = true;
    }

    // --- Xóa file output cũ trước khi bắt đầu (Tùy chọn) ---
    try {
        if (fs.existsSync(FINAL_OUTPUT_PATH)) {
            parentLogger.warn({ path: FINAL_OUTPUT_PATH, event: 'delete_old_output' }, 'Deleting existing final output file before starting.');
            await fs.promises.unlink(FINAL_OUTPUT_PATH);
        }
        if (fs.existsSync(EVALUATE_CSV_PATH)) { // <<<--- Xóa cả file CSV cũ
            parentLogger.warn({ path: EVALUATE_CSV_PATH, event: 'delete_old_output' }, 'Deleting existing final CSV file before starting.');
            await fs.promises.unlink(EVALUATE_CSV_PATH);
        }
    } catch (unlinkError: any) {
        parentLogger.error({ err: unlinkError, path: FINAL_OUTPUT_PATH, event: 'delete_old_output_failed' }, 'Could not delete existing final output file.');
        // Có thể throw lỗi ở đây nếu việc không xóa được file cũ là nghiêm trọng
    }
    // ---

    const batchPromises: Promise<void>[] = [];
    const updateBatchPromises: Promise<BatchUpdateEntry[] | null>[] = [];

    try {
        parentLogger.info({ event: 'playwright_setup_start' }, "Setting up Playwright...");
        const { browser: pwBrowser, browserContext } = await setupPlaywright();
        playwrightBrowser = pwBrowser;
        const browserCtx = browserContext;

        if (!playwrightBrowser || !browserCtx) {
            parentLogger.error({ event: 'playwright_setup_failed' }, "Playwright setup failed. Exiting crawlConferences.");
            throw new Error("Playwright setup failed");
        }
        parentLogger.info({ event: 'playwright_setup_success' }, "Playwright setup successful.");

        const existingAcronyms: Set<string> = new Set();
        const batchIndexRef = { current: 1 };


        const customSearchPath = path.join(__dirname, "./data/custom_search");
        const sourceRankPath = path.join(__dirname, "./data/source_rank");


        // --- Tạo thư mục ---
        try {
            parentLogger.debug({ customSearchPath, sourceRankPath, event: 'ensure_dirs' }, 'Ensuring output directories exist');
            if (!fs.existsSync(customSearchPath)) {
                fs.mkdirSync(customSearchPath, { recursive: true });
                parentLogger.info({ path: customSearchPath, event: 'dir_created' }, 'Created directory');
            }
            if (!fs.existsSync(sourceRankPath)) {
                fs.mkdirSync(sourceRankPath, { recursive: true });
                parentLogger.info({ path: sourceRankPath, event: 'dir_created' }, 'Created directory');
            }
            // Đảm bảo thư mục chứa file output cuối cùng tồn tại
            const finalOutputDir = path.dirname(FINAL_OUTPUT_PATH);
            if (!fs.existsSync(finalOutputDir)) {
                parentLogger.info({ path: finalOutputDir, event: 'final_dir_create' }, "Creating final output directory");
                fs.mkdirSync(finalOutputDir, { recursive: true });
            }
        } catch (mkdirError: any) {
            parentLogger.error({ err: mkdirError, event: 'dir_create_error' }, "Error creating directories");
            throw mkdirError; // Ném lỗi nghiêm trọng
        }
        // ------------------

        parentLogger.info({ concurrency: QUEUE.concurrency, event: 'queue_start' }, "Starting conference processing queue");

        // --- Ghi file input ban đầu ---
        try {
            parentLogger.debug({ path: CONFERENCE_OUTPUT_PATH, event: 'write_initial_list' }, 'Writing initial conference list');
            await fs.promises.writeFile(CONFERENCE_OUTPUT_PATH, JSON.stringify(conferenceList, null, 2), "utf8");
        } catch (writeFileError: any) {
            parentLogger.warn({ err: writeFileError, path: CONFERENCE_OUTPUT_PATH, event: 'write_initial_list_failed' }, `Could not write initial conference list`);
        }
        // ----------------------------

        // --- Xử lý từng conference trong Queue ---
        const conferenceTasks = conferenceList.map((conference, index) => {
            return QUEUE.add(async () => {
                const confAcronym = conference?.Acronym || `Unknown-${index}`;
                const confTitle = conference?.Title || `Unknown-${index}`;

                // Child logger để tự động thêm acronym và taskIndex vào mỗi log của task này
                const taskLogger = parentLogger.child({ title: confTitle, acronym: confAcronym, taskIndex: index + 1, event_group: 'conference_task' });
                taskLogger.info({ event: 'task_start' }, `Processing conference`);
                let taskHasError = false; // Cờ để đánh dấu lỗi trong task

                try {
                    if (conference.mainLink && conference.cfpLink && conference.impLink) {
                        taskLogger.info({ event: 'process_predefined_links' }, `Processing with pre-defined links`);
                        const conferenceUpdateData: ConferenceUpdateData = { Acronym: conference.Acronym, Title: conference.Title, mainLink: conference.mainLink || "", cfpLink: conference.cfpLink || "", impLink: conference.impLink || "", conferenceText: "", cfpText: "", impText: "" };
                        try {
                            // Giả sử updateHTMLContent log chi tiết bên trong
                            await updateHTMLContent(browserCtx, conferenceUpdateData, batchIndexRef, updateBatchPromises, parentLogger);
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

                            const apiKey = await getNextApiKey(parentLogger); // Hàm này nên log key index và total requests nếu cần

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
                                    const rotated = await forceRotateApiKey(parentLogger); // Hàm này nên log nếu xoay thành công/thất bại
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
                            await saveHTMLContent(browserCtx, conference, searchResultsLinks, batchIndexRef, existingAcronyms, batchPromises, YEAR2, parentLogger);
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


                } catch (taskError: any) {
                    taskHasError = true; // Đánh dấu lỗi cho task này
                    // Log lỗi không xác định trong task (đã có, giữ nguyên)
                    taskLogger.error({ err: taskError, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
                } finally {
                    // Log kết thúc xử lý task, thêm trạng thái hoàn thành/thất bại -> Chỉ là hoàn thành, còn thành công hay công là do extract api
                    taskLogger.info({ event: 'task_finish', status: !taskHasError }, `Finished processing queue item`);
                }
            });
        }); // Kết thúc map conferenceList

        // --- Chờ tất cả task trong queue hoàn thành ---
        await Promise.all(conferenceTasks);
        parentLogger.info({ event: 'queue_finished' }, "All conference processing tasks added to queue have finished.");
        // ---

        // --- Chờ và Xử lý Kết quả Batch Promises ---
        parentLogger.info({ promiseCount: batchPromises.length, event: 'batch_settlement_start' }, "Waiting for all batch processing operations (saveBatchToFile/updateHTMLContent) to settle...");
        const settledResults = await Promise.allSettled(batchPromises);
        parentLogger.info({ event: 'batch_settlement_finished' }, "All batch processing operations settled. Checking results...");


        settledResults.forEach((result, i) => {
            const batchLogContext = { batchPromiseIndex: i };
            if (result.status === 'fulfilled') {
                successfulBatchOperations++;
                parentLogger.info({ ...batchLogContext, status: result.status, event: 'batch_operation_settled_success' }, "Batch processing operation fulfilled successfully.");
            } else { // status === 'rejected'
                failedBatchOperations++;
                // Log lỗi bị ném ra từ saveBatchToFile/updateHTMLContent
                parentLogger.error({ ...batchLogContext, reason: result.reason, status: result.status, event: 'batch_operation_settled_failed' }, "Batch processing operation promise rejected.");
            }
        });

        parentLogger.info({
            successfulOperations: successfulBatchOperations,
            failedOperations: failedBatchOperations,
            totalOperations: settledResults.length,
            event: 'batch_settlement_summary'
        }, "Finished checking batch processing operation results.");
        // ---

        // --- Final Output Processing (CSV Streaming) ---
        parentLogger.info({ event: 'final_output_processing_start' }, "Processing final outputs via streaming to CSV...");

        // --- Gọi hàm ghi CSV Stream ---
        if (fs.existsSync(FINAL_OUTPUT_PATH)) { // Chỉ chạy nếu file JSONL nguồn tồn tại
            try {
                parentLogger.info({ jsonlPath: FINAL_OUTPUT_PATH, csvPath: EVALUATE_CSV_PATH, event: 'csv_stream_call_start' }, 'Starting CSV streaming process from JSONL file');
                await writeCSVStream(FINAL_OUTPUT_PATH, EVALUATE_CSV_PATH, parentLogger); // <<<--- Gọi hàm mới
                parentLogger.info({ csvPath: EVALUATE_CSV_PATH, event: 'csv_stream_call_success' }, 'CSV streaming process completed successfully.');
            } catch (csvStreamError: any) {
                parentLogger.error({ err: csvStreamError, event: 'csv_stream_call_failed' }, `CSV streaming process failed`);
                // Quyết định có nên dừng ở đây không hay chỉ log lỗi
                // Nếu lỗi CSV là nghiêm trọng, có thể throw lại: throw csvStreamError;
            }
        } else {
            parentLogger.warn({ path: FINAL_OUTPUT_PATH, event: 'csv_stream_skipped_no_jsonl' }, 'Final output JSONL file not found. Skipping CSV generation.');
        }
        // ---

        // Trả về void vì không còn giữ dữ liệu trong bộ nhớ

    } catch (error: any) {
        parentLogger.fatal({ err: error, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
        // Có thể ném lại lỗi nếu muốn báo hiệu lỗi nghiêm trọng ra bên ngoài
        throw error;
    } finally {

        // --- Luôn thực hiện cleanup ---
        // parentLogger.info({ event: 'cleanup_start' }, "Performing final cleanup...");

        // // 1. Dọn dẹp file tạm
        // await cleanupTempFiles();

        // 2. Đóng trình duyệt
        if (playwrightBrowser) {
            parentLogger.info({ event: 'playwright_close_start' }, "Closing Playwright browser...");
            try {
                await playwrightBrowser.close();
                parentLogger.info({ event: 'playwright_close_success' }, "Playwright browser closed successfully.");
            } catch (closeError: any) {
                parentLogger.error({ err: closeError, event: 'playwright_close_failed' }, "Error closing Playwright browser");
            }
        }

        // 3. Log thông tin tổng kết
        const operationEndTime = Date.now();
        const durationSeconds = Math.round((operationEndTime - operationStartTime) / 1000);
        const finalRecordCount = fs.existsSync(FINAL_OUTPUT_PATH)
            ? (await fs.promises.readFile(FINAL_OUTPUT_PATH, 'utf8')).split('\n').filter(l => l.trim()).length
            : 0; // Đếm số dòng thực tế trong file cuối cùng

        parentLogger.info({
            event: 'crawl_summary',
            totalConferencesInput: conferenceList.length,
            totalBatchOperationsAttempted: batchPromises.length, // Số promise đã tạo
            successfulBatchOperations: successfulBatchOperations, // Số promise fulfilled
            failedBatchOperations: failedBatchOperations,     // Số promise rejected
            finalRecordsWritten: finalRecordCount,         // Số bản ghi trong file .jsonl
            totalGoogleApiRequests: totalGoogleApiRequests,
            durationSeconds,
            endTime: new Date(operationEndTime).toISOString()
        }, "Crawling process summary");

        parentLogger.info({ event: 'crawl_end_success' }, "crawlConferences process finished.");
        // --- Kết thúc cleanup ---
    }
};