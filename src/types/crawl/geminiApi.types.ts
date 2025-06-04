// src/types/crawl/geminiApi.types.ts
import 'reflect-metadata';
// Updated imports for new SDK structure
import { 
    type Part, 
    type CachedContent,
    Models, // Service class for model operations in the new SDK
    GenerateContentConfig as SDKGenerateContentConfig,
    GenerateContentResponseUsageMetadata as SDKUsageMetadata,
    ContentListUnion as SDKContentListUnion
} from "@google/genai";
import { type RateLimiterMemory } from 'rate-limiter-flexible';
import { Logger } from 'pino';

import { CrawlModelType } from '../../types/crawl/crawl.types';


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
     * @property {SDKUsageMetadata | null | undefined} metaData - Siêu dữ liệu sử dụng từ phản hồi của Gemini, có thể là null hoặc undefined.
     */
    metaData: SDKUsageMetadata | null | undefined;
}

/**
 * @interface InternalCallGeminiApiParams
 * @description Các tham số nội bộ được sử dụng để gọi API Gemini.
 */
export interface InternalCallGeminiApiParams {
    batchPrompt: string;
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
    apiType: string;
    modelName: string; // This will be used in GenerateContentParameters
    fallbackModelName?: string;
    crawlModel: CrawlModelType;
    requestLogDir: string;
}

/**
 * @interface ModelExecutionConfig
 * @description Cấu hình thực thi cho một mô hình Gemini.
 */
export interface ModelExecutionConfig {
    systemInstructionText: string;
    fewShotParts: Part[]; // Part type should be compatible
    shouldUseCache: boolean;
    finalGenerationConfig: SDKGenerateContentConfig; // Now types.GenerateContentConfig
    finalBatchPrompt: string;
    modelRateLimiter: RateLimiterMemory;
    modelPrepResult: ModelPreparationResult;
}

/**
 * @interface OrchestrationResult
 * @extends ApiResponse
 * @description Kết quả cuối cùng của quá trình điều phối API Gemini, bao gồm thông tin về thành công và các mô hình đã sử dụng.
 */
export interface OrchestrationResult extends ApiResponse {
    success: boolean;
    usedFallback: boolean;
    modelActuallyUsed?: string;
    crawlModelActuallyUsed?: CrawlModelType;
    finalErrorType?: string;
    finalErrorDetails?: any;
}

/**
 * @interface ModelPreparationResult
 * @description Kết quả từ quá trình chuẩn bị một mô hình Gemini trước khi thực hiện cuộc gọi API.
 *              LƯU Ý: Với SDK @google/genai mới, 'model' thường là service 'Models',
 *              và 'contentRequest' là phần 'contents' của yêu cầu.
 *              Việc gọi API sẽ giống như: `modelsService.generateContent({ model: modelNameUsed, contents: contentRequest, config: generationConfig })`.
 */
export interface ModelPreparationResult {
    model: Models; // Service Models từ @google/genai
    contentRequest: SDKContentListUnion; // Nội dung chính (prompt, few-shot)
    finalGenerationConfig?: SDKGenerateContentConfig; // Config cơ bản đã chuẩn bị
    usingCacheActual: boolean;
    currentCache: CachedContent | null;
    crawlModelUsed: CrawlModelType;
    modelNameUsed: string; // Tên model sẽ được truyền cho generateContent
}


/**
 * @interface LogRequestPayloadParams
 * @description Các tham số được sử dụng để ghi lại payload yêu cầu của API Gemini.
 */
export interface LogRequestPayloadParams {
    parentAttemptLogger: Logger;
    requestLogDir: string;
    apiType: string;
    modelNameUsed: string;
    acronym: string | undefined;
    batchIndex: number;
    title: string | undefined;
    crawlModel: CrawlModelType;
    usingCacheActual: boolean;
    currentCacheName: string | undefined | null;
    systemInstructionApplied: string; // This would be part of GenerateContentConfig
    fewShotPartsApplied: Part[];      // These would be part of ContentListUnion
    /**
     * @property {SDKContentListUnion} contentRequest - Yêu cầu nội dung được gửi đi (phần 'contents').
     */
    contentRequest: SDKContentListUnion;
    /**
     * @property {SDKGenerateContentConfig} [generationConfigSent] - Cấu hình tạo nội dung đã được gửi (phần 'config').
     */
    generationConfigSent?: SDKGenerateContentConfig;
    /**
     * @property {SDKGenerateContentConfig} [generationConfigEffective] - Cấu hình tạo nội dung có hiệu lực.
     */
    generationConfigEffective?: SDKGenerateContentConfig; // This is likely the model's internal effective config
}

/**
 * @interface ProcessedGeminiResponse
 * @description Định nghĩa cấu trúc phản hồi Gemini đã được xử lý.
 */
export interface ProcessedGeminiResponse {
    responseText: string;
    metaData: SDKUsageMetadata | null | undefined;
}

/**
 * @typedef {function(RateLimiterMemory, ModelPreparationResult, string, Logger): Promise<ProcessedGeminiResponse>} RetryableGeminiApiCall
 * @description Định nghĩa một hàm gọi API Gemini có khả năng thử lại.
 *              LƯU Ý: Với thay đổi trong ModelPreparationResult, cách hàm này được triển khai
 *              và cách nó gọi SDK Gemini sẽ cần được cập nhật.
 */
export type RetryableGeminiApiCall = (
    limiter: RateLimiterMemory,
    modelPrep: ModelPreparationResult, // Chú ý: modelPrep.model giờ là 'Models' service
    apiType: string,
    attemptLogger: Logger
) => Promise<ProcessedGeminiResponse>;

/**
 * @interface ExecuteWithRetryResult
 * @extends ProcessedGeminiResponse
 * @description Kết quả của việc thực thi một cuộc gọi API với cơ chế thử lại.
 */
export interface ExecuteWithRetryResult extends ProcessedGeminiResponse {
    finalErrorType?: '5xx_non_retryable_for_current_model' | 'failed_first_attempt' | 'non_retryable_error';
    firstAttemptFailed?: boolean;
    errorDetails?: any;
}

/**
 * @interface SdkExecutorParams
 * @description Các tham số được sử dụng để thực thi cuộc gọi SDK Gemini.
 *              LƯU Ý: Cách các tham số này được sử dụng để tạo GenerateContentParameters
 *              cho `modelsService.generateContent()` sẽ cần được xem xét lại trong GeminiSdkExecutorService.
 */
export interface SdkExecutorParams {
    limiterInstance: RateLimiterMemory;
    currentModelPrep: ModelPreparationResult; // Chứa 'Models' service và 'ContentListUnion'
    apiType: string;
    batchIndex: number;
    acronym: string | undefined;
    title: string | undefined;
    crawlModel: CrawlModelType;
    systemInstructionTextToUse: string; // Sẽ là một phần của GenerateContentConfig
    fewShotPartsToUse: Part[];          // Sẽ là một phần của ContentListUnion
    requestLogDir: string;
}

/**
 * @interface GeminiApiParams
 * @description Các tham số chung cho việc gọi API Gemini.
 */
export interface GeminiApiParams {
    batch: string; // This likely forms part of the 'contents'
    batchIndex: number;
    title: string | undefined;
    acronym: string | undefined;
}