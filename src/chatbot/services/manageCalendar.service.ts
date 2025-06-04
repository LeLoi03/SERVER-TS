// src/services/manageCalendar.service.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { ApiCallResult, CalendarItem, FollowItem } from '../shared/types'; // Import CalendarItem, FollowItem
import logToFile from '../../utils/logger';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { ConfigService } from '../../config/config.service';

export { findItemId } from './manageFollow.service';

const LOG_PREFIX = "[CalendarService]";

const configService = container.resolve(ConfigService);
const DATABASE_URL: string | undefined = configService.databaseUrl;

if (!DATABASE_URL) {
    const errorMsg = `${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`;
    logToFile(errorMsg);
    throw new Error(errorMsg);
} else {
    // logToFile(`${LOG_PREFIX} DATABASE_URL configured.`);
}

type ServiceApiActionTypeCalendar = 'add' | 'remove';

const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

function getCalendarApiUrl(
    operation: 'calendarList' | 'add' | 'remove'
): string {
    const base = 'calendar';
    switch (operation) {
        case 'calendarList':
            return `${DATABASE_URL}/${base}/conference-events`;
        case 'add':
            return `${DATABASE_URL}/${base}/add`;
        case 'remove':
            return `${DATABASE_URL}/${base}/remove`;
        default:
            logToFile(`${LOG_PREFIX} Error: Invalid operation type for URL construction: ${operation}`);
            throw new Error(`Invalid calendar operation: ${operation}`);
    }
}

/**
 * Fetches the list of conferences (as CalendarItem) currently added to the user's calendar.
 * Requires an authentication token.
 *
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; itemIds: string[]; items?: CalendarItem[]; errorMessage?: string }>}
 *          A Promise resolving to an object indicating success, a list of calendar event IDs,
 *          optional full `CalendarItem` details, and an error message if the call fails.
 */
export async function executeGetUserCalendar(
    token: string | null
): Promise<{ success: boolean; itemIds: string[]; items?: CalendarItem[]; errorMessage?: string }> {
    const logContext = `${LOG_PREFIX} [GetUserCalendarEvents]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, itemIds: [], errorMessage: "Authentication token is required." };
    }

    const url = getCalendarApiUrl('calendarList');
    logToFile(`${logContext} Fetching calendar events: GET ${url}`);

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { ...HEADERS, "Authorization": `Bearer ${token}` }
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => `Status ${response.status}`);
            logToFile(`${logContext} API Error (${response.status}): ${errorText.substring(0, Math.min(errorText.length, 200))}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching calendar events.` };
        }

        const calendarEvents: CalendarItem[] = await response.json();
        // Cập nhật: Sử dụng 'id' thay vì 'conferenceId' vì API trả về 'id'
        const itemIds = calendarEvents.map(event => event.id);

        logToFile(`${logContext} Success. Found ${itemIds.length} event(s) in calendar.`);
        return { success: true, itemIds, items: calendarEvents };

    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMessage}\nStack: ${errorStack}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching calendar events. Details: ${errorMessage}` };
    }
}

/**
 * Executes an API call to add or remove a specific conference event from the user's calendar.
 * On successful 'add', it may return partial `CalendarItem` details if provided by the API.
 *
 * @param {string} conferenceId - The unique ID of the conference event to add or remove. (Đây là ID được gửi trong payload)
 * @param {ServiceApiActionTypeCalendar} action - The action to perform: 'add' to calendar, 'remove' from calendar.
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; errorMessage?: string; conferenceDetails?: Partial<CalendarItem> }>}
 *          A Promise resolving to an object indicating success or failure, with an optional error message,
 *          and optionally `conferenceDetails` if the 'add' action was successful and details were returned.
 */
export async function executeManageCalendarApi(
    conferenceId: string, // Tham số đầu vào vẫn là conferenceId vì payload nhận là conferenceId
    action: ServiceApiActionTypeCalendar,
    token: string | null
): Promise<{ success: boolean; errorMessage?: string; conferenceDetails?: Partial<CalendarItem> }> {
    const logContext = `${LOG_PREFIX} [${action}CalendarEvent ID: ${conferenceId}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!conferenceId || typeof conferenceId !== 'string' || conferenceId.trim() === '') {
        logToFile(`${logContext} Error: Conference ID is missing or invalid.`);
        return { success: false, errorMessage: "Conference ID is required." };
    }

    const url = getCalendarApiUrl(action);
    const method = 'POST'; // API yêu cầu POST cho cả add và remove
    const bodyPayload = { conferenceId: conferenceId }; // Payload gửi đi có trường conferenceId

    logToFile(`${logContext} Executing action: ${method} ${url} with payload: ${JSON.stringify(bodyPayload)}`);

    try {
        const response = await fetch(url, {
            method: method,
            headers: { ...HEADERS, 'Authorization': `Bearer ${token}` },
            body: JSON.stringify(bodyPayload),
        });

        if (!response.ok) {
            let errorDetails = `Status ${response.status}`;
            try {
                const errorData = await response.json();
                errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData).substring(0, Math.min(JSON.stringify(errorData).length, 100));
            } catch {
                errorDetails = `Status ${response.status} ${response.statusText}`;
            }
            logToFile(`${logContext} API Error (${response.status}): ${errorDetails}`);
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        let returnedDetails: Partial<CalendarItem> | undefined = undefined;

        // Nếu action là 'add' (hoặc 'remove' cũng có thể trả về item đã xóa nếu API thiết kế như vậy)
        // Cập nhật: API trả về 'id' cho conference, không phải 'conferenceId'
        if (action === 'add') {
            try {
                const responseData = await response.json();
                // Kiểm tra thuộc tính 'id' của đối tượng trả về, so sánh với conferenceId đã gửi đi
                if (responseData && typeof responseData === 'object' && responseData.id === conferenceId) {
                    returnedDetails = responseData as Partial<CalendarItem>;
                } else if (responseData && responseData.data && typeof responseData.data === 'object' && responseData.data.id === conferenceId) {
                    returnedDetails = responseData.data as Partial<CalendarItem>;
                }
                if (returnedDetails) {
                    logToFile(`${logContext} Details returned from '${action}' response: ${JSON.stringify(returnedDetails).substring(0, Math.min(JSON.stringify(returnedDetails).length, 100))}`);
                } else {
                    logToFile(`${logContext} No relevant details returned from '${action}' response for ID: ${conferenceId}, but action was successful. Response: ${JSON.stringify(responseData).substring(0, Math.min(JSON.stringify(responseData).length, 100))}`);
                }
            } catch (e: unknown) {
                const { message: parseMsg } = getErrorMessageAndStack(e);
                logToFile(`${logContext} Warning: Could not parse details from '${action}' response, but action was successful. Error: ${parseMsg}`);
                returnedDetails = undefined;
            }
        }
        return { success: true, conferenceDetails: returnedDetails };

    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMessage}\nStack: ${errorStack}`);
        return { success: false, errorMessage: `Network error attempting to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar. Details: ${errorMessage}` };
    }
}