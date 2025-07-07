// src/config/config.service.ts
import 'reflect-metadata';
import { singleton, autoInjectable } from 'tsyringe'; // Giữ autoInjectable nếu tất cả dependencies là injectable
import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { GenerationConfig as SDKGenerationConfig } from "@google/genai";

import { envSchema } from './schemas'; // Đảm bảo schema này bao gồm các biến môi trường mới cho tên file log
import { AppConfig, GeminiApiConfigs, GoogleSearchConfigStruct, JournalCacheOptionsStruct, JournalRetryOptionsStruct, PlaywrightConfigStruct } from './types';
import { AgentId } from '../chatbot/shared/types';

import { AppConfiguration } from './app.config';
import { PlaywrightConfig } from './playwright.config';
import { CrawlConfiguration } from './crawl.config';
import { GoogleSearchConfig } from './google-search.config';
import { GeminiBaseConfig } from './gemini-base.config';
import { GeminiApiTypeConfig } from './gemini-api-type.config';
import { JournalConfig } from './journal.config';
import { ChatbotConfig } from './chatbot.config';

@singleton()
@autoInjectable()
export class ConfigService {
    public readonly rawConfig: AppConfig;

    private playwrightConfiguration: PlaywrightConfig;
    private crawlConfiguration: CrawlConfiguration;
    private googleSearchConfiguration: GoogleSearchConfig;
    private geminiBaseConfiguration: GeminiBaseConfig;
    private journalConfiguration: JournalConfig;
    private chatbotConfiguration: ChatbotConfig;
    public readonly geminiApiTypeConfiguration: GeminiApiTypeConfig;
    public appConfiguration: AppConfiguration;

    constructor() {
        dotenv.config();

        try {
            const parsedEnv = envSchema.parse(process.env);

            const googleApiKeys: string[] = [];
            const googleKeyPattern = /^CUSTOM_SEARCH_API_KEY_\d+$/;
            if (parsedEnv.GOOGLE_CUSTOM_SEARCH_API_KEYS && parsedEnv.GOOGLE_CUSTOM_SEARCH_API_KEYS.length > 0) {
                googleApiKeys.push(...parsedEnv.GOOGLE_CUSTOM_SEARCH_API_KEYS);
            }
            for (const envVar in process.env) {
                if (googleKeyPattern.test(envVar) && process.env[envVar]) {
                    googleApiKeys.push(process.env[envVar] as string);
                }
            }
            const uniqueGoogleApiKeys = [...new Set(googleApiKeys)];

            const geminiApiKeysN: string[] = [];
            const geminiKeyPattern = /^GEMINI_API_KEY_\d+$/;
            for (const envVar in process.env) {
                if (geminiKeyPattern.test(envVar) && process.env[envVar]) {
                    geminiApiKeysN.push(process.env[envVar] as string);
                }
            }
            const uniqueGeminiApiKeysN = [...new Set(geminiApiKeysN)];

            this.rawConfig = {
                ...parsedEnv,
                GOOGLE_CUSTOM_SEARCH_API_KEYS: uniqueGoogleApiKeys,
                GEMINI_API_KEYS: uniqueGeminiApiKeysN,
            };

            // --- Post-validation checks and default assignments ---
            // (Giữ nguyên phần kiểm tra model lists, CORS, ALLOWED_SUB_AGENTS, GOOGLE_CSE_ID, GEMINI_API_KEYS)
            const requiredModelLists = [
                { key: 'GEMINI_EXTRACT_TUNED_MODEL_NAMES', value: this.rawConfig.GEMINI_EXTRACT_TUNED_MODEL_NAMES },
                { key: 'GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES', value: this.rawConfig.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES },
                { key: 'GEMINI_CFP_TUNED_MODEL_NAMES', value: this.rawConfig.GEMINI_CFP_TUNED_MODEL_NAMES },
                { key: 'GEMINI_CFP_NON_TUNED_MODEL_NAMES', value: this.rawConfig.GEMINI_CFP_NON_TUNED_MODEL_NAMES },
                { key: 'GEMINI_DETERMINE_TUNED_MODEL_NAMES', value: this.rawConfig.GEMINI_DETERMINE_TUNED_MODEL_NAMES },
                { key: 'GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES', value: this.rawConfig.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES },
            ];

            for (const modelList of requiredModelLists) {
                if (!modelList.value || modelList.value.length === 0) {
                    const errorMsg = `Configuration error: ${modelList.key} must be a non-empty list of model names. Please check your .env file.`;
                    console.error(`❌ FATAL: ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            }

            if (!this.rawConfig.CORS_ALLOWED_ORIGINS || this.rawConfig.CORS_ALLOWED_ORIGINS.length === 0) {
                this.rawConfig.CORS_ALLOWED_ORIGINS = ['*'];
                console.log(`[ConfigService] INFO: CORS_ALLOWED_ORIGINS not set, defaulting to ['*'].`);
            }

            if (!this.rawConfig.ALLOWED_SUB_AGENTS || this.rawConfig.ALLOWED_SUB_AGENTS.length === 0) {
                console.warn("⚠️ WARN: ALLOWED_SUB_AGENTS not set or empty in .env, using default list.");
                this.rawConfig.ALLOWED_SUB_AGENTS = [
                    'ConferenceAgent', 'JournalAgent', 'AdminContactAgent',
                    'NavigationAgent', 'WebsiteInfoAgent'
                ] as AgentId[];
            }

            if (!this.rawConfig.GOOGLE_CSE_ID) {
                console.warn("⚠️ WARN: GOOGLE_CSE_ID environment variable is not set. Google Custom Search might not function.");
            }
            if (this.rawConfig.GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
                console.warn("⚠️ WARN: No Google Custom Search API Keys found (CUSTOM_SEARCH_API_KEY_N or GOOGLE_CUSTOM_SEARCH_API_KEYS). Google Custom Search might not function.");
            }

            if (this.rawConfig.GEMINI_API_KEYS.length === 0) {
                console.warn("⚠️ WARN: No additional GEMINI_API_KEY_N environment variables found. Only the primary GEMINI_API_KEY will be used unless it's also part of a GEMINI_API_KEY_N pattern.");
            }


            // Instantiate specialized config classes
            this.appConfiguration = new AppConfiguration(this.rawConfig);
            this.playwrightConfiguration = new PlaywrightConfig(this.rawConfig);
            this.crawlConfiguration = new CrawlConfiguration(this.rawConfig);
            this.googleSearchConfiguration = new GoogleSearchConfig(this.rawConfig);
            this.geminiBaseConfiguration = new GeminiBaseConfig(this.rawConfig);
            this.geminiApiTypeConfiguration = new GeminiApiTypeConfig(this.rawConfig);
            this.journalConfiguration = new JournalConfig(this.rawConfig);
            this.chatbotConfiguration = new ChatbotConfig(this.rawConfig);

            console.log("✅ Configuration loaded and validated successfully.");
            console.log(`   - NODE_ENV: ${this.nodeEnv}`);
            console.log(`   - Server Port: ${this.port}`);
            console.log(`   - Log Level: ${this.logLevel}`);
            console.log(`   - Logs Directory (Main): ${this.logsDirectory}`);
            console.log(`     - App Log File Path (for writing): ${this.appLogFilePathForWriting}`);
            // Không còn conference/journal log file chung
            console.log(`     - Conference Request Logs Directory: ${this.appConfiguration.conferenceRequestLogDirectory}`);
            console.log(`     - Journal Request Logs Directory: ${this.appConfiguration.journalRequestLogDirectory}`);
            console.log(`     - Save Conference Event Log Path: ${this.getSaveConferenceEventLogFilePath()}`);
            console.log(`     - Save Journal Event Log Path: ${this.getSaveJournalEventLogFilePath()}`);


            // console.log(`   - Log Rotation Frequency: ${this.logRotationFrequency}`);
            // console.log(`   - Log Rotation Size: ${this.logRotationSize}`);
            if (this.logRotationDateFormat) console.log(`   - Log Rotation Date Format: ${this.logRotationDateFormat}`);
            if (this.logRotationLimitCount) console.log(`   - Log Rotation Limit Count: ${this.logRotationLimitCount}`);
            console.log(`   - Log Archive Dir (within logs dir): ${this.appConfiguration.logArchiveSubdir} (Actual path: ${this.logArchiveDirectoryPath})`);


            console.log(`   - Base Output Dir: ${this.baseOutputDir}`);
            console.log(`   - JSONL Output Dir: ${this.jsonlOutputDir}`);
            console.log(`   - CSV Output Dir: ${this.csvOutputDir}`);
            // Các thư mục save status giờ được lấy từ appConfiguration
            console.log(`   - Save Conference Status Dir: ${this.appConfiguration.saveConferenceEventLogDirectory}`);
            console.log(`   - Save Journal Status Dir: ${this.appConfiguration.saveJournalEventLogDirectory}`);

            console.log(`   - Analysis Cache Enabled: ${this.analysisCacheEnabled}`);
            console.log(`   - Analysis Cache TTL (s): ${this.analysisCacheTTLSeconds}`);
            console.log(`   - Analysis Cache Dir: ${this.analysisCacheDirectory}`);
            console.log(`   - Conference Analysis Cache Dir: ${this.conferenceAnalysisCacheDirectory}`);
            console.log(`   - Journal Analysis Cache Dir: ${this.journalAnalysisCacheDirectory}`);

            console.log(`   - Host Agent Model: ${this.geminiBaseConfiguration.hostAgentModelName}`);
            console.log(`   - Host Agent Config: ${JSON.stringify(this.hostAgentGenerationConfig)}`);
            console.log(`   - Sub Agent Model: ${this.geminiBaseConfiguration.subAgentModelName}`);
            console.log(`   - Sub Agent Config: ${JSON.stringify(this.subAgentGenerationConfig)}`);
            console.log(`   - Allowed Sub Agents: ${this.chatbotConfiguration.allowedSubAgents.join(', ')}`);
            console.log(`   - Max Turns Host Agent: ${this.chatbotConfiguration.maxTurnsHostAgent}`);
            console.log(`   - Primary Gemini API Key: ${this.rawConfig.GEMINI_API_KEY ? 'Set' : 'Not Set'}`);
            console.log(`   - Number of Additional Gemini API Keys (GEMINI_API_KEY_N): ${this.rawConfig.GEMINI_API_KEYS.length}`);

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Invalid environment variables (schema validation failed):", JSON.stringify(error.format(), null, 2));
            } else {
                console.error("❌ Unexpected error loading configuration:", error);
            }
            process.exit(1);
        }
    }

    public async initializeExamples(): Promise<void> {
        return this.geminiApiTypeConfiguration.initializeExamples();
    }

    // --- Delegated Getters and Properties from AppConfiguration ---
    get nodeEnv() { return this.appConfiguration.nodeEnv; }

    // +++ ADD THIS GETTER +++
    /**
     * Checks if the current environment is 'production'.
     * @returns {boolean} True if NODE_ENV is 'production', false otherwise.
     */
    public get isProduction(): boolean {
        return this.appConfiguration.nodeEnv === 'production';
    }
    // +++ END OF ADDITION +++

    get port() { return this.appConfiguration.port; }
    get jwtSecret() { return this.appConfiguration.jwtSecret; }
    get mongodbUri() { return this.appConfiguration.mongodbUri; }
    get databaseUrl() { return this.appConfiguration.databaseUrl; }
    get databaseImportEndpoint() { return this.appConfiguration.databaseImportEndpoint; }
    get corsAllowedOrigins() { return this.appConfiguration.corsAllowedOrigins; }
    get logAnalysisCronSchedule() { return this.appConfiguration.logAnalysisCronSchedule; }
    get cronTimezone() { return this.appConfiguration.cronTimezone; }
    get logLevel() { return this.appConfiguration.logLevel; }

    // Log paths
    get logsDirectory(): string { return this.appConfiguration.logsDirectoryPath; } // Thư mục logs chính

    // Đường dẫn ghi cho các file log chung (app, saveEvents)
    get appLogFilePathForWriting(): string { return this.appConfiguration.appLogFilePathForWriting; }
    // Không còn conference/journal log file chung để ghi

    // Đường dẫn đọc cho file log chung (app)
    get appLogFilePathForReading(): string { return this.appConfiguration.appLogFilePathForReading; }
    // Không còn conference/journal log file chung để đọc qua symlink

    // Phương thức mới để lấy đường dẫn file log cho request cụ thể
    public getRequestSpecificLogFilePath(type: 'conference' | 'journal', batchRequestId: string): string {
        return this.appConfiguration.getRequestSpecificLogFilePath(type, batchRequestId);
    }


    // Các getter chung chung (ví dụ: conferenceLogFilePath) sẽ bị loại bỏ hoặc thay đổi ý nghĩa
    public get appLogFilePath(): string { return this.appConfiguration.appLogFilePath; } // Vẫn dùng cho app log
    // public get conferenceLogFilePath(): string {
    //     throw new Error("General conference log file path is deprecated. Use request-specific paths.");
    // }
    // public get journalLogFilePath(): string {
    //     throw new Error("General journal log file path is deprecated. Use request-specific paths.");
    // }


    get logToConsole() { return this.appConfiguration.logToConsole; }
    get baseOutputDir(): string { return this.appConfiguration.baseOutputDirPath; }

    // Log rotation settings
    // get logRotationFrequency() { return this.appConfiguration.logRotationFrequency; }
    // get logRotationSize() { return this.appConfiguration.logRotationSize; }
    get logArchiveDirectoryPath(): string { return this.appConfiguration.logArchiveDirectoryPath; } // Thư mục archive chung
    get logRotationDateFormat(): string | undefined { return this.appConfiguration.logRotationDateFormat; }
    get logRotationLimitCount(): number | undefined { return this.appConfiguration.logRotationLimitCount; }

    // Output and Cache directories
    get jsonlOutputDir(): string { return this.appConfiguration.jsonlOutputDir; }
    get csvOutputDir(): string { return this.appConfiguration.csvOutputDir; }

    // Các thư mục save status giờ được lấy trực tiếp từ appConfiguration nếu cần đường dẫn thư mục
    // Hoặc dùng getSaveConferenceEventLogFilePath() / getSaveJournalEventLogFilePath() cho đường dẫn file cụ thể
    get saveConferenceStatusDir(): string { return this.appConfiguration.saveConferenceEventLogDirectory; }
    get saveJournalStatusDir(): string { return this.appConfiguration.saveJournalEventLogDirectory; }

    get analysisCacheDirectory(): string { return this.appConfiguration.analysisCacheDirectory; }
    get conferenceAnalysisCacheDirectory(): string { return this.appConfiguration.conferenceAnalysisCacheDirectory; }
    get journalAnalysisCacheDirectory(): string { return this.appConfiguration.journalAnalysisCacheDirectory; }
    get analysisCacheEnabled(): boolean { return this.appConfiguration.analysisCacheEnabled; }
    get analysisCacheTTLSeconds(): number { return this.appConfiguration.analysisCacheTTLSeconds; }


    get crawlConcurrency() { return this.appConfiguration.crawlConcurrency; }
    get globalCrawlConcurrency() { return this.appConfiguration.globalCrawlConcurrency; }

    get apiBaseUrl() { return this.appConfiguration.apiBaseUrl; }
    get conferenceListPath(): string { return this.appConfiguration.conferenceListPath; }
    get customSearchDir(): string { return this.appConfiguration.customSearchDir; }
    get batchesDir(): string { return this.appConfiguration.batchesDir; }
    get tempDir(): string { return this.appConfiguration.tempDir; }
    get errorAccessLinkPath(): string { return this.appConfiguration.errorAccessLinkPath; }

    // --- Delegated Getters from other specialized config classes ---
    get playwrightConfig(): PlaywrightConfigStruct { return this.playwrightConfiguration.config; }

    get year1() { return this.crawlConfiguration.year1; }
    get year2() { return this.crawlConfiguration.year2; }
    get year3() { return this.crawlConfiguration.year3; }
    get searchQueryTemplate() { return this.crawlConfiguration.searchQueryTemplate; }
    get maxLinks() { return this.crawlConfiguration.maxLinks; }
    get unwantedDomains() { return this.crawlConfiguration.unwantedDomains; }
    get skipKeywords() { return this.crawlConfiguration.skipKeywords; }
    get mainContentKeywords() { return this.crawlConfiguration.mainContentKeywords; }
    get cfpTabKeywords() { return this.crawlConfiguration.cfpTabKeywords; }
    get importantDatesTabs() { return this.crawlConfiguration.importantDatesTabs; }
    get excludeTexts() { return this.crawlConfiguration.excludeTexts; }
    get exactKeywords() { return this.crawlConfiguration.exactKeywords; }
    get imageKeywords() { return this.crawlConfiguration.imageKeywords; }

    get googleSearchConfig(): GoogleSearchConfigStruct { return this.googleSearchConfiguration.config; }

    get primaryGeminiApiKey(): string { return this.geminiBaseConfiguration.primaryApiKey; }
    get additionalGeminiApiKeys(): string[] { return this.geminiBaseConfiguration.additionalApiKeys; }
    get geminiApiConcurrency(): number { return this.geminiBaseConfiguration.apiConcurrency; }
    get geminiMaxRetries(): number { return this.geminiBaseConfiguration.maxRetries; }
    get geminiInitialDelayMs(): number { return this.geminiBaseConfiguration.initialDelayMs; }
    get geminiMaxDelayMs(): number { return this.geminiBaseConfiguration.maxDelayMs; }
    get geminiRateLimitPoints(): number { return this.geminiBaseConfiguration.rateLimitPoints; }
    get geminiRateLimitDuration(): number { return this.geminiBaseConfiguration.rateLimitDuration; }
    get geminiRateLimitBlockDuration(): number { return this.geminiBaseConfiguration.rateLimitBlockDuration; }
    get hostAgentGenerationConfig(): SDKGenerationConfig { return this.geminiBaseConfiguration.hostAgentGenerationConfig; }
    get subAgentGenerationConfig(): SDKGenerationConfig { return this.geminiBaseConfiguration.subAgentGenerationConfig; }
    get hostAgentModelName(): string { return this.geminiBaseConfiguration.hostAgentModelName; }
    get subAgentModelName(): string { return this.geminiBaseConfiguration.subAgentModelName; }

    get geminiApiConfigs(): GeminiApiConfigs { return this.geminiApiTypeConfiguration.apiConfigs; }
    get websiteDescription(): string | undefined { return this.geminiApiTypeConfiguration.websiteDescription; }

    get journalBaseUrl(): string { return this.journalConfiguration.baseUrl; }
    get journalRetryOptions(): JournalRetryOptionsStruct { return this.journalConfiguration.retryOptions; }
    get journalCacheOptions(): JournalCacheOptionsStruct { return this.journalConfiguration.cacheOptions; }
    get journalCrawlBioxbio(): boolean { return this.journalConfiguration.crawlBioxbio; }
    get journalCrawlMode(): 'scimago' | 'csv' { return this.journalConfiguration.crawlMode; }
    get journalCrawlDetails(): boolean { return this.journalConfiguration.crawlDetails; }
    get journalCsvHeaders(): string[] { return this.journalConfiguration.csvHeaders; }

    get allowedSubAgents(): AgentId[] { return this.chatbotConfiguration.allowedSubAgents; }
    get maxTurnsHostAgent(): number { return this.chatbotConfiguration.maxTurnsHostAgent; }


    // --- Path generation methods ---
    public getJournalOutputJsonlPath(): string {
        return path.join(this.jsonlOutputDir, 'journal_data.jsonl');
    }
    public getJournalOutputJsonlPathForBatch(batchRequestId: string): string {
        const filename = `journal_data_${batchRequestId}.jsonl`;
        return path.join(this.jsonlOutputDir, filename);
    }
    public getFinalOutputJsonlPathForBatch(batchRequestId: string): string {
        const filename = `final_output_${batchRequestId}.jsonl`;
        return path.join(this.jsonlOutputDir, filename);
    }
    public getEvaluateCsvPathForBatch(batchRequestId: string, baseCsvFilename: string = 'evaluate'): string {
        const filename = `${baseCsvFilename}_${batchRequestId}.csv`;
        return path.join(this.csvOutputDir, filename);
    }
    public getBaseEvaluateCsvPath(): string {
        return path.join(this.csvOutputDir, 'evaluate.csv');
    }

    // Đường dẫn file log cho save events (đã được định nghĩa trong AppConfiguration và LoggingService sử dụng)
    public getSaveConferenceEventLogFilePath(): string {
        return this.appConfiguration.saveConferenceEventLogFilePath;
    }
    public getSaveJournalEventLogFilePath(): string {
        return this.appConfiguration.saveJournalEventLogFilePath;
    }

    public getAnalysisCachePathForRequest(type: 'conference' | 'journal', requestId: string): string {
        const dir = type === 'conference'
            ? this.appConfiguration.conferenceAnalysisCacheDirectory
            : this.appConfiguration.journalAnalysisCacheDirectory;
        return path.join(dir, `${requestId}.json`);
    }
}