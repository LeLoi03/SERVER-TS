// src/services/manageFollow.service.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe';
import { ApiCallResult, FollowItem } from '../shared/types'; // Ensure FollowItem is imported
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility
import { executeGetConferences } from './getConferences.service';
import { ConfigService } from '../../config/config.service';

const LOG_PREFIX = "[FollowService]";

// --- Get ConfigService Instance ---
const configService = container.resolve(ConfigService);
const DATABASE_URL: string | undefined = configService.databaseUrl;

// Critical check for DATABASE_URL at module load time
if (!DATABASE_URL) {
    const errorMsg = `${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`;
    
    // Throwing an error here prevents the module from loading
    throw new Error(errorMsg);
} else {
    // 
}

// Defines the types of items that can be followed/unfollowed.
type ServiceItemType = 'conference';
// Defines the API actions for following/unfollowing.
type ServiceApiActionType = 'follow' | 'unfollow';
// Defines the types of identifiers used to find an item.
type ServiceIdentifierType = 'id' | 'acronym' | 'title';

const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

/**
 * Constructs the appropriate API URL for follow/unfollow operations based on item type and operation.
 *
 * @param {ServiceItemType} itemType - The type of item (e.g., 'conference').
 * @param {'followedList' | 'add' | 'remove'} operation - The specific follow/unfollow operation.
 * @returns {string} The full URL for the API endpoint.
 * @throws {Error} If an invalid operation type is provided.
 */
function getApiUrl(
    itemType: ServiceItemType,
    operation: 'followedList' | 'add' | 'remove'
): string {
    const base = 'follow-conference';
    switch (operation) {
        case 'followedList':
            // Assumes an endpoint like /follow-conference/followed
            return `${DATABASE_URL}/${base}/followed`;
        case 'add':
            return `${DATABASE_URL}/${base}/add`;
        case 'remove':
            return `${DATABASE_URL}/${base}/remove`;
        default:
            // This case should ideally not be reached if types are used correctly, but provides a fallback.
            
            throw new Error(`Invalid follow/unfollow operation: ${operation}`);
    }
}

/**
 * Fetches the list of items (conferences) currently followed by the user.
 * Requires an authentication token.
 *
 * @param {ServiceItemType} itemType - The type of item to fetch the followed list for ('conference').
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; itemIds: string[]; items?: FollowItem[]; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success, a list of followed item IDs,
 *          optional full `FollowItem` details, and an error message if the call fails.
 */
export async function executeGetUserFollowed(
    itemType: ServiceItemType,
    token: string | null
): Promise<{ success: boolean; itemIds: string[]; items?: FollowItem[]; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [GetFollowed ${itemType}]`;

    if (!token) {
        
        return { success: false, itemIds: [], errorMessage: "Authentication token is required." };
    }

    const url = getApiUrl(itemType, 'followedList');
    

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...HEADERS, "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => `Status ${response.status}`);
            
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching followed ${itemType} list.` };
        }

        // API is expected to return an array of objects matching FollowItem
        const followedItems: FollowItem[] = await response.json();
        const itemIds = followedItems.map(item => item.id);

        
        return { success: true, itemIds, items: followedItems };

    } catch (error: unknown) { // Catch as unknown for safer error handling
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        
        return { success: false, itemIds: [], errorMessage: `Network error fetching followed ${itemType} list. Details: ${errorMessage}` };
    }
}

/**
 * Executes an API call to follow or unfollow a specific item (conference).
 *
 * @param {string} itemId - The unique ID of the item to follow or unfollow.
 * @param {ServiceItemType} itemType - The type of item ('conference').
 * @param {ServiceApiActionType} action - The action to perform: 'follow' or 'unfollow'.
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success or failure, with an optional error message.
 */
export async function executeFollowUnfollowApi(
    itemId: string,
    itemType: ServiceItemType,
    action: ServiceApiActionType,
    token: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [${action} ${itemType} ID: ${itemId}]`;

    if (!token) {
        
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
        
        return { success: false, errorMessage: "Item ID is required." };
    }

    const operation = action === 'follow' ? 'add' : 'remove';
    const url = getApiUrl(itemType, operation);
    // Payload depends on itemType
    const bodyPayload = { conferenceId: itemId }

    

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...HEADERS,
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify(bodyPayload),
        });

        if (!response.ok) {
            let errorDetails = `Status ${response.status}`;
            try {
                const errorData = await response.json();
                errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData).substring(0, Math.min(JSON.stringify(errorData).length, 100));
            } catch {
                try {
                    // Fallback to reading as text if JSON parsing fails
                    const textError = await response.text();
                    errorDetails = textError.substring(0, Math.min(textError.length, 100)) || `Status ${response.status} ${response.statusText}`;
                } catch { /* Ignore text read error as well, use generic status */ }
            }
            
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} ${itemType}. ${errorDetails}` };
        }

        
        return { success: true };

    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        
        return { success: false, errorMessage: `Network error attempting to ${action} ${itemType}. Details: ${errorMessage}` };
    }
}


/**
 * Finds the ID of a conference using a given identifier (e.g., acronym, title, or ID).
 * This function utilizes `executeGetConferences` to perform the search.
 *
 * @param {string} identifier - The value used for searching (e.g., "ICCV", "Nature", "12345").
 * @param {ServiceIdentifierType} identifierType - The type of the identifier provided ('id', 'acronym', or 'title').
 * @param {ServiceItemType} itemType - The type of item to search for ('conference').
 * @returns {Promise<{ success: boolean; itemId?: string; details?: Partial<FollowItem>; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success, the found item's ID,
 *          partial `FollowItem` details, and an error message if not found or an error occurs.
 */
export async function findItemId(
    identifier: string,
    identifierType: ServiceIdentifierType,
    itemType: ServiceItemType
): Promise<{ success: boolean; itemId?: string; details?: Partial<FollowItem>; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [FindID ${itemType} Ident:"${identifier}" Type:${identifierType}]`;
    

    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
        
        return { success: false, errorMessage: "Identifier is required to find the item ID." };
    }

    // If identifierType is 'id', assume the provided identifier is already the ID.
    if (identifierType === 'id') {
        
        // If you have a specific 'getById' API, you could call it here to fetch full details.
        // For now, we return only the ID and a partial FollowItem with just the ID.
        return { success: true, itemId: identifier, details: { id: identifier } };
    }

    // For 'acronym' or 'title', construct a search query based on item type.
    const searchParams = new URLSearchParams();
    if (identifierType === 'acronym') {
        searchParams.append('acronym', identifier);
    } else if (identifierType === 'title') {
        searchParams.append('title', identifier);
    }
    searchParams.append('perPage', '1'); // Limit to one result as we only need one ID
    searchParams.append('page', '1');
    const searchQuery = searchParams.toString();
    

    // Call the appropriate service (getConferences) based on itemType
    const apiResult: ApiCallResult = await executeGetConferences(searchQuery)

    if (!apiResult.success || !apiResult.rawData) {
        const errorDetail = apiResult.errorMessage ? `: ${apiResult.errorMessage}` : '.';
        
        return { success: false, errorMessage: `Could not find ${itemType} using identifier "${identifier}"${errorDetail}` };
    }

    try {
        const parsedData = JSON.parse(apiResult.rawData);
        let itemData: any = null; // This will hold the extracted item details, compatible with Partial<FollowItem>

        // Logic to extract the first relevant item from the parsed response,
        // accounting for different possible API response structures (e.g., direct array, nested payload).
        if (parsedData && Array.isArray(parsedData.payload) && parsedData.payload.length > 0) {
            itemData = parsedData.payload[0];
        } else if (Array.isArray(parsedData) && parsedData.length > 0) {
            itemData = parsedData[0];
        } else if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData) && parsedData.id) {
            // Case for a direct single object response that contains an 'id' property
            itemData = parsedData;
        }

        if (itemData && itemData.id && typeof itemData.id === 'string') {
            
            // Return relevant details from itemData, conforming to Partial<FollowItem>
            const detailsToReturn: Partial<FollowItem> = {
                id: itemData.id,
                title: itemData.title,
                acronym: itemData.acronym,
                // Add other relevant fields from the API response if they are needed and available
                // e.g., location, dates, publisher, etc., depending on what FollowItem expects.
            };
            return { success: true, itemId: itemData.id, details: detailsToReturn };
        } else {
            
            return { success: false, errorMessage: `Found ${itemType} data for "${identifier}", but could not extract its ID or details.` };
        }
    } catch (parseError: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
        
        return { success: false, errorMessage: `Error processing search results for ${itemType} "${identifier}". Details: ${errorMessage}` };
    }
}