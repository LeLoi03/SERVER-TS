// src/services/googleSearch.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import axios, { AxiosError, AxiosResponse } from "axios";
import { ApiKeyManager } from './apiKey.manager';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { GoogleSearchResult, GoogleCSEApiResponse, GoogleSearchError } from '../types/crawl.types';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Service responsible for interacting with the Google Custom Search API.
 * It handles search queries, API key rotation, retries for transient errors,
 * and parsing of search results.
 */
@singleton()
export class GoogleSearchService {
    private readonly serviceBaseLogger: Logger;
    private readonly cseId: string;
    private readonly maxRetries: number;
    private readonly retryDelay: number;

    /**
     * Constructs an instance of GoogleSearchService.
     * @param {ApiKeyManager} apiKeyManager - Manages Google Custom Search API keys.
     * @param {ConfigService} configService - Provides application configuration.
     * @param {LoggingService} loggingService - Provides logging capabilities.
     * @throws {Error} If `GOOGLE_CSE_ID` is missing in the configuration.
     */
    constructor(
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'GoogleSearchServiceBase' });

        const cseIdFromConfig = this.configService.config.GOOGLE_CSE_ID;
        if (!cseIdFromConfig) {
             const errorMsg = "Critical: Google CSE ID (GOOGLE_CSE_ID) is missing in configuration. Google Search will not function.";
             this.serviceBaseLogger.fatal({ event: 'google_search_init_config_error' }, errorMsg);
             throw new Error(errorMsg);
        }
        this.cseId = cseIdFromConfig;

        this.maxRetries = this.configService.config.MAX_SEARCH_RETRIES;
        this.retryDelay = this.configService.config.RETRY_DELAY_MS;
        this.serviceBaseLogger.info(
            { event: 'google_search_init_success', cseId: this.cseId, maxRetries: this.maxRetries, retryDelayMs: this.retryDelay },
            "GoogleSearchService initialized with CSE ID and retry configurations."
        );
    }

    /**
     * Helper method to create a child logger for specific methods, inheriting from a parent logger if provided.
     * @param {Logger | undefined} parentLogger - An optional parent logger.
     * @param {string} methodName - The name of the method for logger context.
     * @param {object} [additionalContext] - Optional additional context to bind to the logger.
     * @returns {Logger} A new logger instance with bound context.
     */
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GoogleSearchService.${methodName}`, ...additionalContext });
    }

    /**
     * Performs a Google Custom Search for a given query, handling API key rotation,
     * retries, and various error conditions including quota limits.
     *
     * @param {string} searchQuery - The query string to search for.
     * @param {Logger} [parentLogger] - An optional parent logger for contextual logging.
     * @returns {Promise<GoogleSearchResult[]>} A Promise that resolves with an array of structured search results.
     * @throws {GoogleSearchError} If the search ultimately fails after all retries or due to critical configuration issues.
     */
    async search(searchQuery: string, parentLogger?: Logger): Promise<GoogleSearchResult[]> {
        const logger = this.getMethodLogger(parentLogger, 'search', { searchQuery });

        logger.info({ event: 'search_attempt_start' }, `Starting Google Search for query: "${searchQuery}"`);
        let lastSearchError: GoogleSearchError | null = null; // Store the last encountered error

        // Loop for retries + initial attempt
        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            const attemptContext = { attempt, maxAttempts: this.maxRetries + 1 };
            logger.debug({ ...attemptContext, event: 'search_attempt_current_status' }, `Current attempt ${attempt}/${this.maxRetries + 1}.`);

            // Early exit if all API keys are globally exhausted
            if (this.apiKeyManager.areAllKeysExhausted(logger)) {
                const message = `All Google Search API keys exhausted. Cannot proceed with search.`;
                logger.error({ ...attemptContext, event: 'search_skip_all_keys_exhausted' }, message);
                lastSearchError = new GoogleSearchError(message, { query: searchQuery, reason: 'all_keys_exhausted' });
                break; // Exit retry loop
            }

            // Get the next available API key (thread-safe operation)
            const apiKey = await this.apiKeyManager.getNextKey(logger);
            if (!apiKey) {
                const message = `Failed to get a valid Google Search API key for attempt ${attempt}.`;
                logger.error({ ...attemptContext, event: 'search_skip_no_key' }, message);
                lastSearchError = new GoogleSearchError(message, { query: searchQuery, reason: 'no_key_available' });
                break; // Exit retry loop
            }

            const keyIndex = this.apiKeyManager.getCurrentKeyIndex();
            const keyPrefix = apiKey.substring(0, 5) + '...'; // Log only prefix for security
            logger.info({ ...attemptContext, keyIndex, keyPrefix, event: 'search_attempt_executing' }, `Executing Google Search attempt ${attempt} with key at index ${keyIndex}.`);

            // Construct the search URL
            // `num=8` requests 8 results per query, which is the maximum allowed by Google CSE API for a single request.
            const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${this.cseId}&q=${encodeURIComponent(searchQuery)}&num=8`;
            logger.trace({ searchUrl, event: 'google_api_request_url' }, 'Constructed Google Custom Search API request URL.');

            try {
                const response: AxiosResponse<GoogleCSEApiResponse> = await axios.get(searchUrl, {
                    timeout: 15000 // 15 seconds timeout for the API call
                });

                // Check for Google API specific errors within the response body (200 OK but with error payload)
                if (response.data?.error) {
                    const errorDetails = response.data.error;
                    const message = `Google API responded with error in body (HTTP ${response.status}): ${errorDetails.message} (Code: ${errorDetails.code})`;
                    const errorPayload = {
                        keyPrefix,
                        googleErrorCode: errorDetails.code,
                        googleErrors: errorDetails.errors,
                        isGoogleBodyError: true,
                        httpStatus: response.status,
                        responseBody: response.data // Include full response for debugging
                    };
                    logger.warn({ ...errorPayload, ...attemptContext, event: 'search_attempt_google_api_error_in_body' }, message);
                    // Throw a custom error to be caught by the outer catch block for consistent handling
                    throw new GoogleSearchError(message, errorPayload);
                }

                const results: GoogleSearchResult[] = [];
                // Process valid search items if available
                if (response.data?.items?.length) {
                    response.data.items.forEach(item => {
                        if (item?.link && item?.title) {
                            results.push({ title: item.title, link: item.link });
                        } else {
                            // Log items that are malformed but don't stop the process
                            logger.warn({ itemReceived: item, ...attemptContext, event: 'search_result_item_malformed' }, `Received search result item with missing title or link, skipping item.`);
                        }
                    });
                    logger.info({
                        keyIndex,
                        keyPrefix,
                        usageOnKey: this.apiKeyManager.getCurrentKeyUsage(logger),
                        ...attemptContext,
                        resultsCount: results.length,
                        event: 'search_attempt_success'
                    }, `Google Search successful. Found ${results.length} valid results.`);
                    return results; // Return successfully found results
                } else {
                    logger.debug({ keyPrefix, ...attemptContext, event: 'search_attempt_no_items' }, "Google Search response returned no valid 'items' array or it was empty. Returning empty results.");
                    return []; // Return empty array if no search items found
                }

            } catch (error: unknown) { // Catch as unknown for all potential errors
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                lastSearchError = error instanceof GoogleSearchError ? error : new GoogleSearchError(errorMessage, { originalError: errorMessage, stack: errorStack, query: searchQuery }); // Ensure it's a GoogleSearchError

                let currentAttemptErrorDetails: object = {};
                let eventType = 'search_attempt_failed_unexpected';

                if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<GoogleCSEApiResponse>;
                    currentAttemptErrorDetails = {
                        axiosCode: axiosError.code,
                        httpStatus: axiosError.response?.status,
                        statusText: axiosError.response?.statusText,
                        responseBody: axiosError.response?.data // Include response body for Axios errors
                    };

                    if (axiosError.response) { // HTTP error from server
                        eventType = 'search_attempt_failed_http_error';
                        if (axiosError.response.data?.error) { // Google API error within HTTP response body
                            eventType = 'search_attempt_failed_google_in_http_error';
                            const googleError = axiosError.response.data.error;
                            currentAttemptErrorDetails = {
                                ...currentAttemptErrorDetails,
                                googleErrorCode: googleError.code,
                                googleErrors: googleError.errors,
                                isGoogleBodyError: true,
                            };
                            lastSearchError = new GoogleSearchError(`Google API Error (HTTP ${axiosError.response.status}): ${googleError.message}`, { ...currentAttemptErrorDetails, query: searchQuery });
                        } else {
                            lastSearchError = new GoogleSearchError(`Google API request failed with HTTP status ${axiosError.response.status}: ${axiosError.message}`, { ...currentAttemptErrorDetails, query: searchQuery });
                        }
                    } else if (axiosError.request) { // Request made but no response (network error, timeout)
                        eventType = 'search_attempt_failed_network_timeout';
                        lastSearchError = new GoogleSearchError(`Google API request failed: No response received (Code: ${axiosError.code || 'N/A'}). Message: "${errorMessage}"`, { ...currentAttemptErrorDetails, query: searchQuery });
                    } else { // Error setting up the request
                        eventType = 'search_attempt_failed_request_setup';
                        lastSearchError = new GoogleSearchError(`Error setting up Google API request: "${errorMessage}"`, { ...currentAttemptErrorDetails, query: searchQuery });
                    }
                } else {
                    // Non-Axios, non-GoogleSearchError (e.g., custom error, JS error)
                    lastSearchError = new GoogleSearchError(`Unexpected error during Google search: "${errorMessage}"`, { originalError: errorMessage, stack: errorStack, query: searchQuery });
                }

                logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: lastSearchError.message, details: lastSearchError.details, event: eventType }, `Google Search attempt failed.`);

                // Determine if the error is a quota/rate limit error
                const status = lastSearchError.details?.httpStatus || lastSearchError.details?.axiosCode || 'Unknown';
                const googleErrorCode = lastSearchError.details?.googleErrorCode;
                const isQuotaError = status === 429 || status === 403 || googleErrorCode === 429 || googleErrorCode === 403 ||
                                     lastSearchError.details?.googleErrors?.some((e: any) =>
                                         e.reason === 'rateLimitExceeded' || e.reason === 'dailyLimitExceeded' || e.reason === 'userRateLimitExceeded' || e.reason === 'quotaExceeded' || e.reason === 'forbidden'
                                     ) || (typeof lastSearchError.message === 'string' && (lastSearchError.message.toLowerCase().includes('quota') || lastSearchError.message.toLowerCase().includes('limit')));

                logger.debug({ ...attemptContext, isQuotaError, event: 'search_error_type_check' }, `Quota error detected: ${isQuotaError}.`);

                if (isQuotaError && attempt <= this.maxRetries) {
                    logger.warn({ ...attemptContext, keyIndex, keyPrefix, event: 'search_quota_error_detected_forcing_rotation' }, `Quota/Rate limit error detected. Forcing API key rotation for key index ${keyIndex}.`);
                    const rotated = await this.apiKeyManager.forceRotate(logger); // forceRotate is thread-safe
                    if (!rotated) {
                        logger.error({ ...attemptContext, event: 'search_key_rotation_failed_after_quota' }, "Failed to rotate key after quota error (all keys likely exhausted). Stopping retries for this query.");
                        break; // Break the retry loop if rotation failed
                    }
                }

                // Decide whether to retry or fail
                if (attempt > this.maxRetries) {
                    logger.error({ finalAttempt: attempt, keyPrefix, err: lastSearchError.message, details: lastSearchError.details, event: 'search_failed_max_retries' }, `Google Search failed after maximum retries for query "${searchQuery}".`);
                    // The `lastSearchError` will be thrown at the end of the loop.
                } else if (!this.apiKeyManager.areAllKeysExhausted(logger)) { // Only retry if not all keys are exhausted
                     if (!isQuotaError) {
                        // If not a quota error, wait for the `retryDelay`
                        logger.info({ ...attemptContext, delaySeconds: this.retryDelay / 1000, event: 'search_retry_delay_start' }, `Waiting ${this.retryDelay / 1000}s before retry attempt ${attempt + 1}...`);
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                     } else {
                         // If it was a quota error, we already rotated the key, so retry immediately with the new key.
                         logger.info({ ...attemptContext, event: 'search_retry_after_quota_rotation' }, `Quota error handled by key rotation. Proceeding to attempt ${attempt + 1} immediately with new key.`);
                     }
                } else {
                     // All keys are exhausted and no further retries are possible
                     logger.warn({ ...attemptContext, event: 'search_retry_skipped_all_keys_exhausted' }, "Skipping wait/retry as all keys are exhausted. No more attempts possible.");
                     break; // Exit retry loop
                }
            }
        }

        // After the loop, if `lastSearchError` is set, it means all attempts failed.
        if (lastSearchError) {
             logger.error({
                err: lastSearchError.message,
                details: lastSearchError.details,
                searchQuery,
                event: 'search_ultimately_failed'
            }, `Google Search ultimately failed for query: "${searchQuery}".`);
            throw lastSearchError; // Re-throw the last captured error
        }

        // This path should ideally not be reached if `lastSearchError` is always set on failure.
        // It acts as a final safeguard if all attempts complete without explicit error capture.
        const finalError = new GoogleSearchError(`Google Search ultimately failed for query: "${searchQuery}" without a specific error captured by internal logic.`, { query: searchQuery, reason: 'unknown_failure_post_loop_fallback' });
        logger.error({
            err: finalError.message,
            details: finalError.details,
            searchQuery,
            event: 'search_ultimately_failed_unknown_post_loop'
        }, `Google Search ultimately failed for query "${searchQuery}" (post-loop fallback).`);
        throw finalError;
    }
}