// src/config/journal.config.ts
import { singleton } from 'tsyringe';
import { AppConfig, JournalCacheOptionsStruct, JournalRetryOptionsStruct } from './types';

@singleton()
export class JournalConfig {
    public readonly baseUrl: string;
    public readonly retryRetries: number;
    public readonly retryMinTimeout: number;
    public readonly retryFactor: number;
    public readonly cacheTtl: number;
    public readonly cacheCheckPeriod: number;
    public readonly crawlBioxbio: boolean;
    public readonly crawlMode: 'scimago' | 'csv';
    public readonly crawlDetails: boolean;
    public readonly csvHeaders: string[];

    constructor(private appConfig: AppConfig) {
        this.baseUrl = appConfig.JOURNAL_BASE_URL;
        this.retryRetries = appConfig.JOURNAL_RETRY_RETRIES;
        this.retryMinTimeout = appConfig.JOURNAL_RETRY_MIN_TIMEOUT;
        this.retryFactor = appConfig.JOURNAL_RETRY_FACTOR;
        this.cacheTtl = appConfig.JOURNAL_CACHE_TTL;
        this.cacheCheckPeriod = appConfig.JOURNAL_CACHE_CHECK_PERIOD;
        this.crawlBioxbio = appConfig.JOURNAL_CRAWL_BIOXBIO;
        this.crawlMode = appConfig.JOURNAL_CRAWL_MODE;
        this.crawlDetails = appConfig.JOURNAL_CRAWL_DETAILS;
        this.csvHeaders = appConfig.JOURNAL_CSV_HEADERS.split(',').map(h => h.trim());
    }

    public get retryOptions(): JournalRetryOptionsStruct {
        return {
            retries: this.retryRetries,
            minTimeout: this.retryMinTimeout,
            factor: this.retryFactor,
        };
    }

    public get cacheOptions(): JournalCacheOptionsStruct {
        return {
            stdTTL: this.cacheTtl,
            checkperiod: this.cacheCheckPeriod,
        };
    }
}