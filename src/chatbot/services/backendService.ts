// src/handlers/backendService.ts
import logToFile from '../../utils/logger';
import 'dotenv/config';
import { transformConferenceData } from '../utils/transformData'; // Ensure this is correctly imported
import { DATABASE_URL } from '../../config';
import { ApiCallResult } from '../shared/types';


// --- API Call Execution (Revised) ---
export async function executeApiCall(endpoint: string, searchQuery: string): Promise<ApiCallResult> {
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



