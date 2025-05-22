// src/socket/handlers/message.handler.ts
import { HandlerDependencies } from './handler.types';
import {
    handleStreaming,
    handleNonStreaming
} from '../../chatbot/handlers/intentHandler.orchestrator';
import { stageEmailConfirmation } from '../../chatbot/utils/confirmationManager';
import { mapHistoryItemToChatMessage } from '../../chatbot/utils/mapHistoryItemToChatMessage';

// --- Import types from shared/types.ts ---
import {
    FrontendAction,
    ConfirmSendEmailAction,
    SendMessageData,
    Language,
    BackendEditUserMessagePayload,
    BackendConversationUpdatedAfterEditPayload,
    ChatHistoryItem,
    ChatMessage,
} from '../../chatbot/shared/types';
// Import the new error utility
import { getErrorMessageAndStack } from '../../utils/errorUtils';

const MESSAGE_HANDLER_NAME = 'MessageHandler';

/**
 * Registers Socket.IO event handlers related to chat messages (sending, editing).
 * These handlers orchestrate interaction with AI models and conversation history.
 *
 * @param {HandlerDependencies} deps - An object containing common dependencies for handlers.
 */
export const registerMessageHandlers = (deps: HandlerDependencies): void => {
    const {
        io,
        socket,
        conversationHistoryService,
        logToFile,
        socketId,
        sendChatError,
        sendChatWarning,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
    } = deps;

    const baseLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}]`;

    logToFile(`${baseLogContext}[${deps.userId}] Registering message event handlers.`);

    socket.on('send_message', async (data: unknown) => {
        const eventName = 'send_message';
        const handlerId = `${socketId.substring(0, 4)}-${Date.now()}`;
        let tempLogContext = `${baseLogContext}[${deps.userId}][Req:${handlerId}]`;

        const authenticatedUserId = ensureAuthenticated(tempLogContext, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}][${authenticatedUserId}][Req:${handlerId}]`;

        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogContext, 'Authentication session error: token missing. Please re-login.', 'missing_token_auth', { userId: authenticatedUserId });
        }

        if (!isSendMessageData(data)) {
            return sendChatError(handlerLogContext, 'Invalid message payload: Missing "userInput" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const { userInput, isStreaming = true, language, conversationId: payloadConversationId, frontendMessageId } = data;
        socket.data.language = language;

        logToFile(
            `[INFO] ${handlerLogContext} 'send_message' request received.` +
            ` Input: "${userInput.substring(0, 30) + (userInput.length > 30 ? '...' : '')}"` +
            `, Streaming: ${isStreaming}, Language: ${language}, PayloadConvId: ${payloadConversationId || 'N/A'}.`
        );

        let targetConversationId: string;
        let currentConvLogContext = handlerLogContext;

        if (payloadConversationId) {
            targetConversationId = payloadConversationId;
            currentConvLogContext = `${handlerLogContext}[Conv:${targetConversationId}]`;
            if (socket.data.currentConversationId !== targetConversationId) {
                socket.data.currentConversationId = targetConversationId;
            }
            logToFile(`[INFO] ${currentConvLogContext} Using conversation ID provided in payload.`);
        } else {
            logToFile(`[INFO] ${handlerLogContext} No conversation ID provided in payload. Client requesting a new conversation.`);
            try {
                const newConvResult = await conversationHistoryService.createNewConversation(authenticatedUserId, language);
                targetConversationId = newConvResult.conversationId;
                currentConvLogContext = `${handlerLogContext}[Conv:${targetConversationId}]`;
                socket.data.currentConversationId = targetConversationId;

                logToFile(`[INFO] ${currentConvLogContext} Successfully created new conversation. Title: "${newConvResult.title}".`);
                socket.emit('new_conversation_started', {
                    conversationId: targetConversationId,
                    title: newConvResult.title,
                    lastActivity: newConvResult.lastActivity.toISOString(),
                    isPinned: newConvResult.isPinned,
                });
                await emitUpdatedConversationList(currentConvLogContext, authenticatedUserId, 'new conversation started from send_message', language);
            } catch (error: unknown) { // Use unknown here
                const { message: errorMessage } = getErrorMessageAndStack(error);
                return sendChatError(handlerLogContext, `Could not start new chat session as requested: ${errorMessage}.`, 'explicit_new_conv_payload_fail', { userId: authenticatedUserId, error: errorMessage });
            }
        }

        if (!targetConversationId) {
            return sendChatError(handlerLogContext, 'Internal error: Could not determine target chat session ID.', 'target_id_undetermined');
        }

        let currentHistory: ChatHistoryItem[];
        try {
            const fetchedHistory: ChatHistoryItem[] | null = await conversationHistoryService.getConversationHistory(targetConversationId, authenticatedUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                if (socket.data.currentConversationId === targetConversationId) {
                    socket.data.currentConversationId = undefined;
                }
                return sendChatError(currentConvLogContext, 'Chat session not found or access denied for message sending.', 'history_not_found_send', { convId: targetConversationId });
            }
            currentHistory = fetchedHistory;
            logToFile(`[INFO] ${currentConvLogContext} Fetched conversation history. Message Count: ${currentHistory.length}.`);
        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(error);
            return sendChatError(currentConvLogContext, `Could not load conversation history: ${errorMessage}.`, 'history_fetch_fail_send', { convId: targetConversationId, error: errorMessage });
        }

        try {
            let updatedHistory: ChatHistoryItem[] | void | undefined = undefined;

            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && token) {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io);
                }
            };

            if (isStreaming) {
                updatedHistory = await handleStreaming(userInput, currentHistory, socket, language, handlerId, handleAction, frontendMessageId);
            } else {
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language, handlerId, frontendMessageId);
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    handleAction(handlerResult.action);
                }
            }

            if (Array.isArray(updatedHistory)) {
                const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, authenticatedUserId, updatedHistory);
                if (updateSuccess) {
                    await emitUpdatedConversationList(currentConvLogContext, authenticatedUserId, 'message processed and history saved', language);
                } else {
                    sendChatWarning(currentConvLogContext, 'Failed to save updated history after AI processing. Conversation might be out of sync.', 'history_save_fail_target', { convId: targetConversationId });
                }
            } else {
                logToFile(`[INFO] ${currentConvLogContext} AI handler did not return an updated history array. Database update skipped by this block.`);
            }
        } catch (handlerError: unknown) { // Use unknown here
            const { message: errorMessage } = getErrorMessageAndStack(handlerError);
            sendChatError(currentConvLogContext, `Error processing message with AI: ${errorMessage}.`, 'handler_exception', { error: errorMessage });
        }
    });

    socket.on('edit_user_message', async (data: unknown) => {
        const eventName = 'edit_user_message';
        const handlerIdSuffix = Date.now();
        let tempLogContext = `${baseLogContext}[${deps.userId}][Req:${handlerIdSuffix}]`;

        const authenticatedUserId = ensureAuthenticated(tempLogContext, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}][${authenticatedUserId}][Req:${handlerIdSuffix}]`;

        if (!isBackendEditUserMessagePayload(data)) {
            return sendChatError(handlerLogContext, 'Invalid payload for edit_user_message. Missing required fields.', 'invalid_payload_edit', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const { conversationId, messageIdToEdit, newText, language } = data;
        const isStreaming = socket.data.isStreamingEnabled ?? true;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}][Msg:${messageIdToEdit}]`;
        logToFile(`[INFO] ${convLogContext} 'edit_user_message' request received. New text: "${newText.substring(0, 30) + (newText.length > 30 ? '...' : '')}", Streaming: ${isStreaming}, Language: ${language}.`);

        try {
            const prepareResult = await conversationHistoryService.updateUserMessageAndPrepareHistory(authenticatedUserId, conversationId, messageIdToEdit, newText);

            if (!prepareResult) {
                return sendChatError(convLogContext, 'Internal error preparing conversation history for edit.', 'edit_prepare_service_critical_fail');
            }
            if (!prepareResult.originalConversationFound) {
                return sendChatError(convLogContext, 'Conversation not found for edit operation.', 'edit_conv_not_found');
            }
            if (!prepareResult.messageFoundAndIsLastUserMessage) {
                return sendChatError(convLogContext, 'Message to edit not found or is not the latest user message in the conversation.', 'edit_msg_invalid_target');
            }

            const { editedUserMessage, historyForNewBotResponse } = prepareResult;
            let finalHistoryFromAI: ChatHistoryItem[] | void | undefined;
            const tokenForAction = socket.data.token as string | undefined;
            const aiHandlerId = `${eventName}-${handlerIdSuffix}`;

            const handleAIActionCallback = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && tokenForAction) {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, tokenForAction, socket.id, aiHandlerId, io);
                }
            };

            if (isStreaming) {
                finalHistoryFromAI = await handleStreaming(newText, historyForNewBotResponse, socket, language, aiHandlerId, handleAIActionCallback, messageIdToEdit);
            } else {
                const nonStreamingResult = await handleNonStreaming(newText, historyForNewBotResponse, socket, language, aiHandlerId, messageIdToEdit);
                if (nonStreamingResult) {
                    finalHistoryFromAI = nonStreamingResult.history;
                    if (nonStreamingResult.action) handleAIActionCallback(nonStreamingResult.action);
                }
            }

            if (!Array.isArray(finalHistoryFromAI) || finalHistoryFromAI.length === 0) {
                sendChatWarning(convLogContext, 'User message edited, but AI response was inconclusive or no new history generated.', 'edit_ai_no_history');
                const partialFrontendPayload: Partial<BackendConversationUpdatedAfterEditPayload> = {
                    editedUserMessage: mapHistoryItemToChatMessage(editedUserMessage),
                    conversationId: conversationId,
                };
                socket.emit('conversation_updated_after_edit', partialFrontendPayload);
                await emitUpdatedConversationList(convLogContext, authenticatedUserId, `message edited (AI inconclusive) in conv ${conversationId}`, language);
                return;
            }

            const historyToSaveInDB = finalHistoryFromAI;
            const saveSuccess = await conversationHistoryService.updateConversationHistory(conversationId, authenticatedUserId, historyToSaveInDB);

            if (!saveSuccess) {
                return sendChatError(convLogContext, 'Failed to save edited message and new AI response to database.', 'edit_final_save_fail_db');
            }

            await emitUpdatedConversationList(convLogContext, authenticatedUserId, `message edited in conv ${conversationId}`, language);

            let newBotMessageForClient: ChatHistoryItem | undefined;
            for (let i = historyToSaveInDB.length - 1; i >= historyForNewBotResponse.length; i--) {
                if (historyToSaveInDB[i].role === 'model') {
                    newBotMessageForClient = historyToSaveInDB[i];
                    break;
                }
            }
            if (!newBotMessageForClient && historyToSaveInDB.length > 0) {
                const lastMessageInSavedHistory = historyToSaveInDB[historyToSaveInDB.length - 1];
                if (lastMessageInSavedHistory.role === 'model') newBotMessageForClient = lastMessageInSavedHistory;
            }


            if (!newBotMessageForClient) {
                sendChatWarning(convLogContext, 'User message edited, but no clear new bot response was generated.', 'edit_bot_response_unclear');
                const partialPayload: Partial<BackendConversationUpdatedAfterEditPayload> = {
                    editedUserMessage: mapHistoryItemToChatMessage(editedUserMessage),
                    conversationId: conversationId,
                };
                socket.emit('conversation_updated_after_edit', partialPayload);
                return;
            }

            const frontendPayload: BackendConversationUpdatedAfterEditPayload = {
                editedUserMessage: mapHistoryItemToChatMessage(editedUserMessage),
                newBotMessage: mapHistoryItemToChatMessage(newBotMessageForClient),
                conversationId: conversationId,
            };
            socket.emit('conversation_updated_after_edit', frontendPayload);
            logToFile(`[INFO] ${convLogContext} Emitted 'conversation_updated_after_edit' event.`);

        } catch (error: unknown) { // Use unknown here
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error during message edit: ${errorMessage || 'Unknown'}.`, 'edit_exception_unhandled', { errorDetails: errorMessage, stack: errorStack });
        }
    });

    logToFile(`${baseLogContext}[${deps.userId}] Message event handlers successfully registered.`);
};

function isSendMessageData(data: unknown): data is SendMessageData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as SendMessageData).userInput === 'string' &&
        !!(data as SendMessageData).userInput?.trim() &&
        typeof (data as SendMessageData).language === 'string' &&
        !!(data as SendMessageData).language
    );
}

function isBackendEditUserMessagePayload(payload: unknown): payload is BackendEditUserMessagePayload {
    return (
        typeof payload === 'object' &&
        payload !== null &&
        typeof (payload as BackendEditUserMessagePayload).conversationId === 'string' &&
        typeof (payload as BackendEditUserMessagePayload).messageIdToEdit === 'string' &&
        typeof (payload as BackendEditUserMessagePayload).newText === 'string' &&
        typeof (payload as BackendEditUserMessagePayload).language === 'string'
    );
}