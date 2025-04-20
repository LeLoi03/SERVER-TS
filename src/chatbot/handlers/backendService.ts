// src/handlers/backendService.ts
import logToFile from '../utils/logger';
import 'dotenv/config';
import { transformConferenceData } from '../utils/transformData'; // Ensure this is correctly imported

const DATABASE_URL = process.env.INTERNAL_API_BASE_URL || "http://confhub.engineer/api/v1"; // Use your actual base URL

// --- Define the return type ---
export interface ApiCallResult {
    success: boolean;
    rawData: string; // Raw JSON string or error message string
    formattedData: string | null; // Formatted Markdown or null if transformation failed/not applicable
    errorMessage?: string; // Specific error message if success is false
}

// --- API Call Execution (Revised) ---
async function executeApiCall(endpoint: string, searchQuery: string): Promise<ApiCallResult> {
    const fullUrl = `${DATABASE_URL}/${endpoint}?${searchQuery}`;
    logToFile(`Executing backend API call: GET ${fullUrl}`);
    try {
        const response = await fetch(fullUrl, { method: 'GET' });

        const rawResponseText = await response.text(); // Get text regardless of status

        if (!response.ok) {
            const truncatedError = rawResponseText.substring(0, 200);
            const errorMessage = `API Error: Status ${response.status}. Failed to retrieve information for ${endpoint}. Details: ${truncatedError}`;
            logToFile(`Backend API Error (${response.status}) for ${endpoint}: ${truncatedError}`);
            return { success: false, rawData: rawResponseText, formattedData: null, errorMessage: errorMessage };
        }

        logToFile(`Backend API Success for ${endpoint}. Data length: ${rawResponseText.length}`);
        const rawDataString = rawResponseText; // Keep the raw JSON string

        let formattedData: string | null = null;
        let transformationError: string | null = null;

        // --- Transformation Step (Conditional) ---
        if (endpoint === 'conference') {
             try {
                 // Attempt to parse AND transform
                //  const parsedData = JSON.parse(rawDataString); // Parse first
                 formattedData = transformConferenceData(rawDataString, searchQuery); // Transform the parsed object
                 logToFile(`Conference data transformed successfully.`);
                // logToFile(`Transformed Data: ${formattedData}`); // Log transformed data cautiously
             } catch (error: any) {
                 transformationError = `Transformation/Parsing Error: ${error.message}`;
                 logToFile(`Error during data parsing/transformation: ${error.message}. Raw data: ${rawDataString.substring(0, 200)}...`);
                 formattedData = null; // Ensure formattedData is null on error
             }
        } else if (endpoint === 'journal') {
            // TODO: Implement journal transformation if needed
            // For now, we might just return the raw data as 'formatted' or leave it null
            formattedData = null; // Or implement transformation
            logToFile(`Journal transformation not implemented, returning raw data only conceptually.`);
        }
        // Add other endpoints if necessary

        // --- End Transformation Step ---

        // Return success with both raw and potentially formatted data
        return {
            success: true,
            rawData: rawDataString,
            formattedData: formattedData, // This will be null if transformation failed or not applicable
            errorMessage: transformationError ?? undefined // Include transformation error if it occurred
        };

    } catch (error: any) {
        const errorMessage = `Network Error: Could not connect to the backend service for ${endpoint}. Details: ${error.message}`;
        logToFile(`Network or fetch error calling backend for ${endpoint}: ${error.message}`);
        return { success: false, rawData: "", formattedData: null, errorMessage: errorMessage };
    }
}

// --- Service Functions (Using the new return type) ---

export async function executeGetConferences(searchQuery: string): Promise<ApiCallResult> {
    return executeApiCall('conference', searchQuery);
}

export async function executeGetJournals(searchQuery: string): Promise<ApiCallResult> {
    // Assuming journal transformation is not yet implemented or needed for link extraction only
    return executeApiCall('journal', searchQuery); // Will likely have formattedData=null
}


export async function executeGetWebsiteInformation(): Promise<string> {
    // This function doesn't call the API in the same way, keep it simple
    try {
        const description = process.env.CONFERENCE_WEBSITE_DESCRIPTION;
        if (!description) {
             logToFile("Warning: CONFERENCE_WEBSITE_DESCRIPTION environment variable is not set.");
             return "Website information is currently unavailable.";
        }
        return description;
    } catch (error: any) {
        logToFile(`Error retrieving website information: ${error.message}`);
        return `Error: Could not retrieve website information.`;
    }
}