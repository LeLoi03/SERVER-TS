// src/services/gemini/geminiResponseHandler.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
// Thay GenerateContentResult bằng GenerateContentResponse
import { type GenerateContentResponse } from "@google/genai"; 
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

        const markdownJsonMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/im);
        if (markdownJsonMatch && markdownJsonMatch[1]) {
            const extractedJson = markdownJsonMatch[1].trim();
            logger.info({
                event: 'gemini_api_response_markdown_stripped',
                originalLength: text.length,
                extractedLength: extractedJson.length,
            }, "Stripped markdown JSON block from response text.");
            return extractedJson;
        }
        logger.trace({ event: 'strip_markdown_no_wrapper_found' }, "No markdown wrapper found in text.");
        return text; 
    }

    public processResponse(
        sdkResult: GenerateContentResponse, // UPDATED type
        logger: Logger
    ): ProcessedGeminiResponse {
        // sdkResult IS the "response" object from the new SDK.
        const feedback = sdkResult?.promptFeedback; // UPDATED: Directly access from sdkResult

        // 1. Initial checks for the overall result and safety blocking
        if (!sdkResult) {
            // This case should ideally be caught by the caller if the API promise resolves to null/undefined
            logger.error({ event: 'gemini_api_null_or_undefined_sdk_result' }, "Gemini SDK returned a null or undefined result object.");
            throw new Error("Gemini SDK returned a null or undefined result.");
        }

        if (feedback?.blockReason) {
            logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Gemini API response was blocked by safety settings.");
            throw new Error(`Request blocked by safety settings: ${feedback.blockReason}.`);
        }

        if (!sdkResult.candidates || sdkResult.candidates.length === 0) {
            logger.warn({ feedback, event: 'gemini_api_response_missing_candidates_without_block' }, "Gemini API returned no candidates and no explicit blockReason. This is unusual.");
            throw new Error("Gemini API response is missing candidates and was not explicitly blocked.");
        }

        // 2. Extract raw text from SDK response
        let rawResponseText = "";
        const extractedViaGetter = sdkResult.text; // Access the .text getter (string | undefined)

        if (typeof extractedViaGetter === 'string' && extractedViaGetter.trim() !== "") {
            rawResponseText = extractedViaGetter;
            logger.debug({ event: 'gemini_api_text_extract_success', method: "getter", length: rawResponseText.length }, "Successfully extracted text using response.text (getter).");
        } else {
            logger.warn({
                event: 'gemini_api_text_extract_getter_empty_or_undefined',
                getterValuePreview: typeof extractedViaGetter === 'string' ? extractedViaGetter.substring(0, 100) : String(extractedViaGetter),
                message: "Attempting fallback extraction, as getter returned no usable text."
            });
            // Fallback logic (similar to original code's fallback if response.text() failed or was empty)
            const fallbackText = sdkResult.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (fallbackText.trim() !== "") {
                rawResponseText = fallbackText;
                logger.debug({ event: 'gemini_api_text_extract_fallback_success', length: rawResponseText.length }, "Successfully extracted text using fallback method.");
            } else {
                // Both getter and fallback yielded no text (or only whitespace)
                logger.error({
                    responseStructureCandidates: JSON.stringify(sdkResult.candidates)?.substring(0, 500),
                    event: 'gemini_api_text_extract_failed_after_fallback' // New event for this specific state
                }, "Could not extract text content from response via getter or fallback mechanism.");
                // rawResponseText remains ""
            }
        }
        
        // Ensure rawResponseText is a string after extraction attempts
        if (typeof rawResponseText !== 'string') {
            rawResponseText = "";
        }

        // 3. Strip Markdown (if any) from the raw text
        let processedText = this.stripMarkdownJsonWrapper(rawResponseText, logger.child({ sub_op: 'stripMarkdownInProcess' }));

        // 4. Fix Trailing Commas (on potentially unwrapped text)
        const originalTextForCommaCheck = processedText;
        if (processedText.trim().length > 0) { 
            processedText = processedText.replace(/,(\s*})/g, '$1'); 
            processedText = processedText.replace(/,(\s*])/g, '$1'); 

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
            if (processedText.trim() === "") {
                logger.error({
                    originalRawResponseSnippet: rawResponseText.substring(0, 200), 
                    event: 'gemini_api_response_empty_after_processing'
                }, "Response text became empty after processing (e.g., stripping markdown or initial empty response). This will be treated as an API error.");
                throw new Error("Response text is empty after processing (e.g., stripping markdown or initial empty response).");
            }
            JSON.parse(processedText); 
            logger.debug({ event: 'gemini_api_response_valid_json', responseTextLength: processedText.length, responseTextSnippet: processedText.substring(0,100) }, "Gemini response text successfully validated as JSON.");
        } catch (jsonParseError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(jsonParseError);
            logger.error({
                err: { message: errorMessage, stack: errorStack },
                originalRawResponseSnippet: rawResponseText.substring(0, 500), 
                processedTextSnippet: processedText.substring(0, 500),       
                event: 'gemini_api_response_invalid_json'
            }, "Gemini response text is not valid JSON (after markdown stripping and comma fixing attempts). This will be treated as an API error and should trigger a retry.");
            throw new Error(`Gemini response is not valid JSON: ${errorMessage}. Processed text snippet (that failed): ${processedText.substring(0,100)}`);
        }

        const metaData = sdkResult.usageMetadata ?? null; // UPDATED: Directly access from sdkResult

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
            await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8"); 
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file.");
        } catch (fileWriteError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(fileWriteError);
            fileWriteLogger.error({ ...fileLogContext, err: { message: errorMessage, stack: errorStack }, event: 'response_file_write_failed' }, `Error writing response to file: "${errorMessage}".`);
        }
    }

    public cleanJsonResponse(
        responseText: string, 
        loggerForCleaning: Logger
    ): string {
        if (!responseText || responseText.trim() === "") {
            loggerForCleaning.debug({ event: 'json_clean_empty_input' }, "Input to cleanJsonResponse is empty or whitespace. Returning empty string.");
            return "";
        }
        loggerForCleaning.trace({ rawResponseSnippet: responseText.substring(0, 500) }, "Attempting to clean JSON response (final pass, or if called directly).");

        const textToClean = this.stripMarkdownJsonWrapper(responseText, loggerForCleaning.child({sub_op: 'stripMarkdownInCleanJson'}));

        if (textToClean.trim() === "") {
            loggerForCleaning.debug({ event: 'json_clean_empty_after_markdown_strip_fallback' }, "Text became empty after markdown stripping in cleanJsonResponse. Returning empty string.");
            return "";
        }

        const firstCurly = textToClean.indexOf('{');
        const lastCurly = textToClean.lastIndexOf('}');
        let cleanedResponseText = "";

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = textToClean.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson);
                cleanedResponseText = potentialJson.trim(); 
                loggerForCleaning.debug({ event: 'json_clean_structure_validated_in_cleaner' }, "Validated JSON structure within cleanJsonResponse after potential final stripping.");
            } catch (parseError: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(parseError);
                loggerForCleaning.warn({
                    textSnippet: textToClean.substring(0, 200),
                    potentialJsonSnippet: potentialJson.substring(0,200),
                    err: { message: errorMessage },
                    event: 'json_clean_substring_parse_failed_in_cleaner'
                }, `Extracted potential JSON substring failed to parse within cleanJsonResponse: "${errorMessage}". Returning empty string.`);
                cleanedResponseText = "";
            }
        } else {
            loggerForCleaning.warn({
                textSnippet: textToClean.substring(0, 200),
                event: 'json_clean_structure_not_found_in_cleaner'
            }, "No valid JSON structure ({...}) found in the response text within cleanJsonResponse. Returning empty string.");
            cleanedResponseText = "";
        }
        return cleanedResponseText;
    }
}