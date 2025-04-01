import axios, { AxiosResponse, isAxiosError } from 'axios';
import * as cheerio from 'cheerio'; // Import all exports as cheerio
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Assuming config.js exports these as constants (e.g., strings)
// If config.js is complex, consider converting it to .ts
import { PORTAL, BY, CORE, SORT } from '../config'; // Keep .js if not converted
import { ConferenceData } from './types'

/**
 * Fetches the first page of conference search results to determine the total number of pages.
 * @param url - The URL of the first page of search results.
 * @returns A promise that resolves to the maximum page number found, or 1 if an error occurs or no pages are found.
 */
export const getTotalPages = async (url: string): Promise<number> => {
    try {
        console.log(`Fetching total pages from: ${url}`);
        // Explicitly type the response data as string (HTML content)
        const response: AxiosResponse<string> = await axios.get(url, { timeout: 10000 }); // Added timeout

        // Axios throws for >= 400 statuses, but this check adds safety if that behavior changes/is configured off
        if (response.status >= 400) {
            console.error(`Error loading page for total pages: ${url} - Status code: ${response.status}`);
            return 1; // Return a default value
        }

        const $: cheerio.CheerioAPI = cheerio.load(response.data);
        let maxPage = 1; // Default to 1 page

        // Select pagination links
        $("#search > a").each((index: number, element: any) => {
            try {
                const pageText = $(element).text().trim();
                const pageValue = parseInt(pageText, 10);
                if (!isNaN(pageValue)) {
                    maxPage = Math.max(maxPage, pageValue);
                }
            } catch (parseError: unknown) {
                console.error(`Error parsing page number from element: ${$(element).html()}`, parseError instanceof Error ? parseError.message : parseError);
            }
        });
        console.log(`Maximum page number found: ${maxPage}`);
        return maxPage;

    } catch (error: unknown) {
        console.error(`Error during getTotalPages fetch for ${url}:`);
        if (isAxiosError(error)) {
            console.error(`Axios Error: ${error.message}, Status: ${error.response?.status}`);
        } else if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
            console.error(error.stack); // Log stack trace for non-Axios errors
        } else {
            console.error('An unknown error occurred:', error);
        }
        return 1; // Return default value in case of any error
    }
};

/**
 * Fetches and parses conference data from a specific page URL.
 * @param url - The URL of the specific page to scrape.
 * @param pageIndex - The index of the page being scraped (for logging/saving purposes).
 * @returns A promise that resolves to an array of Conference objects found on the page.
 */
export const getConferencesOnPage = async (url: string, pageIndex: number): Promise<ConferenceData[]> => {
    let conferences: ConferenceData[] = []; // Initialize conferences outside the try block

    try {
        console.log(`Fetching conferences from page ${pageIndex}: ${url}`);
        const response: AxiosResponse<string> = await axios.get(url, { timeout: 15000 }); // Longer timeout for content pages

        if (response.status >= 400) {
            console.error(`Error loading page content: ${url} - Status code: ${response.status}`);
            return []; // Return empty array on error
        }

        const $: cheerio.CheerioAPI = cheerio.load(response.data);
        const data: string[] = []; // To store raw text data from cells

        // Extract text from all table cells within the #search container
        $("#search > table tr td").each((index: number, element: any) => {
            try {
                data.push($(element).text().trim());
            } catch (elementError: unknown) {
                console.error(`Error processing table cell content: ${$(element).html()}`, elementError instanceof Error ? elementError.message : elementError);
                data.push(""); // Add an empty string as a placeholder on error
            }
        });

        // Select table rows (skip header row if necessary, depending on selector)
        const rows = $("#search > table tr");

        // Extract 'onclick' attribute from rows (excluding potential header)
        // Assuming the first row might be a header and doesn't have the onclick
        const onclickData: string[] = rows.slice(1) // Adjust slice if header is different
            .map((index: number, row: any): string | undefined => {
                try {
                    return $(row).attr("onclick");
                } catch (rowError: unknown) {
                    console.error(`Error getting onclick attribute from row: ${$(row).html()}`, rowError instanceof Error ? rowError.message : rowError);
                    return undefined; // Return undefined on error
                }
            })
            .get() // Get as a standard array
            .filter((attr): attr is string => typeof attr === 'string' && attr.length > 0); // Filter out undefined/empty strings


        // Process the extracted text data into Conference objects
        // Assuming 9 columns per conference
        const columnsPerRow = 9;
        if (data.length % columnsPerRow !== 0) {
             console.warn(`Warning: Data length (${data.length}) is not a multiple of expected columns (${columnsPerRow}) on page ${pageIndex}. Data might be incomplete or table structure changed.`);
        }

        for (let i = 0; i < data.length; i += columnsPerRow) {
             // Basic check if enough data exists for a full row
             if (i + columnsPerRow > data.length) {
                 console.warn(`Skipping incomplete row at the end of data on page ${pageIndex}. Index ${i}`);
                 continue;
             }
            try {
                // Remove potential year in parentheses from title
                const title_formatted = data[i]?.replace(/\s*\(\d{4}\)$/g, '').trim() || 'N/A'; // Handle potential undefined

                const conference: ConferenceData = {
                    Title: title_formatted,
                    Acronym: data[i + 1] || 'N/A',
                    Source: data[i + 2] || 'N/A',
                    Rank: data[i + 3] || 'N/A',
                    Note: data[i + 4] || 'N/A',
                    DBLP: data[i + 5] || 'N/A',
                    PrimaryFoR: data[i + 6] || 'N/A',
                    Comments: data[i + 7] || 'N/A',
                    Rating: data[i + 8] || 'N/A',
                    Details: [], // Initialize Details as an empty object
                };
                conferences.push(conference);
            } catch (conferenceCreationError: unknown) {
                console.error(`Error creating conference object from data chunk starting at index ${i}:`, conferenceCreationError instanceof Error ? conferenceCreationError.message : conferenceCreationError);
                // Decide how to handle: Skip? Add a placeholder?
            }
        }

        // --- Start of Commented Out Detail Scraping ---
        /*
        // Ensure the number of conferences matches the number of onclick attributes found
        if (conferences.length !== onclickData.length) {
            console.warn(`Mismatch between number of conferences parsed (${conferences.length}) and onclick attributes found (${onclickData.length}) on page ${pageIndex}. Detail association might be incorrect.`);
            // Decide how to proceed: skip details, try to align, etc.
        }

        // Iterate through onclick attributes to fetch details
        for (let j = 0; j < onclickData.length; j++) {
            // Safety check: ensure conference exists at this index
            if (!conferences[j]) continue;

            const onclick = onclickData[j];
            const match = onclick.match(/navigate\('([^']+)'\)/); // Regex to extract the relative URL

            if (match && match[1]) {
                let detailUrl: string;
                try {
                     // Construct the absolute URL for the detail page
                    detailUrl = new URL(match[1], url).href;
                } catch (urlError: unknown) {
                    console.error(`Error constructing detail URL from onclick: ${onclick}`, urlError instanceof Error ? urlError.message : urlError);
                    continue; // Skip this detail fetch if URL is invalid
                }

                console.log(`Fetching details for conference ${j + 1} (${conferences[j]?.Acronym || 'N/A'}) from: ${detailUrl}`);

                try {
                    const detailResponse: AxiosResponse<string> = await axios.get(detailUrl, { timeout: 10000 });

                    if (detailResponse.status >= 400) {
                        console.error(`Error loading detail page: ${detailUrl} - Status code: ${detailResponse.status}`);
                        // Assign empty details or a specific error marker
                        conferences[j].Details = { error: `Failed to load details - Status ${detailResponse.status}` };
                        continue; // Skip processing for this detail page
                    }

                    const detail$: cheerio.CheerioAPI = cheerio.load(detailResponse.data);
                    const detailElements: ConferenceDetail[] = []; // Array to hold details potentially from multiple sections

                    // Find detail sections (adjust selector as needed)
                    detail$("#detail > .detail").each((index: number, detailDiv: cheerio.Element) => {
                        try {
                            const details: ConferenceDetail = {}; // Details for one section

                            // Find rows within the detail section
                            detail$(detailDiv).find(".row").each((rowIndex: number, rowElement: cheerio.Element) => {
                                try {
                                    const text = detail$(rowElement).text().trim();
                                    const colonIndex = text.indexOf(":");

                                    if (colonIndex > -1) {
                                        const key = text.substring(0, colonIndex).trim();
                                        let value = text.substring(colonIndex + 1).trim();

                                        // Optional: Clean up value (e.g., remove text in parentheses)
                                        // const parenthesisIndex = value.indexOf("(");
                                        // if (parenthesisIndex > -1) {
                                        //     value = value.substring(0, parenthesisIndex).trim();
                                        // }

                                        if (key && value) {
                                            // Special handling for fields that can have multiple values
                                            if (key === "Field Of Research") { // Example key
                                                if (details[key] && Array.isArray(details[key])) {
                                                    // If it's already an array, push
                                                    (details[key] as string[]).push(value);
                                                } else if (details[key]) {
                                                     // If it exists but isn't an array, make it an array
                                                    details[key] = [details[key] as string, value];
                                                }
                                                else {
                                                    // Otherwise, initialize as an array
                                                    details[key] = [value];
                                                }
                                            } else {
                                                // Assign single value (overwrite if key repeats, adjust if needed)
                                                details[key] = value;
                                            }
                                        }
                                    }
                                } catch (detailRowError: unknown) {
                                    console.error(`Error processing detail row: ${detail$(rowElement).text()}`, detailRowError instanceof Error ? detailRowError.message : detailRowError);
                                    // Decide: Add a placeholder? Skip this row?
                                }
                            }); // End processing rows

                            if (Object.keys(details).length > 0) {
                                detailElements.push(details);
                            }
                        } catch (detailDivError: unknown) {
                            console.error(`Error processing detail div section:`, detailDivError instanceof Error ? detailDivError.message : detailDivError);
                        }
                    }); // End processing detail divs

                    // Assign the collected details. Decide how to handle multiple detail sections.
                    // Option 1: Assign only the first one found
                    // conferences[j].Details = detailElements[0] || { info: "No details parsed" };
                    // Option 2: Merge all found details (handle key conflicts)
                    // conferences[j].Details = Object.assign({}, ...detailElements);
                    // Option 3: Store as an array of detail objects (changes Conference.Details type)
                     conferences[j].Details = detailElements.length > 0 ? detailElements : { info: "No details parsed" }; // Requires Details: ConferenceDetail[] | Record<string, any>

                } catch (detailError: unknown) {
                    console.error(`Error fetching or parsing detail page ${detailUrl}:`);
                     if (isAxiosError(detailError)) {
                        console.error(`Axios Error: ${detailError.message}, Status: ${detailError.response?.status}`);
                        conferences[j].Details = { error: `Failed to fetch details - ${detailError.message}` };
                    } else if (detailError instanceof Error) {
                        console.error(`Error: ${detailError.message}`);
                        console.error(detailError.stack);
                         conferences[j].Details = { error: `Parsing error - ${detailError.message}` };
                    } else {
                        console.error('An unknown detail error occurred:', detailError);
                         conferences[j].Details = { error: 'Unknown error fetching/parsing details' };
                    }
                }
            } else {
                 console.warn(`Could not extract detail URL from onclick attribute on page ${pageIndex}, index ${j}: ${onclick}`);
                 if (conferences[j]) {
                     conferences[j].Details = { error: 'Could not extract detail URL' };
                 }
            }
        } // End loop through onclickData
        */
        // --- End of Commented Out Detail Scraping ---


    } catch (error: unknown) {
        console.error(`Error during getConferencesOnPage execution for page ${pageIndex} (${url}):`);
         if (isAxiosError(error)) {
            console.error(`Axios Error: ${error.message}, Status: ${error.response?.status}`);
        } else if (error instanceof Error) {
            console.error(`Error: ${error.message}`);
            console.error(error.stack);
        } else {
            console.error('An unknown error occurred:', error);
        }
        // conferences will be returned by finally, potentially empty
    } finally {
        // This block ALWAYS executes, regardless of errors in the try block.

        // --- Start of Commented Out File Saving ---
        /*
        const sourceRankPath = path.join(__dirname, "data", "source_rank");
        try {
            // Ensure the target directory exists
            await fs.promises.mkdir(sourceRankPath, { recursive: true });
           // console.log(`Ensured directory exists: ${sourceRankPath}`); // Optional log
        } catch (mkdirErr: unknown) {
            // Log error but don't stop execution, file saving will just fail
            console.error("Error creating directory:", mkdirErr instanceof Error ? mkdirErr.message : mkdirErr);
        }

        const outputPath = path.join(sourceRankPath, `page_${pageIndex}.json`);

        try {
            if (conferences.length > 0) {
                // Asynchronously write the JSON file
                await fs.promises.writeFile(outputPath, JSON.stringify(conferences, null, 2), "utf8");
                console.log(`Conference data for page ${pageIndex} saved to ${outputPath}`);
            } else {
                console.log(`No conferences found or parsed for page ${pageIndex}, skipping file write.`);
            }
        } catch (writeErr: unknown) {
             // Log file writing errors
            console.error(`Error writing file ${outputPath}:`, writeErr instanceof Error ? writeErr.message : writeErr);
        }
        */
        // --- End of Commented Out File Saving ---

        // Always return the (potentially empty) array of conferences
        return conferences;
    }
};

/**
 * Main function to orchestrate the scraping of all conference pages.
 * @returns A promise that resolves to an array containing all Conference objects found.
 */
export const getConferenceList = async (): Promise<ConferenceData[]> => {
    // Construct base URL using imported config values (asserting as string for safety if needed)
    const baseUrl = `${PORTAL as string}?search=&by=${BY as string}&source=${CORE as string}&sort=${SORT as string}&page=`;
    let totalPages = 1; // Default to 1 page

    try {
        totalPages = await getTotalPages(baseUrl + "1"); // Get total pages based on page 1
         if(totalPages <= 0) {
            console.warn("getTotalPages returned an invalid number, defaulting to 1 page.");
            totalPages = 1;
        }
    } catch (error) {
        console.error("Failed to get total pages, proceeding with 1 page.", error);
        totalPages = 1; // Proceed with 1 page if getTotalPages fails critically
    }


    const allConferences: ConferenceData[] = [];
    const maxPagesToScrape = 4; // Your original code limit
    const pagesToFetch = Math.min(totalPages, maxPagesToScrape); // Limit fetching

    console.log(`Starting conference scraping for ${pagesToFetch} pages (Total found: ${totalPages}, Limit: ${maxPagesToScrape})...`);

    // Loop through each page number to fetch data
    for (let i = 1; i <= pagesToFetch; i++) {
        const pageUrl = baseUrl + i;
        console.log(`--- Processing Page ${i} of ${pagesToFetch} ---`);
        try {
            // Await the result of fetching conferences for the current page
            const conferencesOnPage: ConferenceData[] = await getConferencesOnPage(pageUrl, i);
            if (conferencesOnPage.length > 0) {
                 console.log(`Successfully processed page ${i}, found ${conferencesOnPage.length} conferences.`);
                // Add the found conferences to the main list
                allConferences.push(...conferencesOnPage);
            } else {
                 console.log(`Page ${i} processed, but no conferences were extracted or found.`);
            }
        } catch (error: unknown) {
            // Catch errors specifically from getConferencesOnPage if they weren't handled internally
            console.error(`Critical error processing page ${i} (${pageUrl}):`);
             if (error instanceof Error) {
                console.error(`Error: ${error.message}`);
                console.error(error.stack); // Log stack trace
            } else {
                console.error('An unknown error occurred during page processing:', error);
            }
            // Continue to the next page even if one fails
        }
    }

    console.log(`--- Scraping Finished ---`);
    console.log(`Total conferences collected across ${pagesToFetch} pages: ${allConferences.length}`);
    return allConferences;
};

// Example of how to run (optional, usually called from another module)
/*
getConferenceList()
    .then(conferences => {
        console.log("Conference scraping complete.");
        // Optionally save the final combined list to a file
        // fs.writeFileSync('all_conferences.json', JSON.stringify(conferences, null, 2), 'utf8');
        // console.log("Saved all conferences to all_conferences.json");
    })
    .catch(error => {
        console.error("An error occurred during the main conference list retrieval:", error);
    });
*/