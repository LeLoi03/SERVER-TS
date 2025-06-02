// ============================================
// File: src/journal/scimagojr.ts
// ============================================
import { Page } from 'playwright';
import { formatISSN, retryAsync, RetryOptions } from './utils'; // <<<< IMPORT RetryOptions
import { fetchGoogleImage } from './googleSearch'; // Adjusted path assuming googleSearch.ts is in src/
import { TableRowData, JournalDetails, ImageResult } from './types';
import { logger as baseLogger } from './utils';
import { ConfigService } from '../config/config.service'; // <<<< IMPORT ConfigService

// --- processPage ---
export const processPage = async (
    page: Page,
    url: string,
    logger: typeof baseLogger,
    configService: ConfigService // <<<< ADD ConfigService
): Promise<TableRowData[]> => {
    const childLogger = logger.child({ function: 'processPage', url });
    childLogger.info({ event: 'process_page_start' }, 'Starting page processing.');

    const scimagoRetryOptions: RetryOptions = {
        retries: configService.config.JOURNAL_RETRY_RETRIES,
        minTimeout: configService.config.JOURNAL_RETRY_MIN_TIMEOUT,
        factor: configService.config.JOURNAL_RETRY_FACTOR,
    };

    // Route blocking logic
    await page.route("**/*", (route) => {
        const request = route.request();
        const resourceType = route.request().resourceType();
        if (['image', 'media', 'font'].includes(resourceType) ||
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

    try {
        childLogger.debug({ event: 'process_page_attempt_start', retryOptions: scimagoRetryOptions }, 'Attempting to process page with retries.');
        const tableData: TableRowData[] = await retryAsync(async (attempt) => {
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'process_page_goto_start' }, 'Navigating to URL.');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // page.evaluate logic remains the same
            const evaluatedTableData: TableRowData[] = await page.evaluate(() => {
                // ... (your existing page.evaluate logic for processPage)
                const traverseNodes = (node: Node | null): string => {
                    if (!node) return '';
                    if (node.nodeType === Node.TEXT_NODE) {
                        return node.textContent?.trim() || '';
                    } else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
                        return Array.from(node.childNodes).map(traverseNodes).join(' ').trim();
                    }
                    return '';
                };

                const processTable = (table: Element): TableRowData[] => {
                    let tableRows: TableRowData[] = [];
                    const rows = table.querySelectorAll('tbody tr');
                    if (rows.length === 0) return tableRows;

                    rows.forEach((row) => {
                        const cells = row.querySelectorAll('td');
                        let rowData: TableRowData = { csvRow: '', journalLink: null, journalName: null, country: 'N/A' };

                        cells.forEach((cell, index) => {
                            if (index === 0) return; // Skip rank

                            if (index === 1) { // Journal Name and Link
                                const linkElement = cell.querySelector('a');
                                rowData.journalLink = linkElement ? (linkElement as HTMLAnchorElement).href : null;
                                rowData.journalName = linkElement ? linkElement.textContent?.trim() || null : null;
                                rowData.csvRow += traverseNodes(cell) + ',';
                            } else if (index < cells.length - 1) { // Other cells before country
                                rowData.csvRow += traverseNodes(cell) + ',';
                            } else { // Last cell is country
                                const country = cell.querySelector('img')?.getAttribute('title') || 'N/A';
                                rowData.csvRow += country; // No trailing comma for the last item
                                rowData.country = country;
                            }
                        });
                        tableRows.push(rowData);
                    });
                    return tableRows;
                };

                const table = document.querySelector('body > div.ranking_body > div.table_wrap > table');
                if (table) {
                    return processTable(table);
                } else {
                    console.warn('[Evaluate processPage] Main table not found.');
                    return [];
                }
            });
            return evaluatedTableData;
        }, scimagoRetryOptions, childLogger);

        childLogger.info({ event: 'process_page_success', rowCount: tableData.length }, 'Successfully processed page.');
        return tableData;
    } catch (error: any) {
        childLogger.error({ err: error, event: 'process_page_failed' }, `Error processing page`);
        throw error;
    } finally {
        childLogger.info({ event: 'process_page_finish' }, 'Finished page processing attempt.');
    }
};

// --- fetchDetails ---
export const fetchDetails = async (
    page: Page,
    journalUrl: string | null,
    logger: typeof baseLogger,
    configService: ConfigService // <<<< ADD ConfigService
): Promise<JournalDetails | null> => {
    const childLogger = logger.child({ function: 'fetchDetails', journalUrl });

    if (!journalUrl) {
        childLogger.warn({ event: 'fetch_details_skip_null_url' }, "Skipping fetchDetails: journalUrl is null.");
        return null;
    }
    childLogger.info({ event: 'fetch_details_start' }, `Starting detail fetch.`);

    const scimagoRetryOptions: RetryOptions = {
        retries: configService.config.JOURNAL_RETRY_RETRIES,
        minTimeout: configService.config.JOURNAL_RETRY_MIN_TIMEOUT,
        factor: configService.config.JOURNAL_RETRY_FACTOR,
    };

    try {
        childLogger.debug({ event: 'fetch_details_attempt_start', retryOptions: scimagoRetryOptions }, 'Attempting to fetch details with retries.');
        const details: JournalDetails = await retryAsync(async (attempt) => {
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'fetch_details_goto_start' }, 'Navigating to journal URL.');
            await page.goto(journalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            attemptLogger.debug({ event: 'fetch_details_goto_success' }, 'Navigation successful. Evaluating page content.');

            const tableRowSelector = 'body > div:nth-child(15) > div > div.cellcontent > div:nth-child(2) > table tbody tr';
            try {
                attemptLogger.debug({ event: 'wait_for_selector_start', selector: tableRowSelector });
                await page.waitForSelector(tableRowSelector, { timeout: 10000 }); // Reduced timeout for optional element
                attemptLogger.debug({ event: 'wait_for_selector_success', selector: tableRowSelector });
            } catch (e) {
                attemptLogger.warn({ event: 'wait_for_selector_timeout', selector: tableRowSelector }, `Optional table rows selector not found within timeout. This might be okay.`);
            }

            attemptLogger.debug({ event: 'fetch_details_evaluate_start' });
            // page.evaluate logic for fetchDetails remains the same
            const evaluatedDetails: JournalDetails = await page.evaluate(() => {
                // ... (your existing page.evaluate logic for fetchDetails)
                function querySelectorWithIndices(baseSelectorPattern: string, indices: number[]): { element: Element | null; successfulSelector: string | null } {
                    for (const index of indices) {
                        const selector = baseSelectorPattern.replace('{index}', index.toString());
                        const element = document.querySelector(selector);
                        if (element) return { element, successfulSelector: selector };
                    }
                    return { element: null, successfulSelector: null };
                }
                const mainIndices = [13, 14, 15, 16]; // Expanded indices slightly
                const tableIndices = [15, 16, 17]; // Expanded indices slightly

                const result: JournalDetails = {};
                // console.log('[Evaluation fetchDetails] Starting data extraction...');

                const selectorPatterns = [
                    { keyName: 'Subject Area and Category', type: 'Subject Area', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(2)' },
                    { keyName: 'Publisher', type: 'Publisher', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(3)' },
                    { keyName: 'H index', type: 'H index', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(4)' }, // Added H-index
                    { keyName: 'Publication type', type: 'Publication type', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(5)' }, // Added Publication type
                    { keyName: 'ISSN', type: 'ISSN', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(6)' }, // Adjusted index
                    { keyName: 'Coverage', type: 'Coverage', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(7)' }, // Adjusted index
                    { keyName: 'InformationHeading', type: 'DynamicLinks', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(8)' },

                    // { keyName: 'Scope', type: 'Scope', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(8)' }, // Adjusted index
                    // { keyName: 'Contact', type: 'Contact', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(10)' }, // Adjusted index for contact
                ];

                selectorPatterns.forEach(({ keyName, type, pattern }) => {
                    const { element } = querySelectorWithIndices(pattern, mainIndices);
                    if (element) {
                        const h2Element = element.querySelector('h2');
                        const actualKey = h2Element?.textContent?.trim(); // Ví dụ: "Information"

                        if (type === 'DynamicLinks') { // Sử dụng type mới đã định nghĩa
                            const linksData: { [key: string]: string | null } = {};
                            const linkElements = element.querySelectorAll('p > a');

                            linkElements.forEach(aNode => {
                                const a = aNode as HTMLAnchorElement;
                                const keyFromLinkText = a.textContent?.trim();
                                const href = a.getAttribute('href'); // Dùng getAttribute để lấy cả mailto:

                                if (keyFromLinkText && href) {
                                    if (href.startsWith('mailto:')) {
                                        linksData['Mail'] = keyFromLinkText; // Key là "Mail", value là email address (text của link)
                                    } else {
                                        linksData[keyFromLinkText] = href; // Key là text của link, value là href
                                    }
                                }
                            });
                            // actualKey ở đây sẽ là "Information" nếu h2.textContent là "Information"
                            if (Object.keys(linksData).length > 0) {
                                result[actualKey || keyName] = linksData;
                            }

                        } else if (type === 'Subject Area') {
                            const subjectAreaElement = element.querySelector('ul');
                            const fieldOfResearch: JournalDetails['Subject Area and Category'] = {};
                            if (subjectAreaElement) {
                                const mainTopicElement = subjectAreaElement.querySelector('li > a');
                                if (mainTopicElement) {
                                    fieldOfResearch['Field of Research'] = mainTopicElement.textContent?.trim() || null;
                                    const subTopicElements = subjectAreaElement.querySelectorAll('.treecategory li a');
                                    const topics: string[] = [];
                                    subTopicElements.forEach(item => {
                                        const subTopic = item.textContent?.trim();
                                        if (subTopic) topics.push(subTopic);
                                    });
                                    fieldOfResearch['Topics'] = topics;
                                }
                            }
                            result[keyName] = fieldOfResearch;
                        } else {
                            const value = Array.from(element.childNodes)
                                .filter(node => node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() !== 'h2' && node.textContent?.trim()))
                                .map(node => node.textContent?.trim() || '')
                                .join(' ').replace(/\s+/g, ' ').trim();
                            result[actualKey || keyName] = value; // Prefer actualKey from H2
                        }
                    }
                });

                const fullwidthPattern = 'body > div:nth-child({index}) > div > div > div.fullwidth';
                const { element: fullwidthElement } = querySelectorWithIndices(fullwidthPattern, mainIndices);
                if (fullwidthElement) {
                    const keyElement = fullwidthElement.firstElementChild;
                    const key = keyElement?.textContent?.trim() || 'Journal Description'; // More specific default
                    const value = Array.from(fullwidthElement.childNodes)
                        .filter(node => node !== keyElement && (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName.toLowerCase() !== 'a' && node.textContent?.trim())))
                        .map(node => node.textContent?.trim() || '')
                        .join(' ').replace(/\s+/g, ' ').trim();
                    result[key] = value;
                }

                const supplementaryTablePattern = 'body > div:nth-child({index}) > div > div.cellcontent > div:nth-child(2) > table';
                const { element: supplementaryTable } = querySelectorWithIndices(supplementaryTablePattern, tableIndices);
                if (supplementaryTable) {
                    const supplementaryData: any[] = [];
                    const rows = (supplementaryTable.querySelector('tbody') || supplementaryTable).querySelectorAll('tr');
                    rows.forEach(row => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length === 3) {
                            supplementaryData.push({ Category: cells[0]?.textContent?.trim() || '', Year: cells[1]?.textContent?.trim() || '', Quartile: cells[2]?.textContent?.trim() || '' });
                        }
                    });
                    if (supplementaryData.length > 0) result['QuartilesByCategory'] = supplementaryData; // Renamed key
                }

                const embedCodeElement = document.querySelector('#embed_code');
                if (embedCodeElement) {
                    const thumbnailText = embedCodeElement.getAttribute('value') ?? embedCodeElement.textContent;
                    if (thumbnailText) result['SJRWidgetCode'] = thumbnailText.trim(); // Renamed key
                }
                // console.log('[Evaluation fetchDetails] Data extraction finished.');
                return result;
            });
            attemptLogger.debug({ event: 'fetch_details_evaluate_success', detailKeys: Object.keys(evaluatedDetails) }, 'Page evaluation complete.');

            if (Object.keys(evaluatedDetails).length === 0) {
                attemptLogger.warn({ event: 'fetch_details_warn_empty' }, "Evaluation finished, but no details were extracted.");
            }
            return evaluatedDetails;
        }, scimagoRetryOptions, childLogger);

        childLogger.info({ event: 'fetch_details_success', detailCount: Object.keys(details).length }, `Successfully fetched details.`);
        return details;
    } catch (error: any) {
        childLogger.error({ err: error, event: 'fetch_details_failed', stack: error.stack }, `CRITICAL ERROR fetching details`);
        return null;
    } finally {
        childLogger.info({ event: 'fetch_details_finish' }, 'Finished detail fetch attempt.');
    }
};

// --- getImageUrlAndDetails ---
export const getImageUrlAndDetails = async (
    details: JournalDetails | null,
    row: TableRowData | any = null, // any for flexibility if CSVRow is also passed
    apiKey: string | null,
    // cseId: string | null, // CSE ID will come from configService via fetchGoogleImage
    logger: typeof baseLogger,
    configService: ConfigService // <<<< ADD ConfigService
): Promise<ImageResult> => {
    const childLogger = logger.child({ function: 'getImageUrlAndDetails' });
    childLogger.info({ event: 'get_image_start' }, 'Attempting to get image URL.');

    let issnText: string | null = null;
    if (row && row.Issn) { // Assuming CSVRow might have 'Issn'
        issnText = String(row.Issn).trim();
    } else if (row && row.journalName && typeof row.journalName === 'string' && row.journalName.includes('ISSN:')) { // Fallback for TableRowData if ISSN is in name
        const match = row.journalName.match(/ISSN:\s*([\dX-]+)/i);
        if (match && match[1]) issnText = match[1].trim();
    } else if (details && details['ISSN']) {
        issnText = String(details['ISSN']).trim() || null;
    }


    let title: string | null = null;
    if (row && row.Title) { // Assuming CSVRow might have 'Title'
        title = String(row.Title).trim();
    } else if (row && row.journalName) { // From TableRowData
        title = String(row.journalName).trim();
        // Remove ISSN part from title if present
        if (title && title.includes('ISSN:')) {
            title = title.split('ISSN:')[0].trim();
        }
    } else if (details && details['title']) { // From fetched details (if 'title' key exists)
        title = String(details['title']).trim() || null;
    } else if (details && details['Publication type'] && typeof details['Publication type'] === 'string') { // Fallback to publication type if it's the main title
        title = String(details['Publication type']).trim();
    }


    let imageResult: ImageResult = { Image: null, Image_Context: null };

    if (issnText) {
        childLogger.debug({ event: 'get_image_issn_found', issnRaw: issnText });
        const formattedISSN = formatISSN(issnText);
        if (formattedISSN) {
            childLogger.debug({ event: 'get_image_issn_formatted', issnFormatted: formattedISSN, title });
            // API key is passed, CSE ID is handled by fetchGoogleImage via configService
            if (apiKey) { // Only need API key here
                childLogger.info({ event: 'fetch_google_image_start_proxy' }, `Calling Google Image search for ISSN: ${formattedISSN}`);
                try {
                    // Pass configService to fetchGoogleImage
                    const { imageLink, contextLink } = await fetchGoogleImage(title, formattedISSN, apiKey, childLogger, configService);
                    imageResult = { Image: imageLink, Image_Context: contextLink };
                    childLogger.info({ event: 'fetch_google_image_result_proxy', hasImage: !!imageLink, hasContext: !!contextLink }, 'Google Image search finished.');
                } catch (fetchError: any) {
                    childLogger.error({ err: fetchError, event: 'fetch_google_image_failed_proxy', issn: formattedISSN }, `Error during fetchGoogleImage call.`);
                    throw fetchError;
                }
            } else {
                childLogger.warn({ event: 'get_image_skip_missing_apikey', issn: formattedISSN }, `Skipping image search: API key is missing.`);
            }
        } else {
            childLogger.warn({ event: 'get_image_warn_invalid_issn', originalIssn: issnText }, `Invalid ISSN format after processing.`);
        }
    } else {
        childLogger.warn({ event: 'get_image_skip_no_issn', title: title || 'N/A' }, `No ISSN found in details or row to search for image.`);
    }

    childLogger.info({ event: 'get_image_finish', hasImage: !!imageResult.Image }, 'Finished image URL retrieval attempt.');
    return imageResult;
};

// --- getLastPageNumber ---
export const getLastPageNumber = async (
    firstPage: Page,
    baseUrl: string,
    logger: typeof baseLogger,
    configService: ConfigService // <<<< ADD ConfigService
): Promise<number> => {
    const childLogger = logger.child({ function: 'getLastPageNumber', baseUrl });
    childLogger.info({ event: 'get_last_page_start' }, 'Attempting to determine last page number.');
    const url = `${baseUrl}&page=1`;

    // Retry options for this specific operation (can be same as others or different)
    const scimagoRetryOptions: RetryOptions = {
        retries: configService.config.JOURNAL_RETRY_RETRIES,
        minTimeout: configService.config.JOURNAL_RETRY_MIN_TIMEOUT,
        factor: configService.config.JOURNAL_RETRY_FACTOR,
    };

    try {
        childLogger.debug({ event: 'get_last_page_navigating', url, retryOptions: scimagoRetryOptions });
        // Wrap the core logic (navigation + evaluation) in retryAsync
        const lastPageNumber = await retryAsync(async (attempt) => {
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'get_last_page_goto_start' }, 'Navigating to URL for last page number.');
            await firstPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            attemptLogger.debug({ event: 'get_last_page_evaluating' });

            const pageNumber = await firstPage.evaluate(() => {
                const selector = 'body > div.ranking_body > div:nth-child(9) > div'; // This selector might need adjustment
                const text = document.querySelector(selector)?.textContent?.trim();
                if (!text) {
                    console.warn(`[Evaluate getLastPage] Selector '${selector}' not found or has no text. Defaulting to 1 page.`);
                    return 1;
                }
                try {
                    const parts = text.split('of');
                    if (parts.length < 2) {
                        console.warn(`[Evaluate getLastPage] Text '${text}' does not contain 'of'. Defaulting to 1 page.`);
                        return 1;
                    }
                    const totalItemsStr = parts[1].trim().split(' ')[0].replace(/,/g, '');
                    const totalItems = parseInt(totalItemsStr);
                    if (isNaN(totalItems) || totalItems <= 0) {
                        console.warn(`[Evaluate getLastPage] Could not parse valid total items from '${parts[1].trim()}'. Text was: ${text}. Defaulting to 1 page.`);
                        return 1;
                    }
                    return Math.ceil(totalItems / 50); // Assuming 50 items per page
                } catch (e: any) {
                    console.error('[Evaluate getLastPage] Error parsing last page number:', e.message);
                    return 1;
                }
            });
            // If pageNumber is 0 or 1 due to an error/no items, and it's not the first attempt,
            // it might indicate a temporary issue or that the page structure changed.
            // For now, we accept it. More sophisticated error handling could be added.
            if (pageNumber <= 0) { // Should not be 0 if parsing is correct
                attemptLogger.warn({ event: 'get_last_page_eval_returned_zero_or_less', pageNumber }, "Evaluation returned zero or less pages, might indicate an issue.");
                // throw new Error("Failed to evaluate a valid last page number."); // Optionally throw to force retry
            }
            return pageNumber;
        }, scimagoRetryOptions, childLogger);


        childLogger.info({ event: 'get_last_page_success', pageCount: lastPageNumber }, `Determined last page number: ${lastPageNumber}`);
        return lastPageNumber > 0 ? lastPageNumber : 1; // Ensure at least 1 page
    } catch (error: any) {
        childLogger.error({ err: error, event: 'get_last_page_failed', url }, `Failed to get last page number after retries`);
        // throw error; // Re-throw if critical, or return a default
        return 1; // Default to 1 page on ultimate failure to prevent crawl from stopping
    } finally {
        childLogger.info({ event: 'get_last_page_finish' }, 'Finished attempt to get last page number.');
    }
};