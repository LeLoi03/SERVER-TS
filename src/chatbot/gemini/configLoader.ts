// src/gemini/configLoader.ts
import dotenv from 'dotenv';
// Import the new GenerateContentConfig type from the new SDK
// Assuming the types are available from a central 'types.ts' or similar
// based on the provided library structure.
// If the new SDK is installed as a package, it would be:
import { GenerateContentConfig } from "@google/genai"; // Or the correct package name
// For now, let's assume a local types.ts based on the provided library code
// import { GenerateContentConfig } from './types'; // Placeholder, adjust if SDK installed

dotenv.config();

/**
 * Loads model configuration parameters from environment variables based on a given prefix.
 * Default values are provided if environment variables are not set.
 *
 * @param {string} prefix - The prefix for environment variables (e.g., 'DETERMINE', 'EXTRACT_INFO', 'EXTRACT_CFP').
 *                          Expected environment variables: `${prefix}_TEMPERATURE`, `${prefix}_TOP_P`, etc.
 * @param {import('pino').Logger} [logger] - Optional logger instance for logging loaded configuration.
 * @returns {GenerateContentConfig} An object containing the loaded model configuration.
 */
export function loadModelConfig(prefix: string, logger?: import('pino').Logger): GenerateContentConfig {
    const config: GenerateContentConfig = {
        temperature: parseFloat(process.env[`${prefix}_TEMPERATURE`] || "0.3"),
        topP: parseFloat(process.env[`${prefix}_TOP_P`] || "0.5"),
        topK: parseInt(process.env[`${prefix}_TOP_K`] || "40", 10), // topK is a number
        maxOutputTokens: parseInt(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || "8192", 10),
        responseMimeType: process.env[`${prefix}_RESPONSE_MIME_TYPE`],
        // Other fields from GenerateContentConfig can be added here if needed,
        // e.g., stopSequences, candidateCount, etc., with their defaults or env vars.
    };

    if (logger) {
        logger.info({ event: 'model_config_loaded', prefix, config }, `Loaded model configuration for prefix "${prefix}".`);
    } else {
        console.log(`[ConfigLoader] Loaded model config for ${prefix}: ${JSON.stringify(config)}`);
    }
    return config;
}