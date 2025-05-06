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
    ChatMessage
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
        const errorPayload: ErrorUpdate = { type: 'error', message, step };
        socket.emit('chat_error', errorPayload);
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
        const warningPayload: WarningUpdate = { type: 'warning', message, step }; // Reuse ErrorUpdate type for warnings
        socket.emit('chat_warning', warningPayload); // Use a different event for warnings
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
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userId);
            socket.emit('conversation_list', updatedList);
            log.info({ userId, reason, count: updatedList.length }, 'Emitted updated conversation list.');
        } catch (error: any) {
            // Log warning, don't send error to client for this background update failure
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
            sendChatError(log, `Authentication required to perform action: ${eventName}.`, 'auth_required', { event: eventName });
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
        try {
            const conversationList = await conversationHistoryService.getConversationListForUser(currentUserId);
            socket.emit('conversation_list', conversationList);
            handlerLogger.info({ userId: currentUserId, count: conversationList.length }, 'Sent conversation list.');
        } catch (error: any) {
            // Service itself doesn't throw for list, but catch potential unexpected errors
            sendChatError(handlerLogger, `Server error fetching conversation list.`, 'list_fetch_fail_unexpected', { error: error.message });
        }
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
        // Generate a unique ID for this specific message processing flow
        const handlerId = `Msg-${socketId.substring(0, 4)}-${Date.now()}`;
        const handlerLogger = logger.child({ event: eventName, handlerId });

        // Authentication and Token Check
        const currentUserId = ensureAuthenticated(handlerLogger, eventName);
        if (!currentUserId) return;
        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogger, 'Authentication session error. Please re-login.', 'missing_token_auth', { userId: currentUserId });
        }

        // Input Validation
        // Consider using a validation library (like Zod) for complex objects
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

        // 1. Ensure a Target Conversation Exists
        if (activeConversationId) {
            targetConversationId = activeConversationId;
        } else {
            handlerLogger.info('No active conversation set. Creating new conversation implicitly.');
            try {
                const { conversationId: newConvId } = await conversationHistoryService.createNewConversation(currentUserId);
                targetConversationId = newConvId;
                socket.data.currentConversationId = newConvId; // Set the newly created one as active
                handlerLogger.info({ newConvId: targetConversationId }, 'Implicitly created and set active conversation.');
                socket.emit('new_conversation_started', { conversationId: targetConversationId }); // Inform client
                await emitUpdatedConversationList(handlerLogger, currentUserId, 'implicit new conversation');
            } catch (error: any) {
                return sendChatError(handlerLogger, `Could not start chat session.`, 'implicit_new_conv_fail', { userId: currentUserId, error: error.message });
            }
        }

        // 2. Fetch Current History for the Target Conversation
        let currentHistory: HistoryItem[];
        try {
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, currentUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                // This might happen if the activeConversationId is somehow invalid or belongs to another user (edge case)
                handlerLogger.error({ convId: targetConversationId, userId: currentUserId }, 'Failed to fetch history for supposedly active conversation.');
                socket.data.currentConversationId = undefined; // Clear potentially invalid active ID
                return sendChatError(handlerLogger, 'Chat session error. Please select a conversation or start a new one.', 'history_not_found_send');
            }
            currentHistory = fetchedHistory;
            handlerLogger.info({ convId: targetConversationId, historyCount: currentHistory.length }, 'Fetched current history.');
        } catch (error: any) {
            return sendChatError(handlerLogger, `Could not load chat history.`, 'history_fetch_fail_send', { convId: targetConversationId, error: error.message });
        }

        // 3. Process User Input via Intent Handler
        try {
            let updatedHistory: HistoryItem[] | undefined = undefined;
            let resultAction: FrontendAction | undefined = undefined;

            // Action handler closure - captures handlerLogger, token, etc.
            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    handlerLogger.info({ confirmationId: action.payload.confirmationId }, 'Staging email confirmation action.');
                    // TODO: Refactor stageEmailConfirmation to accept logger instance
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io /*, handlerLogger */);
                }
                // Handle other action types here if needed
            };

            // Call the appropriate intent handler
            // Call the appropriate intent handler
            if (isStreaming) {
                handlerLogger.debug({ convId: targetConversationId }, 'Calling streaming intent handler.');
                // TODO: Refactor handleStreaming to accept logger instance
                // <<< KHÔNG GÁN KẾT QUẢ >>>
                await handleStreaming(userInput, currentHistory, socket, language as Language, handlerId, handleAction /*, handlerLogger */);
                // <<< Set updatedHistory thành undefined vì streaming tự xử lý emit >>>
                updatedHistory = undefined;
            } else {
                handlerLogger.debug({ convId: targetConversationId }, 'Calling non-streaming intent handler.');
                // TODO: Refactor handleNonStreaming to accept logger instance
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language as Language, handlerId /*, handlerLogger */);
                if (handlerResult) {
                    updatedHistory = handlerResult.history; // Chỉ gán khi non-streaming
                    resultAction = handlerResult.action;
                    handleAction(resultAction); // Handle action from non-streaming result
                } else {
                    updatedHistory = undefined; // Không có kết quả từ non-streaming
                }
            }

            // 4. Save Updated History (if returned by non-streaming handler)
            // <<< Chỉ lưu nếu updatedHistory là một mảng (tức là từ non-streaming) >>>
            if (Array.isArray(updatedHistory)) {
                handlerLogger.info({ convId: targetConversationId, newHistorySize: updatedHistory.length }, 'Non-streaming handler returned updated history. Attempting save.');
                try {
                    // Use the service to update the history
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);

                    if (updateSuccess) {
                        handlerLogger.info({ convId: targetConversationId }, 'Successfully updated history in DB.');
                        // Optionally emit updated list *after* successful save
                        await emitUpdatedConversationList(handlerLogger, currentUserId, 'message saved');
                    } else {
                        // The update targeted a non-existent/unauthorized conversation
                        handlerLogger.error({ convId: targetConversationId }, 'History save failed: Target conversation not found or unauthorized during update.');
                        sendChatWarning(handlerLogger, 'Failed to save message history. Conversation might be out of sync.', 'history_save_fail_target');
                    }
                } catch (dbError: any) {
                    // Catch actual database exceptions during the update
                    handlerLogger.error({ convId: targetConversationId, error: dbError.message }, 'CRITICAL: Error updating history in DB.');
                    sendChatError(handlerLogger, 'A critical error occurred while saving your message.', 'history_save_exception', { error: dbError.message });
                }
            } else {
                // Log này giờ áp dụng cho cả streaming (luôn là undefined) và non-streaming không trả về history
                handlerLogger.info({ convId: targetConversationId, reason: isStreaming ? 'Streaming handled emits' : 'Non-streaming returned no history' }, 'No history array returned by handler. DB not updated.');
            }

            // 4. Save Updated History (if returned by handler)
            if (Array.isArray(updatedHistory)) {
                handlerLogger.info({ convId: targetConversationId, newHistorySize: updatedHistory.length }, 'Intent handler returned updated history. Attempting save.');
                try {
                    // Use the service to update the history
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);

                    if (updateSuccess) {
                        handlerLogger.info({ convId: targetConversationId }, 'Successfully updated history in DB.');
                        // Optionally emit updated list *after* successful save
                        await emitUpdatedConversationList(handlerLogger, currentUserId, 'message saved');
                    } else {
                        // The update targeted a non-existent/unauthorized conversation (should be rare if fetched history worked)
                        handlerLogger.error({ convId: targetConversationId }, 'History save failed: Target conversation not found or unauthorized during update.');
                        // Send a warning to the client - data might be slightly stale
                        sendChatWarning(handlerLogger, 'Failed to save message history. Conversation might be out of sync.', 'history_save_fail_target');
                    }
                } catch (dbError: any) {
                    // Catch actual database exceptions during the update
                    handlerLogger.error({ convId: targetConversationId, error: dbError.message }, 'CRITICAL: Error updating history in DB.');
                    sendChatError(handlerLogger, 'A critical error occurred while saving your message.', 'history_save_exception', { error: dbError.message });
                }
            } else {
                handlerLogger.info({ convId: targetConversationId }, 'Intent handler did not return an updated history array. DB not updated.');
            }

        } catch (handlerError: any) {
            // Catch errors thrown *by* the intent handlers (handleStreaming/handleNonStreaming)
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

    // Log successful registration
    logger.info('Core event handlers successfully registered.');
};

// --- TODO ---
// 1. Refactor external functions (handleStreaming, handleNonStreaming, stageEmailConfirmation, handleUserEmailConfirmation, handleUserEmailCancellation)
//    to accept a Pino Logger instance (`handlerLogger`) as an argument for consistent, contextual logging.
// 2. Consider implementing more robust data validation using a library like Zod, especially for the `send_message` payload.
// 3. Define the `ErrorUpdate` type more formally if it's used for both errors and warnings, perhaps renaming it or creating a separate `WarningUpdate` type.