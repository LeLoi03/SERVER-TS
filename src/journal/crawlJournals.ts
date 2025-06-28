// src/journal/crawlJournals.ts
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
// Bỏ: import { logger as rootLogger } from './utils';
import { ConfigService } from '../config/config.service';
import { Logger } from 'pino'; // <<<< IMPORT Logger từ Pino

// Import Scimago functions
import { processPage, fetchDetails, getImageUrlAndDetails, getLastPageNumber } from './scimagojr';
// Import Bioxbio function
import { fetchBioxbioData } from './bioxbio';
// Import Utils
import { createURLList, appendJournalToFile, parseCSVString, retryAsync } from './utils'; // Thêm retryAsync nếu dùng
// Import Types
import { TableRowData, JournalDetails, CSVRow } from './types';
// Bỏ: import { parseCSVString } from './utils'; // Đã import ở trên

// ============================================
// Lớp quản lý API Key (ApiKeyManager)
// ============================================
class ApiKeyManager {
  private readonly keys: readonly string[];
  private readonly maxUsagePerKey: number;
  private readonly rotationDelayMs: number;
  private readonly logger: Logger; // <<<< Sử dụng Logger từ Pino

  private currentIndex: number = 0;
  private currentUsage: number = 0;
  private totalRequestsInternal: number = 0;
  private isExhausted: boolean = false;

  constructor(keys: string[] | undefined, maxUsage: number, delayMs: number, parentLogger: Logger) { // <<<< parentLogger là Logger
    this.keys = Object.freeze([...(keys || [])]);
    this.maxUsagePerKey = maxUsage;
    this.rotationDelayMs = delayMs;
    this.logger = parentLogger.child({ serviceContext: 'ApiKeyManager' }); // Đổi tên context cho rõ ràng

    if (this.keys.length === 0) {
      this.logger.error({ event: 'init_error' }, "CRITICAL: No Google API Keys provided to ApiKeyManager. Searches will fail.");
      this.isExhausted = true;
    } else {
      this.logger.info({ keyCount: this.keys.length, maxUsage: this.maxUsagePerKey, event: 'init_success' }, "ApiKeyManager initialized.");
    }
  }

  public async getNextKey(): Promise<string | null> {
    if (this.isExhausted) {
      this.logger.warn({ event: 'get_key_exhausted' }, "Attempted to get key, but all keys are exhausted."); // Log rõ hơn
      return null;
    }
    if (this.currentUsage >= this.maxUsagePerKey && this.keys.length > 0) {
      this.logger.info({
        keyIndex: this.currentIndex, // Index bắt đầu từ 0
        usage: this.currentUsage,
        limit: this.maxUsagePerKey,
        event: 'usage_limit_reached'
      }, `API key usage limit reached for key #${this.currentIndex + 1}, attempting rotation.`);
      const rotated = await this.rotate(false); // isForced = false
      if (!rotated) {
        this.logger.warn({ event: 'get_key_rotation_failed_exhausted' }, "Rotation failed during getNextKey, all keys now exhausted.");
        return null; // Rotation failed, likely exhausted
      }
      if (this.rotationDelayMs > 0) {
        this.logger.info({
          delaySeconds: this.rotationDelayMs / 1000,
          nextKeyIndex: this.currentIndex, // Index của key mới
          event: 'rotation_delay_start'
        }, `Waiting ${this.rotationDelayMs / 1000}s after normal key rotation...`);
        await new Promise(resolve => setTimeout(resolve, this.rotationDelayMs));
        this.logger.info({ newKeyIndex: this.currentIndex, event: 'rotation_delay_end' }, `Finished waiting, proceeding with new key #${this.currentIndex + 1}.`);
      }
    }
    const key = this.keys[this.currentIndex];
    this.currentUsage++;
    this.totalRequestsInternal++;
    this.logger.debug({
      keyIndex: this.currentIndex,
      currentUsage: this.currentUsage,
      limit: this.maxUsagePerKey,
      totalRequests: this.totalRequestsInternal,
      event: 'key_provided'
    }, `Providing API key #${this.currentIndex + 1}`);
    return key;
  }

  public async forceRotate(reason: string = 'Error (e.g., 429)'): Promise<boolean> { // Thêm reason
    if (this.isExhausted) {
      this.logger.warn({ event: 'force_rotate_skipped_exhausted', reason }, "Cannot force rotate key, all keys are already marked as exhausted.");
      return false;
    }
    return this.rotate(true, reason); // isForced = true
  }

  private async rotate(isForced: boolean, reasonIfNotUsageLimit?: string): Promise<boolean> {
    const oldIndex = this.currentIndex;
    const rotationReason = isForced ? (reasonIfNotUsageLimit || 'Forced by error') : 'Usage Limit Reached';
    this.logger.warn({
      oldKeyIndex: oldIndex,
      reason: rotationReason,
      event: 'rotation_start'
    }, `Attempting ${isForced ? 'forced ' : ''}rotation to next API key.`);

    this.currentIndex++;
    this.currentUsage = 0; // Reset usage for the new key

    if (this.currentIndex >= this.keys.length) {
      this.logger.error({ // Dùng error vì đây là tình huống xấu
        rotationType: isForced ? 'forced' : 'normal',
        reason: rotationReason,
        event: 'rotation_failed_exhausted'
      }, "Rotation failed: Reached end of API key list. Marking all keys as exhausted.");
      this.isExhausted = true;
      return false;
    }
    this.logger.info({
      newKeyIndex: this.currentIndex,
      oldKeyIndex: oldIndex,
      rotationType: isForced ? 'forced' : 'normal',
      reason: rotationReason,
      event: 'rotation_success'
    }, `Successfully rotated from key #${oldIndex + 1} to new API key #${this.currentIndex + 1}.`);
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
  dataSource: 'scimago' | 'client',
  clientData: string | null,
  // parentLogger đã là một child logger từ controller với batchRequestId và route
  parentLogger: Logger, // <<<< NHẬN Logger từ Pino
  configService: ConfigService,
  // batchRequestId không cần truyền riêng nữa vì nó đã có trong parentLogger
): Promise<void> => {

  // parentLogger đã có context ban đầu (batchRequestId, route).
  // Tạo một logger chính cho toàn bộ quá trình crawlJournals này.
  const journalCrawlLogger = parentLogger.child({
      serviceContext: 'crawlJournalsMain', // Context cho service này
      dataSource // Thêm dataSource vào context chung
  });
  // Lấy batchRequestId từ bindings của logger (nếu cần dùng ở đây, thường không cần vì các child logger sẽ kế thừa)
  const batchRequestId = (journalCrawlLogger as any).bindings?.()?.batchRequestId || 'unknown-batch';


  const OUTPUT_JSON = configService.getJournalOutputJsonlPathForBatch(batchRequestId);
  const MAX_TABS = configService.crawlConcurrency;
  const OUTPUT_DIR = path.dirname(OUTPUT_JSON);

  journalCrawlLogger.info({ event: 'init_start', outputFile: OUTPUT_JSON, batchRequestIdFromLogger: batchRequestId }, "Initializing journal crawl for batch.");

  const apiKeyManager = new ApiKeyManager(
    configService.googleSearchConfig.apiKeys,
    configService.googleSearchConfig.maxUsagePerKey,
    configService.googleSearchConfig.rotationDelayMs,
    journalCrawlLogger // Truyền journalCrawlLogger làm parent cho ApiKeyManager
  );

  let browser: Browser | null = null;
  const operationStartTime = Date.now();
  let processedCount = 0;
  let failedImageSearchCount = 0;
  let skippedImageSearchCount = 0;
  let totalTasks = 0;

  try {
    journalCrawlLogger.info({ event: 'prepare_output_start', path: OUTPUT_DIR }, `Ensuring output directory exists: ${OUTPUT_DIR}`);
    try {
      await fs.promises.mkdir(OUTPUT_DIR, { recursive: true });
      journalCrawlLogger.info({ event: 'prepare_output_dir_success', path: OUTPUT_DIR }, "Output directory ensured.");
      journalCrawlLogger.info({ event: 'prepare_output_file_start', path: OUTPUT_JSON }, `Initializing output file: ${OUTPUT_JSON}`);
      await fs.promises.writeFile(OUTPUT_JSON, '', 'utf8');
      journalCrawlLogger.info({ event: 'prepare_output_file_success', path: OUTPUT_JSON }, "Output file initialized.");
    } catch (outputPrepError: any) {
      journalCrawlLogger.error({ err: outputPrepError, path: OUTPUT_DIR, event: 'prepare_output_failed' }, `Could not ensure output directory or initialize file.`);
      throw new Error(`Failed to prepare output directory/file: ${outputPrepError.message}`);
    }

    journalCrawlLogger.info({
      event: 'browser_launch_start',
      headless: configService.playwrightConfig.headless,
      channel: configService.playwrightConfig.channel
    }, "Launching browser...");
    browser = await chromium.launch({
      headless: configService.playwrightConfig.headless,
      channel: configService.playwrightConfig.channel,
      args: [ /* ... các args của bạn ... */
        "--disable-notifications", "--disable-geolocation", "--disable-extensions",
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu",
        "--blink-settings=imagesEnabled=false", "--ignore-certificate-errors"
      ],
    });
    journalCrawlLogger.info({ event: 'browser_launch_success' }, "Browser launched.");

    journalCrawlLogger.info({ event: 'context_create_start' }, "Creating browser context...");
    const browserContext: BrowserContext = await browser.newContext({
      permissions: [], viewport: { width: 1280, height: 720 }, ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
      userAgent: configService.playwrightConfig.userAgent,
    });
    journalCrawlLogger.info({ event: 'context_create_success' }, "Browser context created.");

    journalCrawlLogger.info({ event: 'pages_create_start', count: MAX_TABS }, `Creating ${MAX_TABS} pages...`);
    const pages: Page[] = await Promise.all(Array.from({ length: MAX_TABS }, (_, i) => {
      journalCrawlLogger.debug({ event: 'page_create', pageIndex: i });
      return browserContext.newPage();
    }));
    journalCrawlLogger.info({ event: 'pages_create_success', count: pages.length }, `Created ${pages.length} pages.`);

    // --- Shared Image Search Logic ---
    const performImageSearch = async (
      // taskLogger đã là một child logger với context của journal cụ thể
      taskLogger: Logger, // <<<< NHẬN Logger từ Pino
      details: JournalDetails | null,
      row: TableRowData | CSVRow,
      journalData: JournalDetails // journalData đã có title
  
    ): Promise<void> => {
      const journalTitle = journalData.title || 'Unknown Journal'; // Lấy title từ journalData
      const issn = journalData.issn || 'Unknown ISSN'; // Lấy ISSN từ journalData
      // taskLogger đã có context journalTitle từ nơi gọi nó (processTabScimago/processTabCSV)
      // Không cần tạo child logger mới ở đây trừ khi muốn thêm context rất cụ thể cho image search
      const imageSearchLogger = taskLogger.child({ imageSearchContext: true }); // Ví dụ thêm context

      imageSearchLogger.info({ event: 'image_search_start' }, "Attempting image search.");

      if (apiKeyManager.areAllKeysExhausted()) {
        imageSearchLogger.warn({ event: 'image_search_skip_exhausted' }, `Skipping image search - All API keys exhausted.`);
        skippedImageSearchCount++;
        return;
      }

      const apiKey = await apiKeyManager.getNextKey(); // ApiKeyManager đã có logger riêng
      if (!apiKey) {
        imageSearchLogger.warn({ event: 'image_search_skip_no_key' }, `Skipping image search - Failed to get API key (exhausted).`);
        skippedImageSearchCount++;
        return;
      }

      const cseId = configService.googleSearchConfig.cseId;
      if (!cseId) {
        imageSearchLogger.warn({ event: 'image_search_skip_no_cse_id' }, `Skipping image search - GOOGLE_CSE_ID is not configured.`);
        skippedImageSearchCount++;
        return;
      }

      imageSearchLogger.info({
        event: 'image_search_attempt',
        keyIndexUsed: apiKeyManager.getCurrentKeyIndex(), // Key index hiện tại đang dùng
      }, `Performing image search using key #${apiKeyManager.getCurrentKeyIndex() + 1}`);

      try {
        // getImageUrlAndDetails cần nhận imageSearchLogger
        const { Image, Image_Context } = await getImageUrlAndDetails(details, row, apiKey, imageSearchLogger, configService);
        journalData.Image = Image;
        journalData.Image_Context = Image_Context;
        imageSearchLogger.info({ event: 'image_search_success', hasImage: !!Image }, "Image search successful.");
      } catch (searchError: any) {
        failedImageSearchCount++;
        imageSearchLogger.error({ err: searchError, event: 'image_search_failed' }, `Image search failed`);
        const statusCode = searchError.statusCode || searchError.status;
        const isQuotaError = statusCode === 429 || statusCode === 403;
        if (isQuotaError) {
          imageSearchLogger.warn({
            event: 'image_search_quota_error',
            keyIndexAffected: apiKeyManager.getCurrentKeyIndex(),
            statusCode: statusCode || 'N/A',
          }, `Quota/Rate limit error detected. Forcing key rotation for key #${apiKeyManager.getCurrentKeyIndex() + 1}.`);
          await apiKeyManager.forceRotate(`Quota error ${statusCode} on image search`); // Truyền lý do
        }
      }
    };

    // --- processTabScimago ---
    const processTabScimago = async (page: Page, url: string, tabIndex: number): Promise<void> => {
      // Tạo child logger từ journalCrawlLogger cho mỗi tab/url
      const tabLogger = journalCrawlLogger.child({ processingUnit: 'scimagoTab', scimagoUrl: url, tabIndex });
      tabLogger.info({ event: 'tab_start' }, "Processing Scimago URL");
      let rows: TableRowData[];
      try {
        // processPage cần nhận tabLogger
        rows = await processPage(page, url, tabLogger, configService);
        tabLogger.info({ event: 'page_processed', rowCount: rows.length }, `Processed page, found ${rows.length} rows.`);
      } catch (pageError: any) {
        tabLogger.error({ err: pageError, event: 'page_process_failed' }, "Error processing Scimago page");
        return;
      }

      for (const row of rows) {
        // Tạo child logger cho mỗi journal row từ tabLogger
        const journalTaskLogger = tabLogger.child({
            journalProcessingStep: 'processScimagoJournalRow',
            journalTitle: row.journalName, // Thêm title vào context
            issn : row.issn || 'Unknown ISSN', // Thêm ISSN vào context
            scimagoLink: row.journalLink
        });
        journalTaskLogger.info({ event: 'task_start' }, `Processing journal row`);
        // ... (logic xử lý journalData, fetchBioxbio, fetchDetails như cũ)
        let journalData: JournalDetails = { /* ... khởi tạo ... */ title: row.journalName, scimagoLink: row.journalLink, bioxbio: null, Image: null, Image_Context: null };
        try {
            // ... parse CSV data ...
            const csvRowArray = row.csvRow.split(',');
            const headers = configService.journalCsvHeaders;
            headers.forEach((header, index) => {
                if (csvRowArray[index] !== undefined) (journalData as any)[header] = csvRowArray[index].trim();
            });
            journalTaskLogger.debug({ event: 'csv_data_parsed' });

            if (configService.journalCrawlBioxbio && row.journalName) {
                // fetchBioxbioData cần nhận journalTaskLogger
                journalData.bioxbio = await fetchBioxbioData(page, `https://www.bioxbio.com/?q=${encodeURIComponent(row.journalName)}`, row.journalName, journalTaskLogger, configService);
            }
            if (configService.journalCrawlDetails) {
                // fetchDetails cần nhận journalTaskLogger
                const details = await fetchDetails(page, row.journalLink, journalTaskLogger, configService);
                if (details) Object.assign(journalData, details);
                // performImageSearch cần nhận journalTaskLogger
                await performImageSearch(journalTaskLogger, details, row, journalData);
            } else {
                await performImageSearch(journalTaskLogger, null, row, journalData);
            }
            // appendJournalToFile cần nhận journalTaskLogger
            await appendJournalToFile(journalData, OUTPUT_JSON, journalTaskLogger);
            processedCount++;
            journalTaskLogger.info({ event: 'task_success' }, `Successfully processed and saved journal row`);
        } catch (error: any) {
          journalTaskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, `Unhandled error processing Scimago row`);
        }
      }
      tabLogger.info({ event: 'tab_finish' }, "Finished processing Scimago URL");
    };

    // --- processTabCSV ---
    const processTabCSV = async (page: Page, row: CSVRow, tabIndex: number, rowIndex: number): Promise<void> => {
      const journalName = row.Title || `Row-${rowIndex}`;
      // Tạo child logger từ journalCrawlLogger cho mỗi CSV row
      const csvTaskLogger = journalCrawlLogger.child({
          processingUnit: 'csvRow',
          journalProcessingStep: 'processClientJournalRow',
          journalTitle: journalName, // Thêm title vào context
          issn : row.Issn || 'Unknown ISSN', // Thêm ISSN vào context
          csvRowIndex: rowIndex,
          tabIndexUsed: tabIndex
      });
      csvTaskLogger.info({ event: 'task_start' }, "Processing CSV row");
      // ... (logic xử lý journalData, fetchBioxbio, fetchDetails như cũ, truyền csvTaskLogger vào các hàm con)
      let journalLink: string | undefined;
      // ... (logic tạo journalLink)
      if (row.Sourceid && String(row.Sourceid).trim() !== '') {
        journalLink = `https://www.scimagojr.com/journalsearch.php?q=${row.Sourceid}&tip=sid&clean=0`;
      } else if (journalName && journalName !== `Row-${rowIndex}`) {
        journalLink = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(journalName)}&tip=jou&clean=0`;
      } else {
        csvTaskLogger.error({ event: 'link_generation_failed' }, "Skipping row due to missing Sourceid and Title.");
        return;
      }

      let journalData: JournalDetails = { scimagoLink: journalLink, bioxbio: null, Image: null, Image_Context: null, ...row };
      if (!journalData.title && row.Title) journalData.title = row.Title;

      try {
        if (configService.journalCrawlBioxbio && journalName && journalName !== `Row-${rowIndex}`) {
            // fetchBioxbioData cần nhận csvTaskLogger
            journalData.bioxbio = await fetchBioxbioData(page, `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`, journalName, csvTaskLogger, configService);
        }
        if (configService.journalCrawlDetails && journalLink) {
            // fetchDetails cần nhận csvTaskLogger
            const details = await fetchDetails(page, journalLink, csvTaskLogger, configService);
            if (details) Object.assign(journalData, details);
            // performImageSearch cần nhận csvTaskLogger
            await performImageSearch(csvTaskLogger, details, row, journalData);
        } else {
            await performImageSearch(csvTaskLogger, null, row, journalData);
        }
        // appendJournalToFile cần nhận csvTaskLogger
        await appendJournalToFile(journalData, OUTPUT_JSON, csvTaskLogger);
        processedCount++;
        csvTaskLogger.info({ event: 'task_success' }, `Successfully processed and saved CSV row`);
      } catch (error: any) {
        csvTaskLogger.error({ err: error, stack: error.stack, event: 'task_failed_unhandled' }, `Unhandled error processing CSV row`);
      }
    };

    // --- Main Execution Logic ---
    if (dataSource === 'scimago') {
      journalCrawlLogger.info({ event: 'mode_scimago_start' }, "Starting crawl in Scimago mode.");
      const firstPage = pages[0]; // Chỉ dùng để lấy lastPageNumber
      let lastPageNumber = 1;
      let urls: string[] = [];
      try {
        // getLastPageNumber cần nhận journalCrawlLogger (hoặc một child cụ thể hơn)
        lastPageNumber = await getLastPageNumber(firstPage, configService.journalBaseUrl, journalCrawlLogger.child({ operation: 'getLastPageNumber' }), configService);
        journalCrawlLogger.info({ event: 'scimago_last_page_found', lastPage: lastPageNumber }, `Total Scimago pages estimated: ${lastPageNumber}`);
        urls = createURLList(configService.journalBaseUrl, lastPageNumber);
        totalTasks = urls.length; // Số lượng URL Scimago page, không phải số journal

        journalCrawlLogger.info({ event: 'scimago_processing_start', urlCount: totalTasks }, `Starting processing ${totalTasks} Scimago URLs.`);
        for (let i = 0; i < urls.length; i += MAX_TABS) {
          const batchUrls = urls.slice(i, i + MAX_TABS);
          const batchIndex = Math.floor(i / MAX_TABS) + 1;
          const batchLogger = journalCrawlLogger.child({ scimagoBatchIndex: batchIndex }); // Logger cho batch
          batchLogger.info({ event: 'scimago_batch_start', batchSize: batchUrls.length, startIndex: i });
          await Promise.all(
            batchUrls.map((url, idx) => {
              const pageIndex = idx % pages.length; // Phân bổ page cho task
              // processTabScimago sẽ tạo logger con riêng cho nó từ journalCrawlLogger (hoặc batchLogger)
              return processTabScimago(pages[pageIndex], url, pageIndex);
            })
          );
          batchLogger.info({ event: 'scimago_batch_finish', urlsInBatch: batchUrls.length, currentTotalProcessedJournals: processedCount });
        }
      } catch (error: any) {
        journalCrawlLogger.error({ err: error, event: 'scimago_processing_error' }, `Failed during Scimago page processing loop.`);
      }

    } else if (dataSource === 'client') {
      journalCrawlLogger.info({ event: 'mode_client_start' }, "Starting crawl using client-provided data.");
      if (!clientData) {
        journalCrawlLogger.error({ event: 'client_data_missing' }, "Client data source selected, but no data provided.");
        throw new Error("Client data source selected, but no data provided.");
      }
      try {
        // parseCSVString cần nhận journalCrawlLogger (hoặc một child cụ thể hơn)
        const csvData: CSVRow[] = await parseCSVString(clientData, journalCrawlLogger.child({ operation: 'parseClientCSVData' }));
        totalTasks = csvData.length; // Số lượng journal từ CSV
        journalCrawlLogger.info({ event: 'client_data_parse_success', rowCount: totalTasks }, `Total journals to process from client data: ${totalTasks}`);

        if (totalTasks === 0) {
          journalCrawlLogger.warn({ event: 'client_data_empty' }, "Client data parsed successfully but resulted in zero records.");
        } else {
          for (let i = 0; i < csvData.length; i += MAX_TABS) {
            const batchRows = csvData.slice(i, i + MAX_TABS);
            const batchIndex = Math.floor(i / MAX_TABS) + 1;
            const batchLogger = journalCrawlLogger.child({ clientCsvBatchIndex: batchIndex }); // Logger cho batch
            batchLogger.info({ event: 'client_batch_start', batchSize: batchRows.length, startIndex: i });
            await Promise.all(
              batchRows.map((row, idx) => {
                const pageIndex = idx % pages.length;
                // processTabCSV sẽ tạo logger con riêng cho nó từ journalCrawlLogger (hoặc batchLogger)
                return processTabCSV(pages[pageIndex], row, pageIndex, i + idx);
              })
            );
            batchLogger.info({ event: 'client_batch_finish', rowsInBatch: batchRows.length, currentTotalProcessedJournals: processedCount });
          }
        }
      } catch (error: any) {
        journalCrawlLogger.error({ err: error, event: 'client_data_processing_error' }, `Failed to parse or process client-provided data`);
        throw error; // Re-throw để finally có thể xử lý
      }
    }

    journalCrawlLogger.info({ event: 'crawl_loops_completed' }, "Finished processing all designated tasks.");

  } catch (error: any) {
    journalCrawlLogger.fatal({ err: error, stack: error.stack, event: 'crawl_fatal_error' }, "Fatal error during journal crawling process");
    // Không throw error ở đây nữa nếu muốn finally luôn chạy để log summary
  } finally {
    journalCrawlLogger.info({ event: 'cleanup_start' }, "Performing final cleanup...");
    if (browser) {
      journalCrawlLogger.info({ event: 'browser_close_start' }, "Closing browser...");
      try { await browser.close(); journalCrawlLogger.info({ event: 'browser_close_success' }, "Browser closed."); }
      catch (closeError: any) { journalCrawlLogger.error({ err: closeError, event: 'browser_close_failed' }, "Error closing browser."); }
    } else {
      journalCrawlLogger.info({ event: 'browser_close_skipped' }, "Browser was not launched or already closed.");
    }
    const operationEndTime = Date.now();
    const durationSeconds = Math.round((operationEndTime - operationStartTime) / 1000);

    // journalCrawlLogger đã chứa batchRequestId và dataSource
    journalCrawlLogger.info({
      event: 'crawl_summary', // EVENT NAME KHÔNG THAY ĐỔI
      // batchRequestId đã có trong logger
      // dataSource đã có trong logger
      totalTasksDefined: totalTasks, // Số lượng Scimago pages hoặc số dòng CSV
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

    journalCrawlLogger.info({ event: 'crawl_end' }, "crawlJournals process finished.");
  }
};