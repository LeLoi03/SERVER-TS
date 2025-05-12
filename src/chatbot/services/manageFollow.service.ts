import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import { ApiCallResult, FollowItem } from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed
import { executeGetConferences } from './getConferences.service'; // Adjust path if needed
import { executeGetJournals } from './getJournals.service'; // Adjust path if needed
import { ConfigService } from '../../config/config.service';

const LOG_PREFIX = "[FollowService]";

// --- Lấy ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Lấy cấu hình từ ConfigService ---
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}

// --- Type Definitions (replacing enums) ---
type ServiceItemType = 'conference' | 'journal';
type ServiceActionType = 'follow' | 'unfollow';
// This type should align with ValidIdentifierType from the handler for clarity
// and represent what findItemId can meaningfully process.
type ServiceIdentifierType = 'id' | 'acronym' | 'title';

// --- Constants (HEADERS remain the same) ---
const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

// --- Helper Function for URL Construction ---
function getApiUrl(
    itemType: ServiceItemType, // CHANGED from ItemType enum
    operation: 'followedList' | 'add' | 'remove'
): string {
    // CHANGED: Compare with string literals
    const base = itemType === 'conference' ? 'follow-conference' : 'follow-journal';
    switch (operation) {
        case 'followedList':
            return `${DATABASE_URL}/${base}/followed`;
        case 'add':
            return `${DATABASE_URL}/${base}/add`;
        case 'remove':
            return `${DATABASE_URL}/${base}/remove`;
        default:
            logToFile(`${LOG_PREFIX} Error: Invalid operation type for URL construction: ${operation}`);
            throw new Error(`Invalid follow/unfollow operation: ${operation}`);
    }
}

// --- Service Functions ---

/**
 * Fetches the list of followed item IDs for a given user and item type.
 * @param itemType - The type of item ('conference' or 'journal').
 * @param token - The user's authentication token.
 * @returns A promise resolving to the result, containing item IDs on success.
 */
export async function executeGetUserFollowed(
    itemType: ServiceItemType, // CHANGED from ItemType enum
    token: string | null
): Promise<{ success: boolean; itemIds: string[]; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [GetFollowed ${itemType}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, itemIds: [], errorMessage: "Authentication token is required." };
    }

    const url = getApiUrl(itemType, 'followedList');
    logToFile(`${logContext} Fetching followed items: GET ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                ...HEADERS,
                "Authorization": `Bearer ${token}`,
            }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => `Status ${response.status}`);
            const truncatedError = errorText.substring(0, 200);
            logToFile(`${logContext} API Error (${response.status}): ${truncatedError}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching followed ${itemType} list.` };
        }

        const followedItems: FollowItem[] = await response.json();
        const itemIds = followedItems.map(item => item.id);
        logToFile(`${logContext} Success. Found ${itemIds.length} followed item(s).`);
        return { success: true, itemIds };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching followed ${itemType} list.` };
    }
}

/**
 * Executes the follow or unfollow action for a specific item.
 * @param itemId - The ID of the conference or journal.
 * @param itemType - The type of item ('conference' or 'journal').
 * @param action - The action to perform ('follow' or 'unfollow').
 * @param token - The user's authentication token.
 * @returns A promise resolving to the success status and optional error message.
 */
export async function executeFollowUnfollowApi(
    itemId: string,
    itemType: ServiceItemType, // CHANGED from ItemType enum
    action: ServiceActionType, // CHANGED from ActionType enum
    token: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [${action} ${itemType} ID: ${itemId}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
        logToFile(`${logContext} Error: Item ID is missing or invalid.`);
        return { success: false, errorMessage: "Item ID is required." };
    }

    // CHANGED: Compare with string literals
    const operation = action === 'follow' ? 'add' : 'remove';
    const url = getApiUrl(itemType, operation);
    // CHANGED: Compare with string literals
    const bodyPayload = itemType === 'conference'
        ? { conferenceId: itemId }
        : { journalId: itemId };

    logToFile(`${logContext} Executing action: POST ${url}`);

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
                errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData).substring(0, 100);
            } catch {
                try {
                    const textError = await response.text();
                    errorDetails = textError.substring(0, 100) || `Status ${response.status}`;
                } catch { /* Ignore text read error */ }
            }
            logToFile(`${logContext} API Error (${response.status}): ${errorDetails}`);
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} ${itemType}. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        return { success: true };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, errorMessage: `Network error attempting to ${action} ${itemType}.` };
    }
}

/**
 * Finds the ID of a conference or journal using an identifier (like acronym or ID).
 * @param identifier - The value used for searching (e.g., 'ICML', 'Nature', 'specific-id-123').
 * @param identifierType - The type of the identifier ('id', 'acronym', 'title').
 * @param itemType - The type of item ('conference' or 'journal').
 * @returns A promise resolving to the found item ID or an error message.
 */
export async function findItemId(
    identifier: string,
    identifierType: ServiceIdentifierType, // CHANGED from IdentifierType enum | string | undefined
    itemType: ServiceItemType // CHANGED from ItemType enum
): Promise<{ success: boolean; itemId?: string; errorMessage?: string }> {
    // No need for `effectiveIdType` cast anymore
    const logContext = `${LOG_PREFIX} [FindID ${itemType} Ident:"${identifier}" Type:${identifierType}]`;
    logToFile(`${logContext} Attempting to find item ID.`);

    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
        logToFile(`${logContext} Error: Identifier is missing.`);
        return { success: false, errorMessage: "Identifier is required to find the item ID." };
    }

    // CHANGED: Compare with string literal
    if (identifierType === 'id') {
        logToFile(`${logContext} Identifier type is ID, returning directly: ${identifier}`);
        return { success: true, itemId: identifier };
    }

    const searchParams = new URLSearchParams({
        // If 'title' is passed as identifierType, it will be searched using the 'acronym' API parameter.
        // This matches the previous behavior where 'title' wasn't an explicit enum member for IdentifierType.
        acronym: identifier,
        perPage: '1',
        page: '1'
    });
    const searchQuery = searchParams.toString();
    logToFile(`${logContext} Constructed search query: ${searchQuery}`);

    // CHANGED: Compare with string literal
    const apiResult: ApiCallResult = itemType === 'conference'
        ? await executeGetConferences(searchQuery)
        : await executeGetJournals(searchQuery);

    if (!apiResult.success || !apiResult.rawData) {
        const errorDetail = apiResult.errorMessage ? `: ${apiResult.errorMessage}` : '.';
        logToFile(`${logContext} Search failed or returned no data${errorDetail}`);
        return { success: false, errorMessage: `Could not find ${itemType} using identifier "${identifier}"${errorDetail}` };
    }

    try {
        const parsedData = JSON.parse(apiResult.rawData);
        let itemData: any = null;
        if (parsedData && Array.isArray(parsedData.payload) && parsedData.payload.length > 0) {
            itemData = parsedData.payload[0];
            logToFile(`${logContext} Extracted item from parsedData.payload[0]`);
        } else if (Array.isArray(parsedData) && parsedData.length > 0) {
            itemData = parsedData[0];
            logToFile(`${logContext} Extracted item from parsedData[0]`);
        } else if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData) && parsedData.id) {
            itemData = parsedData;
            logToFile(`${logContext} Extracted item from single object parsedData`);
        }

        if (itemData && itemData.id && typeof itemData.id === 'string') {
            logToFile(`${logContext} Successfully found ID: ${itemData.id}`);
            return { success: true, itemId: itemData.id };
        } else {
            logToFile(`${logContext} Error: Could not extract valid ID from API response. Data: ${JSON.stringify(itemData).substring(0, 100)}...`);
            return { success: false, errorMessage: `Found ${itemType} data for "${identifier}", but could not extract its ID.` };
        }
    } catch (parseError: any) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logToFile(`${logContext} JSON Parsing Error: ${errorMsg}. Raw data: ${apiResult.rawData.substring(0, 200)}...`);
        return { success: false, errorMessage: `Error processing search results for ${itemType} "${identifier}".` };
    }
}