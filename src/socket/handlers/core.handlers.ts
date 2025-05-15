// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
// import { Logger } from 'pino'; // Xóa import Logger
// import { LoggingService } from '../../services/logging.service'; // Xóa import LoggingService
import { ConversationHistoryService, ConversationMetadata } from '../../chatbot/services/conversationHistory.service';
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper';
import { handleStreaming, handleNonStreaming } from '../../chatbot/handlers/intentHandler';
import { stageEmailConfirmation, handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager';
import logToFile from '../../utils/logger';

// --- Import types ---
import {
    HistoryItem,
    FrontendAction,
    ConfirmSendEmailAction,
    ErrorUpdate,
    SendMessageData,
    LoadConversationData,
    ConfirmationEventData,
    DeleteConversationData,
    ClearConversationData,
    Language,
    WarningUpdate,
    ChatMessage,
    RenameConversationData,
    PinConversationData,
    ClientConversationMetadata,
    RenameResult
} from '../../chatbot/shared/types';

// --- Constants ---
const CORE_HANDLER_NAME = 'coreHandlers';
const DEFAULT_HISTORY_LIMIT = 50; // Example limit

/**
 * Registers core Socket.IO event handlers for chat functionality.
 * Resolves necessary services and sets up logging context.
 * @param io - The Socket.IO Server instance.
 * @param socket - The individual client Socket instance.
 */
export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket
): void => {
    const socketId = socket.id;
    const userId = socket.data.userId || 'Anonymous'; // Lấy userId sớm để dùng cho log

    // --- Resolve Dependencies (Singleton Pattern) ---
    // These services are resolved once per socket connection when handlers are registered.
    // let loggingService: LoggingService; // Xóa loggingService
    let conversationHistoryService: ConversationHistoryService;
    try {
        // loggingService = container.resolve(LoggingService); // Xóa resolve LoggingService
        conversationHistoryService = container.resolve(ConversationHistoryService);
    } catch (error: any) {
        // Critical error if services cannot be resolved. Log and potentially disconnect/error out.
        logToFile(`[${CORE_HANDLER_NAME}][${socketId}][${userId}] CRITICAL: Failed to resolve core services: ${error.message}, Stack: ${error.stack}`);
        socket.emit('critical_error', { message: "Server configuration error. Please try reconnecting later." });
        socket.disconnect(true); // Disconnect the socket as it cannot function
        return; // Stop registration
    }

    // --- Create Logger Context ---
    // Base logger for this specific socket connection's core handlers
    // const logger = loggingService.getLogger({ socketId, handler: CORE_HANDLER_NAME }); // Xóa logger

    // Log initial registration attempt
    logToFile(`[${CORE_HANDLER_NAME}][${socketId}][${userId}] Registering core event handlers for connection.`);


    // --- Helper Functions ---

    /**
     * Sends a structured error message to the client via 'chat_error' event and logs it.
     * @param logContext - Chuỗi context cho log (ví dụ: "[handlerName][socketId][userId]").
     * @param message - The user-facing error message.
     * @param step - A machine-readable code indicating where the error occurred.
     * @param details - Optional additional details for logging.
     */
    const sendChatError = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        const logMessage = `[ERROR] ${logContext} Chat error occurred. Step: ${step}, Message: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        logToFile(logMessage);
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    /**
     * Sends a structured warning message to the client via 'chat_warning' event and logs it.
     * @param logContext - Chuỗi context cho log.
     * @param message - The user-facing warning message.
     * @param step - A machine-readable code indicating the context of the warning.
     * @param details - Optional additional details for logging.
     */
    const sendChatWarning = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        const logMessage = `[WARNING] ${logContext} Chat warning occurred. Step: ${step}, Message: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        logToFile(logMessage);
        socket.emit('chat_warning', { type: 'warning', message, step } as WarningUpdate);
    };


    /**
     * Fetches the updated conversation list for the user and emits it via 'conversation_list'.
     * Logs success or failure.
     * @param logContext - Chuỗi context cho log.
     * @param userId - The ID of the user whose list should be updated.
     * @param reason - A brief description of why the list is being updated (for logging).
     */
    const emitUpdatedConversationList = async (logContext: string, userId: string, reason: string): Promise<void> => {
        logToFile(`[DEBUG] ${logContext} Attempting to fetch and emit updated conversation list. Reason: ${reason}`);
        try {
            // Sử dụng ConversationMetadata từ service
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userId);
            // Client có thể cần map lại sang ClientConversationMetadata nếu type khác
            socket.emit('conversation_list', updatedList as ClientConversationMetadata[]);
            logToFile(`[INFO] ${logContext} Emitted updated conversation list. Reason: ${reason}, Count: ${updatedList.length}`);
        } catch (error: any) {
            logToFile(`[WARNING] ${logContext} Failed to fetch/emit updated conversation list. Reason: ${reason}, Error: ${error.message}`);
        }
    };

    /**
     * Centralized authentication check for handlers.
     * @param logContext - Chuỗi context cho log.
     * @param eventName The name of the event being handled.
     * @returns The userId if authenticated, otherwise null (and sends error).
     */
    const ensureAuthenticated = (logContext: string, eventName: string): string | null => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            sendChatError(logContext, `Authentication required for ${eventName}.`, 'auth_required', { event: eventName });
            return null;
        }
        return currentUserId;
    };

    // --- Event Handlers ---

    // --- Handler: Get Conversation List ---
    socket.on('get_conversation_list', async () => {
        const eventName = 'get_conversation_list';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        logToFile(`[INFO] ${handlerLogContext} Request received.`);
        // Service trả về mảng rỗng nếu lỗi, không cần try-catch ở đây trừ khi muốn xử lý đặc biệt
        const conversationList = await conversationHistoryService.getConversationListForUser(currentUserId);
        socket.emit('conversation_list', conversationList as ClientConversationMetadata[]);
        logToFile(`[INFO] ${handlerLogContext} Sent conversation list. Count: ${conversationList.length}`);
    });

    // --- Handler: Load Specific Conversation ---
    socket.on('load_conversation', async (data: unknown) => {
        const eventName = 'load_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;

        // LOG NÀY PHẢI XUẤT HIỆN NẾU EVENT ĐẾN ĐƯỢC ĐÚNG HANDLER NÀY
        console.log(`[SERVER DEBUG - HANDLER ENTERED] Received 'load_conversation' event. Socket ID: ${socket.id}. Data:`, data);
        logToFile(`[INFO] ${handlerLogContext} Raw 'load_conversation' event received. Data: ${JSON.stringify(data)?.substring(0, 200) + (JSON.stringify(data)?.length > 200 ? '...' : '')}`);

        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        // Improved validation
        if (typeof data !== 'object' || data === null || typeof (data as LoadConversationData)?.conversationId !== 'string' || !(data as LoadConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_load');
        }
        const requestedConvId = (data as LoadConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${requestedConvId}]`; // Thêm context ID cuộc hội thoại

        logToFile(`[INFO] ${convLogContext} Request received.`);

        try {
            // Use constant for limit
            const history = await conversationHistoryService.getConversationHistory(requestedConvId, currentUserId, DEFAULT_HISTORY_LIMIT);

            if (history === null) {
                // Handles not found, not authorized, or invalid ID format cases
                return sendChatError(convLogContext, 'Conversation not found or access denied.', 'history_not_found_load', { conversationId: requestedConvId });
            }

            const frontendMessages: ChatMessage[] = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId; // Set active conversation on the socket
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            logToFile(`[INFO] ${convLogContext} Sent history. Set as active conversation. Message Count: ${frontendMessages.length}`);

        } catch (error: any) {
            // Catch errors thrown by getConversationHistory (unexpected DB errors)
            sendChatError(convLogContext, `Server error loading conversation history.`, 'history_load_fail_server', { conversationId: requestedConvId, error: error.message, stack: error.stack });
        }
    });

    // --- Handler: Start New Conversation ---
    socket.on('start_new_conversation', async () => {
        const eventName = 'start_new_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        logToFile(`[INFO] ${handlerLogContext} Request received.`);
        try {
            const { conversationId } = await conversationHistoryService.createNewConversation(currentUserId);
            socket.data.currentConversationId = conversationId;
            const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`; // Thêm context ID cuộc hội thoại mới
            logToFile(`[DEBUG] ${convLogContext} Emitting 'new_conversation_started'.`); // <--- ADD THIS LOG
            socket.emit('new_conversation_started', { conversationId });
            logToFile(`[INFO] ${convLogContext} Started new conversation. Set as active.`);
            // Update the list on the frontend
            await emitUpdatedConversationList(handlerLogContext, currentUserId, 'new conversation started');

        } catch (error: any) {
            sendChatError(handlerLogContext, `Could not start new conversation.`, 'new_conv_fail_server', { userId: currentUserId, error: error.message, stack: error.stack });
        }
    });


    // --- Handler: Send Message ---
    socket.on('send_message', async (data: unknown) => {
        const eventName = 'send_message';
        // Tạo ID duy nhất cho mỗi yêu cầu gửi tin nhắn để theo dõi
        const handlerId = `${socketId.substring(0, 4)}-${Date.now()}`;
        let handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}][Req:${handlerId}]`;


        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        // Cập nhật log context với userId thực tế nếu nó khác 'Anonymous'
         handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${currentUserId}][Req:${handlerId}]`;


        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogContext, 'Authentication session error. Please re-login.', 'missing_token_auth', { userId: currentUserId });
        }

        // Validate data including conversationId (optional, can be null)
        if (
            typeof data !== 'object' || data === null ||
            typeof (data as SendMessageData)?.userInput !== 'string' || !(data as SendMessageData).userInput?.trim() ||
            typeof (data as SendMessageData)?.language !== 'string' || !(data as SendMessageData).language
            // conversationId có thể là null hoặc undefined, nên không cần check chặt ở đây nếu client có thể bỏ qua nó
        ) {
            return sendChatError(handlerLogContext, 'Invalid message data: Missing or invalid "userInput" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        // Lấy conversationId từ payload trước tiên
        const { userInput, isStreaming = true, language, conversationId: payloadConversationId } = data as SendMessageData;

        logToFile(
            `[INFO] ${handlerLogContext} Request received.` +
            ` UserInput: "${userInput.substring(0, 30) + (userInput.length > 30 ? '...' : '')}"` +
            `, Streaming: ${isStreaming}` +
            `, Language: ${language}` +
            `, PayloadConvId: ${payloadConversationId || 'N/A'}` +
            `, SocketDataConvId: ${socket.data.currentConversationId || 'N/A'}`
        );

        let targetConversationId: string;
        let conversationTitleForNew: string | undefined; // Để truyền title nếu tạo mới

        if (payloadConversationId) {
            // Client cung cấp một ID cụ thể
            targetConversationId = payloadConversationId;
             // Cập nhật log context với conversationId từ payload
            handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${currentUserId}][Req:${handlerId}][Conv:${targetConversationId}]`;

            // Đồng bộ socket.data.currentConversationId nếu nó khác
            if (socket.data.currentConversationId !== targetConversationId) {
                logToFile(`[INFO] ${handlerLogContext} Updating socket.data.currentConversationId to match payloadConversationId. Old: ${socket.data.currentConversationId || 'N/A'}`);
                socket.data.currentConversationId = targetConversationId;
            }
            logToFile(`[INFO] ${handlerLogContext} Using conversationId from payload.`);
        } else {
            // Client muốn tạo conversation mới (payloadConversationId là null, undefined, hoặc rỗng)
            logToFile(`[INFO] ${handlerLogContext} payloadConversationId is null/undefined. Client requests new conversation.`);
            try {
                // Bạn có thể muốn lấy title mặc định hoặc từ một nguồn nào đó nếu cần
                const newConvResult = await conversationHistoryService.createNewConversation(currentUserId);
                targetConversationId = newConvResult.conversationId;
                conversationTitleForNew = newConvResult.title; // Bây giờ newConvResult.title đã tồn tại

                // Cập nhật log context với conversationId mới
                 handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${currentUserId}][Req:${handlerId}][Conv:${targetConversationId}]`;

                socket.data.currentConversationId = targetConversationId;
                logToFile(`[INFO] ${handlerLogContext} Explicitly created new conversation based on payload and set as active. Title: "${conversationTitleForNew}"`);

                socket.emit('new_conversation_started', {
                    conversationId: targetConversationId,
                    title: conversationTitleForNew, // Sử dụng title từ kết quả
                    lastActivity: newConvResult.lastActivity.toISOString(), // Sử dụng lastActivity từ kết quả
                    isPinned: newConvResult.isPinned, // Sử dụng isPinned từ kết quả
                });
                await emitUpdatedConversationList(handlerLogContext, currentUserId, 'new conversation from send_message');
            } catch (error: any) {
                return sendChatError(handlerLogContext, `Could not start new chat session as requested by client.`, 'explicit_new_conv_payload_fail', { userId: currentUserId, error: error.message, stack: error.stack });
            }
        }

        // Nếu sau tất cả các logic trên mà targetConversationId vẫn chưa được xác định
        // (điều này không nên xảy ra nếu client luôn gửi payloadConversationId hoặc null)
        // thì bạn có thể xem xét một fallback cuối cùng, nhưng lý tưởng là không cần.
        if (!targetConversationId) {
            logToFile(`[ERROR] ${handlerLogContext} CRITICAL: targetConversationId could not be determined. This should not happen with new client logic.`);
            return sendChatError(handlerLogContext, 'Internal server error: Could not determine chat session.', 'target_id_undetermined');
        }


        // Phần còn lại của logic (lấy history, xử lý intent, lưu history) giữ nguyên
        // nhưng sử dụng `targetConversationId` đã được xác định ở trên.

        let currentHistory: HistoryItem[];
        try {
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, currentUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                logToFile(`[ERROR] ${handlerLogContext} Failed to fetch history for target conversation.`);
                // Có thể client gửi một ID không tồn tại hoặc không có quyền truy cập
                // Reset socket.data.currentConversationId nếu nó không hợp lệ nữa
                if (socket.data.currentConversationId === targetConversationId) {
                    socket.data.currentConversationId = undefined;
                    logToFile(`[INFO] ${handlerLogContext} Cleared socket.data.currentConversationId as target was invalid.`);
                }
                return sendChatError(handlerLogContext, 'Chat session error or invalid conversation ID. Please select a valid conversation or start a new one.', 'history_not_found_send', { convId: targetConversationId });
            }
            currentHistory = fetchedHistory;
            logToFile(`[INFO] ${handlerLogContext} Fetched current history. Count: ${currentHistory.length}`);
        } catch (error: any) {
            return sendChatError(handlerLogContext, `Could not load chat history.`, 'history_fetch_fail_send', { convId: targetConversationId, error: error.message, stack: error.stack });
        }

        try {
            let updatedHistory: HistoryItem[] | void | undefined = undefined; // <<< Sửa: có thể là void từ streaming
            let resultAction: FrontendAction | undefined = undefined;

            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    logToFile(`[INFO] ${handlerLogContext} Staging email confirmation action. Confirmation ID: ${action.payload.confirmationId}`);
                    // Truyền handlerLogContext vào hàm stageEmailConfirmation nếu nó cần logging context
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io /*, handlerLogContext */);
                }
            };

            if (isStreaming) {
                logToFile(`[DEBUG] ${handlerLogContext} Calling streaming intent handler.`);
                // Truyền handlerLogContext vào hàm handleStreaming nếu nó cần logging context
                updatedHistory = await handleStreaming(userInput, currentHistory, socket, language as Language, handlerId, handleAction /*, handlerLogContext */);
                // <<< Không cần gán updatedHistory = undefined nữa >>>
            } else {
                logToFile(`[DEBUG] ${handlerLogContext} Calling non-streaming intent handler.`);
                 // Truyền handlerLogContext vào hàm handleNonStreaming nếu nó cần logging context
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language as Language, handlerId /*, handlerLogContext */);
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    resultAction = handlerResult.action;
                    handleAction(resultAction);
                }
            }

            // <<< SỬA: Chỉ còn một khối if để lưu history >>>
            if (Array.isArray(updatedHistory)) {
                logToFile(`[INFO] ${handlerLogContext} Intent handler returned updated history. Attempting save. New size: ${updatedHistory.length}`);
                try {
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);

                    if (updateSuccess) {
                        logToFile(`[INFO] ${handlerLogContext} Successfully updated history in DB.`);
                        await emitUpdatedConversationList(handlerLogContext, currentUserId, 'message saved');
                    } else {
                        logToFile(`[ERROR] ${handlerLogContext} History save failed: Target conversation not found or unauthorized during update.`);
                        sendChatWarning(handlerLogContext, 'Failed to save message history. Conversation might be out of sync.', 'history_save_fail_target', { convId: targetConversationId });
                    }
                } catch (dbError: any) {
                    logToFile(`[ERROR] ${handlerLogContext} CRITICAL: Error updating history in DB. Error: ${dbError.message}, Stack: ${dbError.stack}`);
                    sendChatError(handlerLogContext, 'A critical error occurred while saving your message.', 'history_save_exception', { error: dbError.message });
                }
            } else {
                // Log này giờ áp dụng cho streaming trả về void/undefined, hoặc non-streaming không trả về history
                logToFile(`[INFO] ${handlerLogContext} No history array returned by handler for explicit DB update here. DB not updated by this block. Reason: ${isStreaming ? 'Streaming handler (or void)' : 'Non-streaming handler returned no history'}`);
            }

        } catch (handlerError: any) {
            logToFile(`[ERROR] ${handlerLogContext} Error processing message via intent handler. Error: ${handlerError.message}, Stack: ${handlerError.stack}`);
            sendChatError(handlerLogContext, `Error processing message: ${handlerError.message}`, 'handler_exception', { error: handlerError.message });
        }
    });

    // --- Handlers for Email Confirmation ---
    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            const confirmationLogContext = `${handlerLogContext}[Confirm:${confirmationId}]`; // Thêm context ID xác nhận
            logToFile(`[INFO] ${confirmationLogContext} Request received.`);
            // TODO: Refactor handleUserEmailConfirmation to accept logger instance or logToFile context
            handleUserEmailConfirmation(confirmationId, socket /*, confirmationLogContext */);
        } else {
             logToFile(`[WARNING] ${handlerLogContext} Received invalid event data for email confirmation. Data: ${JSON.stringify(data)?.substring(0, 100)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data received.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
             const confirmationLogContext = `${handlerLogContext}[Cancel:${confirmationId}]`; // Thêm context ID xác nhận
            logToFile(`[INFO] ${confirmationLogContext} Request received.`);
            // TODO: Refactor handleUserEmailCancellation to accept logger instance or logToFile context
            handleUserEmailCancellation(confirmationId, socket /*, confirmationLogContext */);
        } else {
             logToFile(`[WARNING] ${handlerLogContext} Received invalid event data for email cancellation. Data: ${JSON.stringify(data)?.substring(0, 100)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data received.' });
        }
    });

    // --- Handler: Delete Conversation ---
    socket.on('delete_conversation', async (data: unknown) => {
        const eventName = 'delete_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as DeleteConversationData)?.conversationId !== 'string' || !(data as DeleteConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_delete');
        }
        const conversationIdToDelete = (data as DeleteConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToDelete}]`; // Thêm context ID cuộc hội thoại

        logToFile(`[INFO] ${convLogContext} Request received.`);
        try {
            const success = await conversationHistoryService.deleteConversation(conversationIdToDelete, currentUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed deletion.`);
                socket.emit('conversation_deleted', { conversationId: conversationIdToDelete });
                // If the deleted conversation was the currently active one, clear it
                if (socket.data.currentConversationId === conversationIdToDelete) {
                     logToFile(`[INFO] ${convLogContext} Deleted conversation was active. Clearing active ID.`);
                    socket.data.currentConversationId = undefined;
                }
                // Update the list on the frontend
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `deleted conversation ${conversationIdToDelete}`);
            } else {
                // Service returned false (not found or not authorized)
                sendChatError(convLogContext, 'Could not delete conversation. It might not exist or you may not have permission.', 'delete_fail_permission', { conversationId: conversationIdToDelete });
            }
        } catch (error: any) {
            // Catch unexpected DB errors during deletion
            sendChatError(convLogContext, `Server error deleting conversation.`, 'delete_fail_server', { conversationId: conversationIdToDelete, error: error.message, stack: error.stack });
        }
    });

    // --- Handler: Clear Conversation Messages ---
    socket.on('clear_conversation', async (data: unknown) => {
        const eventName = 'clear_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as ClearConversationData)?.conversationId !== 'string' || !(data as ClearConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_clear');
        }
        const conversationIdToClear = (data as ClearConversationData).conversationId;
         const convLogContext = `${handlerLogContext}[Conv:${conversationIdToClear}]`; // Thêm context ID cuộc hội thoại

        logToFile(`[INFO] ${convLogContext} Request received.`);
        try {
            const success = await conversationHistoryService.clearConversationMessages(conversationIdToClear, currentUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed message clearing.`);
                socket.emit('conversation_cleared', { conversationId: conversationIdToClear }); // Inform client
                // If the cleared conversation is active, send empty history to reset the view
                if (socket.data.currentConversationId === conversationIdToClear) {
                    logToFile(`[INFO] ${convLogContext} Cleared conversation was active. Emitting empty history.`);
                    socket.emit('initial_history', { conversationId: conversationIdToClear, messages: [] });
                }
                // Update the list on the frontend (lastActivity time changes)
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `cleared conversation ${conversationIdToClear}`);
            } else {
                // Service returned false (not found or not authorized)
                sendChatError(convLogContext, 'Could not clear conversation messages. It might not exist or you may not have permission.', 'clear_fail_permission', { conversationId: conversationIdToClear });
            }
        } catch (error: any) {
            // Catch unexpected DB errors during clear
            sendChatError(convLogContext, `Server error clearing conversation messages.`, 'clear_fail_server', { conversationId: conversationIdToClear, error: error.message, stack: error.stack });
        }
    });

    // --- Handler: Rename Conversation ---
    socket.on('rename_conversation', async (data: unknown) => {
        const eventName = 'rename_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        const payload = data as RenameConversationData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.newTitle !== 'string'
        ) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId" or "newTitle".', 'invalid_request_rename');
        }
        const { conversationId, newTitle } = payload;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`; // Thêm context ID cuộc hội thoại

        logToFile(`[INFO] ${convLogContext} Request received. New Title Preview: "${newTitle.substring(0, 30) + (newTitle.length > 30 ? '...' : '')}"`);

        try {
            // Gọi service method và nhận kết quả chi tiết hơn
            const renameOpResult: RenameResult = await conversationHistoryService.renameConversation(conversationId, currentUserId, newTitle);

            if (renameOpResult.success) {
                logToFile(`[INFO] ${convLogContext} Successfully renamed conversation. Updated Title: "${renameOpResult.updatedTitle}"`);
                // Sử dụng updatedTitle từ kết quả của service
                socket.emit('conversation_renamed', {
                    conversationId: renameOpResult.conversationId,
                    newTitle: renameOpResult.updatedTitle // Đây là tiêu đề đã được xử lý bởi service
                });
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `renamed conv ${conversationId}`);
            } else {
                // Service đã xử lý lỗi logic (ví dụ: không tìm thấy, title không hợp lệ)
                 logToFile(`[ERROR] ${convLogContext} Rename failed based on service logic. Check ID, permissions, or title validity.`);
                sendChatError(convLogContext, 'Could not rename. Check ID, permissions, or title validity.', 'rename_fail_logic', { conversationId });
            }
        } catch (error: any) {
            // Lỗi không mong muốn từ service (ví dụ: lỗi DB)
            sendChatError(convLogContext, 'Server error renaming conversation.', 'rename_fail_server', { conversationId, error: error.message, stack: error.stack });
        }
    });

    // --- Handler: Pin Conversation ---
    socket.on('pin_conversation', async (data: unknown) => {
        const eventName = 'pin_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        const payload = data as PinConversationData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.isPinned !== 'boolean'
        ) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId" or "isPinned" status.', 'invalid_request_pin');
        }
        const { conversationId, isPinned } = payload;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`; // Thêm context ID cuộc hội thoại

        logToFile(`[INFO] ${convLogContext} Request received. IsPinned: ${isPinned}`);

        try {
            const success = await conversationHistoryService.pinConversation(conversationId, currentUserId, isPinned);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully updated pin status. IsPinned: ${isPinned}`);
                socket.emit('conversation_pin_status_changed', { conversationId, isPinned });
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `pinned/unpinned conv ${conversationId}`);
            } else {
                 logToFile(`[ERROR] ${convLogContext} Pin status update failed. Check ID or permissions.`);
                sendChatError(convLogContext, 'Could not update pin status. Check ID or permissions.', 'pin_fail', { conversationId });
            }
        } catch (error: any) {
            sendChatError(convLogContext, 'Server error updating pin status.', 'pin_fail_server', { conversationId, error: error.message, stack: error.stack });
        }
    });

    // Log successful registration
    logToFile(`[INFO] Core event handlers successfully registered.`);
};