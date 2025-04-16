
// ============================================
// File: src/journal/scimagojr.ts (Modified)
// ============================================
import { Page } from 'playwright';
import { formatISSN, retryAsync } from './utils'; // retryAsync is NOT modified
// Assume fetchGoogleImage is modified to accept logger
import { fetchGoogleImage } from './googleSearch';
import { RETRY_OPTIONS } from '../config';
import { TableRowData, JournalDetails, ImageResult } from './types';
import { logger as baseLogger } from './utils'; // Import base logger type/instance

// --- processPage ---
export const processPage = async (
    page: Page,
    url: string,
    logger: typeof baseLogger // <-- Accept logger
): Promise<TableRowData[]> => {
    const childLogger = logger.child({ function: 'processPage', url });
    childLogger.info({ event: 'process_page_start' }, 'Starting page processing.');

    // Route blocking logic remains the same
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
        // Log *around* retryAsync, not inside it
        childLogger.debug({ event: 'process_page_attempt_start', retryOptions: RETRY_OPTIONS }, 'Attempting to process page with retries.');
        const tableData: TableRowData[] = await retryAsync(async (attempt) => {
            // Log inside the function passed to retryAsync
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'process_page_goto_start' }, 'Navigating to URL.');
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
            const tableData: TableRowData[] = await page.evaluate(() => {
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
                            if (index === 0) return;

                            if (index === 1) {
                                const linkElement = cell.querySelector('a');
                                rowData.journalLink = linkElement ? linkElement.href : null;
                                rowData.journalName = linkElement ? linkElement.textContent?.trim() || null : null;
                                rowData.csvRow += traverseNodes(cell) + ',';
                            } else if (index < cells.length - 1) {
                                rowData.csvRow += traverseNodes(cell) + ',';
                            } else {
                                const country = cell.querySelector('img')?.getAttribute('title') || 'N/A';
                                rowData.csvRow += country;
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
                    return [];
                }
            });
            return tableData;
        }, RETRY_OPTIONS, childLogger );

        childLogger.info({ event: 'process_page_success', rowCount: tableData.length }, 'Successfully processed page.');
        return tableData;
    } catch (error: any) {
        childLogger.error({ err: error, event: 'process_page_failed' }, `Error processing page`);
        // Re-throw or return empty array based on desired behavior
        // Re-throwing is often better to signal failure upstream
        throw error;
        // return []; // Alternative: return empty on failure
    } finally {
        childLogger.info({ event: 'process_page_finish' }, 'Finished page processing attempt.');
    }
};

// --- fetchDetails ---
export const fetchDetails = async (
    page: Page,
    journalUrl: string | null,
    logger: typeof baseLogger // <-- Accept logger
): Promise<JournalDetails | null> => {
    const childLogger = logger.child({ function: 'fetchDetails', journalUrl });

    if (!journalUrl) {
        childLogger.warn({ event: 'fetch_details_skip_null_url' }, "Skipping fetchDetails: journalUrl is null.");
        return null;
    }
    childLogger.info({ event: 'fetch_details_start' }, `Starting detail fetch.`);

    try {
        childLogger.debug({ event: 'fetch_details_attempt_start', retryOptions: RETRY_OPTIONS }, 'Attempting to fetch details with retries.');
        const details: JournalDetails = await retryAsync(async (attempt) => {
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'fetch_details_goto_start' }, 'Navigating to journal URL.');
            await page.goto(journalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            attemptLogger.debug({ event: 'fetch_details_goto_success' }, 'Navigation successful. Evaluating page content.');

            const tableRowSelector = 'body > div:nth-child(15) > div > div.cellcontent > div:nth-child(2) > table tbody tr';
            // Selector waiting (optional but good practice)
            try {
                 attemptLogger.debug({ event: 'wait_for_selector_start', selector: tableRowSelector });
                 await page.waitForSelector(tableRowSelector, { timeout: 10000 });
                 attemptLogger.debug({ event: 'wait_for_selector_success', selector: tableRowSelector });
            } catch (e) {
                attemptLogger.warn({ event: 'wait_for_selector_timeout', selector: tableRowSelector }, `Optional table rows selector not found within timeout.`);
                // Continue anyway, evaluate might still work or find other data
           }

           attemptLogger.debug({ event: 'fetch_details_evaluate_start' });
    
            const evaluatedDetails: JournalDetails = await page.evaluate(() => {
                // --- Hàm trợ giúp để thử nhiều selector ---
                function querySelectorWithIndices(baseSelectorPattern: string, indices: number[]): { element: Element | null; successfulSelector: string | null } {
                    for (const index of indices) {
                        const selector = baseSelectorPattern.replace('{index}', index.toString());
                        // console.log(`[Query Helper] Trying selector: ${selector}`); // Bật nếu cần debug sâu
                        const element = document.querySelector(selector);
                        if (element) {
                            // console.log(`[Query Helper] Found element with selector: ${selector}`);
                            return { element, successfulSelector: selector }; // Trả về cả element và selector thành công
                        }
                    }
                    // console.log(`[Query Helper] Element not found for pattern: ${baseSelectorPattern} with indices: ${indices}`);
                    return { element: null, successfulSelector: null }; // Không tìm thấy
                }
                // --- Kết thúc hàm trợ giúp ---

                // Các chỉ số cần thử
                const mainIndices = [13, 14, 15];
                const tableIndices = [15, 16];

                const result: JournalDetails = {};
                console.log('[Evaluation] Starting data extraction...');

                // --- Xử lý các selector chính ---
                console.log('[Evaluation] Processing main selectors...');
                const selectorPatterns = [
                    { type: 'Subject Area', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(2)' },
                    { type: 'Publisher', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(3)' },
                    { type: 'Scope', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(6)' },
                    { type: 'Contact', pattern: 'body > div:nth-child({index}) > div > div > div:nth-child(8)' },
                ];

                selectorPatterns.forEach(({ type, pattern }) => {
                    // console.log(`[Main Selectors] Attempting pattern: "${pattern}" with indices: ${mainIndices}`);
                    const { element, successfulSelector } = querySelectorWithIndices(pattern, mainIndices);
                    if (element) {
                        // console.log(`[Main Selectors] Found element for type "${type}" with selector: "${successfulSelector}"`);
                        const keyElement = element.querySelector('h2');
                        const key = keyElement?.textContent?.trim();
                        if (key) {
                            // console.log(`[Main Selectors] Found key "${key}" for type "${type}"`);
                            if (type === 'Contact') {
                                const links = element.querySelectorAll('p > a');
                                const homepage = (links[0] as HTMLAnchorElement)?.href || null;
                                const howToPublish = (links[1] as HTMLAnchorElement)?.href || null;
                                const mail = links[2]?.textContent?.includes('@') ? links[2].textContent.trim() : null;

                                result[key] = {
                                    Homepage: homepage,
                                    "How to publish in this journal": howToPublish,
                                    Mail: mail,
                                };
                                // console.log(`[Main Selectors] Contact data extracted for key "${key}"`);
                            } else if (type === 'Subject Area') {
                                const subjectAreaElement = element.querySelector('ul');
                                const fieldOfResearch: JournalDetails['Subject Area and Category'] = {};

                                if (subjectAreaElement) {
                                    const mainTopicElement = subjectAreaElement.querySelector('li > a');
                                    if (mainTopicElement) {
                                        const mainTopic = mainTopicElement.textContent?.trim();
                                        fieldOfResearch['Field of Research'] = mainTopic || null;
                                        const subTopicElements = subjectAreaElement.querySelectorAll('.treecategory li a');
                                        const topics: string[] = [];
                                        subTopicElements.forEach((item) => {
                                            const subTopic = item.textContent?.trim();
                                            if (subTopic) { topics.push(subTopic); }
                                        });
                                        fieldOfResearch['Topics'] = topics;
                                        // console.log(`[Main Selectors] Subject Area data extracted for key "${key}"`, fieldOfResearch);
                                    } else {
                                        console.warn(`[Main Selectors] Could not find main topic link (li > a) within subject area ul for key "${key}"`);
                                    }
                                } else {
                                    console.warn(`[Main Selectors] Could not find subject area list (ul) within element for key "${key}"`);
                                }
                                result['Subject Area and Category'] = fieldOfResearch;

                            } else {
                                // Lấy text nodes và các element nodes không phải h2
                                const value = Array.from(element.childNodes)
                                    .filter((node) => node.nodeType === Node.TEXT_NODE ||
                                        (node.nodeType === Node.ELEMENT_NODE &&
                                            (node as Element).tagName.toLowerCase() !== 'h2' &&
                                            node.textContent?.trim()))
                                    .map((node) => node.textContent?.trim() || '')
                                    .join(' ')
                                    .replace(/\s+/g, ' ') // Chuẩn hóa khoảng trắng
                                    .trim();
                                result[key] = value;
                                // console.log(`[Main Selectors] Generic data extracted for key "${key}": "${value.substring(0, 50)}..."`);
                            }
                        } else {
                            console.warn(`[Main Selectors] Key (h2) not found within element for type "${type}" using selector "${successfulSelector}"`);
                        }
                    } else {
                        // console.warn(`[Main Selectors] Element not found for type "${type}" using pattern "${pattern}" with indices ${mainIndices}`);
                    }
                });
                console.log('[Evaluation] Finished processing main selectors.');

                // --- Xử lý phần tử fullwidth ---
                console.log('[Evaluation] Processing fullwidth element...');
                const fullwidthPattern = 'body > div:nth-child({index}) > div > div > div.fullwidth';
                // console.log(`[Fullwidth] Attempting pattern: "${fullwidthPattern}" with indices: ${mainIndices}`);
                const { element: fullwidthElement, successfulSelector: fwSelector } = querySelectorWithIndices(fullwidthPattern, mainIndices);
                if (fullwidthElement) {
                    // console.log(`[Fullwidth] Found element with selector: "${fwSelector}"`);
                    const keyElement = fullwidthElement.firstElementChild; // Thường là h2
                    const key = keyElement?.textContent?.trim() || 'Additional Info';
                    // console.log(`[Fullwidth] Found key: "${key}"`);
                    const value = Array.from(fullwidthElement.childNodes)
                        .filter((node) => node.nodeType === Node.TEXT_NODE ||
                            (node.nodeType === Node.ELEMENT_NODE &&
                                keyElement && node !== keyElement && // Bỏ qua chính element chứa key
                                (node as Element).tagName.toLowerCase() !== 'a' &&
                                node.textContent?.trim()))
                        .map((node) => node.textContent?.trim() || '')
                        .join(' ')
                        .replace(/\s+/g, ' ') // Chuẩn hóa khoảng trắng
                        .trim();
                    result[key] = value;
                    // console.log(`[Fullwidth] Extracted value for key "${key}": "${value.substring(0, 50)}..."`);
                } else {
                    console.warn(`[Fullwidth] Element not found using pattern "${fullwidthPattern}" with indices ${mainIndices}`);
                }
                console.log('[Evaluation] Finished processing fullwidth element.');

                // --- Xử lý bảng phụ ---
                console.log('[Table Section] Starting supplementary table processing...');
                const supplementaryTablePattern = 'body > div:nth-child({index}) > div > div.cellcontent > div:nth-child(2) > table';
                console.log(`[Table Query] Attempting to find table with pattern: "${supplementaryTablePattern}" and indices: ${tableIndices}`);

                const { element: supplementaryTable, successfulSelector: tableSelector } = querySelectorWithIndices(supplementaryTablePattern, tableIndices);

                if (supplementaryTable) {
                    console.log(`[Table Query] SUCCESS: Found supplementary table using selector: "${tableSelector}"`);
                    const supplementaryData: any[] = [];
                    const tableBody = supplementaryTable.querySelector('tbody');
                    if (!tableBody) {
                        console.warn('[Table Parse] WARNING: Found table element, but it does not contain a <tbody>. Parsing rows directly from table.');
                    }
                    const rows = (tableBody || supplementaryTable).querySelectorAll('tr');
                    console.log(`[Table Parse] Found ${rows.length} rows in the table body (or table). Starting row parsing...`);

                    rows.forEach((row, rowIndex) => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length === 3) {
                            const rowData = {
                                Category: cells[0]?.textContent?.trim() || '',
                                Year: cells[1]?.textContent?.trim() || '',
                                Quartile: cells[2]?.textContent?.trim() || '',
                            };
                            supplementaryData.push(rowData);
                        } else if (cells.length > 0) { // Log cảnh báo nếu hàng không trống nhưng sai cấu trúc
                            console.warn(`[Table Parse] WARNING: Skipping row ${rowIndex}. Expected 3 cells (td), but found ${cells.length}. Row HTML: ${row.innerHTML}`);
                        }
                        // Không log hàng hoàn toàn trống (cells.length === 0)
                    });

                    console.log(`[Table Parse] Finished parsing rows. Extracted data for ${supplementaryData.length} rows.`);
                    if (supplementaryData.length > 0) {
                        result['SupplementaryTable'] = supplementaryData;
                        console.log('[Table Section] Added "SupplementaryTable" key to results.');
                    } else {
                        console.warn('[Table Section] No valid data rows found in the supplementary table. "SupplementaryTable" key not added.');
                    }
                } else {
                    // Sử dụng console.warn thay vì error để không gây nhầm lẫn với lỗi thực sự của hàm
                    console.warn(`[Table Query] FAILED: Could not find supplementary table using pattern "${supplementaryTablePattern}" with indices ${tableIndices}. This might be expected if the table doesn't exist on this page.`);
                }
                console.log('[Table Section] Finished supplementary table processing.');

                // --- Xử lý mã nhúng (thumbnail) ---
                console.log('[Evaluation] Processing embed code...');
                const embedCodeElement = document.querySelector('#embed_code');
                if (embedCodeElement) {
                    console.log('[Embed Code] Found #embed_code element.');
                    const valueAttr = embedCodeElement.getAttribute('value');
                    const textContent = embedCodeElement.textContent;
                    const thumbnailText = valueAttr ?? textContent;

                    if (thumbnailText) {
                        result['Thumbnail'] = thumbnailText.trim();
                        console.log('[Embed Code] Extracted thumbnail text.');
                    } else {
                        console.warn('[Embed Code] #embed_code element found, but has no value attribute or text content.');
                    }
                } else {
                    console.log('[Embed Code] #embed_code element not found.');
                }
                console.log('[Evaluation] Finished processing embed code.');

                console.log('[Evaluation] Data extraction finished.');
                return result;
            });
            attemptLogger.debug({ event: 'fetch_details_evaluate_success', detailKeys: Object.keys(evaluatedDetails) }, 'Page evaluation complete.');

            if (Object.keys(evaluatedDetails).length === 0) {
                 attemptLogger.warn({ event: 'fetch_details_warn_empty' }, "Evaluation finished, but no details were extracted. Selectors might have failed or page structure changed.");
                // Optional: throw error here if empty details mean failure for retry
                // throw new Error(`No details extracted for ${journalUrl} on attempt ${attempt}`);
            }

            return evaluatedDetails;
        }, RETRY_OPTIONS, childLogger);

        childLogger.info({ event: 'fetch_details_success', detailCount: Object.keys(details).length }, `Successfully fetched details.`);
        return details;
    } catch (error: any) {
        childLogger.error({ err: error, event: 'fetch_details_failed', stack: error.stack }, `CRITICAL ERROR fetching details`);
        return null; // Return null on failure after retries
    } finally {
         childLogger.info({ event: 'fetch_details_finish' }, 'Finished detail fetch attempt.');
    }
};

// --- getImageUrlAndDetails ---
export const getImageUrlAndDetails = async (
    details: JournalDetails | null,
    row: any = null, // Consider using a more specific type like TableRowData | CSVRow | null
    apiKey: string | null,
    cseId: string | null,
    logger: typeof baseLogger // <-- Accept logger
): Promise<ImageResult> => {
    const childLogger = logger.child({ function: 'getImageUrlAndDetails' });
    childLogger.info({ event: 'get_image_start' }, 'Attempting to get image URL.');

    let issnText: string | null = null;

    if (row && row.Issn) {
        issnText = row.Issn.trim();
    } else if (details && details['ISSN']) {
        issnText = details['ISSN']?.trim() || null;  // Null-safe access
    }

    let title: string | null = null;

    if (row && row.Title) {
        title = row.Title.trim();
    } else if (details && details['title']) {
        title = details['title']?.trim() || null;  // Null-safe access
    } else if (details && details['Title']) {
        title = details['Title']?.trim() || null;  // Null-safe access
    }

    let imageResult: ImageResult = { Image: null, Image_Context: null };

    if (issnText) {
        childLogger.debug({ event: 'get_image_issn_found', issnRaw: issnText });
        const formattedISSN = formatISSN(issnText); // formatISSN doesn't need logger
        if (formattedISSN) {
            childLogger.debug({ event: 'get_image_issn_formatted', issnFormatted: formattedISSN, title });
            if (apiKey && cseId) {
                childLogger.info({ event: 'fetch_google_image_start' }, `Calling Google Image search for ISSN: ${formattedISSN}`);
                try {
                    // ---> Pass logger to fetchGoogleImage (assuming it accepts one)
                    const { imageLink, contextLink } = await fetchGoogleImage(title, formattedISSN, apiKey, cseId, childLogger);
                        imageResult = { Image: imageLink, Image_Context: contextLink };
                    childLogger.info({ event: 'fetch_google_image_result', hasImage: !!imageLink, hasContext: !!contextLink }, 'Google Image search finished.');
                } catch (fetchError: any) {
                    // Log the error from fetchGoogleImage
                    childLogger.error({ err: fetchError, event: 'fetch_google_image_failed', issn: formattedISSN }, `Error during fetchGoogleImage call.`);
                    // Re-throw the error to be caught by performImageSearch in crawlJournals.ts
                    // This allows the ApiKeyManager rotation logic to trigger correctly
                    throw fetchError;
                }
            } else {
                childLogger.warn({ event: 'get_image_skip_missing_creds', issn: formattedISSN }, `Skipping image search: API key or CSE ID is missing.`);
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
    logger: typeof baseLogger // <-- Accept logger
): Promise<number> => {
    const childLogger = logger.child({ function: 'getLastPageNumber', baseUrl });
    childLogger.info({ event: 'get_last_page_start' }, 'Attempting to determine last page number.');
    const url = `${baseUrl}&page=1`; // Construct URL once

    try {
        childLogger.debug({ event: 'get_last_page_navigating', url });
        await firstPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        childLogger.debug({ event: 'get_last_page_evaluating' });

        const lastPageNumber = await firstPage.evaluate(() => {
            const selector = 'body > div.ranking_body > div:nth-child(9) > div';
            const text = document.querySelector(selector)?.textContent?.trim();
            if (!text) {
                console.warn(`[Evaluate] Selector '${selector}' not found or has no text.`);
                return 1; // Default to 1 if selector fails
            }
            try {
                const parts = text.split('of');
                if (parts.length < 2) {
                     console.warn(`[Evaluate] Text '${text}' does not contain 'of'.`);
                     return 1;
                }
                const totalItemsStr = parts[1].trim().split(' ')[0].replace(/,/g, ''); // Handle commas in numbers
                const totalItems = parseInt(totalItemsStr);
                 if (isNaN(totalItems)) {
                     console.warn(`[Evaluate] Could not parse total items from '${parts[1].trim()}'. Text was: ${text}`);
                     return 1;
                 }
                return Math.ceil(totalItems / 50); // Assuming 50 items per page
            } catch (e) {
                console.error('[Evaluate] Error parsing last page number:', e);
                return 1; // Default on parsing error
            }
        });

        childLogger.info({ event: 'get_last_page_success', pageCount: lastPageNumber }, `Determined last page number: ${lastPageNumber}`);
        return lastPageNumber;
    } catch (error: any) {
        childLogger.error({ err: error, event: 'get_last_page_failed', url }, `Failed to get last page number`);
        throw error; // Re-throw to signal failure
    } finally {
         childLogger.info({ event: 'get_last_page_finish' }, 'Finished attempt to get last page number.');
    }
};