// src/socket/handlers/conversation.handler.ts
import { HandlerDependencies } from './handler.types';
// --- Import types ---
import {
    LoadConversationData,
    DeleteConversationData,
    ClearConversationData,
    RenameConversationData,
    PinConversationData,
    ClientConversationMetadata,
    RenameResult,
    NewConversationResult,
    ChatMessage,
    Language,
    ChatHistoryItem
} from '../../chatbot/shared/types';
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper';
// Import the new error utility
import { getErrorMessageAndStack } from '../../utils/errorUtils';

interface StartNewConversationPayload {
    language?: Language;
}

const CONVERSATION_HANDLER_NAME = 'ConversationHandler';

/**
 * Registers Socket.IO event handlers related to conversation management (e.g., listing, loading,
 * creating, deleting, clearing, renaming, pinning conversations).
 * These handlers interact with the `ConversationHistoryService`.
 *
 * @param {HandlerDependencies} deps - An object containing common dependencies for handlers.
 */
export const registerConversationHandlers = (deps: HandlerDependencies): void => {
    const {
        socket,
        conversationHistoryService,
        logToFile,
        socketId,
        sendChatError,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
    } = deps;

    const baseLogContext = `[${CONVERSATION_HANDLER_NAME}][${socketId}]`;

    logToFile(`${baseLogContext}[${deps.userId}] Registering conversation event handlers.`);

    socket.on('get_conversation_list', async () => {
        const eventName = 'get_conversation_list';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        logToFile(`[INFO] ${handlerLogContext} '${eventName}' request received.`);
        try {
            const userLanguage = socket.data.language as Language | undefined;
            const conversationList = await conversationHistoryService.getConversationListForUser(authenticatedUserId, undefined, userLanguage);
            socket.emit('conversation_list', conversationList as ClientConversationMetadata[]);
            logToFile(`[INFO] ${handlerLogContext} Sent conversation list. Count: ${conversationList.length}, Lang used: ${userLanguage || 'service_default'}.`);
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(handlerLogContext, 'Failed to retrieve conversation list.', 'list_fetch_fail', { error: errorMessage });
        }
    });

    socket.on('load_conversation', async (data: unknown) => {
        const eventName = 'load_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        logToFile(`[INFO] ${handlerLogContext} Raw '${eventName}' event received. Data: ${JSON.stringify(data)?.substring(0, 200) + (JSON.stringify(data)?.length > 200 ? '...' : '')}.`);

        if (!isLoadConversationData(data)) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_load');
        }
        const requestedConvId = data.conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${requestedConvId}]`;

        logToFile(`[INFO] ${convLogContext} 'load_conversation' request received.`);
        try {
            const history: ChatHistoryItem[] | null = await conversationHistoryService.getConversationHistory(requestedConvId, authenticatedUserId, DEFAULT_HISTORY_LIMIT);

            if (history === null) {
                return sendChatError(convLogContext, 'Conversation not found or access denied.', 'history_not_found_load', { conversationId: requestedConvId });
            }

            const frontendMessages: ChatMessage[] = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId;

            logToFile(`[DEBUG] ${convLogContext} Emitting 'initial_history'. Message Count: ${frontendMessages.length}.`);
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            logToFile(`[INFO] ${convLogContext} Sent conversation history. Set as active. Message Count: ${frontendMessages.length}.`);
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error loading conversation history: ${errorMessage}.`, 'history_load_fail_server', { conversationId: requestedConvId, error: errorMessage });
        }
    });

    socket.on('start_new_conversation', async (payload: unknown) => {
        const eventName = 'start_new_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        const parsedPayload = isStartNewConversationPayload(payload) ? payload : {};
        const language = parsedPayload.language;
        socket.data.language = language;

        logToFile(`[INFO] ${handlerLogContext} '${eventName}' request received. Language: ${language || 'N/A'}.`);
        try {
            const newConversationData: NewConversationResult = await conversationHistoryService.createNewConversation(authenticatedUserId, language);
            socket.data.currentConversationId = newConversationData.conversationId;
            const convLogContext = `${handlerLogContext}[Conv:${newConversationData.conversationId}]`;

            socket.emit('new_conversation_started', {
                conversationId: newConversationData.conversationId,
                title: newConversationData.title,
                lastActivity: newConversationData.lastActivity.toISOString(),
                isPinned: newConversationData.isPinned,
            });
            logToFile(`[INFO] ${convLogContext} Successfully started new conversation. Title: "${newConversationData.title}". Set as active.`);

            await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, 'new conversation started', language);
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(handlerLogContext, `Could not start new conversation: ${errorMessage}.`, 'new_conv_fail_server', { userId: authenticatedUserId, error: errorMessage });
        }
    });

    socket.on('delete_conversation', async (data: unknown) => {
        const eventName = 'delete_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (!isDeleteConversationData(data)) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_delete');
        }
        const conversationIdToDelete = data.conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToDelete}]`;

        logToFile(`[INFO] ${convLogContext} 'delete_conversation' request received.`);
        try {
            const success = await conversationHistoryService.deleteConversation(conversationIdToDelete, authenticatedUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed conversation deletion.`);
                socket.emit('conversation_deleted', { conversationId: conversationIdToDelete });
                if (socket.data.currentConversationId === conversationIdToDelete) {
                    socket.data.currentConversationId = undefined;
                }
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `deleted conversation ${conversationIdToDelete}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not delete conversation. Not found or no permission.', 'delete_fail_permission', { conversationId: conversationIdToDelete });
            }
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error deleting conversation: ${errorMessage}.`, 'delete_fail_server', { conversationId: conversationIdToDelete, error: errorMessage });
        }
    });

    socket.on('clear_conversation', async (data: unknown) => {
        const eventName = 'clear_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (!isClearConversationData(data)) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_clear');
        }
        const conversationIdToClear = data.conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToClear}]`;

        logToFile(`[INFO] ${convLogContext} 'clear_conversation' request received.`);
        try {
            const success = await conversationHistoryService.clearConversationMessages(conversationIdToClear, authenticatedUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed message clearing.`);
                socket.emit('conversation_cleared', { conversationId: conversationIdToClear });
                if (socket.data.currentConversationId === conversationIdToClear) {
                    socket.emit('initial_history', { conversationId: conversationIdToClear, messages: [] });
                }
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `cleared conversation ${conversationIdToClear}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not clear conversation. Not found or no permission.', 'clear_fail_permission', { conversationId: conversationIdToClear });
            }
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error clearing messages: ${errorMessage}.`, 'clear_fail_server', { conversationId: conversationIdToClear, error: errorMessage });
        }
    });

    socket.on('rename_conversation', async (data: unknown) => {
        const eventName = 'rename_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (!isRenameConversationData(data)) {
            return sendChatError(handlerLogContext, 'Invalid request for rename: Missing "conversationId" or "newTitle".', 'invalid_request_rename');
        }
        const { conversationId, newTitle } = data;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`;

        logToFile(`[INFO] ${convLogContext} 'rename_conversation' request received. New Title: "${newTitle.substring(0, 30) + (newTitle.length > 30 ? '...' : '')}".`);
        try {
            const renameOpResult: RenameResult = await conversationHistoryService.renameConversation(conversationId, authenticatedUserId, newTitle);
            if (renameOpResult.success) {
                socket.emit('conversation_renamed', { conversationId: renameOpResult.conversationId, newTitle: renameOpResult.updatedTitle });
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `renamed conv ${conversationId}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not rename conversation. Check ID, permissions, or title validity.', 'rename_fail_logic', { conversationId });
            }
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error renaming conversation: ${errorMessage}.`, 'rename_fail_server', { conversationId, error: errorMessage });
        }
    });

    socket.on('pin_conversation', async (data: unknown) => {
        const eventName = 'pin_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (!isPinConversationData(data)) {
            return sendChatError(handlerLogContext, 'Invalid request for pin: Missing "conversationId" or "isPinned".', 'invalid_request_pin');
        }
        const { conversationId, isPinned } = data;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`;

        logToFile(`[INFO] ${convLogContext} 'pin_conversation' request received. IsPinned: ${isPinned}.`);
        try {
            const success = await conversationHistoryService.pinConversation(conversationId, authenticatedUserId, isPinned);
            if (success) {
                socket.emit('conversation_pin_status_changed', { conversationId, isPinned });
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `pinned/unpinned conv ${conversationId}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not update pin status. Not found or no permission.', 'pin_fail', { conversationId });
            }
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error updating pin status: ${errorMessage}.`, 'pin_fail_server', { conversationId, error: errorMessage });
        }
    });

    logToFile(`${baseLogContext}[${deps.userId}] Conversation event handlers successfully registered.`);
};

function isLoadConversationData(data: unknown): data is LoadConversationData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as LoadConversationData).conversationId === 'string' &&
        !!(data as LoadConversationData).conversationId
    );
}

function isStartNewConversationPayload(payload: unknown): payload is StartNewConversationPayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        (typeof (payload as StartNewConversationPayload).language === 'string' || (payload as StartNewConversationPayload).language === undefined)
    );
}

function isDeleteConversationData(data: unknown): data is DeleteConversationData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as DeleteConversationData).conversationId === 'string' &&
        !!(data as DeleteConversationData).conversationId
    );
}

function isClearConversationData(data: unknown): data is ClearConversationData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as ClearConversationData).conversationId === 'string' &&
        !!(data as ClearConversationData).conversationId
    );
}

function isRenameConversationData(data: unknown): data is RenameConversationData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as RenameConversationData).conversationId === 'string' &&
        !!(data as RenameConversationData).conversationId &&
        typeof (data as RenameConversationData).newTitle === 'string'
    );
}

function isPinConversationData(data: unknown): data is PinConversationData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as PinConversationData).conversationId === 'string' &&
        !!(data as PinConversationData).conversationId &&
        typeof (data as PinConversationData).isPinned === 'boolean'
    );
}