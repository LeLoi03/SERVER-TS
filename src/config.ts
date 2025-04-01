import path from 'path';
import dotenv from 'dotenv';
import type { Options as PQueueOptions, default as PQueueClass } from 'p-queue';

export const MAX_TABS: number = parseInt(process.env.PQUEUE_CONCURRENCY || '5', 10);

// Define a type for the PQueue class instance more specifically
// You might need to adjust the generic types based on your queue's task and result types
// Using <any, any> is a placeholder if you don't have specific types yet.
type QueueType = InstanceType<typeof PQueueClass<any, any>>;

async function initializeQueue(): Promise<QueueType> {
    // Dynamically import p-queue
    const { default: PQueue } = await import('p-queue');
    const queueOptions: PQueueOptions<any, any> = { concurrency: MAX_TABS };
    console.log(`Initializing queue with concurrency: ${MAX_TABS}`); // Optional: Add logging
    return new PQueue(queueOptions);
}

// Export the promise directly
export const queuePromise: Promise<QueueType> = initializeQueue();

// Optional: Add a catch block for initialization errors
queuePromise.catch(error => {
    console.error("FATAL: Failed to initialize the queue:", error);
    // Depending on your app, you might want to exit or implement retry logic
    // process.exit(1);
});


import pLimit from 'p-limit';
import type { Limit } from 'p-limit'; // Import type for clarity

// **** ADD SDK TYPE IMPORTS ****
import {
    type GenerationConfig as SDKGenerationConfig, // Rename to avoid conflict if needed locally
    SchemaType,
    type ObjectSchema,
} from "@google/generative-ai";
// ******************************

dotenv.config();

// --- CRAWL Configuration ---
export const PORTAL: string = process.env.PORTAL || "https://portal.core.edu.au/conf-ranks";
export const BY: string = process.env.BY || "all";
export const CORE: string = process.env.CORE || "CORE2023";
export const SORT: string = process.env.SORT || "aacronym";

export const PORT: number = parseInt(process.env.PORT || '3000', 10);

// Kiểu dữ liệu cho channel - có thể là một trong các giá trị được Playwright hỗ trợ
type PlaywrightChannel = 'chrome' | 'msedge' | 'firefox' | 'webkit' | 'chrome-beta' | 'msedge-beta' | 'msedge-dev' | undefined;

// Xuất các hằng số với kiểu dữ liệu cụ thể
export const CHANNEL: PlaywrightChannel = 'msedge'; // Hoặc giá trị từ biến môi trường: process.env.PLAYWRIGHT_CHANNEL as PlaywrightChannel || 'chrome'
export const HEADLESS: boolean = Boolean(process.env.HEADLESS) || true; // Ví dụ: true trong production, false khi dev
export const USER_AGENT: string = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0'; // Thay bằng user agent bạn muốn

const currentYear: number = new Date().getFullYear();
const previousYear: number = currentYear - 1;
const nextYear: number = currentYear + 1;

// Use String() to ensure default values are strings before parseInt
export const YEAR1: number = parseInt(process.env.YEAR1 || String(previousYear), 10);
export const YEAR2: number = parseInt(process.env.YEAR2 || String(currentYear), 10);
export const YEAR3: number = parseInt(process.env.YEAR3 || String(nextYear), 10);

export const SEARCH_QUERY_TEMPLATE: string = process.env.SEARCH_QUERY_TEMPLATE || "${Title} ${Acronym} ${Year2} conference";
export const MAX_LINKS: number = parseInt(process.env.MAX_LINKS || '4', 10);

// Utility function to parse keywords (typed)
export function parseEnvKeywords(envVarName: string): string[] {
    const value = process.env[envVarName];
    return value ? value.split(',').map(keyword => keyword.trim().toLowerCase()) : [];
}

export const MAIN_CONTENT_KEYWORDS: string[] = parseEnvKeywords("MAIN_CONTENT_KEYWORDS");
export const CFP_TAB_KEYWORDS: string[] = parseEnvKeywords("CFP_TAB_KEYWORDS");
export const IMPORTANT_DATES_TABS: string[] = parseEnvKeywords("IMPORTANT_DATES_TABS");
export const EXCLUDE_TEXTS: string[] = parseEnvKeywords("EXCLUDE_TEXTS");
export const EXACT_KEYWORDS: string[] = parseEnvKeywords("EXACT_KEYWORDS");
export const SKIP_KEYWORDS: string[] = parseEnvKeywords("SKIP_KEYWORDS");
export const UNWANTED_DOMAINS: string[] = parseEnvKeywords("UNWANTED_DOMAINS");

console.log("CFP_TAB_KEYWORDS:", CFP_TAB_KEYWORDS); // Log for debugging

// --- API Configuration ---
export const GEMINI_API_KEY: string | undefined = process.env.GEMINI_API_KEY;

// --- Validate Essential Config ---
if (!GEMINI_API_KEY) {
    console.error("FATAL: GEMINI_API_KEY environment variable is not set.");
    // Consider throwing an error to halt execution if critical
    // throw new Error("FATAL: GEMINI_API_KEY environment variable is not set.");
    // process.exit(1); // Or exit
}

// --- Constants ---
export const API_TYPE_EXTRACT: string = "extract";
export const API_TYPE_DETERMINE: string = "determine";

// --- Concurrency Control ---
const MAX_CONCURRENT_REQUESTS: number = parseInt(process.env.MAX_CONCURRENT_REQUESTS || "2", 10);
export const apiLimiter: Limit = pLimit(MAX_CONCURRENT_REQUESTS);

// --- Rate Limiting Options ---
export const MODEL_RATE_LIMIT_POINTS: number = parseInt(process.env.MODEL_RATE_LIMIT_POINTS || "3", 10);
export const MODEL_RATE_LIMIT_DURATION: number = parseInt(process.env.MODEL_RATE_LIMIT_DURATION || "60", 10);
export const MODEL_RATE_LIMIT_BLOCK_DURATION: number = parseInt(process.env.MODEL_RATE_LIMIT_BLOCK_DURATION || "15", 10);

// --- Retry Configuration ---
export const MAX_RETRIES: number = parseInt(process.env.MAX_RETRIES || "5", 10);
export const INITIAL_DELAY_BETWEEN_RETRIES: number = parseInt(process.env.INITIAL_DELAY_BETWEEN_RETRIES || "15000", 10);
export const MAX_DELAY_BETWEEN_RETRIES: number = parseInt(process.env.MAX_DELAY_BETWEEN_RETRIES || "30000", 10);

// --- Model Configuration ---
const extractModelNamesEnv: string | undefined = process.env.EXTRACT_MODEL_NAMES;
const extractModelNamesList: string[] = extractModelNamesEnv
    ? extractModelNamesEnv.split(',').map(name => name.trim()).filter(name => name)
    : []; // Handle case where EXTRACT_MODEL_NAMES might be undefined

if (extractModelNamesList.length === 0) {
    console.error("FATAL: No models specified in EXTRACT_MODEL_NAMES environment variable or the variable is not set.");
    // Consider throwing an error
    // throw new Error("FATAL: No models specified in EXTRACT_MODEL_NAMES environment variable.");
    // process.exit(1);
}
console.log("Using Extract Models:", extractModelNamesList);


// **** DEFINE API CONFIG INTERFACE USING SDK TYPES ****
// (Remove your local GenerationConfig/ResponseSchema interfaces if they exist)
export interface ApiConfig {
    generationConfig?: SDKGenerationConfig; // Use the imported SDK type
    systemInstruction: string;
    modelName?: string;
    modelNames?: string[];
    inputs?: Record<string, string>; // Keep these as they are for CSV loading
    outputs?: Record<string, string>; // Keep these as they are for CSV loading
}


// Define the structure of apiConfigs using an index signature
export interface ApiConfigs {
    [apiType: string]: ApiConfig;
}

// --- API Config Object (Typed) ---
export const apiConfigs: ApiConfigs = {
    [API_TYPE_EXTRACT]: {
        generationConfig: {
            temperature: parseFloat(process.env.EXTRACT_TEMPERATURE || "0.7"),
            topP: parseFloat(process.env.EXTRACT_TOP_P || "0.9"),
            topK: parseInt(process.env.EXTRACT_TOP_K || "32", 10),
            maxOutputTokens: parseInt(process.env.EXTRACT_MAX_OUTPUT_TOKENS || "8192", 10),
            responseMimeType: process.env.EXTRACT_RESPONSE_MIME_TYPE, // Can be undefined if not set
        },
        // Use environment variables safely, providing empty string defaults if needed
        systemInstruction: `
            Role: ${process.env.EXTRACT_ROLE || ''}
            Instruction:
              1. ${process.env.EXTRACT_INSTRUCTION_1 || ''}
              2. ${process.env.EXTRACT_INSTRUCTION_2 || ''}
              3. ${process.env.EXTRACT_INSTRUCTION_3 || ''}
              4. ${process.env.EXTRACT_INSTRUCTION_4 || ''}
              5. ${process.env.EXTRACT_INSTRUCTION_5 || ''}
              6. ${process.env.EXTRACT_INSTRUCTION_6 || ''}

            Situation: ${process.env.EXTRACT_SITUATION || ''}
        `.trim(), // Trim whitespace from template literal
        modelNames: extractModelNamesList,
    },
    [API_TYPE_DETERMINE]: {
        generationConfig: {
            temperature: parseFloat(process.env.DETERMINE_TEMPERATURE || "0.5"),
            topP: parseFloat(process.env.DETERMINE_TOP_P || "0.9"),
            topK: parseInt(process.env.DETERMINE_TOP_K || "32", 10),
            maxOutputTokens: parseInt(process.env.DETERMINE_MAX_OUTPUT_TOKENS || "8192", 10),
            responseMimeType: process.env.DETERMINE_RESPONSE_MIME_TYPE || "application/json",
            responseSchema: {
                type: SchemaType.OBJECT, // Use the enum value
                properties: {
                    "Official Website": { type: SchemaType.STRING }, // Use enum
                    "Call for papers link": { type: SchemaType.STRING }, // Use enum
                    "Important dates link": { type: SchemaType.STRING } // Use enum
                },
                required: ["Official Website", "Call for papers link", "Important dates link"]
            } as ObjectSchema, // Assert type for clarity if needed, ensure it matches SDK's ObjectSchema
            // ***************************
        },
        systemInstruction: `
            Role: ${process.env.DETERMINE_ROLE || ''}
            Instruction:
              1. ${process.env.DETERMINE_INSTRUCTION_1 || ''}
              2. ${process.env.DETERMINE_INSTRUCTION_2 || ''}
              3. ${process.env.DETERMINE_INSTRUCTION_3 || ''}
              4. ${process.env.DETERMINE_INSTRUCTION_4 || ''}
            Situation: ${process.env.DETERMINE_SITUATION || ''}
        `.trim(),
        modelName: process.env.DETERMINE_MODEL_NAME // Can be undefined if not set
    },
};


// --- JOURNAL Configuration ---
export const BASE_URL: string = 'https://www.scimagojr.com/journalrank.php?year=2023&type=j';

// Define an interface for Retry Options
interface RetryOptions {
    retries: number;
    minTimeout: number;
    factor: number;
    // Add other retry options if needed (e.g., maxTimeout, randomize)
}

export const RETRY_OPTIONS: RetryOptions = {
    retries: parseInt(process.env.RETRY_RETRIES || '3', 10),
    minTimeout: parseInt(process.env.RETRY_MIN_TIMEOUT || '1000', 10),
    factor: parseFloat(process.env.RETRY_FACTOR || '2'),
};

// Define an interface for Cache Options (assuming node-cache structure)
interface CacheOptions {
    stdTTL: number;
    checkperiod: number;
    // Add other cache options if needed (e.g., useClones)
}

export const CACHE_OPTIONS: CacheOptions = {
    stdTTL: parseInt(process.env.CACHE_TTL || String(60 * 60 * 24), 10), // 24 hours
    checkperiod: parseInt(process.env.CACHE_CHECK_PERIOD || String(60 * 60), 10), // 1 hour
};

// Filter out potential undefined values from process.env
export const GOOGLE_CUSTOM_SEARCH_API_KEYS: string[] = [
    process.env.CUSTOM_SEARCH_API_KEY_3,
    process.env.CUSTOM_SEARCH_API_KEY_4,
    process.env.CUSTOM_SEARCH_API_KEY_5,
    process.env.CUSTOM_SEARCH_API_KEY_6,
    process.env.CUSTOM_SEARCH_API_KEY_7,
    process.env.CUSTOM_SEARCH_API_KEY_1,
    process.env.CUSTOM_SEARCH_API_KEY_2,
    process.env.CUSTOM_SEARCH_API_KEY_8,
    process.env.CUSTOM_SEARCH_API_KEY_9,
    process.env.CUSTOM_SEARCH_API_KEY_10
].filter((key): key is string => typeof key === 'string'); // Type predicate to ensure string[]

export const GOOGLE_CSE_ID: string | undefined = process.env.GOOGLE_CSE_ID;

export const MAX_USAGE_PER_KEY: number = 95; // Should probably be from env: parseInt(process.env.MAX_USAGE_PER_KEY || '95', 10)
export const KEY_ROTATION_DELAY_MS: number = parseInt(process.env.KEY_ROTATION_DELAY_MS || '60000', 10);

// --- Journal Crawl Specific ---
export const JOURNAL_CRAWL_BIOXBIO: boolean = process.env.JOURNAL_CRAWL_BIOXBIO !== 'false';
export const JOURNAL_CRAWL_MODE: 'scimago' | 'csv' = (process.env.JOURNAL_CRAWL_MODE === 'csv' ? 'csv' : 'scimago'); // Type restrict to known values
export const JOURNAL_CRAWL_DETAILS: boolean = process.env.JOURNAL_CRAWL_DETAILS !== 'false';
export const JOURNAL_CSV_HEADERS: string = process.env.JOURNAL_CSV_HEADERS || "Title,Type,SJR,H index,Total Docs. (2023),Total Docs. (3years),Total Refs. (2023),Total Cites (3years),Citable Docs. (3years),Cites / Doc. (2years),Ref. / Doc. (2023),Country,Details";


// --- LOGGER Configuration ---
// --- Logging ---
import { LevelWithSilent } from 'pino'; // Import kiểu Level từ pino

// Định nghĩa một kiểu cụ thể cho các mức log được phép
export type AllowedLogLevel = LevelWithSilent; // Sử dụng kiểu của Pino

// Lấy giá trị từ biến môi trường, ép kiểu và cung cấp giá trị mặc định an toàn
const getLogLevel = (): AllowedLogLevel => {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    // Kiểm tra xem envLevel có phải là một trong các giá trị hợp lệ không
    const validLevels: AllowedLogLevel[] = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];
    if (envLevel && validLevels.includes(envLevel as AllowedLogLevel)) {
        return envLevel as AllowedLogLevel;
    }
    return 'info'; // Giá trị mặc định
};

export const LOG_LEVEL: AllowedLogLevel = getLogLevel();// Nên sử dụng path.resolve để đảm bảo đường dẫn tuyệt đối ngay từ đầu
export const LOGS_DIRECTORY = path.resolve(process.env.LOGS_DIR || './logs');
export const APP_LOG_FILE_PATH: string = path.join(LOGS_DIRECTORY, process.env.LOG_FILE_NAME || 'app.log');

// --- Validation for GOOGLE CSE ---
if (!GOOGLE_CSE_ID) {
    console.warn("WARN: GOOGLE_CSE_ID environment variable is not set. Google Custom Search features may not work.");
}
if (GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
    console.warn("WARN: No Google Custom Search API Keys found in environment variables (CUSTOM_SEARCH_API_KEY_...). Google Custom Search features may not work.");
}

