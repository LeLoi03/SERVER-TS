import { Page } from 'playwright';
import { formatISSN, logger, retryAsync } from './utils';
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
        logger.error(`Error processing page ${url}: ${error.message}`);
        return [];
    }
};

export const fetchDetails = async (page: Page, journalUrl: string | null): Promise<JournalDetails | null> => {
    if (!journalUrl) return null;
    try {
        const details: JournalDetails = await retryAsync(async () => {
            await page.goto(journalUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
            const details: JournalDetails = await page.evaluate(() => {
                const selectors = [
                    'body > div:nth-child(15) > div > div > div:nth-child(2)',
                    'body > div:nth-child(15) > div > div > div:nth-child(3)',
                    'body > div:nth-child(15) > div > div > div:nth-child(6)',
                    'body > div:nth-child(15) > div > div > div:nth-child(8)',
                ];

                const result: JournalDetails = {};
                selectors.forEach((selector) => {
                    const element = document.querySelector(selector);
                    if (element) {
                        const key = element.querySelector('h2')?.textContent?.trim();
                        if (key) {
                            if (selector === 'body > div:nth-child(15) > div > div > div:nth-child(8)') {
                                const links = element.querySelectorAll('p > a');
                                const homepage = (links[0] as HTMLAnchorElement)?.href || null;
                                const howToPublish = (links[1] as HTMLAnchorElement)?.href || null;
                                const mail = links[2]?.textContent?.includes('@') ? links[2].textContent.trim() : null;

                                result[key] = {
                                    Homepage: homepage,
                                    "How to publish in this journal": howToPublish,
                                    Mail: mail,
                                }
                            } else if (selector === 'body > div:nth-child(15) > div > div > div:nth-child(2)') {
                                const subjectAreaElement = document.querySelector('body > div:nth-child(15) > div > div > div:nth-child(2) ul');
                                const fieldOfResearch: JournalDetails = {};

                                if (subjectAreaElement) { // Add a check if subjectAreaElement exists
                                    const mainTopicElement = subjectAreaElement.querySelector('li > a');

                                    if (mainTopicElement) {
                                        const mainTopic = mainTopicElement.textContent?.trim();
                                        fieldOfResearch['Field of Research'] = mainTopic;
                                        const subTopicElements = subjectAreaElement.querySelectorAll('.treecategory li a');
                                        const topics: string[] = [];
                                        subTopicElements.forEach((item) => {
                                            const subTopic = item.textContent?.trim() || '';
                                            topics.push(subTopic);
                                        });
                                        fieldOfResearch['Topics'] = topics;
                                    }
                                }
                                result['Subject Area and Category'] = fieldOfResearch;

                            } else {
                                const value = Array.from(element.childNodes)
                                    .filter((node) => node.nodeType === Node.TEXT_NODE ||
                                        (node.nodeType === Node.ELEMENT_NODE &&
                                            (node as Element).tagName.toLowerCase() !== 'h2' &&
                                            node.textContent?.trim()))
                                    .map((node) => node.textContent?.trim() || '')
                                    .join(' ');
                                result[key] = value.trim();
                            }
                        }
                    }
                });

                const fullwidthElement = document.querySelector('body > div:nth-child(15) > div > div > div.fullwidth');
                if (fullwidthElement) {
                    const key = fullwidthElement.firstElementChild?.textContent?.trim() || 'Additional Info';
                    const value = Array.from(fullwidthElement.childNodes)
                        .filter((node) => node.nodeType === Node.TEXT_NODE ||
                            (node.nodeType === Node.ELEMENT_NODE &&
                                (node as Element).tagName.toLowerCase() !== 'h2' &&
                                (node as Element).tagName.toLowerCase() !== 'a' &&
                                (node as Element).textContent?.trim()))
                        .map((node) => node.textContent?.trim() || '')
                        .join(' ');
                    result[key] = value.trim();
                }

                const supplementaryTableSelector =
                    'body > div:nth-child(16) > div > div.cellcontent > div:nth-child(2) > table';
                const supplementaryTable = document.querySelector(supplementaryTableSelector);
                if (supplementaryTable) {
                    const supplementaryData: any[] = [];
                    const rows = supplementaryTable.querySelectorAll('tbody tr');
                    rows.forEach((row) => {
                        const cells = row.querySelectorAll('td');
                        if (cells.length === 3) {
                            supplementaryData.push({
                                Category: cells[0].textContent?.trim() || '',
                                Year: cells[1].textContent?.trim() || '',
                                Quartile: cells[2].textContent?.trim() || '',
                            });
                        }
                    });
                    result['SupplementaryTable'] = supplementaryData;
                }

                const embedCodeElement = document.querySelector('#embed_code');
                if (embedCodeElement) {
                    const thumbnailText = embedCodeElement.getAttribute('value');
                    if (thumbnailText) {
                        result['Thumbnail'] = thumbnailText.trim();
                    }
                }

                return result;
            });
            return details;
        }, RETRY_OPTIONS);
        return details;
    } catch (error: any) {
        logger.error(`Error fetching details for ${journalUrl}: ${error.message}`);
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

    let imageResult: ImageResult = { Image: null, Image_Context: null };

    if (issnText) {
        const formattedISSN = formatISSN(issnText);
        if (formattedISSN) {
            if (apiKey && cseId) {
                try {
                    const { imageLink, contextLink } = await fetchGoogleImage(formattedISSN, apiKey, cseId);
                    if (imageLink) {
                        imageResult = { Image: imageLink, Image_Context: contextLink };
                    }
                } catch (fetchError: any) {
                    logger.error(`Error occurred during fetchGoogleImage call for ISSN ${formattedISSN}: ${fetchError.message}`);
                }
            } else {
                logger.warn(`Skipping image search for ISSN ${formattedISSN} because API key or CSE ID is missing.`);
            }
        } else {
            logger.warn(`Invalid ISSN format after processing: ${issnText}`);
        }
    } else {
        logger.warn(`No ISSN found in details or row to search for image.`);
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