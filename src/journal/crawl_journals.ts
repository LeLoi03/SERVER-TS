// src/crawlJournals.ts (hoặc tên file tương ứng)

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import fs from 'fs';
import path from 'path';
let ora: any; // Declare ora with type any temporarily

async function initializeOra() {
    const { default: oraModule } = await import('ora');
    ora = oraModule;
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
  KEY_ROTATION_DELAY_MS
} from '../config';
import { processPage, fetchDetails, getImageUrlAndDetails, getLastPageNumber } from './scimagojr';
import { fetchBioxbioData } from './bioxbio';
import { createURLList, logger, readCSV } from './utils';

export const LOG_FILE: string = path.join(__dirname,'./data/crawl_journal.log');
export const INPUT_CSV: string = path.join(__dirname,'./csv/import_journal.csv');
export const OUTPUT_JSON: string = path.join(__dirname,'./data/journal_list.json');


// --- Types ---

import { TableRowData, JournalDetails, CSVRow } from './types';



// --- Biến quản lý trạng thái Key API (RIÊNG BIỆT cho Journal Crawling) ---
let currentJournalKeyIndex = 0;
let currentJournalKeyUsageCount = 0;
let journalKeysExhausted = false;

// --- Hàm trợ giúp để lấy API Key tiếp theo (RIÊNG BIỆT cho Journal Crawling) ---
async function getNextJournalApiKey(): Promise<string | null> {
    if (journalKeysExhausted || !GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
        if (!journalKeysExhausted) {
           logger.warn("WARN: No Google API Keys configured or all keys have been exhausted for Journal crawling.");
           journalKeysExhausted = true;
        }
        return null;
    }

    if (currentJournalKeyUsageCount >= MAX_USAGE_PER_KEY) {
        logger.info(`Journal API key #${currentJournalKeyIndex + 1} reached usage limit (${currentJournalKeyUsageCount}/${MAX_USAGE_PER_KEY}).`);

        currentJournalKeyIndex++;
        currentJournalKeyUsageCount = 0;

        if (currentJournalKeyIndex >= GOOGLE_CUSTOM_SEARCH_API_KEYS.length) {
            logger.warn("WARN: All Google API keys for Journal crawling have reached their usage limits.");
            journalKeysExhausted = true;
            return null;
        }

        logger.info(`Waiting for ${KEY_ROTATION_DELAY_MS / 1000} seconds before switching to Journal API key #${currentJournalKeyIndex + 1}...`);
        await new Promise(resolve => setTimeout(resolve, KEY_ROTATION_DELAY_MS));
        logger.info(`Switching to Journal API key #${currentJournalKeyIndex + 1} (index ${currentJournalKeyIndex}).`);
    }

    const apiKey = GOOGLE_CUSTOM_SEARCH_API_KEYS[currentJournalKeyIndex];
    currentJournalKeyUsageCount++;

    return apiKey;
}

export const crawlJournals = async (): Promise<JournalDetails[]> => {
  await initializeOra(); // Wait for ora to load

  // Reset trạng thái key API của Journal mỗi khi hàm chạy
  currentJournalKeyIndex = 0;
  currentJournalKeyUsageCount = 0;
  journalKeysExhausted = false;

  if (!GOOGLE_CUSTOM_SEARCH_API_KEYS || GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
      logger.error("CRITICAL ERROR: GOOGLE_CUSTOM_SEARCH_API_KEYS is empty or not defined in config. Cannot perform image searches.");
      journalKeysExhausted = true;
  }

  const spinner = ora('Starting craw journals...').start();
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      channel: CHANNEL,
      headless: HEADLESS,
      args: [
        "--disable-notifications",
        "--disable-geolocation",
        "--disable-extensions",
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-gpu",
        "--blink-settings=imagesEnabled=false",
        "--ignore-certificate-errors"
      ],
    });

    const browserContext: BrowserContext = await browser.newContext({
      permissions: [],
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: { 'Upgrade-Insecure-Requests': '1' },
      userAgent: USER_AGENT,
    });

    const pages: Page[] = await Promise.all(Array.from({ length: MAX_TABS }, () => browserContext.newPage()));

    let allJournalData: JournalDetails[] = [];

    // --- processTabScimago ---
    const processTabScimago = async (page: Page, url: string): Promise<void> => {
      const rows: TableRowData[] = await processPage(page, url);

      for (const row of rows) {
        let journalData: JournalDetails = {
          title: row.journalName,
          scimagoLink: row.journalLink,
          bioxbio: null,
          Image: null,
          Image_Context: null
        };

        const csvRowArray = row.csvRow.split(',');
        const headers = JOURNAL_CSV_HEADERS.trim().split(',');
        headers.forEach((header, index) => {
            const cleanHeader = header.trim();
            if (csvRowArray[index] !== undefined) {
            journalData[cleanHeader] = csvRowArray[index].trim();
            }
        });


        try {
          if (JOURNAL_CRAWL_BIOXBIO && row.journalName) {
            const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(row.journalName)}`;
            const bioxbioData = await fetchBioxbioData(page, bioxbioSearchUrl, row.journalName);
            journalData.bioxbio = bioxbioData;
          }

          if (JOURNAL_CRAWL_DETAILS) {
            const details = await fetchDetails(page, row.journalLink);
            if (details) {
              Object.assign(journalData, details);

              const apiKey = await getNextJournalApiKey();
              const cseId = GOOGLE_CSE_ID!;

              if (apiKey) {
                const { Image, Image_Context } = await getImageUrlAndDetails( details, row, apiKey, cseId);
                journalData.Image = Image;
                journalData.Image_Context = Image_Context;
              } else {
                 logger.warn(`Skipping image search for ${row.journalName} - API keys exhausted.`);
              }
            }
          }
        } catch (error: any) {
          logger.error(`Error processing Scimago row for journal ${row.journalName}: ${error.message} ${error.stack}`);
        }

        allJournalData.push(journalData);
      }
    };

    // --- processTabCSV ---
    const processTabCSV = async (page: Page, row: CSVRow): Promise<void> => {
      const journalName = row.Title;
       let journalLink: string | undefined;
       if (row.Sourceid && String(row.Sourceid).trim() !== '') {
           journalLink = `https://www.scimagojr.com/journalsearch.php?q=${row.Sourceid}&tip=sid&clean=0`;
       } else if (journalName) {
           logger.warn(`Missing Sourceid for "${journalName}". Searching by title on Scimago.`)
           journalLink = `https://www.scimagojr.com/journalsearch.php?q=${encodeURIComponent(journalName)}&tip=jou&clean=0`;
       } else {
           logger.error("Skipping row due to missing both Sourceid and Title in CSV.");
           return;
       }

      let journalData: JournalDetails = {
        scimagoLink: journalLink,
        bioxbio: null,
        Image: null,
        Image_Context: null
      };

        for (const key in row) {
            if (key === 'Title' && !journalData.title) {
                 journalData.title = row[key];
            }
            if (row.hasOwnProperty(key)) {
                journalData[key] = row[key];
            }
        }

      try {
         if (JOURNAL_CRAWL_BIOXBIO && journalName) {
             const bioxbioSearchUrl = `https://www.bioxbio.com/?q=${encodeURIComponent(journalName)}`;
             const bioxbioData = await fetchBioxbioData(page, bioxbioSearchUrl, journalName);
             journalData.bioxbio = bioxbioData;
         }

        if (JOURNAL_CRAWL_DETAILS) {
          const details = await fetchDetails(page, journalLink);
          if (details) {
            Object.assign(journalData, details);

            const apiKey = await getNextJournalApiKey();
            const cseId = GOOGLE_CSE_ID!;

            if (apiKey) {
              const { Image, Image_Context } = await getImageUrlAndDetails( details, row, apiKey, cseId);
              journalData.Image = Image;
              journalData.Image_Context = Image_Context;
            } else {
                 logger.warn(`Skipping image search for ${journalName} - API keys exhausted.`);
            }
          } else {
              logger.warn(`Could not fetch Scimago details for ${journalName} (Link: ${journalLink})`);
               const apiKey = await getNextJournalApiKey();
               const cseId = GOOGLE_CSE_ID!;
               if(apiKey && row && row.Issn){
                   const { Image, Image_Context } = await getImageUrlAndDetails( null, row, apiKey, cseId);
                   journalData.Image = Image;
                   journalData.Image_Context = Image_Context;
               } else if (!apiKey) {
                   logger.warn(`Skipping image search for ${journalName} - API keys exhausted.`);
               }
          }
        }
      } catch (error: any) {
        logger.error(`Error processing CSV row for journal ${journalName}: ${error.message} ${error.stack}`);
      }

      allJournalData.push(journalData);
    };

    // --- Logic chạy chính (MODE scimago hoặc csv) ---
    let completedTasks = 0;
    const updateProgress = (total: number, completed: number): void => {
      const percent = total > 0 ? Math.min(100, (completed / total) * 100) : 0;
      spinner.text = `Crawling Journals... ${completed.toLocaleString()}/${total.toLocaleString()} (${percent.toFixed(2)}%)`;
    };

    if (JOURNAL_CRAWL_MODE === 'scimago') {
      const firstPage = pages[0];
      let lastPageNumber = 1;
      let totalTasks = 0;
       try {
            lastPageNumber = await getLastPageNumber(firstPage, BASE_URL);
            logger.info(`Total Scimago pages found: ${lastPageNumber}`);
            const urls = createURLList(BASE_URL, lastPageNumber);
            totalTasks = urls.length * 50;
            updateProgress(totalTasks, completedTasks);

            for (let i = 0; i < urls.length; i += MAX_TABS) {
                const batchUrls = urls.slice(i, i + MAX_TABS);
                await Promise.all(
                batchUrls.map(async (url, idx) => {
                    if (pages[idx]) {
                        await processTabScimago(pages[idx], url);
                         completedTasks = Math.min(i + idx + 1, urls.length) * 50;
                         updateProgress(totalTasks, completedTasks);
                    }
                })
                );
            }
       } catch(error: any) {
           logger.error(`Failed to get last page number or process Scimago pages: ${error}`);
           spinner.fail('Crawling failed during Scimago page processing.');
       }

    } else if (JOURNAL_CRAWL_MODE === 'csv') {
        try {
            const csvData: CSVRow[] = await readCSV(INPUT_CSV);
            const totalTasks = csvData.length;
            logger.info(`Total journals to process from CSV: ${totalTasks}`);
            updateProgress(totalTasks, completedTasks);

            for (let i = 0; i < csvData.length; i += MAX_TABS) {
            const batchRows = csvData.slice(i, i + MAX_TABS);
            await Promise.all(
                batchRows.map(async (row, idx) => {
                    if (pages[idx]) {
                        await processTabCSV(pages[idx], row);
                        completedTasks++;
                        updateProgress(totalTasks, completedTasks);
                    }
                })
            );
            }
        } catch (error: any) {
             logger.error(`Failed to read or process CSV file ${INPUT_CSV}: ${error}`);
             spinner.fail('Crawling failed during CSV processing.');
        }
    } else {
      logger.error(`Invalid JOURNAL_CRAWL_MODE: ${JOURNAL_CRAWL_MODE}`);
      spinner.fail(`Invalid JOURNAL_CRAWL_MODE: ${JOURNAL_CRAWL_MODE}`);
      return [];
    }

    try {
      await fs.promises.writeFile(OUTPUT_JSON, JSON.stringify(allJournalData, null, 2), 'utf8');
      logger.info(`All journal data saved to: ${OUTPUT_JSON} (${allJournalData.length} journals)`);
    } catch (error: any) {
      logger.error(`Error writing final JSON file: ${error}`);
       spinner.fail('Crawling completed but failed to write output file.');
       return allJournalData;
    }

    spinner.succeed(`Crawl journal completed! Processed ${allJournalData.length} journals.`);
    return allJournalData;

  } catch (error: any) {
      spinner.fail(`An unexpected error occurred during journal crawling: ${error.message}`);
      logger.error("Unhandled error in crawlJournals:", error);
      return [];
  } finally {
      if (browser) {
          try {
              await browser.close();
          } catch (closeError: any) {
               logger.error("Error closing browser:", closeError);
          }
      }
  }
};