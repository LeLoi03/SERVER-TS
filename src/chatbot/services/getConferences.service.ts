// src/chatbot/service/getConferences.service.ts
import { executeApiCall } from './backendService';
import { ApiCallResult } from '../shared/types';
import logToFile from '../../utils/logger'; // Import logger for internal service logging
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Executes an API call to retrieve conference information.
 * This service acts as a wrapper around `backendService.executeApiCall`
 * specifically for the 'conference' endpoint.
 *
 * @param {string} searchQuery - The search query string for conferences.
 * @returns {Promise<ApiCallResult>} A Promise that resolves with the result of the API call.
 */
export async function executeGetConferences(searchQuery: string): Promise<ApiCallResult> {
    const logPrefix = "[GetConferencesService]";
    logToFile(`${logPrefix} Initiating API call for conferences with query: "${searchQuery}"`);
    try {
        // The actual API call and processing logic is handled by backendService
        const result = await executeApiCall('conference', `${searchQuery}`);
        if (result.success) {
            logToFile(`${logPrefix} API call for conferences successful.`);
        } else {
            logToFile(`${logPrefix} API call for conferences failed: ${result.errorMessage}`);
        }
        return result;
    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logPrefix} CRITICAL Error during executeGetConferences: ${errorMessage}\nStack: ${errorStack}`);
        return {
            success: false,
            rawData: null, // No raw data due to critical error
            formattedData: null,
            errorMessage: `An unexpected error occurred while fetching conference data: ${errorMessage}`
        };
    }
}