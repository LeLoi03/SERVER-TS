// src/bioxbio.ts

import { Page } from 'playwright';
import { logger, retryAsync } from './utils';
import { RETRY_OPTIONS, CACHE_OPTIONS } from '../config';
import NodeCache from 'node-cache';

const bioxbioCache = new NodeCache(CACHE_OPTIONS);

export const fetchBioxbioData = async (page: Page, bioxbioSearchUrl: string, journalName: string): Promise<any | null> => {
  const cacheKey = `bioxbio:${journalName}`;
  const cachedData = bioxbioCache.get(cacheKey);

  // Thêm phần chặn request vào đây
  await page.route("**/*", (route) => {
    const request = route.request();
    const resourceType = route.request().resourceType();
    if (['image', 'media', 'font', 'stylesheet'].includes(resourceType) ||
        request.url().includes("google-analytics") ||
        request.url().includes("ads") ||
        request.url().includes("tracking") ||
        request.url().includes("google_vignette")
    ) {
      route.abort();
    } else {
      route.continue();
    }
  });

  if (cachedData) {
    logger.info(`[CACHE HIT] Bioxbio data for ${journalName}`);
    return cachedData;
  }

  try {
    const bioxbioData = await retryAsync(async () => {
      await page.goto(bioxbioSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForSelector('a.gs-title', { timeout: 5000 });

      const redirectUrl = await page.evaluate((journalName: string) => {
        const link = document.querySelector('a.gs-title');
        if (!link) {
          logger.warn(`No gs-title link found on Bioxbio for ${journalName}`);
          return null;
        }

        const linkText = link.querySelector('b')?.textContent?.trim(); // Add null check
        if (linkText && linkText.toLowerCase().replace(/\s+/g, ' ') === journalName.toLowerCase().replace(/\s+/g, ' ')) {
          const dataCtorig = link.getAttribute('data-ctorig');
          return dataCtorig;
        }
        logger.warn(`No matching URL found on Bioxbio for ${journalName}`);

        return null;
      }, journalName);

      if (!redirectUrl) {
        logger.warn(`No Bioxbio info found for ${journalName}`);
        return null;
      }

      await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

      const impactFactors: { Year: string; Impact_factor: string; }[] = await page.evaluate(() => {
        const data: { Year: string; Impact_factor: string; }[] = [];
        const rows = document.querySelectorAll('tr:nth-child(n+2)');
        rows.forEach((row) => {
          const cells = row.querySelectorAll('td');
          if (cells.length >= 2) {
            const year = cells[0]?.textContent?.trim(); // Add null check
            const impactFactor = cells[1]?.textContent?.trim(); // Add null check
            if (year && impactFactor) {
              data.push({ Year: year, Impact_factor: impactFactor });
            }
          }
        });
        return data;
      });

      return impactFactors;
    }, RETRY_OPTIONS);

    if (bioxbioData) {
      bioxbioCache.set(cacheKey, bioxbioData);
      logger.info(`[CACHE MISS] Bioxbio data for ${journalName} - Data cached.`);
    } else {
      logger.warn(`[CACHE MISS] Bioxbio data for ${journalName} - No data to cache.`);
    }
    return bioxbioData;

  } catch (error: any) {
    logger.error(`[ERROR] Failed to fetch Bioxbio data for ${journalName}: ${error.message}`);
    return null; // Return null to skip this journal
  }
};