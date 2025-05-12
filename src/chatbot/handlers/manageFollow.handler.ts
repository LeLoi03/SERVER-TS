// src/handlers/manageFollow.handler.ts
import {
    findItemId,
    executeGetUserFollowed,
    executeFollowUnfollowApi,
} from '../services/manageFollow.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types';
import logToFile from '../../utils/logger';

// --- Định nghĩa các kiểu dữ liệu hẹp hơn để code rõ ràng hơn ---
type ValidItemType = 'conference' | 'journal';
type ValidIdentifierType = 'acronym' | 'title' | 'id';
type ValidAction = 'follow' | 'unfollow';

export class ManageFollowHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, userToken, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: FollowUnfollowItem, Args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

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
            sendStatus('validating_function_args', 'Validating follow/unfollow arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const identifier = args?.identifier as string | undefined;
            const identifierType = args?.identifierType as string | undefined;
            const action = args?.action as string | undefined;

            // a) Check for missing arguments (Guard Clause 1)
            if (!itemType || !identifier || !identifierType || !action) {
                const errorMsg = "Missing required information (item type, identifier, identifier type, or action).";
                logToFile(`${logPrefix} FollowUnfollow: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

            // b) Check for invalid argument values (Guard Clause 2)
            let validationError: string | null = null;
            if (!(['conference', 'journal'] as string[]).includes(itemType)) {
                validationError = `Invalid item type "${itemType}". Must be 'conference' or 'journal'.`;
            } else if (!(['acronym', 'title', 'id'] as string[]).includes(identifierType)) {
                validationError = `Invalid identifier type "${identifierType}". Must be 'acronym', 'title', or 'id'.`;
            } else if (!(['follow', 'unfollow'] as string[]).includes(action)) {
                validationError = `Invalid action "${action}". Must be 'follow' or 'unfollow'.`;
            }

            if (validationError) {
                logToFile(`${logPrefix} FollowUnfollow: Validation Failed - ${validationError}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }

            // --- Types are now narrowed ---
            const validItemType = itemType as ValidItemType;
            const validIdentifier = identifier; // Already known as string
            const validIdentifierType = identifierType as ValidIdentifierType;
            const validAction = action as ValidAction;

            // --- 2. Authentication Check (Guard Clause 3) ---
            sendStatus('checking_authentication', 'Checking authentication status...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} FollowUnfollow: User not authenticated.`);
                sendStatus('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: "Error: You must be logged in to follow or unfollow items.", frontendAction: undefined };
            }
            // sendStatus('authentication_success', 'User authenticated.'); // Optional success status

            // --- 3. Find Item ID ---
            sendStatus('finding_item_id', `Searching for ${validItemType} with ${validIdentifierType}: "${validIdentifier}"...`, { identifier: validIdentifier, identifierType: validIdentifierType, itemType: validItemType });
            const idResult = await findItemId(validIdentifier, validIdentifierType, validItemType);

            // Guard Clause 4
            if (!idResult.success || !idResult.itemId) {
                const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${validIdentifier}".`;
                logToFile(`${logPrefix} FollowUnfollow: Error finding ID - ${errorMsg}`);
                sendStatus('item_id_not_found', `Could not find ${validItemType} "${validIdentifier}".`, { error: errorMsg, identifier: validIdentifier, identifierType: validIdentifierType, itemType: validItemType });
                return { modelResponseContent: errorMsg, frontendAction: undefined };
            }
            const itemId = idResult.itemId;
            sendStatus('item_id_found', `Found ${validItemType} (ID: ${itemId}).`, { itemId, itemType: validItemType });

            // --- 4. Check Current Follow Status ---
            sendStatus('checking_follow_status', `Checking your follow status for item ${itemId}...`, { itemId });
            const followStatusResult = await executeGetUserFollowed(validItemType, userToken);

            // Guard Clause 5
            if (!followStatusResult.success) {
                const errorMsg = followStatusResult.errorMessage || 'Failed to check follow status.';
                logToFile(`${logPrefix} FollowUnfollow: Error checking status - ${errorMsg}`);
                sendStatus('function_error', 'Failed to check follow status.', { error: errorMsg, itemId });
                return { modelResponseContent: `Sorry, I couldn't check your current follow status: ${errorMsg}`, frontendAction: undefined };
            }
            const isCurrentlyFollowing = followStatusResult.itemIds.includes(itemId);
            sendStatus('follow_status_checked', `Current follow status: ${isCurrentlyFollowing ? 'Following' : 'Not Following'}.`, { itemId, isCurrentlyFollowing });

            // --- 5. Determine if API Call is Needed ---
            sendStatus('determining_follow_action', `Determining required action based on request ('${validAction}') and status...`);
            const needsApiCall = (validAction === 'follow' && !isCurrentlyFollowing) || (validAction === 'unfollow' && isCurrentlyFollowing);
            sendStatus('follow_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId}.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyFollowing}).`, { needsApiCall, currentStatus: isCurrentlyFollowing, requestedAction: validAction });

            // --- 6. Execute API Call or Return Status Message ---
            let finalMessage = "";
            if (needsApiCall) {
                sendStatus('preparing_follow_api_call', `${validAction === 'follow' ? 'Following' : 'Unfollowing'} item ${itemId}...`, { action: validAction, itemId, itemType: validItemType });
                const apiActionResult = await executeFollowUnfollowApi(itemId, validItemType, validAction, userToken);

                if (apiActionResult.success) {
                    finalMessage = `Successfully ${validAction === 'follow' ? 'followed' : 'unfollowed'} the ${validItemType} "${validIdentifier}" (ID: ${itemId}).`;
                    logToFile(`${logPrefix} FollowUnfollow: API call for ${validAction} successful.`);
                    sendStatus('follow_update_success', `Successfully ${validAction}ed ${validItemType}.`, { itemId, itemType: validItemType });
                } else {
                    finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType}: "${validIdentifier}". Please try again later.`;
                    logToFile(`${logPrefix} FollowUnfollow: API call for ${validAction} failed - ${apiActionResult.errorMessage}`);
                    sendStatus('follow_update_failed', `Failed to ${validAction} ${validItemType}.`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType });
                }
            } else {
                // Build message based on why no call was needed
                if (validAction === 'follow' /* && isCurrentlyFollowing */) {
                    finalMessage = `You are already following the ${validItemType} "${validIdentifier}" (ID: ${itemId}).`;
                } else { // action === 'unfollow' && !isCurrentlyFollowing
                    finalMessage = `You are not currently following the ${validItemType} "${validIdentifier}" (ID: ${itemId}).`;
                }
                logToFile(`${logPrefix} FollowUnfollow: No API call executed for action '${validAction}'. Current status: ${isCurrentlyFollowing}`);
                // Optional: Send a status update indicating no action was taken
                // sendStatus('no_action_needed', finalMessage, { itemId, action: validAction, isCurrentlyFollowing });
            }

            // --- Return Final Result ---
            return {
                modelResponseContent: finalMessage,
                frontendAction: undefined // No direct UI action needed from backend
            };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in FollowUnfollowItemHandler: ${errorMessage}\nStack: ${error.stack}`);
            // Use optional chaining for sendStatus in catch, just in case error happens very early
            sendStatus?.('function_error', `Critical error during follow/unfollow processing: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}