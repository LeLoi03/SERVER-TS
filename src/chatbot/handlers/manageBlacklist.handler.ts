// src/handlers/manageBlacklist.handler.ts
import {
    findConferenceItemId,
    executeGetUserBlacklisted,
    executeBlacklistUnblacklistApi,
} from '../services/manageBlacklist.service';
// Import hàm kiểm tra follow status từ manageFollow.service
import { executeGetUserFollowed } from '../services/manageFollow.service';
import { executeGetUserCalendar } from '../services/manageCalendar.service'; // THÊM IMPORT NÀY

import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, BlacklistItem, FrontendAction } from '../shared/types';
import logToFile from '../../utils/logger';

type ValidItemType = 'conference'; // Chỉ conference
type ValidIdentifierType = 'acronym' | 'title' | 'id';
type ValidAction = 'add' | 'remove' | 'list'; // add to blacklist, remove from blacklist, list blacklisted

export class ManageBlacklistHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, userToken, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: ManageBlacklist, Args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

        const sendStatus = (step: string, message: string, details?: object) => {
            if (onStatusUpdate) {
                onStatusUpdate('status_update', { type: 'status', step, message, details, timestamp: new Date().toISOString() });
            } else { logToFile(`${logPrefix} Warning: onStatusUpdate not provided for step: ${step}`); }
        };

        try {
            sendStatus('validating_function_args', 'Validating manage blacklist arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const action = args?.action as string | undefined;
            const identifier = args?.identifier as string | undefined;
            const identifierType = args?.identifierType as string | undefined;

            if (itemType !== 'conference') {
                const errorMsg = "Invalid item type for blacklist. Must be 'conference'.";
                logToFile(`${logPrefix} ManageBlacklist: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }
            if (!action) {
                const errorMsg = "Missing required action for blacklist.";
                logToFile(`${logPrefix} ManageBlacklist: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

            let validationError: string | null = null;
            if (!(['add', 'remove', 'list'] as string[]).includes(action)) {
                validationError = `Invalid action "${action}" for blacklist. Must be 'add', 'remove', or 'list'.`;
            }

            if (action === 'add' || action === 'remove') {
                if (!identifier || !identifierType) {
                    validationError = `Missing identifier or identifier type for blacklist '${action}' action.`;
                } else if (!(['acronym', 'title', 'id'] as string[]).includes(identifierType)) {
                    validationError = `Invalid identifier type "${identifierType}" for blacklist '${action}' action. Must be 'acronym', 'title', or 'id'.`;
                }
            }

            if (validationError) {
                logToFile(`${logPrefix} ManageBlacklist: Validation Failed - ${validationError}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }

            const validItemType = itemType as ValidItemType;
            const validAction = action as ValidAction;
            const validIdentifier = (action === 'add' || action === 'remove') ? identifier! : undefined;
            const validIdentifierType = (action === 'add' || action === 'remove') ? identifierType! as ValidIdentifierType : undefined;

            sendStatus('checking_authentication', 'Checking authentication status...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} ManageBlacklist: User not authenticated.`);
                sendStatus('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: `Error: You must be logged in to manage blacklisted items.`, frontendAction: undefined };
            }

            if (validAction === 'list') {
                sendStatus('listing_blacklisted_items', `Fetching blacklisted ${validItemType}s...`);
                const listResult = await executeGetUserBlacklisted(userToken);

                if (!listResult.success || !listResult.items) {
                    const errorMsg = listResult.errorMessage || `Failed to retrieve blacklisted ${validItemType}s.`;
                    logToFile(`${logPrefix} ManageBlacklist: Error listing items - ${errorMsg}`);
                    sendStatus('function_error', `Failed to list blacklisted ${validItemType}s.`, { error: errorMsg });
                    return { modelResponseContent: `Sorry, I couldn't retrieve your blacklisted ${validItemType}s: ${errorMsg}`, frontendAction: undefined };
                }

                if (listResult.items.length === 0) {
                    const message = `You have no ${validItemType}s in your blacklist.`;
                    logToFile(`${logPrefix} ManageBlacklist: No blacklisted ${validItemType}s found.`);
                    sendStatus('list_success_empty', message);
                    return { modelResponseContent: message, frontendAction: undefined };
                }

                const displayItemsForModelResponse = listResult.items.map((item: BlacklistItem) => {
                    let details = `${item.title} (${item.acronym})`;
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

                const successMessage = `Here are the ${validItemType}s in your blacklist:`;
                logToFile(`${logPrefix} ManageBlacklist: Successfully listed ${listResult.items.length} blacklisted ${validItemType}(s).`);
                sendStatus('list_success', successMessage, { count: listResult.items.length });

                return {
                    modelResponseContent: `${successMessage}\n${displayItemsForModelResponse.map(item => `- ${item.displayText}`).join('\n')}`,
                    frontendAction: {
                        type: 'displayList',
                        payload: {
                            items: listResult.items,
                            itemType: validItemType,
                            listType: 'blacklisted',
                            title: `Your Blacklisted ${validItemType.charAt(0).toUpperCase() + validItemType.slice(1)}s`
                        }
                    }
                };

            } else if (validAction === 'add' || validAction === 'remove') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                sendStatus('finding_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`);
                const idResult = await findConferenceItemId(currentIdentifier, currentIdentifierType);

                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
                    logToFile(`${logPrefix} ManageBlacklist: Error finding ID - ${errorMsg}`);
                    sendStatus('item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined };
                }
                const itemId = idResult.itemId;
                const itemNameForMessage = idResult.details?.title || idResult.details?.acronym || currentIdentifier;

                sendStatus('item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage, details: idResult.details });

                // Kiểm tra trạng thái blacklist hiện tại
                sendStatus('checking_blacklist_status', `Checking your blacklist status for conference ${itemId}...`);
                const blacklistStatusResult = await executeGetUserBlacklisted(userToken);
                if (!blacklistStatusResult.success) {
                    const errorMsg = blacklistStatusResult.errorMessage || 'Failed to check blacklist status.';
                    logToFile(`${logPrefix} ManageBlacklist: Error checking status - ${errorMsg}`);
                    sendStatus('function_error', 'Failed to check blacklist status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current blacklist status: ${errorMsg}`, frontendAction: undefined };
                }
                const isCurrentlyBlacklisted = blacklistStatusResult.itemIds.includes(itemId);
                sendStatus('blacklist_status_checked', `Current blacklist status: ${isCurrentlyBlacklisted ? 'Blacklisted' : 'Not Blacklisted'}.`, { itemId, isCurrentlyBlacklisted });

                // --- KIỂM TRA CHÉO KHI 'ADD' VÀO BLACKLIST ---
                if (validAction === 'add' && !isCurrentlyBlacklisted) {
                    let conflictMsg = "";

                    // 1. Kiểm tra Follow status
                    sendStatus('checking_follow_status_for_blacklist', `Checking if conference ${itemId} ("${itemNameForMessage}") is followed before blacklisting...`);
                    const followStatusResult = await executeGetUserFollowed('conference', userToken);
                    let isFollowed = false;
                    if (followStatusResult.success && followStatusResult.itemIds.includes(itemId)) {
                        isFollowed = true;
                        conflictMsg += `The conference "${itemNameForMessage}" is currently in your followed list. You must unfollow it. `;
                        logToFile(`${logPrefix} ManageBlacklist: Conflict - Item ${itemId} is followed.`);
                    } else if (!followStatusResult.success) {
                        logToFile(`${logPrefix} ManageBlacklist: Warning - Could not verify follow status for ${itemId}: ${followStatusResult.errorMessage}.`);
                        // Có thể quyết định dừng hoặc tiếp tục với cảnh báo
                    }

                    // 2. Kiểm tra Calendar status (CHỈ KHI KHÔNG CÓ LỖI NGHIÊM TRỌNG TỪ FOLLOW CHECK)
                    // (Nếu muốn kiểm tra độc lập, bỏ điều kiện này)
                    // if (followStatusResult.success) { // Hoặc không cần check này nếu muốn luôn kiểm tra calendar
                    sendStatus('checking_calendar_status_for_blacklist', `Checking if conference ${itemId} ("${itemNameForMessage}") is in your calendar before blacklisting...`);
                    const calendarStatusResult = await executeGetUserCalendar(userToken); // Dùng hàm đã import
                    let isInCalendar = false;
                    if (calendarStatusResult.success && calendarStatusResult.itemIds.includes(itemId)) {
                        isInCalendar = true;
                        conflictMsg += `The conference "${itemNameForMessage}" is currently in your calendar. You must remove it from calendar. `;
                        logToFile(`${logPrefix} ManageBlacklist: Conflict - Item ${itemId} is in calendar.`);
                    } else if (!calendarStatusResult.success) {
                        logToFile(`${logPrefix} ManageBlacklist: Warning - Could not verify calendar status for ${itemId}: ${calendarStatusResult.errorMessage}.`);
                        // Có thể quyết định dừng hoặc tiếp tục với cảnh báo
                    }
                    // }


                    if (isFollowed || isInCalendar) {
                        conflictMsg = conflictMsg.trim(); // Xóa khoảng trắng thừa
                        if (isFollowed && isInCalendar) {
                            conflictMsg = `The conference "${itemNameForMessage}" is currently in your followed list AND your calendar. You must unfollow it and remove it from calendar before adding to blacklist.`;
                        } else if (isFollowed) {
                            conflictMsg = `The conference "${itemNameForMessage}" is currently in your followed list. You must unfollow it before adding it to the blacklist.`;
                        } else { // Chỉ isInCalendar
                            conflictMsg = `The conference "${itemNameForMessage}" is currently in your calendar. You must remove it from calendar before adding it to the blacklist.`;
                        }

                        logToFile(`${logPrefix} ManageBlacklist: Conflict - Cannot add to blacklist due to existing status.`);
                        sendStatus('blacklist_conflict_existing_status', conflictMsg, { itemId, itemName: itemNameForMessage, isFollowed, isInCalendar });
                        return { modelResponseContent: conflictMsg, frontendAction: undefined };
                    }

                    // Nếu không có conflict, tiếp tục logic thêm vào blacklist
                    if (followStatusResult.success && calendarStatusResult.success) { // Chỉ log clear nếu cả 2 check thành công và không có conflict
                        logToFile(`${logPrefix} ManageBlacklist: Conference ${itemId} ("${itemNameForMessage}") is not followed and not in calendar. Safe to proceed with blacklisting.`);
                        sendStatus('follow_calendar_check_clear_for_blacklist', `Conference "${itemNameForMessage}" is clear. Proceeding to blacklist.`, { itemId, itemName: itemNameForMessage });
                    }
                }
                // --- KẾT THÚC KIỂM TRA CHÉO ---


                sendStatus('determining_blacklist_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'add' && !isCurrentlyBlacklisted) || (validAction === 'remove' && isCurrentlyBlacklisted);
                sendStatus('blacklist_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} for blacklist.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyBlacklisted ? 'Blacklisted' : 'Not Blacklisted'}).`, { needsApiCall, currentStatus: isCurrentlyBlacklisted, requestedAction: validAction, itemId });

                let finalMessage = "";
                let finalFrontendAction: FrontendAction = undefined;

                if (needsApiCall) {
                    sendStatus('preparing_blacklist_api_call', `${validAction === 'add' ? 'Adding to' : 'Removing from'} blacklist: conference "${itemNameForMessage}" (ID: ${itemId})...`, { action: validAction, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    const apiActionResult = await executeBlacklistUnblacklistApi(itemId, validAction as 'add' | 'remove', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'add' ? 'added' : 'removed'} the conference "${itemNameForMessage}" (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} your blacklist.`;
                        logToFile(`${logPrefix} ManageBlacklist: API call for ${validAction} successful for conference ${itemId}.`);
                        sendStatus('blacklist_update_success', `Successfully updated blacklist for conference "${itemNameForMessage}".`, { itemId, itemType: validItemType, itemName: itemNameForMessage, action: validAction });

                        const itemDetailsFromFind: Partial<BlacklistItem> = idResult.details || {};
                        const itemDataForFrontend: BlacklistItem = {
                            conferenceId: itemId,
                            title: itemDetailsFromFind.title || itemNameForMessage,
                            acronym: itemDetailsFromFind.acronym || '',
                            dates: itemDetailsFromFind.dates,
                            location: itemDetailsFromFind.location,
                        };

                        finalFrontendAction = {
                            type: 'itemBlacklistStatusUpdated',
                            payload: {
                                item: itemDataForFrontend,
                                itemType: validItemType, // 'conference'
                                blacklisted: validAction === 'add',
                            }
                        };
                    } else {
                        finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the conference "${itemNameForMessage}" ${validAction === 'add' ? 'to' : 'from'} blacklist. Please try again later.`;
                        logToFile(`${logPrefix} ManageBlacklist: API call for ${validAction} failed for conference ${itemId} - ${apiActionResult.errorMessage}`);
                        sendStatus('blacklist_update_failed', `Failed to update blacklist for "${itemNameForMessage}".`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    }
                } else {
                    if (validAction === 'add') { // Already blacklisted
                        finalMessage = `The conference "${itemNameForMessage}" (ID: ${itemId}) is already in your blacklist.`;
                    } else { // action === 'remove', not blacklisted
                        finalMessage = `The conference "${itemNameForMessage}" (ID: ${itemId}) is not currently in your blacklist.`;
                    }
                    logToFile(`${logPrefix} ManageBlacklist: No API call executed for action '${validAction}' on conference ${itemId}. Current status: ${isCurrentlyBlacklisted ? 'Blacklisted' : 'Not Blacklisted'}`);
                    sendStatus('blacklist_no_action_needed', finalMessage, { itemId, itemName: itemNameForMessage, currentStatus: isCurrentlyBlacklisted, requestedAction: validAction });
                }
                return { modelResponseContent: finalMessage, frontendAction: finalFrontendAction };
            } else {
                // This case should ideally not be reached due to prior validation
                const errorMsg = `Unsupported action for blacklist: ${validAction}`;
                logToFile(`${logPrefix} ManageBlacklist: Validation Error - ${errorMsg}`);
                sendStatus('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageBlacklistHandler: ${errorMessage}\nStack: ${error.stack}`);
            if (typeof sendStatus === 'function') {
                sendStatus('function_error', `Critical error during blacklist management processing: ${errorMessage}`);
            }
            return { modelResponseContent: `An unexpected error occurred: ${errorMessage}`, frontendAction: undefined };
        }
    }
}