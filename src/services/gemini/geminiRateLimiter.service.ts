// src/services/gemini/geminiRateLimiter.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import {
    RateLimiterMemory,
    type IRateLimiterOptions,
} from 'rate-limiter-flexible';
import { ConfigService } from '../../config/config.service'; // Adjust path
import { LoggingService } from '../logging.service'; // Adjust path
import { Logger } from 'pino';

@singleton()
export class GeminiRateLimiterService {
    private readonly baseLogger: Logger; // Base logger for this service
    private readonly rateLimitPoints: number;
    private readonly rateLimitDuration: number;
    private readonly rateLimitBlockDuration: number;
    private modelRateLimitersInternal: Map<string, RateLimiterMemory> = new Map();

    constructor(
        @inject(ConfigService) configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService,
    ) {
        this.baseLogger = loggingService.getLogger({ service: 'GeminiRateLimiterService' });
        this.rateLimitPoints = configService.config.GEMINI_RATE_LIMIT_POINTS;
        this.rateLimitDuration = configService.config.GEMINI_RATE_LIMIT_DURATION;
        this.rateLimitBlockDuration = configService.config.GEMINI_RATE_LIMIT_BLOCK_DURATION;
    }

    // Replicates original getRateLimiterForModel
    public getLimiter(modelName: string, parentLogger: Logger): RateLimiterMemory {
        // Create child logger specific to this operation, using parent's context
        // and adding its own fixed context for log consistency.
        const logger = parentLogger.child({ function: 'getRateLimiterForModel', modelName });

        if (!this.modelRateLimitersInternal.has(modelName)) {
            // Original log: "Creating new rate limiter" with context { modelName, function }
            logger.info("Creating new rate limiter"); // Message from original
            const limiterOptions: IRateLimiterOptions = {
                points: this.rateLimitPoints,
                duration: this.rateLimitDuration,
                blockDuration: this.rateLimitBlockDuration,
                keyPrefix: `model_${modelName}`, // As original
            };
            try {
                const newLimiter = new RateLimiterMemory(limiterOptions);
                if (!newLimiter || typeof newLimiter.consume !== 'function') {
                    // Original log: error with { options }
                    logger.error({ options: limiterOptions }, "Failed to create a valid rate limiter object");
                    throw new Error(`Failed to create valid rate limiter for ${modelName}`);
                }
                // Original log: debug with { options }
                logger.debug({ options: limiterOptions }, "Rate limiter created successfully");
                this.modelRateLimitersInternal.set(modelName, newLimiter);
            } catch (creationError: unknown) {
                const errorDetails = creationError instanceof Error ? { name: creationError.name, message: creationError.message } : { details: String(creationError) };
                // Original log: error with { err, options }
                logger.error({ err: errorDetails, options: limiterOptions }, "Exception during RateLimiterMemory creation");
                throw creationError;
            }
        }
        const limiterInstance = this.modelRateLimitersInternal.get(modelName);
        if (!limiterInstance || typeof limiterInstance.consume !== 'function') {
             // Original log: error
            logger.error("Invalid limiter found in map or failed creation");
            throw new Error(`Retrieved invalid rate limiter from map for ${modelName}`);
        }
        // Original log: debug
        logger.debug("Retrieved existing rate limiter");
        return limiterInstance;
    }
}