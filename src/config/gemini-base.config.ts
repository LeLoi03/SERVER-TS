// src/config/gemini-base.config.ts
import { singleton } from 'tsyringe';
import { AppConfig } from './types';
import { GenerationConfig as SDKGenerationConfig } from "@google/genai";

@singleton()
export class GeminiBaseConfig {
    public readonly primaryApiKey: string;
    public readonly additionalApiKeys: string[]; // From GEMINI_API_KEY_N
    public readonly apiConcurrency: number;
    public readonly rateLimitPoints: number;
    public readonly rateLimitDuration: number;
    public readonly rateLimitBlockDuration: number;
    public readonly maxRetries: number;
    public readonly initialDelayMs: number;
    public readonly maxDelayMs: number;

    public readonly hostAgentModelName: string;
    public readonly hostAgentGenerationConfig: SDKGenerationConfig;

    public readonly subAgentModelName: string;
    public readonly subAgentGenerationConfig: SDKGenerationConfig;

    constructor(private appConfig: AppConfig) {
        this.primaryApiKey = appConfig.GEMINI_API_KEY;
        this.additionalApiKeys = appConfig.GEMINI_API_KEYS; // Populated from GEMINI_API_KEY_N

        this.apiConcurrency = appConfig.GEMINI_API_CONCURRENCY;
        this.rateLimitPoints = appConfig.GEMINI_RATE_LIMIT_POINTS;
        this.rateLimitDuration = appConfig.GEMINI_RATE_LIMIT_DURATION;
        this.rateLimitBlockDuration = appConfig.GEMINI_RATE_LIMIT_BLOCK_DURATION;
        this.maxRetries = appConfig.GEMINI_MAX_RETRIES;
        this.initialDelayMs = appConfig.GEMINI_INITIAL_DELAY_MS;
        this.maxDelayMs = appConfig.GEMINI_MAX_DELAY_MS;

        this.hostAgentModelName = appConfig.GEMINI_HOST_AGENT_MODEL_NAME!;
        this.hostAgentGenerationConfig = {
            temperature: appConfig.GEMINI_HOST_AGENT_TEMPERATURE,
            topP: appConfig.GEMINI_HOST_AGENT_TOP_P,
            topK: appConfig.GEMINI_HOST_AGENT_TOP_K,
            maxOutputTokens: appConfig.GEMINI_HOST_AGENT_MAX_OUTPUT_TOKENS,
            ...(appConfig.GEMINI_HOST_AGENT_RESPONSE_MIME_TYPE && {
                responseMimeType: appConfig.GEMINI_HOST_AGENT_RESPONSE_MIME_TYPE
            }),
        };

        this.subAgentModelName = appConfig.GEMINI_SUB_AGENT_MODEL_NAME!;
        this.subAgentGenerationConfig = {
            temperature: appConfig.GEMINI_SUB_AGENT_TEMPERATURE,
            topP: appConfig.GEMINI_SUB_AGENT_TOP_P,
            topK: appConfig.GEMINI_SUB_AGENT_TOP_K,
            maxOutputTokens: appConfig.GEMINI_SUB_AGENT_MAX_OUTPUT_TOKENS,
            ...(appConfig.GEMINI_SUB_AGENT_RESPONSE_MIME_TYPE && {
                responseMimeType: appConfig.GEMINI_SUB_AGENT_RESPONSE_MIME_TYPE
            }),
        };
    }
}