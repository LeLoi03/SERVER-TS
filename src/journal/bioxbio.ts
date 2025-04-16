// src/bioxbio.ts

import { Page } from 'playwright';
// Import logger type/instance and the modified retryAsync
import { logger as baseLogger, retryAsync } from './utils';
import { RETRY_OPTIONS, CACHE_OPTIONS } from '../config';
import NodeCache from 'node-cache';

const bioxbioCache = new NodeCache(CACHE_OPTIONS);

export const fetchBioxbioData = async (
    page: Page,
    bioxbioSearchUrl: string,
    journalName: string,
    parentLogger: typeof baseLogger // <-- Accept parent logger instance
): Promise<any | null> => {
    // Create a child logger for this specific execution
    const logger = parentLogger.child({
        function: 'fetchBioxbioData',
        journalName,
        searchUrl: bioxbioSearchUrl
    });

    logger.info({ event: 'bioxbio_fetch_start' }, 'Starting Bioxbio data fetch attempt.');

    const cacheKey = `bioxbio:${journalName}`;
    logger.debug({ event: 'bioxbio_cache_check', cacheKey }, 'Checking cache.');
    const cachedData = bioxbioCache.get(cacheKey);

    if (cachedData) {
        logger.info({ event: 'bioxbio_cache_hit', cacheKey }, 'Returning cached Bioxbio data.');
        return cachedData;
    }
    logger.info({ event: 'bioxbio_cache_miss', cacheKey }, 'No cached data found, proceeding with fetch.');

    // Define route handler - **IMPORTANT**: Needs unrouting in finally block
    const routeHandler = (route: any) => { // Use 'any' or specific Playwright Route type
        const request = route.request();
        const resourceType = route.request().resourceType();
        const url = request.url();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType) ||
            url.includes("google-analytics") ||
            url.includes("ads") ||
            url.includes("tracking") ||
            url.includes("google_vignette")
        ) {
            // logger.debug({ event: 'bioxbio_route_abort', resourceType, url }, 'Aborting request.'); // Optional: very verbose
            route.abort().catch((err: any) => logger.warn({ event: 'bioxbio_route_abort_error', err }, 'Error aborting route'));
        } else {
            // logger.debug({ event: 'bioxbio_route_continue', resourceType, url }, 'Continuing request.'); // Optional: very verbose
            route.continue().catch((err: any) => logger.warn({ event: 'bioxbio_route_continue_error', err }, 'Error continuing route'));;
        }
    };

    try {
        // Set up routing *before* navigation
        logger.debug({ event: 'bioxbio_route_setup' }, 'Setting up request interception.');
        await page.route("**/*", routeHandler);

        logger.debug({ event: 'bioxbio_retry_start', retryOptions: RETRY_OPTIONS });
        const bioxbioData = await retryAsync(async (attempt) => {
            const attemptLogger = logger.child({ attempt });
            attemptLogger.info({ event: 'bioxbio_attempt_start' }, `Starting Bioxbio fetch attempt ${attempt}.`);

            // 1. Navigate to Search Results Page
            attemptLogger.debug({ event: 'bioxbio_goto_search_start', url: bioxbioSearchUrl });
            try {
                await page.goto(bioxbioSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            } catch (gotoError: any) {
                 attemptLogger.error({ err: gotoError, event: 'bioxbio_goto_search_failed', url: bioxbioSearchUrl }, `Attempt ${attempt}: Failed initial navigation to search page.`);
                 throw gotoError; // Trigger retry
            }
            attemptLogger.debug({ event: 'bioxbio_goto_search_success' });

            // 2. Wait for and evaluate search result link
            const selector = 'a.gs-title';
            try {
                attemptLogger.debug({ event: 'bioxbio_wait_selector_start', selector });
                await page.waitForSelector(selector, { timeout: 10000 }); // Increased timeout slightly
                attemptLogger.debug({ event: 'bioxbio_wait_selector_success' });
            } catch (waitError: any) {
                attemptLogger.warn({ event: 'bioxbio_wait_selector_timeout', selector, err: waitError }, `Attempt ${attempt}: Timeout or error waiting for selector.`);
                // Consider this a potentially temporary issue, let's retry
                throw new Error(`Timeout waiting for selector '${selector}' on Bioxbio search page.`);
            }

            attemptLogger.debug({ event: 'bioxbio_evaluate_search_start' });
            const searchResult = await page.evaluate((targetJournalName: string) => {
                const linkElement = document.querySelector('a.gs-title');
                if (!linkElement) {
                    // console.warn('[Evaluate] No gs-title link found.'); // Browser log
                    return { found: false, reason: 'no_gs_title' };
                }
                const linkTextElement = linkElement.querySelector('b');
                const linkText = linkTextElement?.textContent?.trim().toLowerCase().replace(/\s+/g, ' ') || null;
                const targetNameNorm = targetJournalName.toLowerCase().replace(/\s+/g, ' ');

                if (linkText && linkText === targetNameNorm) {
                    const dataCtorig = linkElement.getAttribute('data-ctorig');
                    if (dataCtorig) {
                        // console.info('[Evaluate] Found matching link with data-ctorig:', dataCtorig); // Browser log
                        return { found: true, redirectUrl: dataCtorig, linkText: linkTextElement?.textContent?.trim() };
                    } else {
                        // console.warn('[Evaluate] Found matching link text, but data-ctorig attribute is missing.'); // Browser log
                        return { found: false, reason: 'missing_attribute', actualText: linkTextElement?.textContent?.trim() };
                    }
                } else {
                    // console.warn('[Evaluate] Link found, but text does not match.', { expected: targetNameNorm, actual: linkText }); // Browser log
                    return { found: false, reason: 'text_mismatch', actualText: linkTextElement?.textContent?.trim() };
                }
            }, journalName);
            attemptLogger.debug({ event: 'bioxbio_evaluate_search_success', result: searchResult });

            // 3. Process search result and navigate to details page (if found)
            let redirectUrl: string | null = null;
            if (searchResult.found && searchResult.redirectUrl) {
                redirectUrl = searchResult.redirectUrl;
                attemptLogger.info({ event: 'bioxbio_redirect_url_found', url: redirectUrl, linkText: searchResult.linkText });
            } else {
                // Log failure reason
                 let failureReason = searchResult.reason || 'unknown';
                 attemptLogger.warn({
                     event: 'bioxbio_redirect_url_fail',
                     reason: failureReason,
                     foundText: searchResult.actualText // Include text found, if any
                 }, `Attempt ${attempt}: Could not find matching redirect URL. Reason: ${failureReason}.`);

                 // Decide if this failure should stop retries for this journal
                 // If a link IS found but mismatched, maybe stop trying?
                 // If no link is found at all, maybe retry?
                 // For simplicity now, let's assume any failure here means no Bioxbio data exists -> return null.
                 // Returning null here will stop the retry loop for this journal *successfully* with a null result.
                 return null;
            }

            // If redirectUrl is still null (shouldn't happen with logic above, but check), return null
            if (!redirectUrl) {
                 attemptLogger.error({ event: 'bioxbio_internal_logic_error' }, 'Internal error: redirectUrl is null after successful check.');
                 return null;
            }

            // 4. Navigate to Details Page
            attemptLogger.debug({ event: 'bioxbio_goto_details_start', url: redirectUrl });
             try {
                await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
             } catch (gotoError: any) {
                 attemptLogger.error({ err: gotoError, event: 'bioxbio_goto_details_failed', url: redirectUrl }, `Attempt ${attempt}: Failed navigation to details page.`);
                 throw gotoError; // Trigger retry
             }
            attemptLogger.debug({ event: 'bioxbio_goto_details_success' });

            // 5. Evaluate Details Page for Impact Factors
            // Optional: Wait for table
            const tableSelector = 'table tr'; // Adjust if a more specific selector is known
            try {
                 attemptLogger.debug({ event: 'bioxbio_wait_table_start', selector: tableSelector});
                 await page.waitForSelector(tableSelector, { timeout: 10000 });
                 attemptLogger.debug({ event: 'bioxbio_wait_table_success'});
            } catch (waitError: any) {
                 attemptLogger.warn({ event: 'bioxbio_wait_table_timeout', selector: tableSelector, err: waitError }, `Attempt ${attempt}: Timeout or error waiting for details table. Proceeding to evaluate anyway.`);
                 // Don't throw, maybe the evaluate can still find something or return empty []
            }

            attemptLogger.debug({ event: 'bioxbio_evaluate_details_start' });
            const impactFactors: { Year: string; Impact_factor: string; }[] = await page.evaluate(() => {
                const data: { Year: string; Impact_factor: string; }[] = [];
                // Be specific if possible: document.querySelector('#impactFactorTable tbody tr:nth-child(n+2)')
                const rows = document.querySelectorAll('table tr:nth-child(n+2)');
                if (rows.length === 0) {
                     // console.warn('[Evaluate] No table rows found for impact factors.'); // Browser log
                     return [];
                }
                rows.forEach((row) => {
                    const cells = row.querySelectorAll('td');
                    if (cells.length >= 2) {
                        const year = cells[0]?.textContent?.trim();
                        const impactFactor = cells[1]?.textContent?.trim();
                        if (year && impactFactor) {
                            data.push({ Year: year, Impact_factor: impactFactor });
                        }
                    }
                });
                return data;
            });
            attemptLogger.debug({ event: 'bioxbio_evaluate_details_success', count: impactFactors.length });

            // Return the extracted data for this attempt
            return impactFactors;

        }, RETRY_OPTIONS, logger); // Pass logger instance to retryAsync

        // After retryAsync completes successfully (even if it returned null or [])
        logger.debug({ event: 'bioxbio_retry_finish' });

        if (bioxbioData && bioxbioData.length > 0) {
            bioxbioCache.set(cacheKey, bioxbioData);
            logger.info({ event: 'bioxbio_cache_set', cacheKey, itemCount: bioxbioData.length }, 'Bioxbio data fetched and cached.');
        } else if (bioxbioData) { // Data is an empty array []
            logger.warn({ event: 'bioxbio_fetch_success_empty', cacheKey }, 'Bioxbio fetch successful but returned no impact factor data. Not caching empty array.');
        } else { // Data is null (likely returned early from retry loop)
             logger.warn({ event: 'bioxbio_fetch_failed_no_match', cacheKey }, 'Bioxbio fetch did not find a matching journal or details. Not caching.');
        }
        return bioxbioData; // Return null, [], or the data

    } catch (error: any) {
        // This catches errors if retryAsync ultimately fails (e.g., repeated navigation errors)
        logger.error({ err: error, event: 'bioxbio_fetch_failed_final', cacheKey }, `Failed to fetch Bioxbio data after all retries.`);
        return null; // Return null as per original logic on final failure
    } finally {
        // **IMPORTANT**: Clean up routing
        logger.debug({ event: 'bioxbio_route_cleanup_start' }, 'Attempting to remove Bioxbio request interception.');
        try {
            // Use the same pattern used in page.route
            await page.unroute("**/*", routeHandler);
            logger.debug({ event: 'bioxbio_route_cleanup_success' }, 'Successfully unrouted Bioxbio request interception.');
        } catch(unrouteError: any) {
            // Log warning, but don't throw, as the main operation might have succeeded
            logger.warn({ event: 'bioxbio_route_cleanup_failed', err: unrouteError }, 'Failed to unroute Bioxbio request interception. This might affect subsequent uses of this Page object.');
        }
        logger.info({ event: 'bioxbio_fetch_finish'}, 'Finished Bioxbio data fetch process.');
    }
};