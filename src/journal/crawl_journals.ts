// src/journal/crawlJournals.ts 

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
import app

// --- Paths (Adjust if necessary) ---
export const INPUT_CSV: string = path.join(__dirname, './csv/import_journal.csv');
const OUTPUT_DIR = path.resolve(__dirname, '../output'); // Or your output directory path
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'journal_data.jsonl'); // Using .jsonl for JSON Lines format




// ============================================
// Hàm Crawl Chính cho Journals
// ============================================
export const crawlJournals = async (
  parentLogger: typeof logger
): Promise<JournalDetails[]> => {

  const journalLogger = parentLogger.child({ service: 'crawlJournals' }); // Create a logger specific to this function
  journalLogger.info({ event: 'init_start', mode: JOURNAL_CRAWL_MODE }, "Initializing journal crawl...");

  // --- Khởi tạo API Key Manager (RIÊNG BIỆT cho Journal Crawling) ---
  const apiKeyManager = new ApiKeyManager(
    GOOGLE_CUSTOM_SEARCH_API_KEYS,
    MAX_USAGE_PER_KEY,
    KEY_ROTATION_DELAY_MS,
    journalLogger // Pass the specific logger instance
  );

  if (apiKeyManager.areAllKeysExhausted()) {
    // Logged internally by ApiKeyManager constructor if no keys provided
    journalLogger.error({ event: 'init_fail_no_keys' }, "Journal crawl cannot proceed without Google API Keys.");
    // Optionally throw an error or return early
    // throw new Error("CRITICAL: No Google API Keys available for Journal crawling.");
    return []; // Return empty array if no keys
  }


  // --- Declare variables outside the try block ---
  let browser: Browser | null = null;
  const operationStartTime = Date.now();
  let allJournalData: JournalDetails[] = [];
  let processedCount = 0;
  let failedImageSearchCount = 0;
  let skippedImageSearchCount = 0;
  let completedTasks = 0; // Track pages/rows processed by loops
  let totalTasks = 0; // <<<< MOVED HERE


  try {
    journalLogger.info({ event: 'browser_launch_start', headless: HEADLESS, channel: CHANNEL }, "Launching browser...");
    browser = await chromium.launch({
      channel: CHANNEL,
      headless: false,
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
          allJournalData.push(journalData);
          processedCount++;
          taskLogger.info({ event: 'task_success' }, `Successfully processed journal row`);

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
        allJournalData.push(journalData);
        processedCount++;
        taskLogger.info({ event: 'task_success' }, `Successfully processed CSV row`);

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
        totalTasks = urls.slice(0, 1).length; // Assign value here

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
      return [];
    }


    // --- Ensure Output Directory Exists --- <<< NEW SECTION
    journalLogger.info({ event: 'ensure_output_dir_start', path: OUTPUT_DIR }, `Ensuring output directory exists: ${OUTPUT_DIR}`);
    try {
      // Use { recursive: true } to create parent directories if they don't exist
      await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
      journalLogger.info({ event: 'ensure_output_dir_success', path: OUTPUT_DIR }, "Output directory ensured.");
    } catch (mkdirError: any) {
      // Log an error if directory creation fails (e.g., due to permissions higher up the tree)
      // but proceed to attempt writing anyway, letting the writeFile error handle it.
      journalLogger.error({ err: mkdirError, path: OUTPUT_DIR, event: 'ensure_output_dir_failed' }, `Could not ensure output directory exists. File writing might fail.`);
      // Decide if you want to stop here or let the writeFile attempt handle the error.
      // For robustness, we can let writeFile try, but logging this error is important.
      // throw new Error(`Failed to create output directory: ${mkdirError.message}`); // Option to stop execution
    }
    // --- End Ensure Output Directory Exists ---

    // --- Write Output ---
    journalLogger.info({ event: 'output_write_start', path: OUTPUT_JSON, count: allJournalData.length }, `Attempting to write ${allJournalData.length} journal records.`);
    try {
      await fs.promises.writeFile(OUTPUT_JSON, JSON.stringify(allJournalData, null, 2), 'utf8');
      journalLogger.info({ event: 'output_write_success', path: OUTPUT_JSON }, `Journal data saved successfully.`);
    } catch (error: any) {
      journalLogger.error({ err: error, path: OUTPUT_JSON, event: 'output_write_failed' }, `Error writing final JSON file.`);
      return allJournalData; // Still return data even if write fails
    }

    return allJournalData; // Return data after successful write




  } catch (error: any) {
    journalLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during journal crawling process");
    return allJournalData; // Return whatever was collected before the fatal error
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

    // Now totalTasks is accessible here
    journalLogger.info({
      event: 'crawl_summary',
      mode: JOURNAL_CRAWL_MODE,
      totalTasksAttempted: totalTasks, // OK NOW
      journalsProcessed: processedCount,
      journalsWritten: allJournalData.length,
      imageSearchesFailed: failedImageSearchCount,
      imageSearchesSkipped: skippedImageSearchCount,
      totalGoogleApiRequests: apiKeyManager.getTotalRequests(),
      keysExhausted: apiKeyManager.areAllKeysExhausted(),
      durationSeconds,
      startTime: new Date(operationStartTime).toISOString(),
      endTime: new Date(operationEndTime).toISOString(),
      outputPath: OUTPUT_JSON
    }, "Journal crawling process summary");

    journalLogger.info({ event: 'crawl_end' }, "crawlJournals process finished.");
    // --- End Cleanup and Summary ---
  }
};