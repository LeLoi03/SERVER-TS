// src/socket/handlers/conversation.handler.ts
import { HandlerDependencies } from './handler.types';
// --- Import types --- (chỉ những type cần thiết cho file này)
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
    Language
} from '../../chatbot/shared/types';
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper';

interface StartNewConversationPayload { // Giữ lại type này nếu chỉ dùng ở đây
    language?: Language;
}

const CONVERSATION_HANDLER_NAME = 'conversationHandler';

export const registerConversationHandlers = (deps: HandlerDependencies): void => {
    const {
        socket,
        conversationHistoryService,
        logToFile,
        userId: currentUserId, // Lấy userId từ deps, nhưng sẽ re-check bằng ensureAuthenticated
        socketId,
        sendChatError,
        emitUpdatedConversationList,
        ensureAuthenticated,
    } = deps;

    const baseLogContext = `[${CONVERSATION_HANDLER_NAME}][${socketId}]`; // userId sẽ được thêm sau khi xác thực

    logToFile(`${baseLogContext}[${currentUserId}] Registering conversation event handlers.`);

    socket.on('get_conversation_list', async () => {
        const eventName = 'get_conversation_list';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        logToFile(`[INFO] ${handlerLogContext} '${eventName}' request received.`);
        try {
            const userLanguage = socket.data.language as string | undefined;
            const conversationList = await conversationHistoryService.getConversationListForUser(authenticatedUserId, undefined, userLanguage);
            socket.emit('conversation_list', conversationList as ClientConversationMetadata[]);
            logToFile(`[INFO] ${handlerLogContext} Sent conversation list. Count: ${conversationList.length}, Lang used: ${userLanguage || 'service_default'}`);
        } catch (error: any) {
            sendChatError(handlerLogContext, 'Failed to retrieve conversation list.', 'list_fetch_fail', { error: error.message });
        }
    });

    socket.on('load_conversation', async (data: unknown) => {
        const eventName = 'load_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        logToFile(`[INFO] ${handlerLogContext} Raw '${eventName}' event received. Data: ${JSON.stringify(data)?.substring(0, 200) + (JSON.stringify(data)?.length > 200 ? '...' : '')}`);

        if (typeof data !== 'object' || data === null || typeof (data as LoadConversationData)?.conversationId !== 'string' || !(data as LoadConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_load');
        }
        const requestedConvId = (data as LoadConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${requestedConvId}]`;

        logToFile(`[INFO] ${convLogContext} Request received.`);
        try {
            const history = await conversationHistoryService.getConversationHistory(requestedConvId, authenticatedUserId, deps.DEFAULT_HISTORY_LIMIT);

            if (history === null) {
                return sendChatError(convLogContext, 'Conversation not found or access denied.', 'history_not_found_load', { conversationId: requestedConvId });
            }

            const frontendMessages: ChatMessage[] = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId;
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            logToFile(`[INFO] ${convLogContext} Sent history. Set as active. Message Count: ${frontendMessages.length}`);
        } catch (error: any) {
            sendChatError(convLogContext, `Server error loading conversation history.`, 'history_load_fail_server', { conversationId: requestedConvId, error: error.message });
        }
    });

    socket.on('start_new_conversation', async (payload: StartNewConversationPayload) => {
        const eventName = 'start_new_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        const language = payload?.language;
        socket.data.language = language;

        logToFile(`[INFO] ${handlerLogContext} Request received. Language: ${language || 'N/A'}`);
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
            logToFile(`[INFO] ${convLogContext} Started new conversation. Title: "${newConversationData.title}". Set as active.`);
            await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, 'new conversation started', language);
        } catch (error: any) {
            sendChatError(handlerLogContext, `Could not start new conversation.`, 'new_conv_fail_server', { userId: authenticatedUserId, error: error.message });
        }
    });

    socket.on('delete_conversation', async (data: unknown) => {
        const eventName = 'delete_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (typeof data !== 'object' || data === null || typeof (data as DeleteConversationData)?.conversationId !== 'string' || !(data as DeleteConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_delete');
        }
        const conversationIdToDelete = (data as DeleteConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToDelete}]`;

        logToFile(`[INFO] ${convLogContext} Request received.`);
        try {
            const success = await conversationHistoryService.deleteConversation(conversationIdToDelete, authenticatedUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed deletion.`);
                socket.emit('conversation_deleted', { conversationId: conversationIdToDelete });
                if (socket.data.currentConversationId === conversationIdToDelete) {
                    socket.data.currentConversationId = undefined;
                }
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `deleted conversation ${conversationIdToDelete}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not delete. Not found or no permission.', 'delete_fail_permission', { conversationId: conversationIdToDelete });
            }
        } catch (error: any) {
            sendChatError(convLogContext, `Server error deleting conversation.`, 'delete_fail_server', { conversationId: conversationIdToDelete, error: error.message });
        }
    });

    socket.on('clear_conversation', async (data: unknown) => {
        const eventName = 'clear_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (typeof data !== 'object' || data === null || typeof (data as ClearConversationData)?.conversationId !== 'string' || !(data as ClearConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_clear');
        }
        const conversationIdToClear = (data as ClearConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToClear}]`;

        logToFile(`[INFO] ${convLogContext} Request received.`);
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
                sendChatError(convLogContext, 'Could not clear. Not found or no permission.', 'clear_fail_permission', { conversationId: conversationIdToClear });
            }
        } catch (error: any) {
            sendChatError(convLogContext, `Server error clearing messages.`, 'clear_fail_server', { conversationId: conversationIdToClear, error: error.message });
        }
    });

    socket.on('rename_conversation', async (data: unknown) => {
        const eventName = 'rename_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        const payload = data as RenameConversationData;
        if (!payload || typeof payload.conversationId !== 'string' || typeof payload.newTitle !== 'string') {
            return sendChatError(handlerLogContext, 'Invalid request for rename.', 'invalid_request_rename');
        }
        const { conversationId, newTitle } = payload;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`;

        logToFile(`[INFO] ${convLogContext} Request received. New Title: "${newTitle.substring(0, 30)}"`);
        try {
            const renameOpResult: RenameResult = await conversationHistoryService.renameConversation(conversationId, authenticatedUserId, newTitle);
            if (renameOpResult.success) {
                socket.emit('conversation_renamed', { conversationId: renameOpResult.conversationId, newTitle: renameOpResult.updatedTitle });
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `renamed conv ${conversationId}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not rename. Check ID, permissions, or title.', 'rename_fail_logic', { conversationId });
            }
        } catch (error: any) {
            sendChatError(convLogContext, 'Server error renaming.', 'rename_fail_server', { conversationId, error: error.message });
        }
    });

    socket.on('pin_conversation', async (data: unknown) => {
        const eventName = 'pin_conversation';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        const payload = data as PinConversationData;
        if (!payload || typeof payload.conversationId !== 'string' || typeof payload.isPinned !== 'boolean') {
            return sendChatError(handlerLogContext, 'Invalid request for pin.', 'invalid_request_pin');
        }
        const { conversationId, isPinned } = payload;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`;

        logToFile(`[INFO] ${convLogContext} Request received. IsPinned: ${isPinned}`);
        try {
            const success = await conversationHistoryService.pinConversation(conversationId, authenticatedUserId, isPinned);
            if (success) {
                socket.emit('conversation_pin_status_changed', { conversationId, isPinned });
                const currentLanguage = socket.data.language as Language | undefined;
                await emitUpdatedConversationList(handlerLogContext, authenticatedUserId, `pinned/unpinned conv ${conversationId}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not update pin status.', 'pin_fail', { conversationId });
            }
        } catch (error: any) {
            sendChatError(convLogContext, 'Server error updating pin status.', 'pin_fail_server', { conversationId, error: error.message });
        }
    });

    logToFile(`${baseLogContext}[${currentUserId}] Conversation event handlers registered.`);
};