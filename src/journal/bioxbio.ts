// src/bioxbio.ts

import { Page, Route } from 'playwright'; // Import Route for better typing
import { retryAsync, RetryOptions } from './utils'; // Import RetryOptions
import NodeCache from 'node-cache';
import { ConfigService } from '../config/config.service'; // Correct path if bioxbio.ts is in src/
import { Logger } from 'pino';
// bioxbioCache will be initialized in the function that receives ConfigService
// let bioxbioCache: NodeCache | null = null; // Or initialize it globally if ConfigService is resolved globally

export const fetchBioxbioData = async (
    page: Page,
    bioxbioSearchUrl: string,
    journalName: string,
    parentLogger: Logger,
    configService: ConfigService // <<<< ADD ConfigService
): Promise<any[] | null> => { // Return type explicitly any[] | null
    const logger = parentLogger.child({
        function: 'fetchBioxbioData',
        journalName,
        searchUrl: bioxbioSearchUrl
    });

    logger.info({ event: 'bioxbio_fetch_start' }, 'Starting Bioxbio data fetch attempt.');

    // --- Initialize Cache with options from ConfigService ---
    // It's better to create the cache instance here if it depends on config,
    // or ensure a global cache is configured with these options.
    // For simplicity, creating it here. If used across multiple calls, consider a singleton cache service.
    const bioxbioCache = new NodeCache({
        stdTTL: configService.journalCacheOptions.stdTTL, // Use getter: journalCacheOptions
        checkperiod: configService.journalCacheOptions.checkperiod, // Use getter: journalCacheOptions
        useClones: false, // Recommended for performance if not mutating cached objects
    });

    // --- Define Retry Options from ConfigService ---
    const bioxbioRetryOptions: RetryOptions = {
        retries: configService.journalRetryOptions.retries, // Use getter: journalRetryOptions
        minTimeout: configService.journalRetryOptions.minTimeout, // Use getter: journalRetryOptions
        factor: configService.journalRetryOptions.factor, // Use getter: journalRetryOptions
    };

    const cacheKey = `bioxbio:${journalName.toLowerCase().replace(/\s+/g, '-')}`; // Normalize cache key
    logger.debug({ event: 'bioxbio_cache_check', cacheKey }, 'Checking cache.');
    const cachedData = bioxbioCache.get<any[]>(cacheKey); // Specify type for get

    if (cachedData) {
        logger.info({ event: 'bioxbio_cache_hit', cacheKey, itemCount: cachedData.length }, 'Returning cached Bioxbio data.');
        return cachedData;
    }
    logger.info({ event: 'bioxbio_cache_miss', cacheKey }, 'No cached data found, proceeding with fetch.');

    const routeHandler = (route: Route) => { // Use Playwright's Route type
        const request = route.request();
        const resourceType = request.resourceType();
        const url = request.url();
        if (['image', 'media', 'font', 'stylesheet'].includes(resourceType) ||
            url.includes("google-analytics") ||
            url.includes("ads") ||
            url.includes("tracking") ||
            url.includes("google_vignette")
        ) {
            route.abort().catch((err: any) => logger.warn({ event: 'bioxbio_route_abort_error', url, errMessage: err.message }, 'Error aborting route'));
        } else {
            route.continue().catch((err: any) => logger.warn({ event: 'bioxbio_route_continue_error', url, errMessage: err.message }, 'Error continuing route'));
        }
    };

    try {
        logger.debug({ event: 'bioxbio_route_setup' }, 'Setting up request interception.');
        await page.route("**/*", routeHandler);

        logger.debug({ event: 'bioxbio_retry_start', retryOptions: bioxbioRetryOptions });
        const bioxbioData = await retryAsync<any[] | null>(async (attempt) => { // Specify return type for retryAsync
            const attemptLogger = logger.child({ attempt });
            attemptLogger.info({ event: 'bioxbio_attempt_start' }, `Starting Bioxbio fetch attempt ${attempt}.`);

            try {
                attemptLogger.debug({ event: 'bioxbio_goto_search_start', url: bioxbioSearchUrl });
                await page.goto(bioxbioSearchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                attemptLogger.debug({ event: 'bioxbio_goto_search_success' });
            } catch (gotoError: any) {
                 attemptLogger.error({ errMessage: gotoError.message, event: 'bioxbio_goto_search_failed', url: bioxbioSearchUrl }, `Attempt ${attempt}: Failed initial navigation to search page.`);
                 throw gotoError;
            }

            const selector = 'a.gs-title';
            try {
                attemptLogger.debug({ event: 'bioxbio_wait_selector_start', selector });
                await page.waitForSelector(selector, { timeout: 15000 }); // Adjusted timeout
                attemptLogger.debug({ event: 'bioxbio_wait_selector_success' });
            } catch (waitError: any) {
                attemptLogger.warn({ event: 'bioxbio_wait_selector_timeout', selector, errMessage: waitError.message }, `Attempt ${attempt}: Timeout or error waiting for selector. This might indicate no results.`);
                // If the selector for search results isn't found, it's likely no Bioxbio page exists for this journal.
                // Return null to stop retries for this specific journal and indicate no data.
                return null;
            }

            attemptLogger.debug({ event: 'bioxbio_evaluate_search_start' });
            const searchResult = await page.evaluate((targetJournalName: string) => {
                const linkElement = document.querySelector('a.gs-title');
                if (!linkElement) return { found: false, reason: 'no_gs_title_link_element' };

                const linkTextElement = linkElement.querySelector('b'); // Title is usually within <b>
                const linkText = linkTextElement?.textContent?.trim().toLowerCase().replace(/\s+/g, ' ') ||
                                 linkElement.textContent?.trim().toLowerCase().replace(/\s+/g, ' '); // Fallback to link's direct text

                const targetNameNorm = targetJournalName.toLowerCase().replace(/\s+/g, ' ');

                // More lenient matching: check if targetNameNorm is a substring of linkText
                // This handles cases where Bioxbio might add "The" or other minor variations.
                if (linkText && linkText.includes(targetNameNorm)) {
                    const dataCtorig = linkElement.getAttribute('data-ctorig');
                    if (dataCtorig) {
                        return { found: true, redirectUrl: dataCtorig, linkText: linkTextElement?.textContent?.trim() || linkElement.textContent?.trim() };
                    }
                    return { found: false, reason: 'missing_data_ctorig_attribute', actualText: linkTextElement?.textContent?.trim() || linkElement.textContent?.trim() };
                }
                return { found: false, reason: 'search_result_text_mismatch', actualText: linkTextElement?.textContent?.trim() || linkElement.textContent?.trim() };
            }, journalName);
            attemptLogger.debug({ event: 'bioxbio_evaluate_search_success', result: searchResult });

            if (searchResult.found && searchResult.redirectUrl) {
                attemptLogger.info({ event: 'bioxbio_redirect_url_found', url: searchResult.redirectUrl, linkText: searchResult.linkText });
                const redirectUrl = searchResult.redirectUrl;

                try {
                    attemptLogger.debug({ event: 'bioxbio_goto_details_start', url: redirectUrl });
                    await page.goto(redirectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
                    attemptLogger.debug({ event: 'bioxbio_goto_details_success' });
                } catch (gotoError: any) {
                    attemptLogger.error({ errMessage: gotoError.message, event: 'bioxbio_goto_details_failed', url: redirectUrl }, `Attempt ${attempt}: Failed navigation to details page.`);
                    throw gotoError;
                }

                const tableSelector = 'table tr';
                try {
                     attemptLogger.debug({ event: 'bioxbio_wait_table_start', selector: tableSelector});
                     await page.waitForSelector(tableSelector, { timeout: 10000 });
                     attemptLogger.debug({ event: 'bioxbio_wait_table_success'});
                } catch (waitError: any) {
                     attemptLogger.warn({ event: 'bioxbio_wait_table_timeout', selector: tableSelector, errMessage: waitError.message }, `Attempt ${attempt}: Timeout or error waiting for details table. Evaluating anyway.`);
                }

                attemptLogger.debug({ event: 'bioxbio_evaluate_details_start' });
                const impactFactors: { Year: string; Impact_factor: string; }[] = await page.evaluate(() => {
                    const data: { Year: string; Impact_factor: string; }[] = [];
                    const rows = document.querySelectorAll('table tr'); // Simpler selector, then filter
                    if (rows.length === 0) return [];

                    rows.forEach((row, index) => {
                        if (index === 0) return; // Skip header row if present
                        const cells = row.querySelectorAll('td');
                        if (cells.length >= 2) {
                            const year = cells[0]?.textContent?.trim();
                            const impactFactor = cells[1]?.textContent?.trim();
                            if (year && impactFactor && /^\d{4}$/.test(year) && !isNaN(parseFloat(impactFactor))) { // Basic validation
                                data.push({ Year: year, Impact_factor: impactFactor });
                            }
                        }
                    });
                    return data;
                });
                attemptLogger.debug({ event: 'bioxbio_evaluate_details_success', count: impactFactors.length });
                return impactFactors; // Return the array of impact factors
            } else {
                 attemptLogger.warn({
                     event: 'bioxbio_redirect_url_fail_or_not_found',
                     reason: searchResult.reason,
                     foundText: searchResult.actualText
                 }, `Attempt ${attempt}: Could not find matching redirect URL or search result. Reason: ${searchResult.reason}.`);
                 return null; // No matching journal found on Bioxbio search, stop retries for this journal.
            }
        }, bioxbioRetryOptions, logger);

        logger.debug({ event: 'bioxbio_retry_finish' });

        if (bioxbioData && bioxbioData.length > 0) {
            bioxbioCache.set(cacheKey, bioxbioData);
            logger.info({ event: 'bioxbio_cache_set', cacheKey, itemCount: bioxbioData.length }, 'Bioxbio data fetched and cached.');
        } else if (bioxbioData) { // bioxbioData is an empty array []
            logger.info({ event: 'bioxbio_fetch_success_empty_data', cacheKey }, 'Bioxbio fetch successful but returned no impact factor data. Not caching empty result.');
        } else { // bioxbioData is null
             logger.info({ event: 'bioxbio_fetch_no_match_or_failure', cacheKey }, 'Bioxbio fetch did not find a matching journal or failed to retrieve details. Not caching.');
        }
        return bioxbioData;

    } catch (error: any) {
        logger.error({ errMessage: error.message, stack: error.stack, event: 'bioxbio_fetch_failed_final', cacheKey }, `Failed to fetch Bioxbio data after all retries.`);
        return null;
    } finally {
        logger.debug({ event: 'bioxbio_route_cleanup_start' }, 'Attempting to remove Bioxbio request interception.');
        try {
            await page.unroute("**/*", routeHandler);
            logger.debug({ event: 'bioxbio_route_cleanup_success' }, 'Successfully unrouted Bioxbio request interception.');
        } catch(unrouteError: any) {
            logger.warn({ event: 'bioxbio_route_cleanup_failed', errMessage: unrouteError.message }, 'Failed to unroute Bioxbio request interception.');
        }
        logger.info({ event: 'bioxbio_fetch_finish_overall'}, 'Finished Bioxbio data fetch process.');
    }
};