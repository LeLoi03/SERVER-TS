// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { Logger } from 'pino'; // Import Logger type
import { LoggingService } from '../../services/logging.service'; // Adjust path if needed
import { ConversationHistoryService, ConversationMetadata } from '../../chatbot/services/conversationHistory.service'; // Adjust path, import Metadata
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper'; // Adjust path, import FrontendMessage
import { handleStreaming, handleNonStreaming } from '../../chatbot/handlers/intentHandler'; // Adjust path
import { stageEmailConfirmation, handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager'; // Adjust path
// --- Import types ---
import {
    HistoryItem,
    FrontendAction,
    ConfirmSendEmailAction,
    ErrorUpdate, // Ensure this is correctly defined/used
    SendMessageData,
    LoadConversationData,
    ConfirmationEventData,
    DeleteConversationData,
    ClearConversationData,
    Language, // Assuming Language is defined here or imported
    WarningUpdate,
    ChatMessage,
    RenameConversationData,
    PinConversationData,
    SearchConversationsData,
    ClientConversationMetadata, // Nếu bạn dùng type riêng cho client
    RenameResult
} from '../../chatbot/shared/types'; // Adjust path if needed

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

    // --- Resolve Dependencies (Singleton Pattern) ---
    // These services are resolved once per socket connection when handlers are registered.
    let loggingService: LoggingService;
    let conversationHistoryService: ConversationHistoryService;
    try {
        loggingService = container.resolve(LoggingService);
        conversationHistoryService = container.resolve(ConversationHistoryService);
    } catch (error: any) {
        // Critical error if services cannot be resolved. Log and potentially disconnect/error out.
        console.error(`[${CORE_HANDLER_NAME}] CRITICAL: Failed to resolve core services for socket ${socketId}: ${error.message}`);
        socket.emit('critical_error', { message: "Server configuration error. Please try reconnecting later." });
        socket.disconnect(true); // Disconnect the socket as it cannot function
        return; // Stop registration
    }

    // --- Create Logger Context ---
    // Base logger for this specific socket connection's core handlers
    const logger = loggingService.getLogger({ socketId, handler: CORE_HANDLER_NAME });

    // Log initial registration attempt
    logger.info({ userId: socket.data.userId || 'Anonymous' }, 'Registering core event handlers for connection.');

    // --- Helper Functions ---

    /**
     * Sends a structured error message to the client via 'chat_error' event and logs it.
     * @param log - The specific Pino logger instance (often a child logger) for context.
     * @param message - The user-facing error message.
     * @param step - A machine-readable code indicating where the error occurred.
     * @param details - Optional additional details for logging.
     */
    const sendChatError = (log: Logger, message: string, step: string, details?: Record<string, any>): void => {
        log.error({ step, errorMsg: message, ...details }, 'Chat error occurred');
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    /**
     * Sends a structured warning message to the client via 'chat_warning' event and logs it.
     * @param log - The specific Pino logger instance.
     * @param message - The user-facing warning message.
     * @param step - A machine-readable code indicating the context of the warning.
     * @param details - Optional additional details for logging.
     */
    const sendChatWarning = (log: Logger, message: string, step: string, details?: Record<string, any>): void => {
        log.warn({ step, warningMsg: message, ...details }, 'Chat warning occurred');
        socket.emit('chat_warning', { type: 'warning', message, step } as WarningUpdate);
    };


    /**
     * Fetches the updated conversation list for the user and emits it via 'conversation_list'.
     * Logs success or failure.
     * @param log - The specific Pino logger instance for context.
     * @param userId - The ID of the user whose list should be updated.
     * @param reason - A brief description of why the list is being updated (for logging).
     */
    const emitUpdatedConversationList = async (log: Logger, userId: string, reason: string): Promise<void> => {
        log.debug({ userId, reason }, 'Attempting to fetch and emit updated conversation list.');
        try {
            // Sử dụng ConversationMetadata từ service
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userId);
            // Client có thể cần map lại sang ClientConversationMetadata nếu type khác
            socket.emit('conversation_list', updatedList as ClientConversationMetadata[]);
            log.info({ userId, reason, count: updatedList.length }, 'Emitted updated conversation list.');
        } catch (error: any) {
            log.warn({ userId, reason, error: error.message }, 'Failed to fetch/emit updated conversation list.');
        }
    };

    /**
     * Centralized authentication check for handlers.
     * @param log The logger instance for the specific handler.
     * @param eventName The name of the event being handled.
     * @returns The userId if authenticated, otherwise null (and sends error).
     */
    const ensureAuthenticated = (log: Logger, eventName: string): string | null => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            sendChatError(log, `Authentication required for ${eventName}.`, 'auth_required', { event: eventName });
            return null;
        }
        return currentUserId;
    };

    // --- Event Handlers ---

    // --- Handler: Get Conversation List ---
    socket.on('get_conversation_list', async () => {
        const eventName = 'get_conversation_list';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        handlerLogger.info({ userId: currentUserId }, 'Request received.');
        // Service trả về mảng rỗng nếu lỗi, không cần try-catch ở đây trừ khi muốn xử lý đặc biệt
        const conversationList = await conversationHistoryService.getConversationListForUser(currentUserId);
        socket.emit('conversation_list', conversationList as ClientConversationMetadata[]);
        handlerLogger.info({ userId: currentUserId, count: conversationList.length }, 'Sent conversation list.');
    });


    // --- Handler: Load Specific Conversation ---
    socket.on('load_conversation', async (data: unknown) => {
        const eventName = 'load_conversation';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        // Improved validation
        if (typeof data !== 'object' || data === null || typeof (data as LoadConversationData)?.conversationId !== 'string' || !(data as LoadConversationData).conversationId) {
            return sendChatError(handlerLogger, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_load');
        }
        const requestedConvId = (data as LoadConversationData).conversationId;

        handlerLogger.info({ conversationId: requestedConvId, userId: currentUserId }, 'Request received.');

        try {
            // Use constant for limit
            const history = await conversationHistoryService.getConversationHistory(requestedConvId, currentUserId, DEFAULT_HISTORY_LIMIT);

            if (history === null) {
                // Handles not found, not authorized, or invalid ID format cases
                return sendChatError(handlerLogger, 'Conversation not found or access denied.', 'history_not_found_load', { conversationId: requestedConvId });
            }

            const frontendMessages: ChatMessage[] = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId; // Set active conversation on the socket
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            handlerLogger.info({ conversationId: requestedConvId, messageCount: frontendMessages.length }, 'Sent history. Set as active conversation.');

        } catch (error: any) {
            // Catch errors thrown by getConversationHistory (unexpected DB errors)
            sendChatError(handlerLogger, `Server error loading conversation history.`, 'history_load_fail_server', { conversationId: requestedConvId, error: error.message });
        }
    });

    // --- Handler: Start New Conversation ---
    socket.on('start_new_conversation', async () => {
        const eventName = 'start_new_conversation';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        handlerLogger.info({ userId: currentUserId }, 'Request received.');
        try {
            const { conversationId } = await conversationHistoryService.createNewConversation(currentUserId);
            socket.data.currentConversationId = conversationId; // Set new conversation as active
            socket.emit('new_conversation_started', { conversationId });
            handlerLogger.info({ conversationId, userId: currentUserId }, 'Started new conversation. Set as active.');
            // Update the list on the frontend
            await emitUpdatedConversationList(handlerLogger, currentUserId, 'new conversation started');

        } catch (error: any) {
            sendChatError(handlerLogger, `Could not start new conversation.`, 'new_conv_fail_server', { userId: currentUserId, error: error.message });
        }
    });

    // --- Handler: Send Message ---
    socket.on('send_message', async (data: unknown) => {
        const eventName = 'send_message';
        const handlerId = `Msg-${socketId.substring(0, 4)}-${Date.now()}`;
        const handlerLogger = logger.child({ event: eventName, handlerId });

        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;
        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogger, 'Authentication session error. Please re-login.', 'missing_token_auth', { userId: currentUserId });
        }

        if (
            typeof data !== 'object' || data === null ||
            typeof (data as SendMessageData)?.userInput !== 'string' || !(data as SendMessageData).userInput?.trim() ||
            typeof (data as SendMessageData)?.language !== 'string' || !(data as SendMessageData).language
        ) {
            return sendChatError(handlerLogger, 'Invalid message data: Missing or invalid "userInput" or "language".', 'invalid_input_send');
        }
        const { userInput, isStreaming = true, language } = data as SendMessageData;
        const activeConversationId = socket.data.currentConversationId as string | undefined;

        handlerLogger.info(
            {
                userInputPreview: userInput.substring(0, 30) + (userInput.length > 30 ? '...' : ''),
                isStreaming,
                language,
                userId: currentUserId,
                activeConvId: activeConversationId || 'None (will create)'
            },
            'Request received.'
        );

        let targetConversationId: string;

        if (activeConversationId) {
            targetConversationId = activeConversationId;
        } else {
            handlerLogger.info('No active conversation set. Creating new conversation implicitly.');
            try {
                const { conversationId: newConvId } = await conversationHistoryService.createNewConversation(currentUserId);
                targetConversationId = newConvId;
                socket.data.currentConversationId = newConvId;
                handlerLogger.info({ newConvId: targetConversationId }, 'Implicitly created and set active conversation.');
                socket.emit('new_conversation_started', { conversationId: targetConversationId });
                await emitUpdatedConversationList(handlerLogger, currentUserId, 'implicit new conversation');
            } catch (error: any) {
                return sendChatError(handlerLogger, `Could not start chat session.`, 'implicit_new_conv_fail', { userId: currentUserId, error: error.message });
            }
        }

        let currentHistory: HistoryItem[];
        try {
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, currentUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                handlerLogger.error({ convId: targetConversationId, userId: currentUserId }, 'Failed to fetch history for supposedly active conversation.');
                socket.data.currentConversationId = undefined;
                return sendChatError(handlerLogger, 'Chat session error. Please select a conversation or start a new one.', 'history_not_found_send');
            }
            currentHistory = fetchedHistory;
            handlerLogger.info({ convId: targetConversationId, historyCount: currentHistory.length }, 'Fetched current history.');
        } catch (error: any) {
            return sendChatError(handlerLogger, `Could not load chat history.`, 'history_fetch_fail_send', { convId: targetConversationId, error: error.message });
        }

        try {
            let updatedHistory: HistoryItem[] | void | undefined = undefined; // <<< Sửa: có thể là void từ streaming
            let resultAction: FrontendAction | undefined = undefined;

            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    handlerLogger.info({ confirmationId: action.payload.confirmationId }, 'Staging email confirmation action.');
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io /*, handlerLogger */);
                }
            };

            if (isStreaming) {
                handlerLogger.debug({ convId: targetConversationId }, 'Calling streaming intent handler.');
                // <<< SỬA: Gán kết quả trả về từ handleStreaming >>>
                updatedHistory = await handleStreaming(userInput, currentHistory, socket, language as Language, handlerId, handleAction /*, handlerLogger */);
                // <<< Không cần gán updatedHistory = undefined nữa >>>
            } else {
                handlerLogger.debug({ convId: targetConversationId }, 'Calling non-streaming intent handler.');
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language as Language, handlerId /*, handlerLogger */);
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    resultAction = handlerResult.action;
                    handleAction(resultAction);
                }
            }

            // <<< SỬA: Chỉ còn một khối if để lưu history >>>
            if (Array.isArray(updatedHistory)) {
                handlerLogger.info({ convId: targetConversationId, newHistorySize: updatedHistory.length }, 'Intent handler returned updated history. Attempting save.');
                try {
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);

                    if (updateSuccess) {
                        handlerLogger.info({ convId: targetConversationId }, 'Successfully updated history in DB.');
                        await emitUpdatedConversationList(handlerLogger, currentUserId, 'message saved');
                    } else {
                        handlerLogger.error({ convId: targetConversationId }, 'History save failed: Target conversation not found or unauthorized during update.');
                        sendChatWarning(handlerLogger, 'Failed to save message history. Conversation might be out of sync.', 'history_save_fail_target');
                    }
                } catch (dbError: any) {
                    handlerLogger.error({ convId: targetConversationId, error: dbError.message, stack: dbError.stack }, 'CRITICAL: Error updating history in DB.');
                    sendChatError(handlerLogger, 'A critical error occurred while saving your message.', 'history_save_exception', { error: dbError.message });
                }
            } else {
                // Log này giờ áp dụng cho streaming trả về void/undefined, hoặc non-streaming không trả về history
                handlerLogger.info({ convId: targetConversationId, reason: isStreaming ? 'Streaming handler did not return history or returned void' : 'Non-streaming returned no history' }, 'No history array returned by handler for explicit DB update here. DB not updated by this block.');
            }

        } catch (handlerError: any) {
            handlerLogger.error({ error: handlerError.message, stack: handlerError.stack }, 'Error processing message via intent handler');
            sendChatError(handlerLogger, `Error processing message: ${handlerError.message}`, 'handler_exception', { error: handlerError.message });
        }
    });

    // --- Handlers for Email Confirmation ---
    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            handlerLogger.info({ confirmationId, userId: currentUserId }, 'Request received.');
            // TODO: Refactor handleUserEmailConfirmation to accept logger instance
            handleUserEmailConfirmation(confirmationId, socket /*, handlerLogger */);
        } else {
            handlerLogger.warn({ dataReceived: JSON.stringify(data)?.substring(0, 100) }, 'Received invalid event data.');
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data received.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            handlerLogger.info({ confirmationId, userId: currentUserId }, 'Request received.');
            // TODO: Refactor handleUserEmailCancellation to accept logger instance
            handleUserEmailCancellation(confirmationId, socket /*, handlerLogger */);
        } else {
            handlerLogger.warn({ dataReceived: JSON.stringify(data)?.substring(0, 100) }, 'Received invalid event data.');
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data received.' });
        }
    });

    // --- Handler: Delete Conversation ---
    socket.on('delete_conversation', async (data: unknown) => {
        const eventName = 'delete_conversation';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as DeleteConversationData)?.conversationId !== 'string' || !(data as DeleteConversationData).conversationId) {
            return sendChatError(handlerLogger, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_delete');
        }
        const conversationIdToDelete = (data as DeleteConversationData).conversationId;

        handlerLogger.info({ conversationId: conversationIdToDelete, userId: currentUserId }, 'Request received.');
        try {
            const success = await conversationHistoryService.deleteConversation(conversationIdToDelete, currentUserId);
            if (success) {
                handlerLogger.info({ conversationId: conversationIdToDelete }, 'Successfully processed deletion.');
                socket.emit('conversation_deleted', { conversationId: conversationIdToDelete });
                // If the deleted conversation was the currently active one, clear it
                if (socket.data.currentConversationId === conversationIdToDelete) {
                    handlerLogger.info({ conversationId: conversationIdToDelete }, 'Deleted conversation was active. Clearing active ID.');
                    socket.data.currentConversationId = undefined;
                }
                // Update the list on the frontend
                await emitUpdatedConversationList(handlerLogger, currentUserId, `deleted conversation ${conversationIdToDelete}`);
            } else {
                // Service returned false (not found or not authorized)
                sendChatError(handlerLogger, 'Could not delete conversation. It might not exist or you may not have permission.', 'delete_fail_permission', { conversationId: conversationIdToDelete });
            }
        } catch (error: any) {
            // Catch unexpected DB errors during deletion
            sendChatError(handlerLogger, `Server error deleting conversation.`, 'delete_fail_server', { conversationId: conversationIdToDelete, error: error.message });
        }
    });

    // --- Handler: Clear Conversation Messages ---
    socket.on('clear_conversation', async (data: unknown) => {
        const eventName = 'clear_conversation';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as ClearConversationData)?.conversationId !== 'string' || !(data as ClearConversationData).conversationId) {
            return sendChatError(handlerLogger, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_clear');
        }
        const conversationIdToClear = (data as ClearConversationData).conversationId;

        handlerLogger.info({ conversationId: conversationIdToClear, userId: currentUserId }, 'Request received.');
        try {
            const success = await conversationHistoryService.clearConversationMessages(conversationIdToClear, currentUserId);
            if (success) {
                handlerLogger.info({ conversationId: conversationIdToClear }, 'Successfully processed message clearing.');
                socket.emit('conversation_cleared', { conversationId: conversationIdToClear }); // Inform client
                // If the cleared conversation is active, send empty history to reset the view
                if (socket.data.currentConversationId === conversationIdToClear) {
                    handlerLogger.info({ conversationId: conversationIdToClear }, 'Cleared conversation was active. Emitting empty history.');
                    socket.emit('initial_history', { conversationId: conversationIdToClear, messages: [] });
                }
                // Update the list on the frontend (lastActivity time changes)
                await emitUpdatedConversationList(handlerLogger, currentUserId, `cleared conversation ${conversationIdToClear}`);
            } else {
                // Service returned false (not found or not authorized)
                sendChatError(handlerLogger, 'Could not clear conversation messages. It might not exist or you may not have permission.', 'clear_fail_permission', { conversationId: conversationIdToClear });
            }
        } catch (error: any) {
            // Catch unexpected DB errors during clear
            sendChatError(handlerLogger, `Server error clearing conversation messages.`, 'clear_fail_server', { conversationId: conversationIdToClear, error: error.message });
        }
    });

    // --- Handler: Rename Conversation ---
    socket.on('rename_conversation', async (data: unknown) => {
        const eventName = 'rename_conversation';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        const payload = data as RenameConversationData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.newTitle !== 'string'
        ) {
            return sendChatError(handlerLogger, 'Invalid request: Missing or invalid "conversationId" or "newTitle".', 'invalid_request_rename');
        }
        const { conversationId, newTitle } = payload;
        handlerLogger.info({ conversationId, newTitlePreview: newTitle.substring(0, 30), userId: currentUserId }, 'Request received.');

        try {
            // Gọi service method và nhận kết quả chi tiết hơn
            const renameOpResult: RenameResult = await conversationHistoryService.renameConversation(conversationId, currentUserId, newTitle);

            if (renameOpResult.success) {
                handlerLogger.info({ conversationId, updatedTitle: renameOpResult.updatedTitle }, 'Successfully renamed conversation.');
                // Sử dụng updatedTitle từ kết quả của service
                socket.emit('conversation_renamed', {
                    conversationId: renameOpResult.conversationId,
                    newTitle: renameOpResult.updatedTitle // Đây là tiêu đề đã được xử lý bởi service
                });
                await emitUpdatedConversationList(handlerLogger, currentUserId, `renamed conv ${conversationId}`);
            } else {
                // Service đã xử lý lỗi logic (ví dụ: không tìm thấy, title không hợp lệ)
                sendChatError(handlerLogger, 'Could not rename. Check ID, permissions, or title validity.', 'rename_fail_logic', { conversationId });
            }
        } catch (error: any) {
            // Lỗi không mong muốn từ service (ví dụ: lỗi DB)
            sendChatError(handlerLogger, 'Server error renaming conversation.', 'rename_fail_server', { conversationId, error: error.message });
        }
    });

    // --- Handler: Pin Conversation ---
    socket.on('pin_conversation', async (data: unknown) => {
        const eventName = 'pin_conversation';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        const payload = data as PinConversationData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.isPinned !== 'boolean'
        ) {
            return sendChatError(handlerLogger, 'Invalid request: Missing or invalid "conversationId" or "isPinned" status.', 'invalid_request_pin');
        }
        const { conversationId, isPinned } = payload;
        handlerLogger.info({ conversationId, isPinned, userId: currentUserId }, 'Request received.');

        try {
            const success = await conversationHistoryService.pinConversation(conversationId, currentUserId, isPinned);
            if (success) {
                handlerLogger.info({ conversationId, isPinned }, 'Successfully updated pin status.');
                socket.emit('conversation_pin_status_changed', { conversationId, isPinned });
                await emitUpdatedConversationList(handlerLogger, currentUserId, `pinned/unpinned conv ${conversationId}`);
            } else {
                sendChatError(handlerLogger, 'Could not update pin status. Check ID or permissions.', 'pin_fail', { conversationId });
            }
        } catch (error: any) {
            sendChatError(handlerLogger, 'Server error updating pin status.', 'pin_fail_server', { conversationId, error: error.message });
        }
    });

    // --- Handler: Search Conversations ---
    socket.on('search_conversations', async (data: unknown) => {
        const eventName = 'search_conversations';
        const handlerLogger = logger.child({ event: eventName });
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;

        const payload = data as SearchConversationsData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.searchTerm !== 'string' // Cho phép searchTerm rỗng, service sẽ xử lý
        ) {
            return sendChatError(handlerLogger, 'Invalid request: Missing or invalid "searchTerm".', 'invalid_request_search');
        }
        const { searchTerm, limit } = payload; // limit có thể undefined
        handlerLogger.info({ searchTermPreview: searchTerm.substring(0, 30), limit, userId: currentUserId }, 'Request received.');

        // Service trả về mảng rỗng nếu không tìm thấy hoặc lỗi, không cần try-catch trừ khi muốn xử lý đặc biệt
        const searchResults: ConversationMetadata[] = await conversationHistoryService.searchConversationsByTerm(currentUserId, searchTerm, limit);

        socket.emit('conversation_search_results', searchResults as ClientConversationMetadata[]);
        handlerLogger.info({ searchTermPreview: searchTerm.substring(0, 30), count: searchResults.length }, 'Sent search results.');
    });

    // Log successful registration
    logger.info('Core event handlers successfully registered.');
};