// src/types/crawl/geminiApi.types.ts
import 'reflect-metadata';
import { type Part, GenerationConfig as SDKGenerationConfig, type UsageMetadata } from "@google/generative-ai";
import { type RateLimiterMemory } from 'rate-limiter-flexible';
import { Logger } from 'pino';

import { CrawlModelType } from '../../types/crawl/crawl.types';
import {
    type GenerativeModel,
    type CachedContent,
    type GenerateContentRequest,
} from "@google/generative-ai";

/**
 * @fileoverview Định nghĩa các interface cho việc điều phối và quản lý API Gemini.
 * Mục đích là cung cấp các kiểu dữ liệu rõ ràng, dễ bảo trì và có khả năng mở rộng.
 */

/**
 * @interface ApiResponse
 * @description Định nghĩa cấu trúc phản hồi cơ bản từ API Gemini.
 */
export interface ApiResponse {
    /**
     * @property {string} responseText - Văn bản phản hồi được tạo ra từ mô hình.
     */
    responseText: string;
    /**
     * @property {UsageMetadata | null | undefined} metaData - Siêu dữ liệu sử dụng từ phản hồi của Gemini, có thể là null hoặc undefined.
     */
    metaData: UsageMetadata | null | undefined;
}

/**
 * @interface InternalCallGeminiApiParams
 * @description Các tham số nội bộ được sử dụng để gọi API Gemini.
 */
export interface InternalCallGeminiApiParams {
    /**
     * @property {string} batchPrompt - Nhắc nhở chính (prompt) để gửi đến API.
     */
    batchPrompt: string;
    /**
     * @property {number} batchIndex - Chỉ số của gói (batch) hiện tại.
     */
    batchIndex: number;
    /**
     * @property {string | undefined} title - Tiêu đề liên quan đến yêu cầu, có thể là undefined.
     */
    title: string | undefined;
    /**
     * @property {string | undefined} acronym - Từ viết tắt liên quan đến yêu cầu, có thể là undefined.
     */
    acronym: string | undefined;
    /**
     * @property {string} apiType - Loại API đang được gọi (ví dụ: 'generateContent', 'batchGenerateContent').
     */
    apiType: string;
    /**
     * @property {string} modelName - Tên của mô hình chính sẽ được sử dụng.
     */
    modelName: string;
    /**
     * @property {string} [fallbackModelName] - Tên của mô hình dự phòng sẽ được sử dụng nếu mô hình chính thất bại.
     */
    fallbackModelName?: string;
    /**
     * @property {CrawlModelType} crawlModel - Loại mô hình thu thập dữ liệu ban đầu/dự định cho mô hình chính.
     */
    crawlModel: CrawlModelType;
    /**
     * @property {string} requestLogDir - Thư mục để ghi nhật ký các yêu cầu.
     */
    requestLogDir: string;
}

/**
 * @interface ModelExecutionConfig
 * @description Cấu hình thực thi cho một mô hình Gemini.
 */
export interface ModelExecutionConfig {
    /**
     * @property {string} systemInstructionText - Hướng dẫn hệ thống (system instruction) áp dụng cho mô hình.
     */
    systemInstructionText: string;
    /**
     * @property {Part[]} fewShotParts - Các ví dụ "few-shot" để hướng dẫn mô hình.
     */
    fewShotParts: Part[];
    /**
     * @property {boolean} shouldUseCache - Cờ chỉ định liệu có nên sử dụng cache hay không.
     */
    shouldUseCache: boolean;
    /**
     * @property {SDKGenerationConfig} finalGenerationConfig - Cấu hình tạo nội dung cuối cùng được gửi đến SDK.
     */
    finalGenerationConfig: SDKGenerationConfig;
    /**
     * @property {string} finalBatchPrompt - Nhắc nhở cuối cùng sau khi áp dụng các tiền tố (nếu có) cho các mô hình tinh chỉnh.
     */
    finalBatchPrompt: string;
    /**
     * @property {RateLimiterMemory} modelRateLimiter - Bộ giới hạn tốc độ cho mô hình cụ thể này.
     */
    modelRateLimiter: RateLimiterMemory;
    /**
     * @property {ModelPreparationResult} modelPrepResult - Kết quả của bước chuẩn bị mô hình.
     */
    modelPrepResult: ModelPreparationResult;
}

/**
 * @interface OrchestrationResult
 * @extends ApiResponse
 * @description Kết quả cuối cùng của quá trình điều phối API Gemini, bao gồm thông tin về thành công và các mô hình đã sử dụng.
 */
export interface OrchestrationResult extends ApiResponse {
    /**
     * @property {boolean} success - True nếu có responseText hoặc metaData hợp lệ, chỉ ra rằng API call thành công ít nhất một phần.
     */
    success: boolean;
    /**
     * @property {boolean} usedFallback - True nếu mô hình dự phòng đã được sử dụng.
     */
    usedFallback: boolean;
    /**
     * @property {string} [modelActuallyUsed] - Tên của mô hình thực sự đã tạo ra kết quả (mô hình chính hoặc dự phòng).
     */
    modelActuallyUsed?: string;
    /**
     * @property {CrawlModelType} [crawlModelActuallyUsed] - Loại mô hình thu thập dữ liệu của mô hình đã tạo ra kết quả.
     */
    crawlModelActuallyUsed?: CrawlModelType;
    /**
     * @property {string} [finalErrorType] - Loại lỗi cuối cùng nếu quá trình thất bại hoàn toàn.
     */
    finalErrorType?: string;
    /**
     * @property {any} [finalErrorDetails] - Chi tiết lỗi cuối cùng nếu quá trình thất bại hoàn toàn.
     */
    finalErrorDetails?: any;
}

/**
 * @interface ModelPreparationResult
 * @description Kết quả từ quá trình chuẩn bị một mô hình Gemini trước khi thực hiện cuộc gọi API.
 */
export interface ModelPreparationResult {
    /**
     * @property {GenerativeModel} model - Đối tượng mô hình Gemini đã được khởi tạo.
     */
    model: GenerativeModel;
    /**
     * @property {GenerateContentRequest | string} contentRequest - Yêu cầu nội dung sẽ được gửi đến mô hình, có thể là một chuỗi hoặc đối tượng yêu cầu.
     */
    contentRequest: GenerateContentRequest | string;
    /**
     * @property {boolean} usingCacheActual - Cờ chỉ định liệu cache có thực sự được sử dụng hay không.
     */
    usingCacheActual: boolean;
    /**
     * @property {CachedContent | null} currentCache - Nội dung cache hiện tại, nếu có.
     */
    currentCache: CachedContent | null;
    /**
     * @property {CrawlModelType} crawlModelUsed - Loại mô hình thu thập dữ liệu đã được sử dụng.
     */
    crawlModelUsed: CrawlModelType;
    /**
     * @property {string} modelNameUsed - Tên của mô hình đã được sử dụng.
     */
    modelNameUsed: string;
}

/**
 * @interface LogRequestPayloadParams
 * @description Các tham số được sử dụng để ghi lại payload yêu cầu của API Gemini.
 */
export interface LogRequestPayloadParams {
    /**
     * @property {Logger} parentAttemptLogger - Đối tượng logger cha cho lần thử hiện tại.
     */
    parentAttemptLogger: Logger;
    /**
     * @property {string} requestLogDir - Thư mục để ghi nhật ký các yêu cầu.
     */
    requestLogDir: string;
    /**
     * @property {string} apiType - Loại API đang được gọi.
     */
    apiType: string;
    /**
     * @property {string} modelNameUsed - Tên của mô hình đã được sử dụng.
     */
    modelNameUsed: string;
    /**
     * @property {string | undefined} acronym - Từ viết tắt liên quan đến yêu cầu, có thể là undefined.
     */
    acronym: string | undefined;
    /**
     * @property {number} batchIndex - Chỉ số của gói (batch) hiện tại.
     */
    batchIndex: number;
    /**
     * @property {string | undefined} title - Tiêu đề liên quan đến yêu cầu, có thể là undefined.
     */
    title: string | undefined;
    /**
     * @property {CrawlModelType} crawlModel - Loại mô hình thu thập dữ liệu.
     */
    crawlModel: CrawlModelType;
    /**
     * @property {boolean} usingCacheActual - Cờ chỉ định liệu cache có thực sự được sử dụng hay không.
     */
    usingCacheActual: boolean;
    /**
     * @property {string | undefined | null} currentCacheName - Tên của cache hiện tại, nếu có.
     */
    currentCacheName: string | undefined | null;
    /**
     * @property {string} systemInstructionApplied - Hướng dẫn hệ thống đã được áp dụng.
     */
    systemInstructionApplied: string;
    /**
     * @property {Part[]} fewShotPartsApplied - Các ví dụ "few-shot" đã được áp dụng.
     */
    fewShotPartsApplied: Part[];
    /**
     * @property {string | Part | (string | Part)[]} contentRequest - Yêu cầu nội dung được gửi đi.
     */
    contentRequest: string | Part | (string | Part)[];
    /**
     * @property {SDKGenerationConfig} [generationConfigSent] - Cấu hình tạo nội dung đã được gửi.
     */
    generationConfigSent?: SDKGenerationConfig;
    /**
     * @property {SDKGenerationConfig} [generationConfigEffective] - Cấu hình tạo nội dung có hiệu lực (sau khi hợp nhất).
     */
    generationConfigEffective?: SDKGenerationConfig;
}

/**
 * @interface ProcessedGeminiResponse
 * @description Định nghĩa cấu trúc phản hồi Gemini đã được xử lý.
 */
export interface ProcessedGeminiResponse {
    /**
     * @property {string} responseText - Văn bản phản hồi được xử lý.
     */
    responseText: string;
    /**
     * @property {UsageMetadata | null | undefined} metaData - Siêu dữ liệu sử dụng từ phản hồi.
     */
    metaData: UsageMetadata | null | undefined;
}

/**
 * @typedef {function(RateLimiterMemory, ModelPreparationResult, string, Logger): Promise<ProcessedGeminiResponse>} RetryableGeminiApiCall
 * @description Định nghĩa một hàm gọi API Gemini có khả năng thử lại.
 * @param {RateLimiterMemory} limiter - Bộ giới hạn tốc độ.
 * @param {ModelPreparationResult} modelPrep - Kết quả chuẩn bị mô hình.
 * @param {string} apiType - Loại API đang được gọi.
 * @param {Logger} attemptLogger - Đối tượng logger cho lần thử hiện tại.
 * @returns {Promise<ProcessedGeminiResponse>} Một Promise phân giải thành phản hồi Gemini đã xử lý.
 */
export type RetryableGeminiApiCall = (
    limiter: RateLimiterMemory,
    modelPrep: ModelPreparationResult,
    apiType: string,
    attemptLogger: Logger
) => Promise<ProcessedGeminiResponse>;

/**
 * @interface ExecuteWithRetryResult
 * @extends ProcessedGeminiResponse
 * @description Kết quả của việc thực thi một cuộc gọi API với cơ chế thử lại.
 */
export interface ExecuteWithRetryResult extends ProcessedGeminiResponse {
    /**
     * @property {'5xx_non_retryable_for_current_model' | 'failed_first_attempt' | 'non_retryable_error'} [finalErrorType] - Loại lỗi cuối cùng nếu cuộc gọi thất bại hoàn toàn.
     */
    finalErrorType?: '5xx_non_retryable_for_current_model' | 'failed_first_attempt' | 'non_retryable_error';
    /**
     * @property {boolean} [firstAttemptFailed] - Cờ chỉ ra liệu lần thử đầu tiên có thất bại hay không.
     */
    firstAttemptFailed?: boolean;
    /**
     * @property {any} [errorDetails] - Chi tiết lỗi của lần thử đầu tiên nếu thất bại.
     */
    errorDetails?: any;
}

/**
 * @interface SdkExecutorParams
 * @description Các tham số được sử dụng để thực thi cuộc gọi SDK Gemini.
 */
export interface SdkExecutorParams {
    /**
     * @property {RateLimiterMemory} limiterInstance - Thể hiện của bộ giới hạn tốc độ.
     */
    limiterInstance: RateLimiterMemory;
    /**
     * @property {ModelPreparationResult} currentModelPrep - Kết quả chuẩn bị mô hình hiện tại.
     */
    currentModelPrep: ModelPreparationResult;
    /**
     * @property {string} apiType - Loại API đang được gọi.
     */
    apiType: string;
    /**
     * @property {number} batchIndex - Chỉ số của gói (batch) hiện tại.
     */
    batchIndex: number;
    /**
     * @property {string | undefined} acronym - Từ viết tắt liên quan đến yêu cầu, có thể là undefined.
     */
    acronym: string | undefined;
    /**
     * @property {string | undefined} title - Tiêu đề liên quan đến yêu cầu, có thể là undefined.
     */
    title: string | undefined;
    /**
     * @property {CrawlModelType} crawlModel - Loại mô hình thu thập dữ liệu.
     */
    crawlModel: CrawlModelType;
    /**
     * @property {string} systemInstructionTextToUse - Hướng dẫn hệ thống để sử dụng.
     */
    systemInstructionTextToUse: string;
    /**
     * @property {Part[]} fewShotPartsToUse - Các ví dụ "few-shot" để sử dụng.
     */
    fewShotPartsToUse: Part[];
    /**
     * @property {string} requestLogDir - Thư mục để ghi nhật ký các yêu cầu.
     */
    requestLogDir: string;
}

/**
 * @interface GeminiApiParams
 * @description Các tham số chung cho việc gọi API Gemini.
 */
export interface GeminiApiParams {
    /**
     * @property {string} batch - Gói (batch) dữ liệu để xử lý.
     */
    batch: string;
    /**
     * @property {number} batchIndex - Chỉ số của gói (batch) hiện tại.
     */
    batchIndex: number;
    /**
     * @property {string | undefined} title - Tiêu đề liên quan đến yêu cầu, có thể là undefined.
     */
    title: string | undefined;
    /**
     * @property {string | undefined} acronym - Từ viết tắt liên quan đến yêu cầu, có thể là undefined.
     */
    acronym: string | undefined;
}