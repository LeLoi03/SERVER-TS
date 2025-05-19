// src/services/gemini/geminiResponseHandler.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import path from 'path';
import { promises as fsPromises, existsSync } from 'fs';
import { type GenerateContentResult, type UsageMetadata } from "@google/generative-ai";
import { ConfigService } from '../../config/config.service'; // Adjust path
import { Logger } from 'pino';

export interface ProcessedGeminiResponse {
    responseText: string;
    metaData: UsageMetadata | null | undefined;
}

@singleton()
export class GeminiResponseHandlerService {
    private readonly responseOutputDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
    ) {
        this.responseOutputDir = path.join(this.configService.baseOutputDir, 'gemini_responses');
    }

    // Replicates response processing from original callGeminiAPI (within executeWithRetry's lambda)
    public processResponse(
        sdkResult: GenerateContentResult,
        logger: Logger // Logger from the specific attempt in executeWithRetry
    ): ProcessedGeminiResponse {
        // The logger passed here (attemptApiCallLogger from refactored GeminiApiService)
        // already contains context like apiType, batchIndex, modelName, attempt, event_group='gemini_api_attempt'.

        const response = sdkResult?.response;
        const feedback = response?.promptFeedback;

        if (!response) {
            logger.warn({ feedback, event: 'gemini_api_response_missing' }, "Gemini API returned result with missing response object.");
            if (feedback?.blockReason) {
                logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings");
                throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
            }
            throw new Error("Empty or invalid response object from Gemini API.");
        }
        if (feedback?.blockReason) { // Check again, as original
            logger.error({ blockReason: feedback.blockReason, safetyRatings: feedback.safetyRatings, event: 'gemini_api_response_blocked' }, "Request blocked by safety settings (found in feedback)");
            throw new Error(`Request blocked by safety settings: ${feedback.blockReason}`);
        }

        let responseText = "";
        try {
            responseText = response.text();
            logger.debug({ event: 'gemini_api_text_extract_success' }, "Extracted text using response.text()");
        } catch (textError: unknown) {
            const errorDetails = textError instanceof Error ? { name: textError.name, message: textError.message } : { details: String(textError) };
            logger.warn({ err: errorDetails, event: 'gemini_api_text_extract_failed' }, "Response.text() accessor failed, trying fallback.");
            responseText = response.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
            if (!responseText) {
                logger.error({ responseStructure: JSON.stringify(response)?.substring(0, 500), event: 'gemini_api_text_extract_fallback_failed' }, "Could not extract text content from response via fallback.");
                // Original did not throw, returned empty string
            } else {
                logger.debug({ event: 'gemini_api_text_extract_fallback_success' }, "Extracted text using fallback");
            }
        }
        const metaData = response.usageMetadata ?? null;
        return { responseText, metaData };
    }

    // Replicates async file writing logic
    public async writeResponseToFile(
        responseText: string,
        apiType: string,
        acronym: string | undefined,
        batchIndex: number,
        parentLogger: Logger // Logger from the specific attempt (attemptApiCallLogger)
    ): Promise<void> {
        const safeAcronym = (acronym || 'noacronym').replace(/[^a-zA-Z0-9_.-]/g, '-');
        const responseOutputPath = path.join(this.responseOutputDir, `result_${apiType}_${safeAcronym}_${batchIndex}.txt`);
        
        // Create a child logger specifically for this async sub-operation, inheriting parent context.
        // The parentLogger (attemptApiCallLogger) has rich context (apiType, modelName, batchIndex, attempt, etc.)
        const fileWriteLogger = parentLogger.child({ sub_operation: 'response_file_write_async' });
        // fileLogContext for log payload consistency with original
        const fileLogContext = { ...parentLogger.bindings(), filePath: responseOutputPath, event_group: 'response_file_write' };


        try {
            if (!existsSync(this.responseOutputDir)) {
                await fsPromises.mkdir(this.responseOutputDir, { recursive: true });
                // Log using the fileWriteLogger to maintain async context
                // Original event: 'response_dir_created' with 'directory'
                fileWriteLogger.info({ directory: this.responseOutputDir, event: 'response_dir_created' }, "Created response output directory");
            }
            // Original event: 'response_file_write_start'
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_start' }, "Writing response to file");
            await fsPromises.writeFile(responseOutputPath, responseText || "", "utf8");
            // Original event: 'response_file_write_success'
            fileWriteLogger.debug({ ...fileLogContext, event: 'response_file_write_success' }, "Successfully wrote response to file");
        } catch (fileWriteError: unknown) {
            const errorDetails = fileWriteError instanceof Error ? { name: fileWriteError.name, message: fileWriteError.message } : { details: String(fileWriteError) };
            // Original event: 'response_file_write_failed'
            fileWriteLogger.error({ ...fileLogContext, err: errorDetails, event: 'response_file_write_failed' }, "Error writing response to file");
        }
    }

    // Replicates JSON cleaning logic from public methods
    public cleanJsonResponse(
        responseText: string,
        loggerForCleaning: Logger // Logger passed from public method, with its specific context
    ): string {
        console.log("\n\nresponse text gốc", responseText.slice(0,200));
        // loggerForCleaning already has context like apiType, modelUsed, batchIndex, title, acronym, function (public method name)
        const firstCurly = responseText.indexOf('{');
        const lastCurly = responseText.lastIndexOf('}');
        let cleanedResponseText = "";

        // The specific event names ('json_clean_success', 'json_clean_parse_failed', 'json_clean_structure_not_found')
        // were BỔ SUNG events in the public methods in the prompt.
        // Here, we perform the cleaning and let the public method log the specific event.
        // This method provides the cleaned text.
        // Alternatively, this method could take the `rawResponseSnippet` and log these events itself.
        // For now, returning cleaned text and letting caller log.

        if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
            const potentialJson = responseText.substring(firstCurly, lastCurly + 1);
            try {
                JSON.parse(potentialJson); // Validate
                cleanedResponseText = potentialJson.trim();
                // Example of internal logging if desired:
                // loggerForCleaning.debug({ event: 'json_handler_cleaned_valid' }, "JSON structure cleaned and validated.");
            } catch (parseError: unknown) {
                // Example of internal logging:
                // const errorDetails = parseError instanceof Error ? { name: parseError.name, message: parseError.message } : { details: String(parseError) };
                // loggerForCleaning.warn({ rawResponseSnippet: responseText.substring(0,200), err: errorDetails, event: 'json_handler_parse_error'}, "Cleaned text failed JSON.parse validation.");
                cleanedResponseText = ""; // As original
            }
        } else {
            // Example of internal logging:
            // loggerForCleaning.warn({ rawResponseSnippet: responseText.substring(0,200), event: 'json_handler_no_structure'}, "No valid JSON structure found for cleaning.");
            cleanedResponseText = ""; // As original
        }
        return cleanedResponseText;
    }
}