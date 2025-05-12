// src/handlers/manageCalendar.handler.ts
import {
    findItemId,
    executeGetUserCalendar,
    executeManageCalendarApi,
} from '../services/manageCalendar.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    CalendarItem, // Import CalendarItem
    AddToCalendarPayload, // Import để sử dụng type cho conferenceDetails
    FollowItem, // Import FollowItem vì findItemId có thể trả về details kiểu Partial<FollowItem>
} from '../shared/types';
import logToFile from '../../utils/logger';

// --- Định nghĩa các kiểu dữ liệu hẹp hơn ---
type ValidItemTypeCalendar = 'conference';
type ValidIdentifierTypeCalendar = 'acronym' | 'title' | 'id';
type ValidActionCalendar = 'add' | 'remove' | 'list'; // Added 'list'

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

            if (!itemType || !action) {
                const errorMsg = "Missing required information (item type or action).";
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
                    validationError = `Missing identifier or identifier type for '${action}' action.`;
                } else if (!(['acronym', 'title', 'id'] as string[]).includes(identifierType)) {
                    validationError = `Invalid identifier type "${identifierType}" for '${action}' action. Must be 'acronym', 'title', or 'id'.`;
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
                            itemType: 'conference',
                            listType: 'calendar',
                            title: 'Your Calendar Conferences'
                        }
                    }
                };

            } else if (validAction === 'add' || validAction === 'remove') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                sendStatus('finding_calendar_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`, { identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                const idResult = await findItemId(currentIdentifier, currentIdentifierType, 'conference');

                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
                    logToFile(`${logPrefix} ManageCalendar: Error finding ID - ${errorMsg}`);
                    sendStatus('calendar_item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined };
                }
                const itemId = idResult.itemId;
                // idResult.details có thể là Partial<FollowItem> hoặc Partial<CalendarItem>
                // Chúng ta cần các trường chung như title, acronym, dates, location
                const itemDetailsFromFind: Partial<CalendarItem> = idResult.details || {};
                const itemNameForMessage = itemDetailsFromFind.conference || itemDetailsFromFind.acronym || currentIdentifier;

                sendStatus('calendar_item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage });

                sendStatus('checking_calendar_status', `Checking your calendar status for item ${itemId}...`, { itemId });
                const calendarStatusResult = await executeGetUserCalendar(userToken);

                if (!calendarStatusResult.success) {
                    const errorMsg = calendarStatusResult.errorMessage || 'Failed to check calendar status.';
                    logToFile(`${logPrefix} ManageCalendar: Error checking status - ${errorMsg}`);
                    sendStatus('function_error', 'Failed to check calendar status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current calendar status: ${errorMsg}`, frontendAction: undefined };
                }
                const isCurrentlyInCalendar = calendarStatusResult.itemIds.includes(itemId);
                sendStatus('calendar_status_checked', `Current calendar status: ${isCurrentlyInCalendar ? 'In Calendar' : 'Not In Calendar'}.`, { itemId, isCurrentlyInCalendar });

                sendStatus('determining_calendar_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'add' && !isCurrentlyInCalendar) || (validAction === 'remove' && isCurrentlyInCalendar);
                sendStatus('calendar_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} to/from calendar.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyInCalendar}).`, { needsApiCall, currentStatus: isCurrentlyInCalendar, requestedAction: validAction });

                let finalMessage = "";
                let frontendActionToTake: FunctionHandlerOutput['frontendAction'] = undefined;

                if (needsApiCall) {
                    sendStatus('preparing_calendar_api_call', `${validAction === 'add' ? 'Adding' : 'Removing'} item ${itemNameForMessage} (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} calendar...`, { action: validAction, itemId, itemType: validItemType });
                    const apiActionResult = await executeManageCalendarApi(itemId, validAction as 'add' | 'remove', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'add' ? 'added' : 'removed'} the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} your calendar.`;
                        logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} successful.`);
                        sendStatus('calendar_update_success', `Successfully ${validAction}ed ${validItemType} ${validAction === 'add' ? 'to' : 'from'} calendar.`, { itemId, itemType: validItemType });

                        if (validAction === 'add') {
                            // Ưu tiên conferenceDetails từ API 'add' nếu có, nếu không thì từ findItemId
                            const detailsForCalendarEvent = apiActionResult.conferenceDetails || itemDetailsFromFind;

                            if (!detailsForCalendarEvent.conference || !detailsForCalendarEvent.dates?.fromDate || !detailsForCalendarEvent.dates?.toDate) {
                                logToFile(`${logPrefix} ManageCalendar: Insufficient details to create calendar event for ${itemId}. Title or dates missing.`);
                                // Vẫn thông báo thành công cho người dùng, nhưng không gửi frontendAction 'addToCalendar'
                                // Hoặc gửi với thông tin tối thiểu và để frontend xử lý
                                frontendActionToTake = undefined; // Hoặc một thông báo lỗi cụ thể hơn
                                finalMessage += " However, I couldn't gather all details to automatically add it to your external calendar application.";
                            } else {
                                const conferenceDetailsPayload: AddToCalendarPayload['conferenceDetails'] = {
                                    id: itemId,
                                    title: detailsForCalendarEvent.conference!, // Đã kiểm tra ở trên
                                    // acronym: detailsForCalendarEvent.acronym,
                                    // startDate: detailsForCalendarEvent.dates!.fromDate, // Đã kiểm tra ở trên
                                    // endDate: detailsForCalendarEvent.dates!.toDate,     // Đã kiểm tra ở trên
                                    // location: detailsForCalendarEvent.location?.address ||
                                    //           (detailsForCalendarEvent.location?.cityStateProvince && detailsForCalendarEvent.location?.country
                                    //               ? `${detailsForCalendarEvent.location.cityStateProvince}, ${detailsForCalendarEvent.location.country}`
                                    //               : detailsForCalendarEvent.location?.country),
                                    // description: (detailsForCalendarEvent as any).summary || `Details for ${detailsForCalendarEvent.conference}`, // Giả sử có summary
                                    // url: (detailsForCalendarEvent as any).websiteUrl, // Giả sử có websiteUrl
                                };
                                frontendActionToTake = {
                                    type: 'addToCalendar',
                                    payload: {
                                        conferenceId: itemId,
                                        conferenceDetails: conferenceDetailsPayload
                                    }
                                };
                            }
                        } else { // remove
                            frontendActionToTake = {
                                type: 'removeFromCalendar',
                                payload: { conferenceId: itemId }
                            };
                        }
                    } else {
                        finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType} "${itemNameForMessage}" ${validAction === 'add' ? 'to' : 'from'} your calendar. Please try again later.`;
                        logToFile(`${logPrefix} ManageCalendar: API call for ${validAction} failed - ${apiActionResult.errorMessage}`);
                        sendStatus('calendar_update_failed', `Failed to ${validAction} ${validItemType} ${validAction === 'add' ? 'to' : 'from'} calendar.`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType });
                    }
                } else {
                    if (validAction === 'add') {
                        finalMessage = `The ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) is already in your calendar.`;
                    } else {
                        finalMessage = `The ${validItemType} "${itemNameForMessage}" (ID: ${itemId}) is not in your calendar, so it cannot be removed.`;
                    }
                    logToFile(`${logPrefix} ManageCalendar: No API call executed for action '${validAction}'. Current status: ${isCurrentlyInCalendar}`);
                }
                return { modelResponseContent: finalMessage, frontendAction: frontendActionToTake };

            } else {
                const errorMsg = `Unsupported action: ${validAction}`;
                logToFile(`${logPrefix} ManageCalendar: Validation Error - ${errorMsg}`);
                sendStatus('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageCalendarHandler: ${errorMessage}\nStack: ${error.stack}`);
            sendStatus?.('function_error', `Critical error during calendar management processing: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}