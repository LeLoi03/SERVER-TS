// src/handlers/manageFollow.handler.ts
import {
    findItemId,
    executeGetUserFollowed,
    executeFollowUnfollowApi,
} from '../services/manageFollow.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, FollowItem } from '../shared/types'; // Import FollowItem
import logToFile from '../../utils/logger';

// --- Định nghĩa các kiểu dữ liệu hẹp hơn để code rõ ràng hơn ---
type ValidItemType = 'conference' | 'journal';
type ValidIdentifierType = 'acronym' | 'title' | 'id';
type ValidAction = 'follow' | 'unfollow' | 'list';

export class ManageFollowHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, userToken, handlerId, socketId, onStatusUpdate } = context;
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: ManageFollow, Args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

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
            sendStatus('validating_function_args', 'Validating manage follow arguments...', { args });

            const itemType = args?.itemType as string | undefined;
            const action = args?.action as string | undefined;
            const identifier = args?.identifier as string | undefined;
            const identifierType = args?.identifierType as string | undefined;

            if (!itemType || !action) {
                const errorMsg = "Missing required information (item type or action).";
                logToFile(`${logPrefix} ManageFollow: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments provided.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
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
                sendStatus('function_error', 'Invalid arguments provided.', { error: validationError, args });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }

            const validItemType = itemType as ValidItemType;
            const validAction = action as ValidAction;
            const validIdentifier = (action === 'follow' || action === 'unfollow') ? identifier! : undefined;
            const validIdentifierType = (action === 'follow' || action === 'unfollow') ? identifierType! as ValidIdentifierType : undefined;

            sendStatus('checking_authentication', 'Checking authentication status...');
            if (!userToken) {
                const errorMsg = "Authentication required.";
                logToFile(`${logPrefix} ManageFollow: User not authenticated.`);
                sendStatus('function_error', 'User not authenticated.', { error: errorMsg });
                return { modelResponseContent: `Error: You must be logged in to manage followed items.`, frontendAction: undefined };
            }

            if (validAction === 'list') {
                sendStatus('listing_followed_items', `Fetching followed ${validItemType}s...`);
                const listResult = await executeGetUserFollowed(validItemType, userToken);

                if (!listResult.success || !listResult.items) { // Đảm bảo kiểm tra listResult.items
                    const errorMsg = listResult.errorMessage || `Failed to retrieve followed ${validItemType}s.`;
                    logToFile(`${logPrefix} ManageFollow: Error listing items - ${errorMsg}`);
                    sendStatus('function_error', `Failed to list followed ${validItemType}s.`, { error: errorMsg });
                    return { modelResponseContent: `Sorry, I couldn't retrieve your followed ${validItemType}s: ${errorMsg}`, frontendAction: undefined };
                }

                if (listResult.items.length === 0) {
                    const message = `You are not following any ${validItemType}s.`;
                    logToFile(`${logPrefix} ManageFollow: No followed ${validItemType}s found.`);
                    sendStatus('list_success_empty', message);
                    return { modelResponseContent: message, frontendAction: undefined };
                }

                // Sử dụng các trường từ FollowItem để tạo thông tin hiển thị
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
                    // Không cần trả về fullItem ở đây vì nó chỉ dùng cho modelResponseContent
                    return {
                        id: item.id,
                        displayText: details,
                    };
                });

                const successMessage = `Here are the ${validItemType}s you are following:`;
                logToFile(`${logPrefix} ManageFollow: Successfully listed ${listResult.items.length} followed ${validItemType}(s).`);
                sendStatus('list_success', successMessage, { count: listResult.items.length });

                return {
                    // Sử dụng displayItemsForModelResponse đã được tạo ở trên cho modelResponseContent
                    modelResponseContent: `${successMessage}\n${displayItemsForModelResponse.map(item => `- ${item.displayText}`).join('\n')}`,
                    frontendAction: {
                        type: 'displayList',
                        payload: {
                            // Sử dụng trực tiếp listResult.items là mảng các FollowItem đầy đủ
                            items: listResult.items,
                            itemType: validItemType,
                            listType: 'followed',
                            title: `Your Followed ${validItemType.charAt(0).toUpperCase() + validItemType.slice(1)}s`
                        }
                    }
                };

            } else if (validAction === 'follow' || validAction === 'unfollow') {
                const currentIdentifier = validIdentifier!;
                const currentIdentifierType = validIdentifierType!;

                sendStatus('finding_item_id', `Searching for ${validItemType} with ${currentIdentifierType}: "${currentIdentifier}"...`, { identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                const idResult = await findItemId(currentIdentifier, currentIdentifierType, validItemType);

                if (!idResult.success || !idResult.itemId) {
                    const errorMsg = idResult.errorMessage || `Could not find ${validItemType} "${currentIdentifier}".`;
                    logToFile(`${logPrefix} ManageFollow: Error finding ID - ${errorMsg}`);
                    sendStatus('item_id_not_found', `Could not find ${validItemType} "${currentIdentifier}".`, { error: errorMsg, identifier: currentIdentifier, identifierType: currentIdentifierType, itemType: validItemType });
                    return { modelResponseContent: errorMsg, frontendAction: undefined };
                }
                const itemId = idResult.itemId;
                const itemNameForMessage = idResult.details?.title || idResult.details?.acronym || currentIdentifier;

                sendStatus('item_id_found', `Found ${validItemType} (ID: ${itemId}, Name: ${itemNameForMessage}).`, { itemId, itemType: validItemType, name: itemNameForMessage });

                sendStatus('checking_follow_status', `Checking your follow status for item ${itemId}...`, { itemId });
                const followStatusResult = await executeGetUserFollowed(validItemType, userToken);

                if (!followStatusResult.success) { // Không cần kiểm tra followStatusResult.itemIds ở đây nữa vì executeGetUserFollowed đã trả về items
                    const errorMsg = followStatusResult.errorMessage || 'Failed to check follow status.';
                    logToFile(`${logPrefix} ManageFollow: Error checking status - ${errorMsg}`);
                    sendStatus('function_error', 'Failed to check follow status.', { error: errorMsg, itemId });
                    return { modelResponseContent: `Sorry, I couldn't check your current follow status: ${errorMsg}`, frontendAction: undefined };
                }
                // Kiểm tra xem itemId có trong danh sách itemIds từ followStatusResult không
                const isCurrentlyFollowing = followStatusResult.itemIds.includes(itemId);
                sendStatus('follow_status_checked', `Current follow status: ${isCurrentlyFollowing ? 'Following' : 'Not Following'}.`, { itemId, isCurrentlyFollowing });

                sendStatus('determining_follow_action', `Determining required action based on request ('${validAction}') and status...`);
                const needsApiCall = (validAction === 'follow' && !isCurrentlyFollowing) || (validAction === 'unfollow' && isCurrentlyFollowing);
                sendStatus('follow_action_determined', needsApiCall ? `API call required to ${validAction} item ${itemId}.` : `No API call needed (action: '${validAction}', current status: ${isCurrentlyFollowing}).`, { needsApiCall, currentStatus: isCurrentlyFollowing, requestedAction: validAction });

                let finalMessage = "";
                if (needsApiCall) {
                    sendStatus('preparing_follow_api_call', `${validAction === 'follow' ? 'Following' : 'Unfollowing'} item ${itemNameForMessage} (ID: ${itemId})...`, { action: validAction, itemId, itemType: validItemType });
                    const apiActionResult = await executeFollowUnfollowApi(itemId, validItemType, validAction as 'follow' | 'unfollow', userToken);

                    if (apiActionResult.success) {
                        finalMessage = `Successfully ${validAction === 'follow' ? 'followed' : 'unfollowed'} the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}).`;
                        logToFile(`${logPrefix} ManageFollow: API call for ${validAction} successful.`);
                        sendStatus('follow_update_success', `Successfully ${validAction}ed ${validItemType}.`, { itemId, itemType: validItemType });
                    } else {
                        finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${validAction} the ${validItemType}: "${itemNameForMessage}". Please try again later.`;
                        logToFile(`${logPrefix} ManageFollow: API call for ${validAction} failed - ${apiActionResult.errorMessage}`);
                        sendStatus('follow_update_failed', `Failed to ${validAction} ${validItemType}.`, { error: apiActionResult.errorMessage, itemId, itemType: validItemType });
                    }
                } else {
                    if (validAction === 'follow') {
                        finalMessage = `You are already following the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}).`;
                    } else {
                        finalMessage = `You are not currently following the ${validItemType} "${itemNameForMessage}" (ID: ${itemId}).`;
                    }
                    logToFile(`${logPrefix} ManageFollow: No API call executed for action '${validAction}'. Current status: ${isCurrentlyFollowing}`);
                }
                return { modelResponseContent: finalMessage, frontendAction: undefined };
            } else {
                const errorMsg = `Unsupported action: ${validAction}`;
                logToFile(`${logPrefix} ManageFollow: Validation Error - ${errorMsg}`);
                sendStatus('function_error', 'Unsupported action.', { error: errorMsg, action: validAction });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in ManageFollowHandler: ${errorMessage}\nStack: ${error.stack}`);
            sendStatus?.('function_error', `Critical error during follow management processing: ${errorMessage}`);
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined
            };
        }
    }
}