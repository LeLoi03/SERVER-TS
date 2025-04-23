// src/handlers/followUnfollowItem.handler.ts
import {
    findItemId,
    executeGetUserFollowedItems,
    executeFollowUnfollowApi,
    // ApiCallResult // Đảm bảo type này được import hoặc định nghĩa đúng nếu sử dụng
} from '../services/followUnfollowItem.service'; // Điều chỉnh đường dẫn nếu cần
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Điều chỉnh đường dẫn nếu cần
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate } from '../shared/types'; // Điều chỉnh đường dẫn nếu cần
import logToFile from '../../utils/logger'; // Điều chỉnh đường dẫn nếu cần

export class FollowUnfollowItemHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        // Destructure các thành phần cần thiết bao gồm cả callback
        const { args, userToken, handlerId, socketId, onStatusUpdate, socket } = context;
        const itemType = args?.itemType as ('conference' | 'journal' | undefined);
        const identifier = args?.identifier as (string | undefined);
        const identifierType = args?.identifierType as ('acronym' | 'title' | 'id' | undefined);
        const action = args?.action as ('follow' | 'unfollow' | undefined);

        logToFile(`[${handlerId} ${socketId}] Handler: FollowUnfollowItem, Args: ${JSON.stringify(args)} Auth: ${!!userToken}`);

        // --- LOẠI BỎ định nghĩa safeEmitStatus nội bộ ---

        try {
            // --- Bắt đầu các emit chi tiết sử dụng context.onStatusUpdate ---

            // 1. Kiểm tra tính hợp lệ của Input (Bước 1: Sự tồn tại)
            if (!onStatusUpdate('status_update', { type: 'status', step: 'validating_function_args', message: 'Validating follow/unfollow arguments...', details: { args }, timestamp: new Date().toISOString() })) {
                if (!socket?.connected) throw new Error("Client disconnected during validation status update.");
                logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'validating_function_args' status via callback.`);
            }

            // --- KIỂM TRA SỰ TỒN TẠI VÀ TRẢ VỀ SỚM ---
            if (!itemType || !identifier || !identifierType || !action) {
                const errorMsg = "Missing required information (item type, identifier, identifier type, or action).";
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Validation Failed: ${errorMsg}`);
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Invalid arguments provided.', details: { error: errorMsg, args }, timestamp: new Date().toISOString() });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }
            // --- TỪ ĐÂY TRỞ ĐI: itemType, identifier, identifierType, action KHÔNG PHẢI LÀ undefined ---
            // TypeScript bây giờ biết:
            // identifier: string
            // itemType: 'conference' | 'journal' (hoặc giá trị string khác chưa được kiểm tra)
            // identifierType: 'acronym' | 'title' | 'id' (hoặc giá trị string khác chưa được kiểm tra)
            // action: 'follow' | 'unfollow' (hoặc giá trị string khác chưa được kiểm tra)

            // 1. Kiểm tra tính hợp lệ của Input (Bước 2: Giá trị cụ thể)
            let validationError: string | null = null;
            if (!['conference', 'journal'].includes(itemType)) { // Bây giờ itemType chắc chắn là string
                validationError = `Invalid item type "${itemType}". Can only follow/unfollow 'conference' or 'journal'.`;
            } else if (!['acronym', 'title', 'id'].includes(identifierType)) { // identifierType chắc chắn là string
                validationError = `Invalid identifier type "${identifierType}". Must be 'acronym', 'title', or 'id'.`;
            } else if (!['follow', 'unfollow'].includes(action)) { // action chắc chắn là string
                validationError = `Invalid action "${action}". Must be 'follow' or 'unfollow'.`;
            }

            if (validationError) {
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Validation Failed: ${validationError}`);
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Invalid arguments provided.', details: { error: validationError, args }, timestamp: new Date().toISOString() });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }
            // --- TỪ ĐÂY TRỞ ĐI: Các biến có kiểu đã được thu hẹp chính xác ---
            // itemType: 'conference' | 'journal'
            // identifier: string
            // identifierType: 'acronym' | 'title' | 'id'
            // action: 'follow' | 'unfollow'


            // 2. Kiểm tra Xác thực (Authentication)
            if (!onStatusUpdate('status_update', { type: 'status', step: 'checking_authentication', message: 'Checking authentication status...', timestamp: new Date().toISOString() })) {
                if (!socket?.connected) throw new Error("Client disconnected during auth check status update.");
                logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'checking_authentication' status via callback.`);
            }
            if (!userToken) {
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: User not authenticated.`);
                // Emit lỗi xác thực qua callback
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'User not authenticated.', details: { error: 'Authentication required' }, timestamp: new Date().toISOString() });
                // Trả về lỗi cho model
                return { modelResponseContent: "Error: You must be logged in to follow or unfollow items.", frontendAction: undefined };
            }
            // Optional: Emit trạng thái thành công nếu cần
            // onStatusUpdate('status_update', { type: 'status', step: 'authentication_success', message: 'User authenticated.', timestamp: new Date().toISOString() });

            // Emit bắt đầu xử lý yêu cầu
            onStatusUpdate('status_update', { type: 'status', step: 'processing_request', message: `Processing ${action} request for ${itemType}: "${identifier}"...`, timestamp: new Date().toISOString() });


            // 3. Tìm Item ID
            if (!onStatusUpdate('status_update', { type: 'status', step: 'finding_item_id', message: `Searching for ${itemType} with ${identifierType}: "${identifier}"...`, details: { identifier, identifierType, itemType }, timestamp: new Date().toISOString() })) {
                if (!socket?.connected) throw new Error("Client disconnected during item ID search status update.");
                logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'finding_item_id' status via callback.`);
            }
            const idResult = await findItemId(identifier, identifierType, itemType);
            if (!idResult.success || !idResult.itemId) {
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Error finding ID: ${idResult.errorMessage}`);
                onStatusUpdate('status_update', { type: 'status', step: 'item_id_not_found', message: `Could not find ${itemType} "${identifier}".`, details: { error: idResult.errorMessage }, timestamp: new Date().toISOString() });
                return { modelResponseContent: idResult.errorMessage || `Sorry, I couldn't find the specific ${itemType} "${identifier}" to ${action}.`, frontendAction: undefined };
            }
            const itemId = idResult.itemId;
            onStatusUpdate('status_update', { type: 'status', step: 'item_id_found', message: `Found ${itemType} (ID: ${itemId}).`, details: { itemId }, timestamp: new Date().toISOString() });

            // 4. Kiểm tra Trạng thái Follow Hiện tại
            if (!onStatusUpdate('status_update', { type: 'status', step: 'checking_follow_status', message: `Checking your follow status for item ${itemId}...`, details: { itemId }, timestamp: new Date().toISOString() })) {
                if (!socket?.connected) throw new Error("Client disconnected during follow status check update.");
                logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'checking_follow_status' status via callback.`);
            }
            const followStatusResult = await executeGetUserFollowedItems(itemType, userToken); // Truyền token
            if (!followStatusResult.success) {
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: Error checking status: ${followStatusResult.errorMessage}`);
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Failed to check follow status.', details: { error: followStatusResult.errorMessage }, timestamp: new Date().toISOString() });
                return { modelResponseContent: followStatusResult.errorMessage || `Sorry, I couldn't check your current follow status due to an error.`, frontendAction: undefined };
            }
            const isCurrentlyFollowing = followStatusResult.itemIds.includes(itemId);
            onStatusUpdate('status_update', { type: 'status', step: 'follow_status_checked', message: `Current follow status: ${isCurrentlyFollowing ? 'Following' : 'Not Following'}.`, details: { itemId, isCurrentlyFollowing }, timestamp: new Date().toISOString() });

            // 5. Xác định Hành động và Thực thi nếu cần
            onStatusUpdate('status_update', { type: 'status', step: 'determining_follow_action', message: `Determining required action based on request ('${action}') and status...`, timestamp: new Date().toISOString() });
            let finalMessage = "";
            let needsApiCall = false;
            if (action === 'follow') {
                if (!isCurrentlyFollowing) needsApiCall = true;
            } else { // action === 'unfollow'
                if (isCurrentlyFollowing) needsApiCall = true;
            }
            // Emit trạng thái xác định hành động
            onStatusUpdate('status_update', { type: 'status', step: 'follow_action_determined', message: needsApiCall ? `API call required to ${action} item ${itemId}.` : `No API call needed (action: '${action}', current status: ${isCurrentlyFollowing}).`, details: { needsApiCall }, timestamp: new Date().toISOString() });


            // 6. Gọi API Follow/Unfollow nếu cần
            if (needsApiCall) {
                if (!onStatusUpdate('status_update', { type: 'status', step: 'preparing_follow_api_call', message: `${action === 'follow' ? 'Following' : 'Unfollowing'} item ${itemId}...`, details: { action, itemId, itemType }, timestamp: new Date().toISOString() })) {
                    if (!socket?.connected) throw new Error("Client disconnected before follow/unfollow API call status update.");
                    logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'preparing_follow_api_call' status via callback.`);
                }
                // Thực hiện gọi API
                const apiActionResult = await executeFollowUnfollowApi(itemId, itemType, action, userToken);

                if (apiActionResult.success) {
                    finalMessage = `Successfully ${action === 'follow' ? 'followed' : 'unfollowed'} the ${itemType} "${identifier}" (ID: ${itemId}).`;
                    logToFile(`[${handlerId} ${socketId}] FollowUnfollow: API call for ${action} successful.`);
                    // Emit trạng thái thành công
                    onStatusUpdate('status_update', { type: 'status', step: 'follow_update_success', message: `Successfully ${action}ed ${itemType}.`, details: { itemId }, timestamp: new Date().toISOString() });
                } else {
                    finalMessage = apiActionResult.errorMessage || `Sorry, I encountered an error trying to ${action} the ${itemType}: "${identifier}". Please try again later.`;
                    logToFile(`[${handlerId} ${socketId}] FollowUnfollow: API call for ${action} failed: ${apiActionResult.errorMessage}`);
                    // Emit trạng thái thất bại
                    onStatusUpdate('status_update', { type: 'status', step: 'follow_update_failed', message: `Failed to ${action} ${itemType}.`, details: { error: apiActionResult.errorMessage, itemId }, timestamp: new Date().toISOString() });
                }
            } else {
                // Xây dựng thông báo dựa trên lý do không cần gọi API
                if (action === 'follow' && isCurrentlyFollowing) { finalMessage = `You are already following the ${itemType} "${identifier}" (ID: ${itemId}).`; }
                else if (action === 'unfollow' && !isCurrentlyFollowing) { finalMessage = `You are not currently following the ${itemType} "${identifier}" (ID: ${itemId}).`; }
                else {
                    // Trường hợp này không nên xảy ra với logic hiện tại, nhưng để dự phòng
                    finalMessage = `No action taken for ${itemType} "${identifier}" (ID: ${itemId}).`;
                    logToFile(`[${handlerId} ${socketId}] Warning: No API call needed and no standard message determined for action '${action}'.`);
                }
                logToFile(`[${handlerId} ${socketId}] FollowUnfollow: No API call executed for action '${action}'. Current status: ${isCurrentlyFollowing}`);
            }
            // --- End Detailed Emits ---

            return {
                modelResponseContent: finalMessage,
                frontendAction: undefined // Không có action trực tiếp cho UI từ backend
            };

        } catch (error: any) {
            logToFile(`[${handlerId} ${socketId}] CRITICAL Error in FollowUnfollowItemHandler: ${error.message}\nStack: ${error.stack}`);
            // Cố gắng emit lỗi qua callback nếu có thể
            onStatusUpdate?.('status_update', { type: 'status', step: 'function_error', message: `Error during follow/unfollow processing: ${error.message}`, timestamp: new Date().toISOString() });
            // Trả về thông báo lỗi cho model
            return { modelResponseContent: `Error executing followUnfollowItem: ${error.message}`, frontendAction: undefined };
        }
    }
}