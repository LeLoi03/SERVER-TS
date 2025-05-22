// src/chatbot/handlers/manageFollow.handler.ts
import {
    findItemId,
    executeGetUserFollowed,
    executeFollowUnfollowApi,
} from '../services/manageFollow.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    FollowItem,
    FrontendAction,
    ThoughtStep, // Added ThoughtStep for logging
    StatusUpdate
} from '../shared/types';
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
// Import blacklist status check from manageBlacklist.service
import { executeGetUserBlacklisted } from '../services/manageBlacklist.service';
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Valid item types supported by the follow feature.
 */
type ValidItemType = 'conference' | 'journal';
/**
 * Valid identifier types for finding a conference or journal item.
 */
type ValidIdentifierType = 'acronym' | 'title' | 'id';
/**
 * Valid actions for managing followed items.
 */
type ValidAction = 'follow' | 'unfollow' | 'list';

/**
 * Handles the 'manageFollow' function call from the LLM.
 * This handler allows users to follow, unfollow, or list conferences and journals.
 * It includes validation, authentication checks, item lookup, and cross-checks with
 * blacklisted conferences to prevent conflicts.
 */
export class ManageFollowHandler implements IFunctionHandler {
    /**
     * Executes the follow management logic.
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
        const logPrefix = `[${handlerProcessId} ${socketId} Handler:ManageFollow Agent:${agentId}]`;
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
            reportStep('validating_function_args', 'Validating manage follow arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const action = args?.action as string | undefined;
            const identifier = args?.identifier as string | undefined;
            const identifierType = args?.identifierType as string | undefined;

            // Basic validation
            if (!itemType || !action) {
                const errorMsg = "Missing required information (item type or action).";
                logToFile(`${logPrefix} ManageFollow: Validation Failed - ${errorMsg}`);
                reportStep('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }

            let validationError: string | null = null;
            if (!(['conference', 'journal'] as string[]).includes(itemType)) {
                validationError = `Invalid item type "${itemType}". Must be 'conference' or 'journal'.`;
            } else if (!(['follow', 'unfollow', 'list'] as string[]).includes(action)) {
                validationError = `Invalid action "${action}". Must be 'follow', 'unfollow', or 'list'.`;
            }

            if (action === 'follow' || action === 'unfollow') {
                if (!identifier || !identifierType) {
                    validationError = `Missing identifier or identifier type for '${action}' action.`;
                } else if (!(['acronym', 'title', 'id'] as string[]).includes(identifierType)) {
                    validationError = `Invalid identifier type "${identifierType}" for '${action}' action. Must be 'acronym', 'title', or 'id'.`;
                }
            }

            if (validationError) {
                logToFile(`${logPrefix} ManageFollow: Validation Failed - ${validationError}`);
                reportStep('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined, thoughts: localThoughts };
            }

            const validItemType = itemType as ValidItemType;
            const validAction = action as ValidAction;
            const validIdentifier = (action === 'follow' || action === 'unfollow') ? identifier! : undefined;
            const validIdentifierType = (action === 'follow' || action === 'unfollow') ? identifierType! as ValidIdentifierType : undefined;

            reportStep('checking_authentication', 'Checking authentication status...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} ManageFollow: User not authenticated.`);
                reportStep('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: `Error: You must be logged in to manage followed items.`, frontendAction: undefined, thoughts: localThoughts };
            }

            if (validAction === 'list') {
                reportStep('listing_followed_items', `Fetching followed ${validItemType}s...`);
                const listResult = await executeGetUserFollowed(validItemType, userToken);

                if (!listResult.success || !listResult.items) {
                    const errorMsg = listResult.errorMessage || `Failed to retrieve followed ${validItemType}s.`;
                    logToFile(`${logPrefix} ManageFollow: Error listing items - ${errorMsg}`);
                    reportStep('function_error', `Failed to list followed ${validItemType}s.`, { error: errorMsg });
                    return { modelResponseContent: `Sorry, I couldn't retrieve your followed ${validItemType}s: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
                }

                if (listResult.items.length === 0) {
                    const message = `You are not following any ${validItemType}s.`;
                    logToFile(`${logPrefix} ManageFollow: No followed ${validItemType}s found.`);
                    reportStep('list_success_empty', message);
                    return { modelResponseContent: message, frontendAction: undefined, thoughts: localThoughts };
                }

                const displayItemsForModelResponse = listResult.items.map((item: FollowItem) => {
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
                    return { id: item.id, displayText: details };
                });

                const successMessage = `Here are the ${validItemType}s you are following:`;
                logToFile(`${logPrefix} ManageFollow: Successfully listed ${listResult.items.length} followed ${validItemType}(s).`);
                reportStep('list_success', successMessage, { count: listResult.items.length });

                return {
                    modelResponseContent: `${successMessage}\n${displayItemsForModelResponse.map(item => `- ${item.displayText}`).join('\n')}`,
                    frontendAction: {
                        type: 'displayList',
                        payload: {
                            items: listResult.items,
                            itemType: validItemType,
                            listType: 'followed',
                            title: `Your Followed ${validItemType.charAt(0).toUpperCase() + validItemType.slice(1)}s`
                        }
                    },
                    thoughts: localThoughts
                };

            } else if (validAction === 'follow' || validAction === 'unfollow') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                reportStep('finding_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`, { identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                const idResult = await findItemId(currentIdentifier, currentIdentifierType, validItemType);

                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
                    logToFile(`${logPrefix} ManageFollow: Error finding ID - ${errorMsg}`);
                    reportStep('item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined, thoughts: localThoughts };
                }
                const itemId = idResult.itemId;
                const itemNameForMessage = idResult.details?.title || idResult.details?.acronym || currentIdentifier;

                reportStep('item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage, details: idResult.details });

                // Check current follow status
                reportStep('checking_follow_status', `Checking your follow status for item ${itemId} ("${itemNameForMessage}")...`, { itemId });
                const followStatusResult = await executeGetUserFollowed(validItemType, userToken);

                if (!followStatusResult.success) {
                    const errorMsg = followStatusResult.errorMessage || 'Failed to check follow status.';
                    logToFile(`${logPrefix} ManageFollow: Error checking status - ${errorMsg}`);
                    reportStep('function_error', 'Failed to check follow status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current follow status: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
                }
                const isCurrentlyFollowing = followStatusResult.itemIds.includes(itemId);
                reportStep('follow_status_checked', `Current follow status for "${itemNameForMessage}": ${isCurrentlyFollowing ? 'Following' : 'Not Following'}.`, { itemId, isCurrentlyFollowing, itemName: itemNameForMessage });

                // --- CROSS-CHECK WHEN 'FOLLOW' (ONLY APPLICABLE FOR CONFERENCES) ---
                if (validAction === 'follow' && validItemType === 'conference' && !isCurrentlyFollowing) {
                    // Only check blacklist if:
                    // 1. Action is 'follow'
                    // 2. Item is 'conference'
                    // 3. User is NOT already following this item (to avoid blocking if already followed)
                    reportStep('checking_blacklist_status_for_follow', `Checking if conference ${itemId} ("${itemNameForMessage}") is blacklisted before following...`);
                    const blacklistStatusResult = await executeGetUserBlacklisted(userToken); // This function is only for conferences

                    if (blacklistStatusResult.success && blacklistStatusResult.itemIds.includes(itemId)) {
                        const conflictMsg = `The conference "${itemNameForMessage}" is currently in your blacklist. You must remove it from the blacklist before following.`;
                        logToFile(`${logPrefix} ManageFollow: Conflict - Conference ${itemId} ("${itemNameForMessage}") is blacklisted, cannot follow.`);
                        reportStep('follow_conflict_blacklisted', conflictMsg, { itemId, itemName: itemNameForMessage });
                        return { modelResponseContent: conflictMsg, frontendAction: undefined, thoughts: localThoughts };
                    }
                    if (!blacklistStatusResult.success) {
                        logToFile(`${logPrefix} ManageFollow: Warning - Could not verify blacklist status for conference ${itemId} ("${itemNameForMessage}") before following: ${blacklistStatusResult.errorMessage}. Proceeding with follow action.`);
                        reportStep('warning_blacklist_check_failed_before_follow', `Could not verify if "${itemNameForMessage}" is blacklisted. Proceeding to follow.`, { itemId, itemName: itemNameForMessage, error: blacklistStatusResult.errorMessage });
                    } else {
                        logToFile(`${logPrefix} ManageFollow: Conference ${itemId} ("${itemNameForMessage}") is not blacklisted. Safe to proceed with follow.`);
                        reportStep('blacklist_check_clear_for_follow', `Conference "${itemNameForMessage}" is not blacklisted. Proceeding to follow.`, { itemId, itemName: itemNameForMessage });
                    }
                }
                // --- END CROSS-CHECK ---

                reportStep('determining_follow_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'follow' && !isCurrentlyFollowing) || (validAction === 'unfollow' && isCurrentlyFollowing);
                reportStep('follow_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId} ("${itemNameForMessage}").` : `No API call needed (action: '${validAction}', current status for "${itemNameForMessage}": ${isCurrentlyFollowing ? 'Following' : 'Not Following'}).`, { needsApiCall, currentStatus: isCurrentlyFollowing, requestedAction: validAction, itemId, itemName: itemNameForMessage });

                let finalMessage = "";
                let finalFrontendAction: FrontendAction = undefined;

                if (needsApiCall) {
                    reportStep('preparing_follow_api_call', `${validAction === 'follow' ? 'Following' : 'Unfollowing'} item "${itemNameForMessage}" (ID: ${itemId})...`, { action: validAction, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    const apiActionResult = await executeFollowUnfollowApi(itemId, validItemType, validAction as 'follow' | 'unfollow', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'follow' ? 'followed' : 'unfollowed'} the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}).`;
                        logToFile(`${logPrefix} ManageFollow: API call for ${validAction} successful for ${validItemType} ${itemId}.`);
                        reportStep('follow_update_success', `Successfully ${validAction}ed ${validItemType} "${itemNameForMessage}".`, { itemId, itemType: validItemType, itemName: itemNameForMessage, action: validAction });

                        const itemDetailsFromFind: Partial<FollowItem> = idResult.details || {};
                        const itemDataForFrontend: FollowItem = {
                            id: itemId,
                            title: itemDetailsFromFind.title || itemNameForMessage,
                            acronym: itemDetailsFromFind.acronym || '',
                            dates: itemDetailsFromFind.dates,
                            location: itemDetailsFromFind.location,
                            itemType: validItemType,
                        };

                        finalFrontendAction = {
                            type: 'itemFollowStatusUpdated',
                            payload: {
                                item: itemDataForFrontend,
                                itemType: validItemType,
                                followed: validAction === 'follow',
                            }
                        };
                    } else {
                        finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType} "${itemNameForMessage}". Please try again later.`;
                        logToFile(`${logPrefix} ManageFollow: API call for ${validAction} failed for ${validItemType} ${itemId} - ${apiActionResult.errorMessage}`);
                        reportStep('follow_update_failed', `Failed to ${validAction} ${validItemType} "${itemNameForMessage}".`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType, itemName: itemNameForMessage });
                    }
                } else {
                    if (validAction === 'follow') { // Already following
                        finalMessage = `You are already following the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}).`;
                    } else { // action === 'unfollow', not following
                        finalMessage = `You are not currently following the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}).`;
                    }
                    logToFile(`${logPrefix} ManageFollow: No API call executed for action '${validAction}' on ${validItemType} ${itemId}. Current status: ${isCurrentlyFollowing ? 'Following' : 'Not Following'}`);
                    reportStep('follow_no_action_needed', finalMessage, { itemId, itemName: itemNameForMessage, currentStatus: isCurrentlyFollowing, requestedAction: validAction });
                }
                return { modelResponseContent: finalMessage, frontendAction: finalFrontendAction, thoughts: localThoughts };
            } else {
                // This case should ideally not be reached due to prior validation
                const errorMsg = `Unsupported action: ${validAction}`;
                logToFile(`${logPrefix} ManageFollow: Validation Error - ${errorMsg}`);
                reportStep('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageFollowHandler: ${errorMessage}\nStack: ${errorStack}`);
            reportStep('function_error', `Critical error during follow management processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}