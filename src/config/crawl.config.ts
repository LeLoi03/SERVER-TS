// src/config/crawl.config.ts
import { singleton } from 'tsyringe';
import { AppConfig } from './types';

@singleton()
export class CrawlConfiguration {
    public readonly year1: number;
    public readonly year2: number;
    public readonly year3: number;
    public readonly searchQueryTemplate: string;
    public readonly maxLinks: number;

    public readonly unwantedDomains: string[];
    public readonly skipKeywords: string[];
    public readonly mainContentKeywords: string[];
    public readonly cfpTabKeywords: string[];
    public readonly importantDatesTabs: string[];
    public readonly excludeTexts: string[];
    public readonly exactKeywords: string[];
    public readonly imageKeywords: string[];


    constructor(private appConfig: AppConfig) {
        this.year1 = appConfig.YEAR1;
        this.year2 = appConfig.YEAR2;
        this.year3 = appConfig.YEAR3;
        this.searchQueryTemplate = appConfig.SEARCH_QUERY_TEMPLATE;
        this.maxLinks = appConfig.MAX_LINKS;

        this.unwantedDomains = appConfig.UNWANTED_DOMAINS || [];
        this.skipKeywords = appConfig.SKIP_KEYWORDS || [];
        this.mainContentKeywords = appConfig.MAIN_CONTENT_KEYWORDS || [];
        this.cfpTabKeywords = appConfig.CFP_TAB_KEYWORDS || [];
        this.importantDatesTabs = appConfig.IMPORTANT_DATES_TABS || [];
        this.excludeTexts = appConfig.EXCLUDE_TEXTS || [];
        this.exactKeywords = appConfig.EXACT_KEYWORDS || [];
        this.imageKeywords = appConfig.IMAGE_KEYWORDS || [];

    }
}