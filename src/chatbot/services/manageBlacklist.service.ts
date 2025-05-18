// src/services/manageBlacklist.service.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { ApiCallResult, BlacklistItem } from '../shared/types'; // Sử dụng BlacklistItem
import logToFile from '../../utils/logger';
import { executeGetConferences } from './getConferences.service'; // Chỉ cần getConferences
import { ConfigService } from '../../config/config.service';

const LOG_PREFIX = "[BlacklistService]";

const configService = container.resolve(ConfigService);
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}

// Blacklist chỉ hỗ trợ 'conference'
type ServiceItemTypeRestricted = 'conference';
type ServiceApiActionType = 'add' | 'remove'; // 'add' to blacklist, 'remove' from blacklist
type ServiceIdentifierType = 'id' | 'acronym' | 'title';

const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

function getApiUrl(
    // itemType không cần thiết vì luôn là conference, nhưng giữ để nhất quán cấu trúc nếu muốn
    operation: 'blacklistedList' | 'add' | 'remove'
): string {
    const base = 'blacklist-conference'; // API endpoint mới cho blacklist
    switch (operation) {
        case 'blacklistedList':
            return `${DATABASE_URL}/${base}`; // Giả sử endpoint là /list
        case 'add':
            return `${DATABASE_URL}/${base}/add`;
        case 'remove':
            return `${DATABASE_URL}/${base}/remove`;
        default:
            logToFile(`${LOG_PREFIX} Error: Invalid operation type for URL construction: ${operation}`);
            throw new Error(`Invalid blacklist operation: ${operation}`);
    }
}

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
            logToFile(`${logContext} API Error (${response.status}): ${errorText.substring(0, 200)}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching blacklisted conferences list.` };
        }

        const blacklistedItems: BlacklistItem[] = await response.json();
        const itemIds = blacklistedItems.map(item => item.conferenceId);

        logToFile(`${logContext} Success. Found ${itemIds.length} blacklisted conference(s).`);
        return { success: true, itemIds, items: blacklistedItems };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching blacklisted conferences list.` };
    }
}

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

    const operation = action; // 'add' or 'remove'
    const url = getApiUrl(operation);
    const bodyPayload = { conferenceId: conferenceId };

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
            } catch { /* ignore */ }
            logToFile(`${logContext} API Error (${response.status}): ${errorDetails}`);
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} conference for blacklist. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        return { success: true };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, errorMessage: `Network error attempting to ${action} conference for blacklist.` };
    }
}

// findItemId có thể được giữ nguyên hoặc điều chỉnh nhẹ nếu cần
// Hiện tại, nó đã khá chung chung. Khi gọi, chúng ta sẽ truyền itemType: 'conference'
// Nên để nó ở một file service chung hoặc copy/điều chỉnh nếu bạn muốn nó độc lập hoàn toàn
// Vì mục đích của bài này, giả sử chúng ta có thể tái sử dụng `findItemId` từ `manageFollow.service.ts`
// hoặc bạn copy nó vào đây và đảm bảo itemType luôn là 'conference'.
// Để giữ cho service này độc lập, hãy copy và điều chỉnh `findItemId`.

export async function findConferenceItemId( // Đổi tên để rõ ràng hơn
    identifier: string,
    identifierType: ServiceIdentifierType
): Promise<{ success: boolean; itemId?: string; details?: Partial<BlacklistItem>; errorMessage?: string }> {
    const itemType: ServiceItemTypeRestricted = 'conference'; // Cố định
    const logContext = `${LOG_PREFIX} [FindID ${itemType} Ident:"${identifier}" Type:${identifierType}]`;
    logToFile(`${logContext} Attempting to find ${itemType} ID.`);

    if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') {
        logToFile(`${logContext} Error: Identifier is missing.`);
        return { success: false, errorMessage: "Identifier is required to find the item ID." };
    }

    if (identifierType === 'id') {
        logToFile(`${logContext} Identifier type is ID. Returning ID directly: ${identifier}`);
        return { success: true, itemId: identifier, details: { conferenceId: identifier } };
    }

    const searchParams = new URLSearchParams({
        acronym: identifier,
        perPage: '1',
        page: '1'
    });
    const searchQuery = searchParams.toString();
    logToFile(`${logContext} Constructed search query for conference: ${searchQuery}`);

    const apiResult: ApiCallResult = await executeGetConferences(searchQuery); // Chỉ gọi getConferences

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
        } else if (Array.isArray(parsedData) && parsedData.length > 0) {
            itemData = parsedData[0];
        } else if (typeof parsedData === 'object' && parsedData !== null && !Array.isArray(parsedData) && parsedData.id) {
            itemData = parsedData;
        }

        if (itemData && itemData.id && typeof itemData.id === 'string') {
            logToFile(`${logContext} Successfully found ID: ${itemData.id}. Details: ${JSON.stringify(itemData).substring(0,100)}`);
            const detailsToReturn: Partial<BlacklistItem> = { // Sử dụng BlacklistItem
                conferenceId: itemData.id,
                title: itemData.title,
                acronym: itemData.acronym,
                dates: itemData.dates,
                location: itemData.location,
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