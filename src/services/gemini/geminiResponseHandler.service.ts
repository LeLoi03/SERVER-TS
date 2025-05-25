// src/services/gemini/geminiResponseHandler.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import { type GenerateContentResult } from "@google/generative-ai";
import { ConfigService } from '../../config/config.service';
import { Logger } from 'pino';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

import { ProcessedGeminiResponse } from '../../types/crawl';

@singleton()
export class GeminiResponseHandlerService {
    private readonly responseOutputDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
    ) {
        this.responseOutputDir = path.join(this.configService.baseOutputDir, 'gemini_responses');
        const initLogger = console; // Or a basic pino instance for early logs
        initLogger.log(`[GeminiResponseHandlerService] Initialized. Response output directory: ${this.responseOutputDir}`);
    }

    /**
     * Helper to strip markdown code blocks (e.g., ```json ... ``` or ``` ... ```) if present.
     * @param text The input string.
     * @param logger A logger instance for contextual logging.
     * @returns The text with markdown wrappers removed, or the original text if no wrapper was found.
     */
    private stripMarkdownJsonWrapper(text: string, logger: Logger): string {
        if (!text || text.trim() === "") {
            logger.trace({ event: 'strip_markdown_empty_input' }, "Input to stripMarkdownJsonWrapper is empty.");
            return "";
        }

        // Regex to find ```json ... ``` or ``` ... ``` (case-insensitive for 'json', multiline)
        // It captures the content within the backticks.
        const markdownJsonMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/im);
        if (markdownJsonMatch && markdownJsonMatch[1]) {
            const extractedJson = markdownJsonMatch[1].trim();
            logger.info({
                event: 'gemini_api_response_markdown_stripped',
                originalLength: text.length,
                extractedLength: extractedJson.length,
                // originalSnippet: text.substring(0, 100), // Optional: log snippets
                // extractedSnippet: extractedJson.substring(0, 100)
            }, "Stripped markdown JSON block from response text.");
            return extractedJson;
        }
        logger.trace({ event: 'strip_markdown_no_wrapper_found' }, "No markdown wrapper found in text.");
        return text; // Return original text if no markdown wrapper found
    }

    public processResponse(
        sdkResult: GenerateContentResult,
        logger: Logger
    ): ProcessedGeminiResponse {
        const response = sdkResult?.response;
        const feedback = response?.promptFeedback;

        // 1. Initial checks for response object and safety blocking
        if (!response) {
            logger.warn({ feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing `response` object.");
            if (feedback?.blockReason) {
                logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked_missing_body' }, "Request blocked by safety settings: Missing response body.");
                throw new Error(`Request blocked by safety settings: ${feedback.blockReason}. (Response object was missing)`);
            }
            throw new Error("Empty or invalid response object from Gemini API (response field was null/undefined).");
        }

        if (feedback?.blockReason) {
            logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Gemini API response was blocked by safety settings.");
            throw new Error(`Request blocked by safety settings: ${feedback.blockReason}.`);
        }

        // 2. Extract raw text from SDK response
        let rawResponseText = "";
        try {
            rawResponseText = response.text();
            logger.debug({ event: 'gemini_api_text_extract_success' }, "Successfully extracted text using response.text().");
        } catch (textError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(textError);
            logger.warn({ err: { message: errorMessage, stack: errorStack }, event: 'gemini_api_text_extract_failed' }, `Response.text() accessor failed: "${errorMessage}". Attempting fallback extraction.`);
            rawResponseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (!rawResponseText) {
                logger.error({ responseStructure: JSON.stringify(response)?.substring(0, 500), event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback mechanism. This will likely fail JSON parsing.");
            } else {
                logger.debug({ event: 'gemini_api_text_extract_fallback_success' }, "Successfully extracted text using fallback method.");
            }
        }

        // 3. Strip Markdown (if any) from the raw text
        let processedText = this.stripMarkdownJsonWrapper(rawResponseText, logger.child({ sub_op: 'stripMarkdownInProcess' }));

        // 4. Fix Trailing Commas (on potentially unwrapped text)
        const originalTextForCommaCheck = processedText;
        if (processedText.trim().length > 0) { // Only attempt if there's content
            processedText = processedText.replace(/,(\s*})/g, '$1'); // Fix for objects: { "key": "value", } -> { "key": "value" }
            processedText = processedText.replace(/,(\s*])/g, '$1'); // Fix for arrays: [ "item1", ] -> [ "item1" ]

            if (processedText !== originalTextForCommaCheck) {
                logger.info({
                    event: 'gemini_api_response_trailing_comma_fixed',
                    originalSnippetTail: originalTextForCommaCheck.substring(Math.max(0, originalTextForCommaCheck.length - 70)),
                    fixedSnippetTail: processedText.substring(Math.max(0, processedText.length - 70))
                }, "Attempted to fix trailing commas in (potentially unwrapped) Gemini response text.");
            }
        }

        // 5. Mandatory JSON parsing validation (on potentially unwrapped and comma-fixed text)
        try {
            // If text became empty after stripping markdown or was initially empty, it's an error.
            if (processedText.trim() === "") {
                logger.error({
                    originalRawResponseSnippet: rawResponseText.substring(0, 200), // Show what it was before processing
                    event: 'gemini_api_response_empty_after_processing'
                }, "Response text became empty after stripping markdown or was initially empty. This will be treated as an API error.");
                throw new Error("Response text is empty after processing (e.g., stripping markdown or initial empty response).");
            }
            JSON.parse(processedText); // Attempt to parse
            logger.debug({ event: 'gemini_api_response_valid_json', responseTextLength: processedText.length, responseTextSnippet: processedText.substring(0,100) }, "Gemini response text successfully validated as JSON.");
        } catch (jsonParseError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(jsonParseError);
            logger.error({
                err: { message: errorMessage, stack: errorStack },
                originalRawResponseSnippet: rawResponseText.substring(0, 500), // Log the original raw text for context
                processedTextSnippet: processedText.substring(0, 500),       // Log the text that actually failed parsing
                event: 'gemini_api_response_invalid_json'
            }, "Gemini response text is not valid JSON (after markdown stripping and comma fixing attempts). This will be treated as an API error and should trigger a retry.");
            throw new Error(`Gemini response is not valid JSON: ${errorMessage}. Processed text snippet (that failed): ${processedText.substring(0,100)}`);
        }

        const metaData = response.usageMetadata ?? null;

        // Return the processedText which has been unwrapped, comma-fixed, and validated as JSON
        return { responseText: processedText, metaData };
    }

    public async writeResponseToFile(
        responseText: string,
        apiType: string,
        acronym: string | undefined,
        batchIndex: number,
        parentLogger: Logger
    ): Promise<void> {
        const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
        const responseOutputPath = path.join(this.responseOutputDir, `result_${apiType}_${safeAcronym}_${batchIndex}.txt`);
        
        const fileWriteLogger = parentLogger.child({ sub_operation: 'response_file_write_async', filePath: responseOutputPath });
        const fileLogContext = { ...parentLogger.bindings(), filePath: responseOutputPath, event_group: 'response_file_write' };

        try {
            if (!existsSync(this.responseOutputDir)) {
                await fsPromises.mkdir(this.responseOutputDir, { recursive: true });
                fileWriteLogger.info({ directory: this.responseOutputDir, event: 'response_dir_created' }, "Created response output directory.");
            }
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Attempting to write response to file.");
            await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8"); // Ensure responseText is not null/undefined
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file.");
        } catch (fileWriteError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(fileWriteError);
            fileWriteLogger.error({ ...fileLogContext, err: { message: errorMessage, stack: errorStack }, event: 'response_file_write_failed' }, `Error writing response to file: "${errorMessage}".`);
        }
    }

    /**
     * cleanJsonResponse:
     * This method is called by the public methods in GeminiApiService AFTER processResponse has succeeded.
     * Its main role is a final cleanup, primarily focusing on extracting the core JSON object if, for some
     * unexpected reason, the responseText (which should already be valid JSON) still contains some
     * non-JSON artifacts or if this method is called directly with un-processed text.
     * The heavy lifting of markdown stripping and comma fixing is done in `processResponse`.
     */
    public cleanJsonResponse(
        responseText: string, // This text should ideally be clean, validated JSON from processResponse
        loggerForCleaning: Logger
    ): string {
        if (!responseText || responseText.trim() === "") {
            loggerForCleaning.debug({ event: 'json_clean_empty_input' }, "Input to cleanJsonResponse is empty or whitespace. Returning empty string.");
            return "";
        }
        loggerForCleaning.trace({ rawResponseSnippet: responseText.substring(0, 500) }, "Attempting to clean JSON response (final pass, or if called directly).");

        // Attempt to strip markdown again as a fallback, in case this method is called with raw text.
        const textToClean = this.stripMarkdownJsonWrapper(responseText, loggerForCleaning.child({sub_op: 'stripMarkdownInCleanJson'}));

        // If after stripping markdown, the text is empty, return empty.
        if (textToClean.trim() === "") {
            loggerForCleaning.debug({ event: 'json_clean_empty_after_markdown_strip_fallback' }, "Text became empty after markdown stripping in cleanJsonResponse. Returning empty string.");
            return "";
        }

        // The primary goal now is to ensure we have just the JSON object,
        // in case the validated JSON from processResponse was somehow still wrapped or had leading/trailing non-JSON text.
        const firstCurly = textToClean.indexOf('{');
        const lastCurly = textToClean.lastIndexOf('}');
        let cleanedResponseText = "";

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = textToClean.substring(firstCurly, lastCurly + 1);
            try {
                // Validate that this extracted substring is indeed JSON.
                // This is crucial because processResponse already validated the *entire* string it returned.
                // Here, we are validating a *substring*.
                JSON.parse(potentialJson);
                cleanedResponseText = potentialJson.trim(); // .trim() is good practice
                loggerForCleaning.debug({ event: 'json_clean_structure_validated_in_cleaner' }, "Validated JSON structure within cleanJsonResponse after potential final stripping.");
            } catch (parseError: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(parseError);
                // This implies that even though processResponse thought the whole string was JSON,
                // the substring between the first and last curly braces is NOT valid JSON.
                // This is an unusual case but possible if the structure is like "{...} non-json {...}".
                loggerForCleaning.warn({
                    textSnippet: textToClean.substring(0, 200),
                    potentialJsonSnippet: potentialJson.substring(0,200),
                    err: { message: errorMessage },
                    event: 'json_clean_substring_parse_failed_in_cleaner'
                }, `Extracted potential JSON substring failed to parse within cleanJsonResponse: "${errorMessage}". Returning empty string.`);
                cleanedResponseText = "";
            }
        } else {
            // This means the text (after potential markdown stripping) does not even contain a {...} structure.
            // If processResponse worked correctly, this should not happen unless responseText was not JSON to begin with.
            loggerForCleaning.warn({
                textSnippet: textToClean.substring(0, 200),
                event: 'json_clean_structure_not_found_in_cleaner'
            }, "No valid JSON structure ({...}) found in the response text within cleanJsonResponse. Returning empty string.");
            cleanedResponseText = "";
        }
        return cleanedResponseText;
    }
}