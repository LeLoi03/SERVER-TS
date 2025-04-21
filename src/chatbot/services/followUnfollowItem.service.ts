// src/handlers/backendService.ts
import { ApiCallResult } from '../shared/types';
import logToFile from '../utils/logger';
import { DATABASE_URL } from '../../config';
import { executeGetConferences } from './getConferences.service';
import { executeGetJournals } from './getJournals.service';
import { FollowItem } from '../shared/types';

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
    token: string | null
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
                'Authorization': `Bearer ${token}`,
            },
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
    } else {
        searchQuery = `acronym=${encodeURIComponent(identifier)}&perPage=1&page=1`;
    }

    const apiResult: ApiCallResult = itemType === 'conference'
        ? await executeGetConferences(searchQuery)
        : await executeGetJournals(searchQuery);

    if (!apiResult.success || !apiResult.rawData) {
        return { success: false, errorMessage: apiResult.errorMessage || `Could not find ${itemType} using identifier "${identifier}".` };
    }

    try {
        const parsedRawData = JSON.parse(apiResult.rawData);
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