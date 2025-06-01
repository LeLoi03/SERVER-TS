// src/journal/crawlJournals.ts
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
import { logger as rootLogger } from './utils';
import { ConfigService } from '../config/config.service'; // <<<< IMPORT ConfigService

// Import Scimago functions
import { processPage, fetchDetails, getImageUrlAndDetails, getLastPageNumber } from './scimagojr';
// Import Bioxbio function
import { fetchBioxbioData } from './bioxbio';
// Import Utils
import { createURLList, appendJournalToFile } from './utils'; // readCSV and parseCSVString are used internally or passed as clientData
// Import Types
import { TableRowData, JournalDetails, CSVRow } from './types';
import { parseCSVString } from './utils'; // Keep if used for clientData parsing

const MAX_TABS = 5;

// ============================================
// Lớp quản lý API Key (ApiKeyManager)
// ============================================
class ApiKeyManager {
  private readonly keys: readonly string[];
  private readonly maxUsagePerKey: number;
  private readonly rotationDelayMs: number;
  private readonly logger: typeof rootLogger;

  private currentIndex: number = 0;
  private currentUsage: number = 0;
  private totalRequestsInternal: number = 0;
  private isExhausted: boolean = false;

  constructor(keys: string[] | undefined, maxUsage: number, delayMs: number, parentLogger: typeof rootLogger) {
    this.keys = Object.freeze([...(keys || [])]);
    this.maxUsagePerKey = maxUsage;
    this.rotationDelayMs = delayMs;
    this.logger = parentLogger.child({ service: 'ApiKeyManager' });

    if (this.keys.length === 0) {
      this.logger.error({ event: 'init_error' }, "CRITICAL: No Google API Keys provided to ApiKeyManager. Searches will fail.");
      this.isExhausted = true;
    } else {
      this.logger.info({ keyCount: this.keys.length, maxUsage: this.maxUsagePerKey, event: 'init_success' }, "ApiKeyManager initialized.");
    }
  }

  public async getNextKey(): Promise<string | null> {
    if (this.isExhausted) {
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


// ============================================
// Hàm Crawl Chính cho Journals
// ============================================
export const crawlJournals = async (
  dataSource: 'scimago' | 'client', // Input: Source type
  clientData: string | null,       // Input: Raw CSV string if dataSource is 'client'
  parentLogger: typeof rootLogger,  // Input: Logger instance
  configService: ConfigService     // <<<< ADD ConfigService parameter
): Promise<void> => {

  const config = configService.config; // Get the raw config object
  const journalLogger = parentLogger.child({ service: 'crawlJournals', dataSource });

  // --- Get output path from ConfigService ---
  const OUTPUT_JSON = configService.journalOutputJsonlPath;
  const OUTPUT_DIR = path.dirname(OUTPUT_JSON); // Derive output directory

  journalLogger.info({ event: 'init_start', outputFile: OUTPUT_JSON }, "Initializing journal crawl...");

  // --- Khởi tạo API Key Manager using ConfigService ---
  const apiKeyManager = new ApiKeyManager(
    config.GOOGLE_CUSTOM_SEARCH_API_KEYS, // From ConfigService
    config.MAX_USAGE_PER_KEY,             // From ConfigService
    config.KEY_ROTATION_DELAY_MS,         // From ConfigService
    journalLogger
  );

  let browser: Browser | null = null;
  const operationStartTime = Date.now();
  let processedCount = 0;
  let failedImageSearchCount = 0;
  let skippedImageSearchCount = 0;
  let totalTasks = 0;

  try {
    journalLogger.info({ event: 'prepare_output_start', path: OUTPUT_DIR }, `Ensuring output directory exists: ${OUTPUT_DIR}`);
    try {
      await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
      journalLogger.info({ event: 'prepare_output_dir_success', path: OUTPUT_DIR }, "Output directory ensured.");
      journalLogger.info({ event: 'prepare_output_file_start', path: OUTPUT_JSON }, `Initializing output file: ${OUTPUT_JSON}`);
      await fs.promises.writeFile(OUTPUT_JSON, '', 'utf8');
      journalLogger.info({ event: 'prepare_output_file_success', path: OUTPUT_JSON }, "Output file initialized.");
    } catch (outputPrepError: any) {
      journalLogger.error({ err: outputPrepError, path: OUTPUT_DIR, event: 'prepare_output_failed' }, `Could not ensure output directory or initialize file. Crawling cannot proceed reliably.`);
      throw new Error(`Failed to prepare output directory/file: ${outputPrepError.message}`);
    }

    journalLogger.info({
        event: 'browser_launch_start',
        headless: config.PLAYWRIGHT_HEADLESS, // From ConfigService
        channel: config.PLAYWRIGHT_CHANNEL    // From ConfigService
    }, "Launching browser...");
    browser = await chromium.launch({
      channel: config.PLAYWRIGHT_CHANNEL,  // From ConfigService
      headless: config.PLAYWRIGHT_HEADLESS, // From ConfigService
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
      userAgent: config.USER_AGENT, // From ConfigService
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
      taskLogger: typeof rootLogger,
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

      const cseId = config.GOOGLE_CSE_ID; // From ConfigService
      if (!cseId) {
        taskLogger.warn({ event: 'image_search_skip_no_cse_id', journalTitle }, `Skipping image search - GOOGLE_CSE_ID is not configured.`);
        skippedImageSearchCount++;
        return;
      }

      taskLogger.info({
        event: 'image_search_attempt',
        keyIndex: apiKeyManager.getCurrentKeyIndex() + 1,
        usageOnKey: apiKeyManager.getCurrentKeyUsage(),
        journalTitle
      }, `Performing image search using key #${apiKeyManager.getCurrentKeyIndex() + 1}`);

      try {
        const { Image, Image_Context } = await getImageUrlAndDetails(details, row, apiKey, taskLogger, configService);
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
      const tabLogger = journalLogger.child({ process: 'scimago', url, tabIndex, event_group: 'scimago_tab' });
      tabLogger.info({ event: 'tab_start' }, "Processing Scimago URL");
      let rows: TableRowData[];
      try {
        rows = await processPage(page, url, tabLogger, configService);
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
          Image_Context: null,
        };

        try {
          const csvRowArray = row.csvRow.split(',');
          // Use JOURNAL_CSV_HEADERS from ConfigService
          const headers = config.JOURNAL_CSV_HEADERS.trim().split(',');
          headers.forEach((header, index) => {
            const cleanHeader = header.trim();
            if (csvRowArray[index] !== undefined) {
              (journalData as any)[cleanHeader] = csvRowArray[index].trim();
            }
          });
          taskLogger.debug({ event: 'csv_data_parsed', headers: headers.length }, "Parsed CSV data from row string.");
        } catch (parseError: any) {
          taskLogger.warn({ err: parseError, event: 'csv_data_parse_failed', rawCsv: row.csvRow }, "Could not parse CSV data from row string.");
        }


        try {
          // Use JOURNAL_CRAWL_BIOXBIO from ConfigService
          if (config.JOURNAL_CRAWL_BIOXBIO && row.journalName) {
            taskLogger.info({ event: 'bioxbio_fetch_start' }, "Fetching BioxBio data.");
            const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(row.journalName)}`;
            journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, row.journalName, taskLogger);
            taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, "BioxBio fetch complete.");
          }

          // Use JOURNAL_CRAWL_DETAILS from ConfigService
          if (config.JOURNAL_CRAWL_DETAILS) {
            taskLogger.info({ event: 'details_fetch_start' }, "Fetching Scimago details.");
            const details = await fetchDetails(page, row.journalLink, taskLogger, configService);
            if (details) {
              taskLogger.info({ event: 'details_fetch_success' }, "Scimago details fetched.");
              Object.assign(journalData, details);
              await performImageSearch(taskLogger, details, row, journalData);
            } else {
              taskLogger.warn({ event: 'details_fetch_failed' }, "Could not fetch Scimago details.");
              await performImageSearch(taskLogger, null, row, journalData);
            }
          } else {
            await performImageSearch(taskLogger, null, row, journalData);
          }

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
        taskLogger.warn({ event: 'link_generation_warning', reason: 'Missing Sourceid, using title' }, "Generating Scimago link from title.");
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
        ...row
      };
      if (!journalData.title && row.Title) {
        journalData.title = row.Title;
      }
      taskLogger.debug({ event: 'initial_data_populated' }, "Populated initial data from CSV.");


      try {
        // Use JOURNAL_CRAWL_BIOXBIO from ConfigService
        if (config.JOURNAL_CRAWL_BIOXBIO && journalName && journalName !== `Row-${rowIndex}`) {
          taskLogger.info({ event: 'bioxbio_fetch_start' }, "Fetching BioxBio data.");
          const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`;
          journalData.bioxbio = await fetchBioxbioData(page, bioxbioSearchUrl, journalName, taskLogger);
          taskLogger.info({ event: 'bioxbio_fetch_complete', hasData: !!journalData.bioxbio }, "BioxBio fetch complete.");
        }

        // Use JOURNAL_CRAWL_DETAILS from ConfigService
        if (config.JOURNAL_CRAWL_DETAILS && journalLink) {
          taskLogger.info({ event: 'details_fetch_start' }, "Fetching Scimago details.");
          const details = await fetchDetails(page, journalLink, taskLogger, configService);
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
          await performImageSearch(taskLogger, null, row, journalData);
        } else {
          await performImageSearch(taskLogger, null, row, journalData);
        }

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
        // Use JOURNAL_BASE_URL from ConfigService
        lastPageNumber = await getLastPageNumber(firstPage, config.JOURNAL_BASE_URL, journalLogger, configService);
        journalLogger.info({ event: 'scimago_last_page_found', lastPage: lastPageNumber }, `Total Scimago pages estimated: ${lastPageNumber}`);
        // Use JOURNAL_BASE_URL from ConfigService
        urls = createURLList(config.JOURNAL_BASE_URL, lastPageNumber);
        totalTasks = urls.length;

        journalLogger.info({ event: 'scimago_processing_start', urlCount: totalTasks }, `Starting processing ${totalTasks} Scimago URLs.`);
        for (let i = 0; i < urls.length; i += MAX_TABS) {
          const batchUrls = urls.slice(i, i + MAX_TABS);
          const batchIndex = Math.floor(i / MAX_TABS) + 1;
          journalLogger.info({ event: 'scimago_batch_start', batchIndex, batchSize: batchUrls.length, startIndex: i });
          await Promise.all(
            batchUrls.map((url, idx) => {
              const pageIndex = idx % pages.length;
              return processTabScimago(pages[pageIndex], url, pageIndex);
            })
          );
          journalLogger.info({ event: 'scimago_batch_finish', batchIndex, urlsInBatch: batchUrls.length, totalProcessed: processedCount });
        }
      } catch (error: any) {
        journalLogger.error({ err: error, event: 'scimago_processing_error' }, `Failed during Scimago page processing loop.`);
      }

    } else if (dataSource === 'client') {
      journalLogger.info({ event: 'mode_client_start' }, "Starting crawl using client-provided data.");
      if (!clientData) {
        journalLogger.error({ event: 'client_data_missing' }, "Client data source selected, but no data provided to crawlJournals function.");
        throw new Error("Client data source selected, but no data provided.");
      }
      try {
        const csvData: CSVRow[] = await parseCSVString(clientData, journalLogger); // Pass headers if needed
        totalTasks = csvData.length;
        journalLogger.info({ event: 'client_data_parse_success', rowCount: totalTasks }, `Total journals to process from client data: ${totalTasks}`);

        if (totalTasks === 0) {
          journalLogger.warn({ event: 'client_data_empty' }, "Client data parsed successfully but resulted in zero records.");
        } else {
          for (let i = 0; i < csvData.length; i += MAX_TABS) {
            const batchRows = csvData.slice(i, i + MAX_TABS);
            const batchIndex = Math.floor(i / MAX_TABS) + 1;
            journalLogger.info({ event: 'client_batch_start', batchIndex, batchSize: batchRows.length, startIndex: i });
            await Promise.all(
              batchRows.map((row, idx) => {
                const pageIndex = idx % pages.length;
                return processTabCSV(pages[pageIndex], row, pageIndex, i + idx);
              })
            );
            journalLogger.info({ event: 'client_batch_finish', batchIndex, rowsInBatch: batchRows.length, totalProcessed: processedCount });
          }
        }
      } catch (error: any) {
        journalLogger.error({ err: error, event: 'client_data_processing_error' }, `Failed to parse or process client-provided data`);
        throw error;
      }
    }

    journalLogger.info({ event: 'crawl_loops_completed' }, "Finished processing all designated tasks.");

  } catch (error: any) {
    journalLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during journal crawling process");
    throw error;
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
      dataSource: dataSource,
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
};