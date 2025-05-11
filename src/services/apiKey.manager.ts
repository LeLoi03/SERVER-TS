// src/services/apiKey.manager.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';

interface ApiKeyInfo {
    key: string;
    usageCount: number;
    lastUsed: number;
    isExhausted: boolean;
}

@singleton()
export class ApiKeyManager {
    private keys: ApiKeyInfo[];
    private currentKeyIndex: number = -1;
    private totalRequests: number = 0;
    private readonly maxUsagePerKey: number;
    private readonly rotationDelay: number;
    private readonly serviceBaseLogger: Logger; // Logger cơ sở của service

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'ApiKeyManagerBase' });

        const apiKeys = this.configService.config.GOOGLE_CUSTOM_SEARCH_API_KEYS;
        this.maxUsagePerKey = this.configService.config.MAX_USAGE_PER_KEY;
        this.rotationDelay = this.configService.config.KEY_ROTATION_DELAY_MS;

        if (!apiKeys || apiKeys.length === 0) {
            this.serviceBaseLogger.error('No Google Search API keys found in configuration.');
            throw new Error('Google Search API keys are required.');
        }

        this.keys = apiKeys.map(key => ({
            key,
            usageCount: 0,
            lastUsed: 0,
            isExhausted: false,
        }));
        this.serviceBaseLogger.info(`Initialized with ${this.keys.length} API keys. Max usage/key: ${this.maxUsagePerKey}, Rotation delay: ${this.rotationDelay}ms`);
    }

    // Helper để tạo logger cho phương thức với context từ parentLogger
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        // Thêm context của serviceMethod vào, giữ lại context từ parentLogger (nếu có)
        return base.child({ serviceMethod: `ApiKeyManager.${methodName}`, ...additionalContext });
    }


    // Phương thức getNextKey giờ đây chấp nhận parentLogger
    public async getNextKey(parentLogger?: Logger): Promise<string | null> {
        // Tạo logger cho lần gọi này, thừa hưởng context từ parentLogger
        const logger = this.getMethodLogger(parentLogger, 'getNextKey');

        const startIndex = (this.currentKeyIndex + 1) % this.keys.length;

        for (let i = 0; i < this.keys.length; i++) {
            const keyIndex = (startIndex + i) % this.keys.length;
            const keyInfo = this.keys[keyIndex];
            const keyContext = { keyIndex, currentUsage: keyInfo.usageCount, isExhaustedFlag: keyInfo.isExhausted };

            if (keyInfo.isExhausted) {
                logger.debug(keyContext, `Key is marked exhausted, skipping.`);
                continue;
            }

            if (keyInfo.usageCount >= this.maxUsagePerKey) {
                logger.warn({ ...keyContext, maxUsage: this.maxUsagePerKey }, `Key reached usage limit. Marking as exhausted.`);
                keyInfo.isExhausted = true;
                continue;
            }

            const now = Date.now();
            const timeSinceLastUse = now - keyInfo.lastUsed;
            if (this.currentKeyIndex !== -1 && keyIndex === this.currentKeyIndex && timeSinceLastUse < this.rotationDelay) {
                const waitTime = this.rotationDelay - timeSinceLastUse;
                logger.debug({ ...keyContext, waitTimeMs: waitTime }, `Waiting for rotation delay on key...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            this.currentKeyIndex = keyIndex;
            keyInfo.usageCount++;
            keyInfo.lastUsed = Date.now();
            this.totalRequests++;
            logger.info({ // Dùng info khi key được cung cấp thành công
                 keyIndexProvided: keyIndex,
                 newUsageCount: keyInfo.usageCount,
                 totalRequestsAcrossAllKeys: this.totalRequests
            }, `Providing API key`);
            return keyInfo.key;
        }

        logger.error("All API keys are exhausted or unusable after checking all available keys.");
        return null;
    }

    // forceRotate cũng chấp nhận parentLogger
    public async forceRotate(parentLogger?: Logger): Promise<boolean> {
        const logger = this.getMethodLogger(parentLogger, 'forceRotate');

        if (this.currentKeyIndex === -1) {
             logger.warn("forceRotate called but no key was previously selected. Cannot mark key as exhausted.");
             // Vẫn thử lấy key tiếp theo vì có thể là lần đầu tiên hoặc không có key nào đang active
        } else {
            const currentKeyInfo = this.keys[this.currentKeyIndex];
            if (!currentKeyInfo.isExhausted) {
                logger.warn({ keyIndex: this.currentKeyIndex, currentUsage: currentKeyInfo.usageCount }, `Forcing key to exhausted due to external error (e.g., quota).`);
                currentKeyInfo.isExhausted = true;
            } else {
                logger.debug({ keyIndex: this.currentKeyIndex }, `Key was already marked exhausted. Proceeding to find next key.`);
            }
        }

        // Gọi getNextKey với logger hiện tại để nó có cùng context
        const nextKey = await this.getNextKey(logger);
        if (nextKey) {
            logger.info(`Successfully rotated to a new key after forceRotate.`);
        } else {
            logger.error(`Failed to rotate to a new key after forceRotate (all keys likely exhausted).`);
        }
        return nextKey !== null;
    }

    // areAllKeysExhausted có thể chấp nhận logger nếu cần log chi tiết hơn, nhưng thường không cần
    public areAllKeysExhausted(parentLogger?: Logger): boolean {
        const logger = this.getMethodLogger(parentLogger, 'areAllKeysExhausted_check');
        const allExhausted = this.keys.every(k => k.isExhausted || k.usageCount >= this.maxUsagePerKey);
        if (allExhausted) {
             // Log này có thể hơi thừa nếu getNextKey đã log "All API keys are exhausted"
             // Tuy nhiên, nó xác nhận trạng thái tại thời điểm gọi
             logger.warn("Check confirmed: All API keys are currently considered exhausted.");
        } else {
            logger.trace("Check: Not all keys are exhausted.");
        }
        return allExhausted;
    }

    // Các hàm getter thường không cần logger, trừ khi bạn muốn log mỗi lần chúng được gọi
    public getCurrentKeyIndex(): number {
        return this.currentKeyIndex;
    }

    public getCurrentKeyUsage(parentLogger?: Logger): number {
        // Nếu muốn log mỗi lần gọi, có thể thêm:
        // const logger = this.getMethodLogger(parentLogger, 'getCurrentKeyUsage');
        // logger.trace({ currentIndex: this.currentKeyIndex }, "Getting current key usage.");
        return this.currentKeyIndex !== -1 ? this.keys[this.currentKeyIndex].usageCount : 0;
    }

    public getTotalRequests(): number {
        return this.totalRequests;
    }
}