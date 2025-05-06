// src/services/apiKey.manager.ts (hoặc giữ tên cũ)
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino'; // Import Logger từ pino

interface ApiKeyInfo {
    key: string;
    usageCount: number;
    lastUsed: number;
    isExhausted: boolean;
}

@singleton()
export class ApiKeyManager {
    private keys: ApiKeyInfo[];
    private currentKeyIndex: number = -1; // Bắt đầu từ -1 để lần đầu tiên getNextKey() chọn key 0
    private totalRequests: number = 0;
    private readonly maxUsagePerKey: number;
    private readonly rotationDelay: number;
    private readonly logger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService
    ) {
        this.logger = this.loggingService.getLogger({ service: 'ApiKeyManager' });

        const apiKeys = this.configService.config.GOOGLE_CUSTOM_SEARCH_API_KEYS;
        this.maxUsagePerKey = this.configService.config.MAX_USAGE_PER_KEY;
        this.rotationDelay = this.configService.config.KEY_ROTATION_DELAY_MS;

        if (!apiKeys || apiKeys.length === 0) {
            this.logger.error('No Google Search API keys found in configuration.');
            throw new Error('Google Search API keys are required.');
        }

        this.keys = apiKeys.map(key => ({
            key,
            usageCount: 0,
            lastUsed: 0,
            isExhausted: false,
        }));
        this.logger.info(`Initialized with ${this.keys.length} API keys. Max usage/key: ${this.maxUsagePerKey}, Rotation delay: ${this.rotationDelay}ms`);
    }

    public async getNextKey(): Promise<string | null> {
        const startIndex = (this.currentKeyIndex + 1) % this.keys.length;
        let triedIndices = 0;

        for (let i = 0; i < this.keys.length; i++) {
            const keyIndex = (startIndex + i) % this.keys.length;
            const keyInfo = this.keys[keyIndex];

            if (keyInfo.isExhausted) {
                this.logger.debug({ keyIndex }, `Key ${keyIndex} is marked exhausted, skipping.`);
                continue;
            }

            // Check usage count
            if (keyInfo.usageCount >= this.maxUsagePerKey) {
                this.logger.warn({ keyIndex, usage: keyInfo.usageCount }, `Key ${keyIndex} reached usage limit (${this.maxUsagePerKey}). Marking as exhausted.`);
                keyInfo.isExhausted = true;
                continue;
            }

            // Check rotation delay (optional, nhưng giữ lại từ code gốc)
            const now = Date.now();
            const timeSinceLastUse = now - keyInfo.lastUsed;
            if (this.currentKeyIndex !== -1 && keyIndex === this.currentKeyIndex && timeSinceLastUse < this.rotationDelay) {
                const waitTime = this.rotationDelay - timeSinceLastUse;
                this.logger.debug({ keyIndex, waitTimeMs: waitTime }, `Waiting for rotation delay on key ${keyIndex}...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Key hợp lệ
            this.currentKeyIndex = keyIndex;
            keyInfo.usageCount++;
            keyInfo.lastUsed = Date.now();
            this.totalRequests++;
            this.logger.debug({ keyIndex, usage: keyInfo.usageCount, totalRequests: this.totalRequests }, `Providing API key ${keyIndex}`);
            return keyInfo.key;
        }

        // Nếu chạy hết vòng lặp mà không tìm thấy key hợp lệ
        this.logger.error("All API keys are exhausted or unusable.");
        return null;
    }

    // Hàm này được gọi khi Google trả về lỗi quota/rate limit
    public async forceRotate(): Promise<boolean> {
        if (this.currentKeyIndex === -1) {
             this.logger.warn("forceRotate called but no key was previously selected.");
             return false; // Không có key nào để đánh dấu
        }

        const currentKey = this.keys[this.currentKeyIndex];
        if (!currentKey.isExhausted) {
            this.logger.warn({ keyIndex: this.currentKeyIndex }, `Forcing key ${this.currentKeyIndex} to exhausted due to external error (e.g., quota).`);
            currentKey.isExhausted = true;
        }

        // Thử tìm key *khác* ngay lập tức
        const nextKey = await this.getNextKey(); // getNextKey sẽ tự động bỏ qua key vừa đánh dấu
        return nextKey !== null; // Trả về true nếu tìm được key mới, false nếu hết key
    }


    public areAllKeysExhausted(): boolean {
        const allExhausted = this.keys.every(k => k.isExhausted || k.usageCount >= this.maxUsagePerKey);
        if (allExhausted) {
             this.logger.warn("All API keys are now considered exhausted.");
        }
        return allExhausted;
    }

    public getCurrentKeyIndex(): number {
        return this.currentKeyIndex;
    }

    public getCurrentKeyUsage(): number {
         return this.currentKeyIndex !== -1 ? this.keys[this.currentKeyIndex].usageCount : 0;
    }

    public getTotalRequests(): number {
        return this.totalRequests;
    }
}