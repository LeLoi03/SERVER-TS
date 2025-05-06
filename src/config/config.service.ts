// src/config/config.service.ts
import 'reflect-metadata';
import { singleton } from 'tsyringe';
import dotenv from 'dotenv';
import { z } from 'zod';
import path from 'path';
import { LevelWithSilent } from 'pino';
import {
    SchemaType,
    type ObjectSchema,
    type GenerationConfig as SDKGenerationConfig,
} from "@google/generative-ai";
import { read_csv, createInputsOutputs } from '../utils/crawl/fewShotExamplesInit';
import fs from 'fs';
import { InputsOutputs } from '../types.ts/types'; // Đổi thành đường dẫn đúng nếu cần

// Đường dẫn đến file CSV - Nên lấy từ config hoặc định nghĩa rõ ràng
const CFP_INFORMATION_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/extract_cfp.csv"); // Dùng path.resolve

// --- Helper Function for Parsing Comma-Separated Strings ---
const parseCommaSeparatedString = (key: string) => (val: string | undefined): string[] => {
    if (!val) return [];
    return val.split(',').map(item => item.trim()).filter(item => item);
};

const parseCommaSeparatedStringLowerCase = (key: string) => (val: string | undefined): string[] => {
    if (!val) return [];
    return val.split(',').map(item => item.trim().toLowerCase()).filter(item => item);
};

// --- Zod Schema Definition ---
const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // --- Cron Job ---
    LOG_ANALYSIS_CRON_SCHEDULE: z.string().default('*/60 * * * *'),
    CRON_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),

    // --- General Server Config ---
    PORT: z.coerce.number().int().positive().default(3001),
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    CORS_ALLOWED_ORIGINS: z.string().optional().transform(parseCommaSeparatedString('CORS_ALLOWED_ORIGINS')), // Default handled below

    // --- Logging Config ---
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as [LevelWithSilent, ...LevelWithSilent[]]).default('info'),
    LOGS_DIRECTORY: z.string().default('./logs'),
    LOG_FILE_NAME: z.string().default('app.log'),

    // --- Base Output Directory ---
    BASE_OUTPUT_DIR: z.string().default('./data/crawl_output'),

    // --- P-Queue / Concurrency ---
    CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(5),

    // --- Playwright Config ---
    PLAYWRIGHT_CHANNEL: z.enum([ 'msedge', 'chrome', 'firefox', 'webkit', 'chrome-beta', 'msedge-beta', 'msedge-dev']).optional().default('msedge'),
    PLAYWRIGHT_HEADLESS: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),
    USER_AGENT: z.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'),

    // --- Crawl Years & Search ---
    YEAR1: z.coerce.number().int().default(new Date().getFullYear() - 1),
    YEAR2: z.coerce.number().int().default(new Date().getFullYear()),
    YEAR3: z.coerce.number().int().default(new Date().getFullYear() + 1),
    SEARCH_QUERY_TEMPLATE: z.string().default('${Title} ${Acronym} ${Year2} conference'),
    MAX_LINKS: z.coerce.number().int().positive().default(4),

    // --- Google Custom Search ---
    GOOGLE_CSE_ID: z.string().optional(),
    GOOGLE_CUSTOM_SEARCH_API_KEYS: z.string().optional().transform(parseCommaSeparatedString('GOOGLE_CUSTOM_SEARCH_API_KEYS')),
    MAX_USAGE_PER_KEY: z.coerce.number().int().positive().default(200),
    KEY_ROTATION_DELAY_MS: z.coerce.number().int().positive().default(60000),
    MAX_SEARCH_RETRIES: z.coerce.number().int().nonnegative().default(10),
    RETRY_DELAY_MS: z.coerce.number().int().positive().default(2000),

    // --- Keyword/Domain Filtering ---
    UNWANTED_DOMAINS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('UNWANTED_DOMAINS')),
    SKIP_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('SKIP_KEYWORDS')),
    MAIN_CONTENT_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('MAIN_CONTENT_KEYWORDS')),
    CFP_TAB_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('CFP_TAB_KEYWORDS')),
    IMPORTANT_DATES_TABS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('IMPORTANT_DATES_TABS')),
    EXCLUDE_TEXTS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('EXCLUDE_TEXTS')),
    EXACT_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('EXACT_KEYWORDS')),

    // --- Gemini API Base Config ---
    GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
    GEMINI_API_CONCURRENCY: z.coerce.number().int().positive().default(2),
    GEMINI_RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(3),
    GEMINI_RATE_LIMIT_DURATION: z.coerce.number().int().positive().default(60),
    GEMINI_RATE_LIMIT_BLOCK_DURATION: z.coerce.number().int().positive().default(15),
    GEMINI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
    GEMINI_INITIAL_DELAY_MS: z.coerce.number().int().positive().default(15000),
    GEMINI_MAX_DELAY_MS: z.coerce.number().int().positive().default(30000),

    // --- Gemini API - Chatbot Specific ---
    GEMINI_CHATBOT_MODEL_NAME: z.string().optional(), // e.g., "gemini-1.5-flash-latest" or "gemini-pro"
    GEMINI_CHATBOT_TEMPERATURE: z.coerce.number().min(0).max(2).default(1.0),
    GEMINI_CHATBOT_TOP_P: z.coerce.number().min(0).max(1).default(0.95),
    GEMINI_CHATBOT_TOP_K: z.coerce.number().int().positive().default(40),
    GEMINI_CHATBOT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    GEMINI_CHATBOT_RESPONSE_MIME_TYPE: z.string().optional(), // e.g., "application/json"

    // --- Gemini API - Extract Specific ---
    GEMINI_EXTRACT_MODEL_NAMES: z.string().min(1, "GEMINI_EXTRACT_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_EXTRACT_MODEL_NAMES')),
    GEMINI_EXTRACT_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
    GEMINI_EXTRACT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    GEMINI_EXTRACT_RESPONSE_MIME_TYPE: z.string().default("text/plain"),
    GEMINI_EXTRACT_ROLE: z.string().default("Data Extractor"),
    GEMINI_EXTRACT_INSTRUCTION_1: z.string().optional(),
    GEMINI_EXTRACT_INSTRUCTION_2: z.string().optional(),
    GEMINI_EXTRACT_INSTRUCTION_3: z.string().optional(),
    GEMINI_EXTRACT_INSTRUCTION_4: z.string().optional(),
    GEMINI_EXTRACT_INSTRUCTION_5: z.string().optional(),
    GEMINI_EXTRACT_INSTRUCTION_6: z.string().optional(),
    GEMINI_EXTRACT_SITUATION: z.string().optional(),

    // --- Gemini API - CFP Specific ---
    GEMINI_CFP_MODEL_NAMES: z.string().min(1, "GEMINI_CFP_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_CFP_MODEL_NAMES')),
    GEMINI_CFP_TEMPERATURE: z.coerce.number().min(0).max(2).default(1.0),
    GEMINI_CFP_TOP_P: z.coerce.number().min(0).max(1).default(0.9),
    GEMINI_CFP_TOP_K: z.coerce.number().int().positive().default(32),
    GEMINI_CFP_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    GEMINI_CFP_RESPONSE_MIME_TYPE: z.string().default("application/json"),
    GEMINI_CFP_SYSTEM_INSTRUCTION: z.string().optional(),

    // --- Gemini API - Determine Specific ---
    GEMINI_DETERMINE_MODEL_NAME: z.string().optional(),
    GEMINI_DETERMINE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
    GEMINI_DETERMINE_TOP_P: z.coerce.number().min(0).max(1).default(0.9), // Thường không dùng chung với temp thấp
    GEMINI_DETERMINE_TOP_K: z.coerce.number().int().positive().default(32), // Thường không dùng chung với temp thấp
    GEMINI_DETERMINE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    GEMINI_DETERMINE_RESPONSE_MIME_TYPE: z.string().default("application/json"),
    GEMINI_DETERMINE_ROLE: z.string().default("Link Classifier"),
    GEMINI_DETERMINE_INSTRUCTION_1: z.string().optional(),
    GEMINI_DETERMINE_INSTRUCTION_2: z.string().optional(),
    GEMINI_DETERMINE_INSTRUCTION_3: z.string().optional(),
    GEMINI_DETERMINE_INSTRUCTION_4: z.string().optional(),
    GEMINI_DETERMINE_SITUATION: z.string().optional(),

    // --- Gemini API - Conference Website Description ---
    CONFERENCE_WEBSITE_DESCRIPTION: z.string().optional(),

    // --- Journal Crawl Config ---
    JOURNAL_BASE_URL: z.string().default('https://www.scimagojr.com/journalrank.php?year=2023&type=j'),
    JOURNAL_RETRY_RETRIES: z.coerce.number().int().nonnegative().default(3),
    JOURNAL_RETRY_MIN_TIMEOUT: z.coerce.number().int().positive().default(1000),
    JOURNAL_RETRY_FACTOR: z.coerce.number().positive().default(2),
    JOURNAL_CACHE_TTL: z.coerce.number().int().positive().default(60 * 60 * 24),
    JOURNAL_CACHE_CHECK_PERIOD: z.coerce.number().int().positive().default(60 * 60),
    JOURNAL_CRAWL_BIOXBIO: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),
    JOURNAL_CRAWL_MODE: z.enum(['scimago', 'csv']).default('scimago'),
    JOURNAL_CRAWL_DETAILS: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),
    JOURNAL_CSV_HEADERS: z.string().default("Title,Type,SJR,H index,Total Docs. (2023),Total Docs. (3years),Total Refs. (2023),Total Cites (3years),Citable Docs. (3years),Cites / Doc. (2years),Ref. / Doc. (2023),Country,Details"),

    // --- Other ---
    API_BASE_URL: z.string().optional().default('http://confhub.engineer/api/v1')

});

// --- Define Interfaces for Structured Config (like Gemini API) ---
export interface GeminiApiConfig {
    generationConfig?: SDKGenerationConfig;
    systemInstruction?: string;
    modelName?: string; // For single model selection like Determine
    modelNames?: string[]; // For multiple model selection like Extract/CFP
    inputs?: Record<string, string>; // **ĐÃ THÊM (tùy chọn)**
    outputs?: Record<string, string>; // **ĐÃ THÊM (tùy chọn)**
}

export interface GeminiApiConfigs {
    [apiType: string]: GeminiApiConfig;
}

// --- Infer the main config type from the schema ---
type AppConfigFromSchema = z.infer<typeof envSchema>;

// --- Define the final config type, including the manually added API keys ---
export type AppConfig = AppConfigFromSchema & {
    // Thêm thuộc tính này thủ công vì nó không có trong schema Zod
    GOOGLE_CUSTOM_SEARCH_API_KEYS: string[];
};

// --- Constants for Gemini API Types ---
const API_TYPE_EXTRACT = "extract";
const API_TYPE_CFP = "cfp";
const API_TYPE_DETERMINE = "determine";



@singleton()
export class ConfigService {
    // Sử dụng kiểu AppConfig cuối cùng
    public readonly config: AppConfig;
    public readonly geminiApiConfigs: GeminiApiConfigs;
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        dotenv.config();
        try {
            // 1. Parse các biến môi trường được định nghĩa trong schema
            const parsedConfig = envSchema.parse(process.env);

            // 2. Thu thập thủ công các khóa API Google Search từ process.env
            const googleApiKeys: string[] = [];
            const keyPattern = /^CUSTOM_SEARCH_API_KEY_\d+$/; // Pattern để khớp CUSTOM_SEARCH_API_KEY_1, CUSTOM_SEARCH_API_KEY_2, ...
            for (const envVar in process.env) {
                if (keyPattern.test(envVar) && process.env[envVar]) {
                    googleApiKeys.push(process.env[envVar] as string);
                    console.log(`   - Found Google Search API Key: ${envVar}`); // Log để xác nhận
                }
            }

            // Sắp xếp các khóa nếu cần (ví dụ: để đảm bảo thứ tự KEY_1, KEY_2, KEY_10 đúng)
            // googleApiKeys.sort((a, b) => {
            //     const numA = parseInt(a.match(/\d+$/)?.[0] || '0');
            //     const numB = parseInt(b.match(/\d+$/)?.[0] || '0');
            //     return numA - numB;
            // });

            // 3. Gán config đã parse và các khóa đã thu thập vào this.config
            // Cần ép kiểu vì chúng ta đang thêm thuộc tính không có trong schema gốc
            this.config = {
                ...parsedConfig,
                GOOGLE_CUSTOM_SEARCH_API_KEYS: googleApiKeys
            };

            // --- Post-validation checks/defaults ---
            if (!this.config.CORS_ALLOWED_ORIGINS || this.config.CORS_ALLOWED_ORIGINS.length === 0) {
                // Gán lại vào this.config vì nó có thể đã được parse là mảng rỗng
                this.config.CORS_ALLOWED_ORIGINS = [`*`
                    // `http://localhost:${this.config.PORT}`,
                    // `http://127.0.0.1:${this.config.PORT}`,
                    // `https://confhub.ddns.net` // Thay bằng domain thực tế của bạn nếu cần
                ];
            }

             if (!this.config.GOOGLE_CSE_ID) {
                console.warn("⚠️ WARN: GOOGLE_CSE_ID environment variable is not set. Google Custom Search features may not work.");
            }
            // 4. Cập nhật kiểm tra cảnh báo để sử dụng thuộc tính mới
            if (this.config.GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
                console.warn("⚠️ WARN: No Google Custom Search API Keys found (checked for CUSTOM_SEARCH_API_KEY_n variables). Google Custom Search features may not work.");
            }
            if (this.config.GEMINI_EXTRACT_MODEL_NAMES.length === 0) {
                 console.error("❌ FATAL: No models specified in GEMINI_EXTRACT_MODEL_NAMES environment variable.");
                throw new Error("GEMINI_EXTRACT_MODEL_NAMES cannot be empty.");
            }
             if (this.config.GEMINI_CFP_MODEL_NAMES.length === 0) {
                console.error("❌ FATAL: No models specified in GEMINI_CFP_MODEL_NAMES environment variable.");
                throw new Error("GEMINI_CFP_MODEL_NAMES cannot be empty.");
            }

            // --- Build Structured Gemini Config ---
            this.geminiApiConfigs = this.buildGeminiApiConfigs();

            // --- Log Confirmation ---
            console.log("✅ Configuration loaded and validated successfully.");
            console.log(`   - NODE_ENV: ${this.config.NODE_ENV}`);
            console.log(`   - Port: ${this.config.PORT}`);
            console.log(`   - Log Level: ${this.config.LOG_LEVEL}`);
            console.log(`   - Crawl Concurrency: ${this.config.CRAWL_CONCURRENCY}`);
            console.log(`   - Found ${this.config.GOOGLE_CUSTOM_SEARCH_API_KEYS.length} Google Custom Search API Keys.`);
            // console.log("   - Loaded Gemini Config Keys:", Object.keys(this.geminiApiConfigs));

        } catch (error) {
            if (error instanceof z.ZodError) {
                console.error("❌ Invalid environment variables (schema validation):", JSON.stringify(error.format(), null, 2));
            } else {
                console.error("❌ Unexpected error loading configuration:", error);
            }
            process.exit(1);
        }
    }

    // --- initializeExamples (Giữ nguyên) ---
    public async initializeExamples(): Promise<void> {
        if (!this.initializationPromise) {
            console.log("🚀 Starting loading of API examples...");
            this.initializationPromise = (async () => {
                try {
                    const [cfpExamples] = await Promise.all([
                        this.loadSpecificExampleData(CFP_INFORMATION_CSV_PATH, API_TYPE_CFP),
                    ]);

                    if (cfpExamples && this.geminiApiConfigs[API_TYPE_CFP]) {
                        this.geminiApiConfigs[API_TYPE_CFP].inputs = cfpExamples.inputs;
                        this.geminiApiConfigs[API_TYPE_CFP].outputs = cfpExamples.outputs;
                        console.log(`   - Loaded ${Object.keys(cfpExamples.inputs).length} examples for CFP.`);
                    }

                    console.log("✅ API examples loaded and integrated successfully.");

                } catch (error) {
                    console.error("❌ Error loading API examples:", error);
                    this.initializationPromise = null; // Reset để có thể thử lại
                    throw error; // Ném lỗi ra ngoài để báo hiệu thất bại
                }
            })();
        } else {
            console.log("🔁 API examples loading already in progress or completed.");
        }
        return this.initializationPromise;
    }

    // --- loadSpecificExampleData (Giữ nguyên) ---
    private async loadSpecificExampleData(filePath: string, apiType: string): Promise<InputsOutputs | null> {
        try {
            await fs.promises.access(filePath);
            console.log(`   - Preparing ${apiType} data from: ${filePath}`);
            const rawData = await read_csv(filePath);
            if (rawData.length === 0) {
                console.warn(`   - WARNING: No valid data found in ${filePath} for ${apiType}.`);
                return null;
            }
            return createInputsOutputs(rawData);
        } catch (error: any) {
             if (error.code === 'ENOENT') {
                console.error(`   - ERROR: CSV file not found for ${apiType}: ${filePath}`);
            } else {
                console.error(`   - ERROR: Failed to read/parse CSV for ${apiType} (${filePath}):`, error.message);
            }
            return null;
        }
    }


    // --- buildGeminiApiConfigs (Giữ nguyên) ---
    private buildGeminiApiConfigs(): GeminiApiConfigs {
        const extractInstruction = `
            **Role:** ${this.config.GEMINI_EXTRACT_ROLE}
            **Instruction:**
              1. ${this.config.GEMINI_EXTRACT_INSTRUCTION_1 || ''}
              2. ${this.config.GEMINI_EXTRACT_INSTRUCTION_2 || ''}
              3. ${this.config.GEMINI_EXTRACT_INSTRUCTION_3 || ''}
              4. ${this.config.GEMINI_EXTRACT_INSTRUCTION_4 || ''}
              5. ${this.config.GEMINI_EXTRACT_INSTRUCTION_5 || ''}
              6. ${this.config.GEMINI_EXTRACT_INSTRUCTION_6 || ''}
            **Situation:** ${this.config.GEMINI_EXTRACT_SITUATION || ''}
        `.trim().replace(/^ +/gm, '');

        const determineInstruction = `
            **Role:** ${this.config.GEMINI_DETERMINE_ROLE}
            **Instruction:**
              1. ${this.config.GEMINI_DETERMINE_INSTRUCTION_1 || ''}
              2. ${this.config.GEMINI_DETERMINE_INSTRUCTION_2 || ''}
              3. ${this.config.GEMINI_DETERMINE_INSTRUCTION_3 || ''}
              4. ${this.config.GEMINI_DETERMINE_INSTRUCTION_4 || ''}
            **Situation:** ${this.config.GEMINI_DETERMINE_SITUATION || ''}
        `.trim().replace(/^ +/gm, '');

        return {
             [API_TYPE_EXTRACT]: {
                generationConfig: {
                    temperature: this.config.GEMINI_EXTRACT_TEMPERATURE,
                    maxOutputTokens: this.config.GEMINI_EXTRACT_MAX_OUTPUT_TOKENS,
                    responseMimeType: this.config.GEMINI_EXTRACT_RESPONSE_MIME_TYPE,
                },
                // systemInstruction: extractInstruction,
                modelNames: this.config.GEMINI_EXTRACT_MODEL_NAMES,
            },
            [API_TYPE_CFP]: {
                generationConfig: {
                    temperature: this.config.GEMINI_CFP_TEMPERATURE,
                    topP: this.config.GEMINI_CFP_TOP_P,
                    topK: this.config.GEMINI_CFP_TOP_K,
                    maxOutputTokens: this.config.GEMINI_CFP_MAX_OUTPUT_TOKENS,
                    responseMimeType: this.config.GEMINI_CFP_RESPONSE_MIME_TYPE,
                    responseSchema: {
                        type: SchemaType.OBJECT,
                        properties: {
                            "summary": { type: SchemaType.STRING },
                            "callForPapers": { type: SchemaType.STRING },
                        },
                        required: ["summary", "callForPapers"]
                    } as ObjectSchema,
                },
                systemInstruction: (this.config.GEMINI_CFP_SYSTEM_INSTRUCTION || '').trim(),
                modelNames: this.config.GEMINI_CFP_MODEL_NAMES,
                // inputs/outputs sẽ được thêm bởi initializeExamples
            },
            [API_TYPE_DETERMINE]: {
                 generationConfig: {
                    temperature: this.config.GEMINI_DETERMINE_TEMPERATURE,
                    maxOutputTokens: this.config.GEMINI_DETERMINE_MAX_OUTPUT_TOKENS,
                    responseMimeType: this.config.GEMINI_DETERMINE_RESPONSE_MIME_TYPE,
                     responseSchema: {
                        type: SchemaType.OBJECT,
                        properties: {
                            "Official Website": { type: SchemaType.STRING },
                            "Call for papers link": { type: SchemaType.STRING },
                            "Important dates link": { type: SchemaType.STRING }
                        },
                        required: ["Official Website", "Call for papers link", "Important dates link"]
                    } as ObjectSchema,
                },
                // systemInstruction: determineInstruction,
                modelName: this.config.GEMINI_DETERMINE_MODEL_NAME, // Lưu ý: determine chỉ dùng 1 model name theo schema cũ
            },
        };
    }

    // --- Getters (Cập nhật googleSearchConfig) ---
    get logsDirectory(): string {
        return path.resolve(this.config.LOGS_DIRECTORY);
    }

    get appLogFilePath(): string {
        return path.join(this.logsDirectory, this.config.LOG_FILE_NAME);
    }

    get baseOutputDir(): string {
        return path.resolve(this.config.BASE_OUTPUT_DIR);
    }

    get conferenceListPath(): string { return path.join(this.baseOutputDir, 'conference_list.json'); }
    get finalOutputJsonlPath(): string { return path.join(this.baseOutputDir, 'final_output.jsonl'); }
    get evaluateCsvPath(): string { return path.join(this.baseOutputDir, 'evaluate.csv'); }
    get customSearchDir(): string { return path.join(this.baseOutputDir, 'custom_search'); }
    get batchesDir(): string { return path.join(this.baseOutputDir, 'batches'); }
    get tempDir(): string { return path.join(this.baseOutputDir, 'temp'); }
    get errorAccessLinkPath(): string { return path.join(this.baseOutputDir, 'error_access_link_log.txt'); }
    
    get playwrightConfig() {
        return {
            channel: this.config.PLAYWRIGHT_CHANNEL,
            headless: this.config.PLAYWRIGHT_HEADLESS,
            userAgent: this.config.USER_AGENT,
        };
    }

    // 5. Cập nhật getter để sử dụng mảng khóa đã thu thập
    get googleSearchConfig() {
        return {
            cseId: this.config.GOOGLE_CSE_ID,
            apiKeys: this.config.GOOGLE_CUSTOM_SEARCH_API_KEYS, // Sử dụng trực tiếp mảng đã thu thập
            maxUsagePerKey: this.config.MAX_USAGE_PER_KEY,
            rotationDelayMs: this.config.KEY_ROTATION_DELAY_MS,
            maxRetries: this.config.MAX_SEARCH_RETRIES,
            retryDelayMs: this.config.RETRY_DELAY_MS,
        };
    }

    get journalRetryOptions() {
        return {
            retries: this.config.JOURNAL_RETRY_RETRIES,
            minTimeout: this.config.JOURNAL_RETRY_MIN_TIMEOUT,
            factor: this.config.JOURNAL_RETRY_FACTOR,
        };
    }

    get journalCacheOptions() {
        return {
            stdTTL: this.config.JOURNAL_CACHE_TTL,
            checkperiod: this.config.JOURNAL_CACHE_CHECK_PERIOD,
        };
    }
}