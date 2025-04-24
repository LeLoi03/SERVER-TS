// src/journal/crawlJournals.ts

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { logger as rootLogger } from './utils'; // Assuming typeof rootLogger is exported from utils or use 'any'/'object'

// Import the ApiKeyManager class
// ============================================
// Lớp quản lý API Key
// ============================================
class ApiKeyManager {
  private readonly keys: readonly string[];
  private readonly maxUsagePerKey: number;
  private readonly rotationDelayMs: number;
  private readonly logger: typeof rootLogger; // Use the specific logger type

  private currentIndex: number = 0;
  private currentUsage: number = 0;
  private totalRequestsInternal: number = 0;
  private isExhausted: boolean = false;

  // Updated constructor to accept the logger type
  constructor(keys: string[] | undefined, maxUsage: number, delayMs: number, parentLogger: typeof rootLogger) {
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

  // No changes needed inside methods as they already use this.logger
  public async getNextKey(): Promise<string | null> {
    if (this.isExhausted) {
      // Logged when set
      return null;
    }
    if (this.currentUsage >= this.maxUsagePerKey && this.keys.length > 0) {
      this.logger.info({
        keyIndex: this.currentIndex + 1,
        usage: this.currentUsage,
        limit: this.maxUsagePerKey,
        event: 'usage_limit_reached'
      }, 'API key usage limit reached, attempting rotation.');
      const rotated = await this.rotate(false);
      if (!rotated) {
        return null;
      }
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

  public async forceRotate(): Promise<boolean> {
    if (this.isExhausted) {
      this.logger.warn({ event: 'force_rotate_skipped' }, "Cannot force rotate key, all keys are already marked as exhausted.");
      return false;
    }
    return this.rotate(true);
  }

  private async rotate(isForced: boolean): Promise<boolean> {
    const oldIndex = this.currentIndex;
    this.logger.warn({
      oldKeyIndex: oldIndex + 1,
      reason: isForced ? 'Error (e.g., 429)' : 'Usage Limit Reached',
      event: 'rotation_start'
    }, `Attempting ${isForced ? 'forced ' : ''}rotation to next API key.`);
    this.currentIndex++;
    this.currentUsage = 0;
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

  public getCurrentKeyIndex(): number { return this.currentIndex; }
  public getCurrentKeyUsage(): number { return this.currentUsage; }
  public getTotalRequests(): number { return this.totalRequestsInternal; }
  public areAllKeysExhausted(): boolean { return this.isExhausted; }
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
  GOOGLE_CUSTOM_SEARCH_API_KEYS,
  GOOGLE_CSE_ID,
  MAX_USAGE_PER_KEY,
  KEY_ROTATION_DELAY_MS,
} from '../config';
// Import Scimago functions
import { processPage, fetchDetails, getImageUrlAndDetails, getLastPageNumber } from './scimagojr';
// Import Bioxbio function
import { fetchBioxbioData } from './bioxbio';
// Import Utils
import { createURLList, readCSV, appendJournalToFile } from './utils';
// Import Types
import { TableRowData, JournalDetails, CSVRow } from './types';
import { parseCSVString } from './utils';

// --- Paths ---
export const INPUT_CSV: string = path.join(__dirname, './csv/import_journal.csv');
const OUTPUT_DIR = path.resolve(__dirname, './data');
const OUTPUT_JSON = path.join(OUTPUT_DIR, 'journal_data.jsonl');

// ============================================
// Hàm Crawl Chính cho Journals
// ============================================
export const crawlJournals = async (
  dataSource: 'scimago' | 'client', // Input: Source type
  clientData: string | null,       // Input: Raw CSV string if dataSource is 'client'
  parentLogger: typeof rootLogger  // Input: Logger instance
): Promise<void> => {

  const journalLogger = parentLogger.child({ service: 'crawlJournals', dataSource });
  journalLogger.info({ event: 'init_start', outputFile: OUTPUT_JSON }, "Initializing journal crawl...");

  // --- Khởi tạo API Key Manager ---
  const apiKeyManager = new ApiKeyManager(
    GOOGLE_CUSTOM_SEARCH_API_KEYS,
    MAX_USAGE_PER_KEY,
    KEY_ROTATION_DELAY_MS,
    journalLogger // Pass the specific logger instance
  );

  let browser: Browser | null = null;
  const operationStartTime = Date.now();
  let processedCount = 0;
  let failedImageSearchCount = 0; // Ensure these are updated in performImageSearch
  let skippedImageSearchCount = 0; // Ensure these are updated in performImageSearch
  let totalTasks = 0; // Total items to process (URLs or CSV rows)

  try {
    // --- Ensure Output Directory Exists and Clear/Initialize Output File ---
    // (Keep existing logic for output directory/file preparation)
    journalLogger.info({ event: 'prepare_output_start', path: OUTPUT_DIR }, `Ensuring output directory exists: ${OUTPUT_DIR}`);
    try {
      await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
      journalLogger.info({ event: 'prepare_output_dir_success', path: OUTPUT_DIR }, "Output directory ensured.");
      journalLogger.info({ event: 'prepare_output_file_start', path: OUTPUT_JSON }, `Initializing output file: ${OUTPUT_JSON}`);
      // Initialize or clear the file
      await fs.promises.writeFile(OUTPUT_JSON, '', 'utf8');
      journalLogger.info({ event: 'prepare_output_file_success', path: OUTPUT_JSON }, "Output file initialized.");
    } catch (outputPrepError: any) {
      journalLogger.error({ err: outputPrepError, path: OUTPUT_DIR, event: 'prepare_output_failed' }, `Could not ensure output directory or initialize file. Crawling cannot proceed reliably.`);
      throw new Error(`Failed to prepare output directory/file: ${outputPrepError.message}`);
    }

    journalLogger.info({ event: 'browser_launch_start', headless: HEADLESS, channel: CHANNEL }, "Launching browser...");
    browser = await chromium.launch({
      channel: CHANNEL,
      headless: HEADLESS, // Use config value
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
      taskLogger: typeof rootLogger, // Use specific logger type
      details: JournalDetails | null,
      row: TableRowData | CSVRow,
      journalData: JournalDetails
    ): Promise<void> => {
      const journalTitle = journalData.title || (row as CSVRow)?.Title || (row as TableRowData)?.journalName || 'Unknown Journal';
      taskLogger.info({ event: 'image_search_start', journalTitle }, "Attempting image search.");

      if (apiKeyManager.areAllKeysExhausted()) {
        taskLogger.warn({ event: 'image_search_skip_exhausted', journalTitle }, `Skipping image search - All API keys exhausted.`);
        skippedImageSearchCount++;
        return;
      }

      const apiKey = await apiKeyManager.getNextKey();
      if (!apiKey) {
        taskLogger.warn({ event: 'image_search_skip_no_key', journalTitle }, `Skipping image search - Failed to get API key (exhausted).`);
        skippedImageSearchCount++;
        if (!apiKeyManager.areAllKeysExhausted()) {
          taskLogger.error({ event: 'unexpected_no_key_journal', journalTitle }, "ApiKeyManager anomaly: getNextKey returned null but not marked exhausted.");
        }
        return;
      }

      const cseId = GOOGLE_CSE_ID!;
      taskLogger.info({
        event: 'image_search_attempt',
        keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
        usageOnKey: apiKeyManager.getCurrentKeyUsage(),
        journalTitle
      }, `Performing image search using key #${apiKeyManager.getCurrentKeyIndex() + 1}`);

      try {
        // ===> Pass logger to getImageUrlAndDetails <===
        const { Image, Image_Context } = await getImageUrlAndDetails(details, row, apiKey, cseId, taskLogger);
        journalData.Image = Image;
        journalData.Image_Context = Image_Context;
        taskLogger.info({ event: 'image_search_success', hasImage: !!Image, journalTitle }, "Image search successful.");
      } catch (searchError: any) {
        failedImageSearchCount++;
        taskLogger.error({ err: searchError, event: 'image_search_failed', journalTitle }, `Image search failed`);

        const statusCode = searchError.statusCode || searchError.status;
        const isQuotaError = statusCode === 429 || statusCode === 403;

        if (isQuotaError) {
          taskLogger.warn({
            event: 'image_search_quota_error',
            keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
            statusCode: statusCode || 'N/A',
            journalTitle
          }, `Quota/Rate limit error detected during image search. Forcing key rotation.`);
          await apiKeyManager.forceRotate();
        }
      }
    };

    // --- processTabScimago ---
    const processTabScimago = async (page: Page, url: string, tabIndex: number): Promise<void> => {
      // Create a child logger for this specific tab/URL processing
      const tabLogger = journalLogger.child({ process: 'scimago', url, tabIndex, event_group: 'scimago_tab' });
      tabLogger.info({ event: 'tab_start' }, "Processing Scimago URL");
      let rows: TableRowData[];
      try {
        // ===> Pass logger to processPage <===
        rows = await processPage(page, url, tabLogger);
        tabLogger.info({ event: 'page_processed', rowCount: rows.length }, `Processed page, found ${rows.length} rows.`);
      } catch (pageError: any) {
        tabLogger.error({ err: pageError, event: 'page_process_failed' }, "Error processing Scimago page");
        return;
      }

      for (const row of rows) {
        // Create a child logger for this specific journal task
        const taskLogger = tabLogger.child({ journalTitle: row.journalName, scimagoLink: row.journalLink, event_group: 'journal_task_scimago' });
        taskLogger.info({ event: 'task_start' }, `Processing journal row`);

        let journalData: JournalDetails = {
          title: row.journalName,
          scimagoLink: row.journalLink,
          bioxbio: null,
          Image: null,
          Image_Context: null,
          // Include raw CSV data if needed for context, or parse it
        };

        // Populate data from CSV row string within the TableRowData
        try {
          const csvRowArray = row.csvRow.split(',');
          const headers = JOURNAL_CSV_HEADERS.trim().split(',');
          headers.forEach((header, index) => {
            const cleanHeader = header.trim();
            if (csvRowArray[index] !== undefined) {
              // Assign directly to journalData using the header as key
              (journalData as any)[cleanHeader] = csvRowArray[index].trim();
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
            // ===> Pass logger to fetchBioxbioData <===
            // **ASSUMPTION**: fetchBioxbioData is updated to accept logger
            journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, row.journalName, taskLogger);
            taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, "BioxBio fetch complete.");
          }

          if (JOURNAL_CRAWL_DETAILS) {
            taskLogger.info({ event: 'details_fetch_start' }, "Fetching Scimago details.");
            // ===> Pass logger to fetchDetails <===
            const details = await fetchDetails(page, row.journalLink, taskLogger);
            if (details) {
              taskLogger.info({ event: 'details_fetch_success' }, "Scimago details fetched.");
              Object.assign(journalData, details); // Merge details into journalData
              await performImageSearch(taskLogger, details, row, journalData); // Pass taskLogger
            } else {
              taskLogger.warn({ event: 'details_fetch_failed' }, "Could not fetch Scimago details.");
              await performImageSearch(taskLogger, null, row, journalData); // Pass taskLogger
            }
          } else {
            // Still perform image search even if details aren't fetched, using row data
            await performImageSearch(taskLogger, null, row, journalData); // Pass taskLogger
          }

          // ===> Pass logger to appendJournalToFile <===
          // **ASSUMPTION**: appendJournalToFile is updated to accept logger
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
      // Create a child logger for this specific CSV row task
      const taskLogger = journalLogger.child({ process: 'csv', journalTitle: journalName, rowIndex, tabIndex, event_group: 'journal_task_csv' });
      taskLogger.info({ event: 'task_start' }, "Processing CSV row");

      let journalLink: string | undefined;
      if (row.Sourceid && String(row.Sourceid).trim() !== '') {
        journalLink = `https://www.scimagojr.com/journalsearch.php?q=${row.Sourceid}&tip=sid&clean=0`;
        taskLogger.debug({ event: 'link_generated', type: 'sourceid', sourceId: row.Sourceid });
      } else if (journalName && journalName !== `Row-${rowIndex}`) {
        taskLogger.warn({ event: 'link_generation_warning', reason: 'Missing Sourceid, using title' }, "Generating Scimago link from title.");
        journalLink = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(journalName)}&tip=jou&clean=0`;
      } else {
        taskLogger.error({ event: 'link_generation_failed', reason: 'Missing both Sourceid and Title' }, "Skipping row.");
        return; // Cannot proceed without a link or title
      }

      let journalData: JournalDetails = {
        scimagoLink: journalLink, // May be undefined if link generation failed
        bioxbio: null,
        Image: null,
        Image_Context: null,
        ...row // Spread CSV row data first
      };
      // Ensure title is set if available from CSV Title
      if (!journalData.title && row.Title) {
        journalData.title = row.Title;
      }
      taskLogger.debug({ event: 'initial_data_populated' }, "Populated initial data from CSV.");


      try {
        if (JOURNAL_CRAWL_BIOXBIO && journalName && journalName !== `Row-${rowIndex}`) {
          taskLogger.info({ event: 'bioxbio_fetch_start' }, "Fetching BioxBio data.");
          const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`;
          // ===> Pass logger to fetchBioxbioData <===
          // **ASSUMPTION**: fetchBioxbioData is updated to accept logger
          journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalName, taskLogger);
          taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, "BioxBio fetch complete.");
        }

        if (JOURNAL_CRAWL_DETAILS && journalLink) { // Only fetch details if we have a link
          taskLogger.info({ event: 'details_fetch_start' }, "Fetching Scimago details.");
          // ===> Pass logger to fetchDetails <===
          const details = await fetchDetails(page, journalLink, taskLogger);
          if (details) {
            taskLogger.info({ event: 'details_fetch_success' }, "Scimago details fetched.");
            Object.assign(journalData, details); // Merge details (overwriting CSV if conflicts)
            await performImageSearch(taskLogger, details, row, journalData); // Pass taskLogger
          } else {
            taskLogger.warn({ event: 'details_fetch_failed' }, `Could not fetch Scimago details`);
            await performImageSearch(taskLogger, null, row, journalData); // Pass taskLogger
          }
        } else if (!journalLink) {
          taskLogger.warn({ event: 'details_fetch_skipped', reason: 'No valid Scimago link' });
          // Still attempt image search even if no details link
          await performImageSearch(taskLogger, null, row, journalData); // Pass taskLogger
        } else {
          // Details not enabled, but link exists. Perform image search using CSV data.
          await performImageSearch(taskLogger, null, row, journalData); // Pass taskLogger
        }

        // ===> Pass logger to appendJournalToFile <===
        // **ASSUMPTION**: appendJournalToFile is updated to accept logger
        await appendJournalToFile(journalData, OUTPUT_JSON, taskLogger);
        processedCount++;
        taskLogger.info({ event: 'task_success' }, `Successfully processed and saved CSV row`);

      } catch (error: any) {
        taskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, `Unhandled error processing CSV row`);
      }
    };

    // --- Main Execution Logic based on dataSource ---
    if (dataSource === 'scimago') {
      journalLogger.info({ event: 'mode_scimago_start' }, "Starting crawl in Scimago mode.");
      const firstPage = pages[0];
      let lastPageNumber = 1;
      let urls: string[] = [];
      try {
        // ===> Pass logger to getLastPageNumber <===
        lastPageNumber = await getLastPageNumber(firstPage, BASE_URL, journalLogger);
        journalLogger.info({ event: 'scimago_last_page_found', lastPage: lastPageNumber }, `Total Scimago pages estimated: ${lastPageNumber}`);
        urls = createURLList(BASE_URL, lastPageNumber);
        totalTasks = urls.length; // Total URLs to process

        journalLogger.info({ event: 'scimago_processing_start', urlCount: totalTasks }, `Starting processing ${totalTasks} Scimago URLs.`);
        // Batch processing loop for Scimago URLs
        for (let i = 0; i < urls.length; i += MAX_TABS) {
          const batchUrls = urls.slice(i, i + MAX_TABS);
          const batchIndex = Math.floor(i / MAX_TABS) + 1;
          journalLogger.info({ event: 'scimago_batch_start', batchIndex, batchSize: batchUrls.length, startIndex: i });
          await Promise.all(
            batchUrls.map((url, idx) => {
              const pageIndex = idx % pages.length;
              return processTabScimago(pages[pageIndex], url, pageIndex); // Return promise
            })
          );
          journalLogger.info({ event: 'scimago_batch_finish', batchIndex, urlsInBatch: batchUrls.length, totalProcessed: processedCount });
        }
      } catch (error: any) {
        journalLogger.error({ err: error, event: 'scimago_processing_error' }, `Failed during Scimago page processing loop.`);
        // Decide if error is fatal or if processing can continue partially
      }

    } else if (dataSource === 'client') {
      journalLogger.info({ event: 'mode_client_start' }, "Starting crawl using client-provided data.");
      if (!clientData) {
        // This should ideally be caught by the controller, but double-check
        journalLogger.error({ event: 'client_data_missing' }, "Client data source selected, but no data provided to crawlJournals function.");
        throw new Error("Client data source selected, but no data provided.");
      }
      try {
        // Use the new parseCSVString function
        const csvData: CSVRow[] = await parseCSVString(clientData, journalLogger); // Pass logger
        totalTasks = csvData.length; // Total rows to process
        journalLogger.info({ event: 'client_data_parse_success', rowCount: totalTasks }, `Total journals to process from client data: ${totalTasks}`);

        if (totalTasks === 0) {
          journalLogger.warn({ event: 'client_data_empty' }, "Client data parsed successfully but resulted in zero records.");
          // No further processing needed
        } else {
          // Batch processing loop for CSV rows
          for (let i = 0; i < csvData.length; i += MAX_TABS) {
            const batchRows = csvData.slice(i, i + MAX_TABS);
            const batchIndex = Math.floor(i / MAX_TABS) + 1;
            journalLogger.info({ event: 'client_batch_start', batchIndex, batchSize: batchRows.length, startIndex: i });
            await Promise.all(
              batchRows.map((row, idx) => {
                const pageIndex = idx % pages.length;
                // Pass row, page index, and original row index (i + idx)
                return processTabCSV(pages[pageIndex], row, pageIndex, i + idx); // Return promise
              })
            );
            journalLogger.info({ event: 'client_batch_finish', batchIndex, rowsInBatch: batchRows.length, totalProcessed: processedCount });
          }
        }
      } catch (error: any) {
        // Error could be from parseCSVString or during the processing loop
        journalLogger.error({ err: error, event: 'client_data_processing_error' }, `Failed to parse or process client-provided data`);
        throw error; // Re-throw to be caught by the main try/catch and handled by the controller
      }
    }
    // Removed the 'else' block for invalid mode as dataSource is now strictly 'scimago' or 'client'

    journalLogger.info({ event: 'crawl_loops_completed' }, "Finished processing all designated tasks.");

  } catch (error: any) {
    journalLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during journal crawling process");
    throw error; // Re-throw for upstream handling (controller)
  } finally {
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
      dataSource: dataSource, // Log the actual data source used
      totalTasksDefined: totalTasks,
      journalsProcessedAndSaved: processedCount,
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
  }
  // No explicit return needed for void
};