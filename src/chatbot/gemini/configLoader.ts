// src/gemini/configLoader.ts
import dotenv from 'dotenv';
dotenv.config();
import logToFile from '../utils/logger';

export interface ModelConfig {
    temperature: number;
    topP: number;
    topK: number;
    maxOutputTokens: number;
    responseMimeType: string | undefined;
}

export function loadModelConfig(prefix: string): ModelConfig {
    const config: ModelConfig = {
        temperature: parseFloat(process.env[`${prefix}_TEMPERATURE`] || "0.3"),
        topP: parseFloat(process.env[`${prefix}_TOP_P`] || "0.5"),
        topK: parseInt(process.env[`${prefix}_TOP_K`] || "40", 10),
        maxOutputTokens: parseInt(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || "8192", 10),
        responseMimeType: process.env[`${prefix}_RESPONSE_MIME_TYPE`],
    };
    logToFile(`Loaded model config for ${prefix}: ${JSON.stringify(config)}`);
    return config;
}
