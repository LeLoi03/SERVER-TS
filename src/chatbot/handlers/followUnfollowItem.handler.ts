// src/chatbot/handlers/followUnfollowItem.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput } from '../shared/types';
import { findItemId, executeFollowUnfollowApi, executeGetUserFollowedItems } from '../services/followUnfollowItem.service';
import logToFile from '../utils/logger';

export class FollowUnfollowItemHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, userToken, handlerId, socketId, socket } = context;
        const itemType = args?.itemType as ('conference' | 'journal' | undefined);
        const identifier = args?.identifier as (string | undefined);
        const identifierType = args?.identifierType as ('acronym' | 'title' | 'id' | undefined);
        const action = args?.action as ('follow' | 'unfollow' | undefined);

        logToFile(`[${handlerId} ${socketId}] Handler: FollowUnfollowItem, Args: ${JSON.stringify(args)} Auth: ${!!userToken}`);

        const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
            if (!socket.connected) return false;
            try {
                socket.emit('status_update', { type: 'status', step, message, details });
                return true;
            } catch (error: any) { return false; }
        };

        // --- Input Validation ---
        safeEmitStatus('validating_function_args', 'Validating follow/unfollow arguments...', { args }); // Emit validation step

        if (!itemType || !identifier || !identifierType || !action) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Missing required arguments.`);
            // Emit failure *related* to validation
            safeEmitStatus('function_error', 'Invalid arguments provided for follow/unfollow.', { args });
            return { modelResponseContent: "Error: Invalid or missing information...", frontendAction: undefined };
        }

        if (!['conference', 'journal'].includes(itemType)) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Invalid itemType: ${itemType}`);
            return { modelResponseContent: `Error: Invalid item type "${itemType}". Can only follow/unfollow 'conference' or 'journal'.`, frontendAction: undefined };
        }
        if (!['acronym', 'title', 'id'].includes(identifierType)) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Invalid identifierType: ${identifierType}`);
            return { modelResponseContent: `Error: Invalid identifier type "${identifierType}". Must be 'acronym', 'title', or 'id'.`, frontendAction: undefined };
        }
        if (!['follow', 'unfollow'].includes(action)) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Invalid action: ${action}`);
            return { modelResponseContent: `Error: Invalid action "${action}". Must be 'follow' or 'unfollow'.`, frontendAction: undefined };
        }

        // --- Authentication Check ---
        safeEmitStatus('checking_authentication', 'Checking authentication status...'); // Step for auth check
        if (!userToken) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: User not authenticated.`);
            safeEmitStatus('function_error', 'User not authenticated.'); // Error step specific to auth
            return { modelResponseContent: "Error: You must be logged in...", frontendAction: undefined };
        }
        // Can add a success emit if needed: safeEmitStatus('authentication_success', 'User authenticated.');

        safeEmitStatus('processing_request', `Processing ${action} request for ${itemType}: "${identifier}"...`); // Keep generic processing

        // --- Step 1: Find the Item ID ---
        safeEmitStatus('finding_item_id', `Searching for ${itemType} with ${identifierType}: "${identifier}"...`, { identifier, identifierType, itemType });
        const idResult = await findItemId(identifier, identifierType, itemType);
        if (!idResult.success || !idResult.itemId) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Error finding item ID: ${idResult.errorMessage}`);
            safeEmitStatus('item_id_not_found', `Could not find ${itemType} "${identifier}".`, { error: idResult.errorMessage }); // Specific step
            return { modelResponseContent: idResult.errorMessage || `Sorry, I couldn't find...`, frontendAction: undefined };
        }
        const itemId = idResult.itemId;
        safeEmitStatus('item_id_found', `Found ${itemType} (ID: ${itemId}).`, { itemId }); // Specific step

        // --- Step 2: Check Current Follow Status ---
        safeEmitStatus('checking_follow_status', `Checking your follow status for item ${itemId}...`, { itemId });
        const followStatusResult = await executeGetUserFollowedItems(itemType, userToken);
        if (!followStatusResult.success) {
            logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Error checking follow status: ${followStatusResult.errorMessage}`);
            safeEmitStatus('function_error', 'Failed to check follow status.', { error: followStatusResult.errorMessage }); // Use generic error or specific one
            return { modelResponseContent: followStatusResult.errorMessage || `Sorry...`, frontendAction: undefined };
        }
        const isCurrentlyFollowing = followStatusResult.itemIds.includes(itemId);
        safeEmitStatus('follow_status_checked', `Current follow status: ${isCurrentlyFollowing ? 'Following' : 'Not Following'}.`, { itemId, isCurrentlyFollowing }); // Specific step

        // --- Step 3: Determine Action and Execute if Needed ---
        safeEmitStatus('determining_follow_action', `Determining required action based on request ('${action}') and status...`);
        let finalMessage = "";
        let needsApiCall = false;
        if (action === 'follow') {
            if (isCurrentlyFollowing) {
                finalMessage = `You are already following the ${itemType} "${identifier}" (ID: ${itemId}).`;
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Action 'follow' requested, but user already following.`);
            } else {
                finalMessage = `Okay, attempting to follow the ${itemType} "${identifier}" (ID: ${itemId})...`; // Placeholder
                needsApiCall = true;
            }
        } else { // action === 'unfollow'
            if (!isCurrentlyFollowing) {
                finalMessage = `You are not currently following the ${itemType} "${identifier}" (ID: ${itemId}).`;
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Action 'unfollow' requested, but user not following.`);
            } else {
                finalMessage = `Okay, attempting to unfollow the ${itemType} "${identifier}" (ID: ${itemId})...`; // Placeholder
                needsApiCall = true;
            }
        }
        if (needsApiCall) {
            safeEmitStatus('follow_action_determined', `API call required to ${action} item ${itemId}.`); // Step confirming API call needed
        } else {
            safeEmitStatus('follow_action_determined', `No API call needed (action: '${action}', status: ${isCurrentlyFollowing}).`); // Step confirming no API call needed
            // You might want to emit a specific 'already_following' or 'not_following' step here too
        }


        // --- Step 4: Call Follow/Unfollow API if necessary ---
        if (needsApiCall) {
            safeEmitStatus('preparing_follow_api_call', `${action === 'follow' ? 'Following' : 'Unfollowing'} item ${itemId}...`, { action, itemId, itemType }); // Step before API call
            const apiActionResult = await executeFollowUnfollowApi(itemId, itemType, action, userToken);
            // safeEmitStatus('executing_follow_api_call', `Executing API call...`); // Could add if call is long

            if (apiActionResult.success) {
                finalMessage = `Successfully ${action === 'follow' ? 'followed' : 'unfollowed'}...`;
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: API call for ${action} successful.`);
                safeEmitStatus('follow_update_success', `Successfully ${action}ed ${itemType}.`, { itemId }); // Specific success
            } else {
                finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error...`;
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: API call for ${action} failed: ${apiActionResult.errorMessage}`);
                safeEmitStatus('follow_update_failed', `Failed to ${action} ${itemType}.`, { error: apiActionResult.errorMessage, itemId }); // Specific failure
            }
        } else {
            // Set finalMessage based on the pre-determined outcome if no API call was needed
            if (action === 'follow' && isCurrentlyFollowing) finalMessage = `You are already following...`;
            // etc.
        }


        return {
            modelResponseContent: finalMessage,
            frontendAction: undefined
        };
    }
}