// src/services/gemini/geminiRetryHandler.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { RateLimiterRes, type RateLimiterMemory } from 'rate-limiter-flexible';
import { Logger } from 'pino';
import { ConfigService, AppConfig } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { GeminiContextCacheService } from './geminiContextCache.service';
import { type ModelPreparationResult } from './geminiModelOrchestrator.service';
import { type ProcessedGeminiResponse } from './geminiResponseHandler.service';

export type RetryableGeminiApiCall = (
    limiter: RateLimiterMemory,
    modelPrep: ModelPreparationResult,
    apiType: string,
    attemptLogger: Logger
) => Promise<ProcessedGeminiResponse>;

export interface ExecuteWithRetryResult extends ProcessedGeminiResponse {
    finalErrorType?: '5xx_non_retryable_for_current_model' | 'failed_first_attempt' | 'non_retryable_error'; // Thêm các loại lỗi
    firstAttemptFailed?: boolean; // Cho biết lần thử đầu tiên có thất bại không
    errorDetails?: any; // Chi tiết lỗi của lần thử đầu tiên nếu thất bại
}

@singleton()
export class GeminiRetryHandlerService {
    private readonly serviceBaseLogger: Logger;
    private readonly appConfig: AppConfig;
    private readonly defaultMaxRetries: number; // Đổi tên từ maxRetries
    private readonly initialDelayMs: number;
    private readonly maxDelayMs: number;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
        @inject(GeminiContextCacheService) private contextCache: GeminiContextCacheService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'GeminiRetryHandlerService' });
        this.appConfig = this.configService.config;
        this.defaultMaxRetries = this.configService.config.GEMINI_MAX_RETRIES; // Sử dụng tên mới
        this.initialDelayMs = this.appConfig.GEMINI_INITIAL_DELAY_MS;
        this.maxDelayMs = this.appConfig.GEMINI_MAX_DELAY_MS;
        this.serviceBaseLogger.info("Constructing GeminiRetryHandlerService.");
    }

    public async executeWithRetry(
        apiCallFn: RetryableGeminiApiCall,
        modelPreparation: ModelPreparationResult,
        apiType: string,
        batchIndex: number,
        limiter: RateLimiterMemory,
        parentOperationLogger: Logger,
        maxAttemptsForThisCall: number // Tham số mới
    ): Promise<ExecuteWithRetryResult> {
        const modelNameForThisExecution = modelPreparation.modelNameUsed;
        const crawlModelForThisExecution = modelPreparation.crawlModelUsed;

        const retryLogicLogger = parentOperationLogger.child({
            function: 'executeWithRetry',
            modelBeingRetried: modelNameForThisExecution,
            crawlModel: crawlModelForThisExecution,
            configuredMaxAttemptsForThisRun: maxAttemptsForThisCall, // Log số lần thử được cấu hình
        });

        const cacheKeyForInvalidation = `${apiType}-${modelNameForThisExecution}`;
        retryLogicLogger.debug({ event: 'retry_loop_start' }, "Executing with retry logic");
        let retryCount = 0;
        let currentDelay = this.initialDelayMs;
        const defaultResponse: ExecuteWithRetryResult = { responseText: "", metaData: null };

        const commonLogContext = {
            apiType: apiType,
            modelName: modelNameForThisExecution,
            crawlModel: crawlModelForThisExecution,
        };

        while (retryCount < maxAttemptsForThisCall) { // Sử dụng maxAttemptsForThisCall
            const attempt = retryCount + 1;
            const attemptLogger = retryLogicLogger.child({
                attempt,
                maxAttemptsConfigured: maxAttemptsForThisCall,
            });

            if (attempt > 1) {
                attemptLogger.info({ ...commonLogContext, event: 'retry_attempt_start' }, `Starting retry attempt ${attempt} for ${apiType} with model ${modelNameForThisExecution} (${crawlModelForThisExecution})`);
            } else {
                attemptLogger.info({ ...commonLogContext, event: 'initial_attempt_start' }, `Starting initial attempt for ${apiType} with model ${modelNameForThisExecution} (${crawlModelForThisExecution})`);
            }


            try {
                const successResult = await apiCallFn(limiter, modelPreparation, apiType, attemptLogger);
                return { ...successResult, finalErrorType: undefined, firstAttemptFailed: attempt > 1 };
            } catch (error: unknown) {
                let shouldRetry = true;
                let invalidateCacheOnError = false;
                const errorDetails = error instanceof Error ? { name: error.name, message: error.message, stack: error.stack?.substring(0, 300) } : { details: String(error) };
                const errorMessageLower = errorDetails.message?.toLowerCase() ?? '';
                let errorEventForThisAttempt = 'retry_attempt_error_unknown';
                let is5xxError = false;

                if (error instanceof RateLimiterRes) {
                    const waitTimeMs = error.msBeforeNext;
                    attemptLogger.warn({ ...commonLogContext, waitTimeMs, event: 'retry_internal_rate_limit_wait' }, `Internal rate limit for ${modelNameForThisExecution}. Waiting ${waitTimeMs}ms...`);
                    await new Promise(resolve => setTimeout(resolve, waitTimeMs));
                    // Quan trọng: Không tăng retryCount cho lỗi rate limit nội bộ, để nó thử lại ngay
                    // Nhưng nếu maxAttemptsForThisCall là 1, chúng ta vẫn muốn nó thoát ra để Orchestrator xử lý
                    if (maxAttemptsForThisCall === 1) {
                        attemptLogger.warn({ ...commonLogContext, event: 'retry_internal_rate_limit_first_attempt_fail_single_shot' }, `Internal rate limit on first and only attempt for ${modelNameForThisExecution}. Failing this shot.`);
                        return { ...defaultResponse, firstAttemptFailed: true, finalErrorType: 'failed_first_attempt', errorDetails };
                    }
                    continue;
                }


                if (errorMessageLower.includes('503') || errorMessageLower.includes('500') || errorMessageLower.includes('unavailable') || errorMessageLower.includes('internal')) {
                    errorEventForThisAttempt = 'retry_attempt_error_5xx';
                    is5xxError = true;
                } else if (errorMessageLower.includes('cachedcontent not found') || errorMessageLower.includes('permission denied on cached content') || errorMessageLower.includes('cannot find cached content')) {
                    errorEventForThisAttempt = 'retry_attempt_error_cache';
                    invalidateCacheOnError = true;
                } else if (errorMessageLower.includes('429') || errorMessageLower.includes('resource_exhausted') || errorMessageLower.includes('rate limit')) {
                    errorEventForThisAttempt = 'retry_attempt_error_429';
                } else if (errorMessageLower.includes("blocked") || errorMessageLower.includes("safety")) {
                    errorEventForThisAttempt = 'retry_attempt_error_safety_blocked';
                    shouldRetry = false;
                }
                // Lỗi parse JSON cũng sẽ rơi vào trường hợp chung, shouldRetry = true

                const logPayloadForAttemptError = { ...commonLogContext, err: errorDetails, event: errorEventForThisAttempt };

                if (shouldRetry) {
                    attemptLogger.warn(logPayloadForAttemptError, `Attempt ${attempt} failed with ${errorEventForThisAttempt}. Preparing for retry (if allowed).`);
                } else {
                    attemptLogger.error(logPayloadForAttemptError, `Attempt ${attempt} failed with non-retryable error ${errorEventForThisAttempt}. Aborting.`);
                }

                if (invalidateCacheOnError) {
                    attemptLogger.info({
                        ...commonLogContext,
                        cacheKeyToInvalidate: cacheKeyForInvalidation,
                        event: 'retry_cache_invalidate',
                    }, `Invalidating cache for ${cacheKeyForInvalidation} due to error.`);
                    this.contextCache.deleteInMemoryOnly(cacheKeyForInvalidation, attemptLogger.child({ sub_op: 'deleteInMemoryOnly' }));
                    await this.contextCache.removePersistentEntry(cacheKeyForInvalidation, attemptLogger.child({ sub_op: 'removePersistentEntry' }));
                }

                retryCount++;
                const isLastAttemptAfterThisFailure = retryCount >= maxAttemptsForThisCall;

                // Nếu đây là lần thử đầu tiên (attempt === 1) và thất bại, và chúng ta chỉ được phép 1 lần thử (maxAttemptsForThisCall === 1)
                // hoặc nếu lỗi không thể retry (shouldRetry === false)
                if ((attempt === 1 && maxAttemptsForThisCall === 1) || !shouldRetry) {
                    const finalErrorType = !shouldRetry ? 'non_retryable_error' : 'failed_first_attempt';
                    attemptLogger.error({ ...commonLogContext, finalError: errorDetails, event: `retry_abort_${finalErrorType.replace('_', '_')}` },
                        `${finalErrorType === 'non_retryable_error' ? 'Non-retryable error' : 'First attempt failed (single shot)'} with ${modelNameForThisExecution}. Aborting.`);
                    return { ...defaultResponse, firstAttemptFailed: true, finalErrorType, errorDetails };
                }


                if (isLastAttemptAfterThisFailure) {
                    const finalFailureEvent = is5xxError ? 'retry_failed_max_retries_5xx_current_model' : 'retry_failed_max_retries';
                    attemptLogger.error({ ...commonLogContext, maxRetries: maxAttemptsForThisCall, finalError: errorDetails, event: finalFailureEvent },
                        `Failed to process with model ${modelNameForThisExecution} after ${maxAttemptsForThisCall} retries. Final error: ${errorEventForThisAttempt}`);
                    return { ...defaultResponse, firstAttemptFailed: true, finalErrorType: is5xxError ? '5xx_non_retryable_for_current_model' : 'failed_first_attempt', errorDetails };
                }


                const jitter = Math.random() * 500;
                const delayWithJitter = Math.max(0, currentDelay + jitter);
                attemptLogger.info({ ...commonLogContext, nextAttemptWillBe: attempt + 1, delaySeconds: (delayWithJitter / 1000).toFixed(2), event: 'retry_wait_before_next' },
                    `Waiting ${(delayWithJitter / 1000).toFixed(2)}s before next attempt with ${modelNameForThisExecution}.`);
                await new Promise(resolve => setTimeout(resolve, delayWithJitter));
                currentDelay = Math.min(currentDelay * 2, this.maxDelayMs);
            }
        }
        retryLogicLogger.error({ ...commonLogContext, event: 'retry_loop_exit_unexpected' }, `Exited retry loop unexpectedly for model ${modelNameForThisExecution} without returning a result or specific error.`);
        return { ...defaultResponse, firstAttemptFailed: true, finalErrorType: 'failed_first_attempt', errorDetails: { message: "Unexpected retry loop exit" } };
    }
}