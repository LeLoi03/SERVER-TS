// src/chatbot/handlers/manageCalendar.handler.ts
import {
    findConferenceItemId, // Using ID lookup from manageBlacklist.service
    executeGetUserBlacklisted, // Importing blacklist check from manageBlacklist.service
} from '../services/manageBlacklist.service'; // Import from Blacklist service
import {
    executeGetUserCalendar,
    executeManageCalendarApi,
} from '../services/manageCalendar.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    CalendarItem,
    FrontendAction,
    ThoughtStep, // Added ThoughtStep for logging
    StatusUpdate
} from '../shared/types';
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Valid item types supported by the calendar feature.
 * Currently limited to 'conference'.
 */
type ValidItemTypeCalendar = 'conference';
/**
 * Valid identifier types for finding a conference item for calendar.
 */
type ValidIdentifierTypeCalendar = 'acronym' | 'title' | 'id';
/**
 * Valid actions for managing calendar entries.
 */
type ValidActionCalendar = 'add' | 'remove' | 'list';

/**
 * Handles the 'manageCalendar' function call from the LLM.
 * This handler allows users to add, remove, or list conferences in their calendar.
 * It includes validation, authentication checks, item lookup, and cross-checks with
 * blacklisted items to prevent conflicts.
 */
export class ManageCalendarHandler implements IFunctionHandler {
    /**
     * Executes the calendar management logic.
     *
     * @param {FunctionHandlerInput} context - The input context for the function handler,
     *                                       including arguments, user token, handler ID,
     *                                       socket ID, status update callback, and agent ID.
     * @returns {Promise<FunctionHandlerOutput>} A Promise that resolves with the model's response content,
     *                                          an optional frontend action, and a collection of `ThoughtStep`s.
     */
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const {
            args,
            userToken,
            handlerId: handlerProcessId,
            socketId,
            onStatusUpdate,
            agentId // Agent ID from the calling context
        } = context;
        const logPrefix = `[${handlerProcessId} ${socketId} Handler:ManageCalendar Agent:${agentId}]`;
        const localThoughts: ThoughtStep[] = []; // Collection for thoughts

        logToFile(`${logPrefix} Executing with args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

        /**
         * Helper function to report a status update and collect a ThoughtStep.
         * @param {string} step - A unique identifier for the current step.
         * @param {string} message - A human-readable message.
         * @param {object} [details] - Optional additional details.
         */
        const reportStep = (step: string, message: string, details?: object): void => {
            const timestamp = new Date().toISOString();
            const thought: ThoughtStep = {
                step,
                message,
                details,
                timestamp,
                agentId: agentId,
            };
            localThoughts.push(thought);
            logToFile(`${logPrefix} Thought added: Step: ${step}, Agent: ${agentId}`);

            if (onStatusUpdate) {
                const statusData: StatusUpdate = {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp,
                    agentId: agentId,
                };
                onStatusUpdate('status_update', statusData);
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate callback not provided for step: ${step}`);
            }
        };

        try {
            reportStep('validating_calendar_args', 'Validating calendar management arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const action = args?.action as string | undefined;
            const identifier = args?.identifier as string | undefined; // Optional for 'list'
            const identifierType = args?.identifierType as string | undefined; // Optional for 'list'

            if (!itemType) {
                const errorMsg = "Missing required item type for calendar action.";
                logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${errorMsg}`);
                reportStep('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }
            if (!action) {
                const errorMsg = "Missing required action for calendar action.";
                logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${errorMsg}`);
                reportStep('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }

            let validationError: string | null = null;
            if (itemType !== 'conference') {
                validationError = `Invalid item type "${itemType}". Must be 'conference' for calendar actions.`;
            } else if (!(['add', 'remove', 'list'] as string[]).includes(action)) {
                validationError = `Invalid action "${action}". Must be 'add', 'remove', or 'list'.`;
            }

            if (action === 'add' || action === 'remove') {
                if (!identifier || !identifierType) {
                    validationError = `Missing identifier or identifier type for calendar '${action}' action.`;
                } else if (!(['acronym', 'title', 'id'] as string[]).includes(identifierType)) {
                    validationError = `Invalid identifier type "${identifierType}" for calendar '${action}' action. Must be 'acronym', 'title', or 'id'.`;
                }
            }

            if (validationError) {
                logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${validationError}`);
                reportStep('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined, thoughts: localThoughts };
            }

            const validItemType = itemType as ValidItemTypeCalendar; // Always 'conference'
            const validAction = action as ValidActionCalendar;
            const validIdentifier = (action === 'add' || action === 'remove') ? identifier! : undefined;
            const validIdentifierType = (action === 'add' || action === 'remove') ? identifierType! as ValidIdentifierTypeCalendar : undefined;

            reportStep('checking_authentication_calendar', 'Checking authentication status for calendar action...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} ManageCalendar: User not authenticated.`);
                reportStep('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: "Error: You must be logged in to manage calendar items.", frontendAction: undefined, thoughts: localThoughts };
            }


            // --- BRANCH LOGIC BASED ON ACTION ---
            if (validAction === 'list') {
                reportStep('listing_calendar_items', `Fetching conferences in your calendar...`);
                const listResult = await executeGetUserCalendar(userToken);

                if (!listResult.success || !listResult.items) {
                    const errorMsg = listResult.errorMessage || `Failed to retrieve conferences from your calendar.`;
                    logToFile(`${logPrefix} ManageCalendar: Error listing items - ${errorMsg}`);
                    reportStep('function_error', `Failed to list calendar conferences.`, { error: errorMsg });
                    return { modelResponseContent: `Sorry, I couldn't retrieve conferences from your calendar: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
                }

                if (listResult.items.length === 0) {
                    const message = `You have no conferences in your calendar.`;
                    logToFile(`${logPrefix} ManageCalendar: No conferences found in calendar.`);
                    reportStep('list_success_empty_calendar', message);
                    return { modelResponseContent: message, frontendAction: undefined, thoughts: localThoughts };
                }

                const displayItemsForModelResponse = listResult.items.map((item: CalendarItem) => {
                    let details = `${item.conference} (${item.acronym})`;
                    if (item.dates?.fromDate) {
                        details += ` | Dates: ${new Date(item.dates.fromDate).toLocaleDateString()}`;
                        if (item.dates.toDate && item.dates.fromDate !== item.dates.toDate) {
                            details += ` - ${new Date(item.dates.toDate).toLocaleDateString()}`;
                        }
                    }
                    if (item.location?.cityStateProvince && item.location?.country) {
                        details += ` | Location: ${item.location.cityStateProvince}, ${item.location.country}`;
                    } else if (item.location?.country) {
                        details += ` | Location: ${item.location.country}`;
                    }
                    return { id: item.conferenceId, displayText: details };
                });

                const successMessage = `Here are the conferences in your calendar:`;
                logToFile(`${logPrefix} ManageCalendar: Successfully listed ${listResult.items.length} calendar conference(s).`);
                reportStep('list_success_calendar', successMessage, { count: listResult.items.length });

                return {
                    modelResponseContent: `${successMessage}\n${displayItemsForModelResponse.map(item => `- ${item.displayText}`).join('\n')}`,
                    frontendAction: {
                        type: 'displayList',
                        payload: {
                            items: listResult.items, // Array of full CalendarItem
                            itemType: validItemType, // 'conference'
                            listType: 'calendar',
                            title: `Your Calendar ${validItemType.charAt(0).toUpperCase() + validItemType.slice(1)}s`
                        }
                    },
                    thoughts: localThoughts
                };

            } else if (validAction === 'add' || validAction === 'remove') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                reportStep('finding_calendar_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`, { identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                // Using findConferenceItemId from blacklist service (reusable for conferences)
                const idResult = await findConferenceItemId(currentIdentifier, currentIdentifierType);


                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
                    logToFile(`${logPrefix} ManageCalendar: Error finding ID - ${errorMsg}`);
                    reportStep('calendar_item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined, thoughts: localThoughts };
                }
                const itemId = idResult.itemId;
                // idResult.details is Partial<BlacklistItem> or Partial<CalendarItem> - uses common fields
                const itemDetailsFromFind = idResult.details || {};
                const itemNameForMessage = itemDetailsFromFind.title || itemDetailsFromFind.acronym || currentIdentifier;

                reportStep('calendar_item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage });

                // --- CHECK CURRENT CALENDAR STATUS ---
                reportStep('checking_calendar_status', `Checking your calendar status for conference ${itemId}...`, { itemId });
                const calendarStatusResult = await executeGetUserCalendar(userToken);

                if (!calendarStatusResult.success) {
                    const errorMsg = calendarStatusResult.errorMessage || 'Failed to check calendar status.';
                    logToFile(`${logPrefix} ManageCalendar: Error checking status - ${errorMsg}`);
                    reportStep('function_error', 'Failed to check calendar status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current calendar status: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
                }
                const isCurrentlyInCalendar = calendarStatusResult.itemIds.includes(itemId);
                reportStep('calendar_status_checked', `Current calendar status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}.`, { itemId, isCurrentlyInCalendar });

                // --- CROSS-CHECK WHEN 'ADD' TO CALENDAR ---
                if (validAction === 'add' && !isCurrentlyInCalendar) { // Only check if intending to add and not already in Calendar
                    reportStep('checking_blacklist_status_for_calendar', `Checking if conference ${itemId} ("${itemNameForMessage}") is blacklisted before adding to calendar...`);
                    // itemType for executeGetUserBlacklisted is always 'conference' as blacklist is only for conferences
                    const blacklistStatusResult = await executeGetUserBlacklisted(userToken);
                    if (blacklistStatusResult.success && blacklistStatusResult.itemIds.includes(itemId)) {
                        const conflictMsg = `The conference "${itemNameForMessage}" is currently in your blacklist. You must remove it from blacklist before adding it to calendar.`;
                        logToFile(`${logPrefix} ManageCalendar: Conflict - Item ${itemId} is blacklisted, cannot add to calendar.`);
                        reportStep('calendar_conflict_blacklisted', conflictMsg, { itemId, itemName: itemNameForMessage });
                        return { modelResponseContent: conflictMsg, frontendAction: undefined, thoughts: localThoughts };
                    }
                    if (!blacklistStatusResult.success) {
                        logToFile(`${logPrefix} ManageCalendar: Warning - Could not verify blacklist status for ${itemId} ("${itemNameForMessage}") before adding to calendar: ${blacklistStatusResult.errorMessage}. Proceeding with calendar action.`);
                        reportStep('warning_blacklist_check_failed_before_calendar', `Could not verify if "${itemNameForMessage}" is blacklisted. Proceeding to add to calendar.`, { itemId, itemName: itemNameForMessage, error: blacklistStatusResult.errorMessage });
                    } else {
                        logToFile(`${logPrefix} ManageCalendar: Conference ${itemId} ("${itemNameForMessage}") is not blacklisted. Safe to proceed with adding to calendar.`);
                        reportStep('blacklist_check_clear_for_calendar', `Conference "${itemNameForMessage}" is not blacklisted. Proceeding to add to calendar.`, { itemId, itemName: itemNameForMessage });
                    }
                }
                // --- END CROSS-CHECK ---


                reportStep('determining_calendar_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'add' && !isCurrentlyInCalendar) || (validAction === 'remove' && isCurrentlyInCalendar);
                reportStep('calendar_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} to/from calendar.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}).`, { needsApiCall, currentStatus: isCurrentlyInCalendar, requestedAction: validAction, itemId });

                let finalMessage = "";
                let finalFrontendAction: FrontendAction = undefined;

                if (needsApiCall) {
                    reportStep('preparing_calendar_api_call', `${validAction === 'add' ? 'Adding' : 'Removing'} item ${itemNameForMessage} (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} calendar...`, { action: validAction, itemId, itemType: validItemType });
                    const apiActionResult = await executeManageCalendarApi(itemId, validAction as 'add' | 'remove', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'add' ? 'added' : 'removed'} the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} your calendar.`;
                        logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} successful for conference ${itemId}.`);
                        reportStep('calendar_update_success', `Successfully updated calendar for conference "${itemNameForMessage}".`, { itemId, itemType: validItemType, itemName: itemNameForMessage, action: validAction });

                        // Use details from idResult or apiActionResult.conferenceDetails if available
                        const itemDetailsForFrontend: Partial<CalendarItem> = apiActionResult.conferenceDetails || itemDetailsFromFind;

                        const itemDataForFrontend: CalendarItem = {
                            conferenceId: itemId,
                            conference: itemDetailsForFrontend.conference || itemNameForMessage,
                            acronym: itemDetailsForFrontend.acronym || '',
                            // Ensure other relevant fields are copied if available
                            dates: itemDetailsForFrontend.dates,
                            location: itemDetailsForFrontend.location,
                        };


                        finalFrontendAction = {
                            type: 'itemCalendarStatusUpdated', // New name for Calendar related updates
                            payload: {
                                item: itemDataForFrontend,
                                itemType: validItemType, // 'conference'
                                calendar: validAction === 'add',
                            }
                        };

                    } else {
                        finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType} "${itemNameForMessage}" ${validAction === 'add' ? 'to' : 'from'} your calendar. Please try again later.`;
                        logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} failed for conference ${itemId} - ${apiActionResult.errorMessage}`);
                        reportStep('calendar_update_failed', `Failed to update calendar for "${itemNameForMessage}".`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    }
                } else {
                    if (validAction === 'add') { // Already in calendar
                        finalMessage = `The ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) is already in your calendar.`;
                    } else { // action === 'remove', not in calendar
                        finalMessage = `The ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) is not currently in your calendar.`;
                    }
                    logToFile(`${logPrefix} ManageCalendar: No API call executed for action '${validAction}' on conference ${itemId}. Current status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}`);
                    reportStep('calendar_no_action_needed', finalMessage, { itemId, itemName: itemNameForMessage, currentStatus: isCurrentlyInCalendar, requestedAction: validAction });
                }
                return { modelResponseContent: finalMessage, frontendAction: finalFrontendAction, thoughts: localThoughts };
            } else {
                // This case should ideally not be reached due to prior validation
                const errorMsg = `Unsupported action for calendar: ${validAction}`;
                logToFile(`${logPrefix} ManageCalendar: Validation Error - ${errorMsg}`);
                reportStep('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageCalendarHandler: ${errorMessage}\nStack: ${errorStack}`);
            reportStep('function_error', `Critical error during calendar management processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}