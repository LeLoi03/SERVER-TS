import { SearchResult } from "./types";
/**
 * Filters an array of search results based on unwanted domains in the link
 * and skip keywords in the title.
 *
 * @param results - An array of search result objects to filter. Expected to conform to the SearchResult interface.
 * @param unwantedDomains - An array of domain strings (case-insensitive match) to exclude.
 * @param skipKeywords - An array of keyword strings (used as case-insensitive regex) to exclude based on the title.
 * @returns A new array containing the filtered search results. If filtering removes all results,
 *          it returns an array containing only the *first* original result. Returns an empty array
 *          if the initial 'results' input is invalid.
 */
export function filterSearchResults(
  results: unknown, // Use 'unknown' initially to handle runtime validation gracefully
  unwantedDomains: unknown,
  skipKeywords: unknown
): SearchResult[] { // The function *intends* to return SearchResult[]

  // Runtime validation - crucial if data comes from external sources
  if (!Array.isArray(results)) {
    console.error("filterSearchResults: Input 'results' is not an array.", results);
    return []; // Return empty array if 'results' is invalid
  }
  // Cast 'results' to the expected type *after* validation
  const validResults = results as SearchResult[];

  let validUnwantedDomains: string[];
  if (!Array.isArray(unwantedDomains)) {
    console.warn("filterSearchResults: Input 'unwantedDomains' is not an array. Using empty list.", unwantedDomains);
    validUnwantedDomains = []; // Use a default empty array
  } else {
    // Ensure all elements are strings (or handle non-strings appropriately)
    validUnwantedDomains = unwantedDomains.filter((d): d is string => typeof d === 'string');
    if (validUnwantedDomains.length !== unwantedDomains.length) {
        console.warn("filterSearchResults: Some elements in 'unwantedDomains' were not strings and were ignored.");
    }
  }

  let validSkipKeywords: string[];
  if (!Array.isArray(skipKeywords)) {
    console.warn("filterSearchResults: Input 'skipKeywords' is not an array. Using empty list.", skipKeywords);
    validSkipKeywords = []; // Use a default empty array
  } else {
     // Ensure all elements are strings
    validSkipKeywords = skipKeywords.filter((k): k is string => typeof k === 'string');
     if (validSkipKeywords.length !== skipKeywords.length) {
        console.warn("filterSearchResults: Some elements in 'skipKeywords' were not strings and were ignored.");
    }
  }


  const filteredResults = validResults.filter((result: SearchResult | any) => { // Allow 'any' temporarily for robustness inside filter
    try {
      // Basic validation of the result object structure at runtime
      if (!result || typeof result !== 'object' || result === null) {
        console.warn("filterSearchResults: Skipping invalid result item (not an object):", result);
        return false; // Skip this result if it's not a valid object
      }

      // Check specifically for the 'link' property and its type
      if (typeof result.link !== 'string' || !result.link) {
         // console.warn("filterSearchResults: Skipping result with invalid or missing 'link':", result); // Less verbose
        return false; // Skip if link is not a non-empty string
      }

      // Use optional chaining and nullish coalescing for safer access
      const link = result.link.toLowerCase();
      const title = (typeof result.title === 'string' ? result.title.toLowerCase() : ""); // Ensure title is string or fallback

      // Check against unwanted domains
      const hasUnwantedDomain = validUnwantedDomains.some(domain => {
        try {
          // Ensure domain is a string before using .toLowerCase()
          return typeof domain === 'string' && link.includes(domain.toLowerCase());
        } catch (domainError: unknown) { // Catch as unknown
          console.error("Error checking domain:", domainError instanceof Error ? domainError.message : domainError, "Domain:", domain, "Link:", link);
          return false; // Don't filter out if there's an error with the domain check
        }
      });

      if (hasUnwantedDomain) {
        return false; // Early exit if unwanted domain found
      }

      // Check against skip keywords using RegExp
      const hasSkipKeyword = validSkipKeywords.some(keyword => {
        try {
           // Ensure keyword is a string before creating RegExp
           if (typeof keyword !== 'string') return false;
          // Create RegExp safely
          return new RegExp(keyword, "i").test(title);
        } catch (regexError: unknown) { // Catch as unknown
          console.error("Error creating or testing regular expression:", regexError instanceof Error ? regexError.message : regexError, "Keyword:", keyword, "Title:", title);
          return false; // Don't skip if there's an error with the regex itself
        }
      });

      // Keep the result only if it has NEITHER an unwanted domain NOR a skip keyword
      return !hasSkipKeyword; // Already returned false if hasUnwantedDomain was true

    } catch (filterError: unknown) { // Catch outer errors as unknown
      console.error("Error filtering search result item:", filterError instanceof Error ? filterError.message : filterError, "Result:", result);
      return false; // Exclude the result if any unexpected error occurs during its processing
    }
  });

  // Handle the case where filtering removed everything
  // Ensure validResults has at least one item before accessing [0]
  if (filteredResults.length === 0 && validResults.length > 0) {
    // Check if the first result is actually valid enough to return
    const firstResult = validResults[0];
    if (firstResult && typeof firstResult === 'object' && typeof firstResult.link === 'string') {
       return [firstResult]; // Return the first *original* result if it's minimally valid
    } else {
        console.warn("filterSearchResults: Filtering removed all results, and the first original result was invalid.");
        return []; // Return empty if the first original wasn't valid either
    }
  }

  return filteredResults;
}