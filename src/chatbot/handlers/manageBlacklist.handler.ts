// src/chatbot/handlers/manageBlacklist.handler.ts
import {
    findConferenceItemId,
    executeGetUserBlacklisted,
    executeBlacklistUnblacklistApi,
} from '../services/manageBlacklist.service';
// Import hàm kiểm tra follow status từ manageFollow.service
import { executeGetUserFollowed } from '../services/manageFollow.service';
import { executeGetUserCalendar } from '../services/manageCalendar.service'; // Added import for calendar check

import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    BlacklistItem,
    FrontendAction,
    ThoughtStep, // Added ThoughtStep for logging
    StatusUpdate
} from '../shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Valid item types supported by the blacklist feature.
 * Currently limited to 'conference'.
 */
type ValidItemType = 'conference';
/**
 * Valid identifier types for finding a conference item.
 */
type ValidIdentifierType = 'acronym' | 'title' | 'id';
/**
 * Valid actions for managing the blacklist.
 */
type ValidAction = 'add' | 'remove' | 'list';

/**
 * Handles the 'manageBlacklist' function call from the LLM.
 * This handler allows users to add, remove, or list conferences in their blacklist.
 * It includes validation, authentication checks, item lookup, and cross-checks with
 * followed and calendar items to prevent conflicts.
 */
export class ManageBlacklistHandler implements IFunctionHandler {
    /**
     * Executes the blacklist management logic.
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

        const localThoughts: ThoughtStep[] = []; // Collection for thoughts



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
        
            }
        };

        try {
            reportStep('validating_function_args', 'Validating manage blacklist arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const action = args?.action as string | undefined;
            const identifier = args?.identifier as string | undefined;
            const identifierType = args?.identifierType as string | undefined;

            if (itemType !== 'conference') {
                const errorMsg = "Invalid item type for blacklist. Must be 'conference'.";
        
                reportStep('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }
            if (!action) {
                const errorMsg = "Missing required action for blacklist.";
        
                reportStep('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
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
        
                reportStep('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined, thoughts: localThoughts };
            }

            const validItemType = itemType as ValidItemType;
            const validAction = action as ValidAction;
            const validIdentifier = (action === 'add' || action === 'remove') ? identifier! : undefined;
            const validIdentifierType = (action === 'add' || action === 'remove') ? identifierType! as ValidIdentifierType : undefined;

            reportStep('checking_authentication', 'Checking authentication status...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
        
                reportStep('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: `Error: You must be logged in to manage blacklisted items.`, frontendAction: undefined, thoughts: localThoughts };
            }

            if (validAction === 'list') {
                reportStep('listing_blacklisted_items', `Fetching blacklisted ${validItemType}s...`);
                const listResult = await executeGetUserBlacklisted(userToken);

                if (!listResult.success || !listResult.items) {
                    const errorMsg = listResult.errorMessage || `Failed to retrieve blacklisted ${validItemType}s.`;
            
                    reportStep('function_error', `Failed to list blacklisted ${validItemType}s.`, { error: errorMsg });
                    return { modelResponseContent: `Sorry, I couldn't retrieve your blacklisted ${validItemType}s: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
                }

                if (listResult.items.length === 0) {
                    const message = `You have no ${validItemType}s in your blacklist.`;
            
                    reportStep('list_success_empty', message);
                    return { modelResponseContent: message, frontendAction: undefined, thoughts: localThoughts };
                }

                 const displayItemsForModelResponse = listResult.items.map((item: BlacklistItem) => {
                    let details = `${item.title} (${item.acronym})`;

                    // Safely check if dates is an array and has at least one element
                    if (Array.isArray(item.dates) && item.dates.length > 0 && item.dates[0].fromDate) {
                        details += ` | Dates: ${new Date(item.dates[0].fromDate).toLocaleDateString()}`;
                        if (item.dates[0].toDate && item.dates[0].fromDate !== item.dates[0].toDate) {
                            details += ` - ${new Date(item.dates[0].toDate).toLocaleDateString()}`;
                        }
                    }
                    // Safely check location properties
                    if (item.location?.cityStateProvince && item.location?.country) {
                        details += ` | Location: ${item.location.cityStateProvince}, ${item.location.country}`;
                    } else if (item.location?.country) {
                        details += ` | Location: ${item.location.country}`;
                    }
                    return { id: item.conferenceId, displayText: details };
                });

                const successMessage = `Here are the ${validItemType}s in your blacklist:`;
        
                reportStep('list_success', successMessage, { count: listResult.items.length });

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
                    },
                    thoughts: localThoughts
                };

            } else if (validAction === 'add' || validAction === 'remove') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                reportStep('finding_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`, { identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                const idResult = await findConferenceItemId(currentIdentifier, currentIdentifierType);

                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
            
                    reportStep('item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined, thoughts: localThoughts };
                }
                const itemId = idResult.itemId;
                const itemNameForMessage = idResult.details?.title || idResult.details?.acronym || currentIdentifier;

                reportStep('item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage, details: idResult.details });

                // Check current blacklist status
                reportStep('checking_blacklist_status', `Checking your blacklist status for conference ${itemId}...`, { itemId });
                const blacklistStatusResult = await executeGetUserBlacklisted(userToken);
                if (!blacklistStatusResult.success) {
                    const errorMsg = blacklistStatusResult.errorMessage || 'Failed to check blacklist status.';
            
                    reportStep('function_error', 'Failed to check blacklist status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current blacklist status: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
                }
                const isCurrentlyBlacklisted = blacklistStatusResult.itemIds.includes(itemId);
                reportStep('blacklist_status_checked', `Current blacklist status: ${isCurrentlyBlacklisted ? 'Blacklisted' : 'Not Blacklisted'}.`, { itemId, isCurrentlyBlacklisted });

                // --- CROSS-CHECK WHEN 'ADD' TO BLACKLIST ---
                if (validAction === 'add' && !isCurrentlyBlacklisted) {
                    let conflictMsg = "";

                    // 1. Check Follow status
                    reportStep('checking_follow_status_for_blacklist', `Checking if conference ${itemId} ("${itemNameForMessage}") is followed before blacklisting...`);
                    const followStatusResult = await executeGetUserFollowed('conference', userToken);
                    let isFollowed = false;
                    if (followStatusResult.success && followStatusResult.itemIds.includes(itemId)) {
                        isFollowed = true;
                        conflictMsg += `The conference "${itemNameForMessage}" is currently in your followed list. You must unfollow it. `;
                
                    } else if (!followStatusResult.success) {
                
                        reportStep('warning_follow_check_failed', `Could not verify follow status for ${itemNameForMessage}.`, { itemId, errorMessage: followStatusResult.errorMessage });
                    }

                    // 2. Check Calendar status
                    reportStep('checking_calendar_status_for_blacklist', `Checking if conference ${itemId} ("${itemNameForMessage}") is in your calendar before blacklisting...`);
                    const calendarStatusResult = await executeGetUserCalendar(userToken);
                    let isInCalendar = false;
                    if (calendarStatusResult.success && calendarStatusResult.itemIds.includes(itemId)) {
                        isInCalendar = true;
                        conflictMsg += `The conference "${itemNameForMessage}" is currently in your calendar. You must remove it from calendar. `;
                
                    } else if (!calendarStatusResult.success) {
                
                        reportStep('warning_calendar_check_failed', `Could not verify calendar status for ${itemNameForMessage}.`, { itemId, errorMessage: calendarStatusResult.errorMessage });
                    }

                    if (isFollowed || isInCalendar) {
                        conflictMsg = conflictMsg.trim();
                        if (isFollowed && isInCalendar) {
                            conflictMsg = `The conference "${itemNameForMessage}" is currently in your followed list AND your calendar. You must unfollow it and remove it from calendar before adding to blacklist.`;
                        } else if (isFollowed) {
                            conflictMsg = `The conference "${itemNameForMessage}" is currently in your followed list. You must unfollow it before adding it to the blacklist.`;
                        } else { // Only isInCalendar
                            conflictMsg = `The conference "${itemNameForMessage}" is currently in your calendar. You must remove it from calendar before adding it to the blacklist.`;
                        }

                
                        reportStep('blacklist_conflict_existing_status', conflictMsg, { itemId, itemName: itemNameForMessage, isFollowed, isInCalendar });
                        return { modelResponseContent: conflictMsg, frontendAction: undefined, thoughts: localThoughts };
                    }

                    // Log clear if both checks are successful and no conflict
                    if (followStatusResult.success && calendarStatusResult.success) {
                
                        reportStep('follow_calendar_check_clear_for_blacklist', `Conference "${itemNameForMessage}" is clear. Proceeding to blacklist.`, { itemId, itemName: itemNameForMessage });
                    }
                }
                // --- END CROSS-CHECK ---


                reportStep('determining_blacklist_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'add' && !isCurrentlyBlacklisted) || (validAction === 'remove' && isCurrentlyBlacklisted);
                reportStep('blacklist_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} for blacklist.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyBlacklisted ? 'Blacklisted' : 'Not Blacklisted'}).`, { needsApiCall, currentStatus: isCurrentlyBlacklisted, requestedAction: validAction, itemId });

                let finalMessage = "";
                let finalFrontendAction: FrontendAction = undefined;

                if (needsApiCall) {
                    reportStep('preparing_blacklist_api_call', `${validAction === 'add' ? 'Adding to' : 'Removing from'} blacklist: conference "${itemNameForMessage}" (ID: ${itemId})...`, { action: validAction, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    const apiActionResult = await executeBlacklistUnblacklistApi(itemId, validAction as 'add' | 'remove', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'add' ? 'added' : 'removed'} the conference "${itemNameForMessage}" (ID: ${itemId}) ${validAction === 'add' ? 'to' : 'from'} your blacklist.`;
                
                        reportStep('blacklist_update_success', `Successfully updated blacklist for conference "${itemNameForMessage}".`, { itemId, itemType: validItemType, itemName: itemNameForMessage, action: validAction });

                        const itemDetailsFromFind: Partial<BlacklistItem> = idResult.details || {};
                        const itemDataForFrontend: BlacklistItem = {
                            conferenceId: itemId,
                            title: itemDetailsFromFind.title || itemNameForMessage,
                            acronym: itemDetailsFromFind.acronym || '',
                            // Provide default empty array if dates is undefined
                            dates: itemDetailsFromFind.dates || [{ fromDate: '', toDate: '' }],
                            // Provide default empty object if location is undefined
                            location: itemDetailsFromFind.location || { address: '', cityStateProvince: '', country: '', continent: '' }
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
                
                        reportStep('blacklist_update_failed', `Failed to update blacklist for "${itemNameForMessage}".`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    }
                } else {
                    if (validAction === 'add') { // Already blacklisted
                        finalMessage = `The conference "${itemNameForMessage}" (ID: ${itemId}) is already in your blacklist.`;
                    } else { // action === 'remove', not blacklisted
                        finalMessage = `The conference "${itemNameForMessage}" (ID: ${itemId}) is not currently in your blacklist.`;
                    }
            
                    reportStep('blacklist_no_action_needed', finalMessage, { itemId, itemName: itemNameForMessage, currentStatus: isCurrentlyBlacklisted, requestedAction: validAction });
                }
                return { modelResponseContent: finalMessage, frontendAction: finalFrontendAction, thoughts: localThoughts };
            } else {
                // This case should ideally not be reached due to prior validation
                const errorMsg = `Unsupported action for blacklist: ${validAction}`;
        
                reportStep('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
    
            reportStep('function_error', `Critical error during blacklist management processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return { modelResponseContent: `An unexpected error occurred: ${errorMessage}`, frontendAction: undefined, thoughts: localThoughts };
        }
    }
}