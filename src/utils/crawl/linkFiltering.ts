// src/utils/crawl/searchFilter.ts
import { GoogleSearchResult } from "../../types/crawl.types"; // Using GoogleSearchResult as the type for search results.
import logToFile from '../logger'; // Assuming logger is in ../logger or similar
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility

/**
 * Filters an array of search results based on unwanted domains in the link
 * and skip keywords in the title.
 *
 * @param results - An array of search result objects to filter. Expected to conform to the SearchResult interface.
 * @param unwantedDomains - An array of domain strings (case-insensitive match) to exclude.
 * @param skipKeywords - An array of keyword strings (used as case-insensitive regex) to exclude based on the title.
 * @returns A new array containing the filtered search results. If filtering removes all results,
 *          it returns an array containing only the *first* original result (if it's minimally valid).
 *          Returns an empty array if the initial 'results' input is invalid or no valid fallback can be provided.
 */
export function filterSearchResults(
  results: unknown, // Use 'unknown' initially for robust runtime validation
  unwantedDomains: unknown,
  skipKeywords: unknown
): GoogleSearchResult[] { // The function *intends* to return GoogleSearchResult[]
    const logContext = '[SearchFilter]';

    // 1. Validate and cast 'results' input
    if (!Array.isArray(results)) {
        logToFile(`[ERROR] ${logContext} Input 'results' is not an array. Received type: ${typeof results}. Returning empty array.`);
        return [];
    }
    // Cast 'results' to GoogleSearchResult[] after initial validation.
    // Individual item validation will occur within the filter loop.
    const validResults: GoogleSearchResult[] = results as GoogleSearchResult[];

    // 2. Validate and process 'unwantedDomains'
    let validUnwantedDomains: string[];
    if (!Array.isArray(unwantedDomains)) {
        logToFile(`[WARNING] ${logContext} Input 'unwantedDomains' is not an array. Received type: ${typeof unwantedDomains}. Using empty list.`);
        validUnwantedDomains = [];
    } else {
        // Filter out non-string elements, but log a warning if any are found.
        const nonStringDomains = unwantedDomains.filter(d => typeof d !== 'string');
        if (nonStringDomains.length > 0) {
            logToFile(`[WARNING] ${logContext} ${nonStringDomains.length} non-string elements in 'unwantedDomains' were ignored. Examples: ${JSON.stringify(nonStringDomains.slice(0, 3))}.`);
        }
        validUnwantedDomains = unwantedDomains.filter((d): d is string => typeof d === 'string');
    }

    // 3. Validate and process 'skipKeywords'
    let validSkipKeywords: string[];
    if (!Array.isArray(skipKeywords)) {
        logToFile(`[WARNING] ${logContext} Input 'skipKeywords' is not an array. Received type: ${typeof skipKeywords}. Using empty list.`);
        validSkipKeywords = [];
    } else {
        // Filter out non-string elements, but log a warning if any are found.
        const nonStringKeywords = skipKeywords.filter(k => typeof k !== 'string');
        if (nonStringKeywords.length > 0) {
            logToFile(`[WARNING] ${logContext} ${nonStringKeywords.length} non-string elements in 'skipKeywords' were ignored. Examples: ${JSON.stringify(nonStringKeywords.slice(0, 3))}.`);
        }
        validSkipKeywords = skipKeywords.filter((k): k is string => typeof k === 'string');
    }

    // 4. Perform the filtering operation
    const filteredResults = validResults.filter((resultItem: GoogleSearchResult) => {
        try {
            // Runtime validation for each individual result item
            if (!resultItem || typeof resultItem !== 'object' || resultItem === null) {
                logToFile(`[WARNING] ${logContext} Skipping invalid search result item (not an object or null): ${JSON.stringify(resultItem)?.substring(0, 100)}...`);
                return false; // Exclude invalid objects
            }

            // Ensure 'link' property exists and is a non-empty string
            if (typeof resultItem.link !== 'string' || !resultItem.link.trim()) {
                logToFile(`[WARNING] ${logContext} Skipping result with invalid or empty 'link' property: ${JSON.stringify(resultItem)?.substring(0, 100)}...`);
                return false; // Exclude if link is invalid
            }

            // Safely get and normalize link and title
            const link = resultItem.link.toLowerCase();
            const title = (typeof resultItem.title === 'string' ? resultItem.title.toLowerCase() : ""); // Ensure title is string, fallback to empty string

            // Check against unwanted domains
            const hasUnwantedDomain = validUnwantedDomains.some(domain => {
                try {
                    // Domain is guaranteed to be a string here due to `validUnwantedDomains` filtering
                    return link.includes(domain.toLowerCase());
                } catch (domainCheckError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(domainCheckError);
                    logToFile(`[ERROR] ${logContext} Error checking domain "${domain}" against link "${link}": ${errorMessage}. Not filtering this result based on this domain.`);
                    return false; // If error during check, treat as not having unwanted domain to be safe
                }
            });

            if (hasUnwantedDomain) {
                // logToFile(`[INFO] ${logContext} Filtered out result due to unwanted domain: "${link}"`); // Optional: for detailed logging
                return false; // Exclude if unwanted domain found
            }

            // Check against skip keywords using RegExp on the title
            const hasSkipKeyword = validSkipKeywords.some(keyword => {
                try {
                    // Keyword is guaranteed to be a string here due to `validSkipKeywords` filtering
                    return new RegExp(keyword, "i").test(title);
                } catch (regexCreationError: unknown) {
                    const { message: errorMessage } = getErrorMessageAndStack(regexCreationError);
                    logToFile(`[ERROR] ${logContext} Error creating or testing regex with keyword "${keyword}" on title "${title}": ${errorMessage}. Not filtering this result based on this keyword.`);
                    return false; // If error, treat as not having skip keyword to be safe
                }
            });

            // Keep the result only if it has NEITHER an unwanted domain NOR a skip keyword
            return !hasSkipKeyword;

        } catch (filterItemError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(filterItemError);
            logToFile(`[ERROR] ${logContext} Unexpected error while filtering search result item: "${errorMessage}". Item (partial): ${JSON.stringify(resultItem)?.substring(0, 100)}... Stack: ${errorStack}. Excluding this item.`);
            return false; // Exclude the result if any unexpected error occurs during its processing
        }
    });

    // 5. Handle cases where all results were filtered out
    if (filteredResults.length === 0 && validResults.length > 0) {
        logToFile(`[WARNING] ${logContext} All valid search results were filtered out. Returning the first original result as a fallback.`);
        const firstResult = validResults[0];
        // Ensure the first original result is minimally valid before returning it as fallback
        if (firstResult && typeof firstResult === 'object' && typeof firstResult.link === 'string' && firstResult.link.trim()) {
            return [firstResult]; // Return the first *original* valid result as fallback
        } else {
            logToFile(`[WARNING] ${logContext} Fallback failed: The first original result was also invalid. Returning empty array.`);
            return []; // Return empty if the first original wasn't valid either
        }
    }

    logToFile(`[INFO] ${logContext} Filtered ${validResults.length} results down to ${filteredResults.length} results.`);
    return filteredResults;
}