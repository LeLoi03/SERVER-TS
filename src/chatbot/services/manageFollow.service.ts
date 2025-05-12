// src/services/manageFollow.service.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { ApiCallResult, FollowItem } from '../shared/types'; // Đảm bảo FollowItem được import
import logToFile from '../../utils/logger';
import { executeGetConferences } from './getConferences.service';
import { executeGetJournals } from './getJournals.service';
import { ConfigService } from '../../config/config.service';

const LOG_PREFIX = "[FollowService]";

const configService = container.resolve(ConfigService);
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}

type ServiceItemType = 'conference' | 'journal';
type ServiceApiActionType = 'follow' | 'unfollow';
type ServiceIdentifierType = 'id' | 'acronym' | 'title';

const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

function getApiUrl(
    itemType: ServiceItemType,
    operation: 'followedList' | 'add' | 'remove'
): string {
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

export async function executeGetUserFollowed(
    itemType: ServiceItemType,
    token: string | null
): Promise<{ success: boolean; itemIds: string[]; items?: FollowItem[]; errorMessage?: string }> {
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
            headers: { ...HEADERS, "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => `Status ${response.status}`);
            logToFile(`${logContext} API Error (${response.status}): ${errorText.substring(0, 200)}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching followed ${itemType} list.` };
        }

        // API trả về mảng các đối tượng khớp với FollowItem
        const followedItems: FollowItem[] = await response.json();
        const itemIds = followedItems.map(item => item.id);

        logToFile(`${logContext} Success. Found ${itemIds.length} followed item(s).`);
        return { success: true, itemIds, items: followedItems };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching followed ${itemType} list.` };
    }
}

export async function executeFollowUnfollowApi(
    itemId: string,
    itemType: ServiceItemType,
    action: ServiceApiActionType,
    token: string | null
): Promise<{ success: boolean; errorMessage?: string }> {
    // ... (logic không đổi)
    const logContext = `${LOG_PREFIX} [${action} ${itemType} ID: ${itemId}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
        logToFile(`${logContext} Error: Item ID is missing or invalid.`);
        return { success: false, errorMessage: "Item ID is required." };
    }

    const operation = action === 'follow' ? 'add' : 'remove';
    const url = getApiUrl(itemType, operation);
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
 * Finds the ID of a conference or journal using an identifier.
 * Optionally returns more details about the found item.
 * @param identifier - The value used for searching.
 * @param identifierType - The type of the identifier.
 * @param itemType - The type of item.
 * @returns A promise resolving to the found item ID and optionally its details.
 */
export async function findItemId(
    identifier: string,
    identifierType: ServiceIdentifierType,
    itemType: ServiceItemType
): Promise<{ success: boolean; itemId?: string; details?: Partial<FollowItem>; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [FindID ${itemType} Ident:"${identifier}" Type:${identifierType}]`;
    logToFile(`${logContext} Attempting to find item ID.`);

    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
        logToFile(`${logContext} Error: Identifier is missing.`);
        return { success: false, errorMessage: "Identifier is required to find the item ID." };
    }

    if (identifierType === 'id') {
        logToFile(`${logContext} Identifier type is ID. Cannot fetch details with ID alone without a specific 'getById' API. Returning ID directly: ${identifier}`);
        // Nếu bạn có API getById, bạn có thể gọi nó ở đây để lấy chi tiết.
        // Hiện tại, chúng ta chỉ trả về ID.
        return { success: true, itemId: identifier, details: { id: identifier } };
    }

    // Search by acronym or title
    const searchParams = new URLSearchParams({
        // API của bạn có thể tìm kiếm bằng 'acronym' hoặc 'title' với cùng một tham số
        // hoặc có thể cần các tham số khác nhau. Điều chỉnh nếu cần.
        // Giả sử API tìm kiếm bằng 'acronym' có thể tìm thấy cả title.
        acronym: identifier, // Hoặc một tham số tìm kiếm chung hơn
        perPage: '1',
        page: '1'
    });
    const searchQuery = searchParams.toString();
    logToFile(`${logContext} Constructed search query: ${searchQuery}`);

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
        let itemData: any = null; // Sẽ là Partial<FollowItem>
        // Điều chỉnh logic trích xuất này dựa trên cấu trúc thực tế của executeGetConferences/Journals
        if (parsedData && Array.isArray(parsedData.payload) && parsedData.payload.length > 0) {
            itemData = parsedData.payload[0];
        } else if (Array.isArray(parsedData) && parsedData.length > 0) {
            itemData = parsedData[0];
        } else if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData) && parsedData.id) {
            // Nếu API trả về một đối tượng duy nhất khi tìm thấy
            itemData = parsedData;
        }


        if (itemData && itemData.id && typeof itemData.id === 'string') {
            logToFile(`${logContext} Successfully found ID: ${itemData.id}. Details: ${JSON.stringify(itemData).substring(0,100)}`);
            // Trả về các chi tiết cần thiết từ itemData, khớp với Partial<FollowItem>
            const detailsToReturn: Partial<FollowItem> = {
                id: itemData.id,
                title: itemData.title,
                acronym: itemData.acronym,
                // Thêm các trường khác nếu có và cần thiết
            };
            return { success: true, itemId: itemData.id, details: detailsToReturn };
        } else {
            logToFile(`${logContext} Error: Could not extract valid ID or details from API response. Data: ${JSON.stringify(itemData).substring(0, 100)}...`);
            return { success: false, errorMessage: `Found ${itemType} data for "${identifier}", but could not extract its ID or details.` };
        }
    } catch (parseError: any) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        logToFile(`${logContext} JSON Parsing Error: ${errorMsg}. Raw data: ${apiResult.rawData.substring(0, 200)}...`);
        return { success: false, errorMessage: `Error processing search results for ${itemType} "${identifier}".` };
    }
}