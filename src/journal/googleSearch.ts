// src/googleSearch.ts

import axios, { AxiosError } from 'axios';
// Import the modified retryAsync and base logger type/instance
import { retryAsync, logger as baseLogger } from './utils';
import { RETRY_OPTIONS } from '../config';

interface GoogleSearchResult {
    imageLink: string | null;
    contextLink: string | null;
}

export const fetchGoogleImage = async (
    title: string | null,
    formattedISSN: string,
    apiKey: string | null,
    cseId: string | null,
    logger: typeof baseLogger // <-- Accept logger instance
): Promise<GoogleSearchResult> => {
    // Create a child logger specific to this function execution
    const childLogger = logger.child({ function: 'fetchGoogleImage', issn: formattedISSN, title: title || 'N/A' });

    childLogger.info({ event: 'fetch_google_image_start' }, 'Starting Google image search.');

    if (!apiKey || !cseId) {
        childLogger.error({ event: 'fetch_google_image_skip_missing_creds' }, 'Missing API Key or CSE ID.');
        // Return immediately as we cannot proceed
        return { imageLink: null, contextLink: null };
    }

    // Generate a hint for logging without exposing the full key
    const apiKeyHint = apiKey ? `${apiKey.substring(0, 5)}...` : 'N/A';
    const encodedQuery = encodeURIComponent(`${title || ''} ISSN "${formattedISSN}"`.trim()); // Ensure title doesn't add extra space if null
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodedQuery}&key=${apiKey}&cx=${cseId}&searchType=image&num=1`;
    const displayUrl = url.replace(/key=[^&]+/, 'key=REDACTED'); // For safer logging

    childLogger.debug({ event: 'fetch_google_image_url', url: displayUrl }, 'Constructed Google Search API URL.');

    try {
        childLogger.debug({ event: 'fetch_google_image_attempt_start', retryOptions: RETRY_OPTIONS }, 'Attempting Google API request with retries.');

        const response = await retryAsync(async (attempt) => {
            // Create logger for this specific attempt
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'google_api_request_start' }, `Attempt ${attempt}: Sending GET request.`);

            try {
                const res = await axios.get(url, { timeout: 15000 }); // Add a reasonable timeout

                // Check for Google's structured error first
                if (res.data && res.data.error) {
                    const googleError = res.data.error;
                    const code = googleError.code || 'N/A';
                    const message = googleError.message || 'Unknown Google API error';
                    const reason = googleError.errors?.[0]?.reason || 'unknown';
                    attemptLogger.warn({ event: 'google_api_structured_error', keyHint: apiKeyHint, googleError: { code, message, reason } },
                        `Attempt ${attempt}: Google API returned error structure - Code: ${code}, Reason: ${reason}, Message: ${message}`);
                    // Throw an error that includes status code if available, useful for caller
                    const error = new Error(`Google API Error (${code} - ${reason}): ${message}`) as any; // Cast to any to add properties
                    error.statusCode = code; // Add status code for easier checking later
                    error.reason = reason;
                    throw error;
                }

                // Check for non-2xx HTTP status (should be redundant if axios throws, but good practice)
                if (res.status < 200 || res.status >= 300) {
                    attemptLogger.warn({ event: 'google_api_http_error', keyHint: apiKeyHint, status: res.status, statusText: res.statusText },
                        `Attempt ${attempt}: Google API returned non-2xx status: ${res.status} ${res.statusText}`);
                    const error = new Error(`Google API returned non-2xx status: ${res.status}`) as any;
                    error.statusCode = res.status;
                    throw error;
                }

                attemptLogger.debug({ event: 'google_api_request_success', status: res.status }, `Attempt ${attempt}: Request successful.`);
                return res; // Return the successful response

            } catch (axiosError: any) {
                 // Handle Axios-specific errors (network, timeout, non-2xx status)
                 if (axios.isAxiosError(axiosError)) {
                     const status = axiosError.response?.status;
                     const data = axiosError.response?.data;
                     attemptLogger.warn({
                         event: 'google_api_axios_error',
                         keyHint: apiKeyHint,
                         status: status || 'N/A',
                         code: axiosError.code, // e.g., 'ECONNABORTED' for timeout
                         message: axiosError.message,
                         responseData: data // Log response data if available (might contain details)
                     }, `Attempt ${attempt}: Axios request failed - Status: ${status || 'N/A'}, Code: ${axiosError.code}, Message: ${axiosError.message}`);
                      // Add statusCode if available for the caller
                      if(status) (axiosError as any).statusCode = status;
                 } else {
                     // Handle unexpected errors during the request
                     attemptLogger.warn({ event: 'google_api_unknown_error', keyHint: apiKeyHint, err: axiosError },
                         `Attempt ${attempt}: Unknown error during API request.`);
                 }
                 // Re-throw the error for retryAsync to catch
                 throw axiosError;
            }
        }, RETRY_OPTIONS, childLogger); // Pass childLogger to retryAsync for its logs

        // If retryAsync succeeds:
        childLogger.info({ event: 'fetch_google_image_api_success', status: response.status }, 'Google API request successful after retries.');
        const data: any = response.data;

        if (data.items && data.items.length > 0) {
            const firstItem: any = data.items[0];
            const imageLink: string | undefined = firstItem.link;
            const contextLink: string | undefined = firstItem.image?.contextLink;
            childLogger.debug({ event: 'fetch_google_image_items_found', count: data.items.length, hasImage: !!imageLink, hasContext: !!contextLink }, 'Found items in response.');
            const result: GoogleSearchResult = { imageLink: imageLink || null, contextLink: contextLink || null };
             childLogger.info({ event: 'fetch_google_image_finish', success: true, hasImage: !!result.imageLink, hasContext: !!result.contextLink }, 'Finished Google image search successfully.');
             return result;
        } else {
            childLogger.warn({ event: 'fetch_google_image_no_items' }, 'No items found in Google API response.');
            const result: GoogleSearchResult = { imageLink: null, contextLink: null };
            childLogger.info({ event: 'fetch_google_image_finish', success: true, hasImage: false, hasContext: false }, 'Finished Google image search (no items found).');
            return result;
        }

    } catch (error: any) {
        // This catch block executes if retryAsync ultimately fails (throws its lastError)
        const statusCode = error.statusCode || error.response?.status || 'N/A'; // Extract status code if possible
        childLogger.error({
            err: error, // Log the full error
            event: 'fetch_google_image_failed_after_retries',
            keyHint: apiKeyHint,
            statusCode: statusCode
        }, `Failed to fetch image after all retries. Status Code: ${statusCode}.`);

        // IMPORTANT: Re-throw the error so the caller (performImageSearch) knows about the failure
        // and can potentially trigger API key rotation based on the error/statusCode.
        throw error;
    }
};