// src/services/manageCalendar.service.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe';
import { ApiCallResult, CalendarItem, FollowItem } from '../shared/types'; // Import CalendarItem, FollowItem (if findItemId returns it)
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility
import { ConfigService } from '../../config/config.service';

// Export findItemId from manageFollow.service for reuse.
// It's assumed this function is robust enough to find IDs for calendar items as well.
export { findItemId } from './manageFollow.service';

const LOG_PREFIX = "[CalendarService]";

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

// Defines the API actions for calendar management: 'add' an event, 'remove' an event.
type ServiceApiActionTypeCalendar = 'add' | 'remove';

const HEADERS = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
};

/**
 * Constructs the appropriate API URL for calendar operations.
 *
 * @param {'calendarList' | 'add' | 'remove'} operation - The specific calendar operation.
 * @returns {string} The full URL for the API endpoint.
 * @throws {Error} If an invalid operation type is provided.
 */
function getCalendarApiUrl(
    operation: 'calendarList' | 'add' | 'remove'
): string {
    const base = 'calendar'; // Your API base path for calendar operations
    switch (operation) {
        case 'calendarList':
            return `${DATABASE_URL}/${base}/events`; // Endpoint to get list of calendar events
        case 'add':
            return `${DATABASE_URL}/${base}/add-event`; // Endpoint to add an event
        case 'remove':
            return `${DATABASE_URL}/${base}/remove-event`; // Endpoint to remove an event
        default:
            // This case should ideally not be reached if types are used correctly, but provides a fallback.
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
        // Assuming each CalendarItem has a `conferenceId` property
        const itemIds = calendarEvents.map(event => event.conferenceId);

        logToFile(`${logContext} Success. Found ${itemIds.length} event(s) in calendar.`);
        return { success: true, itemIds, items: calendarEvents };

    } catch (error: unknown) { // Catch as unknown for safer error handling
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMessage}\nStack: ${errorStack}`);
        return { success: false, itemIds: [], errorMessage: `Network error fetching calendar events. Details: ${errorMessage}` };
    }
}

/**
 * Executes an API call to add or remove a specific conference event from the user's calendar.
 * On successful 'add', it may return partial `CalendarItem` details if provided by the API.
 *
 * @param {string} conferenceId - The unique ID of the conference event to add or remove.
 * @param {ServiceApiActionTypeCalendar} action - The action to perform: 'add' to calendar, 'remove' from calendar.
 * @param {string | null} token - The user's authentication token (Bearer token).
 * @returns {Promise<{ success: boolean; errorMessage?: string; conferenceDetails?: Partial<CalendarItem> }>}
 *          A Promise resolving to an object indicating success or failure, with an optional error message,
 *          and optionally `conferenceDetails` if the 'add' action was successful and details were returned.
 */
export async function executeManageCalendarApi(
    conferenceId: string,
    action: ServiceApiActionTypeCalendar, // 'add' or 'remove'
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

    const url = getCalendarApiUrl(action); // 'add' or 'remove' operation
    // API might require different methods (POST, PUT, DELETE). Adjust as needed.
    // This example uses PUT for both add and remove, modify if your API differs.
    const method = 'POST';
    const bodyPayload = { conferenceId: conferenceId };

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
                // Attempt to parse JSON error details, fallback to text, then status
                const errorData = await response.json();
                errorDetails = errorData?.message || errorData?.error || JSON.stringify(errorData).substring(0, Math.min(JSON.stringify(errorData).length, 100));
            } catch {
                // If JSON parsing fails, use the status and statusText
                errorDetails = `Status ${response.status} ${response.statusText}`;
            }
            logToFile(`${logContext} API Error (${response.status}): ${errorDetails}`);
            return { success: false, errorMessage: `API Error (${response.status}): Failed to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar. ${errorDetails}` };
        }

        logToFile(`${logContext} Action executed successfully.`);
        let returnedDetails: Partial<CalendarItem> | undefined = undefined;

        // If 'add' action, attempt to parse response for conference details
        if (action === 'add') {
            try {
                // The API might return details of the added/updated conference.
                const responseData = await response.json();
                // Check if responseData is an object and contains relevant ID (e.g., conferenceId)
                if (responseData && typeof responseData === 'object' && responseData.conferenceId === conferenceId) {
                    returnedDetails = responseData as Partial<CalendarItem>; // Direct cast if structure matches
                } else if (responseData && responseData.data && typeof responseData.data === 'object' && responseData.data.conferenceId === conferenceId) {
                    // Handle cases where the actual data is nested under a 'data' property
                    returnedDetails = responseData.data as Partial<CalendarItem>;
                }
                // If API returns nothing parsable or no relevant ID, returnedDetails remains undefined
                if (returnedDetails) {
                    logToFile(`${logContext} Details returned from '${action}' response: ${JSON.stringify(returnedDetails).substring(0, Math.min(JSON.stringify(returnedDetails).length, 100))}`);
                } else {
                    logToFile(`${logContext} No relevant details returned from '${action}' response, but action was successful.`);
                }
            } catch (e: unknown) {
                const { message: parseMsg } = getErrorMessageAndStack(e);
                logToFile(`${logContext} Warning: Could not parse details from '${action}' response, but action was successful. Error: ${parseMsg}`);
                returnedDetails = undefined; // Ensure it's undefined if parsing fails
            }
        }
        return { success: true, conferenceDetails: returnedDetails };

    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logToFile(`${logContext} Network/Fetch Error: ${errorMessage}\nStack: ${errorStack}`);
        return { success: false, errorMessage: `Network error attempting to ${action} conference ${action === 'add' ? 'to' : 'from'} calendar. Details: ${errorMessage}` };
    }
}