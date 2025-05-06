// src/services/googleSearch.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import axios, { AxiosError, AxiosResponse } from "axios"; // Thêm import axios và các kiểu liên quan
import { ApiKeyManager } from './apiKey.manager';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
// Đảm bảo đường dẫn đến file types là chính xác
import { GoogleSearchResult, GoogleCSEApiResponse, GoogleSearchError } from '../types/crawl.types'; // Giả sử types.ts nằm trong thư mục utils

// --- Định nghĩa GoogleSearchError nếu chưa có trong types.ts ---
// (Nếu đã có trong types.ts thì không cần đoạn này)
/*
export class GoogleSearchError extends Error {
    details: any;
    constructor(message: string, details: any = {}) {
        super(message);
        this.name = 'GoogleSearchError';
        this.details = details;
        // Giữ lại stack trace nếu có thể (cho V8)
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, GoogleSearchError);
        }
    }
}
*/
// -------------------------------------------------------------


@singleton()
export class GoogleSearchService {
    private readonly logger: Logger;
    private readonly cseId: string;
    private readonly maxRetries: number;
    private readonly retryDelay: number;

    constructor(
        @inject(ApiKeyManager) private apiKeyManager: ApiKeyManager,
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.logger = this.loggingService.getLogger({ service: 'GoogleSearchService' });

        const cseIdFromConfig = this.configService.config.GOOGLE_CSE_ID;
        if (!cseIdFromConfig) {
             const errorMsg = "Google CSE ID is missing in configuration.";
             this.logger.error(errorMsg);
             throw new Error(errorMsg);
        }
        this.cseId = cseIdFromConfig;

        this.maxRetries = this.configService.config.MAX_SEARCH_RETRIES;
        this.retryDelay = this.configService.config.RETRY_DELAY_MS;
    }

    async search(searchQuery: string): Promise<GoogleSearchResult[]> {
        this.logger.debug({ query: searchQuery }, "Performing Google Search");
        let lastSearchError: any = null;

        for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
            if (this.apiKeyManager.areAllKeysExhausted()) {
                this.logger.warn({ attempt, query: searchQuery }, `Skipping search attempt ${attempt} - All API keys exhausted.`);
                lastSearchError = new Error("All API keys exhausted during search attempts.");
                break;
            }

            const apiKey = await this.apiKeyManager.getNextKey();
            if (!apiKey) {
                this.logger.warn({ attempt, query: searchQuery }, `Skipping search attempt ${attempt} - Failed to get valid API key.`);
                lastSearchError = new Error("Failed to get API key for search attempt.");
                break;
            }

            const keyIndex = this.apiKeyManager.getCurrentKeyIndex();
            const keyPrefix = apiKey.substring(0, 5); // Lấy prefix để log, tránh lộ key
            this.logger.info({ attempt, maxAttempts: this.maxRetries + 1, keyIndex, keyPrefix, query: searchQuery }, `Attempting Google Search (Attempt ${attempt}/${this.maxRetries + 1})`);

            // ----- Bắt đầu logic tích hợp từ searchGoogleCSE -----
            const searchUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${this.cseId}&q=${encodeURIComponent(searchQuery)}&num=8`;
            this.logger.trace({ searchUrl }, 'Executing Google Custom Search request'); // Sử dụng trace cho URL chi tiết

            try {
                const response: AxiosResponse<GoogleCSEApiResponse> = await axios.get(searchUrl, {
                    timeout: 15000 // 15 seconds
                });

                // Kiểm tra lỗi trong body của response (ngay cả khi status là 2xx)
                if (response.data?.error) {
                    const errorDetails = response.data.error;
                    const errorMessage = `Google API Error (in response body): ${errorDetails.message} (Code: ${errorDetails.code})`;
                    const errorPayload = {
                        keyPrefix,
                        googleErrorCode: errorDetails.code,
                        googleErrors: errorDetails.errors,
                        isGoogleBodyError: true,
                        status: response.status // Status vẫn có thể là 200
                    };
                    this.logger.warn({ ...errorPayload, query: searchQuery }, errorMessage); // Dùng warn thay vì error vì đây là lỗi logic API
                    // Ném lỗi tùy chỉnh để catch bên ngoài xử lý retry/rotate key
                    throw new GoogleSearchError(errorMessage, errorPayload);
                }

                // Xử lý kết quả thành công
                const results: GoogleSearchResult[] = [];
                if (response.data?.items?.length) {
                    response.data.items.forEach(item => {
                        if (item?.link && item?.title) {
                            results.push({
                                title: item.title,
                                link: item.link
                            });
                        } else {
                            this.logger.warn({ itemReceived: item, query: searchQuery }, "Received search result item with missing title or link, skipping.");
                        }
                    });
                    this.logger.info({ keyIndex, keyPrefix, usageOnKey: this.apiKeyManager.getCurrentKeyUsage(), attempt, resultsCount: results.length, query: searchQuery }, `Google Search successful on attempt ${attempt}`);
                    return results; // *** Trả về kết quả ngay khi thành công ***
                } else {
                    this.logger.debug({ keyPrefix, query: searchQuery }, "No valid 'items' array found in Google Search response.");
                    // Vẫn xem là thành công nếu API trả về 200 nhưng không có item
                    return []; // Trả về mảng rỗng
                }

            } catch (error: any) { // Catch lỗi từ axios hoặc lỗi GoogleSearchError đã ném ở trên
                lastSearchError = error; // Lưu lỗi cuối cùng gặp phải
                let errorMessage = `Failed Google Search: ${error.message}`;
                let errorDetails: any = { originalError: error.message }; // Bắt đầu với thông tin cơ bản

                if (error instanceof GoogleSearchError) {
                    // Lỗi đã được xử lý và ném lại từ try block (lỗi trong response body 2xx)
                    // Hoặc lỗi được ném từ lần catch dưới đây ở lần lặp trước đó
                    errorMessage = error.message;
                    errorDetails = { ...error.details }; // Lấy lại details đã chuẩn bị
                     this.logger.warn({ attempt, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, query: searchQuery }, `Google Search attempt ${attempt} failed (Pre-processed Google Error)`);

                } else if (axios.isAxiosError(error)) {
                    const axiosError = error as AxiosError<GoogleCSEApiResponse>;
                    errorDetails.axiosCode = axiosError.code;
                    if (axiosError.response) {
                        // Lỗi có response từ server (4xx, 5xx)
                        errorDetails.status = axiosError.response.status;
                        errorDetails.statusText = axiosError.response.statusText;
                        errorMessage = `Google API request failed with status ${errorDetails.status}`;
                        if (axiosError.response.data?.error) {
                            // Lỗi cụ thể từ Google API trong body của response lỗi HTTP
                            const googleError = axiosError.response.data.error;
                            errorMessage = `Google API Error ${errorDetails.status}: ${googleError.message}`;
                            errorDetails.googleErrorCode = googleError.code;
                            errorDetails.googleErrors = googleError.errors;
                            errorDetails.isGoogleBodyError = true;
                        }
                        this.logger.warn({ attempt, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, query: searchQuery }, `Google Search attempt ${attempt} failed (HTTP Error Status)`);
                    } else if (axiosError.request) {
                        // Request đã gửi nhưng không nhận được response (lỗi mạng, timeout)
                        errorMessage = `Google API request failed: No response received (Code: ${axiosError.code || 'N/A'})`;
                        errorDetails.status = 'Network/Timeout'; // Thêm đánh dấu
                        this.logger.warn({ attempt, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, query: searchQuery }, `Google Search attempt ${attempt} failed (Network/Timeout)`);
                    } else {
                        // Lỗi khi thiết lập request
                        errorMessage = `Error setting up Google API request: ${axiosError.message}`;
                        this.logger.error({ attempt, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, query: searchQuery }, `Google Search attempt ${attempt} failed (Request Setup Error)`);
                    }
                    // Chuẩn hóa lỗi thành GoogleSearchError để logic retry xử lý nhất quán
                    lastSearchError = new GoogleSearchError(errorMessage, errorDetails);

                } else {
                    // Lỗi không mong muốn khác
                    errorMessage = `Unexpected error during Google search processing: ${error.message}`;
                    this.logger.error({ attempt, keyIndex, keyPrefix, err: errorMessage, details: errorDetails, query: searchQuery }, `Google Search attempt ${attempt} failed (Unexpected Error)`);
                    // Chuẩn hóa lỗi thành GoogleSearchError
                     lastSearchError = new GoogleSearchError(errorMessage, { originalError: error.message, stack: error.stack });
                }

                // ----- Logic xử lý lỗi và retry (giữ nguyên từ bản gốc) -----
                const status = lastSearchError.details?.status || lastSearchError.details?.axiosCode || 'Unknown';
                const googleErrorCode = lastSearchError.details?.googleErrorCode || 'N/A';
                // Điều kiện kiểm tra quota/rate limit chặt chẽ hơn
                const isQuotaError = status === 429 || googleErrorCode === 429 || status === 403 || googleErrorCode === 403
                                   || lastSearchError.details?.googleErrors?.some((e: any) => e.reason === 'rateLimitExceeded' || e.reason === 'dailyLimitExceeded' || e.reason === 'userRateLimitExceeded' || e.reason === 'quotaExceeded' || e.reason === 'forbidden')
                                   || (typeof errorMessage === 'string' && (errorMessage.includes('quota') || errorMessage.includes('limit')));


                this.logger.warn({ attempt, keyIndex, keyPrefix, err: lastSearchError.message, status, googleErrorCode, isQuotaError, query: searchQuery }, `Handling failure for attempt ${attempt}`);

                if (isQuotaError && attempt <= this.maxRetries) {
                    this.logger.warn({ attempt, keyIndex, keyPrefix }, `Quota/Rate limit error detected. Forcing API key rotation.`);
                    const rotated = await this.apiKeyManager.forceRotate();
                    if (!rotated) {
                        this.logger.error({ query: searchQuery }, "Failed to rotate key after quota error (all keys likely exhausted), stopping retries for this query.");
                        break; // Thoát vòng lặp nếu không thể xoay key
                    }
                    // Không cần delay ở đây, sẽ delay trước lần thử tiếp theo nếu cần
                }

                // Kiểm tra trước khi chờ và thử lại
                if (attempt > this.maxRetries) {
                    this.logger.error({ finalAttempt: attempt, keyPrefix, err: lastSearchError.message, status, googleErrorCode, query: searchQuery }, `Google Search failed after maximum ${this.maxRetries + 1} retries.`);
                    // Không cần break, vòng lặp sẽ tự kết thúc
                } else if (!this.apiKeyManager.areAllKeysExhausted()) {
                     // Chỉ delay nếu không phải là lỗi quota (vì xoay key đã là hành động chính) và còn key để thử
                     if (!isQuotaError) {
                        this.logger.info({ attempt, delaySeconds: this.retryDelay / 1000, query: searchQuery }, `Waiting ${this.retryDelay / 1000}s before retry attempt ${attempt + 1}...`);
                        await new Promise(resolve => setTimeout(resolve, this.retryDelay));
                     } else {
                         this.logger.info({ attempt, query: searchQuery }, `Quota error handled by key rotation, proceeding to attempt ${attempt + 1} immediately if keys available.`);
                     }
                } else {
                     this.logger.warn({ attempt, query: searchQuery }, "Skipping wait/retry as all keys are exhausted.");
                     // Không cần break, vòng lặp sẽ tự kết thúc ở lần kiểm tra tiếp theo
                }
            }
            // ----- Kết thúc logic tích hợp -----
        }

        // Nếu vòng lặp kết thúc mà không return thành công
        this.logger.error({ err: lastSearchError?.message || 'Unknown search error', details: lastSearchError?.details, query: searchQuery }, "Google Search ultimately failed for this query.");
        // Ném lỗi cuối cùng gặp phải để báo hiệu thất bại cho nơi gọi service
        throw lastSearchError || new GoogleSearchError(`Google Search failed for query: ${searchQuery}`, { query: searchQuery });
    }
}