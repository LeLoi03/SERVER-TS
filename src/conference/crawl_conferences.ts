import fs from 'fs';
import path from 'path';


import { searchGoogleCSE } from './1_google_search';
import { filterSearchResults } from './4_link_filtering';
import { saveHTMLContent, updateHTMLContent } from './6_batch_processing';
import { setupPlaywright } from './12_playwright_setup';
import { writeCSVStream } from './10_response_processing';
import { cleanupTempFiles, logger } from './11_utils';

// Import config chung
import {
    queuePromise, YEAR1, YEAR2, YEAR3, SEARCH_QUERY_TEMPLATE, MAX_LINKS,
    GOOGLE_CUSTOM_SEARCH_API_KEYS, GOOGLE_CSE_ID,
    MAX_USAGE_PER_KEY, KEY_ROTATION_DELAY_MS,
    UNWANTED_DOMAINS, SKIP_KEYWORDS, MAX_SEARCH_RETRIES, RETRY_DELAY_MS
} from '../config';
import { GoogleSearchResult, ConferenceData, ProcessedResponseData, ConferenceUpdateData } from './types';
import { Browser } from 'playwright';

// --- Conference Specific ---
const CONFERENCE_OUTPUT_PATH = path.join(__dirname, './data/conference_list.json');
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
const EVALUATE_CSV_PATH = path.join(__dirname, './data/evaluate.csv');

// ============================================
// Lớp quản lý API Key
// ============================================
class ApiKeyManager {
    private readonly keys: readonly string[];
    private readonly maxUsagePerKey: number;
    private readonly rotationDelayMs: number;
    private readonly logger: typeof logger;

    private currentIndex: number = 0;
    private currentUsage: number = 0;
    private totalRequestsInternal: number = 0;
    private isExhausted: boolean = false;

    constructor(keys: string[] | undefined, maxUsage: number, delayMs: number, parentLogger: typeof logger) {
        this.keys = Object.freeze([...(keys || [])]); // Tạo bản sao không thể thay đổi
        this.maxUsagePerKey = maxUsage;
        this.rotationDelayMs = delayMs;
        this.logger = parentLogger.child({ service: 'ApiKeyManager' }); // Logger riêng

        if (this.keys.length === 0) {
            this.logger.error({ event: 'init_error' }, "CRITICAL: No Google API Keys provided to ApiKeyManager. Searches will fail.");
            this.isExhausted = true;
        } else {
            this.logger.info({ keyCount: this.keys.length, maxUsage: this.maxUsagePerKey, event: 'init_success' }, "ApiKeyManager initialized.");
        }
    }

    /**
     * Lấy API Key tiếp theo. Tự động xoay vòng khi đạt giới hạn sử dụng
     * hoặc khi được yêu cầu bởi forceRotate.
     * @returns API key hoặc null nếu tất cả các key đã hết hạn.
     */
    public async getNextKey(): Promise<string | null> {
        if (this.isExhausted) {
            // Log đã được ghi khi isExhausted được set
            return null;
        }

        // Kiểm tra giới hạn sử dụng và xoay vòng nếu cần
        if (this.currentUsage >= this.maxUsagePerKey && this.keys.length > 0) {
            this.logger.info({
                keyIndex: this.currentIndex + 1,
                usage: this.currentUsage,
                limit: this.maxUsagePerKey,
                event: 'usage_limit_reached'
            }, 'API key usage limit reached, attempting rotation.');

            const rotated = await this.rotate(false); // Xoay vòng bình thường
            if (!rotated) {
                // this.isExhausted đã được set bên trong rotate()
                return null;
            }

            // Áp dụng delay *sau khi* xoay vòng thành công (nếu được cấu hình)
            // Xem xét lại sự cần thiết của delay này ở đây
            if (this.rotationDelayMs > 0) {
                this.logger.info({
                    delaySeconds: this.rotationDelayMs / 1000,
                    nextKeyIndex: this.currentIndex + 1,
                    event: 'rotation_delay_start'
                }, `Waiting ${this.rotationDelayMs / 1000}s after normal key rotation...`);
                await new Promise(resolve => setTimeout(resolve, this.rotationDelayMs));
                this.logger.info({ newKeyIndex: this.currentIndex + 1, event: 'rotation_delay_end' }, `Finished waiting, proceeding with new key.`);
            }
        }

        // Lấy key hiện tại, tăng số lượt sử dụng và trả về
        const key = this.keys[this.currentIndex];
        this.currentUsage++;
        this.totalRequestsInternal++;

        this.logger.debug({
            keyIndex: this.currentIndex + 1,
            currentUsage: this.currentUsage,
            limit: this.maxUsagePerKey,
            totalRequests: this.totalRequestsInternal,
            event: 'key_provided'
        }, 'Providing API key');

        return key;
    }

    /**
     * Buộc xoay vòng sang API key tiếp theo, thường dùng khi gặp lỗi 429.
     * @returns true nếu xoay vòng thành công, false nếu đã hết key.
     */
    public async forceRotate(): Promise<boolean> {
        if (this.isExhausted) {
            this.logger.warn({ event: 'force_rotate_skipped' }, "Cannot force rotate key, all keys are already marked as exhausted.");
            return false;
        }
        // Log đã được thực hiện bên trong hàm rotate
        return this.rotate(true); // Gọi hàm xoay nội bộ (là force)
    }

    /**
     * Hàm nội bộ để xử lý logic xoay vòng key.
     * @param isForced Cho biết việc xoay vòng có phải do bị ép buộc (lỗi 429) hay không.
     * @returns true nếu xoay vòng thành công, false nếu hết key.
     */
    private async rotate(isForced: boolean): Promise<boolean> {
        const oldIndex = this.currentIndex;
        this.logger.warn({
            oldKeyIndex: oldIndex + 1,
            reason: isForced ? 'Error (e.g., 429)' : 'Usage Limit Reached',
            event: 'rotation_start'
        }, `Attempting ${isForced ? 'forced ' : ''}rotation to next API key.`);

        this.currentIndex++;
        this.currentUsage = 0; // Reset usage khi xoay

        if (this.currentIndex >= this.keys.length) {
            this.logger.warn({
                rotationType: isForced ? 'forced' : 'normal',
                event: 'rotation_failed_exhausted'
            }, "Rotation failed: Reached end of API key list. Marking all keys as exhausted.");
            this.isExhausted = true;
            return false;
        }

        this.logger.info({
            newKeyIndex: this.currentIndex + 1,
            rotationType: isForced ? 'forced' : 'normal',
            event: 'rotation_success'
        }, "Successfully rotated to new API key.");
        return true;
    }

    // --- Getters để lấy trạng thái (read-only) ---
    public getCurrentKeyIndex(): number {
        return this.currentIndex;
    }

    public getCurrentKeyUsage(): number {
        return this.currentUsage;
    }

    public getTotalRequests(): number {
        return this.totalRequestsInternal;
    }

    public areAllKeysExhausted(): boolean {
        return this.isExhausted;
    }
}

// ============================================
// Hàm Crawl Chính
// ============================================
export const crawlConferences = async (
    conferenceList: ConferenceData[],
    parentLogger: typeof logger
): Promise<(ProcessedResponseData | null)[]> => {
    const QUEUE = await queuePromise;

    const finalResults: (ProcessedResponseData | null)[] = new Array(conferenceList.length).fill(null);

    const operationStartTime = Date.now();
    parentLogger.info({
        event: 'crawl_start',
        totalConferences: conferenceList.length,
        startTime: new Date(operationStartTime).toISOString()
    }, 'Starting crawlConferences process');

    let playwrightBrowser: Browser | null = null;

    // --- Khởi tạo API Key Manager ---
    // Trạng thái key giờ được quản lý trong instance này
    const apiKeyManager = new ApiKeyManager(
        GOOGLE_CUSTOM_SEARCH_API_KEYS,
        MAX_USAGE_PER_KEY,
        KEY_ROTATION_DELAY_MS,
        parentLogger // Truyền logger cha vào manager
    );
    // --- Không cần khởi tạo biến global nữa ---

    let successfulBatchOperations = 0;
    let failedBatchOperations = 0;

    // --- Xóa file output cũ ---
    try {
        if (fs.existsSync(FINAL_OUTPUT_PATH)) {
            parentLogger.warn({ path: FINAL_OUTPUT_PATH, event: 'delete_old_output' }, 'Deleting existing final output file.');
            await fs.promises.unlink(FINAL_OUTPUT_PATH);
        }
        if (fs.existsSync(EVALUATE_CSV_PATH)) {
            parentLogger.warn({ path: EVALUATE_CSV_PATH, event: 'delete_old_output' }, 'Deleting existing final CSV file.');
            await fs.promises.unlink(EVALUATE_CSV_PATH);
        }
    } catch (unlinkError: any) {
        parentLogger.error({ err: unlinkError, path: FINAL_OUTPUT_PATH, event: 'delete_old_output_failed' }, 'Could not delete existing output files.');
    }
    // ---

    const batchPromises: Promise<void>[] = []; // Chỉ chứa promise từ saveBatchToFile

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
        const batchesDir = path.join(__dirname, "./data/batches");

        // --- Tạo thư mục ---
        try {
            parentLogger.debug({ customSearchPath, sourceRankPath, batchesDir, event: 'ensure_dirs' }, 'Ensuring output directories exist');
            const dirsToEnsure = [customSearchPath, sourceRankPath, path.dirname(FINAL_OUTPUT_PATH), batchesDir];
            for (const dir of dirsToEnsure) {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                    parentLogger.info({ path: dir, event: 'dir_created' }, 'Created directory');
                }
            }
        } catch (mkdirError: any) {
            parentLogger.error({ err: mkdirError, event: 'dir_create_error' }, "Error creating directories");
            throw mkdirError;
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
                const taskLogger = parentLogger.child({ title: confTitle, acronym: confAcronym, taskIndex: index + 1, event_group: 'conference_task' });
                taskLogger.info({ event: 'task_start' }, `Processing conference`);
                let taskResult: ProcessedResponseData | null = null;

                try {
                    // --- Luồng UPDATE ---
                    if (conference.mainLink && conference.cfpLink && conference.impLink) {
                        taskLogger.info({ event: 'process_predefined_links_start' }, `Processing with pre-defined links (UPDATE flow)`);
                        const conferenceUpdateData: ConferenceUpdateData = { Acronym: conference.Acronym, Title: conference.Title, mainLink: conference.mainLink || "", cfpLink: conference.cfpLink || "", impLink: conference.impLink || "" };
                        try {
                            taskResult = await updateHTMLContent(browserCtx, conferenceUpdateData, batchIndexRef, taskLogger); // Truyền taskLogger
                            taskLogger.info({ event: 'process_predefined_links_success', hasResult: taskResult !== null }, "Predefined links processing step completed.");
                        } catch (updateError: any) {
                            taskLogger.error({ err: updateError, event: 'process_predefined_links_failed' }, "Error during predefined links processing.");
                            taskResult = null;
                        }
                        // --- Luồng SAVE (Search) ---
                    } else {
                        taskLogger.info({ event: 'search_and_process_start' }, `Searching and processing (SAVE flow)`);
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
                            // Kiểm tra xem còn key không *trước khi* lấy key
                            if (apiKeyManager.areAllKeysExhausted()) {
                                taskLogger.warn({ attempt, event: 'search_skip_all_keys_exhausted' }, `Skipping Google Search attempt ${attempt} - All API keys exhausted.`);
                                lastSearchError = new Error("All API keys exhausted during search attempts.");
                                break; // Thoát vòng lặp tìm kiếm
                            }

                            // Lấy key từ manager
                            const apiKey = await apiKeyManager.getNextKey();

                            if (!apiKey) {
                                // Trường hợp này không nên xảy ra nếu check areAllKeysExhausted() ở trên, nhưng để an toàn
                                taskLogger.warn({ attempt, event: 'search_skip_no_key' }, `Skipping Google Search attempt ${attempt} - Failed to get valid API key (likely exhausted).`);
                                lastSearchError = new Error("Failed to get API key for search attempt.");
                                if (!apiKeyManager.areAllKeysExhausted()) {
                                    // Nếu manager chưa tự đánh dấu hết hạn, đánh dấu ở đây (dù hơi thừa)
                                    taskLogger.error({ event: 'unexpected_no_key' }, "Unexpected: getNextKey returned null but manager not marked exhausted.")
                                }
                                break; // Thoát vòng lặp tìm kiếm
                            }

                            taskLogger.info({
                                attempt,
                                maxAttempts: MAX_SEARCH_RETRIES + 1,
                                keyIndex: apiKeyManager.getCurrentKeyIndex() + 1, // Lấy index từ manager
                                totalRequestsNow: apiKeyManager.getTotalRequests(), // Lấy total từ manager
                                event: 'search_attempt'
                            }, `Attempting Google Search (Attempt ${attempt}/${MAX_SEARCH_RETRIES + 1})`);

                            try {
                                searchResults = await searchGoogleCSE(apiKey, GOOGLE_CSE_ID!, searchQuery);
                                searchSuccess = true;
                                taskLogger.info({
                                    keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
                                    usageOnKey: apiKeyManager.getCurrentKeyUsage(), // Lấy usage từ manager
                                    attempt,
                                    resultsCount: searchResults.length,
                                    event: 'search_success'
                                }, `Google Search successful on attempt ${attempt}`);
                                break; // Thoát vòng lặp khi thành công

                            } catch (searchError: any) {
                                lastSearchError = searchError; // Lưu lỗi cuối cùng
                                const status = searchError.details?.status || searchError.code || 'Unknown';
                                const googleErrorCode = searchError.details?.googleErrorCode || 'N/A';
                                const isQuotaError = status === 429 || googleErrorCode === 429 || status === 403 || googleErrorCode === 403 || searchError.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'quotaExceeded' || e.reason === 'forbidden');

                                taskLogger.warn({
                                    attempt,
                                    maxAttempts: MAX_SEARCH_RETRIES + 1,
                                    keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
                                    err: searchError.message, // Log message cho ngắn gọn hơn
                                    status: status,
                                    googleErrorCode: googleErrorCode,
                                    isQuotaError: isQuotaError,
                                    event: 'search_attempt_failed'
                                }, `Google Search attempt ${attempt} failed`);

                                // Xử lý Quota Error và xoay key
                                if (isQuotaError && attempt <= MAX_SEARCH_RETRIES) {
                                    taskLogger.warn({ attempt, keyIndex: apiKeyManager.getCurrentKeyIndex() + 1, event: 'search_quota_error_detected' }, `Quota/Rate limit error detected. Forcing API key rotation.`);
                                    const rotated = await apiKeyManager.forceRotate(); // Gọi forceRotate từ manager
                                    if (!rotated) {
                                        taskLogger.error({ event: 'search_key_rotation_failed_post_quota' }, "Failed to rotate key after quota error (all keys likely exhausted), stopping retries for this conference.");
                                        break; // Dừng retry nếu không xoay được key
                                    }
                                    // Không cần delay ở đây, delay sẽ áp dụng *trước* lần thử tiếp theo nếu cần
                                }

                                // Log khi hết số lần thử
                                if (attempt > MAX_SEARCH_RETRIES) {
                                    taskLogger.error({ finalAttempt: attempt, err: searchError.message, status: status, googleErrorCode: googleErrorCode, event: 'search_failed_max_retries' }, `Google Search failed after maximum ${MAX_SEARCH_RETRIES + 1} retries.`);
                                }
                                // Chỉ retry nếu *chưa* hết key VÀ còn lượt thử
                                else if (!apiKeyManager.areAllKeysExhausted()) {
                                    taskLogger.info({ attempt, delaySeconds: RETRY_DELAY_MS / 1000, event: 'search_retry_wait' }, `Waiting ${RETRY_DELAY_MS / 1000}s before retry attempt ${attempt + 1}...`);
                                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                                } else {
                                    // Nếu hết key thì không cần chờ retry nữa, vòng lặp sẽ break ở lần check đầu tiên tiếp theo
                                    taskLogger.warn({ attempt, event: 'search_retry_skip_exhausted' }, "Skipping wait/retry as all keys are exhausted.");
                                }
                            }
                        } // Kết thúc for loop search

                        // --- Xử lý kết quả Search ---
                        if (searchSuccess) {
                            const filteredResults = filterSearchResults(searchResults, UNWANTED_DOMAINS, SKIP_KEYWORDS);
                            const limitedResults = filteredResults.slice(0, MAX_LINKS || 4); // Lấy tối đa MAX_LINKS hoặc 4 nếu không định nghĩa
                            searchResultsLinks = limitedResults.map(res => res.link);
                            taskLogger.info({ rawResults: searchResults.length, filteredCount: filteredResults.length, limitedCount: searchResultsLinks.length, event: 'search_results_filtered' }, `Filtered search results`);

                            // Ghi file links (tùy chọn)
                            const allLinks = searchResults.map(result => result.link);
                            const allLinksOutputPath = path.join(customSearchPath, `${confAcronym.replace(/[^a-zA-Z0-9_.-]/g, '-')}_links.json`);
                            try {
                                taskLogger.debug({ path: allLinksOutputPath, count: allLinks.length, event: 'write_search_links' }, 'Writing all search result links to file');
                                await fs.promises.writeFile(allLinksOutputPath, JSON.stringify(allLinks, null, 2), "utf8");
                            } catch (writeLinksError: any) {
                                taskLogger.warn({ err: writeLinksError, path: allLinksOutputPath, event: 'write_search_links_failed' }, `Could not write search result links file`);
                            }
                        } else {
                            // Log lỗi cuối cùng nếu search không thành công sau tất cả các lần thử
                            taskLogger.error({ err: lastSearchError?.message || 'Unknown search error', details: lastSearchError?.details, event: 'search_ultimately_failed' }, "Google Search ultimately failed for this conference.");
                            searchResultsLinks = []; // Đảm bảo links rỗng
                        }
                        // --------------------------

                        // --- Lưu HTML Content (Luồng Save) ---
                        if (searchResultsLinks.length > 0) {
                            // taskLogger.info({ linksToCrawl: searchResultsLinks.length, event: 'save_html_start' }, `Attempting to save HTML content for found links`);
                            try {
                                // saveHTMLContent đẩy promise vào batchPromises
                                await saveHTMLContent(browserCtx, conference, searchResultsLinks, batchIndexRef, existingAcronyms, batchPromises, YEAR2, taskLogger); // Truyền taskLogger
                                taskLogger.info({ event: 'save_html_step_enqueued' }, 'Save HTML content task enqueued/processed.'); // Lưu ý: Bước này có thể không đồng bộ hoàn toàn
                            } catch (saveError: any) {
                                taskLogger.error({ err: saveError, event: 'save_html_failed' }, 'Error occurred during the save HTML content step');
                            }
                        } else {
                            taskLogger.warn({ event: 'save_html_skipped_no_links' }, "Skipping save HTML step as no valid search links were found or processed.")
                        }
                        // Luồng SAVE không trả về dữ liệu trực tiếp cho finalResults
                        taskResult = null;
                    } // End else (SAVE flow)

                } catch (taskError: any) {
                    taskLogger.error({ err: taskError, stack: taskError.stack, event: 'task_unhandled_error' }, `Unhandled error processing conference task`);
                    taskResult = null; // Đảm bảo null nếu có lỗi không mong muốn
                } finally {
                    taskLogger.info({ event: 'task_finish', hasResult: taskResult !== null }, `Finished processing queue item for ${confAcronym}`);
                    // Gán kết quả vào mảng finalResults tại đúng vị trí index (chỉ có ý nghĩa cho luồng UPDATE)
                    finalResults[index] = taskResult;
                    // Không cần return taskResult vì Promise.all không dùng giá trị trả về trực tiếp ở đây

                }

            }); // Kết thúc QUEUE.add

        }); // Kết thúc map conferenceList

        // --- Chờ tất cả các Task trong Queue hoàn thành ---
        parentLogger.info({ event: 'queue_tasks_await_start', taskCount: conferenceTasks.length }, "Waiting for all conference processing tasks in queue to complete...");
        await Promise.all(conferenceTasks); // Chờ tất cả các task trong queue xong
        parentLogger.info({ event: 'queue_tasks_await_end' }, "All conference processing tasks in queue finished.");
        // Mảng finalResults đã được điền bởi các task (chủ yếu là null cho luồng SAVE, có giá trị cho UPDATE)

        // --- Chờ và Xử lý Kết quả Batch Promises (CHỈ CHO LUỒNG SAVE) ---
        if (batchPromises.length > 0) {
            parentLogger.info({ promiseCount: batchPromises.length, event: 'save_batch_settlement_start' }, "Waiting for SAVE batch operations (saveBatchToFile) to settle...");
            const settledSaveResults = await Promise.allSettled(batchPromises);
            parentLogger.info({ event: 'save_batch_settlement_finished' }, "SAVE batch operations settled. Checking results...");

            settledSaveResults.forEach((result, i) => {
                const batchLogContext = { batchPromiseIndex: i, flow: 'save' };
                if (result.status === 'fulfilled') {
                    successfulBatchOperations++;
                } else {
                    failedBatchOperations++;
                    parentLogger.error({ ...batchLogContext, reason: result.reason, status: result.status, event: 'batch_operation_settled_failed' }, "SAVE Batch operation rejected.");
                }
            });
            parentLogger.info({
                successfulOperations: successfulBatchOperations,
                failedOperations: failedBatchOperations,
                totalOperations: settledSaveResults.length,
                event: 'save_batch_settlement_summary'
            }, "Finished checking SAVE batch results.");
        } else {
            parentLogger.info({ event: 'save_batch_settlement_skipped' }, "No SAVE batch operations (saveBatchToFile) were initiated.")
        }
        // ---

        // --- Final Output Processing (CSV Streaming) ---
        parentLogger.info({ event: 'final_output_processing_start' }, "Processing final outputs (Streaming JSONL to CSV)...");
        if (fs.existsSync(FINAL_OUTPUT_PATH)) {
            try {
                const fileStat = await fs.promises.stat(FINAL_OUTPUT_PATH);
                if (fileStat.size > 0) {
                    parentLogger.info({ jsonlPath: FINAL_OUTPUT_PATH, csvPath: EVALUATE_CSV_PATH, event: 'csv_stream_call_start' }, 'Starting CSV streaming from JSONL file.');
                    await writeCSVStream(FINAL_OUTPUT_PATH, EVALUATE_CSV_PATH, parentLogger); // Truyền parentLogger
                    parentLogger.info({ csvPath: EVALUATE_CSV_PATH, event: 'csv_stream_call_success' }, 'CSV streaming completed.');
                } else {
                    parentLogger.warn({ path: FINAL_OUTPUT_PATH, event: 'csv_stream_skipped_empty_jsonl' }, 'Skipping CSV generation: Final output file is empty.');
                }
            } catch (csvStreamError: any) {
                parentLogger.error({ err: csvStreamError, event: 'csv_stream_call_failed' }, `CSV streaming process failed`);
            }
        } else {
            parentLogger.warn({ path: FINAL_OUTPUT_PATH, event: 'csv_stream_skipped_no_jsonl' }, 'Skipping CSV generation: Final output file does not exist.');
        }
        // ---

        // --- TRẢ VỀ MẢNG KẾT QUẢ (Chủ yếu từ luồng UPDATE) ---
        const validResultsCount = finalResults.filter(r => r !== null).length;
        parentLogger.info({ event: 'crawl_return_results', resultsCount: validResultsCount }, `Returning ${validResultsCount} processed results (primarily from UPDATE flow).`);
        return finalResults; // Trả về mảng chứa kết quả từ updateHTMLContent hoặc null

    } catch (error: any) {
        parentLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during crawling process");
        // Ném lại lỗi để báo hiệu quá trình thất bại hoàn toàn
        throw error;
    } finally {
        // --- Cleanup ---
        parentLogger.info({ event: 'cleanup_start' }, "Performing final cleanup...");
        try {
            await cleanupTempFiles(); // Dọn dẹp file tạm
            parentLogger.info({ event: 'cleanup_temp_files_success' }, "Temporary files cleanup successful.")
        } catch (cleanupErr: any) {
            parentLogger.error({ err: cleanupErr, event: 'cleanup_temp_files_failed' }, "Error during temporary file cleanup.");
        }
        if (playwrightBrowser) {
            parentLogger.info({ event: 'playwright_close_start' }, "Closing Playwright browser...");
            try {
                await playwrightBrowser.close();
                parentLogger.info({ event: 'playwright_close_success' }, "Playwright browser closed.");
            } catch (e: any) {
                parentLogger.error({ err: e, event: 'playwright_close_failed' }, "Error closing Playwright browser");
            }
        } else {
            parentLogger.info({ event: 'playwright_close_skipped' }, "Playwright browser was not initialized or already closed.");
        }

        // --- Log tổng kết ---
        const operationEndTime = Date.now();
        const durationSeconds = Math.round((operationEndTime - operationStartTime) / 1000);
        let finalRecordCount = 0;
        try {
            if (fs.existsSync(FINAL_OUTPUT_PATH)) {
                const content = await fs.promises.readFile(FINAL_OUTPUT_PATH, 'utf8');
                finalRecordCount = content.split('\n').filter(l => l.trim()).length;
            }
        } catch (readError: any) {
            parentLogger.warn({ err: readError, path: FINAL_OUTPUT_PATH, event: 'final_count_read_error' }, "Could not read final output file to count records.")
        }

        parentLogger.info({
            event: 'crawl_summary',
            totalConferencesInput: conferenceList.length,
            successfulSaveBatchOps: successfulBatchOperations,
            failedSaveBatchOps: failedBatchOperations,
            totalSaveBatchOpsAttempted: batchPromises.length, // Tổng số batch save đã được tạo
            finalRecordsInJsonl: finalRecordCount, // Số dòng trong file JSONL cuối (từ save)
            resultsReturned: finalResults.filter(r => r !== null).length, // Số kết quả không null trả về (từ update)
            totalGoogleApiRequests: apiKeyManager.getTotalRequests(), // Lấy tổng request từ manager
            keysExhausted: apiKeyManager.areAllKeysExhausted(), // Trạng thái cuối cùng của keys
            durationSeconds,
            startTime: new Date(operationStartTime).toISOString(),
            endTime: new Date(operationEndTime).toISOString()
        }, "Crawling process summary");

        parentLogger.info({ event: 'crawl_end_success' }, "crawlConferences process finished.");
        // --- Hết Cleanup ---
    }
};