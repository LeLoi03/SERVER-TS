// src/services/manageCalendar.service.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { ApiCallResult, CalendarItem, FollowItem } from '../shared/types'; // Import CalendarItem
import logToFile from '../../utils/logger';
import { ConfigService } from '../../config/config.service';
export { findItemId } from './manageFollow.service'; // findItemId có thể trả về Partial<FollowItem>

const LOG_PREFIX = "[CalendarService]";

const configService = container.resolve(ConfigService);
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}

// ServiceActionTypeCalendar chỉ cho API calls, 'list' được xử lý bởi executeGetUserCalendar
type ServiceApiActionTypeCalendar = 'add' | 'remove';


const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

function getCalendarApiUrl(
    operation: 'calendarList' | 'add' | 'remove' // 'calendarList' cho lấy danh sách
): string {
    const base = 'calendar'; // API base path của bạn cho calendar
    switch (operation) {
        case 'calendarList':
            return `${DATABASE_URL}/${base}/events`; // Endpoint lấy danh sách sự kiện lịch
        case 'add':
            return `${DATABASE_URL}/${base}/add-event`; // Endpoint thêm sự kiện
        case 'remove':
            return `${DATABASE_URL}/${base}/remove-event`; // Endpoint xóa sự kiện
        default:
            logToFile(`${LOG_PREFIX} Error: Invalid operation type for URL construction: ${operation}`);
            throw new Error(`Invalid calendar operation: ${operation}`);
    }
}

/**
 * Fetches the list of conferences (as CalendarItem) added to the user's calendar.
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
            logToFile(`${logContext} API Error (${response.status}): ${errorText.substring(0, 200)}`);
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching calendar events.` };
        }

        const calendarEvents: CalendarItem[] = await response.json();
        const itemIds = calendarEvents.map(event => event.conferenceId); // Giả sử mỗi CalendarItem có 'id' của conference

        logToFile(`${logContext} Success. Found ${itemIds.length} event(s) in calendar.`);
        return { success: true, itemIds, items: calendarEvents };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching calendar events.` };
    }
}

/**
 * Executes the add or remove action for a specific conference in the calendar.
 * On successful 'add', may include conferenceDetails if returned by API.
 */
export async function executeManageCalendarApi(
    conferenceId: string,
    action: ServiceApiActionTypeCalendar, // 'add' or 'remove'
    token: string | null
): Promise<{ success: boolean; errorMessage?: string; conferenceDetails?: Partial<CalendarItem> }> { // Trả về Partial<CalendarItem>
    const logContext = `${LOG_PREFIX} [${action}CalendarEvent ID: ${conferenceId}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!conferenceId || typeof conferenceId !== 'string' || conferenceId.trim() === '') {
        logToFile(`${logContext} Error: Conference ID is missing or invalid.`);
        return { success: false, errorMessage: "Conference ID is required." };
    }

    const url = getCalendarApiUrl(action); // 'add' hoặc 'remove'
    // API của bạn có thể yêu cầu method khác nhau (POST, PUT, DELETE)
    // Ví dụ này dùng PUT cho cả add và remove, điều chỉnh nếu cần
    const method = 'PUT'; // Hoặc POST cho 'add' và DELETE cho 'remove'
    const bodyPayload = { conferenceId: conferenceId };

    logToFile(`${logContext} Executing action: ${method} ${url}`);

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
                errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData).substring(0, 100);
            } catch { /* ignore */ }
            logToFile(`${logContext} API Error (${response.status}): ${errorDetails}`);
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        let returnedDetails: Partial<CalendarItem> | undefined = undefined;
        if (action === 'add') {
            try {
                // API có thể trả về chi tiết của conference đã được thêm/cập nhật
                const responseData = await response.json();
                if (responseData && typeof responseData === 'object' && responseData.id === conferenceId) {
                    returnedDetails = responseData as Partial<CalendarItem>; // Cast to ensure type safety
                } else if (responseData && responseData.data && responseData.data.id === conferenceId) {
                     returnedDetails = responseData.data as Partial<CalendarItem>;
                }
                // Nếu API không trả về gì hoặc không có id, returnedDetails sẽ là undefined
            } catch (e) {
                logToFile(`${logContext} No parsable details from '${action}' response, but action was successful.`);
            }
        }
        return { success: true, conferenceDetails: returnedDetails };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, errorMessage: `Network error attempting to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar.` };
    }
}