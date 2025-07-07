// src/handlers/backendService.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

// *** IMPORTANT: ASSUMED TO BE MODIFIED TO RECEIVE parsedData and queryString ***
// The actual implementation of transformConferenceData is outside this file,
// but its signature must match DataTransformer.
import { transformConferenceData } from '../utils/transformData';
import { ApiCallResult } from '../shared/types';
import { ConfigService } from '../../config/config.service';

const LOG_PREFIX = "[BackendService]";

// --- Get ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Retrieve configuration from ConfigService ---
// Ensure DATABASE_URL exists in config
const DATABASE_URL: string | undefined = configService.databaseUrl;

// Critical check for DATABASE_URL at module load time
if (!DATABASE_URL) {
    const errorMsg = `${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`;
    logToFile(errorMsg);
    // Throwing an error here will prevent the module from loading
    // and thus prevent the application from starting in an unconfigured state.
    throw new Error(errorMsg);
} else {
    // logToFile(`${LOG_PREFIX} DATABASE_URL configured.`);
}


/**
 * Represents a function that transforms parsed API data into a formatted string.
 * This type ensures that transformation functions accept parsed JSON data and the original query string.
 * They should return a formatted string or `null` if transformation is not possible or not applicable.
 * Implementations should handle their own errors or throw them to be caught by `executeApiCall`.
 *
 * @param {any} parsedData - The parsed JSON object received from the API.
 * @param {string} queryString - The original query string used for the API call (e.g., "q=someTerm").
 * @returns {string | null} Formatted string data, or `null` if transformation yields no meaningful result.
 */
type DataTransformer = (parsedData: any, queryString: string) => string | null;

// --- Transformation Registry (Scalable Approach) ---
// Maps endpoint names to their specific transformer functions.
// This makes adding new transformation logic for different endpoints straightforward.
const dataTransformers: Record<string, DataTransformer | undefined> = {
    // IMPORTANT: The `transformConferenceData` function MUST be implemented in `../utils/transformData`
    // to match the `DataTransformer` signature (i.e., `(parsedData: any, queryString: string) => string | null`).
    'conference': transformConferenceData,
    // Add other endpoints and their transformers here
};

/**
 * Parses a query string into an object.
 * Handles multiple values for the same key (e.g., topics=AI&topics=ML).
 * @param queryString The URL-encoded query string.
 * @returns An object representing the query parameters.
 */
function parseQueryString(queryString: string): Record<string, string | string[]> {
    const params: Record<string, string | string[]> = {};
    if (!queryString) return params;

    queryString.split('&').forEach(pair => {
        const parts = pair.split('=');
        if (parts.length === 2) {
            const key = decodeURIComponent(parts[0]);
            const value = decodeURIComponent(parts[1]);
            if (params.hasOwnProperty(key)) {
                if (Array.isArray(params[key])) {
                    (params[key] as string[]).push(value);
                } else {
                    params[key] = [params[key] as string, value];
                }
            } else {
                params[key] = value;
            }
        }
    });
    return params;
}

/**
 * Converts a parameter object back into a URL-encoded query string.
 * @param params The object representing the query parameters.
 * @returns A URL-encoded query string.
 */
function buildQueryString(params: Record<string, string | string[]>): string {
    const parts: string[] = [];
    for (const key in params) {
        if (params.hasOwnProperty(key)) {
            const value = params[key];
            if (Array.isArray(value)) {
                value.forEach(val => parts.push(`${key}=${val}`));
            } else {
                parts.push(`${key}=${value}`);
            }
        }
    }
    return parts.join('&');
}


/**
 * Executes a GET request to a specified backend API endpoint.
 * It handles network calls, HTTP status checks, JSON parsing, and optional data transformation.
 *
 * @param {string} endpoint - The specific API endpoint (e.g., 'conference').
 * @param {string} queryString - The value for the search query (e.g., "name=foo", "category=bar").
 *                               This string is directly appended to the URL as is.
 * @returns {Promise<ApiCallResult>} A Promise that resolves with an `ApiCallResult` object,
 *                                  indicating success status, raw data, formatted data, and any error messages.
 */
export async function executeApiCall(endpoint: string, queryString: string): Promise<ApiCallResult> {
    // --- START OF MODIFICATION (Date Normalization) ---
    let effectiveQueryString = queryString;
    const logContext = `${LOG_PREFIX} [${endpoint}]`; // Context for logging

    // 1. Parse the initial query string into a mutable object
    const queryParams = parseQueryString(queryString);

    // Define date parameter prefixes
    const datePrefixes = ['sub', 'cameraReady', 'notification', 'registration', '']; // '' for general 'from/toDate'

    let modifiedForDates = false;

    // Iterate through each date prefix to ensure 'FromDate' and 'ToDate' pairs are complete
    datePrefixes.forEach(prefix => {
        const fromKey = `${prefix}FromDate`;
        const toKey = `${prefix}ToDate`;

        const hasFrom = queryParams.hasOwnProperty(fromKey);
        const hasTo = queryParams.hasOwnProperty(toKey);

        if (hasFrom && !hasTo) {
            // If 'FromDate' exists but 'ToDate' doesn't, set 'ToDate' to be the same as 'FromDate'
            queryParams[toKey] = queryParams[fromKey];
            logToFile(`${logContext} Normalized date: Added '${toKey}=${queryParams[fromKey]}' because '${fromKey}' was present without '${toKey}'.`);
            modifiedForDates = true;
        } else if (!hasFrom && hasTo) {
            // If 'ToDate' exists but 'FromDate' doesn't, set 'FromDate' to be the same as 'ToDate'
            queryParams[fromKey] = queryParams[toKey];
            logToFile(`${logContext} Normalized date: Added '${fromKey}=${queryParams[toKey]}' because '${toKey}' was present without '${fromKey}'.`);
            modifiedForDates = true;
        }
        // If both exist or neither exist, do nothing for this pair.
    });

    // Rebuild the query string after date normalization
    if (modifiedForDates) {
        effectiveQueryString = buildQueryString(queryParams);
        logToFile(`${logContext} Query string after date normalization: ${effectiveQueryString}`);
    }

    // --- END OF MODIFICATION (Date Normalization) ---


    // --- START OF MODIFICATION (Detail Mode Logic - moved after date normalization) ---
    // Keywords that trigger the detailed view mode.
    const detailModeKeywords = [
        'subFromDate', 'subToDate',
        'cameraReadyFromDate', 'cameraReadyToDate',
        'notificationFromDate', 'notificationToDate',
        'registrationFromDate', 'registrationToDate'
    ];

    // Check if the query contains any of the keywords.
    const needsDetailMode = detailModeKeywords.some(keyword =>
        effectiveQueryString.includes(keyword) // Use effectiveQueryString here
    );

    // If detail mode is needed and not already present, append it.
    if (needsDetailMode && !effectiveQueryString.includes('mode=detail')) {
        if (effectiveQueryString.length > 0 && !effectiveQueryString.endsWith('&')) {
            effectiveQueryString += '&';
        }
        effectiveQueryString += 'mode=detail';
        logToFile(`${logContext} Keyword detected in query. Automatically adding 'mode=detail'.`);
    }
    // --- END OF MODIFICATION (Detail Mode Logic) ---


    // Use the potentially modified query string from here on.
    const fullUrl = `${DATABASE_URL}/${endpoint}?${effectiveQueryString}`;

    logToFile(`${logContext} Executing API call: GET ${fullUrl}`);

    let response: Response;
    let rawResponseText: string | null = null; // Initialize to null

    try {
        // --- 1. Network Call ---
        response = await fetch(fullUrl, {
            method: 'GET',
            headers: {
                'Accept': 'application/json' // Indicate preference for JSON response
            }
        });

    } catch (networkError: unknown) { // Catch as unknown for safer handling
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(networkError);
        logToFile(`${logContext} Network Error: Failed to fetch from ${fullUrl}. Details: ${errorMessage}\nStack: ${errorStack}`);
        return {
            success: false,
            rawData: null, // No raw data was obtained due to network failure
            formattedData: null,
            errorMessage: `Network Error: Could not connect to the backend service. Details: ${errorMessage}`
        };
    }

    try {
        // --- 2. Read Response Body (always attempt to read as text) ---
        // This needs to be in a try-catch block because `response.text()` can throw.
        rawResponseText = await response.text();

        // --- 3. Handle Non-OK HTTP Status (e.g., 4xx, 5xx) ---
        if (!response.ok) {
            const truncatedError = rawResponseText ? rawResponseText.substring(0, 250) + (rawResponseText.length > 250 ? '...' : '') : 'No response body';
            const errorMessage = `API Error (${response.status} ${response.statusText}): Failed to retrieve information. Details: ${truncatedError}`;
            logToFile(`${logContext} API Error (${response.status}): ${truncatedError}`);
            return {
                success: false,
                rawData: rawResponseText, // Include raw error body if available
                formattedData: null,
                errorMessage: errorMessage
            };
        }

        // --- 4. Handle OK Response (Attempt JSON Parsing & Transformation) ---
        logToFile(`${logContext} API Success (${response.status}). Response body length: ${rawResponseText?.length ?? 0}. Attempting JSON parsing...`);

        // --- 4.1. JSON Parsing Step ---
        let parsedData: any;
        try {
            // rawResponseText is guaranteed to be a string here since response.ok was true
            parsedData = JSON.parse(rawResponseText);
            logToFile(`${logContext} JSON parsing successful. Data preview: \n${JSON.stringify(parsedData, null, 2).substring(0, 250)}...`);

        } catch (parseError: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
            logToFile(`${logContext} JSON Parsing Error: ${errorMessage}. Raw data preview: ${rawResponseText.substring(0, Math.min(rawResponseText.length, 250))}...\nStack: ${errorStack}`);
            return {
                success: false, // Parsing failure means we can't proceed reliably
                rawData: rawResponseText, // Provide the raw (unparseable) data
                formattedData: null,
                errorMessage: `Data Error: Received invalid JSON format from the API. Details: ${errorMessage}`
            };
        }

        // --- 4.2. Transformation Step (Conditional using Registry) ---
        const transformer = dataTransformers[endpoint];
        let formattedData: string | null = null;
        let transformationError: string | undefined = undefined;

        if (transformer) {
            logToFile(`${logContext} Applying transformation function: ${transformer.name || 'anonymous function'}.`);
            try {
                // Call the transformer with the *parsed* data and the *effective* query string
                formattedData = transformer(parsedData, effectiveQueryString);
                if (formattedData !== null) {
                    // logToFile(`${logContext} Transformation successful. Transformed data preview: \n${formattedData}...`);
                } else {
                    logToFile(`${logContext} Transformation function returned null, indicating no meaningful data to format.`);
                }
            } catch (transformErr: unknown) { // Catch as unknown
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(transformErr);
                transformationError = `Transformation Error: ${errorMessage}`;
                logToFile(`${logContext} Error during data transformation: ${errorMessage}\nStack: ${errorStack}`);
                formattedData = null; // Ensure formattedData is null on transformation error
            }
        } else {
            logToFile(`${logContext} No specific transformer configured for endpoint '${endpoint}'. Skipping data transformation.`);
            // If no transformer, the raw data (as JSON string) can be considered the 'formatted' data
            // Or, if the model expects only very specific formatting, keep it null.
            // Current logic expects `formattedData` to be explicitly formatted, so keeping it null if no transformer.
        }

        // --- 5. Return Final Success Result ---
        return {
            success: true,
            rawData: rawResponseText, // Always return the original raw string response
            formattedData: formattedData, // Null if no transformer, transformation failed, or transformer returned null
            errorMessage: transformationError // Only present if transformation failed
        };

    } catch (readProcessError: unknown) {
        // Catch any unexpected errors that occur after the initial `fetch` call
        // but before parsing/transformation is fully complete (e.g., error in response.text()).
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(readProcessError);
        logToFile(`${logContext} Unexpected Error Processing API Response: ${errorMessage}\nStack: ${errorStack}`);
        return {
            success: false,
            rawData: rawResponseText, // rawResponseText might be partially read or null
            formattedData: null,
            errorMessage: `An unexpected error occurred while processing the API response. Details: ${errorMessage}`
        };
    }
}