// src/gemini/configLoader.ts
import dotenv from 'dotenv';
dotenv.config();
// import logToFile from '../../utils/logger'; // Removed as we'll use a logger (Pino) if available

/**
 * Defines the structure for Gemini model configuration parameters.
 */
export interface ModelConfig {
    /** The sampling temperature for generating responses. Higher values make the output more random. */
    temperature: number;
    /** The cumulative probability cutoff for token selection. */
    topP: number;
    /** The number of highest probability tokens to consider. */
    topK: number;
    /** The maximum number of tokens to generate in the response. */
    maxOutputTokens: number;
    /** The desired MIME type for the response (e.g., 'application/json'). Can be undefined. */
    responseMimeType: string | undefined;
}

/**
 * Loads model configuration parameters from environment variables based on a given prefix.
 * Default values are provided if environment variables are not set.
 *
 * @param {string} prefix - The prefix for environment variables (e.g., 'DETERMINE', 'EXTRACT_INFO', 'EXTRACT_CFP').
 *                          Expected environment variables: `${prefix}_TEMPERATURE`, `${prefix}_TOP_P`, etc.
 * @param {import('pino').Logger} [logger] - Optional logger instance for logging loaded configuration.
 * @returns {ModelConfig} An object containing the loaded model configuration.
 */
export function loadModelConfig(prefix: string, logger?: import('pino').Logger): ModelConfig {
    const config: ModelConfig = {
        temperature: parseFloat(process.env[`${prefix}_TEMPERATURE`] || "0.3"),
        topP: parseFloat(process.env[`${prefix}_TOP_P`] || "0.5"),
        topK: parseInt(process.env[`${prefix}_TOP_K`] || "40", 10),
        maxOutputTokens: parseInt(process.env[`${prefix}_MAX_OUTPUT_TOKENS`] || "8192", 10),
        responseMimeType: process.env[`${prefix}_RESPONSE_MIME_TYPE`],
    };

    // Use the provided logger if available, otherwise fallback to console.log
    if (logger) {
        logger.info({ event: 'model_config_loaded', prefix, config }, `Loaded model configuration for prefix "${prefix}".`);
    } else {
        // If no logger is passed (e.g., in early startup or independent scripts), use console.log
        console.log(`[ConfigLoader] Loaded model config for ${prefix}: ${JSON.stringify(config)}`);
    }
    return config;
}