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
    private readonly serviceBaseLogger: Logger; // Logger cơ sở của service
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
             this.serviceBaseLogger.error(errorMsg); // Log bằng serviceBaseLogger
             throw new Error(errorMsg);
        }
        this.cseId = cseIdFromConfig;

        this.maxRetries = this.configService.config.MAX_SEARCH_RETRIES;
        this.retryDelay = this.configService.config.RETRY_DELAY_MS;
        this.serviceBaseLogger.info("GoogleSearchService initialized.");
    }

    // Helper để tạo logger cho phương thức với context từ parentLogger
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `GoogleSearchService.${methodName}`, ...additionalContext });
    }

    // Phương thức search giờ đây chấp nhận parentLogger
    async search(searchQuery: string, parentLogger?: Logger): Promise<GoogleSearchResult[]> {
        // Tạo logger cho lần search này, là con của parentLogger (nếu có)
        // Nó sẽ thừa hưởng requestId, route, và các context khác từ parentLogger
        const logger = this.getMethodLogger(parentLogger, 'search', { searchQuery });

        logger.debug("Performing Google Search with context."); // Log ban đầu bằng logger của method
        let lastSearchError: any = null;

        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            const attemptContext = { attempt, maxAttempts: this.maxRetries + 1 };

            if (this.apiKeyManager.areAllKeysExhausted()) {
                logger.warn({ ...attemptContext }, `Skipping search attempt - All API keys exhausted.`);
                lastSearchError = new Error("All API keys exhausted during search attempts.");
                break;
            }

            // Truyền logger (đã có context search) xuống ApiKeyManager
            const apiKey = await this.apiKeyManager.getNextKey(logger);
            if (!apiKey) {
                logger.warn({ ...attemptContext }, `Skipping search attempt - Failed to get valid API key.`);
                lastSearchError = new Error("Failed to get API key for search attempt.");
                break;
            }

            const keyIndex = this.apiKeyManager.getCurrentKeyIndex();
            const keyPrefix = apiKey.substring(0, 5);
            logger.info({ ...attemptContext, keyIndex, keyPrefix }, `Attempting Google Search`);

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
                    logger.warn({ ...errorPayload, ...attemptContext }, errorMessage); // Sử dụng logger của method
                    throw new GoogleSearchError(errorMessage, errorPayload);
                }

                const results: GoogleSearchResult[] = [];
                if (response.data?.items?.length) {
                    response.data.items.forEach(item => {
                        if (item?.link && item?.title) {
                            results.push({ title: item.title, link: item.link });
                        } else {
                            logger.warn({ itemReceived: item, ...attemptContext }, "Received search result item with missing title or link, skipping.");
                        }
                    });
                    // Truyền logger cho apiKeyManager khi log usage
                    logger.info({
                        keyIndex, keyPrefix,
                        usageOnKey: this.apiKeyManager.getCurrentKeyUsage(logger), // Truyền logger
                        ...attemptContext, resultsCount: results.length
                    }, `Google Search successful`);
                    return results;
                } else {
                    logger.debug({ keyPrefix, ...attemptContext }, "No valid 'items' array found in Google Search response.");
                    return [];
                }

            } catch (error: any) {
                lastSearchError = error;
                let errorMessage = `Failed Google Search: ${error.message}`;
                let errorDetails: any = { originalError: error.message };

                if (error instanceof GoogleSearchError) {
                    errorMessage = error.message;
                    errorDetails = { ...error.details };
                    logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails }, `Google Search attempt failed (Pre-processed Google Error)`);
                } else if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<GoogleCSEApiResponse>;
                    errorDetails.axiosCode = axiosError.code;
                    if (axiosError.response) {
                        errorDetails.status = axiosError.response.status;
                        errorDetails.statusText = axiosError.response.statusText;
                        errorMessage = `Google API request failed with status ${errorDetails.status}`;
                        if (axiosError.response.data?.error) {
                            const googleError = axiosError.response.data.error;
                            errorMessage = `Google API Error ${errorDetails.status}: ${googleError.message}`;
                            errorDetails.googleErrorCode = googleError.code;
                            errorDetails.googleErrors = googleError.errors;
                            errorDetails.isGoogleBodyError = true;
                        }
                        logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails }, `Google Search attempt failed (HTTP Error Status)`);
                    } else if (axiosError.request) {
                        errorMessage = `Google API request failed: No response received (Code: ${axiosError.code || 'N/A'})`;
                        errorDetails.status = 'Network/Timeout';
                        logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails }, `Google Search attempt failed (Network/Timeout)`);
                    } else {
                        errorMessage = `Error setting up Google API request: ${axiosError.message}`;
                        logger.error({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails }, `Google Search attempt failed (Request Setup Error)`);
                    }
                    lastSearchError = new GoogleSearchError(errorMessage, errorDetails);
                } else {
                    errorMessage = `Unexpected error during Google search processing: ${error.message}`;
                    logger.error({ ...attemptContext, keyIndex, keyPrefix, err: errorMessage, details: errorDetails }, `Google Search attempt failed (Unexpected Error)`);
                    lastSearchError = new GoogleSearchError(errorMessage, { originalError: error.message, stack: error.stack });
                }

                const status = lastSearchError.details?.status || lastSearchError.details?.axiosCode || 'Unknown';
                const googleErrorCode = lastSearchError.details?.googleErrorCode || 'N/A';
                const isQuotaError = status === 429 || googleErrorCode === 429 || status === 403 || googleErrorCode === 403
                                   || lastSearchError.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'dailyLimitExceeded' || e.reason === 'userRateLimitExceeded' || e.reason === 'quotaExceeded' || e.reason === 'forbidden')
                                   || (typeof errorMessage === 'string' && (errorMessage.includes('quota') || errorMessage.includes('limit')));

                logger.warn({ ...attemptContext, keyIndex, keyPrefix, err: lastSearchError.message, status, googleErrorCode, isQuotaError }, `Handling failure for attempt`);

                if (isQuotaError && attempt <= this.maxRetries) {
                    logger.warn({ ...attemptContext, keyIndex, keyPrefix }, `Quota/Rate limit error detected. Forcing API key rotation.`);
                    // Truyền logger xuống ApiKeyManager
                    const rotated = await this.apiKeyManager.forceRotate(logger);
                    if (!rotated) {
                        logger.error("Failed to rotate key after quota error (all keys likely exhausted), stopping retries for this query.");
                        break;
                    }
                }

                if (attempt > this.maxRetries) {
                    logger.error({ finalAttempt: attempt, keyPrefix, err: lastSearchError.message, status, googleErrorCode }, `Google Search failed after maximum retries.`);
                } else if (!this.apiKeyManager.areAllKeysExhausted()) {
                     if (!isQuotaError) {
                        logger.info({ ...attemptContext, delaySeconds: this.retryDelay / 1000 }, `Waiting ${this.retryDelay / 1000}s before retry attempt ${attempt + 1}...`);
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                     } else {
                         logger.info({ ...attemptContext }, `Quota error handled by key rotation, proceeding to attempt ${attempt + 1} immediately if keys available.`);
                     }
                } else {
                     logger.warn({ ...attemptContext }, "Skipping wait/retry as all keys are exhausted.");
                }
            }
        }

        logger.error({ err: lastSearchError?.message || 'Unknown search error', details: lastSearchError?.details }, "Google Search ultimately failed for this query.");
        throw lastSearchError || new GoogleSearchError(`Google Search failed for query: ${searchQuery}`, { query: searchQuery });
    }
}