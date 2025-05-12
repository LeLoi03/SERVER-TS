// src/handlers/manageCalendar.handler.ts
import {
    findItemId, // Re-use from follow service
    executeGetUserCalendar,
    executeManageCalendarApi,
} from '../services/manageCalendar.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types'; // Removed StatusUpdate as it's not used in the provided follow handler
import logToFile from '../../utils/logger';

// --- Định nghĩa các kiểu dữ liệu hẹp hơn ---
type ValidItemTypeCalendar = 'conference'; // Only conference for calendar
type ValidIdentifierTypeCalendar = 'acronym' | 'title' | 'id';
type ValidActionCalendar = 'add' | 'remove';

export class ManageCalendarHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, userToken, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: ManageCalendar, Args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

        // --- Helper function để gửi status update ---
        const sendStatus = (step: string, message: string, details?: object) => {
            if (onStatusUpdate) {
                onStatusUpdate('status_update', {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp: new Date().toISOString(),
                });
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate not provided for step: ${step}`);
            }
        };

        try {
            // --- 1. Validation ---
            sendStatus('validating_calendar_args', 'Validating add/remove calendar arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const identifier = args?.identifier as string | undefined;
            const identifierType = args?.identifierType as string | undefined;
            const action = args?.action as string | undefined;

            // a) Check for missing arguments
            if (!itemType || !identifier || !identifierType || !action) {
                const errorMsg = "Missing required information (item type, identifier, identifier type, or action).";
                logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

            // b) Check for invalid argument values
            let validationError: string | null = null;
            if (itemType !== 'conference') { // Calendar only for conference
                validationError = `Invalid item type "${itemType}". Must be 'conference' for calendar actions.`;
            } else if (!(['acronym', 'title', 'id'] as string[]).includes(identifierType)) {
                validationError = `Invalid identifier type "${identifierType}". Must be 'acronym', 'title', or 'id'.`;
            } else if (!(['add', 'remove'] as string[]).includes(action)) {
                validationError = `Invalid action "${action}". Must be 'add' or 'remove'.`;
            }

            if (validationError) {
                logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${validationError}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }

            // --- Types are now narrowed ---
            const validItemType = itemType as ValidItemTypeCalendar;
            const validIdentifier = identifier;
            const validIdentifierType = identifierType as ValidIdentifierTypeCalendar;
            const validAction = action as ValidActionCalendar;

            // --- 2. Authentication Check ---
            sendStatus('checking_authentication_calendar', 'Checking authentication status for calendar action...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} ManageCalendar: User not authenticated.`);
                sendStatus('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: "Error: You must be logged in to manage calendar .", frontendAction: undefined };
            }

            // --- 3. Find Item ID (Conference ID) ---
            // We only care about conferences for calendar
            sendStatus('finding_calendar_item_id', `Searching for ${validItemType} with ${validIdentifierType}: "${validIdentifier}"...`, { identifier: validIdentifier, identifierType: validIdentifierType, itemType: validItemType });
            const idResult = await findItemId(validIdentifier, validIdentifierType, 'conference'); // Always 'conference'

            if (!idResult.success || !idResult.itemId) {
                const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${validIdentifier}".`;
                logToFile(`${logPrefix} ManageCalendar: Error finding ID - ${errorMsg}`);
                sendStatus('calendar_item_id_not_found', `Could not find ${validItemType} "${validIdentifier}".`, { error: errorMsg, identifier: validIdentifier, identifierType: validIdentifierType, itemType: validItemType });
                return { modelResponseContent: errorMsg, frontendAction: undefined };
            }
            const itemId = idResult.itemId;
            sendStatus('calendar_item_id_found', `Found ${validItemType} (ID: ${itemId}).`, { itemId, itemType: validItemType });

            // --- 4. Check Current Calendar Status ---
            sendStatus('checking_calendar_status', `Checking your calendar status for item ${itemId}...`, { itemId });
            const calendarStatusResult = await executeGetUserCalendar(userToken); // Only conferences

            if (!calendarStatusResult.success) {
                const errorMsg = calendarStatusResult.errorMessage || 'Failed to check calendar status.';
                logToFile(`${logPrefix} ManageCalendar: Error checking status - ${errorMsg}`);
                sendStatus('function_error', 'Failed to check calendar status.', { error: errorMsg, itemId });
                return { modelResponseContent: `Sorry, I couldn't check your current calendar status: ${errorMsg}`, frontendAction: undefined };
            }
            const isCurrentlyInCalendar = calendarStatusResult.itemIds.includes(itemId);
            sendStatus('calendar_status_checked', `Current calendar status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}.`, { itemId, isCurrentlyInCalendar });

            // --- 5. Determine if API Call is Needed ---
            sendStatus('determining_calendar_action', `Determining required action based on request ('${validAction}') and status...`);
            const needsApiCall = (validAction === 'add' && !isCurrentlyInCalendar) || (validAction === 'remove' && isCurrentlyInCalendar);
            sendStatus('calendar_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} to/from calendar.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyInCalendar}).`, { needsApiCall, currentStatus: isCurrentlyInCalendar, requestedAction: validAction });


            // --- 6. Execute API Call or Return Status Message ---
            let finalMessage = "";
            let frontendActionToTake: { name: 'addToCalendar' | 'removeFromCalendar', params: { conferenceId: string, conferenceDetails?: any } } | undefined = undefined;

            if (needsApiCall) {
                sendStatus('preparing_calendar_api_call', `${validAction === 'add' ? 'Adding' : 'Removing'} item ${itemId} ${validAction === 'add' ? 'to' : 'from'} calendar...`, { action: validAction, itemId, itemType: validItemType });
                const apiActionResult = await executeManageCalendarApi(itemId, validAction, userToken);

                if (apiActionResult.success) {
                    finalMessage = `Successfully ${validAction === 'add' ? 'added' : 'removed'} the ${validItemType} "${validIdentifier}" (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} your calendar.`;
                    logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} successful.`);
                    sendStatus('calendar_update_success', `Successfully ${validAction}ed ${validItemType} ${validAction === 'add' ? 'to' : 'from'} calendar.`, { itemId, itemType: validItemType });

                    // Prepare frontend action
                    // For 'add', we might need more details to create a good calendar event.
                    // For 'remove', just the ID is usually enough.
                    // This is a placeholder; you'll need to decide how to get `conferenceDetails`
                    // if `addToCalendar` frontend action requires them.
                    // It might involve another call to get conference details if not already available.
                    if (validAction === 'add') {
                         // IMPORTANT: You'll need a way to get conferenceDetails (name, date, time, location etc.)
                         // This might involve another fetch or ensuring findItemId returns more than just the ID.
                         // For now, let's assume the frontend action can handle just the ID or you'll enhance this.
                        frontendActionToTake = {
                            name: 'addToCalendar',
                            params: { conferenceId: itemId, conferenceDetails: apiActionResult.conferenceDetails || { id: itemId, name: validIdentifier } } // Pass details if API returns them
                        };
                    } else { // remove
                        frontendActionToTake = {
                            name: 'removeFromCalendar',
                            params: { conferenceId: itemId }
                        };
                    }

                } else {
                    finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType} "${validIdentifier}" ${validAction === 'add' ? 'to' : 'from'} your calendar. Please try again later.`;
                    logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} failed - ${apiActionResult.errorMessage}`);
                    sendStatus('calendar_update_failed', `Failed to ${validAction} ${validItemType} ${validAction === 'add' ? 'to' : 'from'} calendar.`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType });
                }
            } else {
                if (validAction === 'add' /* && isCurrentlyInCalendar */) {
                    finalMessage = `The ${validItemType} "${validIdentifier}" (ID: ${itemId}) is already added to your calendar.`;
                } else { // action === 'remove' && !isCurrentlyInCalendar
                    finalMessage = `The ${validItemType} "${validIdentifier}" (ID: ${itemId}) is already removed from your calendar.`;
                }
                logToFile(`${logPrefix} ManageCalendar: No API call executed for action '${validAction}'. Current status: ${isCurrentlyInCalendar}`);
            }

            // --- Return Final Result ---
            return {
                modelResponseContent: finalMessage,
                frontendAction: undefined
            };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageCalendarItemHandler: ${errorMessage}\nStack: ${error.stack}`);
            sendStatus?.('function_error', `Critical error during calendar management processing: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}