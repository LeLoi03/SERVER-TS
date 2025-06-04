// src/googleSearch.ts

import axios, { AxiosError, AxiosResponse } from 'axios'; // Import AxiosResponse
import { retryAsync, logger as baseLogger, RetryOptions } from './utils'; // <<<< IMPORT RetryOptions if defined in utils
import { ConfigService } from '../config/config.service';

interface GoogleSearchResult {
    imageLink: string | null;
    contextLink: string | null;
}

// If RetryOptions is not exported from './utils', define it here based on what retryAsync expects
// For example:
// interface RetryOptions {
//   retries: number;
//   minTimeout: number;
//   factor: number;
//   // maxTimeout?: number;
//   // randomize?: boolean;
// }


export const fetchGoogleImage = async (
    title: string | null,
    formattedISSN: string,
    apiKey: string | null,
    logger: typeof baseLogger,
    configService: ConfigService
): Promise<GoogleSearchResult> => {
    const childLogger = logger.child({ function: 'fetchGoogleImage', issn: formattedISSN, title: title || 'N/A' });
    childLogger.info({ event: 'fetch_google_image_start' }, 'Starting Google image search.');

    const cseId = configService.googleSearchConfig.cseId;

    // --- Adjust retryOptions to match the RetryOptions type ---
    const retryOptions: RetryOptions = {
        retries: configService.journalRetryOptions.retries,
        minTimeout: configService.journalRetryOptions.minTimeout, // Map 'delay' to 'minTimeout'
        factor: configService.journalRetryOptions.factor || 2, // Use a sensible default or add a specific config for search retry factor
        // Add other properties if needed by your RetryOptions, e.g.:
        // maxTimeout: configService.config.MAX_RETRY_DELAY_MS || 60000, // Example
    };

    if (!apiKey || !cseId) {
        childLogger.error(
            {
                event: 'fetch_google_image_skip_missing_creds',
                hasApiKey: !!apiKey,
                hasCseId: !!cseId
            },
            'Missing API Key or CSE ID. Cannot proceed with Google Search.'
        );
        return { imageLink: null, contextLink: null };
    }

    const apiKeyHint = apiKey ? `${apiKey.substring(0, 5)}...` : 'N/A';
    const encodedQuery = encodeURIComponent(`${title || ''} ISSN "${formattedISSN}"`.trim());
    const url = `https://www.googleapis.com/customsearch/v1?q=${encodedQuery}&key=${apiKey}&cx=${cseId}&searchType=image&num=1`;
    const displayUrl = url.replace(/key=[^&]+/, 'key=REDACTED');

    childLogger.debug({ event: 'fetch_google_image_url', url: displayUrl }, 'Constructed Google Search API URL.');

    try {
        childLogger.debug({ event: 'fetch_google_image_attempt_start', retryOptions }, 'Attempting Google API request with retries.');

        // --- Specify the expected return type for retryAsync ---
        const response = await retryAsync<AxiosResponse<any>>(async (attempt) => { // <<<< Specify AxiosResponse<any>
            const attemptLogger = childLogger.child({ attempt });
            attemptLogger.debug({ event: 'google_api_request_start' }, `Attempt ${attempt}: Sending GET request.`);

            try {
                // axios.get already returns Promise<AxiosResponse<any>>
                const res = await axios.get(url, { timeout: 15000 });

                if (res.data && res.data.error) {
                    const googleError = res.data.error;
                    const code = googleError.code || 'N/A';
                    const message = googleError.message || 'Unknown Google API error';
                    const reason = googleError.errors?.[0]?.reason || 'unknown';
                    attemptLogger.warn({ event: 'google_api_structured_error', keyHint: apiKeyHint, googleError: { code, message, reason } },
                        `Attempt ${attempt}: Google API returned error structure - Code: ${code}, Reason: ${reason}, Message: ${message}`);
                    const error = new Error(`Google API Error (${code} - ${reason}): ${message}`) as any;
                    error.statusCode = code;
                    error.reason = reason;
                    throw error;
                }

                if (res.status < 200 || res.status >= 300) {
                    attemptLogger.warn({ event: 'google_api_http_error', keyHint: apiKeyHint, status: res.status, statusText: res.statusText },
                        `Attempt ${attempt}: Google API returned non-2xx status: ${res.status} ${res.statusText}`);
                    const error = new Error(`Google API returned non-2xx status: ${res.status}`) as any;
                    error.statusCode = res.status;
                    throw error;
                }

                attemptLogger.debug({ event: 'google_api_request_success', status: res.status }, `Attempt ${attempt}: Request successful.`);
                return res; // This is AxiosResponse<any>

            } catch (axiosError: any) {
                 if (axios.isAxiosError(axiosError)) {
                     const status = axiosError.response?.status;
                     const data = axiosError.response?.data;
                     attemptLogger.warn({
                         event: 'google_api_axios_error',
                         keyHint: apiKeyHint,
                         status: status || 'N/A',
                         code: axiosError.code,
                         message: axiosError.message,
                         responseData: data
                     }, `Attempt ${attempt}: Axios request failed - Status: ${status || 'N/A'}, Code: ${axiosError.code}, Message: ${axiosError.message}`);
                      if(status) (axiosError as any).statusCode = status;
                 } else {
                     attemptLogger.warn({ event: 'google_api_unknown_error', keyHint: apiKeyHint, err: axiosError },
                         `Attempt ${attempt}: Unknown error during API request.`);
                 }
                 throw axiosError;
            }
        }, retryOptions, childLogger);

        // Now 'response' is correctly typed as AxiosResponse<any>
        childLogger.info({ event: 'fetch_google_image_api_success', status: response.status }, 'Google API request successful after retries.');
        const data: any = response.data; // response.data will be 'any' because of AxiosResponse<any>

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
        const statusCode = error.statusCode || error.response?.status || 'N/A';
        childLogger.error({
            err: error,
            event: 'fetch_google_image_failed_after_retries',
            keyHint: apiKeyHint,
            statusCode: statusCode
        }, `Failed to fetch image after all retries. Status Code: ${statusCode}.`);
        throw error;
    }
};