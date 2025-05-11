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
    private currentKeyIndex: number = -1; // 0-based
    private totalRequests: number = 0;
    private readonly maxUsagePerKey: number;
    private readonly rotationDelay: number;
    private readonly serviceBaseLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger({ service: 'ApiKeyManagerBase' });

        const apiKeys = this.configService.config.GOOGLE_CUSTOM_SEARCH_API_KEYS;
        this.maxUsagePerKey = this.configService.config.MAX_USAGE_PER_KEY;
        this.rotationDelay = this.configService.config.KEY_ROTATION_DELAY_MS;

        if (!apiKeys || apiKeys.length === 0) {
            this.serviceBaseLogger.error({ event: 'init_no_keys_error' },'No Google Search API keys found in configuration.');
            throw new Error('Google Search API keys are required.');
        }

        this.keys = apiKeys.map(key => ({
            key,
            usageCount: 0,
            lastUsed: 0,
            isExhausted: false,
        }));
        this.serviceBaseLogger.info(
            {
                keyCount: this.keys.length,
                maxUsagePerKey: this.maxUsagePerKey,
                rotationDelayMs: this.rotationDelay,
                event: 'init_success'
            },
            `Initialized with ${this.keys.length} API keys.`
        );
    }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `ApiKeyManager.${methodName}`, ...additionalContext });
    }

    public async getNextKey(parentLogger?: Logger): Promise<string | null> {
        const logger = this.getMethodLogger(parentLogger, 'getNextKey');
        const initialKeyIndexAttempt = this.currentKeyIndex; // Để debug nếu không tìm thấy key

        // Bắt đầu tìm từ key tiếp theo của key hiện tại (hoặc từ 0 nếu chưa có key nào được chọn)
        const startIndex = (this.currentKeyIndex + 1) % this.keys.length;

        for (let i = 0; i < this.keys.length; i++) {
            const keyIndexToTry = (startIndex + i) % this.keys.length; // 0-based
            const keyInfo = this.keys[keyIndexToTry];
            const keyContext = { keyIndex: keyIndexToTry, currentUsage: keyInfo.usageCount, isExhaustedFlag: keyInfo.isExhausted };

            if (keyInfo.isExhausted) {
                logger.debug({ ...keyContext, event: 'key_check_skipped_exhausted_flag' }, `Key is marked exhausted, skipping.`);
                continue;
            }

            if (keyInfo.usageCount >= this.maxUsagePerKey) {
                logger.warn({ ...keyContext, maxUsage: this.maxUsagePerKey, event: 'api_key_usage_limit_reached' }, `Key reached usage limit. Marking as exhausted.`);
                keyInfo.isExhausted = true;
                continue;
            }

            const now = Date.now();
            const timeSinceLastUse = now - keyInfo.lastUsed;

            // Chỉ áp dụng rotationDelay nếu key này là key đang được sử dụng (currentKeyIndex)
            // và nó không phải là lần đầu tiên lấy key (currentKeyIndex !== -1)
            // và nó không phải là key mới sau khi vừa xoay vòng (keyIndexToTry === this.currentKeyIndex)
            if (this.currentKeyIndex !== -1 && keyIndexToTry === this.currentKeyIndex && timeSinceLastUse < this.rotationDelay && this.rotationDelay > 0) {
                const waitTime = this.rotationDelay - timeSinceLastUse;
                logger.debug({ ...keyContext, waitTimeMs: waitTime, event: 'key_rotation_delay_wait' }, `Waiting for rotation delay on current key...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                // Sau khi đợi, kiểm tra lại key một lần nữa vì trạng thái có thể đã thay đổi
                if (keyInfo.isExhausted || keyInfo.usageCount >= this.maxUsagePerKey) {
                    logger.warn({ ...keyContext, event: 'key_check_failed_after_delay' }, `Key became unusable after rotation delay.`);
                    continue;
                }
            }

            this.currentKeyIndex = keyIndexToTry;
            keyInfo.usageCount++;
            keyInfo.lastUsed = Date.now();
            this.totalRequests++;
            logger.info({
                 keyIndex: this.currentKeyIndex, // QUAN TRỌNG: Sử dụng 'keyIndex' (0-based)
                 newUsageCount: keyInfo.usageCount,
                 totalRequestsAcrossAllKeys: this.totalRequests,
                 event: 'api_key_provided' // Thêm event
            }, `Providing API key`);
            return keyInfo.key;
        }

        logger.error({
            initialKeyIndexAttempt,
            checkedKeysCount: this.keys.length,
            event: 'api_keys_all_exhausted_checked' // Thêm event
        }, "All API keys are exhausted or unusable after checking all available keys.");
        return null;
    }

    public async forceRotate(parentLogger?: Logger): Promise<boolean> {
        const logger = this.getMethodLogger(parentLogger, 'forceRotate');
        const oldKeyIndex = this.currentKeyIndex;

        if (this.currentKeyIndex === -1) {
             logger.warn({ event: 'force_rotate_no_active_key' }, "forceRotate called but no key was previously selected. Will attempt to get a new key.");
        } else {
            const currentKeyInfo = this.keys[this.currentKeyIndex];
            if (!currentKeyInfo.isExhausted) {
                logger.warn({ keyIndex: this.currentKeyIndex, currentUsage: currentKeyInfo.usageCount, event: 'force_rotate_marking_exhausted' }, `Forcing key to exhausted due to external error (e.g., quota).`);
                currentKeyInfo.isExhausted = true;
            } else {
                logger.debug({ keyIndex: this.currentKeyIndex, event: 'force_rotate_already_exhausted' }, `Key was already marked exhausted. Proceeding to find next key.`);
            }
        }

        // Cố gắng lấy key tiếp theo, truyền logger hiện tại để giữ context
        const nextKey = await this.getNextKey(logger);
        if (nextKey) {
            logger.info({ oldKeyIndex, newKeyIndex: this.currentKeyIndex, event: 'api_key_force_rotated_success' }, `Successfully rotated to a new key after forceRotate.`);
            return true;
        } else {
            logger.error({ oldKeyIndex, event: 'api_key_force_rotated_fail' }, `Failed to rotate to a new key after forceRotate (all keys likely exhausted).`);
            return false;
        }
    }

    public areAllKeysExhausted(parentLogger?: Logger): boolean {
        const logger = this.getMethodLogger(parentLogger, 'areAllKeysExhausted_check');
        const allExhausted = this.keys.every(k => k.isExhausted || k.usageCount >= this.maxUsagePerKey);
        if (allExhausted) {
             logger.warn({ event: 'api_keys_all_exhausted_status' }, "Check confirmed: All API keys are currently considered exhausted.");
        } else {
            logger.trace({ event: 'api_keys_not_all_exhausted_status' }, "Check: Not all keys are exhausted.");
        }
        return allExhausted;
    }

    public getCurrentKeyIndex(): number {
        // Không cần log ở đây trừ khi debug đặc biệt
        return this.currentKeyIndex; // 0-based
    }

    public getCurrentKeyUsage(parentLogger?: Logger): number {
        // const logger = this.getMethodLogger(parentLogger, 'getCurrentKeyUsage');
        // logger.trace({ currentIndex: this.currentKeyIndex }, "Getting current key usage.");
        return this.currentKeyIndex !== -1 ? this.keys[this.currentKeyIndex].usageCount : 0;
    }

    public getTotalRequests(): number {
        return this.totalRequests;
    }
}