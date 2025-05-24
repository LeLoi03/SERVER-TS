// src/services/gemini/geminiRateLimiter.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    RateLimiterMemory,
    type IRateLimiterOptions,
} from 'rate-limiter-flexible'; // Import types
import { ConfigService } from '../../config/config.service';
import { LoggingService } from '../logging.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Service to manage rate limiting for Gemini API calls per model.
 * It uses `rate-limiter-flexible` to control the number of API requests
 * within a defined duration and applies a block duration upon hitting the limit.
 */
@singleton()
export class GeminiRateLimiterService {
    private readonly baseLogger: Logger; // Base logger for this service
    private readonly rateLimitPoints: number; // Max requests in a duration
    private readonly rateLimitDuration: number; // Duration window in seconds
    private readonly rateLimitBlockDuration: number; // Block duration in seconds
    // Map to store a RateLimiterMemory instance for each model name
    private modelRateLimitersInternal: Map<string, RateLimiterMemory> = new Map();

    /**
     * Constructs an instance of GeminiRateLimiterService.
     * @param {ConfigService} configService - The injected configuration service.
     * @param {LoggingService} loggingService - The injected logging service.
     */
    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger('main', { service: 'GeminiRateLimiterService' });
        // Load rate limit configurations from ConfigService
        this.rateLimitPoints = configService.config.GEMINI_RATE_LIMIT_POINTS;
        this.rateLimitDuration = configService.config.GEMINI_RATE_LIMIT_DURATION;
        this.rateLimitBlockDuration = configService.config.GEMINI_RATE_LIMIT_BLOCK_DURATION;

        this.baseLogger.info(
            {
                event: 'rate_limiter_init_success',
                points: this.rateLimitPoints,
                duration: this.rateLimitDuration,
                blockDuration: this.rateLimitBlockDuration
            },
            `GeminiRateLimiterService initialized with default limits: ${this.rateLimitPoints} points per ${this.rateLimitDuration}s, block for ${this.rateLimitBlockDuration}s.`
        );
    }

    /**
     * Retrieves or creates a `RateLimiterMemory` instance for a specific Gemini model.
     * Each model gets its own rate limiter to manage concurrent requests independently.
     *
     * @param {string} modelName - The name of the Gemini model (e.g., 'gemini-pro').
     * @param {Logger} parentLogger - The parent logger for contextual logging.
     * @returns {RateLimiterMemory} An initialized `RateLimiterMemory` instance.
     * @throws {Error} If the rate limiter cannot be created or is invalid.
     */
    public getLimiter(modelName: string, parentLogger: Logger): RateLimiterMemory {
        // Create child logger specific to this operation for consistent logging context
        const logger = parentLogger.child({ function: 'getRateLimiterForModel', modelName });

        if (!this.modelRateLimitersInternal.has(modelName)) {
            const limiterOptions: IRateLimiterOptions = {
                points: this.rateLimitPoints,
                duration: this.rateLimitDuration,
                blockDuration: this.rateLimitBlockDuration,
                keyPrefix: `model_${modelName}`, // Unique prefix for each model's rate limiter
            };
            logger.info({ event: 'rate_limiter_create_attempt', options: limiterOptions }, `Creating new rate limiter for model "${modelName}".`);

            try {
                const newLimiter = new RateLimiterMemory(limiterOptions);
                // Basic validation for the created limiter instance
                if (!newLimiter || typeof newLimiter.consume !== 'function') {
                    const errorMsg = `Failed to create a valid rate limiter object for model "${modelName}".`;
                    logger.error({ options: limiterOptions, event: 'rate_limiter_creation_invalid_object' }, errorMsg);
                    throw new Error(errorMsg);
                }
                logger.debug({ options: limiterOptions, event: 'rate_limiter_create_success' }, `Rate limiter for model "${modelName}" created successfully.`);
                this.modelRateLimitersInternal.set(modelName, newLimiter);
            } catch (creationError: unknown) { // Catch any errors during RateLimiterMemory instantiation
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(creationError);
                logger.error({ err: { message: errorMessage, stack: errorStack }, options: limiterOptions, event: 'rate_limiter_creation_exception' }, `Exception during RateLimiterMemory creation for model "${modelName}": "${errorMessage}".`);
                throw creationError; // Re-throw to indicate critical failure
            }
        }
        // Retrieve the limiter from the map
        const limiterInstance = this.modelRateLimitersInternal.get(modelName);

        // Defensive check: ensure the retrieved instance is valid
        if (!limiterInstance || typeof limiterInstance.consume !== 'function') {
            const errorMsg = `Retrieved invalid rate limiter from map for model "${modelName}". This indicates a serious internal state issue.`;
            logger.error({ event: 'rate_limiter_retrieval_invalid_instance' }, errorMsg);
            throw new Error(errorMsg);
        }
        logger.trace({ event: 'rate_limiter_retrieved_existing' }, `Retrieved existing rate limiter for model "${modelName}".`);
        return limiterInstance;
    }
}