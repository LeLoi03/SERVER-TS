// src/services/gemini/geminiResponseHandler.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import { type GenerateContentResult, type UsageMetadata } from "@google/generative-ai";
import { ConfigService } from '../../config/config.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import the error utility

/**
 * Interface representing the processed response from Gemini API,
 * including extracted text and usage metadata.
 */
export interface ProcessedGeminiResponse {
    responseText: string;
    metaData: UsageMetadata | null | undefined;
}

/**
 * Service responsible for processing raw responses from the Gemini API,
 * including extracting text content, handling safety feedback,
 * and persisting responses to files. It also provides utilities for cleaning
 * JSON-like strings from Gemini's text output.
 */
@singleton()
export class GeminiResponseHandlerService {
    private readonly responseOutputDir: string; // Directory to save Gemini responses

    /**
     * Constructs an instance of GeminiResponseHandlerService.
     * @param {ConfigService} configService - The injected configuration service.
     */
    constructor(
        @inject(ConfigService) private configService: ConfigService,
    ) {
        // Define the output directory for Gemini responses
        this.responseOutputDir = path.join(this.configService.baseOutputDir, 'gemini_responses');
        console.log(`[GeminiResponseHandlerService] Initialized. Response output directory: ${this.responseOutputDir}`); // Use console.log for early init
    }

    /**
     * Processes the raw `GenerateContentResult` from the Gemini SDK to extract the
     * relevant text response and usage metadata. It also handles cases where the
     * response might be blocked by safety settings.
     *
     * @param {GenerateContentResult} sdkResult - The raw result object from the Gemini SDK.
     * @param {Logger} logger - The logger instance for contextual logging (e.g., from an API attempt).
     * @returns {ProcessedGeminiResponse} An object containing the extracted response text and metadata.
     * @throws {Error} If the response is missing, invalid, or blocked by safety settings.
     */
    public processResponse(
        sdkResult: GenerateContentResult,
        logger: Logger
    ): ProcessedGeminiResponse {
        // The logger passed here (e.g., `attemptApiCallLogger`) already contains context
        // like `apiType`, `batchIndex`, `modelName`, `attempt`, `event_group='gemini_api_attempt'`.
        const response = sdkResult?.response;
        const feedback = response?.promptFeedback;

        if (!response) {
            logger.warn({ feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing `response` object.");
            if (feedback?.blockReason) {
                // If response is missing but feedback indicates blocking, log it
                logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings: Missing response body.");
                throw new Error(`Request blocked by safety settings: ${feedback.blockReason}. (Response object was missing)`);
            }
            throw new Error("Empty or invalid response object from Gemini API (response field was null/undefined).");
        }

        // Check for safety blocking feedback again, now that we know `response` exists.
        if (feedback?.blockReason) {
            logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Gemini API response was blocked by safety settings.");
            throw new Error(`Request blocked by safety settings: ${feedback.blockReason}.`);
        }

        let responseText = "";
        try {
            responseText = response.text(); // Preferred method to extract text
            logger.debug({ event: 'gemini_api_text_extract_success' }, "Successfully extracted text using response.text().");
        } catch (textError: unknown) { // Catch if response.text() fails (e.g., due to tool_code or content issues)
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(textError);
            logger.warn({ err: { message: errorMessage, stack: errorStack }, event: 'gemini_api_text_extract_failed' }, `Response.text() accessor failed: "${errorMessage}". Attempting fallback extraction.`);
            // Fallback: try to access content directly from candidates
            responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (!responseText) {
                logger.error({ responseStructure: JSON.stringify(response)?.substring(0, 500), event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback mechanism.");
                // Original logic returned empty string, not throwing here.
            } else {
                logger.debug({ event: 'gemini_api_text_extract_fallback_success' }, "Successfully extracted text using fallback method.");
            }
        }
        const metaData = response.usageMetadata ?? null; // Extract usage metadata

        return { responseText, metaData };
    }

    /**
     * Asynchronously writes the Gemini API response text to a file.
     * The file path is constructed using API type, acronym, and batch index.
     *
     * @param {string} responseText - The text content of the Gemini response.
     * @param {string} apiType - The type of API call (e.g., 'extractInfo').
     * @param {string | undefined} acronym - The acronym of the conference, used for filename.
     * @param {number} batchIndex - The index of the item within the batch, used for filename.
     * @param {Logger} parentLogger - The logger from the specific API attempt (e.g., `attemptApiCallLogger`).
     * @returns {Promise<void>} A Promise that resolves when the file writing operation is complete.
     */
    public async writeResponseToFile(
        responseText: string,
        apiType: string,
        acronym: string | undefined,
        batchIndex: number,
        parentLogger: Logger
    ): Promise<void> {
        // Sanitize acronym for filename
        const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
        const responseOutputPath = path.join(this.responseOutputDir, `result_${apiType}_${safeAcronym}_${batchIndex}.txt`);
        
        // Create a child logger specifically for this async sub-operation, inheriting parent context.
        const fileWriteLogger = parentLogger.child({ sub_operation: 'response_file_write_async', filePath: responseOutputPath });
        // Create a log context object for consistent logging payload
        const fileLogContext = { ...parentLogger.bindings(), filePath: responseOutputPath, event_group: 'response_file_write' };

        try {
            // Ensure the output directory exists
            if (!existsSync(this.responseOutputDir)) {
                await fsPromises.mkdir(this.responseOutputDir, { recursive: true });
                fileWriteLogger.info({ directory: this.responseOutputDir, event: 'response_dir_created' }, "Created response output directory.");
            }
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Attempting to write response to file.");
            await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8");
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file.");
        } catch (fileWriteError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(fileWriteError);
            fileWriteLogger.error({ ...fileLogContext, err: { message: errorMessage, stack: errorStack }, event: 'response_file_write_failed' }, `Error writing response to file: "${errorMessage}".`);
        }
    }

    /**
     * Attempts to clean a Gemini API response text by extracting a JSON object
     * that might be wrapped in other text or markdown. It finds the first and last
     * curly braces and tries to parse the content between them.
     *
     * @param {string} responseText - The raw text response from the Gemini API.
     * @param {Logger} loggerForCleaning - The logger instance for contextual logging during cleaning.
     * @returns {string} The cleaned JSON string, or an empty string if no valid JSON structure is found or parsing fails.
     */
    public cleanJsonResponse(
        responseText: string,
        loggerForCleaning: Logger
    ): string {
        loggerForCleaning.trace({ rawResponseSnippet: responseText.substring(0, 500) }, "Attempting to clean JSON response.");

        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                // Attempt to parse to validate it's actual JSON
                JSON.parse(potentialJson);
                cleanedResponseText = potentialJson.trim();
                loggerForCleaning.debug({ event: 'json_clean_success' }, "Successfully extracted and validated JSON structure from response.");
            } catch (parseError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
                loggerForCleaning.warn({ rawResponseSnippet: responseText.substring(0, 200), err: { message: errorMessage, stack: errorStack }, event: 'json_clean_parse_failed' }, `Extracted potential JSON failed to parse: "${errorMessage}". Returning empty string.`);
                cleanedResponseText = ""; // Parsing failed, return empty string
            }
        } else {
            loggerForCleaning.warn({ rawResponseSnippet: responseText.substring(0, 200), event: 'json_clean_structure_not_found' }, "No valid JSON structure ({...}) found in the response text. Returning empty string.");
            cleanedResponseText = ""; // No curly braces or invalid range, return empty string
        }
        return cleanedResponseText;
    }
}