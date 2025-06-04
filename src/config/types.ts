// src/config/types.ts
import { z } from 'zod';
import { type Schema, type GenerationConfig as SDKGenerationConfig } from "@google/genai";
import { type envSchema } from './schemas'; // Will be created next
import { AgentId } from '../chatbot/shared/types';

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
    modelNames?: string[]; // This might be handled internally by GeminiApiTypeConfig
    /**
     * Optional single model name for API types that use a fixed model.
     */
    modelName?: string; // This might be handled internally by GeminiApiTypeConfig
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
    /**
     * Optional response schema for Gemini API.
     */
    responseSchema?: Schema;
}

/**
 * A record mapping API type identifiers to their respective `GeminiApiConfig`.
 */
export type GeminiApiConfigs = Record<string, GeminiApiConfig>;

/**
 * Type inferred from the Zod schema for environment variables.
 * This represents the raw parsed configuration.
 */
export type AppConfigFromSchema = z.infer<typeof envSchema>;

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
     * A dynamically populated array of all Gemini API Keys found in environment variables
     * from `GEMINI_API_KEY_N`. The base `GEMINI_API_KEY` is separate.
     */
    GEMINI_API_KEYS: string[];
};

// Specific structured config types for getters
export interface PlaywrightConfigStruct {
    channel: string | undefined;
    headless: boolean;
    userAgent: string;
}

export interface GoogleSearchConfigStruct {
    cseId: string | undefined;
    apiKeys: string[];
    maxUsagePerKey: number;
    rotationDelayMs: number;
    maxRetries: number;
    retryDelayMs: number;
}

export interface JournalRetryOptionsStruct {
    retries: number;
    minTimeout: number;
    factor: number;
}

export interface JournalCacheOptionsStruct {
    stdTTL: number;
    checkperiod: number;
}