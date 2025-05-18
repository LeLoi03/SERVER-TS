// src/handlers/manageCalendar.handler.ts
import {
    findConferenceItemId, // Sử dụng hàm tìm kiếm ID từ manageBlacklist.service
    executeGetUserBlacklisted, // Import hàm kiểm tra blacklist từ manageBlacklist.service
} from '../services/manageBlacklist.service'; // Import từ service Blacklist
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
    BlacklistItem, // Import BlacklistItem để kiểm tra chéo
} from '../shared/types';
import logToFile from '../../utils/logger';

// --- Định nghĩa các kiểu dữ liệu hẹp hơn ---
type ValidItemTypeCalendar = 'conference'; // Chỉ conference
type ValidIdentifierTypeCalendar = 'acronym' | 'title' | 'id';
type ValidActionCalendar = 'add' | 'remove' | 'list';

export class ManageCalendarHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, userToken, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: ManageCalendar, Args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

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
            sendStatus('validating_calendar_args', 'Validating calendar management arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const action = args?.action as string | undefined;
            const identifier = args?.identifier as string | undefined; // Optional for 'list'
            const identifierType = args?.identifierType as string | undefined; // Optional for 'list'

            if (!itemType) {
                 const errorMsg = "Missing required item type for calendar action.";
                 logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${errorMsg}`);
                 sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                 return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }
            if (!action) {
                const errorMsg = "Missing required action for calendar action.";
                logToFile(`${logPrefix} ManageCalendar: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
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
                sendStatus('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }

            const validItemType = itemType as ValidItemTypeCalendar; // Always 'conference'
            const validAction = action as ValidActionCalendar;
            const validIdentifier = (action === 'add' || action === 'remove') ? identifier! : undefined;
            const validIdentifierType = (action === 'add' || action === 'remove') ? identifierType! as ValidIdentifierTypeCalendar : undefined;

            sendStatus('checking_authentication_calendar', 'Checking authentication status for calendar action...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} ManageCalendar: User not authenticated.`);
                sendStatus('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: "Error: You must be logged in to manage calendar items.", frontendAction: undefined };
            }


            // --- BRANCH LOGIC BASED ON ACTION ---
            if (validAction === 'list') {
                sendStatus('listing_calendar_items', `Fetching conferences in your calendar...`);
                const listResult = await executeGetUserCalendar(userToken);

                if (!listResult.success || !listResult.items) {
                    const errorMsg = listResult.errorMessage || `Failed to retrieve conferences from your calendar.`;
                    logToFile(`${logPrefix} ManageCalendar: Error listing items - ${errorMsg}`);
                    sendStatus('function_error', `Failed to list calendar conferences.`, { error: errorMsg });
                    return { modelResponseContent: `Sorry, I couldn't retrieve conferences from your calendar: ${errorMsg}`, frontendAction: undefined };
                }

                if (listResult.items.length === 0) {
                    const message = `You have no conferences in your calendar.`;
                    logToFile(`${logPrefix} ManageCalendar: No conferences found in calendar.`);
                    sendStatus('list_success_empty_calendar', message);
                    return { modelResponseContent: message, frontendAction: undefined };
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
                sendStatus('list_success_calendar', successMessage, { count: listResult.items.length });

                return {
                    modelResponseContent: `${successMessage}\n${displayItemsForModelResponse.map(item => `- ${item.displayText}`).join('\n')}`,
                    frontendAction: {
                        type: 'displayList',
                        payload: {
                            items: listResult.items, // Mảng các CalendarItem đầy đủ
                            itemType: validItemType, // 'conference'
                            listType: 'calendar',
                            title: `Your Calendar ${validItemType.charAt(0).toUpperCase() + validItemType.slice(1)}s`
                        }
                    }
                };

            } else if (validAction === 'add' || validAction === 'remove') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                sendStatus('finding_calendar_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`, { identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                // Sử dụng findConferenceItemId từ service blacklist
                const idResult = await findConferenceItemId(currentIdentifier, currentIdentifierType);


                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
                    logToFile(`${logPrefix} ManageCalendar: Error finding ID - ${errorMsg}`);
                    sendStatus('calendar_item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined };
                }
                const itemId = idResult.itemId;
                // idResult.details là Partial<BlacklistItem> hoặc Partial<CalendarItem> - dùng chung field
                const itemDetailsFromFind = idResult.details || {};
                const itemNameForMessage = itemDetailsFromFind.title || itemDetailsFromFind.acronym || currentIdentifier;

                sendStatus('calendar_item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage });

                // --- KIỂM TRA TRẠNG THÁI HIỆN TẠI TRONG CALENDAR ---
                sendStatus('checking_calendar_status', `Checking your calendar status for conference ${itemId}...`, { itemId });
                const calendarStatusResult = await executeGetUserCalendar(userToken);

                if (!calendarStatusResult.success) {
                    const errorMsg = calendarStatusResult.errorMessage || 'Failed to check calendar status.';
                    logToFile(`${logPrefix} ManageCalendar: Error checking status - ${errorMsg}`);
                    sendStatus('function_error', 'Failed to check calendar status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current calendar status: ${errorMsg}`, frontendAction: undefined };
                }
                const isCurrentlyInCalendar = calendarStatusResult.itemIds.includes(itemId);
                sendStatus('calendar_status_checked', `Current calendar status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}.`, { itemId, isCurrentlyInCalendar });

                // --- KIỂM TRA CHÉO KHI 'ADD' VÀO CALENDAR ---
                if (validAction === 'add' && !isCurrentlyInCalendar) { // Chỉ kiểm tra nếu định thêm mới và nó chưa có trong Calendar
                     sendStatus('checking_blacklist_status_for_calendar', `Checking if conference ${itemId} ("${itemNameForMessage}") is blacklisted before adding to calendar...`);
                     // itemType cho executeGetUserBlacklisted luôn là 'conference' vì blacklist chỉ cho conference
                     const blacklistStatusResult = await executeGetUserBlacklisted(userToken);
                     if (blacklistStatusResult.success && blacklistStatusResult.itemIds.includes(itemId)) {
                         const conflictMsg = `The conference "${itemNameForMessage}" is currently in your blacklist. You must remove it from blacklist before adding it to calendar.`;
                         logToFile(`${logPrefix} ManageCalendar: Conflict - Item ${itemId} is blacklisted, cannot add to calendar.`);
                         sendStatus('calendar_conflict_blacklisted', conflictMsg, { itemId, itemName: itemNameForMessage });
                         return { modelResponseContent: conflictMsg, frontendAction: undefined };
                     }
                     if (!blacklistStatusResult.success) {
                          logToFile(`${logPrefix} ManageCalendar: Warning - Could not verify blacklist status for ${itemId} ("${itemNameForMessage}") before adding to calendar: ${blacklistStatusResult.errorMessage}. Proceeding with calendar action.`);
                          sendStatus('warning_blacklist_check_failed_before_calendar', `Could not verify if "${itemNameForMessage}" is blacklisted. Proceeding to add to calendar.`, { itemId, itemName: itemNameForMessage, error: blacklistStatusResult.errorMessage });
                     } else {
                         logToFile(`${logPrefix} ManageCalendar: Conference ${itemId} ("${itemNameForMessage}") is not blacklisted. Safe to proceed with adding to calendar.`);
                         sendStatus('blacklist_check_clear_for_calendar', `Conference "${itemNameForMessage}" is not blacklisted. Proceeding to add to calendar.`, { itemId, itemName: itemNameForMessage });
                     }
                 }
                 // --- KẾT THÚC KIỂM TRA CHÉO ---


                sendStatus('determining_calendar_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'add' && !isCurrentlyInCalendar) || (validAction === 'remove' && isCurrentlyInCalendar);
                sendStatus('calendar_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} to/from calendar.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}).`, { needsApiCall, currentStatus: isCurrentlyInCalendar, requestedAction: validAction, itemId });

                let finalMessage = "";
                let finalFrontendAction: FrontendAction = undefined;

                if (needsApiCall) {
                    sendStatus('preparing_calendar_api_call', `${validAction === 'add' ? 'Adding' : 'Removing'} item ${itemNameForMessage} (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} calendar...`, { action: validAction, itemId, itemType: validItemType });
                    const apiActionResult = await executeManageCalendarApi(itemId, validAction as 'add' | 'remove', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'add' ? 'added' : 'removed'} the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} your calendar.`;
                        logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} successful for conference ${itemId}.`);
                        sendStatus('calendar_update_success', `Successfully updated calendar for conference "${itemNameForMessage}".`, { itemId, itemType: validItemType, itemName: itemNameForMessage, action: validAction });

                        // Sử dụng details từ idResult hoặc apiActionResult.conferenceDetails nếu có
                        const itemDetailsForFrontend: Partial<CalendarItem> = apiActionResult.conferenceDetails || itemDetailsFromFind;

                        const itemDataForFrontend: CalendarItem = {
                             conferenceId: itemId,
                             conference: itemDetailsForFrontend.conference || itemNameForMessage,
                             acronym: itemDetailsForFrontend.acronym || '',
                        };


                        finalFrontendAction = {
                            type: 'itemCalendarStatusUpdated', // Tên mới cho phù hợp Calendar
                            payload: {
                                item: itemDataForFrontend,
                                itemType: validItemType, // 'conference'
                                calendar: validAction === 'add',
                            }
                        };

                    } else {
                        finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType} "${itemNameForMessage}" ${validAction === 'add' ? 'to' : 'from'} your calendar. Please try again later.`;
                        logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} failed for conference ${itemId} - ${apiActionResult.errorMessage}`);
                        sendStatus('calendar_update_failed', `Failed to update calendar for "${itemNameForMessage}".`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    }
                } else {
                    if (validAction === 'add') { // Already in calendar
                        finalMessage = `The ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) is already in your calendar.`;
                    } else { // action === 'remove', not in calendar
                        finalMessage = `The ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) is not currently in your calendar.`;
                    }
                    logToFile(`${logPrefix} ManageCalendar: No API call executed for action '${validAction}' on conference ${itemId}. Current status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}`);
                    sendStatus('calendar_no_action_needed', finalMessage, { itemId, itemName: itemNameForMessage, currentStatus: isCurrentlyInCalendar, requestedAction: validAction });
                }
                return { modelResponseContent: finalMessage, frontendAction: finalFrontendAction };
            } else {
                // This case should ideally not be reached due to prior validation
                const errorMsg = `Unsupported action for calendar: ${validAction}`;
                logToFile(`${logPrefix} ManageCalendar: Validation Error - ${errorMsg}`);
                sendStatus('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageCalendarHandler: ${errorMessage}\nStack: ${error.stack}`);
             if (typeof sendStatus === 'function') {
                sendStatus('function_error', `Critical error during calendar management processing: ${errorMessage}`);
            }
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}