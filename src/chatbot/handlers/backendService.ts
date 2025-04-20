// src/handlers/backendService.ts
import logToFile from '../utils/logger';
import 'dotenv/config';
import { transformConferenceData } from '../utils/transformData'; // Ensure this is correctly imported

const DATABASE_URL = process.env.INTERNAL_DATABASE_URL || "http://confhub.engineer/api/v1"; // Use your actual base URL

// --- Define the return type ---
export interface ApiCallResult {
    success: boolean;
    rawData: string; // Raw JSON string or error message string
    formattedData: string | null; // Formatted Markdown or null if transformation failed/not applicable
    errorMessage?: string; // Specific error message if success is false
}


interface FollowItem {
    id: string; // Can be conferenceId or journalId depending on context
    // Add other fields if your API returns them (like title, acronym)
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


// <<< NEW: Function to get followed items >>>

// --- Function to get followed items (REVISED - Token Only) ---
export async function executeGetUserFollowedItems(
    itemType: 'conference' | 'journal',
    token: string | null // <<< ONLY NEED TOKEN
): Promise<{ success: boolean; itemIds: string[]; errorMessage?: string }> {

    if (!token) {
        // This check might be redundant if intentHandler already checks, but good for safety
        return { success: false, itemIds: [], errorMessage: "Authentication token is missing." };
    }

    const endpoint = itemType === 'conference' ? 'follow-conference/followed' : 'follow-journal/followed';
    const url = `${DATABASE_URL}/${endpoint}`;
    logToFile(`Fetching followed ${itemType}s: GET ${url} (using provided token)`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                "Authorization": `Bearer ${token}`, // <<< Use the token
                'Content-Type': 'application/json',
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            logToFile(`Error fetching followed ${itemType}s (${response.status}): ${errorText.substring(0, 200)}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching followed ${itemType}s.` };
        }

        const followedItems: FollowItem[] = await response.json();
        const itemIds = followedItems.map(item => item.id); // Assuming API returns { id: string } objects
        logToFile(`Successfully fetched ${itemIds.length} followed ${itemType}(s).`);
        return { success: true, itemIds: itemIds };

    } catch (error: any) {
        logToFile(`Network/Fetch error fetching followed ${itemType}s: ${error.message}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching followed ${itemType}s.` };
    }
}


// --- Function to call the follow/unfollow API (REVISED - Token Only) ---
export async function executeFollowUnfollowApi(
    itemId: string,
    itemType: 'conference' | 'journal',
    action: 'follow' | 'unfollow',
    token: string | null // <<< REMOVED userId, ONLY NEED TOKEN
): Promise<{ success: boolean; errorMessage?: string }> {

     if (!token) {
        return { success: false, errorMessage: "Authentication token is missing." };
    }
    if (!itemId) {
         return { success: false, errorMessage: "Item ID is missing." };
    }

    const actionPath = action === 'follow' ? '/add' : '/remove';
    const baseEndpoint = itemType === 'conference' ? 'follow-conference' : 'follow-journal';
    const url = `${DATABASE_URL}/${baseEndpoint}${actionPath}`;
    logToFile(`Executing ${action} action for ${itemType} ${itemId}: POST ${url} (using provided token)`);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`, // <<< Use the token
            },
            // <<< REMOVE userId from body >>>
            // Body now only contains the item ID (adjust key based on your API)
            body: JSON.stringify(itemType === 'conference' ? { conferenceId: itemId } : { journalId: itemId }),
        });
        
        if (!response.ok) {
             const errorData = await response.json().catch(() => ({ message: `HTTP ${response.status}` })); // Try to parse error JSON
            logToFile(`Error executing ${action} for ${itemType} ${itemId} (${response.status}): ${errorData.message || response.statusText}`);
            return { success: false, errorMessage: `API Error (${response.status}): ${errorData.message || 'Failed to ' + action + ' ' + itemType}` };
        }

        // API might return the updated list or just a success status
        // We just need to confirm success here.
        logToFile(`Successfully executed ${action} for ${itemType} ${itemId}.`);
        return { success: true };

    } catch (error: any) {
        logToFile(`Network/Fetch error executing ${action} for ${itemType} ${itemId}: ${error.message}`);
        return { success: false, errorMessage: `Network error trying to ${action} ${itemType}.` };
    }
}


// <<< Helper function to get Item ID from Identifier (Internal use in executeFunctionCall) >>>
// This simplifies finding the ID within executeFunctionCall
export async function findItemId(
    identifier: string,
    identifierType: string | undefined, // 'acronym', 'title', or 'id'
    itemType: 'conference' | 'journal'
): Promise<{ success: boolean; itemId?: string; errorMessage?: string }> {
    logToFile(`Finding ID for ${itemType} with identifier: "${identifier}" (type: ${identifierType || 'unknown'})`);

    if (identifierType === 'id') {
        return { success: true, itemId: identifier }; // Identifier is already the ID
    }

    // Determine search query based on identifier type
    let searchQuery = '';
    if (identifierType === 'acronym') {
        searchQuery = `acronym=${encodeURIComponent(identifier)}&perPage=1&page=1`;
    } else { // Default to searching by title if type is 'title' or unknown/missing
        searchQuery = `title=${encodeURIComponent(identifier)}&perPage=1&page=1`;
    }

    const apiResult: ApiCallResult = itemType === 'conference'
        ? await executeGetConferences(searchQuery)
        : await executeGetJournals(searchQuery);

    if (!apiResult.success || !apiResult.rawData) {
        return { success: false, errorMessage: apiResult.errorMessage || `Could not find ${itemType} using identifier "${identifier}".` };
    }

    try {
        const parsedRawData = JSON.parse(apiResult.rawData);
         // Adjust based on your actual API response structure (e.g., { data: { payload: [...] } })
         let itemData: any = null;
         if (parsedRawData && Array.isArray(parsedRawData.payload) && parsedRawData.payload.length > 0) {
            itemData = parsedRawData.payload[0];
         } else if (Array.isArray(parsedRawData) && parsedRawData.length > 0) { // Fallback if structure is simpler array
             itemData = parsedRawData[0];
         } else if (typeof parsedRawData === 'object' && parsedRawData !== null && !Array.isArray(parsedRawData)) { // Fallback for single object
             itemData = parsedRawData;
         }


        if (itemData && itemData.id) {
            logToFile(`Found ${itemType} ID: ${itemData.id} for identifier "${identifier}"`);
            return { success: true, itemId: itemData.id };
        } else {
            logToFile(`Could not extract ID from data for identifier "${identifier}". Data structure might be unexpected.`);
            return { success: false, errorMessage: `Found ${itemType} data for "${identifier}" but could not extract its ID.` };
        }
    } catch (parseError: any) {
        logToFile(`Error parsing data while finding ID for "${identifier}": ${parseError.message}`);
        return { success: false, errorMessage: `Error processing data for ${itemType} "${identifier}".` };
    }
}