// src/handlers/backendService.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import logToFile from '../../utils/logger'; // Adjust path if needed
// *** GIẢ SỬ BẠN SẼ SỬA HÀM NÀY ĐỂ NHẬN parsedData ***
import { transformConferenceData } from '../utils/transformData'; // Adjust path if needed
import { ApiCallResult } from '../shared/types'; // Adjust path if needed
import { ConfigService } from '../../config/config.service'; // Adjust path if needed

const LOG_PREFIX = "[BackendService]";

// --- Lấy ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Lấy cấu hình từ ConfigService ---
// Đảm bảo DATABASE_URL tồn tại trong config
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}


/**
 * Represents a function that transforms parsed API data.
 * Accepts parsed JSON data and the original query value.
 * Returns formatted string data or null if transformation fails/not applicable.
 * Can throw an error if transformation encounters critical issues.
 */
// *** SỬA ĐỔI TYPE: queryValue giờ là string (luôn được cung cấp) ***
type DataTransformer = (parsedData: any, queryValue: string) => string | null;

// --- Transformation Registry (Scalable Approach) ---
// Maps endpoint names to their specific transformer functions.
// Makes adding new transformations easier.
const dataTransformers: Record<string, DataTransformer | undefined> = {
    // *** QUAN TRỌNG: Hàm transformConferenceData PHẢI được sửa đổi ***
    // *** để khớp với type DataTransformer (nhận parsedData, queryValue) ***
    'conference': transformConferenceData,
    // 'journal': transformJournalData, // Add when implemented
    // Add other endpoints and their transformers here
};

/**
 * Executes a GET request to the backend API, parses the JSON response,
 * and optionally transforms the data based on the endpoint.
 *
 * @param endpoint The specific API endpoint (e.g., 'conference', 'journal').
 * @param queryValue The value for the search query (e.g., the search term). The key 'q' is assumed.
 * @returns Promise<ApiCallResult> The result including success status, raw data, formatted data, and error messages.
 */
export async function executeApiCall(endpoint: string, queryValue: string): Promise<ApiCallResult> {
    // Use URLSearchParams for safe query string construction
    const params = new URLSearchParams({ q: queryValue }); // Assumes the query parameter key is 'q'
    const fullUrl = `${DATABASE_URL}/${endpoint}?${params.toString()}`;
    const logContext = `${LOG_PREFIX} [${endpoint}]`; // Context for logging

    logToFile(`${logContext} Executing API call: GET ${fullUrl}`);

    let response: Response;
    try {
        // --- Network Call ---
        response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json' // Indicate we prefer JSON
            }
        });

    } catch (networkError: any) {
        const errorMsg = networkError instanceof Error ? networkError.message : String(networkError);
        logToFile(`${logContext} Network Error: Failed to fetch from ${fullUrl}. Details: ${errorMsg}`);
        return {
            success: false,
            // *** SỬA LỖI: Giờ đây hợp lệ nếu ApiCallResult.rawData là string | null ***
            rawData: null, // No raw data obtained
            formattedData: null,
            errorMessage: `Network Error: Could not connect to the backend service. Details: ${errorMsg}`
        };
    }

    // --- Process Response ---
    let rawResponseText: string | null = null;
    try {
        rawResponseText = await response.text(); // Read text body first

        // --- Handle Non-OK HTTP Status ---
        if (!response.ok) {
            const truncatedError = rawResponseText ? rawResponseText.substring(0, 250) : 'No response body';
            const errorMessage = `API Error (${response.status}): Failed to retrieve information. Details: ${truncatedError}`;
            logToFile(`${logContext} API Error (${response.status}): ${truncatedError}`);
            return {
                success: false,
                 // *** SỬA LỖI: rawResponseText có thể là string hoặc null, khớp với string | null ***
                rawData: rawResponseText, // Include raw error body if available
                formattedData: null,
                errorMessage: errorMessage
            };
        }

        // --- Handle OK Response (Attempt Parsing & Transformation) ---
        logToFile(`${logContext} API Success (${response.status}). Data length: ${rawResponseText?.length ?? 0}. Attempting parsing...`);

        // --- JSON Parsing Step ---
        let parsedData: any;
        try {
            // rawResponseText ở đây chắc chắn là string vì response.ok
            parsedData = JSON.parse(rawResponseText);
        } catch (parseError: any) {
            const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
            logToFile(`${logContext} JSON Parsing Error: ${errorMsg}. Raw data: ${rawResponseText.substring(0, 250)}...`);
            return {
                success: false, // Parsing failure means we can't proceed reliably
                 // *** SỬA LỖI: rawResponseText là string, khớp với string | null ***
                rawData: rawResponseText,
                formattedData: null,
                errorMessage: `Data Error: Received invalid JSON format from the API. Details: ${errorMsg}`
            };
        }

        // --- Transformation Step (Conditional using Registry) ---
        const transformer = dataTransformers[endpoint];
        let formattedData: string | null = null;
        let transformationError: string | null = null;

        if (transformer) {
            logToFile(`${logContext} Applying transformation function: ${transformer.name || 'anonymous'}`);
            try {
                // Call the transformer with the *parsed* data and required queryValue
                formattedData = transformer(parsedData, queryValue);
                if (formattedData !== null) {
                    logToFile(`${logContext} Transformation successful.`);
                } else {
                    logToFile(`${logContext} Transformation function returned null (potentially expected).`);
                }
            } catch (transformErr: any) {
                const errorMsg = transformErr instanceof Error ? transformErr.message : String(transformErr);
                transformationError = `Transformation Error: ${errorMsg}`;
                logToFile(`${logContext} Error during data transformation: ${errorMsg}`);
                formattedData = null; // Ensure null on transformation error
            }
        } else {
            logToFile(`${logContext} No specific transformer configured for endpoint '${endpoint}'. Skipping transformation.`);
        }

        // --- Return Success Result ---
        return {
            success: true,
            // *** SỬA LỖI: rawResponseText là string, khớp với string | null ***
            rawData: rawResponseText, // Always return the original raw string
            formattedData: formattedData, // Null if no transformer, transformation failed, or transformer returned null
            errorMessage: transformationError ?? undefined // Return transformation error message if one occurred
        };

    } catch (readError: any) {
        // Catch errors during response.text() or subsequent processing within the block
        const errorMsg = readError instanceof Error ? readError.message : String(readError);
        logToFile(`${logContext} Error Processing Response: ${errorMsg}`);
        return {
            success: false,
             // *** SỬA LỖI: rawResponseText có thể là string hoặc null, khớp với string | null ***
            rawData: rawResponseText, // May or may not have text at this point
            formattedData: null,
            errorMessage: `Error processing API response. Details: ${errorMsg}`
        };
    }
}