// src/config/constants.ts
import path from 'path';

// --- Constants for File Paths ---
/**
 * Path to the CSV file containing few-shot examples for determining links.
 * @type {string}
 */
export const DETERMINE_LINKS_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/determine_links.csv");

/**
 * Path to the CSV file containing few-shot examples for extracting general information.
 * @type {string}
 */
export const EXTRACT_INFORMATION_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/extract_info.csv");

/**
 * Path to the CSV file containing few-shot examples for extracting CFP information.
 * @type {string}
 */
export const CFP_INFORMATION_CSV_PATH: string = path.resolve(__dirname, "../conference/examples/extract_cfp.csv");

// --- Constants for Gemini API Types ---
/**
 * Identifier for the 'extract' API type in Gemini API configurations.
 * @type {string}
 */
export const API_TYPE_EXTRACT: string = "extract";

/**
 * Identifier for the 'cfp' API type in Gemini API configurations.
 * @type {string}
 */
export const API_TYPE_CFP: string = "cfp";

/**
 * Identifier for the 'determine' API type in Gemini API configurations.
 * @type {string}
 */
export const API_TYPE_DETERMINE: string = "determine";