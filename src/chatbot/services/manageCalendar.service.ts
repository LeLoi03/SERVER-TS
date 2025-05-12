// src/services/manageCalendar.service.ts
import 'reflect-metadata';
import { container } from 'tsyringe';
import { ApiCallResult } from '../shared/types'; // Assuming CalendarItem is similar to FollowItem or just an ID
import logToFile from '../../utils/logger';
import { ConfigService } from '../../config/config.service';
// Re-use findItemId from followUnfollowItem.service
// If you prefer to keep services completely separate, you can duplicate/move findItemId or create a shared utility service.
export { findItemId } from './manageFollow.service';


const LOG_PREFIX = "[CalendarService]";

const configService = container.resolve(ConfigService);
const DATABASE_URL = configService.config.DATABASE_URL;
if (!DATABASE_URL) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: DATABASE_URL is not configured.`);
    throw new Error("DATABASE_URL is not configured.");
}

// --- Type Definitions ---
// For calendar, itemType is always 'conference'
type ServiceActionTypeCalendar = 'add' | 'remove';

// Interface for items returned by the /calendar-conference/list endpoint
interface CalendarItem {
    id: string; // Assuming the API returns at least the ID of the conference
    // Potentially other details like name, date, if the API provides them
    name?: string;
    startDate?: string;
    endDate?: string;
    // ... any other relevant calendar event details
}


const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

// --- Helper Function for URL Construction ---
// Since it's only for conferences, itemType is fixed.
function getCalendarApiUrl(
    operation: 'calendarList' | 'add' | 'remove'
): string {
    const base = 'calendar'; // Always conference
    switch (operation) {
        case 'calendarList':
            return `${DATABASE_URL}/${base}/events`; // Or /items, /added etc.
        case 'add':
            return `${DATABASE_URL}/${base}/add-event`;
        case 'remove':
            return `${DATABASE_URL}/${base}/remove-event`;
        default:
            logToFile(`${LOG_PREFIX} Error: Invalid operation type for URL construction: ${operation}`);
            throw new Error(`Invalid calendar operation: ${operation}`);
    }
}

// --- Service Functions ---

/**
 * Fetches the list of conference IDs added to the user's calendar.
 * @param token - The user's authentication token.
 * @returns A promise resolving to the result, containing item IDs on success.
 */
export async function executeGetUserCalendar(
    token: string | null
): Promise<{ success: boolean; itemIds: string[]; errorMessage?: string; items?: CalendarItem[] }> {
    const logContext = `${LOG_PREFIX} [GetCalendarItems]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, itemIds: [], errorMessage: "Authentication token is required." };
    }

    const url = getCalendarApiUrl('calendarList');
    logToFile(`${logContext} Fetching calendar items: GET ${url}`);

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
            return { success: false, itemIds: [], errorMessage: `API Error (${response.status}) fetching calendar items list.` };
        }

        const calendarItems: CalendarItem[] = await response.json();
        const itemIds = calendarItems.map(item => item.id);
        logToFile(`${logContext} Success. Found ${itemIds.length} item(s) in calendar.`);
        return { success: true, itemIds, items: calendarItems };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching calendar items list.` };
    }
}

/**
 * Executes the add or remove action for a specific conference in the calendar.
 * @param conferenceId - The ID of the conference.
 * @param action - The action to perform ('add' or 'remove').
 * @param token - The user's authentication token.
 * @returns A promise resolving to the success status and optional error message.
 *          On successful 'add', may include conferenceDetails if returned by API.
 */
export async function executeManageCalendarApi(
    conferenceId: string,
    action: ServiceActionTypeCalendar,
    token: string | null
): Promise<{ success: boolean; errorMessage?: string; conferenceDetails?: any }> {
    const logContext = `${LOG_PREFIX} [${action}CalendarItem ID: ${conferenceId}]`;

    if (!token) {
        logToFile(`${logContext} Error: Authentication token is missing.`);
        return { success: false, errorMessage: "Authentication token is required." };
    }
    if (!conferenceId || typeof conferenceId !== 'string' || conferenceId.trim() === '') {
        logToFile(`${logContext} Error: Conference ID is missing or invalid.`);
        return { success: false, errorMessage: "Conference ID is required." };
    }

    const operation = action; // 'add' or 'remove' directly maps to API operation
    const url = getCalendarApiUrl(operation);
    const bodyPayload = { conferenceId: conferenceId }; // API expects conferenceId

    logToFile(`${logContext} Executing action: PUT ${url}`);

    try {
        const response = await fetch(url, {
            method: 'PUT',
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
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        // If the API returns details of the conference upon adding, parse and return them
        // This is useful for the frontend 'addToCalendar' action
        let conferenceDetails: any = undefined;
        if (action === 'add') {
            try {
                const responseData = await response.json();
                // Assuming the API might return the conference object or details
                // Adjust this based on your actual API response
                if (responseData && typeof responseData === 'object' && responseData.id === conferenceId) {
                    conferenceDetails = responseData;
                } else if (responseData && responseData.data && responseData.data.id === conferenceId) {
                    conferenceDetails = responseData.data;
                }
            } catch (e) {
                logToFile(`${logContext} Could not parse conference details from 'add' response, but action was successful.`);
                // It's not a critical error if details aren't parsed, the action itself was successful
            }
        }

        return { success: true, conferenceDetails };

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMsg}`);
        return { success: false, errorMessage: `Network error attempting to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar.` };
    }
}

// findItemId is re-exported from followUnfollowItem.service
// No need to redefine it here if its logic is general enough.
// If findItemId needs specific logic for calendar (e.g., fetching different fields),
// then you might need a separate version or enhance the existing one.
// For now, assuming the existing findItemId is sufficient to get a conference ID.