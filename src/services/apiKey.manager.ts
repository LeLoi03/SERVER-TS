// src/services/apiKey.manager.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { Mutex } from 'async-mutex'; // << THÊM VÀO

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
    private readonly mutex = new Mutex(); // << KHỞI TẠO MUTEX

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
        // Tùy chọn: Có thể chọn key đầu tiên ngay tại đây nếu muốn
        // this.selectInitialKey();
    }

    // private async selectInitialKey(): Promise<void> { // Ví dụ nếu muốn chọn key ban đầu
    //     await this.mutex.runExclusive(async () => {
    //        if (this.keys.length > 0) {
    //             this.currentKeyIndex = 0;
    //             this.serviceBaseLogger.info({ event: 'initial_key_selected', keyIndex: 0 }, `Selected initial API key.`);
    //        }
    //     });
    // }

    private getMethodLogger(parentLogger: Logger | undefined, methodName: string, additionalContext?: object): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `ApiKeyManager.${methodName}`, ...additionalContext });
    }

    public async getNextKey(parentLogger?: Logger): Promise<string | null> {
        // Sử dụng mutex để đảm bảo chỉ một luồng thực thi vào critical section này tại một thời điểm
        return this.mutex.runExclusive(async () => {
            const logger = this.getMethodLogger(parentLogger, 'getNextKey_locked');
            const initialKeyIndexAttempt = this.currentKeyIndex;

            // Bắt đầu tìm từ key tiếp theo của key hiện tại (hoặc từ 0 nếu chưa có key nào được chọn hoặc quay vòng)
            const startIndex = (this.currentKeyIndex === -1) ? 0 : (this.currentKeyIndex + 1) % this.keys.length;

            for (let i = 0; i < this.keys.length; i++) {
                const keyIndexToTry = (startIndex + i) % this.keys.length;
                const keyInfo = this.keys[keyIndexToTry];
                const keyContext = { keyIndex: keyIndexToTry, currentUsage: keyInfo.usageCount, isExhaustedFlag: keyInfo.isExhausted };

                if (keyInfo.isExhausted) {
                    logger.debug({ ...keyContext, event: 'key_check_skipped_exhausted_flag_locked' }, `Key is marked exhausted, skipping.`);
                    continue;
                }

                if (keyInfo.usageCount >= this.maxUsagePerKey) {
                    logger.warn({ ...keyContext, maxUsage: this.maxUsagePerKey, event: 'api_key_usage_limit_reached_locked' }, `Key reached usage limit. Marking as exhausted.`);
                    keyInfo.isExhausted = true; // Đánh dấu exhausted bên trong lock
                    continue;
                }

                const now = Date.now();
                // Chỉ áp dụng rotationDelay nếu:
                // 1. Đã có key được chọn trước đó (currentKeyIndex !== -1)
                // 2. Key đang thử LÀ key hiện tại (keyIndexToTry === this.currentKeyIndex)
                // 3. Thời gian từ lần sử dụng cuối < rotationDelay
                // 4. rotationDelay > 0
                // Mục đích: tránh dùng CÙNG MỘT KEY quá nhanh liên tiếp.
                if (
                    this.currentKeyIndex !== -1 &&
                    keyIndexToTry === this.currentKeyIndex &&
                    (now - keyInfo.lastUsed) < this.rotationDelay &&
                    this.rotationDelay > 0
                ) {
                    const timeSinceLastUse = now - keyInfo.lastUsed;
                    const waitTime = this.rotationDelay - timeSinceLastUse;
                    logger.debug({ ...keyContext, waitTimeMs: waitTime, event: 'key_rotation_delay_wait_locked' }, `Waiting for rotation delay on current key...`);
                    await new Promise(resolve => setTimeout(resolve, waitTime)); // Lock được giữ trong khi đợi

                    // Sau khi đợi, kiểm tra lại key một lần nữa vì trạng thái có thể đã thay đổi (ít khả năng với lock toàn cục, nhưng là good practice)
                    if (keyInfo.isExhausted || keyInfo.usageCount >= this.maxUsagePerKey) {
                        logger.warn({ ...keyContext, event: 'key_check_failed_after_delay_locked' }, `Key became unusable after rotation delay.`);
                        continue; // Thử key tiếp theo
                    }
                }

                this.currentKeyIndex = keyIndexToTry;
                keyInfo.usageCount++;
                keyInfo.lastUsed = Date.now(); // Cập nhật sau khi tăng usageCount
                this.totalRequests++;
                logger.info({
                     keyIndex: this.currentKeyIndex,
                     newUsageCount: keyInfo.usageCount,
                     totalRequestsAcrossAllKeys: this.totalRequests,
                     event: 'api_key_provided_locked'
                }, `Providing API key`);
                return keyInfo.key;
            }

            logger.error({
                initialKeyIndexAttempt,
                checkedKeysCount: this.keys.length,
                currentKeyIndexAfterLoop: this.currentKeyIndex,
                keysStatus: this.keys.map(k => ({key: k.key.substring(0,5)+'...', usage: k.usageCount, exhausted: k.isExhausted})),
                event: 'api_keys_all_exhausted_checked_locked'
            }, "All API keys are exhausted or unusable after checking all available keys inside lock.");
            return null;
        });
    }

    public async forceRotate(parentLogger?: Logger): Promise<boolean> {
        return this.mutex.runExclusive(async () => {
            const logger = this.getMethodLogger(parentLogger, 'forceRotate_locked');
            const oldKeyIndex = this.currentKeyIndex;

            if (this.currentKeyIndex === -1) {
                 logger.warn({ event: 'force_rotate_no_active_key_locked' }, "forceRotate called but no key was previously selected. Will attempt to get a new key.");
            } else {
                const currentKeyInfo = this.keys[this.currentKeyIndex];
                if (!currentKeyInfo.isExhausted) {
                    logger.warn({ keyIndex: this.currentKeyIndex, currentUsage: currentKeyInfo.usageCount, event: 'force_rotate_marking_exhausted_locked' }, `Forcing key to exhausted due to external error (e.g., quota).`);
                    currentKeyInfo.isExhausted = true;
                } else {
                    logger.debug({ keyIndex: this.currentKeyIndex, event: 'force_rotate_already_exhausted_locked' }, `Key was already marked exhausted. Proceeding to find next key.`);
                }
            }

            // Cố gắng lấy key tiếp theo. getNextKey() đã được bảo vệ bởi mutex.
            // Do runExclusive là reentrant cho cùng một async context (Promise chain),
            // cuộc gọi này sẽ hoạt động tuần tự sau khi phần trên của forceRotate hoàn thành,
            // hoặc nếu getNextKey được gọi từ một "luồng" khác, nó sẽ đợi.
            const nextKey = await this.getNextKey(logger); // Truyền logger để giữ context

            if (nextKey) {
                // this.currentKeyIndex đã được cập nhật bởi getNextKey
                logger.info({ oldKeyIndex, newKeyIndex: this.currentKeyIndex, event: 'api_key_force_rotated_success_locked' }, `Successfully rotated to a new key after forceRotate.`);
                return true;
            } else {
                logger.error({ oldKeyIndex, event: 'api_key_force_rotated_fail_locked' }, `Failed to rotate to a new key after forceRotate (all keys likely exhausted).`);
                return false;
            }
        });
    }

    public areAllKeysExhausted(parentLogger?: Logger): boolean {
        // Thao tác này chỉ đọc, không thay đổi trạng thái, về lý thuyết không cần lock
        // nếu các thao tác ghi (getNextKey, forceRotate) đã được lock.
        // Tuy nhiên, để đảm bảo đọc được trạng thái nhất quán nhất ngay cả khi có thao tác ghi đang diễn ra,
        // có thể xem xét lock nếu cần độ chính xác tuyệt đối tại một thời điểm.
        // Hiện tại, để đơn giản, không lock vì nó chủ yếu dùng cho logging hoặc điều kiện thoát sớm.
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
        // Chỉ đọc, không cần lock
        return this.currentKeyIndex;
    }

    public getCurrentKeyUsage(parentLogger?: Logger): number {
        // Chỉ đọc, không cần lock, nhưng cẩn thận nếu currentKeyIndex thay đổi bởi luồng khác
        // Để an toàn hơn, có thể lấy thông tin key dựa trên index trả về từ getCurrentKeyIndex()
        // Tuy nhiên, vì currentKeyIndex cũng có thể thay đổi, việc đọc này luôn có độ trễ nhỏ.
        // Với mục đích logging, điều này thường chấp nhận được.
        // const logger = this.getMethodLogger(parentLogger, 'getCurrentKeyUsage');
        if (this.currentKeyIndex !== -1 && this.keys[this.currentKeyIndex]) {
            return this.keys[this.currentKeyIndex].usageCount;
        }
        return 0;
    }

    public getTotalRequests(): number {
        // Chỉ đọc, không cần lock
        return this.totalRequests;
    }

     // Thêm một phương thức để reset trạng thái các key (ví dụ, khi qua ngày mới và quota được reset)
     public async resetAllKeysState(parentLogger?: Logger): Promise<void> {
        await this.mutex.runExclusive(async () => {
            const logger = this.getMethodLogger(parentLogger, 'resetAllKeysState_locked');
            logger.info({ event: 'all_keys_state_reset_start_locked' }, "Resetting state for all API keys.");
            this.keys.forEach(keyInfo => {
                keyInfo.usageCount = 0;
                keyInfo.isExhausted = false;
                // keyInfo.lastUsed = 0; // Có thể reset lastUsed hoặc không tùy logic
            });
            this.currentKeyIndex = -1; // Buộc chọn lại key từ đầu
            // this.totalRequests = 0; // Reset totalRequests nếu cần
            logger.info({
                keyCount: this.keys.length,
                event: 'all_keys_state_reset_finish_locked'
            }, "All API keys have been reset. Next call to getNextKey will select a fresh key.");
        });
    }
}