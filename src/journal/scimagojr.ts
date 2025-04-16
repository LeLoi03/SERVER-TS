import { Page } from 'playwright';
import { formatISSN, retryAsync } from './utils';
import { fetchGoogleImage } from './googleSearch';
import { RETRY_OPTIONS } from '../config';

import { TableRowData, JournalDetails, ImageResult } from './types';


export const processPage = async (page: Page, url: string): Promise<TableRowData[]> => {
    // Chặn script ở đây
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
        const tableData: TableRowData[] = await retryAsync(async () => {
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
        }, RETRY_OPTIONS);
        return tableData;
    } catch (error: any) {
        // logger.error(`Error processing page ${url}: ${error.message}`);
        return [];
    }
};

export const fetchDetails = async (page: Page, journalUrl: string | null): Promise<JournalDetails | null> => {
    if (!journalUrl) {
        // logger.warn("fetchDetails called with null journalUrl.");
        return null;
    }
    // logger.info(`Fetching details for: ${journalUrl}`);

    try {
        const details: JournalDetails = await retryAsync(async () => {
            // logger.debug(`Attempting to navigate to ${journalUrl}`);
            await page.goto(journalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            // logger.debug(`Navigation to ${journalUrl} successful. Evaluating page content...`);

            // Trước page.evaluate
            const tableRowSelector = 'body > div:nth-child(15) > div > div.cellcontent > div:nth-child(2) > table tbody tr';
            // Hoặc nếu bạn muốn thử cả 15 và 16:
            // const tableRowSelector = 'body > div:nth-child(15) > div > div.cellcontent > div:nth-child(2) > table tbody tr, body > div:nth-child(16) > div > div.cellcontent > div:nth-child(2) > table tbody tr';
            try {
                await page.waitForSelector(tableRowSelector, { timeout: 10000 }); // Chờ tối đa 10 giây
            } catch (e) {
                // logger.warn(`Table rows not found within timeout for selector: ${tableRowSelector}`);
                // Có thể quyết định trả về null hoặc tiếp tục thử evaluate
            }


            const details: JournalDetails = await page.evaluate(() => {
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

            // logger.debug(`Page evaluation complete for ${journalUrl}.`);
            // Kiểm tra xem details có rỗng không, nếu có thể là lỗi không tìm thấy gì
            if (Object.keys(details).length === 0) {
                //  logger.warn(`No details extracted for ${journalUrl}. Selectors might have failed or the page structure is different.`);
                // Cân nhắc throw lỗi ở đây nếu việc không có dữ liệu nào là bất thường và cần retry
                // throw new Error(`No details extracted for ${journalUrl}`);
            } else {
                //   logger.info(`Successfully extracted ${Object.keys(details).length} detail sections for ${journalUrl}.`);
            }

            return details;
        }, RETRY_OPTIONS);
        return details;
    } catch (error: any) {
        // logger.error(`CRITICAL ERROR fetching details for ${journalUrl}: ${error.message}`);
        // logger.debug(error.stack); // Log stack trace để debug sâu hơn nếu cần
        return null;
    }
};


export const getImageUrlAndDetails = async (details: JournalDetails | null, row: any = null, apiKey: string | null, cseId: string | null): Promise<ImageResult> => {
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
        const formattedISSN = formatISSN(issnText);
        if (formattedISSN) {
            if (apiKey && cseId) {
                try {
                    const { imageLink, contextLink } = await fetchGoogleImage(title, formattedISSN, apiKey, cseId);
                    if (imageLink) {
                        imageResult = { Image: imageLink, Image_Context: contextLink };
                    }
                } catch (fetchError: any) {
                    // logger.error(`Error occurred during fetchGoogleImage call for ISSN ${formattedISSN}: ${fetchError.message}`);
                }
            } else {
                // logger.warn(`Skipping image search for ISSN ${formattedISSN} because API key or CSE ID is missing.`);
            }
        } else {
            // logger.warn(`Invalid ISSN format after processing: ${issnText}`);
        }
    } else {
        // logger.warn(`No ISSN found in details or row to search for image.`);
    }

    return imageResult;
};

export const getLastPageNumber = async (firstPage: Page, baseUrl: string): Promise<number> => {
    await firstPage.goto(`${baseUrl}&page=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const lastPageNumber = await firstPage.evaluate(() => {
        const text = document.querySelector('body > div.ranking_body > div:nth-child(9) > div')?.textContent?.trim(); // Null check
        if (!text) return 1;
        const totalItems = parseInt(text.split('of')[1].trim());
        return Math.ceil(totalItems / 50);
    });

    return lastPageNumber;
};