// src/chatbot/service/getJournals.service.ts
import { executeApiCall } from './backendService';
import { ApiCallResult } from '../shared/types';
import logToFile from '../../utils/logger'; // Import logger for internal service logging
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Executes an API call to retrieve journal information.
 * This service acts as a wrapper around `backendService.executeApiCall`
 * specifically for the 'journal' endpoint.
 *
 * @param {string} searchQuery - The search query string for journals.
 * @returns {Promise<ApiCallResult>} A Promise that resolves with the result of the API call.
 */
export async function executeGetJournals(searchQuery: string): Promise<ApiCallResult> {
    const logPrefix = "[GetJournalsService]";
    logToFile(`${logPrefix} Initiating API call for journals with query: "${searchQuery}"`);
    try {
        // Assuming journal transformation is not yet implemented or needed for link extraction only
        // The `backendService` will handle if a transformer is registered for 'journal' or not.
        const result = await executeApiCall('journal', `${searchQuery}`); // Will likely have formattedData=null if no transformer
        if (result.success) {
            logToFile(`${logPrefix} API call for journals successful.`);
        } else {
            logToFile(`${logPrefix} API call for journals failed: ${result.errorMessage}`);
        }
        return result;
    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logPrefix} CRITICAL Error during executeGetJournals: ${errorMessage}\nStack: ${errorStack}`);
        return {
            success: false,
            rawData: null,
            formattedData: null,
            errorMessage: `An unexpected error occurred while fetching journal data: ${errorMessage}`
        };
    }
}