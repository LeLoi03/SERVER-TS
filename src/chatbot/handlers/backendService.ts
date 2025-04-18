//src/handlers/backendService.ts
import logToFile from '../utils/logger';
import 'dotenv/config';

const DATABASE_URL = "http://confhub.engineer/api/v1"; // Your backend base URL

async function executeApiCall(endpoint: string, searchQuery: string): Promise<string> {
    const fullUrl = `${DATABASE_URL}/${endpoint}?${searchQuery}`;
    logToFile(`Executing backend API call: GET ${fullUrl}`);
    try {
        const response = await fetch(fullUrl, { method: 'GET' });

        if (!response.ok) {
            const errorText = await response.text();
            logToFile(`Backend API Error (${response.status}) for ${endpoint}: ${errorText}`);
            // Return error message string for the model to potentially explain
            return `API Error: Status ${response.status}. Failed to retrieve information for ${endpoint}. Details: ${errorText.substring(0, 150)}`;
        }

        const data = await response.text(); // Assuming backend returns text/stringified JSON
        logToFile(`Backend API Success for ${endpoint}. Data length: ${data.length}`);
        // logToFile(`Backend API Data: ${data.substring(0, 300)}...`); // Log cautiously
        return data;
    } catch (error: any) {
        logToFile(`Network or fetch error calling backend for ${endpoint}: ${error.message}`);
        // Return error message string
        return `Network Error: Could not connect to the backend service to retrieve information for ${endpoint}.`;
    }
}

export async function executeGetConferences(searchQuery: string): Promise<string> {
    return executeApiCall('conference', searchQuery);
}

export async function executeGetJournals(searchQuery: string): Promise<string> {
    // Replace 'journal' with your actual journal endpoint if different
    return executeApiCall('journal', searchQuery); // Assuming endpoint is /journal
}

export async function executeGetWebsiteInformation(): Promise<string> {

    try {
        return `${process.env.CONFERENCE_WEBSITE_DESCRIPTION}`;
    } catch (error: any) {
        logToFile(`Network or fetch error calling backend for website-info: ${error.message}`);
        return `Network Error: Could not connect to the backend service to retrieve website information.`;
    }
}
