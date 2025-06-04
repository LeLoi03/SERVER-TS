// src/config/google-search.config.ts
import { singleton } from 'tsyringe';
import { AppConfig, GoogleSearchConfigStruct } from './types';

@singleton()
export class GoogleSearchConfig {
    public readonly cseId: string | undefined;
    public readonly apiKeys: string[];
    public readonly maxUsagePerKey: number;
    public readonly rotationDelayMs: number;
    public readonly maxRetries: number;
    public readonly retryDelayMs: number;

    constructor(private appConfig: AppConfig) {
        this.cseId = appConfig.GOOGLE_CSE_ID;
        this.apiKeys = appConfig.GOOGLE_CUSTOM_SEARCH_API_KEYS; // This is the augmented list
        this.maxUsagePerKey = appConfig.MAX_USAGE_PER_KEY;
        this.rotationDelayMs = appConfig.KEY_ROTATION_DELAY_MS;
        this.maxRetries = appConfig.MAX_SEARCH_RETRIES;
        this.retryDelayMs = appConfig.RETRY_DELAY_MS;
    }

    public get config(): GoogleSearchConfigStruct {
        return {
            cseId: this.cseId,
            apiKeys: this.apiKeys,
            maxUsagePerKey: this.maxUsagePerKey,
            rotationDelayMs: this.rotationDelayMs,
            maxRetries: this.maxRetries,
            retryDelayMs: this.retryDelayMs,
        };
    }
}