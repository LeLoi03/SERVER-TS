// src/config/schemas.ts
import { z } from 'zod';
import { LevelWithSilent } from 'pino';
import { AgentId } from '../chatbot/shared/types'; // IMPORTANT: Import AgentId type

// --- Helper Functions for Environment Variable Parsing ---

/**
 * Parses a comma-separated string from an environment variable into an array of trimmed strings.
 * @param {string} key - The environment variable key (for logging/error messages).
 * @returns {(val: string | undefined) => string[]} A function that takes a string or undefined and returns a string array.
 */
export const parseCommaSeparatedString = (key: string): (val: string | undefined) => string[] => (val: string | undefined): string[] => {
    if (!val) {
        console.warn(`[ConfigService] WARN: Environment variable '${key}' is not set or empty. Returning empty array.`);
        return [];
    }
    return val.split(',').map(item => item.trim()).filter(item => item !== '');
};

/**
 * Parses a comma-separated string from an environment variable into an array of trimmed, lowercase strings.
 * @param {string} key - The environment variable key (for logging/error messages).
 * @returns {(val: string | undefined) => string[]} A function that takes a string or undefined and returns a lowercase string array.
 */
export const parseCommaSeparatedStringLowerCase = (key: string): (val: string | undefined) => string[] => (val: string | undefined): string[] => {
    if (!val) {
        console.warn(`[ConfigService] WARN: Environment variable '${key}' is not set or empty. Returning empty array.`);
        return [];
    }
    return val.split(',').map(item => item.trim().toLowerCase()).filter(item => item !== '');
};

/**
 * Parses a comma-separated string from an environment variable into an array of `AgentId`s.
 * Preserves case for `AgentId` values.
 * @param {string} key - The environment variable key (for logging/error messages).
 * @returns {(val: string | undefined) => AgentId[]} A function that takes a string or undefined and returns an AgentId array.
 */
export const parseAgentIdArray = (key: string): (val: string | undefined) => AgentId[] => (val: string | undefined): AgentId[] => {
    if (!val) {
        console.warn(`[ConfigService] WARN: Environment variable '${key}' is not set or empty. Returning empty array.`);
        return [];
    }
    // Trim but do not convert to lowercase as AgentId might be case-sensitive.
    return val.split(',').map(item => item.trim() as AgentId).filter(item => item !== '');
};

// --- Zod Schema Definition for Environment Variables ---
/**
 * Zod schema defining the structure and validation rules for environment variables.
 * Each property corresponds to an environment variable.
 */
export const envSchema = z.object({
    /**
     * The current Node.js environment.
     * @default 'development'
     */
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // --- Cron Job Configuration ---
    /**
     * Cron schedule for log analysis.
     * @default '60 * * * *' (Every 60 minutes)
     */
    LOG_ANALYSIS_CRON_SCHEDULE: z.string().default('*/60 * * * *'),
    /**
     * Timezone for cron jobs.
     * @default 'Asia/Ho_Chi_Minh'
     */
    CRON_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),

    // --- General Server Configuration ---
    /**
     * Port on which the server will listen.
     * @default 3001
     */
    PORT: z.coerce.number().int().positive().default(3001),
    /**
     * Secret key for JSON Web Token (JWT) signing.
     * @description Required for authentication.
     */
    JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
    /**
     * MongoDB connection URI.
     * @description Required for database access.
     */
    MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
    /**
     * Primary database connection URL (e.g., PostgreSQL, MySQL).
     * @description Required for database access if different from MONGODB_URI.
     */
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    /**
     * Endpoint for importing data into the database.
     * @description Specific endpoint for database import operations.
     */
    DATABASE_IMPORT_ENDPOINT: z.string().min(1, "DATABASE_IMPORT_ENDPOINT is required"),
    /**
     * Comma-separated list of allowed origins for CORS.
     * If not set, defaults to `['*']` in `ConfigService` constructor.
     */
    CORS_ALLOWED_ORIGINS: z.string().optional().transform(parseCommaSeparatedString('CORS_ALLOWED_ORIGINS')),

    // --- Logging Configuration ---
    /**
     * Minimum log level for the application.
     * @default 'info'
     */
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'] as [LevelWithSilent, ...LevelWithSilent[]]).default('info'),
    /**
     * Directory where log files will be stored.
     * @default './logs'
     */
    LOGS_DIRECTORY: z.string().default('./logs'),
    /**
     * Name of the main application log file.
     * @default 'conference.log'
     */



    // Log Rotation
    LOG_ROTATION_FREQUENCY: z.string().default('daily').optional(),
    LOG_ROTATION_SIZE: z.string().default('50M').optional(),
    LOG_ARCHIVE_SUBDIR: z.string().default('archive').optional(),
    LOG_ROTATION_DATE_FORMAT: z.string().optional(), // Để trống nếu không muốn dùng dateFormat
    LOG_ROTATION_LIMIT_COUNT: z.coerce.number().int().positive().optional(), // Chuyển sang số, nguyên dương

    // Log Analysis Cache
    ANALYSIS_CACHE_ENABLED: z.preprocess(
        (val) => String(val).toLowerCase() === 'true',
        z.boolean().default(true)
    ).optional(),
    ANALYSIS_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400).optional(), // Default 1 ngày

    ANALYSIS_CACHE_SUBDIR: z.string().default('analysis_cache').optional(),


    APP_LOG_FILE_NAME: z.string().default('app.log'),

    CONFERENCE_LOG_FILE_NAME: z.string().default('conference.log'),
    /**
     * Name of the main application log file.
     * @default 'conference.log'
     */
    JOURNAL_LOG_FILE_NAME: z.string().default('journal.log'),
    /**
     * Whether logs should also be output to the console.
     * @default false
     */
    LOG_TO_CONSOLE: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),

    // --- Base Output Directory ---
    /**
     * Base directory for all crawl related outputs (e.g., JSONL, CSV, temporary files).
     * @default './data/crawl_output'
     */
    BASE_OUTPUT_DIR: z.string().default('./data/crawl_output'),

    // --- Per Request P-Queue / Concurrency Configuration ---
    /**
     * Maximum number of concurrent crawl operations per request. 
     * @default 3
     */
    CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(3),

    // --- App P-Queue / Concurrency Configuration ---
    /**
     * Maximum number of concurrent crawl operations in global app.
     * @default 3
     */
    GLOBAL_CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(3),

    // --- Playwright Configuration ---
    /**
     * The browser channel to use for Playwright (e.g., 'msedge', 'chrome').
     * @default 'msedge'
     */
    PLAYWRIGHT_CHANNEL: z.enum(['msedge', 'chrome', 'firefox', 'webkit', 'chrome-beta', 'msedge-beta', 'msedge-dev']).optional().default('msedge'),
    /**
     * Whether Playwright should run in headless mode.
     * @default true
     */
    PLAYWRIGHT_HEADLESS: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),
    /**
     * User-Agent string to use for Playwright browser.
     * @default 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
     */
    USER_AGENT: z.string().default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'),

    // --- Crawl Years & Search Configuration ---
    /**
     * First year for conference searching (e.g., current year - 1).
     * @default currentYear - 1
     */
    YEAR1: z.coerce.number().int().default(new Date().getFullYear() - 1),
    /**
     * Second year for conference searching (e.g., current year).
     * @default currentYear
     */
    YEAR2: z.coerce.number().int().default(new Date().getFullYear()),
    /**
     * Third year for conference searching (e.g., current year + 1).
     * @default currentYear + 1
     */
    YEAR3: z.coerce.number().int().default(new Date().getFullYear() + 1),
    /**
     * Template for constructing search queries.
     * Supports `${Title}`, `${Acronym}`, `${Year2}` placeholders.
     * @default '${Title} ${Acronym} ${Year2} conference'
     */
    SEARCH_QUERY_TEMPLATE: z.string().default('${Title} ${Acronym} ${Year2} conference'),
    /**
     * Maximum number of search results links to process for each query.
     * @default 4
     */
    MAX_LINKS: z.coerce.number().int().positive().default(4),

    // --- Google Custom Search Configuration ---
    /**
     * Google Custom Search Engine ID.
     * @description Optional, but required if Google Custom Search is used.
     */
    GOOGLE_CSE_ID: z.string().optional(),
    /**
     * Comma-separated list of Google Custom Search API Keys.
     * Additional keys can be provided as CUSTOM_SEARCH_API_KEY_1, CUSTOM_SEARCH_API_KEY_2, etc.
     */
    GOOGLE_CUSTOM_SEARCH_API_KEYS: z.string().optional().transform(parseCommaSeparatedString('GOOGLE_CUSTOM_SEARCH_API_KEYS')), // Will be augmented by individual keys in constructor
    /**
     * Maximum number of usages per Google Custom Search API key before rotation.
     * @default 200 (Google's daily limit for free tier)
     */
    MAX_USAGE_PER_KEY: z.coerce.number().int().positive().default(200),
    /**
     * Delay in milliseconds before rotating to the next Google API key after hitting a limit.
     * @default 60000 (1 minute)
     */
    KEY_ROTATION_DELAY_MS: z.coerce.number().int().positive().default(60000),
    /**
     * Maximum number of retries for Google Custom Search queries.
     * @default 10
     */
    MAX_SEARCH_RETRIES: z.coerce.number().int().nonnegative().default(10),
    /**
     * Delay in milliseconds between retries for Google Custom Search queries.
     * @default 2000 (2 seconds)
     */
    RETRY_DELAY_MS: z.coerce.number().int().positive().default(2000),

    // --- Keyword/Domain Filtering Configuration ---
    /**
     * Comma-separated list of unwanted domains to skip during crawling (case-insensitive).
     */
    UNWANTED_DOMAINS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('UNWANTED_DOMAINS')),
    /**
     * Comma-separated list of keywords to skip processing pages containing them (case-insensitive).
     */
    SKIP_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('SKIP_KEYWORDS')),
    /**
     * Comma-separated list of keywords indicating main content areas (case-insensitive).
     */
    MAIN_CONTENT_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('MAIN_CONTENT_KEYWORDS')),
    /**
     * Comma-separated list of keywords identifying Call for Papers (CFP) tabs/sections (case-insensitive).
     */
    CFP_TAB_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('CFP_TAB_KEYWORDS')),
    /**
     * Comma-separated list of keywords identifying Important Dates tabs/sections (case-insensitive).
     */
    IMPORTANT_DATES_TABS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('IMPORTANT_DATES_TABS')),
    /**
     * Comma-separated list of texts to exclude from extracted content (case-insensitive).
     */
    EXCLUDE_TEXTS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('EXCLUDE_TEXTS')),
    /**
     * Comma-separated list of keywords that must be exactly present for a page to be considered relevant (case-insensitive).
     */
    EXACT_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('EXACT_KEYWORDS')),

    IMAGE_KEYWORDS: z.string().optional().transform(parseCommaSeparatedStringLowerCase('IMAGE_KEYWORDS')),


    // --- Gemini API General Configuration ---
    /**
     * Gemini API Key (primary).
     * @description Required for accessing Gemini models.
     */
    GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),

    /**
     * Maximum number of concurrent requests to the Gemini API.
     * @default 2
     */
    GEMINI_API_CONCURRENCY: z.coerce.number().int().positive().default(2),
    /**
     * Rate limit points per duration for Gemini API.
     * @default 2 (e.g., 2 requests per 60 seconds)
     */
    GEMINI_RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(2),
    /**
     * Duration in seconds for the Gemini API rate limit.
     * @default 60
     */
    GEMINI_RATE_LIMIT_DURATION: z.coerce.number().int().positive().default(60),
    /**
     * Duration in seconds to block requests after hitting the rate limit.
     * @default 30
     */
    GEMINI_RATE_LIMIT_BLOCK_DURATION: z.coerce.number().int().positive().default(30),
    /**
     * Maximum number of retries for Gemini API requests.
     * @default 5
     */
    GEMINI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(5),
    /**
     * Initial delay in milliseconds for Gemini API request retries (exponential backoff).
     * @default 30000 (30 seconds)
     */
    GEMINI_INITIAL_DELAY_MS: z.coerce.number().int().positive().default(30000),
    /**
     * Maximum delay in milliseconds for Gemini API request retries (caps exponential backoff).
     * @default 60000 (1 minute)
     */
    GEMINI_MAX_DELAY_MS: z.coerce.number().int().positive().default(60000),

    // --- Gemini API - Host Agent Specific Configuration ---
    /**
     * Model name for the main Host Agent (e.g., 'gemini-2.5-flash').
     * @default 'gemini-2.5-flash'
     */
    GEMINI_HOST_AGENT_MODEL_NAME: z.string().optional().default("gemini-2.5-flash"),
    /**
     * Temperature for the Host Agent's generation.
     * @default 1.0 (more creative)
     */
    GEMINI_HOST_AGENT_TEMPERATURE: z.coerce.number().min(0).max(2).default(1.0),
    /**
     * Top-P sampling for the Host Agent's generation.
     * @default 0.95
     */
    GEMINI_HOST_AGENT_TOP_P: z.coerce.number().min(0).max(1).default(0.95),
    /**
     * Top-K sampling for the Host Agent's generation.
     * @default 40
     */
    GEMINI_HOST_AGENT_TOP_K: z.coerce.number().int().positive().default(40),
    /**
     * Maximum number of output tokens for the Host Agent's generation.
     * @default 8192
     */
    GEMINI_HOST_AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    /**
     * Desired MIME type for the Host Agent's response (e.g., 'application/json').
     */
    GEMINI_HOST_AGENT_RESPONSE_MIME_TYPE: z.string().optional(),

    // --- Gemini API - Sub Agent Specific Configuration ---
    /**
     * Model name for general Sub Agents (e.g., 'gemini-2.5-flash-lite-preview-06-17').
     * @default 'gemini-2.5-flash-lite-preview-06-17'
     */
    GEMINI_SUB_AGENT_MODEL_NAME: z.string().optional().default("gemini-2.5-flash-lite-preview-06-17"),
    /**
     * Temperature for Sub Agents' generation.
     * @default 0.7
     */
    GEMINI_SUB_AGENT_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),
    /**
     * Top-P sampling for Sub Agents' generation.
     * @default 0.9
     */
    GEMINI_SUB_AGENT_TOP_P: z.coerce.number().min(0).max(1).default(0.9),
    /**
     * Top-K sampling for Sub Agents' generation.
     * @default 32
     */
    GEMINI_SUB_AGENT_TOP_K: z.coerce.number().int().positive().default(32),
    /**
     * Maximum number of output tokens for Sub Agents' generation.
     * @default 4096
     */
    GEMINI_SUB_AGENT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
    /**
     * Desired MIME type for Sub Agents' response.
     * Usually not needed if sub-agents return structured data via functions.
     */
    GEMINI_SUB_AGENT_RESPONSE_MIME_TYPE: z.string().optional(),

    // --- Gemini API - Extract Specific Configuration ---
    /**
     * Comma-separated list of model names for the 'extract' API type (tuned models).
     * @description Required. These models are preferred if available.
     */
    GEMINI_EXTRACT_TUNED_MODEL_NAMES: z.string().min(1, "GEMINI_EXTRACT_TUNED_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_EXTRACT_TUNED_MODEL_NAMES')),
    /**
     * Fallback model name for 'extract' API if all tuned models fail or are unavailable.
     */
    GEMINI_EXTRACT_TUNED_FALLBACK_MODEL_NAME: z.string().optional(),
    /**
     * Comma-separated list of model names for the 'extract' API type (non-tuned models).
     * @description Required. Used if no tuned models are specified or available.
     */
    GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES: z.string().min(1, "GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES')),
    /**
     * Fallback model name for 'extract' API if all non-tuned models fail or are unavailable.
     */
    GEMINI_EXTRACT_NON_TUNED_FALLBACK_MODEL_NAME: z.string().optional(),
    /**
     * Temperature for the 'extract' API's generation.
     * @default 0 (deterministic)
     */
    GEMINI_EXTRACT_TEMPERATURE: z.coerce.number().min(0).max(2).default(0),
    /**
     * Maximum number of output tokens for the 'extract' API's generation.
     * @default 8192
     */
    GEMINI_EXTRACT_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    /**
     * System instruction for the 'extract' API.
     * @description Essential for guiding the model.
     */
    GEMINI_EXTRACT_SYSTEM_INSTRUCTION: z.string().min(1, "GEMINI_EXTRACT_SYSTEM_INSTRUCTION is required"),
    /**
     * Prefix to add to system instruction when using a non-tuned model for 'extract'.
     */
    GEMINI_EXTRACT_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL: z.string().min(1, "GEMINI_EXTRACT_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL is required"),
    /**
     * Whether to allow caching responses for non-tuned 'extract' models.
     * @default false
     */
    GEMINI_EXTRACT_ALLOW_CACHE_NON_TUNED: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),
    /**
     * Whether to allow using few-shot examples for non-tuned 'extract' models.
     * @default true
     */
    GEMINI_EXTRACT_ALLOW_FEWSHOT_NON_TUNED: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),

    // --- Gemini API - CFP Specific Configuration ---
    /**
     * Comma-separated list of model names for the 'cfp' API type (tuned models).
     * @description Required.
     */
    GEMINI_CFP_TUNED_MODEL_NAMES: z.string().min(1, "GEMINI_CFP_TUNED_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_CFP_TUNED_MODEL_NAMES')),
    /**
     * Fallback model name for 'cfp' API if all tuned models fail or are unavailable.
     */
    GEMINI_CFP_TUNED_FALLBACK_MODEL_NAME: z.string().optional(),
    /**
     * Comma-separated list of model names for the 'cfp' API type (non-tuned models).
     * @description Required.
     */
    GEMINI_CFP_NON_TUNED_MODEL_NAMES: z.string().min(1, "GEMINI_CFP_NON_TUNED_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_CFP_NON_TUNED_MODEL_NAMES')),
    /**
     * Fallback model name for 'cfp' API if all non-tuned models fail or are unavailable.
     */
    GEMINI_CFP_NON_TUNED_FALLBACK_MODEL_NAME: z.string().optional(),
    /**
     * Temperature for the 'cfp' API's generation.
     * @default 1.0
     */
    GEMINI_CFP_TEMPERATURE: z.coerce.number().min(0).max(2).default(1.0),
    /**
     * Top-P sampling for the 'cfp' API's generation.
     * @default 0.9
     */
    GEMINI_CFP_TOP_P: z.coerce.number().min(0).max(1).default(0.9),
    /**
     * Top-K sampling for the 'cfp' API's generation.
     * @default 32
     */
    GEMINI_CFP_TOP_K: z.coerce.number().int().positive().default(32),
    /**
     * Maximum number of output tokens for the 'cfp' API's generation.
     * @default 8192
     */
    GEMINI_CFP_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    /**
     * System instruction for the 'cfp' API.
     * @description Essential for guiding the model.
     */
    GEMINI_CFP_SYSTEM_INSTRUCTION: z.string().min(1, "GEMINI_CFP_SYSTEM_INSTRUCTION is required"),
    /**
     * Prefix to add to system instruction when using a non-tuned model for 'cfp'.
     */
    GEMINI_CFP_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL: z.string().min(1, "GEMINI_CFP_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL is required"),
    /**
     * Whether to allow caching responses for non-tuned 'cfp' models.
     * @default false
     */
    GEMINI_CFP_ALLOW_CACHE_NON_TUNED: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),
    /**
     * Whether to allow using few-shot examples for non-tuned 'cfp' models.
     * @default true
     */
    GEMINI_CFP_ALLOW_FEWSHOT_NON_TUNED: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),

    // --- Gemini API - Determine Specific Configuration ---
    /**
     * Comma-separated list of model names for the 'determine' API type (tuned models).
     * @description Required.
     */
    GEMINI_DETERMINE_TUNED_MODEL_NAMES: z.string().min(1, "GEMINI_DETERMINE_TUNED_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_DETERMINE_TUNED_MODEL_NAMES')),
    /**
     * Fallback model name for 'determine' API if all tuned models fail or are unavailable.
     */
    GEMINI_DETERMINE_TUNED_FALLBACK_MODEL_NAME: z.string().optional(),
    /**
     * Comma-separated list of model names for the 'determine' API type (non-tuned models).
     * @description Required.
     */
    GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES: z.string().min(1, "GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES required").transform(parseCommaSeparatedString('GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES')),
    /**
     * Fallback model name for 'determine' API if all non-tuned models fail or are unavailable.
     */
    GEMINI_DETERMINE_NON_TUNED_FALLBACK_MODEL_NAME: z.string().optional(),
    /**
     * Temperature for the 'determine' API's generation.
     * @default 0.1 (low creativity for precise output)
     */
    GEMINI_DETERMINE_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.1),
    /**
     * Top-P sampling for the 'determine' API's generation.
     * @default 0.9
     */
    GEMINI_DETERMINE_TOP_P: z.coerce.number().min(0).max(1).default(0.9),
    /**
     * Top-K sampling for the 'determine' API's generation.
     * @default 32
     */
    GEMINI_DETERMINE_TOP_K: z.coerce.number().int().positive().default(32),
    /**
     * Maximum number of output tokens for the 'determine' API's generation.
     * @default 8192
     */
    GEMINI_DETERMINE_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(8192),
    /**
     * System instruction for the 'determine' API.
     * @description Essential for guiding the model.
     */
    GEMINI_DETERMINE_SYSTEM_INSTRUCTION: z.string().min(1, "GEMINI_DETERMINE_SYSTEM_INSTRUCTION is required"),
    /**
     * Prefix to add to system instruction when using a non-tuned model for 'determine'.
     */
    GEMINI_DETERMINE_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL: z.string().min(1, "GEMINI_DETERMINE_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL is required"),
    /**
     * Whether to allow caching responses for non-tuned 'determine' models.
     * @default false
     */
    GEMINI_DETERMINE_ALLOW_CACHE_NON_TUNED: z.enum(['true', 'false']).transform(val => val === 'true').default('false'),
    /**
     * Whether to allow using few-shot examples for non-tuned 'determine' models.
     * @default true
     */
    GEMINI_DETERMINE_ALLOW_FEWSHOT_NON_TUNED: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),

    // --- Gemini API - Conference Website Description ---
    /**
     * Optional general description of the conference website context, for LLM.
     */
    WEBSITE_DESCRIPTION: z.string().optional(),

    // --- Journal Crawl Configuration ---
    /**
     * Base URL for journal crawling (e.g., Scimago Journal Rank).
     * @default 'https://www.scimagojr.com/journalrank.php?year=2024&type=j'
     */
    JOURNAL_BASE_URL: z.string().default('https://www.scimagojr.com/journalrank.php?year=2024&type=j'),
    /**
     * Number of retries for failed journal crawl requests.
     * @default 3
     */
    JOURNAL_RETRY_RETRIES: z.coerce.number().int().nonnegative().default(3),
    /**
     * Minimum timeout in milliseconds between journal crawl retries.
     * @default 1000 (1 second)
     */
    JOURNAL_RETRY_MIN_TIMEOUT: z.coerce.number().int().positive().default(1000),
    /**
     * Factor by which the retry timeout increases with each attempt.
     * @default 2 (exponential backoff)
     */
    JOURNAL_RETRY_FACTOR: z.coerce.number().positive().default(2),
    /**
     * Time-to-live (TTL) for journal crawl cache entries in seconds.
     * @default 60 * 60 * 24 (24 hours)
     */
    JOURNAL_CACHE_TTL: z.coerce.number().int().positive().default(60 * 60 * 24),
    /**
     * Period in seconds to check and clean up expired cache entries.
     * @default 60 * 60 (1 hour)
     */
    JOURNAL_CACHE_CHECK_PERIOD: z.coerce.number().int().positive().default(60 * 60),
    /**
     * Whether to crawl BioXBio data specifically for journals.
     * @default true
     */
    JOURNAL_CRAWL_BIOXBIO: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),
    /**
     * Mode for journal crawling: 'scimago' for web scraping, 'csv' for local CSV import.
     * @default 'scimago'
     */
    JOURNAL_CRAWL_MODE: z.enum(['scimago', 'csv']).default('scimago'),
    /**
     * Whether to crawl detailed information for each journal.
     * @default true
     */
    JOURNAL_CRAWL_DETAILS: z.enum(['true', 'false']).transform(val => val === 'true').default('true'),
    /**
     * Comma-separated headers expected in the journal CSV file if `JOURNAL_CRAWL_MODE` is 'csv'.
     */
    JOURNAL_CSV_HEADERS: z.string().default("Title,Type,SJR,H index,Total Docs. (2024),Total Docs. (3years),Total Refs. (2024),Total Cites (3years),Citable Docs. (3years),Cites / Doc. (2years),Ref. / Doc. (2024),Country,Details"),

    // --- Other Configuration ---
    /**
     * Base URL for external API calls (e.g., ConfHub API).
     * @default 'https://confhub.westus3.cloudapp.azure.com/api/v1'
     */
    API_BASE_URL: z.string().optional().default("https://confhub.westus3.cloudapp.azure.com/api/v1"),



    // --- Intent Handler / Chatbot Agent Configuration ---
    /**
     * Comma-separated list of allowed sub-agents that the Host Agent can delegate to.
     * If empty, a default list is used: 'ConferenceAgent', 'JournalAgent', 'AdminContactAgent', 'NavigationAgent', 'WebsiteInfoAgent'.
     */
    ALLOWED_SUB_AGENTS: z.string()
        .optional()
        .transform(parseAgentIdArray('ALLOWED_SUB_AGENTS')),
    /**
     * Maximum number of turns (user-agent exchanges) for the Host Agent in a conversation.
     * Prevents infinite loops.
     * @default 6
     */
    MAX_TURNS_HOST_AGENT: z.coerce.number().int().positive().default(6),

    // --- Output File Subdirectories ---
    /**
     * Subdirectory name within `BASE_OUTPUT_DIR` for JSONL output files.
     * @default 'jsonl_outputs'
     */
    JSONL_OUTPUT_SUBDIR: z.string().default('jsonl_outputs'),
    /**
     * Subdirectory name within `BASE_OUTPUT_DIR` for CSV output files.
     * @default 'csv_outputs'
     */
    CSV_OUTPUT_SUBDIR: z.string().default('csv_outputs'),

    CHATBOT_CLIENT_TEST_LOG_DIR: z.string().default('chatbot_logs'),

    SAVE_CONFERENCE_STATUS_OUTPUT_SUBDIR: z.string().default('save_conference_status_outputs'),
    SAVE_JOURNAL_STATUS_OUTPUT_SUBDIR: z.string().default('save_journal_status_outputs'),

});
