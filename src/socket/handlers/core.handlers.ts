// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper';
import logToFile from '../../utils/logger';
import { handleStreaming, handleNonStreaming } from '../../chatbot/handlers/intentHandler'; // Import intent handlers
import { stageEmailConfirmation, handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager'; // Import confirmation utils
import { HistoryItem, Language, FrontendAction, ConfirmSendEmailAction, ErrorUpdate } from '../../chatbot/shared/types'; // Import các type cần thiết

// Kiểu dữ liệu mong đợi từ client
interface SendMessageData {
    userInput: string;
    isStreaming?: boolean;
    language: Language;
}

interface LoadConversationData {
    conversationId: string;
}

interface ConfirmationEventData {
    confirmationId: string;
}

// --- NEW: Interfaces for delete/clear ---
interface DeleteConversationData {
    conversationId: string;
}

interface ClearConversationData {
    conversationId: string;
}
// ---

/**
 * Đăng ký tất cả các trình xử lý sự kiện cốt lõi cho một socket client.
 * Bao gồm quản lý conversation, gửi/nhận tin nhắn, và xử lý xác nhận.
 * @param io - Instance Socket.IO server.
 * @param socket - Instance Socket của client hiện tại.
 * @param conversationHistoryService - Instance của ConversationHistoryService.
 */
export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket,
    conversationHistoryService: ConversationHistoryService
) => {
    const socketId = socket.id;

    // Helper function để gửi lỗi chuẩn hóa về client
    const sendChatError = (message: string, step: string, handlerId?: string) => {
        logToFile(`[Socket ${socketId}${handlerId ? ` ${handlerId}` : ''}] Error: ${message} (Step: ${step})`);
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };


      // Helper to fetch and emit updated list (DRY)
      const emitUpdatedConversationList = async (userId: string, reason: string) => {
        try {
            const updatedList = await conversationHistoryService.getConversationListForUser(userId);
            socket.emit('conversation_list', updatedList);
            logToFile(`[Socket ${socketId}] Emitted updated conversation list to user ${userId} after ${reason}.`);
        } catch (error: any) {
            logToFile(`[Socket ${socketId}] WARN: Failed to fetch/emit updated conversation list after ${reason} for user ${userId}: ${error.message}`);
            // Don't send a chat_error for this, it's a background update failure
        }
    };

    logToFile(`[Socket ${socketId}] Registering core event handlers. UserID: ${socket.data.userId || 'Anonymous'}`);

    // --- Handler: Lấy danh sách conversations ---
    socket.on('get_conversation_list', async () => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            return sendChatError('Authentication required to fetch conversation list.', 'auth_required');
        }
        logToFile(`[Socket ${socketId}] Event 'get_conversation_list' received for user ${currentUserId}.`);
        try {
            const conversationList = await conversationHistoryService.getConversationListForUser(currentUserId);
            socket.emit('conversation_list', conversationList);
            logToFile(`[Socket ${socketId}] Sent conversation list (${conversationList.length} items) to user ${currentUserId}.`);
        } catch (error: any) {
            sendChatError(`Could not fetch conversation list: ${error.message}`, 'list_fetch_fail');
        }
    });

    // --- Handler: Load một conversation cụ thể ---
    socket.on('load_conversation', async (data: unknown) => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            return sendChatError('Authentication required to load conversation.', 'auth_required');
        }
        if (typeof data !== 'object' || data === null || !('conversationId' in data) || typeof (data as LoadConversationData).conversationId !== 'string' || (data as LoadConversationData).conversationId.length === 0) {
            return sendChatError('Invalid request: Missing or invalid conversation ID.', 'invalid_request_load');
        }
        const requestedConvId = (data as LoadConversationData).conversationId;
        logToFile(`[Socket ${socketId}] Event 'load_conversation' received for ID: ${requestedConvId}, User: ${currentUserId}.`);
        try {
            const historyLimit = 50;
            const history = await conversationHistoryService.getConversationHistory(requestedConvId, currentUserId, historyLimit);
            if (history === null) {
                return sendChatError('Conversation not found or access denied.', 'history_not_found_load');
            }
            const frontendMessages = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId;
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            logToFile(`[Socket ${socketId}] Sent history for conversation ${requestedConvId}. Set as active.`);
        } catch (error: any) {
            sendChatError(`Could not load conversation history: ${error.message}`, 'history_load_fail');
        }
    });

    // --- Handler: Bắt đầu cuộc trò chuyện mới ---
    socket.on('start_new_conversation', async () => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            return sendChatError('Authentication required to start a new conversation.', 'auth_required');
        }
        logToFile(`[Socket ${socketId}] Event 'start_new_conversation' received for user ${currentUserId}.`);
        try {
            const { conversationId } = await conversationHistoryService.createNewConversation(currentUserId);
            socket.data.currentConversationId = conversationId;
            socket.emit('new_conversation_started', { conversationId });
            logToFile(`[Socket ${socketId}] Started new conversation ${conversationId}. Set as active.`);
            // Emit updated list after starting a new one
            await emitUpdatedConversationList(currentUserId, 'new conversation start');
        } catch (error: any) {
            sendChatError(`Could not start new conversation: ${error.message}`, 'new_conv_fail');
        }
    });

    // --- Handler: Gửi tin nhắn ---
    socket.on('send_message', async (data: unknown) => {
        const handlerId = `MsgHandler-${Date.now()}`;
        const currentUserId = socket.data.userId as string | undefined;
        const token = socket.data.token as string | undefined;

        if (!currentUserId) return sendChatError('Authentication required to send messages.', 'auth_required', handlerId);
        if (!token) return sendChatError('Authentication session error. Please re-login.', 'missing_token_auth', handlerId);

        if (typeof data !== 'object' || data === null || !('userInput' in data) || typeof (data as SendMessageData).userInput !== 'string' || (data as SendMessageData).userInput.trim().length === 0 || !('language' in data) || typeof (data as SendMessageData).language !== 'string') {
            return sendChatError('Invalid message data received.', 'invalid_input_send', handlerId);
        }
        const { userInput, isStreaming = true, language } = data as SendMessageData;
        let activeConversationId = socket.data.currentConversationId as string | undefined;

        logToFile(`[Socket ${socketId} ${handlerId}] Event 'send_message' received: UserInput="${userInput.substring(0, 20)}...", Streaming=${isStreaming}, Lang=${language}, UserID=${currentUserId}, ActiveConvID=${activeConversationId}`);

        let targetConversationId: string | null = activeConversationId || null;
        if (!targetConversationId) {
            logToFile(`[Socket ${socketId} ${handlerId}] No active conversation. Creating new implicitly.`);
            try {
                const { conversationId: newConvId } = await conversationHistoryService.createNewConversation(currentUserId);
                targetConversationId = newConvId;
                socket.data.currentConversationId = newConvId;
                logToFile(`[Socket ${socketId} ${handlerId}] Implicitly created/set active conv ${targetConversationId}`);
                socket.emit('new_conversation_started', { conversationId: targetConversationId });
                // Emit updated list after implicit creation
                await emitUpdatedConversationList(currentUserId, 'implicit new conversation');
            } catch (error: any) {
                return sendChatError(`Could not start chat session: ${error.message}`, 'implicit_new_conv_fail', handlerId);
            }
        }

        let currentHistory: HistoryItem[] = [];
        try {
            const historyLimit = 50;
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, currentUserId, historyLimit);
            if (fetchedHistory === null) {
                return sendChatError('Chat session error. Please select a conversation or start a new one.', 'history_not_found_send', handlerId);
            }
            currentHistory = fetchedHistory;
            logToFile(`[Socket ${socketId} ${handlerId}] Fetched ${currentHistory.length} history items for conv ${targetConversationId}.`);
        } catch (error: any) {
            return sendChatError(`Could not load chat history: ${error.message}`, 'history_fetch_fail_send', handlerId);
        }

        try {
            let updatedHistory: HistoryItem[] | undefined | void = undefined;
            let resultAction: FrontendAction | undefined = undefined;

            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    logToFile(`[Socket ${socketId} ${handlerId}] Staging email confirmation...`);
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io);
                }
            };

            if (isStreaming) {
                updatedHistory = await handleStreaming(userInput, currentHistory, socket, language, handlerId, handleAction);
            } else {
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language, handlerId);
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    resultAction = handlerResult.action;
                    handleAction(resultAction);
                }
            }

            if (Array.isArray(updatedHistory)) {
                logToFile(`[${handlerId} Save History Check] History to save. Size: ${updatedHistory.length}.`);
                try {
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);
                    if (updateSuccess) {
                        logToFile(`[Socket ${socketId} ${handlerId}] Successfully updated history in DB for conv ${targetConversationId}.`);
                        // Emit updated list after successful message save
                        await emitUpdatedConversationList(currentUserId, 'message save');
                    } else {
                        sendChatError('Failed to save message history. Conversation might be out of sync.', 'history_save_fail_warn', handlerId);
                    }
                } catch (updateError: any) {
                    logToFile(`[Socket ${socketId} ${handlerId}] CRITICAL Error updating history for conv ${targetConversationId}: ${updateError.message}`);
                }
            } else {
                logToFile(`[Socket ${socketId} ${handlerId}] Intent handler did not return an updated history array. DB not updated.`);
            }

        } catch (handlerError: any) {
            sendChatError(`Error processing message: ${handlerError.message}`, 'handler_exception', handlerId);
        }
    });

    // --- Handlers cho Confirmation ---
    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) { return sendChatError('Authentication required.', 'auth_required'); }
        if (typeof data === 'object' && data !== null && 'confirmationId' in data && typeof (data as ConfirmationEventData).confirmationId === 'string' && (data as ConfirmationEventData).confirmationId.length > 0) {
            const confirmationId = (data as ConfirmationEventData).confirmationId;
            logToFile(`[Socket ${socketId}] Event '${eventName}' received for ID: ${confirmationId}, User: ${currentUserId}`);
            handleUserEmailConfirmation(confirmationId, socket);
        } else {
            logToFile(`[Socket ${socketId}] WARN: Received invalid '${eventName}' event data. Data: ${JSON.stringify(data)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) { return sendChatError('Authentication required.', 'auth_required'); }
        if (typeof data === 'object' && data !== null && 'confirmationId' in data && typeof (data as ConfirmationEventData).confirmationId === 'string' && (data as ConfirmationEventData).confirmationId.length > 0) {
            const confirmationId = (data as ConfirmationEventData).confirmationId;
            logToFile(`[Socket ${socketId}] Event '${eventName}' received for ID: ${confirmationId}, User: ${currentUserId}`);
            handleUserEmailCancellation(confirmationId, socket);
        } else {
            logToFile(`[Socket ${socketId}] WARN: Received invalid '${eventName}' event data. Data: ${JSON.stringify(data)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data.' });
        }
    });

    // --- NEW: Handler for Deleting a Conversation ---
    socket.on('delete_conversation', async (data: unknown) => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            return sendChatError('Authentication required to delete conversation.', 'auth_required_delete');
        }

        // Validate input data
        if (typeof data !== 'object' || data === null || !('conversationId' in data) || typeof (data as DeleteConversationData).conversationId !== 'string' || (data as DeleteConversationData).conversationId.length === 0) {
            return sendChatError('Invalid request: Missing or invalid conversation ID for deletion.', 'invalid_request_delete');
        }
        const conversationIdToDelete = (data as DeleteConversationData).conversationId;

        logToFile(`[Socket ${socketId}] Event 'delete_conversation' received for ID: ${conversationIdToDelete}, User: ${currentUserId}.`);

        try {
            const success = await conversationHistoryService.deleteConversation(conversationIdToDelete, currentUserId);

            if (success) {
                logToFile(`[Socket ${socketId}] Successfully processed deletion for conversation ${conversationIdToDelete}.`);
                // Emit confirmation back to the specific client
                socket.emit('conversation_deleted', { conversationId: conversationIdToDelete });

                // Check if the deleted conversation was the active one for this socket
                if (socket.data.currentConversationId === conversationIdToDelete) {
                    logToFile(`[Socket ${socketId}] Deleted conversation ${conversationIdToDelete} was active. Clearing active ID.`);
                    socket.data.currentConversationId = undefined; // Clear active ID on the socket
                }

                // Send the updated list back to the client
                await emitUpdatedConversationList(currentUserId, `deletion of ${conversationIdToDelete}`);

            } else {
                // Service returned false (not found or not authorized)
                sendChatError('Could not delete conversation. It might not exist or you may not have permission.', 'delete_fail_permission');
            }
        } catch (error: any) {
            // Catch errors thrown by the service (e.g., database connection issues)
            sendChatError(`Error deleting conversation: ${error.message}`, 'delete_fail_server');
        }
    });

    // --- NEW: Handler for Clearing Conversation Messages ---
    socket.on('clear_conversation', async (data: unknown) => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            return sendChatError('Authentication required to clear conversation.', 'auth_required_clear');
        }

        // Validate input data
        if (typeof data !== 'object' || data === null || !('conversationId' in data) || typeof (data as ClearConversationData).conversationId !== 'string' || (data as ClearConversationData).conversationId.length === 0) {
            return sendChatError('Invalid request: Missing or invalid conversation ID for clearing.', 'invalid_request_clear');
        }
        const conversationIdToClear = (data as ClearConversationData).conversationId;

        logToFile(`[Socket ${socketId}] Event 'clear_conversation' received for ID: ${conversationIdToClear}, User: ${currentUserId}.`);

        try {
            const success = await conversationHistoryService.clearConversationMessages(conversationIdToClear, currentUserId);

            if (success) {
                logToFile(`[Socket ${socketId}] Successfully processed message clearing for conversation ${conversationIdToClear}.`);
                // Emit confirmation back to the specific client
                socket.emit('conversation_cleared', { conversationId: conversationIdToClear });

                // If the cleared conversation is the currently active one for this socket,
                // we should notify the client to clear its message display.
                // Sending an empty history for the active chat is one way.
                if (socket.data.currentConversationId === conversationIdToClear) {
                    logToFile(`[Socket ${socketId}] Cleared conversation ${conversationIdToClear} was active. Emitting empty history.`);
                    socket.emit('initial_history', { conversationId: conversationIdToClear, messages: [] });
                }

                // Send the updated list back to the client (lastActivity changed)
                await emitUpdatedConversationList(currentUserId, `clearing of ${conversationIdToClear}`);

            } else {
                // Service returned false (not found or not authorized)
                sendChatError('Could not clear conversation messages. It might not exist or you may not have permission.', 'clear_fail_permission');
            }
        } catch (error: any) {
            // Catch errors thrown by the service
            sendChatError(`Error clearing conversation messages: ${error.message}`, 'clear_fail_server');
        }
    });


    logToFile(`[Socket ${socketId}] Core event handlers registered.`);
};