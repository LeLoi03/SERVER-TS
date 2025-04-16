
// // src/journal/crawlJournals.ts 

// import { chromium, Browser, BrowserContext, Page } from 'playwright';
// import fs from 'fs';
// import path from 'path';
// import { logger } from './utils'; // Assuming base logger is exported from here

// // Import the ApiKeyManager class
// // ============================================
// // Lớp quản lý API Key
// // ============================================
// class ApiKeyManager {
//   private readonly keys: readonly string[];
//   private readonly maxUsagePerKey: number;
//   private readonly rotationDelayMs: number;
//   private readonly logger: typeof logger; // Pino logger instance

//   private currentIndex: number = 0;
//   private currentUsage: number = 0;
//   private totalRequestsInternal: number = 0;
//   private isExhausted: boolean = false;

//   constructor(keys: string[] | undefined, maxUsage: number, delayMs: number, parentLogger: typeof logger) {
//     this.keys = Object.freeze([...(keys || [])]); // Tạo bản sao không thể thay đổi
//     this.maxUsagePerKey = maxUsage;
//     this.rotationDelayMs = delayMs;
//     this.logger = parentLogger.child({ service: 'ApiKeyManager' }); // Logger riêng

//     if (this.keys.length === 0) {
//       const errMsg = "CRITICAL: No Google API Keys provided to ApiKeyManager. Searches will fail.";
//       this.logger.error({ event: 'init_error' }, errMsg);
//       console.error(`[ApiKeyManager][init_error] ${errMsg}`); // CONSOLE ADDED
//       this.isExhausted = true;
//     } else {
//       const msg = `ApiKeyManager initialized. Key Count: ${this.keys.length}, Max Usage/Key: ${this.maxUsagePerKey}`;
//       this.logger.info({ keyCount: this.keys.length, maxUsage: this.maxUsagePerKey, event: 'init_success' }, msg);
//       console.info(`[ApiKeyManager][init_success] ${msg}`); // CONSOLE ADDED
//     }
//   }

//   /**
//    * Lấy API Key tiếp theo. Tự động xoay vòng khi đạt giới hạn sử dụng
//    * hoặc khi được yêu cầu bởi forceRotate.
//    * @returns API key hoặc null nếu tất cả các key đã hết hạn.
//    */
//   public async getNextKey(): Promise<string | null> {
//     if (this.isExhausted) {
//       // Log đã được ghi khi isExhausted được set hoặc khi rotation failed
//       // console.warn('[ApiKeyManager][getNextKey] Attempted to get key, but all keys are exhausted.'); // Optional console log here
//       return null;
//     }

//     // Kiểm tra giới hạn sử dụng và xoay vòng nếu cần
//     if (this.currentUsage >= this.maxUsagePerKey && this.keys.length > 0) {
//       const logMsg = `API key usage limit reached (Key #${this.currentIndex + 1}: ${this.currentUsage}/${this.maxUsagePerKey}), attempting rotation.`;
//       this.logger.info({
//         keyIndex: this.currentIndex + 1,
//         usage: this.currentUsage,
//         limit: this.maxUsagePerKey,
//         event: 'usage_limit_reached'
//       }, logMsg);
//       // console.info(`[ApiKeyManager][usage_limit_reached] ${logMsg}`); // CONSOLE ADDED

//       const rotated = await this.rotate(false); // Xoay vòng bình thường
//       if (!rotated) {
//         // this.isExhausted đã được set bên trong rotate()
//         // Logging done inside rotate()
//         return null;
//       }

//       // Áp dụng delay *sau khi* xoay vòng thành công (nếu được cấu hình)
//       if (this.rotationDelayMs > 0) {
//         const delaySeconds = this.rotationDelayMs / 1000;
//         const waitMsgStart = `Waiting ${delaySeconds}s after normal key rotation (next key #${this.currentIndex + 1})...`;
//         this.logger.info({
//           delaySeconds: delaySeconds,
//           nextKeyIndex: this.currentIndex + 1,
//           event: 'rotation_delay_start'
//         }, waitMsgStart);
//         // console.info(`[ApiKeyManager][rotation_delay_start] ${waitMsgStart}`); // CONSOLE ADDED

//         await new Promise(resolve => setTimeout(resolve, this.rotationDelayMs));

//         const waitMsgEnd = `Finished waiting, proceeding with new key #${this.currentIndex + 1}.`;
//         this.logger.info({ newKeyIndex: this.currentIndex + 1, event: 'rotation_delay_end' }, waitMsgEnd);
//         // console.info(`[ApiKeyManager][rotation_delay_end] ${waitMsgEnd}`); // CONSOLE ADDED
//       }
//     }

//     // Lấy key hiện tại, tăng số lượt sử dụng và trả về
//     const key = this.keys[this.currentIndex];
//     this.currentUsage++;
//     this.totalRequestsInternal++;

//     const provideMsg = `Providing API key #${this.currentIndex + 1} (Usage: ${this.currentUsage}/${this.maxUsagePerKey}, Total Requests: ${this.totalRequestsInternal})`;
//     this.logger.debug({
//       keyIndex: this.currentIndex + 1,
//       currentUsage: this.currentUsage,
//       limit: this.maxUsagePerKey,
//       totalRequests: this.totalRequestsInternal,
//       event: 'key_provided'
//     }, provideMsg);
//     // Using console.log for debug level, as console.debug might be filtered by default
//     // console.log(`[ApiKeyManager][key_provided] ${provideMsg}`); // CONSOLE ADDED (using console.log)

//     return key;
//   }

//   /**
//    * Buộc xoay vòng sang API key tiếp theo, thường dùng khi gặp lỗi 429.
//    * @returns true nếu xoay vòng thành công, false nếu đã hết key.
//    */
//   public async forceRotate(): Promise<boolean> {
//     if (this.isExhausted) {
//       const warnMsg = "Cannot force rotate key, all keys are already marked as exhausted.";
//       this.logger.warn({ event: 'force_rotate_skipped' }, warnMsg);
//       // console.warn(`[ApiKeyManager][force_rotate_skipped] ${warnMsg}`); // CONSOLE ADDED
//       return false;
//     }
//     // Log đã được thực hiện bên trong hàm rotate
//     return this.rotate(true); // Gọi hàm xoay nội bộ (là force)
//   }

//   /**
//    * Hàm nội bộ để xử lý logic xoay vòng key.
//    * @param isForced Cho biết việc xoay vòng có phải do bị ép buộc (lỗi 429) hay không.
//    * @returns true nếu xoay vòng thành công, false nếu hết key.
//    */
//   private async rotate(isForced: boolean): Promise<boolean> {
//     const oldIndex = this.currentIndex;
//     const reason = isForced ? 'Error (e.g., 429)' : 'Usage Limit Reached';
//     const rotationType = isForced ? 'forced' : 'normal';
//     const startMsg = `Attempting ${rotationType} rotation to next API key (from #${oldIndex + 1}). Reason: ${reason}.`;

//     this.logger.warn({
//       oldKeyIndex: oldIndex + 1,
//       reason: reason,
//       event: 'rotation_start'
//     }, startMsg);
//     // console.warn(`[ApiKeyManager][rotation_start] ${startMsg}`); // CONSOLE ADDED

//     this.currentIndex++;
//     this.currentUsage = 0; // Reset usage khi xoay

//     if (this.currentIndex >= this.keys.length) {
//       const failMsg = `Rotation failed: Reached end of API key list (${this.keys.length} keys). Marking all keys as exhausted.`;
//       this.logger.warn({
//         rotationType: rotationType,
//         event: 'rotation_failed_exhausted'
//       }, failMsg);
//       // console.warn(`[ApiKeyManager][rotation_failed_exhausted] ${failMsg}`); // CONSOLE ADDED
//       this.isExhausted = true;
//       return false;
//     }

//     const successMsg = `Successfully ${rotationType} rotated to new API key #${this.currentIndex + 1}.`;
//     this.logger.info({
//       newKeyIndex: this.currentIndex + 1,
//       rotationType: rotationType,
//       event: 'rotation_success'
//     }, successMsg);
//     // console.info(`[ApiKeyManager][rotation_success] ${successMsg}`); // CONSOLE ADDED
//     return true;
//   }

//   // --- Getters để lấy trạng thái (read-only) ---
//   public getCurrentKeyIndex(): number {
//     return this.currentIndex;
//   }

//   public getCurrentKeyUsage(): number {
//     return this.currentUsage;
//   }

//   public getTotalRequests(): number {
//     return this.totalRequestsInternal;
//   }

//   public areAllKeysExhausted(): boolean {
//     return this.isExhausted;
//   }
// }

// // --- Assume these imports are correct ---
// import {
//   MAX_TABS,
//   JOURNAL_CRAWL_BIOXBIO,
//   JOURNAL_CRAWL_DETAILS,
//   JOURNAL_CSV_HEADERS,
//   BASE_URL,
//   HEADLESS, CHANNEL,
//   JOURNAL_CRAWL_MODE,
//   USER_AGENT,
//   // Import shared config for API keys
//   GOOGLE_CUSTOM_SEARCH_API_KEYS,
//   GOOGLE_CSE_ID,
//   MAX_USAGE_PER_KEY,
//   KEY_ROTATION_DELAY_MS,
// } from '../config';
// import { processPage, fetchDetails, getImageUrlAndDetails, getLastPageNumber } from './scimagojr';
// import { fetchBioxbioData } from './bioxbio';
// import { createURLList, readCSV } from './utils';

// // --- Types ---
// import { TableRowData, JournalDetails, CSVRow } from './types';

// // --- Paths ---
// export const INPUT_CSV: string = path.join(__dirname, './csv/import_journal.csv');
// export const OUTPUT_JSON: string = path.join(__dirname, './data/journal_list.json');

// // ============================================
// // Hàm Crawl Chính cho Journals
// // ============================================
// export const crawlJournals = async (
//   parentLogger: typeof logger // Base logger instance
// ): Promise<void> => {

//   const journalLogger = parentLogger.child({ service: 'crawlJournals' }); // Create a logger specific to this function
//   const initMsg = `Initializing journal crawl... Mode: ${JOURNAL_CRAWL_MODE}`;
//   journalLogger.info({ event: 'init_start', mode: JOURNAL_CRAWL_MODE }, initMsg);
//   // console.info(`[crawlJournals][init_start] ${initMsg}`); // CONSOLE ADDED

//   // --- Khởi tạo API Key Manager (RIÊNG BIỆT cho Journal Crawling) ---
//   // console.log("[crawlJournals] Initializing ApiKeyManager for journal crawling..."); // CONSOLE ADDED
//   const apiKeyManager = new ApiKeyManager(
//     GOOGLE_CUSTOM_SEARCH_API_KEYS,
//     MAX_USAGE_PER_KEY,
//     KEY_ROTATION_DELAY_MS,
//     journalLogger // Pass the specific logger instance
//   );

//   if (apiKeyManager.areAllKeysExhausted()) {
//     // Logged internally by ApiKeyManager constructor + console
//     const noKeyMsg = "Journal crawl cannot proceed without Google API Keys.";
//     journalLogger.error({ event: 'init_fail_no_keys' }, noKeyMsg);
//     // console.error(`[crawlJournals][init_fail_no_keys] ${noKeyMsg}`); // CONSOLE ADDED
//     return []; // Return empty array if no keys
//   }


//   // --- Declare variables outside the try block ---
//   let browser: Browser | null = null;
//   const operationStartTime = Date.now();
//   let allJournalData: JournalDetails[] = [];
//   let processedCount = 0;
//   let failedImageSearchCount = 0;
//   let skippedImageSearchCount = 0;
//   let completedTasks = 0; // Track pages/rows processed by loops
//   let totalTasks = 0;


//   try {
//     const browserStartMsg = `Launching browser... Headless: ${HEADLESS}, Channel: ${CHANNEL || 'default'}`;
//     journalLogger.info({ event: 'browser_launch_start', headless: HEADLESS, channel: CHANNEL }, browserStartMsg);
//     // console.info(`[crawlJournals][browser_launch_start] ${browserStartMsg}`); // CONSOLE ADDED
//     browser = await chromium.launch({
//       channel: CHANNEL,
//       headless: HEADLESS, // Use HEADLESS from config
//       args: [
//         "--disable-notifications", "--disable-geolocation", "--disable-extensions",
//         "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
//         "--blink-settings=imagesEnabled=false", "--ignore-certificate-errors"
//       ],
//     });
//     journalLogger.info({ event: 'browser_launch_success' }, "Browser launched.");
//     // console.info(`[crawlJournals][browser_launch_success] Browser launched.`); // CONSOLE ADDED

//     journalLogger.info({ event: 'context_create_start' }, "Creating browser context...");
//     // console.info(`[crawlJournals][context_create_start] Creating browser context...`); // CONSOLE ADDED
//     const browserContext: BrowserContext = await browser.newContext({
//       permissions: [],
//       viewport: { width: 1280, height: 720 },
//       ignoreHTTPSErrors: true,
//       extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
//       userAgent: USER_AGENT,
//     });
//     journalLogger.info({ event: 'context_create_success' }, "Browser context created.");
//     // console.info(`[crawlJournals][context_create_success] Browser context created.`); // CONSOLE ADDED

//     const pagesStartMsg = `Creating ${MAX_TABS} pages...`;
//     journalLogger.info({ event: 'pages_create_start', count: MAX_TABS }, pagesStartMsg);
//     // console.info(`[crawlJournals][pages_create_start] ${pagesStartMsg}`); // CONSOLE ADDED
//     const pages: Page[] = await Promise.all(Array.from({ length: MAX_TABS }, (_, i) => {
//       journalLogger.debug({ event: 'page_create', pageIndex: i + 1 });
//       // console.log(`[crawlJournals][page_create] Creating page index ${i + 1}`); // CONSOLE ADDED (using console.log for debug)
//       return browserContext.newPage();
//     }));
//     const pagesEndMsg = `Created ${pages.length} pages.`;
//     journalLogger.info({ event: 'pages_create_success', count: pages.length }, pagesEndMsg);
//     // console.info(`[crawlJournals][pages_create_success] ${pagesEndMsg}`); // CONSOLE ADDED

//     // --- Shared Image Search Logic ---
//     const performImageSearch = async (
//       taskLogger: typeof journalLogger, // Use the specific child logger type
//       details: JournalDetails | null,
//       row: TableRowData | CSVRow,
//       journalData: JournalDetails
//     ): Promise<void> => {
//       const journalTitle = journalData.title || (row as CSVRow)?.Title || (row as TableRowData)?.journalName || 'Unknown Journal';
//       const searchStartMsg = `Attempting image search for "${journalTitle}".`;
//       taskLogger.info({ event: 'image_search_start', journalTitle }, searchStartMsg);
//       // console.info(`[ImageSearch][image_search_start] ${searchStartMsg}`); // CONSOLE ADDED

//       if (apiKeyManager.areAllKeysExhausted()) {
//         const skipExhaustedMsg = `Skipping image search for "${journalTitle}" - All API keys exhausted.`;
//         taskLogger.warn({ event: 'image_search_skip_exhausted', journalTitle }, skipExhaustedMsg);
//         // console.warn(`[ImageSearch][image_search_skip_exhausted] ${skipExhaustedMsg}`); // CONSOLE ADDED
//         skippedImageSearchCount++;
//         return;
//       }

//       const apiKey = await apiKeyManager.getNextKey(); // Logging done inside getNextKey
//       if (!apiKey) {
//         const skipNoKeyMsg = `Skipping image search for "${journalTitle}" - Failed to get API key (exhausted).`;
//         taskLogger.warn({ event: 'image_search_skip_no_key', journalTitle }, skipNoKeyMsg);
//         // console.warn(`[ImageSearch][image_search_skip_no_key] ${skipNoKeyMsg}`); // CONSOLE ADDED
//         skippedImageSearchCount++;
//         if (!apiKeyManager.areAllKeysExhausted()) {
//           const anomalyMsg = "ApiKeyManager anomaly: getNextKey returned null but not marked exhausted.";
//           taskLogger.error({ event: 'unexpected_no_key_journal', journalTitle }, anomalyMsg);
//           // console.error(`[ImageSearch][unexpected_no_key_journal] ${anomalyMsg} (Journal: "${journalTitle}")`); // CONSOLE ADDED
//         }
//         return;
//       }

//       const cseId = GOOGLE_CSE_ID!;
//       const currentKeyIndex = apiKeyManager.getCurrentKeyIndex() + 1;
//       const currentUsage = apiKeyManager.getCurrentKeyUsage();
//       const attemptMsg = `Performing image search for "${journalTitle}" using key #${currentKeyIndex} (Usage: ${currentUsage}/${MAX_USAGE_PER_KEY})`;
//       taskLogger.info({
//         event: 'image_search_attempt',
//         journalTitle,
//         keyIndex: currentKeyIndex,
//         usageOnKey: currentUsage,
//       }, attemptMsg);
//       // console.info(`[ImageSearch][image_search_attempt] ${attemptMsg}`); // CONSOLE ADDED

//       try {
//         // Pass logger down if the function accepts it
//         // Ensure getImageUrlAndDetails is updated to accept logger
//         // const { Image, Image_Context } = await getImageUrlAndDetails(details, row, apiKey, cseId , taskLogger );
//         const { Image, Image_Context } = await getImageUrlAndDetails(details, row, apiKey, cseId); // Assuming it doesn't need logger for now
//         journalData.Image = Image;
//         journalData.Image_Context = Image_Context;
//         const successMsg = `Image search successful for "${journalTitle}". Image Found: ${!!Image}`;
//         taskLogger.info({ event: 'image_search_success', journalTitle, hasImage: !!Image }, successMsg);
//         // console.info(`[ImageSearch][image_search_success] ${successMsg}`); // CONSOLE ADDED
//       } catch (searchError: any) {
//         failedImageSearchCount++;
//         const errMsg = `Image search failed for "${journalTitle}"`;
//         taskLogger.error({ err: searchError, event: 'image_search_failed', journalTitle }, errMsg);
//         // console.error(`[ImageSearch][image_search_failed] ${errMsg}:`, searchError.message || searchError); // CONSOLE ADDED (log error object too)

//         const statusCode = searchError?.response?.status || searchError?.status || searchError?.statusCode; // More robust status code check
//         const isQuotaError = statusCode === 429 || statusCode === 403 || searchError?.message?.includes('Quota exceeded'); // Check message too

//         if (isQuotaError) {
//           const quotaMsg = `Quota/Rate limit error (Status: ${statusCode || 'N/A'}) detected during image search for "${journalTitle}". Forcing key rotation (Key #${currentKeyIndex}).`;
//           taskLogger.warn({
//             event: 'image_search_quota_error',
//             journalTitle,
//             keyIndex: currentKeyIndex,
//             statusCode: statusCode || 'N/A'
//           }, quotaMsg);
//           // console.warn(`[ImageSearch][image_search_quota_error] ${quotaMsg}`); // CONSOLE ADDED
//           await apiKeyManager.forceRotate(); // Logging done inside forceRotate/rotate
//         }
//       }
//     };

//     // --- processTabScimago ---
//     const processTabScimago = async (page: Page, url: string, tabIndex: number): Promise<void> => {
//       const tabLogger = journalLogger.child({ process: 'scimago', url, tabIndex, event_group: 'scimago_tab' });
//       const tabStartMsg = `Processing Scimago URL: ${url}`;
//       tabLogger.info({ event: 'tab_start' }, tabStartMsg);
//       // console.info(`[Scimago Tab ${tabIndex}][tab_start] ${tabStartMsg}`); // CONSOLE ADDED
//       let rows: TableRowData[];
//       try {
//         // Ensure processPage accepts logger if needed
//         // rows = await processPage(page, url , tabLogger );
//         rows = await processPage(page, url); // Assuming not needed for now
//         const pageProcessedMsg = `Processed page ${url}, found ${rows.length} rows.`;
//         tabLogger.info({ event: 'page_processed', rowCount: rows.length }, pageProcessedMsg);
//         // console.info(`[Scimago Tab ${tabIndex}][page_processed] ${pageProcessedMsg}`); // CONSOLE ADDED
//       } catch (pageError: any) {
//         const pageErrMsg = `Error processing Scimago page ${url}`;
//         tabLogger.error({ err: pageError, event: 'page_process_failed' }, pageErrMsg);
//         // console.error(`[Scimago Tab ${tabIndex}][page_process_failed] ${pageErrMsg}:`, pageError.message || pageError); // CONSOLE ADDED
//         return;
//       }

//       for (const row of rows) {
//         const journalTitle = row.journalName || 'Unknown Journal';
//         const scimagoLink = row.journalLink || 'N/A';
//         const taskLogger = tabLogger.child({ journalTitle, scimagoLink, event_group: 'journal_task_scimago' });
//         const taskStartMsg = `Processing journal row: "${journalTitle}" (Link: ${scimagoLink})`;
//         taskLogger.info({ event: 'task_start' }, taskStartMsg);
//         // console.info(`[Scimago Task][task_start] ${taskStartMsg} (Tab: ${tabIndex})`); // CONSOLE ADDED

//         let journalData: JournalDetails = {
//           title: journalTitle,
//           scimagoLink: scimagoLink,
//           bioxbio: null,
//           Image: null,
//           Image_Context: null
//         };

//         // Populate data from CSV row string within the TableRowData
//         try {
//           if (row.csvRow && JOURNAL_CSV_HEADERS) { // Check if csvRow and headers exist
//              const csvRowArray = row.csvRow.split(','); // Basic split, might need more robust CSV parsing
//              const headers = JOURNAL_CSV_HEADERS.trim().split(',');
//              headers.forEach((header, index) => {
//                 const cleanHeader = header.trim();
//                 if (csvRowArray[index] !== undefined) {
//                    // Assign directly using the header as the key
//                    (journalData as any)[cleanHeader] = csvRowArray[index].trim();
//                 }
//              });
//              taskLogger.debug({ event: 'csv_data_parsed', headers: headers.length }, "Parsed CSV data from row string.");
//             //  console.log(`[Scimago Task][csv_data_parsed] Parsed CSV data from row string for "${journalTitle}" (Headers: ${headers.length})`); // CONSOLE ADDED (using console.log for debug)
//           } else {
//             taskLogger.debug({ event: 'csv_data_skipped', reason: 'Missing csvRow or headers' }, "Skipping CSV data parsing from row string.");
//             //  console.log(`[Scimago Task][csv_data_skipped] Skipping CSV data parsing from row string for "${journalTitle}" (Missing csvRow or headers)`); // CONSOLE ADDED
//           }
//         } catch (parseError: any) {
//           const parseErrMsg = `Could not parse CSV data from row string for "${journalTitle}"`;
//           taskLogger.warn({ err: parseError, event: 'csv_data_parse_failed', rawCsv: row.csvRow }, parseErrMsg);
//           // console.warn(`[Scimago Task][csv_data_parse_failed] ${parseErrMsg}: "${row.csvRow}"`, parseError.message || parseError); // CONSOLE ADDED
//         }

//         try {
//           if (JOURNAL_CRAWL_BIOXBIO && journalTitle !== 'Unknown Journal') {
//             const bioStartMsg = `Fetching BioxBio data for "${journalTitle}".`;
//             taskLogger.info({ event: 'bioxbio_fetch_start' }, bioStartMsg);
//             // console.info(`[Scimago Task][bioxbio_fetch_start] ${bioStartMsg}`); // CONSOLE ADDED
//             const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalTitle)}`;
//             // Ensure fetchBioxbioData accepts logger if needed
//             // journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalTitle , taskLogger );
//             journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalTitle);
//             const bioEndMsg = `BioxBio fetch complete for "${journalTitle}". Has Data: ${!!journalData.bioxbio}`;
//             taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, bioEndMsg);
//             // console.info(`[Scimago Task][bioxbio_fetch_complete] ${bioEndMsg}`); // CONSOLE ADDED
//           }

//           if (JOURNAL_CRAWL_DETAILS && scimagoLink !== 'N/A') {
//             const detailStartMsg = `Fetching Scimago details for "${journalTitle}" from ${scimagoLink}`;
//             taskLogger.info({ event: 'details_fetch_start' }, detailStartMsg);
//             // console.info(`[Scimago Task][details_fetch_start] ${detailStartMsg}`); // CONSOLE ADDED
//             // Ensure fetchDetails accepts logger if needed
//             // const details = await fetchDetails(page, scimagoLink , taskLogger );
//             const details = await fetchDetails(page, scimagoLink);
//             if (details) {
//               const detailSuccessMsg = `Scimago details fetched for "${journalTitle}".`;
//               taskLogger.info({ event: 'details_fetch_success' }, detailSuccessMsg);
//               // console.info(`[Scimago Task][details_fetch_success] ${detailSuccessMsg}`); // CONSOLE ADDED
//               Object.assign(journalData, details); // Merge details
//               await performImageSearch(taskLogger, details, row, journalData); // Logging done inside
//             } else {
//               const detailFailMsg = `Could not fetch Scimago details for "${journalTitle}" from ${scimagoLink}.`;
//               taskLogger.warn({ event: 'details_fetch_failed' }, detailFailMsg);
//               // console.warn(`[Scimago Task][details_fetch_failed] ${detailFailMsg}`); // CONSOLE ADDED
//               await performImageSearch(taskLogger, null, row, journalData); // Still try image search
//             }
//           } else if (scimagoLink === 'N/A') {
//              // If details are enabled but link is missing
//              const detailSkipMsg = `Skipping Scimago details fetch for "${journalTitle}" (No link available).`;
//              taskLogger.warn({ event: 'details_fetch_skipped', reason: 'Missing Scimago link'}, detailSkipMsg);
//             //  console.warn(`[Scimago Task][details_fetch_skipped] ${detailSkipMsg}`); // CONSOLE ADDED
//              await performImageSearch(taskLogger, null, row, journalData); // Still try image search
//           } else {
//              // If details are disabled, still try image search
//              await performImageSearch(taskLogger, null, row, journalData);
//           }

//           allJournalData.push(journalData);
//           processedCount++;
//           const taskSuccessMsg = `Successfully processed journal row: "${journalTitle}"`;
//           taskLogger.info({ event: 'task_success' }, taskSuccessMsg);
//           // console.info(`[Scimago Task][task_success] ${taskSuccessMsg}`); // CONSOLE ADDED

//         } catch (error: any) {
//           const taskErrMsg = `Unhandled error processing Scimago row for "${journalTitle}"`;
//           taskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, taskErrMsg);
//           // console.error(`[Scimago Task][task_failed_unhandled] ${taskErrMsg}:`, error.message || error, error.stack); // CONSOLE ADDED
//         }
//       }
//       const tabEndMsg = `Finished processing Scimago URL: ${url}`;
//       tabLogger.info({ event: 'tab_finish' }, tabEndMsg);
//       // console.info(`[Scimago Tab ${tabIndex}][tab_finish] ${tabEndMsg}`); // CONSOLE ADDED
//     };

//     // --- processTabCSV ---
//     const processTabCSV = async (page: Page, row: CSVRow, tabIndex: number, rowIndex: number): Promise<void> => {
//       const journalName = row.Title || `Row-${rowIndex}`; // Use Title or fallback
//       const taskLogger = journalLogger.child({ process: 'csv', journalTitle: journalName, rowIndex, tabIndex, event_group: 'journal_task_csv' });
//       const taskStartMsg = `Processing CSV row ${rowIndex}: "${journalName}"`;
//       taskLogger.info({ event: 'task_start' }, taskStartMsg);
//       // console.info(`[CSV Task][task_start] ${taskStartMsg} (Tab: ${tabIndex})`); // CONSOLE ADDED

//       let journalLink: string | undefined;
//       if (row.Sourceid && String(row.Sourceid).trim() !== '') {
//         journalLink = `https://www.scimagojr.com/journalsearch.php?q=${row.Sourceid}&tip=sid&clean=0`;
//         taskLogger.debug({ event: 'link_generated', type: 'sourceid', sourceId: row.Sourceid });
//         // console.log(`[CSV Task][link_generated] Generated Scimago link using SourceID ${row.Sourceid} for "${journalName}"`); // CONSOLE ADDED (log)
//       } else if (journalName && journalName !== `Row-${rowIndex}`) {
//         const linkWarnMsg = `Missing Sourceid for "${journalName}" (Row ${rowIndex}), using title to generate Scimago link.`;
//         taskLogger.warn({ event: 'link_generation_warning', reason: 'Missing Sourceid, using title' }, linkWarnMsg);
//         // console.warn(`[CSV Task][link_generation_warning] ${linkWarnMsg}`); // CONSOLE ADDED
//         journalLink = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(journalName)}&tip=jou&clean=0`;
//       } else {
//         const linkErrMsg = `Skipping row ${rowIndex}: Missing both Sourceid and Title. Cannot generate Scimago link.`;
//         taskLogger.error({ event: 'link_generation_failed', reason: 'Missing both Sourceid and Title' }, linkErrMsg);
//         // console.error(`[CSV Task][link_generation_failed] ${linkErrMsg}`); // CONSOLE ADDED
//         return; // Skip this row if no link can be made
//       }

//       let journalData: JournalDetails = {
//         // Initialize core fields that might be missing in CSV
//         title: row.Title || null, // Ensure title is set if available
//         scimagoLink: journalLink,
//         bioxbio: null,
//         Image: null,
//         Image_Context: null,
//         // Pre-populate from CSV row
//         ...row // Spread operator copies all properties from row
//       };
//       // Ensure title is consistent if SourceID was used but Title exists
//       if (!journalData.title && row.Title) {
//          journalData.title = row.Title;
//       }

//       taskLogger.debug({ event: 'initial_data_populated' }, `Populated initial data from CSV for "${journalName}"`);
//       // console.log(`[CSV Task][initial_data_populated] Populated initial data from CSV for "${journalName}"`); // CONSOLE ADDED (log)

//       try {
//         if (JOURNAL_CRAWL_BIOXBIO && journalName && journalName !== `Row-${rowIndex}`) {
//           const bioStartMsg = `Fetching BioxBio data for "${journalName}".`;
//           taskLogger.info({ event: 'bioxbio_fetch_start' }, bioStartMsg);
//           // console.info(`[CSV Task][bioxbio_fetch_start] ${bioStartMsg}`); // CONSOLE ADDED
//           const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`;
//           // Ensure fetchBioxbioData accepts logger if needed
//           // journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalName , taskLogger );
//           journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalName);
//           const bioEndMsg = `BioxBio fetch complete for "${journalName}". Has Data: ${!!journalData.bioxbio}`;
//           taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, bioEndMsg);
//           // console.info(`[CSV Task][bioxbio_fetch_complete] ${bioEndMsg}`); // CONSOLE ADDED
//         }

//         if (JOURNAL_CRAWL_DETAILS && journalLink) { // Check if journalLink exists
//           const detailStartMsg = `Fetching Scimago details for "${journalName}" from ${journalLink}`;
//           taskLogger.info({ event: 'details_fetch_start' }, detailStartMsg);
//           // console.info(`[CSV Task][details_fetch_start] ${detailStartMsg}`); // CONSOLE ADDED
//           // Ensure fetchDetails accepts logger if needed
//           // const details = await fetchDetails(page, journalLink , taskLogger );
//           const details = await fetchDetails(page, journalLink);
//           if (details) {
//             const detailSuccessMsg = `Scimago details fetched for "${journalName}".`;
//             taskLogger.info({ event: 'details_fetch_success' }, detailSuccessMsg);
//             // console.info(`[CSV Task][details_fetch_success] ${detailSuccessMsg}`); // CONSOLE ADDED
//             Object.assign(journalData, details); // Merge details
//             await performImageSearch(taskLogger, details, row, journalData); // Logging done inside
//           } else {
//             const detailFailMsg = `Could not fetch Scimago details for "${journalName}" from ${journalLink}.`;
//             taskLogger.warn({ event: 'details_fetch_failed' }, detailFailMsg);
//             // console.warn(`[CSV Task][details_fetch_failed] ${detailFailMsg}`); // CONSOLE ADDED
//             await performImageSearch(taskLogger, null, row, journalData); // Still try image search
//           }
//         } else if (!journalLink && JOURNAL_CRAWL_DETAILS) { // Should not happen due to early return, but defensive check
//             const detailSkipMsg = `Skipping Scimago details fetch for "${journalName}" (No valid link generated).`;
//             taskLogger.warn({ event: 'details_fetch_skipped', reason: 'No valid Scimago link' }, detailSkipMsg);
//             // console.warn(`[CSV Task][details_fetch_skipped] ${detailSkipMsg}`); // CONSOLE ADDED
//             await performImageSearch(taskLogger, null, row, journalData); // Still try image search
//         } else {
//             // If details disabled, or no link, still try image search
//             await performImageSearch(taskLogger, null, row, journalData);
//         }

//         allJournalData.push(journalData);
//         processedCount++;
//         const taskSuccessMsg = `Successfully processed CSV row ${rowIndex}: "${journalName}"`;
//         taskLogger.info({ event: 'task_success' }, taskSuccessMsg);
//         // console.info(`[CSV Task][task_success] ${taskSuccessMsg}`); // CONSOLE ADDED

//       } catch (error: any) {
//         const taskErrMsg = `Unhandled error processing CSV row ${rowIndex}: "${journalName}"`;
//         taskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, taskErrMsg);
//         // console.error(`[CSV Task][task_failed_unhandled] ${taskErrMsg}:`, error.message || error, error.stack); // CONSOLE ADDED
//       }
//     };

//     // --- Logic chạy chính (MODE scimago hoặc csv) ---
//     if (JOURNAL_CRAWL_MODE === 'scimago') {
//       const modeMsg = "Starting crawl in Scimago mode.";
//       journalLogger.info({ event: 'mode_scimago_start' }, modeMsg);
//       // console.info(`[crawlJournals][mode_scimago_start] ${modeMsg}`); // CONSOLE ADDED

//       const firstPage = pages[0];
//       let lastPageNumber = 1;
//       let urls: string[] = [];
//       try {
//         // console.log("[crawlJournals] Determining last page number from Scimago..."); // CONSOLE ADDED
//         // Ensure getLastPageNumber accepts logger if needed
//         // lastPageNumber = await getLastPageNumber(firstPage, BASE_URL , journalLogger );
//         lastPageNumber = await getLastPageNumber(firstPage, BASE_URL);
//         const lastPageMsg = `Total Scimago pages estimated: ${lastPageNumber}`;
//         journalLogger.info({ event: 'scimago_last_page_found', lastPage: lastPageNumber }, lastPageMsg);
//         // console.info(`[crawlJournals][scimago_last_page_found] ${lastPageMsg}`); // CONSOLE ADDED

//         urls = createURLList(BASE_URL, lastPageNumber);
//         totalTasks = urls.length; // Set total tasks for Scimago mode
//         // console.info(`[crawlJournals] Generated ${totalTasks} Scimago URLs to process.`); // CONSOLE ADDED

//         for (let i = 0; i < urls.length; i += MAX_TABS) {
//           const batchUrls = urls.slice(i, i + MAX_TABS);
//           const batchIndex = Math.floor(i / MAX_TABS) + 1;
//           const batchStartMsg = `Starting Scimago batch ${batchIndex} (Size: ${batchUrls.length}, Start Index: ${i}, Total URLs: ${totalTasks})`;
//           journalLogger.info({ event: 'scimago_batch_start', batchIndex, batchSize: batchUrls.length, startIndex: i, totalTasks });
//           // console.info(`[crawlJournals][scimago_batch_start] ${batchStartMsg}`); // CONSOLE ADDED

//           await Promise.all(
//             batchUrls.map(async (url, idx) => {
//               const pageIndex = idx % pages.length; // Cycle through available pages
//               const currentTaskIndex = i + idx;
//               if (pages[pageIndex]) {
//                 await processTabScimago(pages[pageIndex], url, pageIndex);
//                 completedTasks = Math.min(currentTaskIndex + 1, totalTasks); // Update completed count
//               } else {
//                 const skipMsg = `Skipping URL ${url} (Task ${currentTaskIndex}), page index ${pageIndex} not available (unexpected).`;
//                 journalLogger.warn({ event: 'scimago_batch_skip_page', url, pageIndex, taskIndex: currentTaskIndex }, skipMsg);
//                 // console.warn(`[crawlJournals][scimago_batch_skip_page] ${skipMsg}`); // CONSOLE ADDED
//               }
//             })
//           );
//           const batchEndMsg = `Finished Scimago batch ${batchIndex}. URLs processed so far: ${completedTasks}/${totalTasks}`;
//           journalLogger.info({ event: 'scimago_batch_finish', batchIndex, urlsProcessed: completedTasks, totalTasks });
//           // console.info(`[crawlJournals][scimago_batch_finish] ${batchEndMsg}`); // CONSOLE ADDED
//         }
//       } catch (error: any) {
//         const scimagoErrMsg = `Failed during Scimago page processing loop.`;
//         journalLogger.error({ err: error, event: 'scimago_processing_error' }, scimagoErrMsg);
//         // console.error(`[crawlJournals][scimago_processing_error] ${scimagoErrMsg}:`, error.message || error); // CONSOLE ADDED
//         // Continue to finally block for cleanup
//       }

//     } else if (JOURNAL_CRAWL_MODE === 'csv') {
//       const modeMsg = `Starting crawl in CSV mode. Input file: ${INPUT_CSV}`;
//       journalLogger.info({ event: 'mode_csv_start', inputFile: INPUT_CSV }, modeMsg);
//       // console.info(`[crawlJournals][mode_csv_start] ${modeMsg}`); // CONSOLE ADDED
//       try {
//         // console.log(`[crawlJournals] Reading CSV file: ${INPUT_CSV}...`); // CONSOLE ADDED
//         // Ensure readCSV accepts logger if needed
//         // const csvData: CSVRow[] = await readCSV(INPUT_CSV , journalLogger );
//         const csvData: CSVRow[] = await readCSV(INPUT_CSV);
//         totalTasks = csvData.length; // Set total tasks for CSV mode
//         const readSuccessMsg = `Total journals to process from CSV: ${totalTasks}`;
//         journalLogger.info({ event: 'csv_read_success', rowCount: totalTasks }, readSuccessMsg);
//         // console.info(`[crawlJournals][csv_read_success] ${readSuccessMsg}`); // CONSOLE ADDED

//         for (let i = 0; i < csvData.length; i += MAX_TABS) {
//           const batchRows = csvData.slice(i, i + MAX_TABS);
//           const batchIndex = Math.floor(i / MAX_TABS) + 1;
//           const batchStartMsg = `Starting CSV batch ${batchIndex} (Size: ${batchRows.length}, Start Index: ${i}, Total Rows: ${totalTasks})`;
//           journalLogger.info({ event: 'csv_batch_start', batchIndex, batchSize: batchRows.length, startIndex: i, totalTasks });
//           // console.info(`[crawlJournals][csv_batch_start] ${batchStartMsg}`); // CONSOLE ADDED

//           await Promise.all(
//             batchRows.map(async (row, idx) => {
//               const pageIndex = idx % pages.length; // Cycle through available pages
//               const currentTaskIndex = i + idx;
//               if (pages[pageIndex]) {
//                 await processTabCSV(pages[pageIndex], row, pageIndex, currentTaskIndex); // Pass global row index
//                 completedTasks = Math.min(currentTaskIndex + 1, totalTasks); // Update completed count
//               } else {
//                  const skipMsg = `Skipping CSV row ${currentTaskIndex}, page index ${pageIndex} not available (unexpected).`;
//                  journalLogger.warn({ event: 'csv_batch_skip_page', rowIndex: currentTaskIndex, pageIndex }, skipMsg);
//                 //  console.warn(`[crawlJournals][csv_batch_skip_page] ${skipMsg}`); // CONSOLE ADDED
//               }
//             })
//           );
//           const batchEndMsg = `Finished CSV batch ${batchIndex}. Rows processed so far: ${completedTasks}/${totalTasks}`;
//           journalLogger.info({ event: 'csv_batch_finish', batchIndex, rowsProcessed: completedTasks, totalTasks });
//           // console.info(`[crawlJournals][csv_batch_finish] ${batchEndMsg}`); // CONSOLE ADDED
//         }
//       } catch (error: any) {
//         const csvErrMsg = `Failed to read or process CSV file ${INPUT_CSV}`;
//         journalLogger.error({ err: error, event: 'csv_processing_error' }, csvErrMsg);
//         // console.error(`[crawlJournals][csv_processing_error] ${csvErrMsg}:`, error.message || error); // CONSOLE ADDED
//         // Continue to finally block for cleanup
//       }
//     } else {
//       const invalidModeMsg = `Invalid JOURNAL_CRAWL_MODE: ${JOURNAL_CRAWL_MODE}. Expected 'scimago' or 'csv'.`;
//       journalLogger.error({ event: 'invalid_mode', mode: JOURNAL_CRAWL_MODE }, invalidModeMsg);
//       console.error(`[crawlJournals][invalid_mode] ${invalidModeMsg}`); // CONSOLE ADDED
//       if (browser) {
//         //  console.log("[crawlJournals] Closing browser due to invalid mode..."); // CONSOLE ADDED
//          await browser.close();
//       }
//       return [];
//     }

//     // --- Write Output ---
//     const writeStartMsg = `Attempting to write ${allJournalData.length} journal records to ${OUTPUT_JSON}`;
//     journalLogger.info({ event: 'output_write_start', path: OUTPUT_JSON, count: allJournalData.length }, writeStartMsg);
//     // console.info(`[crawlJournals][output_write_start] ${writeStartMsg}`); // CONSOLE ADDED
//     try {
//       await fs.promises.writeFile(OUTPUT_JSON, JSON.stringify(allJournalData, null, 2), 'utf8');
//       const writeSuccessMsg = `Journal data saved successfully to ${OUTPUT_JSON}.`;
//       journalLogger.info({ event: 'output_write_success', path: OUTPUT_JSON }, writeSuccessMsg);
//       // console.info(`[crawlJournals][output_write_success] ${writeSuccessMsg}`); // CONSOLE ADDED
//     } catch (error: any) {
//       const writeErrMsg = `Error writing final JSON file to ${OUTPUT_JSON}`;
//       journalLogger.error({ err: error, path: OUTPUT_JSON, event: 'output_write_failed' }, writeErrMsg);
//       // console.error(`[crawlJournals][output_write_failed] ${writeErrMsg}:`, error.message || error); // CONSOLE ADDED
//       // Return data even if write fails
//     }

//     return allJournalData; // Return collected data

//   } catch (error: any) {
//     const fatalMsg = "Fatal error during journal crawling process";
//     journalLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, fatalMsg);
//     // console.error is appropriate for fatal errors in console
//     // console.error(`[crawlJournals][crawl_fatal_error] ${fatalMsg}:`, error.message || error, error.stack); // CONSOLE ADDED
//     return allJournalData; // Return whatever was collected before the fatal error
//   } finally {
//     // --- Final Cleanup and Summary ---
//     journalLogger.info({ event: 'cleanup_start' }, "Performing final cleanup...");
//     // console.info(`[crawlJournals][cleanup_start] Performing final cleanup...`); // CONSOLE ADDED

//     if (browser) {
//       journalLogger.info({ event: 'browser_close_start' }, "Closing browser...");
//       // console.info(`[crawlJournals][browser_close_start] Closing browser...`); // CONSOLE ADDED
//       try {
//          await browser.close();
//          journalLogger.info({ event: 'browser_close_success' }, "Browser closed.");
//         //  console.info(`[crawlJournals][browser_close_success] Browser closed.`); // CONSOLE ADDED
//       } catch (closeError: any) {
//          const closeErrMsg = "Error closing browser.";
//          journalLogger.error({ err: closeError, event: 'browser_close_failed' }, closeErrMsg);
//         //  console.error(`[crawlJournals][browser_close_failed] ${closeErrMsg}:`, closeError.message || closeError); // CONSOLE ADDED
//       }
//     } else {
//       const skipCloseMsg = "Browser was not launched or already closed, skipping closure.";
//       journalLogger.info({ event: 'browser_close_skipped' }, skipCloseMsg);
//       // console.info(`[crawlJournals][browser_close_skipped] ${skipCloseMsg}`); // CONSOLE ADDED
//     }

//     const operationEndTime = Date.now();
//     const durationSeconds = Math.round((operationEndTime - operationStartTime) / 1000);
//     const summaryData = {
//         mode: JOURNAL_CRAWL_MODE,
//         totalTasksAttempted: totalTasks, // Should be populated correctly now
//         journalsProcessed: processedCount,
//         journalsWritten: allJournalData.length,
//         imageSearchesFailed: failedImageSearchCount,
//         imageSearchesSkipped: skippedImageSearchCount,
//         totalGoogleApiRequests: apiKeyManager.getTotalRequests(),
//         keysExhausted: apiKeyManager.areAllKeysExhausted(),
//         durationSeconds,
//         startTime: new Date(operationStartTime).toISOString(),
//         endTime: new Date(operationEndTime).toISOString(),
//         outputPath: OUTPUT_JSON
//     };

//     journalLogger.info({
//       event: 'crawl_summary',
//       ...summaryData // Spread the summary data into the log object
//     }, "Journal crawling process summary");
//     // For console, logging the object might be clear enough
//     // console.info(`[crawlJournals][crawl_summary] Journal crawling process summary:`, summaryData); // CONSOLE ADDED

//     journalLogger.info({ event: 'crawl_end' }, "crawlJournals process finished.");
//     // console.info(`[crawlJournals][crawl_end] crawlJournals process finished.`); // CONSOLE ADDED
//     // --- End Cleanup and Summary ---
//   }
// };


//src/journal/crawlJournals.ts 

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { logger } from './utils';

// Import the ApiKeyManager class
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

import {
  MAX_TABS,
  JOURNAL_CRAWL_BIOXBIO,
  JOURNAL_CRAWL_DETAILS,
  JOURNAL_CSV_HEADERS,
  BASE_URL,
  HEADLESS, CHANNEL,
  JOURNAL_CRAWL_MODE,
  USER_AGENT,
  // Import shared config for API keys
  GOOGLE_CUSTOM_SEARCH_API_KEYS,
  GOOGLE_CSE_ID,
  MAX_USAGE_PER_KEY,
  KEY_ROTATION_DELAY_MS,
} from '../config';
import { processPage, fetchDetails, getImageUrlAndDetails, getLastPageNumber } from './scimagojr';
import { fetchBioxbioData } from './bioxbio';
import { createURLList, readCSV } from './utils'; // Assuming readCSV and createURLList are here
// --- Types ---
import { TableRowData, JournalDetails, CSVRow } from './types'; // Assuming types are defined here
import { appendJournalToFile } from './utils';

// --- Paths (Adjust if necessary) ---
export const INPUT_CSV: string = path.join(__dirname, './csv/import_journal.csv');
const OUTPUT_DIR = path.resolve(__dirname, './data'); // Or your output directory path
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'journal_data.jsonl'); // Using .jsonl for JSON Lines format


// ============================================
// Hàm Crawl Chính cho Journals
// ============================================
// --- Modified crawlJournals function ---
export const crawlJournals = async (
  parentLogger: typeof logger
): Promise<void> => { // <--- Changed return type to Promise<void>

  const journalLogger = parentLogger.child({ service: 'crawlJournals' });
  journalLogger.info({ event: 'init_start', mode: JOURNAL_CRAWL_MODE, outputFile: OUTPUT_JSON }, "Initializing journal crawl...");

  // --- Khởi tạo API Key Manager (RIÊNG BIỆT cho Journal Crawling) ---
  const apiKeyManager = new ApiKeyManager(
    GOOGLE_CUSTOM_SEARCH_API_KEYS,
    MAX_USAGE_PER_KEY,
    KEY_ROTATION_DELAY_MS,
    journalLogger // Pass the specific logger instance
  );

  // --- Declare variables ---
  let browser: Browser | null = null;
  const operationStartTime = Date.now();
  let processedCount = 0;
  let failedImageSearchCount = 0;
  let skippedImageSearchCount = 0;
  let completedTasks = 0;
  let totalTasks = 0;

  try {
    // --- Ensure Output Directory Exists and Clear/Initialize Output File ---
    journalLogger.info({ event: 'prepare_output_start', path: OUTPUT_DIR }, `Ensuring output directory exists: ${OUTPUT_DIR}`);
    try {
      await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
      journalLogger.info({ event: 'prepare_output_dir_success', path: OUTPUT_DIR }, "Output directory ensured.");

      // Initialize/Clear the output file before starting the crawl
      journalLogger.info({ event: 'prepare_output_file_start', path: OUTPUT_JSON }, `Initializing output file: ${OUTPUT_JSON}`);
      await fs.promises.writeFile(OUTPUT_JSON, '', 'utf8'); // Create empty file or truncate existing one
      journalLogger.info({ event: 'prepare_output_file_success', path: OUTPUT_JSON }, "Output file initialized.");

    } catch (outputPrepError: any) {
      journalLogger.error({ err: outputPrepError, path: OUTPUT_DIR, event: 'prepare_output_failed' }, `Could not ensure output directory or initialize file. Crawling cannot proceed reliably.`);
      // Stop execution if the output file cannot be prepared
      throw new Error(`Failed to prepare output directory/file: ${outputPrepError.message}`);
    }
    // --- End Output Preparation ---



    journalLogger.info({ event: 'browser_launch_start', headless: HEADLESS, channel: CHANNEL }, "Launching browser...");
    browser = await chromium.launch({
      channel: CHANNEL,
      headless: true,
      args: [
        "--disable-notifications", "--disable-geolocation", "--disable-extensions",
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
        "--blink-settings=imagesEnabled=false", "--ignore-certificate-errors"
      ],
    });
    journalLogger.info({ event: 'browser_launch_success' }, "Browser launched.");

    journalLogger.info({ event: 'context_create_start' }, "Creating browser context...");
    const browserContext: BrowserContext = await browser.newContext({
      permissions: [],
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
      userAgent: USER_AGENT,
    });
    journalLogger.info({ event: 'context_create_success' }, "Browser context created.");

    journalLogger.info({ event: 'pages_create_start', count: MAX_TABS }, `Creating ${MAX_TABS} pages...`);
    const pages: Page[] = await Promise.all(Array.from({ length: MAX_TABS }, (_, i) => {
      journalLogger.debug({ event: 'page_create', pageIndex: i + 1 });
      return browserContext.newPage();
    }));
    journalLogger.info({ event: 'pages_create_success', count: pages.length }, `Created ${pages.length} pages.`);

    // --- Shared Image Search Logic ---
    const performImageSearch = async (
      taskLogger: typeof journalLogger, // Use the specific child logger type
      details: JournalDetails | null,
      row: TableRowData | CSVRow,
      journalData: JournalDetails
    ): Promise<void> => {
      const journalTitle = journalData.title || (row as CSVRow)?.Title || (row as TableRowData)?.journalName || 'Unknown Journal';
      taskLogger.info({ event: 'image_search_start' }, "Attempting image search.");

      if (apiKeyManager.areAllKeysExhausted()) {
        taskLogger.warn({ event: 'image_search_skip_exhausted' }, `Skipping image search for "${journalTitle}" - All API keys exhausted.`);
        skippedImageSearchCount++;
        return;
      }

      const apiKey = await apiKeyManager.getNextKey();
      if (!apiKey) {
        taskLogger.warn({ event: 'image_search_skip_no_key' }, `Skipping image search for "${journalTitle}" - Failed to get API key (exhausted).`);
        skippedImageSearchCount++;
        if (!apiKeyManager.areAllKeysExhausted()) {
          taskLogger.error({ event: 'unexpected_no_key_journal' }, "ApiKeyManager anomaly: getNextKey returned null but not marked exhausted.");
        }
        return;
      }

      const cseId = GOOGLE_CSE_ID!;
      taskLogger.info({
        event: 'image_search_attempt',
        keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
        usageOnKey: apiKeyManager.getCurrentKeyUsage(),
      }, `Performing image search using key #${apiKeyManager.getCurrentKeyIndex() + 1}`);

      try {
        // Pass logger down if the function accepts it
        // Ensure getImageUrlAndDetails is updated to accept logger
        const { Image, Image_Context } = await getImageUrlAndDetails(details, row, apiKey, cseId /*, taskLogger */);
        journalData.Image = Image;
        journalData.Image_Context = Image_Context;
        taskLogger.info({ event: 'image_search_success', hasImage: !!Image }, "Image search successful.");
      } catch (searchError: any) {
        failedImageSearchCount++;
        taskLogger.error({ err: searchError, event: 'image_search_failed' }, `Image search failed for "${journalTitle}"`);

        const statusCode = searchError.statusCode || searchError.status;
        const isQuotaError = statusCode === 429 || statusCode === 403;

        if (isQuotaError) {
          taskLogger.warn({
            event: 'image_search_quota_error',
            keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
            statusCode: statusCode || 'N/A'
          }, `Quota/Rate limit error detected during image search. Forcing key rotation.`);
          await apiKeyManager.forceRotate();
        }
      }
    };

    // --- processTabScimago ---
    const processTabScimago = async (page: Page, url: string, tabIndex: number): Promise<void> => {
      const tabLogger = journalLogger.child({ process: 'scimago', url, tabIndex, event_group: 'scimago_tab' });
      tabLogger.info({ event: 'tab_start' }, "Processing Scimago URL");
      let rows: TableRowData[];
      try {
        // Ensure processPage accepts logger
        rows = await processPage(page, url /*, tabLogger */);
        tabLogger.info({ event: 'page_processed', rowCount: rows.length }, `Processed page, found ${rows.length} rows.`);
      } catch (pageError: any) {
        tabLogger.error({ err: pageError, event: 'page_process_failed' }, "Error processing Scimago page");
        return;
      }

      for (const row of rows) {
        const taskLogger = tabLogger.child({ journalTitle: row.journalName, scimagoLink: row.journalLink, event_group: 'journal_task_scimago' });
        taskLogger.info({ event: 'task_start' }, `Processing journal row`);

        let journalData: JournalDetails = {
          title: row.journalName,
          scimagoLink: row.journalLink,
          bioxbio: null,
          Image: null,
          Image_Context: null
        };

        // Populate data from CSV row string within the TableRowData
        try {
          const csvRowArray = row.csvRow.split(',');
          const headers = JOURNAL_CSV_HEADERS.trim().split(',');
          headers.forEach((header, index) => {
            const cleanHeader = header.trim();
            if (csvRowArray[index] !== undefined) {
              journalData[cleanHeader] = csvRowArray[index].trim();
            }
          });
          taskLogger.debug({ event: 'csv_data_parsed', headers: headers.length }, "Parsed CSV data from row string.");
        } catch (parseError: any) {
          taskLogger.warn({ err: parseError, event: 'csv_data_parse_failed', rawCsv: row.csvRow }, "Could not parse CSV data from row string.");
        }

        try {
          if (JOURNAL_CRAWL_BIOXBIO && row.journalName) {
            taskLogger.info({ event: 'bioxbio_fetch_start' }, "Fetching BioxBio data.");
            const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(row.journalName)}`;
            // Ensure fetchBioxbioData accepts logger
            journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, row.journalName /*, taskLogger */);
            taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, "BioxBio fetch complete.");
          }

          if (JOURNAL_CRAWL_DETAILS) {
            taskLogger.info({ event: 'details_fetch_start' }, "Fetching Scimago details.");
            // Ensure fetchDetails accepts logger
            const details = await fetchDetails(page, row.journalLink /*, taskLogger */);
            if (details) {
              taskLogger.info({ event: 'details_fetch_success' }, "Scimago details fetched.");
              Object.assign(journalData, details);
              await performImageSearch(taskLogger, details, row, journalData);
            } else {
              taskLogger.warn({ event: 'details_fetch_failed' }, "Could not fetch Scimago details.");
              await performImageSearch(taskLogger, null, row, journalData);
            }
          }
          // --->>> WRITE TO FILE HERE <<<---
          await appendJournalToFile(journalData, OUTPUT_JSON, taskLogger);
          processedCount++;
          taskLogger.info({ event: 'task_success' }, `Successfully processed and saved journal row`);

        } catch (error: any) {
          taskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, `Unhandled error processing Scimago row`);
        }
      }
      tabLogger.info({ event: 'tab_finish' }, "Finished processing Scimago URL");
    };

    // --- processTabCSV ---
    const processTabCSV = async (page: Page, row: CSVRow, tabIndex: number, rowIndex: number): Promise<void> => {
      const journalName = row.Title || `Row-${rowIndex}`;
      const taskLogger = journalLogger.child({ process: 'csv', journalTitle: journalName, rowIndex, tabIndex, event_group: 'journal_task_csv' });
      taskLogger.info({ event: 'task_start' }, "Processing CSV row");

      let journalLink: string | undefined;
      if (row.Sourceid && String(row.Sourceid).trim() !== '') {
        journalLink = `https://www.scimagojr.com/journalsearch.php?q=${row.Sourceid}&tip=sid&clean=0`;
        taskLogger.debug({ event: 'link_generated', type: 'sourceid', sourceId: row.Sourceid });
      } else if (journalName && journalName !== `Row-${rowIndex}`) {
        taskLogger.warn({ event: 'link_generation_warning', reason: 'Missing Sourceid, using title' });
        journalLink = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(journalName)}&tip=jou&clean=0`;
      } else {
        taskLogger.error({ event: 'link_generation_failed', reason: 'Missing both Sourceid and Title' }, "Skipping row.");
        return;
      }

      let journalData: JournalDetails = {
        scimagoLink: journalLink,
        bioxbio: null,
        Image: null,
        Image_Context: null,
        // Pre-populate from CSV row
        ...row // Spread operator copies all properties from row
      };
      if (!journalData.title && row.Title) {
        journalData.title = row.Title;
      }
      taskLogger.debug({ event: 'initial_data_populated' }, "Populated initial data from CSV.");

      try {
        if (JOURNAL_CRAWL_BIOXBIO && journalName && journalName !== `Row-${rowIndex}`) {
          taskLogger.info({ event: 'bioxbio_fetch_start' }, "Fetching BioxBio data.");
          const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`;
          // Ensure fetchBioxbioData accepts logger
          journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalName /*, taskLogger */);
          taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, "BioxBio fetch complete.");
        }

        if (JOURNAL_CRAWL_DETAILS && journalLink) { // Check if journalLink is defined
          taskLogger.info({ event: 'details_fetch_start' }, "Fetching Scimago details.");
          // Ensure fetchDetails accepts logger
          const details = await fetchDetails(page, journalLink /*, taskLogger */);
          if (details) {
            taskLogger.info({ event: 'details_fetch_success' }, "Scimago details fetched.");
            Object.assign(journalData, details);
            await performImageSearch(taskLogger, details, row, journalData);
          } else {
            taskLogger.warn({ event: 'details_fetch_failed' }, `Could not fetch Scimago details`);
            await performImageSearch(taskLogger, null, row, journalData);
          }
        } else if (!journalLink) {
          taskLogger.warn({ event: 'details_fetch_skipped', reason: 'No valid Scimago link' });
          // Still attempt image search if no details link
          await performImageSearch(taskLogger, null, row, journalData);
        }
   
        // --->>> WRITE TO FILE HERE <<<---
        await appendJournalToFile(journalData, OUTPUT_JSON, taskLogger);
        processedCount++;
        taskLogger.info({ event: 'task_success' }, `Successfully processed and saved CSV row`);

      } catch (error: any) {
        taskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, `Unhandled error processing CSV row`);
      }
    };

    // --- Logic chạy chính (MODE scimago hoặc csv) ---
    // completedTasks and totalTasks are now declared outside the try block

    if (JOURNAL_CRAWL_MODE === 'scimago') {
      journalLogger.info({ event: 'mode_scimago_start' }, "Starting crawl in Scimago mode.");
      const firstPage = pages[0];
      let lastPageNumber = 1;
      let urls: string[] = [];
      try {
        // Ensure getLastPageNumber accepts logger
        lastPageNumber = await getLastPageNumber(firstPage, BASE_URL /*, journalLogger */);
        journalLogger.info({ event: 'scimago_last_page_found', lastPage: lastPageNumber }, `Total Scimago pages estimated: ${lastPageNumber}`);
        urls = createURLList(BASE_URL, lastPageNumber);
        totalTasks = urls.length; // Assign value here


        for (let i = 0; i < urls.length; i += MAX_TABS) {
          const batchUrls = urls.slice(i, i + MAX_TABS);
          journalLogger.info({ event: 'scimago_batch_start', batchIndex: Math.floor(i / MAX_TABS) + 1, batchSize: batchUrls.length, startIndex: i });
          await Promise.all(
            batchUrls.map(async (url, idx) => {
              const pageIndex = idx % pages.length;
              if (pages[pageIndex]) {
                await processTabScimago(pages[pageIndex], url, pageIndex);
                completedTasks = Math.min(i + idx + 1, urls.length);
              } else {
                journalLogger.warn({ event: 'scimago_batch_skip_page', url, pageIndex }, "Skipping URL, page not available (unexpected).")
              }
            })
          );
          journalLogger.info({ event: 'scimago_batch_finish', batchIndex: Math.floor(i / MAX_TABS) + 1, urlsProcessed: completedTasks });
        }
      } catch (error: any) {
        journalLogger.error({ err: error, event: 'scimago_processing_error' }, `Failed during Scimago page processing loop.`);
      }

    } else if (JOURNAL_CRAWL_MODE === 'csv') {
      journalLogger.info({ event: 'mode_csv_start', inputFile: INPUT_CSV }, "Starting crawl in CSV mode.");
      try {
        // Ensure readCSV accepts logger
        const csvData: CSVRow[] = await readCSV(INPUT_CSV /*, journalLogger */);
        totalTasks = csvData.length; // Assign value here
        journalLogger.info({ event: 'csv_read_success', rowCount: totalTasks }, `Total journals to process from CSV: ${totalTasks}`);

        for (let i = 0; i < csvData.length; i += MAX_TABS) {
          const batchRows = csvData.slice(i, i + MAX_TABS);
          journalLogger.info({ event: 'csv_batch_start', batchIndex: Math.floor(i / MAX_TABS) + 1, batchSize: batchRows.length, startIndex: i });
          await Promise.all(
            batchRows.map(async (row, idx) => {
              const pageIndex = idx % pages.length;
              if (pages[pageIndex]) {
                await processTabCSV(pages[pageIndex], row, pageIndex, i + idx);
                completedTasks = Math.min(i + idx + 1, csvData.length);
              } else {
                journalLogger.warn({ event: 'csv_batch_skip_page', rowIndex: i + idx, pageIndex }, "Skipping CSV row, page not available (unexpected).")
              }
            })
          );
          journalLogger.info({ event: 'csv_batch_finish', batchIndex: Math.floor(i / MAX_TABS) + 1, rowsProcessed: completedTasks });
        }
      } catch (error: any) {
        journalLogger.error({ err: error, event: 'csv_processing_error' }, `Failed to read or process CSV file ${INPUT_CSV}`);
      }
    } else {
      journalLogger.error({ event: 'invalid_mode', mode: JOURNAL_CRAWL_MODE }, `Invalid JOURNAL_CRAWL_MODE.`);
      if (browser) await browser.close();
      return; // <--- Return void
    }

    // REMOVED: Final write block for allJournalData
    journalLogger.info({ event: 'crawl_loops_completed' }, "Finished processing all tasks.");


  } catch (error: any) {
    journalLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during journal crawling process");
    // Let the error propagate or handle specifically if needed, but don't return data
    // REMOVED: return allJournalData;
    throw error; // Re-throw the error so the route handler knows it failed
  } finally {

    // --- Final Cleanup and Summary ---
    journalLogger.info({ event: 'cleanup_start' }, "Performing final cleanup...");
    if (browser) {
      journalLogger.info({ event: 'browser_close_start' }, "Closing browser...");
      try { await browser.close(); journalLogger.info({ event: 'browser_close_success' }, "Browser closed."); }
      catch (closeError: any) { journalLogger.error({ err: closeError, event: 'browser_close_failed' }, "Error closing browser."); }
    } else {
      journalLogger.info({ event: 'browser_close_skipped' }, "Browser was not launched or already closed.");
    }
    const operationEndTime = Date.now();
    const durationSeconds = Math.round((operationEndTime - operationStartTime) / 1000);

    journalLogger.info({
      event: 'crawl_summary',
      mode: JOURNAL_CRAWL_MODE,
      totalTasksAttempted: totalTasks,
      journalsProcessedAndSaved: processedCount, // Renamed for clarity
      // REMOVED: journalsWritten: allJournalData.length
      imageSearchesFailed: failedImageSearchCount,
      imageSearchesSkipped: skippedImageSearchCount,
      totalGoogleApiRequests: apiKeyManager.getTotalRequests(),
      keysExhausted: apiKeyManager.areAllKeysExhausted(),
      durationSeconds,
      startTime: new Date(operationStartTime).toISOString(),
      endTime: new Date(operationEndTime).toISOString(),
      outputPath: OUTPUT_JSON // Keep path for reference
    }, "Journal crawling process summary");

    journalLogger.info({ event: 'crawl_end' }, "crawlJournals process finished.");
    // Implicitly returns void if no error was thrown earlier
  }

  return;

};

