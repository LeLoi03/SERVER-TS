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
import { InputsOutputs } from '../types/crawl.types';
import { AgentId } from '../chatbot/shared/types'; // IMPORTANT: Import AgentId type

// --- Constants for File Paths ---
/**
 * Path to the CSV file containing few-shot examples for determining links.
 * @type {string}
 */
const DETERMINE_LINKS_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/determine_links.csv");

/**
 * Path to the CSV file containing few-shot examples for extracting general information.
 * @type {string}
 */
const EXTRACT_INFORMATION_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/extract_info.csv");

/**
 * Path to the CSV file containing few-shot examples for extracting CFP information.
 * @type {string}
 */
const CFP_INFORMATION_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/extract_cfp.csv");

// --- Constants for Gemini API Types ---
/**
 * Identifier for the 'extract' API type in Gemini API configurations.
 * @type {string}
 */
const API_TYPE_EXTRACT: string = "extract";

/**
 * Identifier for the 'cfp' API type in Gemini API configurations.
 * @type {string}
 */
const API_TYPE_CFP: string = "cfp";

/**
 * Identifier for the 'determine' API type in Gemini API configurations.
 * @type {string}
 */
const API_TYPE_DETERMINE: string = "determine";

// --- Helper Functions for Environment Variable Parsing ---

/**
 * Parses a comma-separated string from an environment variable into an array of trimmed strings.
 * @param {string} key - The environment variable key (for logging/error messages).
 * @returns {(val: string | undefined) => string[]} A function that takes a string or undefined and returns a string array.
 */
const parseCommaSeparatedString = (key: string): (val: string | undefined) => string[] => (val: string | undefined): string[] => {
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
const parseCommaSeparatedStringLowerCase = (key: string): (val: string | undefined) => string[] => (val: string | undefined): string[] => {
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
const parseAgentIdArray = (key: string): (val: string | undefined) => AgentId[] => (val: string | undefined): AgentId[] => {
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
const envSchema = z.object({
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
     * @default 'app.log'
     */
    LOG_FILE_NAME: z.string().default('app.log'),
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

    // --- P-Queue / Concurrency Configuration ---
    /**
     * Maximum number of concurrent crawl operations.
     * @default 5
     */
    CRAWL_CONCURRENCY: z.coerce.number().int().positive().default(5),

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

    // --- Gemini API General Configuration ---
    /**
     * Gemini API Key (or comma-separated list).
     * @description Required for accessing Gemini models.
     */
    GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"), // Changed to transform to array
    
    /**
     * Maximum number of concurrent requests to the Gemini API.
     * @default 2
     */
    GEMINI_API_CONCURRENCY: z.coerce.number().int().positive().default(5),
    /**
     * Rate limit points per duration for Gemini API.
     * @default 2 (e.g., 2 requests per 60 seconds)
     */
    GEMINI_RATE_LIMIT_POINTS: z.coerce.number().int().positive().default(3),
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
     * Model name for the main Host Agent (e.g., 'gemini-2.0-flash').
     * @default 'gemini-2.0-flash'
     */
    GEMINI_HOST_AGENT_MODEL_NAME: z.string().optional().default("gemini-2.0-flash"),
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
     * Model name for general Sub Agents (e.g., 'gemini-1.5-flash-latest').
     * @default 'gemini-1.5-flash-latest'
     */
    GEMINI_SUB_AGENT_MODEL_NAME: z.string().optional().default("gemini-1.5-flash-latest"),
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
     * @default 'https://www.scimagojr.com/journalrank.php?year=2023&type=j'
     */
    JOURNAL_BASE_URL: z.string().default('https://www.scimagojr.com/journalrank.php?year=2023&type=j'),
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
    JOURNAL_CSV_HEADERS: z.string().default("Title,Type,SJR,H index,Total Docs. (2023),Total Docs. (3years),Total Refs. (2023),Total Cites (3years),Citable Docs. (3years),Cites / Doc. (2years),Ref. / Doc. (2023),Country,Details"),

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

    SAVE_STATUS_OUTPUT_SUBDIR: z.string().default('save_status_outputs'),

});

// --- Define Interfaces for Structured Config ---

/**
 * Interface defining the structure for Gemini API specific configurations,
 * including generation parameters, system instructions, and few-shot examples.
 */
export interface GeminiApiConfig {
    /**
     * Gemini SDK generation configuration parameters (temperature, topP, topK, etc.).
     */
    generationConfig: SDKGenerationConfig;
    /**
     * System instruction string provided to the Gemini model.
     */
    systemInstruction: string;
    /**
     * A prefix to add to the system instruction when using a non-tuned model.
     */
    systemInstructionPrefixForNonTunedModel: string;
    /**
     * Optional list of model names for API types that use multiple models (e.g., for round-robin).
     * Note: Actual selection logic handled in `GeminiApiService`.
     */
    modelNames?: string[];
    /**
     * Optional single model name for API types that use a fixed model.
     */
    modelName?: string;
    /**
     * Few-shot input examples (user prompts) for the model. Keys are example IDs, values are prompts.
     */
    inputs?: Record<string, string>;
    /**
     * Few-shot output examples (model responses) corresponding to the inputs. Keys are example IDs, values are responses.
     */
    outputs?: Record<string, string>;
    /**
     * Flag indicating whether caching of responses is allowed for non-tuned models for this API type.
     */
    allowCacheForNonTuned?: boolean;
    /**
     * Flag indicating whether few-shot examples are allowed to be used for non-tuned models for this API type.
     */
    allowFewShotForNonTuned?: boolean;
}

/**
 * A record mapping API type identifiers to their respective `GeminiApiConfig`.
 */
export type GeminiApiConfigs = Record<string, GeminiApiConfig>;

/**
 * Type inferred from the Zod schema for environment variables.
 * This represents the raw parsed configuration.
 */
type AppConfigFromSchema = z.infer<typeof envSchema>;

/**
 * The final application configuration type, combining schema-inferred types
 * with any manually added properties (e.g., `GOOGLE_CUSTOM_SEARCH_API_KEYS` populated from multiple env vars).
 */
export type AppConfig = AppConfigFromSchema & {
    /**
     * A dynamically populated array of all Google Custom Search API Keys found in environment variables.
     * Includes `GOOGLE_CUSTOM_SEARCH_API_KEYS` from the schema and any `CUSTOM_SEARCH_API_KEY_N`.
     */
    GOOGLE_CUSTOM_SEARCH_API_KEYS: string[];
    /**
     * A dynamically populated array of all Gemini API Keys found in environment variables.
     * `GEMINI_API_KEY_N`.
     */
    GEMINI_API_KEYS: string[]; // Add the new property for Gemini API keys
};

/**
 * `ConfigService` is a singleton class responsible for loading, validating, and providing
 * all application configuration from environment variables.
 * It also handles the initialization of Gemini API few-shot examples from CSV files.
 */
@singleton()
export class ConfigService {
    /**
     * The validated and parsed application configuration.
     * @readonly
     */
    public readonly config: AppConfig;

    /**
     * Configurations specific to different Gemini API types, including generation parameters,
     * system instructions, and few-shot examples.
     * @readonly
     */
    public readonly geminiApiConfigs: GeminiApiConfigs;

    /**
     * Generation configuration for the main Host Agent Gemini model.
     * @readonly
     */
    public readonly hostAgentGenerationConfig: SDKGenerationConfig;

    /**
     * Generation configuration for general Sub Agent Gemini models.
     * @readonly
     */
    public readonly subAgentGenerationConfig: SDKGenerationConfig;

    /**
     * Resolved path to the directory for JSONL output files.
     * @readonly
     */
    public readonly jsonlOutputDir: string;

    /**
     * Resolved path to the directory for CSV output files.
     * @readonly
     */
    public readonly csvOutputDir: string;

    /**
     * Resolved path to the directory for CSV output files.
     * @readonly
     */
    public readonly saveStatusDir: string;

    /**
     * A promise that resolves when the few-shot examples have been loaded.
     * Used to prevent multiple initialization calls.
     * @private
     */
    private initializationPromise: Promise<void> | null = null;

    /**
     * Constructs an instance of `ConfigService`.
     * Loads environment variables, validates them using Zod,
     * and initializes core configuration objects.
     * @throws {Error} If environment variables are invalid or required ones are missing.
     */
    constructor() {
        dotenv.config(); // Load environment variables from .env file

        try {
            // Validate environment variables against the Zod schema
            const parsedConfig = envSchema.parse(process.env);

            // Manually collect all Google Custom Search API Keys
            const googleApiKeys: string[] = [];
            const googleKeyPattern = /^CUSTOM_SEARCH_API_KEY_\d+$/;
            // Add the key from GOOGLE_CUSTOM_SEARCH_API_KEYS if it exists and is not empty
            if (parsedConfig.GOOGLE_CUSTOM_SEARCH_API_KEYS && parsedConfig.GOOGLE_CUSTOM_SEARCH_API_KEYS.length > 0) {
                googleApiKeys.push(...parsedConfig.GOOGLE_CUSTOM_SEARCH_API_KEYS);
            }
            // Add any dynamically numbered Google keys
            for (const envVar in process.env) {
                if (googleKeyPattern.test(envVar) && process.env[envVar]) {
                    googleApiKeys.push(process.env[envVar] as string);
                }
            }
            // Ensure unique Google keys
            const uniqueGoogleApiKeys = [...new Set(googleApiKeys)];

            // Manually collect all Gemini API Keys
            const geminiApiKeys: string[] = [];
            const geminiKeyPattern = /^GEMINI_API_KEY_\d+$/;
            // Add the key from GEMINI_API_KEY if it exists and is not empty
            // if (parsedConfig.GEMINI_API_KEY && parsedConfig.GEMINI_API_KEY.length > 0) {
            //     geminiApiKeys.push(...parsedConfig.GEMINI_API_KEY);
            // }
            // Add any dynamically numbered Gemini keys
            for (const envVar in process.env) {
                if (geminiKeyPattern.test(envVar) && process.env[envVar]) {
                    geminiApiKeys.push(process.env[envVar] as string);
                }
            }
            // Ensure unique Gemini keys
            const uniqueGeminiApiKeys = [...new Set(geminiApiKeys)];


            this.config = {
                ...parsedConfig,
                GOOGLE_CUSTOM_SEARCH_API_KEYS: uniqueGoogleApiKeys,
                GEMINI_API_KEYS: uniqueGeminiApiKeys, // Assign the collected Gemini API keys
            };

            // --- Post-validation checks and default assignments ---

            // Ensure required model lists are not empty
            const requiredModelLists = [
                { key: 'GEMINI_EXTRACT_TUNED_MODEL_NAMES', value: this.config.GEMINI_EXTRACT_TUNED_MODEL_NAMES },
                { key: 'GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES', value: this.config.GEMINI_EXTRACT_NON_TUNED_MODEL_NAMES },
                { key: 'GEMINI_CFP_TUNED_MODEL_NAMES', value: this.config.GEMINI_CFP_TUNED_MODEL_NAMES },
                { key: 'GEMINI_CFP_NON_TUNED_MODEL_NAMES', value: this.config.GEMINI_CFP_NON_TUNED_MODEL_NAMES },
                { key: 'GEMINI_DETERMINE_TUNED_MODEL_NAMES', value: this.config.GEMINI_DETERMINE_TUNED_MODEL_NAMES },
                { key: 'GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES', value: this.config.GEMINI_DETERMINE_NON_TUNED_MODEL_NAMES },
            ];

            for (const modelList of requiredModelLists) {
                if (!modelList.value || modelList.value.length === 0) {
                    const errorMsg = `Configuration error: ${modelList.key} must be a non-empty list of model names. Please check your .env file.`;
                    console.error(`❌ FATAL: ${errorMsg}`);
                    throw new Error(errorMsg);
                }
            }

            // Default CORS_ALLOWED_ORIGINS if not set
            if (!this.config.CORS_ALLOWED_ORIGINS || this.config.CORS_ALLOWED_ORIGINS.length === 0) {
                this.config.CORS_ALLOWED_ORIGINS = ['*'];
                console.log(`[ConfigService] INFO: CORS_ALLOWED_ORIGINS not set, defaulting to ['*'].`);
            }

            // Default ALLOWED_SUB_AGENTS if not set or empty
            if (!this.config.ALLOWED_SUB_AGENTS || this.config.ALLOWED_SUB_AGENTS.length === 0) {
                console.warn("⚠️ WARN: ALLOWED_SUB_AGENTS not set or empty in .env, using default list.");
                this.config.ALLOWED_SUB_AGENTS = [
                    'ConferenceAgent', 'JournalAgent', 'AdminContactAgent',
                    'NavigationAgent', 'WebsiteInfoAgent'
                ] as AgentId[]; // Cast for type safety
            }

            // Warn if Google Custom Search is configured without necessary keys
            if (!this.config.GOOGLE_CSE_ID) {
                console.warn("⚠️ WARN: GOOGLE_CSE_ID environment variable is not set. Google Custom Search might not function.");
            }
            if (this.config.GOOGLE_CUSTOM_SEARCH_API_KEYS.length === 0) {
                console.warn("⚠️ WARN: No Google Custom Search API Keys found. Google Custom Search might not function.");
            }

            // Warn if no Gemini API keys are found
            if (this.config.GEMINI_API_KEYS.length === 0) {
                console.warn("⚠️ WARN: No GEMINI_API_KEY or GEMINI_API_KEY_N environment variables found. Gemini API might not function.");
            }

            // --- Initialize Generation Configs for Host and Sub Agents ---
            this.hostAgentGenerationConfig = {
                temperature: this.config.GEMINI_HOST_AGENT_TEMPERATURE,
                topP: this.config.GEMINI_HOST_AGENT_TOP_P,
                topK: this.config.GEMINI_HOST_AGENT_TOP_K,
                maxOutputTokens: this.config.GEMINI_HOST_AGENT_MAX_OUTPUT_TOKENS,
                ...(this.config.GEMINI_HOST_AGENT_RESPONSE_MIME_TYPE && {
                    responseMimeType: this.config.GEMINI_HOST_AGENT_RESPONSE_MIME_TYPE
                }),
            };

            this.subAgentGenerationConfig = {
                temperature: this.config.GEMINI_SUB_AGENT_TEMPERATURE,
                topP: this.config.GEMINI_SUB_AGENT_TOP_P,
                topK: this.config.GEMINI_SUB_AGENT_TOP_K,
                maxOutputTokens: this.config.GEMINI_SUB_AGENT_MAX_OUTPUT_TOKENS,
                ...(this.config.GEMINI_SUB_AGENT_RESPONSE_MIME_TYPE && {
                    responseMimeType: this.config.GEMINI_SUB_AGENT_RESPONSE_MIME_TYPE
                }),
            };

            // Build configurations for specific Gemini API types (extract, cfp, determine)
            this.geminiApiConfigs = this.buildGeminiApiConfigs();

            // Resolve and store paths for output directories
            this.jsonlOutputDir = path.resolve(this.config.BASE_OUTPUT_DIR, this.config.JSONL_OUTPUT_SUBDIR);
            this.csvOutputDir = path.resolve(this.config.BASE_OUTPUT_DIR, this.config.CSV_OUTPUT_SUBDIR);
            this.saveStatusDir = path.resolve(this.config.BASE_OUTPUT_DIR, this.config.SAVE_STATUS_OUTPUT_SUBDIR);

            // Log successful configuration loading
            console.log("✅ Configuration loaded and validated successfully.");
            console.log(`   - NODE_ENV: ${this.config.NODE_ENV}`);
            console.log(`   - Server Port: ${this.config.PORT}`);
            console.log(`   - Log Level: ${this.config.LOG_LEVEL}`);
            console.log(`   - Base Output Dir: ${this.baseOutputDir}`);
            console.log(`   - JSONL Output Dir: ${this.jsonlOutputDir}`);
            console.log(`   - CSV Output Dir: ${this.csvOutputDir}`);
            console.log(`   - Save Status Output Dir: ${this.saveStatusDir}`);
            console.log(`   - Host Agent Model: ${this.config.GEMINI_HOST_AGENT_MODEL_NAME}`);
            console.log(`   - Host Agent Config: ${JSON.stringify(this.hostAgentGenerationConfig)}`);
            console.log(`   - Sub Agent Model: ${this.config.GEMINI_SUB_AGENT_MODEL_NAME}`);
            console.log(`   - Sub Agent Config: ${JSON.stringify(this.subAgentGenerationConfig)}`);
            console.log(`   - Allowed Sub Agents: ${this.config.ALLOWED_SUB_AGENTS.join(', ')}`);
            console.log(`   - Max Turns Host Agent: ${this.config.MAX_TURNS_HOST_AGENT}`);
            console.log(`   - Number of Gemini API Keys: ${this.config.GEMINI_API_KEYS.length}`); // Log count of Gemini keys
        } catch (error) {
            // Handle Zod validation errors specifically
            if (error instanceof z.ZodError) {
                console.error("❌ Invalid environment variables (schema validation failed):", JSON.stringify(error.format(), null, 2));
            } else {
                console.error("❌ Unexpected error loading configuration:", error);
            }
            // Exit the process if configuration loading fails, as the application cannot run correctly.
            process.exit(1);
        }
    }

    /**
     * Asynchronously initializes few-shot examples for Gemini API types from CSV files.
     * This method is idempotent; it will only load examples once.
     * @returns {Promise<void>} A promise that resolves when examples are loaded.
     */
    public async initializeExamples(): Promise<void> {
        if (!this.initializationPromise) {
            console.log("🚀 Starting loading of API examples...");
            this.initializationPromise = (async () => {
                try {
                    // Load all example data concurrently
                    const [determineExamples, extractExamples, cfpExamples] = await Promise.all([
                        this.loadSpecificExampleData(DETERMINE_LINKS_CSV_PATH, API_TYPE_DETERMINE),
                        this.loadSpecificExampleData(EXTRACT_INFORMATION_CSV_PATH, API_TYPE_EXTRACT),
                        this.loadSpecificExampleData(CFP_INFORMATION_CSV_PATH, API_TYPE_CFP),
                    ]);

                    // Assign loaded examples to their respective Gemini API configurations
                    this.assignExamplesToGeminiConfig(API_TYPE_DETERMINE, determineExamples);
                    this.assignExamplesToGeminiConfig(API_TYPE_EXTRACT, extractExamples);
                    this.assignExamplesToGeminiConfig(API_TYPE_CFP, cfpExamples);

                    // Check if all necessary examples were loaded, or if warnings occurred
                    const allApiTypes = [API_TYPE_DETERMINE, API_TYPE_EXTRACT, API_TYPE_CFP];
                    let allLoadedSuccessfully = true;
                    for (const apiType of allApiTypes) {
                        const config = this.geminiApiConfigs[apiType];
                        if (config && config.allowFewShotForNonTuned && (!config.inputs || Object.keys(config.inputs).length === 0)) {
                            console.warn(`   ⚠️ WARNING: Examples for '${apiType}' (which allows few-shot for non-tuned models) were not loaded or are empty. This might affect model performance.`);
                            allLoadedSuccessfully = false;
                        }
                    }

                    if (allLoadedSuccessfully) {
                        console.log("✅ All required API examples loaded and integrated successfully.");
                    } else {
                        console.warn("⚠️ Some API examples may not have loaded correctly. Please review the logs above.");
                    }

                } catch (error) {
                    console.error("❌ Error during overall API examples loading process:", error);
                    this.initializationPromise = null; // Reset to allow retry on next call
                    // Depending on criticality, you might re-throw the error or just log it.
                    // For now, it logs and allows the app to continue, but downstream services should check for example availability.
                }
            })();
        } else {
            console.log("🔁 API examples loading already in progress or completed. Waiting for completion.");
        }
        await this.initializationPromise; // Ensure the promise completes before returning
    }

    /**
     * Loads example data from a specific CSV file and transforms it into InputsOutputs format.
     * @private
     * @param {string} filePath - The absolute path to the CSV file.
     * @param {string} apiType - The type of API for which examples are being loaded (for logging).
     * @returns {Promise<InputsOutputs | null>} A promise that resolves with the loaded examples, or `null` if loading fails.
     */
    private async loadSpecificExampleData(filePath: string, apiType: string): Promise<InputsOutputs | null> {
        try {
            await fs.promises.access(filePath); // Check if file exists and is accessible
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

    /**
     * Assigns loaded `InputsOutputs` examples to a specific Gemini API configuration.
     * @private
     * @param {string} apiType - The key for the Gemini API type in `geminiApiConfigs`.
     * @param {InputsOutputs | null} examples - The loaded examples or `null` if loading failed.
     */
    private assignExamplesToGeminiConfig(apiType: string, examples: InputsOutputs | null): void {
        if (examples && this.geminiApiConfigs[apiType]) {
            this.geminiApiConfigs[apiType].inputs = examples.inputs;
            this.geminiApiConfigs[apiType].outputs = examples.outputs;
            console.log(`   👍 Loaded ${Object.keys(examples.inputs).length} examples for ${apiType}.`);
        } else if (this.geminiApiConfigs[apiType]) {
            console.log(`   👎 No examples loaded or config missing for ${apiType}.`);
        }
    }

    /**
     * Builds and returns the structured `GeminiApiConfigs` object based on environment variables.
     * This method defines the base generation configurations, system instructions, and schema
     * for different Gemini API use cases.
     * @private
     * @returns {GeminiApiConfigs} An object containing configurations for various Gemini API types.
     */
    private buildGeminiApiConfigs(): GeminiApiConfigs {
        return {
            [API_TYPE_EXTRACT]: {
                generationConfig: {
                    temperature: this.config.GEMINI_EXTRACT_TEMPERATURE,
                    maxOutputTokens: this.config.GEMINI_EXTRACT_MAX_OUTPUT_TOKENS,
                    // responseMimeType is typically "application/json" for tuned models expecting JSON,
                    // or left undefined for non-tuned if parsing text output. Handled in GeminiApiService.
                },
                systemInstruction: this.config.GEMINI_EXTRACT_SYSTEM_INSTRUCTION.trim(),
                systemInstructionPrefixForNonTunedModel: this.config.GEMINI_EXTRACT_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL.trim(),
                allowCacheForNonTuned: this.config.GEMINI_EXTRACT_ALLOW_CACHE_NON_TUNED,
                allowFewShotForNonTuned: this.config.GEMINI_EXTRACT_ALLOW_FEWSHOT_NON_TUNED,
            },
            [API_TYPE_CFP]: {
                generationConfig: {
                    temperature: this.config.GEMINI_CFP_TEMPERATURE,
                    topP: this.config.GEMINI_CFP_TOP_P,
                    topK: this.config.GEMINI_CFP_TOP_K,
                    maxOutputTokens: this.config.GEMINI_CFP_MAX_OUTPUT_TOKENS,
                    // Define a response schema for non-tuned JSON mode to guide model output
                    responseSchema: {
                        type: SchemaType.OBJECT,
                        properties: {
                            "summary": { type: SchemaType.STRING, description: "A brief summary of the conference." },
                            "callForPapers": { type: SchemaType.STRING, description: "The detailed Call for Papers information, including important dates, topics, submission guidelines." },
                        },
                        required: ["summary", "callForPapers"]
                    } as ObjectSchema,
                },
                systemInstruction: this.config.GEMINI_CFP_SYSTEM_INSTRUCTION.trim(),
                systemInstructionPrefixForNonTunedModel: this.config.GEMINI_CFP_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL.trim(),
                allowCacheForNonTuned: this.config.GEMINI_CFP_ALLOW_CACHE_NON_TUNED,
                allowFewShotForNonTuned: this.config.GEMINI_CFP_ALLOW_FEWSHOT_NON_TUNED,
            },
            [API_TYPE_DETERMINE]: {
                generationConfig: {
                    temperature: this.config.GEMINI_DETERMINE_TEMPERATURE,
                    topP: this.config.GEMINI_DETERMINE_TOP_P,
                    topK: this.config.GEMINI_DETERMINE_TOP_K,
                    maxOutputTokens: this.config.GEMINI_DETERMINE_MAX_OUTPUT_TOKENS,
                    // Define a response schema for non-tuned JSON mode
                    responseSchema: {
                        type: SchemaType.OBJECT,
                        properties: {
                            "Official Website": { type: SchemaType.STRING, description: "The official website URL for the conference." },
                            "Call for papers link": { type: SchemaType.STRING, description: "The direct link to the Call for Papers page." },
                            "Important dates link": { type: SchemaType.STRING, description: "The direct link to the Important Dates page." }
                        },
                        required: ["Official Website", "Call for papers link", "Important dates link"]
                    } as ObjectSchema,
                },
                systemInstruction: this.config.GEMINI_DETERMINE_SYSTEM_INSTRUCTION.trim(),
                systemInstructionPrefixForNonTunedModel: this.config.GEMINI_DETERMINE_SYSTEM_INSTRUCTION_PREFIX_FOR_NON_TUNED_MODEL.trim(),
                allowCacheForNonTuned: this.config.GEMINI_DETERMINE_ALLOW_CACHE_NON_TUNED,
                allowFewShotForNonTuned: this.config.GEMINI_DETERMINE_ALLOW_FEWSHOT_NON_TUNED,
            },
        };
    }

    // --- Public Getters for Derived Paths and Structured Configs ---

    /**
     * Gets the resolved absolute path to the logs directory.
     * @returns {string} The path to the logs directory.
     */
    get logsDirectory(): string { return path.resolve(this.config.LOGS_DIRECTORY); }

    /**
     * Gets the resolved absolute path to the main application log file.
     * @returns {string} The path to the application log file.
     */
    get appLogFilePath(): string { return path.join(this.logsDirectory, this.config.LOG_FILE_NAME); }

    /**
     * Gets the resolved absolute path to the base output directory.
     * @returns {string} The base output directory path.
     */
    get baseOutputDir(): string { return path.resolve(this.config.BASE_OUTPUT_DIR); }

    /**
     * Gets the resolved absolute path to the JSON file storing the conference list.
     * @returns {string} The path to the conference list JSON file.
     */
    get conferenceListPath(): string { return path.join(this.baseOutputDir, 'conference_list.json'); }

    /**
     * Gets the resolved absolute path to the custom search output directory.
     * @returns {string} The path to the custom search directory.
     */
    get customSearchDir(): string { return path.join(this.baseOutputDir, 'custom_search'); }

    /**
     * Gets the resolved absolute path to the batches output directory.
     * @returns {string} The path to the batches directory.
     */
    get batchesDir(): string { return path.join(this.baseOutputDir, 'batches'); }

    /**
     * Gets the resolved absolute path to the temporary files directory.
     * @returns {string} The path to the temporary directory.
     */
    get tempDir(): string { return path.join(this.baseOutputDir, 'temp'); }

    /**
     * Gets the resolved absolute path to the error access link log file.
     * @returns {string} The path to the error log file.
     */
    get errorAccessLinkPath(): string { return path.join(this.baseOutputDir, 'error_access_link_log.txt'); }

    /**
     * Gets the structured configuration object for Playwright.
     * @returns {{ channel: string | undefined; headless: boolean; userAgent: string; }} Playwright configuration.
     */
    get playwrightConfig(): { channel: string | undefined; headless: boolean; userAgent: string; } {
        return {
            channel: this.config.PLAYWRIGHT_CHANNEL,
            headless: this.config.PLAYWRIGHT_HEADLESS,
            userAgent: this.config.USER_AGENT,
        };
    }

    /**
     * Gets the structured configuration object for Google Custom Search.
     * @returns {{ cseId: string | undefined; apiKeys: string[]; maxUsagePerKey: number; rotationDelayMs: number; maxRetries: number; retryDelayMs: number; }} Google Search configuration.
     */
    get googleSearchConfig(): { cseId: string | undefined; apiKeys: string[]; maxUsagePerKey: number; rotationDelayMs: number; maxRetries: number; retryDelayMs: number; } {
        return {
            cseId: this.config.GOOGLE_CSE_ID,
            apiKeys: this.config.GOOGLE_CUSTOM_SEARCH_API_KEYS,
            maxUsagePerKey: this.config.MAX_USAGE_PER_KEY,
            rotationDelayMs: this.config.KEY_ROTATION_DELAY_MS,
            maxRetries: this.config.MAX_SEARCH_RETRIES,
            retryDelayMs: this.config.RETRY_DELAY_MS,
        };
    }

    /**
     * Gets the structured retry options for journal crawling.
     * @returns {{ retries: number; minTimeout: number; factor: number; }} Journal retry options.
     */
    get journalRetryOptions(): { retries: number; minTimeout: number; factor: number; } {
        return {
            retries: this.config.JOURNAL_RETRY_RETRIES,
            minTimeout: this.config.JOURNAL_RETRY_MIN_TIMEOUT,
            factor: this.config.JOURNAL_RETRY_FACTOR,
        };
    }

    /**
     * Gets the structured cache options for journal crawling.
     * @returns {{ stdTTL: number; checkperiod: number; }} Journal cache options.
     */
    get journalCacheOptions(): { stdTTL: number; checkperiod: number; } {
        return {
            stdTTL: this.config.JOURNAL_CACHE_TTL,
            checkperiod: this.config.JOURNAL_CACHE_CHECK_PERIOD,
        };
    }

    /**
     * Generates the absolute path for a final JSONL output file for a specific batch request.
     * @param {string} batchRequestId - The unique identifier for the batch request.
     * @returns {string} The absolute path to the JSONL output file.
     */
    public getFinalOutputJsonlPathForBatch(batchRequestId: string): string {
        const filename = `final_output_${batchRequestId}.jsonl`;
        return path.join(this.jsonlOutputDir, filename);
    }

    /**
     * Generates the absolute path for an evaluation CSV file for a specific batch request.
     * @param {string} batchRequestId - The unique identifier for the batch request.
     * @param {string} [baseCsvFilename='evaluate'] - The base name for the CSV file (e.g., 'evaluate', 'summary').
     * @returns {string} The absolute path to the evaluation CSV file.
     */
    public getEvaluateCsvPathForBatch(batchRequestId: string, baseCsvFilename: string = 'evaluate'): string {
        const filename = `${baseCsvFilename}_${batchRequestId}.csv`;
        return path.join(this.csvOutputDir, filename);
    }

    /**
     * Gets the absolute path for a generic, non-batch specific evaluation CSV file.
     * Useful for single-run evaluations or default paths.
     * @returns {string} The absolute path to the base evaluation CSV file.
     */
    public getBaseEvaluateCsvPath(): string {
        return path.join(this.csvOutputDir, 'evaluate.csv');
    }


    public getSaveEventLogFilePath(): string {
        return path.join(this.saveStatusDir, 'conference_save_events.jsonl');
    }
}