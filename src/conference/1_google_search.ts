// src/utils/google_search.ts
import axios, { AxiosError, AxiosResponse } from "axios";
import { logger } from "./11_utils"; // Assuming logger.ts is in the same or parent directory
import { GoogleCSEApiResponse, GoogleSearchResult, GoogleSearchError } from "./types";


// --------------------- Google Custom Search API Function ---------------------
export async function searchGoogleCSE(apiKey: string, cseId: string, query: string): Promise<GoogleSearchResult[]> {
    console.log("Gọi Search") // Keep if you want to see each API call clearly, consider logger.debug/trace in TS

    const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cseId}&q=${encodeURIComponent(query)}&num=8`; // Always encode query
    // logger.debug({ searchUrl }, 'Executing Google Custom Search request');

    try {
        const response: AxiosResponse<GoogleCSEApiResponse> = await axios.get(searchUrl, {
            timeout: 15000 // 15 seconds
        });

        // Check for Google's *own* error format IN the response body (even with 2xx status)
        if (response.data && response.data.error) {
            const errorDetails = response.data.error;
            const errorMessage = `Google API Error (in response body): ${errorDetails.message} (Code: ${errorDetails.code})`;
            // logger.error({ keyPrefix: apiKey.substring(0, 5), details: errorDetails }, errorMessage);
            // Throw custom error for easier identification at the calling point
            throw new GoogleSearchError(errorMessage, {
                googleErrorCode: errorDetails.code,
                googleErrors: errorDetails.errors,
                isGoogleBodyError: true, // Flag to know error from body
                status: response.status // Might still be 200 but body reports error
            });
        }

        // Status not 2xx (Axios usually throws error for >299, but extra check for safety)
        // However, axios catch block will handle most of these cases. This line might be redundant.
        // if (response.status < 200 || response.status >= 300) { ... }

        // Process successful results
        const results: GoogleSearchResult[] = [];
        if (response.data?.items?.length) { // More robust check
            response.data.items.forEach(item => {
                // Add checks in case item is missing link or title
                if (item?.link && item?.title) {
                    results.push({
                        title: item.title,
                        link: item.link
                    });
                } else {
                    logger.warn({ itemReceived: item }, "Received search result item with missing title or link, skipping.");
                }
            });
            // logger.debug({ count: results.length }, `Google Search returned results`);
        } else {
            // logger.debug("No valid 'items' array found in Google Search response.");
        }

        return results;

    } catch (error: any) { // Type 'any' for the catch error initially, refine if possible
        let errorMessage = `Failed Google Search: ${error.message}`;
        let errorDetails: any = { originalError: error }; // Keep 'any' for now, refine later

        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<GoogleCSEApiResponse>; // Cast to AxiosError for better type information
            errorDetails.axiosCode = axiosError.code; // e.g., 'ECONNABORTED' for timeout
            if (axiosError.response) {
                // Error with response from server (4xx, 5xx)
                errorDetails.status = axiosError.response.status;
                errorDetails.statusText = axiosError.response.statusText;
                errorMessage = `Google API request failed with status ${errorDetails.status}`;
                if (axiosError.response.data?.error) {
                    // Specific error from Google API in HTTP error response body
                    const googleError = axiosError.response.data.error;
                    errorMessage = `Google API Error ${errorDetails.status}: ${googleError.message}`;
                    errorDetails.googleErrorCode = googleError.code;
                    errorDetails.googleErrors = googleError.errors;
                    errorDetails.isGoogleBodyError = true; // Still error from Google
                }
                // logger.error({ keyPrefix: apiKey.substring(0, 5), ...errorDetails }, errorMessage);
            } else if (axiosError.request) {
                // Request sent but no response received (network error, timeout)
                errorMessage = `Google API request failed: No response received (Code: ${axiosError.code})`;
                // logger.error({ keyPrefix: apiKey.substring(0, 5), ...errorDetails }, errorMessage);
            } else {
                // Error setting up the request
                errorMessage = `Error setting up Google API request: ${axiosError.message}`;
                // logger.error({ keyPrefix: apiKey.substring(0, 5), ...errorDetails }, errorMessage);
            }
        } else if (error instanceof GoogleSearchError) {
            // Error already handled and re-thrown from try block above (error in 200 response body)
            // Just re-throw the error with existing info
            throw error;
        }
        else {
            // Other unexpected error, not Axios or known GoogleSearchError
            errorMessage = `Unexpected error during Google CSE processing: ${error.message}`;
            // logger.error({ keyPrefix: apiKey.substring(0, 5), ...errorDetails }, errorMessage);
        }

        // Throw custom error so calling function can easily access details
        // Important: attach status code if available
        throw new GoogleSearchError(errorMessage, errorDetails);
    }
}