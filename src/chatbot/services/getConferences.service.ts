// src/chatbot/service/getConferences.service.ts
import { executeApiCall } from './backendService';
import { ApiCallResult } from '../shared/types';
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
    
    try {
        // The actual API call and processing logic is handled by backendService
        const result = await executeApiCall('conference', `${searchQuery}`);
        if (result.success) {
            
        } else {
            
        }
        return result;
    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        
        return {
            success: false,
            rawData: null, // No raw data due to critical error
            formattedData: null,
            errorMessage: `An unexpected error occurred while fetching conference data: ${errorMessage}`
        };
    }
}