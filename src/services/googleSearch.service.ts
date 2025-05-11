// src/services/googleSearch.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import axios, { AxiosError, AxiosResponse } from "axios";
import { ApiKeyManager } from './apiKey.manager';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { GoogleSearchResult, GoogleCSEApiResponse, GoogleSearchError } from '../types/crawl.types';

@singleton()
export class GoogleSearchService {
    private readonly serviceBaseLogger: Logger;
    private readonly cseId: string;
    private readonly maxRetries: number;
    private readonly retryDelay: number;

    constructor(
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'GoogleSearchServiceBase' });

        const cseIdFromConfig = this.configService.config.GOOGLE_CSE_ID;
        if (!cseIdFromConfig) {
             const errorMsg = "Google CSE ID is missing in configuration.";
             this.serviceBaseLogger.error({ event: 'init_config_error' }, errorMsg);
             throw new Error(errorMsg);
        }
        this.cseId = cseIdFromConfig;

        this.maxRetries = this.configService.config.MAX_SEARCH_RETRIES;
        this.retryDelay = this.configService.config.RETRY_DELAY_MS;
        this.serviceBaseLogger.info({ event: 'init_success' }, "GoogleSearchService initialized.");
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GoogleSearchService.${methodName}`, ...additionalContext });
    }

    async search(searchQuery: string, parentLogger?: Logger): Promise<GoogleSearchResult[]> {
        const logger = this.getMethodLogger(parentLogger, 'search', { searchQuery });

        logger.debug("Performing Google Search with context.");
        let lastSearchError: any = null;

        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            const attemptContext = { attempt, maxAttempts: this.maxRetries + 1 };

            // Truyền logger (đã có context search) xuống ApiKeyManager để nó có thể log cùng context
            if (this.apiKeyManager.areAllKeysExhausted(logger)) {
                logger.warn({ ...attemptContext, event: 'search_skip_all_keys_exhausted' }, `Skipping search attempt - All API keys exhausted.`);
                lastSearchError = new GoogleSearchError("All API keys exhausted during search attempts.", { query: searchQuery, reason: 'all_keys_exhausted' });
                break;
            }

            const apiKey = await this.apiKeyManager.getNextKey(logger); // Truyền logger
            if (!apiKey) {
                // ApiKeyManager.getNextKey sẽ log chi tiết lý do không lấy được key
                logger.warn({ ...attemptContext, event: 'search_skip_no_key' }, `Skipping search attempt - Failed to get valid API key.`);
                lastSearchError = new GoogleSearchError("Failed to get API key for search attempt.", { query: searchQuery, reason: 'no_key_available' });
                break;
            }

            const keyIndex = this.apiKeyManager.getCurrentKeyIndex(); // 0-based
            const keyPrefix = apiKey.substring(0, 5);
            logger.info({ ...attemptContext, keyIndex, keyPrefix, event: 'search_attempt_start' }, `Attempting Google Search`);

            const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${this.cseId}&q=${encodeURIComponent(searchQuery)}&num=8`;
            logger.trace({ searchUrl }, 'Executing Google Custom Search request');

            try {
                const response: AxiosResponse<GoogleCSEApiResponse> = await axios.get(searchUrl, {
                    timeout: 15000
                });

                if (response.data?.error) {
                    const errorDetails = response.data.error;
                    const errorMessage = `Google API Error (in response body): ${errorDetails.message} (Code: ${errorDetails.code})`;
                    const errorPayload = {
                        keyPrefix,
                        googleErrorCode: errorDetails.code,
                        googleErrors: errorDetails.errors,
                        isGoogleBodyError: true,
                        status: response.status
                    };
                    // Log này là một phần của một attempt, nên có `event` để phân biệt rõ hơn
                    logger.warn({ ...errorPayload, ...attemptContext, event: 'search_attempt_google_api_error_in_body' }, errorMessage);
                    throw new GoogleSearchError(errorMessage, errorPayload);
                }

                const results: GoogleSearchResult[] = [];
                if (response.data?.items?.length) {
                    response.data.items.forEach(item => {
                        if (item?.link && item?.title) {
                            results.push({ title: item.title, link: item.link });
                        } else {
                            logger.warn({ itemReceived: item, ...attemptContext, event: 'search_result_item_malformed' }, "Received search result item with missing title or link, skipping.");
                        }
                    });
                    logger.info({
                        keyIndex, keyPrefix,
                        usageOnKey: this.apiKeyManager.getCurrentKeyUsage(logger), // Truyền logger
                        ...attemptContext, resultsCount: results.length,
                        event: 'search_attempt_success' // Phù hợp với handleSearchSuccess
                    }, `Google Search successful`);
                    return results;
                } else {
                    logger.debug({ keyPrefix, ...attemptContext, event: 'search_attempt_no_items' }, "No valid 'items' array found in Google Search response.");
                    return [];
                }

            } catch (error: any) {
                lastSearchError = error;
                let errorMessage = `Failed Google Search: ${error.message}`;
                let errorDetails: any = { originalErrorMsg: error.message }; // Sử dụng msg để tránh object lớn

                if (error instanceof GoogleSearchError) {
                    errorMessage = error.message; // Giữ nguyên message từ GoogleSearchError
                    errorDetails = { ...error.details }; // Giữ nguyên details
                    // Log này đã bao gồm thông tin lỗi cụ thể từ Google
                    logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, event: 'search_attempt_failed_google_processed' }, `Google Search attempt failed (Pre-processed Google Error)`);
                } else if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<GoogleCSEApiResponse>;
                    errorDetails.axiosCode = axiosError.code;
                    let eventType = 'search_attempt_failed_axios_unknown';

                    if (axiosError.response) {
                        errorDetails.status = axiosError.response.status;
                        errorDetails.statusText = axiosError.response.statusText;
                        errorMessage = `Google API request failed with status ${errorDetails.status}`;
                        eventType = 'search_attempt_failed_http_error';
                        if (axiosError.response.data?.error) {
                            const googleError = axiosError.response.data.error;
                            errorMessage = `Google API Error ${errorDetails.status}: ${googleError.message}`;
                            errorDetails.googleErrorCode = googleError.code;
                            errorDetails.googleErrors = googleError.errors;
                            errorDetails.isGoogleBodyError = true; // Vẫn là lỗi từ Google nhưng qua HTTP error
                            eventType = 'search_attempt_failed_google_in_http_error';
                        }
                        logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, event: eventType }, `Google Search attempt failed (HTTP Error Status)`);
                    } else if (axiosError.request) {
                        errorMessage = `Google API request failed: No response received (Code: ${axiosError.code || 'N/A'})`;
                        errorDetails.status = 'Network/Timeout';
                        eventType = 'search_attempt_failed_network_timeout';
                        logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, event: eventType }, `Google Search attempt failed (Network/Timeout)`);
                    } else {
                        errorMessage = `Error setting up Google API request: ${axiosError.message}`;
                        eventType = 'search_attempt_failed_request_setup';
                        logger.error({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, event: eventType }, `Google Search attempt failed (Request Setup Error)`);
                    }
                    lastSearchError = new GoogleSearchError(errorMessage, errorDetails);
                } else {
                    // Lỗi không mong muốn
                    errorMessage = `Unexpected error during Google search processing: ${error.message}`;
                    if (error.stack) errorDetails.stackPreview = error.stack.substring(0, 200);
                    logger.error({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, event: 'search_attempt_failed_unexpected' }, `Google Search attempt failed (Unexpected Error)`);
                    lastSearchError = new GoogleSearchError(errorMessage, { originalError: error.message, stack: error.stack });
                }

                // Xác định lỗi quota/limit để force rotate
                const status = lastSearchError.details?.status || lastSearchError.details?.axiosCode || 'Unknown';
                const googleErrorCode = lastSearchError.details?.googleErrorCode || 'N/A';
                const isQuotaError = status === 429 || googleErrorCode === 429 || status === 403 || googleErrorCode === 403
                                   || lastSearchError.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'dailyLimitExceeded' || e.reason === 'userRateLimitExceeded' || e.reason === 'quotaExceeded' || e.reason === 'forbidden')
                                   || (typeof lastSearchError.message === 'string' && (lastSearchError.message.toLowerCase().includes('quota') || lastSearchError.message.toLowerCase().includes('limit')));

                logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: lastSearchError.message, status, googleErrorCode, isQuotaError, event: 'search_attempt_failure_summary' }, `Handling failure for attempt`);

                if (isQuotaError && attempt <= this.maxRetries) {
                    logger.warn({ ...attemptContext, keyIndex, keyPrefix, event: 'search_quota_error_detected' }, `Quota/Rate limit error detected. Forcing API key rotation.`);
                    const rotated = await this.apiKeyManager.forceRotate(logger); // Truyền logger
                    if (!rotated) {
                        logger.error({ ...attemptContext, event: 'search_key_rotation_failed_after_quota' }, "Failed to rotate key after quota error (all keys likely exhausted), stopping retries for this query.");
                        break; // Dừng retry nếu không xoay key được
                    }
                    // Không cần break ở đây, vòng lặp sẽ tiếp tục với key mới (nếu có)
                }

                if (attempt > this.maxRetries) {
                    logger.error({ finalAttempt: attempt, keyPrefix, err: lastSearchError.message, status, googleErrorCode, event: 'search_failed_max_retries' }, `Google Search failed after maximum retries.`);
                } else if (!this.apiKeyManager.areAllKeysExhausted(logger)) {
                     if (!isQuotaError) { // Chỉ delay nếu không phải lỗi quota (vì lỗi quota đã được xử lý bằng cách xoay key)
                        logger.info({ ...attemptContext, delaySeconds: this.retryDelay / 1000, event: 'search_retry_delay_start' }, `Waiting ${this.retryDelay / 1000}s before retry attempt ${attempt + 1}...`);
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                     } else {
                         logger.info({ ...attemptContext, event: 'search_retry_after_quota_rotation' }, `Quota error handled by key rotation, proceeding to attempt ${attempt + 1} immediately if keys available.`);
                     }
                } else {
                     logger.warn({ ...attemptContext, event: 'search_retry_skipped_all_keys_exhausted' }, "Skipping wait/retry as all keys are exhausted.");
                }
            }
        }

        // Nếu lastSearchError vẫn còn sau vòng lặp, nghĩa là search thất bại cuối cùng
        if (lastSearchError) {
             logger.error({
                err: lastSearchError?.message || 'Unknown search error',
                details: lastSearchError?.details,
                searchQuery,
                event: 'search_ultimately_failed' // Phù hợp với handleSearchFailure
            }, "Google Search ultimately failed for this query.");
            throw lastSearchError;
        }
        // Trường hợp không có lỗi nhưng cũng không có kết quả (ví dụ: break sớm do all keys exhausted)
        // Sẽ cần một lỗi chung hơn nếu lastSearchError là null ở đây mà không return results
        const finalError = new GoogleSearchError(`Google Search ultimately failed for query: ${searchQuery} without specific error captured.`, { query: searchQuery, reason: 'unknown_failure_post_loop' });
        logger.error({
            err: finalError.message,
            details: finalError.details,
            searchQuery,
            event: 'search_ultimately_failed_unknown_post_loop'
        }, "Google Search ultimately failed for this query (post-loop, no prior error).");
        throw finalError;
    }
}