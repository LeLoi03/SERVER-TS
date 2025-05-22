// src/services/manageBlacklist.service.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe';
import { ApiCallResult, BlacklistItem } from '../shared/types'; // Using BlacklistItem type
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility
import { executeGetConferences } from './getConferences.service'; // Only need getConferences specific to this service
import { ConfigService } from '../../config/config.service';

const LOG_PREFIX = "[BlacklistService]";

// --- Get ConfigService Instance ---
const configService = container.resolve(ConfigService);
const DATABASE_URL: string | undefined = configService.config.DATABASE_URL;

// Critical check for DATABASE_URL at module load time
if (!DATABASE_URL) {
    const errorMsg = `${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`;
    logToFile(errorMsg);
    // Throwing an error here prevents the module from loading
    throw new Error(errorMsg);
} else {
    logToFile(`${LOG_PREFIX} DATABASE_URL configured.`);
}

// Blacklist operations are currently restricted to 'conference' items.
type ServiceItemTypeRestricted = 'conference';
// Defines the API actions for blacklisting: 'add' an item to blacklist, 'remove' it from blacklist.
type ServiceApiActionType = 'add' | 'remove';
// Defines the types of identifiers used to find an item (e.g., by its ID, acronym, or title).
type ServiceIdentifierType = 'id' | 'acronym' | 'title';

const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

/**
 * Constructs the appropriate API URL for blacklist operations.
 *
 * @param {'blacklistedList' | 'add' | 'remove'} operation - The specific blacklist operation.
 * @returns {string} The full URL for the API endpoint.
 * @throws {Error} If an invalid operation type is provided.
 */
function getApiUrl(
    operation: 'blacklistedList' | 'add' | 'remove'
): string {
    const base = 'blacklist-conference'; // Base API endpoint for conference blacklist
    switch (operation) {
        case 'blacklistedList':
            // Assumes an endpoint like /blacklist-conference to get the list
            return `${DATABASE_URL}/${base}`;
        case 'add':
            return `${DATABASE_URL}/${base}/add`;
        case 'remove':
            return `${DATABASE_URL}/${base}/remove`;
        default:
            // This case should ideally not be reached if types are used correctly, but provides a fallback.
            logToFile(`${LOG_PREFIX} Error: Invalid operation type for URL construction: ${operation}`);
            throw new Error(`Invalid blacklist operation: ${operation}`);
    }
}

/**
 * Fetches the list of conferences currently blacklisted by the user.
 * Requires an authentication token.
 *
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; itemIds: string[]; items?: BlacklistItem[]; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success, a list of blacklisted conference IDs,
 *          optional full `BlacklistItem` details, and an error message if the call fails.
 */
export async function executeGetUserBlacklisted(
    token: string | null
): Promise<{ success: boolean; itemIds: string[]; items?: BlacklistItem[]; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [GetBlacklisted Conferences]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, itemIds: [], errorMessage: "Authentication token is required." };
    }

    const url = getApiUrl('blacklistedList');
    logToFile(`${logContext} Fetching blacklisted conferences: GET ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...HEADERS, "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => `Status ${response.status}`);
            logToFile(`${logContext} API Error (${response.status}): ${errorText.substring(0, Math.min(errorText.length, 200))}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching blacklisted conferences list.` };
        }

        const blacklistedItems: BlacklistItem[] = await response.json();
        // Extract conference IDs from the full BlacklistItem objects
        const itemIds = blacklistedItems.map(item => item.conferenceId);

        logToFile(`${logContext} Success. Found ${itemIds.length} blacklisted conference(s).`);
        return { success: true, itemIds, items: blacklistedItems };

    } catch (error: unknown) { // Catch as unknown for safer error handling
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMessage}\nStack: ${errorStack}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching blacklisted conferences list. Details: ${errorMessage}` };
    }
}

/**
 * Executes an API call to add or remove a specific conference from the user's blacklist.
 * Requires a conference ID, an action ('add' or 'remove'), and an authentication token.
 *
 * @param {string} conferenceId - The unique ID of the conference to blacklist or unblacklist.
 * @param {ServiceApiActionType} action - The action to perform: 'add' to blacklist, 'remove' to unblacklist.
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success or failure, with an optional error message.
 */
export async function executeBlacklistUnblacklistApi(
    conferenceId: string,
    action: ServiceApiActionType, // 'add' or 'remove'
    token: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [${action} blacklist Conference ID: ${conferenceId}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!conferenceId || typeof conferenceId !== 'string' || conferenceId.trim() === '') {
        logToFile(`${logContext} Error: Conference ID is missing or invalid.`);
        return { success: false, errorMessage: "Conference ID is required." };
    }

    const operation = action; // This matches the type for getApiUrl
    const url = getApiUrl(operation);
    const bodyPayload = { conferenceId: conferenceId };

    logToFile(`${logContext} Executing action: POST ${url} with payload: ${JSON.stringify(bodyPayload)}`);

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
                // Attempt to parse JSON error details, fallback to text, then status
                const errorData = await response.json();
                errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData).substring(0, Math.min(JSON.stringify(errorData).length, 100));
            } catch {
                // If JSON parsing fails, just use the status
                errorDetails = `Status ${response.status}`;
            }
            logToFile(`${logContext} API Error (${response.status}): ${errorDetails}`);
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} conference for blacklist. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        return { success: true };

    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMessage}\nStack: ${errorStack}`);
        return { success: false, errorMessage: `Network error attempting to ${action} conference for blacklist. Details: ${errorMessage}` };
    }
}

/**
 * Attempts to find a conference's unique ID based on a given identifier (e.g., acronym, title).
 * This function specifically queries the `getConferences.service` to search for the conference.
 *
 * @param {string} identifier - The value to search for (e.g., "ICCV", "International Conference on Computer Vision").
 * @param {ServiceIdentifierType} identifierType - The type of identifier provided ('id', 'acronym', or 'title').
 * @returns {Promise<{ success: boolean; itemId?: string; details?: Partial<BlacklistItem>; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success, the found item's ID,
 *          partial `BlacklistItem` details, and an error message if not found or an error occurs.
 */
export async function findConferenceItemId(
    identifier: string,
    identifierType: ServiceIdentifierType
): Promise<{ success: boolean; itemId?: string; details?: Partial<BlacklistItem>; errorMessage?: string }> {
    const itemType: ServiceItemTypeRestricted = 'conference'; // Fixed to 'conference' for this service
    const logContext = `${LOG_PREFIX} [FindID ${itemType} Ident:"${identifier}" Type:${identifierType}]`;
    logToFile(`${logContext} Attempting to find ${itemType} ID.`);

    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
        logToFile(`${logContext} Error: Identifier is missing.`);
        return { success: false, errorMessage: "Identifier is required to find the item ID." };
    }

    // If identifierType is 'id', we assume the provided identifier is already the ID.
    if (identifierType === 'id') {
        logToFile(`${logContext} Identifier type is ID. Returning ID directly: ${identifier}`);
        // Return minimal details as we don't have full info from just an ID here without another lookup
        return { success: true, itemId: identifier, details: { conferenceId: identifier } };
    }

    // For 'acronym' or 'title', construct a search query.
    const searchParams = new URLSearchParams();
    if (identifierType === 'acronym') {
        searchParams.append('acronym', identifier);
    } else if (identifierType === 'title') {
        searchParams.append('title', identifier);
    }
    searchParams.append('perPage', '1'); // Limit to one result as we only need one ID
    searchParams.append('page', '1');
    const searchQuery = searchParams.toString();
    logToFile(`${logContext} Constructed search query for conference: ${searchQuery}`);

    // Call `executeGetConferences` to search for the conference.
    const apiResult: ApiCallResult = await executeGetConferences(searchQuery);

    if (!apiResult.success || !apiResult.rawData) {
        const errorDetail = apiResult.errorMessage ? `: ${apiResult.errorMessage}` : '.';
        logToFile(`${logContext} Search failed or returned no raw data${errorDetail}`);
        return { success: false, errorMessage: `Could not find ${itemType} using identifier "${identifier}"${errorDetail}` };
    }

    try {
        const parsedData = JSON.parse(apiResult.rawData);
        let itemData: any = null;

        // Logic to extract the first relevant item from the parsed response
        if (parsedData && Array.isArray(parsedData.payload) && parsedData.payload.length > 0) {
            itemData = parsedData.payload[0];
        } else if (Array.isArray(parsedData) && parsedData.length > 0) {
            itemData = parsedData[0];
        } else if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData) && parsedData.id) {
            // Case for direct single object response that contains 'id'
            itemData = parsedData;
        }

        if (itemData && itemData.id && typeof itemData.id === 'string') {
            logToFile(`${logContext} Successfully found ID: ${itemData.id}. Details preview: ${JSON.stringify(itemData).substring(0, Math.min(JSON.stringify(itemData).length, 100))}`);
            // Construct partial BlacklistItem details for the returned object
            const detailsToReturn: Partial<BlacklistItem> = {
                conferenceId: itemData.id,
                title: itemData.title,
                acronym: itemData.acronym,
                dates: itemData.dates,
                location: itemData.location,
            };
            return { success: true, itemId: itemData.id, details: detailsToReturn };
        } else {
            logToFile(`${logContext} Error: Could not extract valid ID or details from API response. Data preview: ${JSON.stringify(itemData || parsedData).substring(0, Math.min(JSON.stringify(itemData || parsedData).length, 100))}...`);
            return { success: false, errorMessage: `Found ${itemType} data for "${identifier}", but could not extract its ID or details.` };
        }
    } catch (parseError: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(parseError);
        logToFile(`${logContext} JSON Parsing Error during search result processing: ${errorMessage}. Raw data preview: ${apiResult.rawData.substring(0, Math.min(apiResult.rawData.length, 200))}...\nStack: ${errorStack}`);
        return { success: false, errorMessage: `Error processing search results for ${itemType} "${identifier}". Details: ${errorMessage}` };
    }
}