// src/socket/handlers/message.handler.ts
import { HandlerDependencies } from './handler.types';
import {
    handleStreaming,
    handleNonStreaming
} from '../../chatbot/handlers/intentHandler.orchestrator'; // HOẶC tên file mới nếu bạn đổi
import { stageEmailConfirmation } from '../../chatbot/utils/confirmationManager';
import { mapHistoryItemToChatMessage } from '../../chatbot/utils/mapHistoryItemToChatMessage';
// --- Import types ---
import {
    FrontendAction,
    ConfirmSendEmailAction,
    SendMessageData,
    Language,
    BackendEditUserMessagePayload,
    BackendConversationUpdatedAfterEditPayload,
    HistoryItem, // Assuming this is your backend message type
} from '../../chatbot/shared/types';

const MESSAGE_HANDLER_NAME = 'messageHandler';

export const registerMessageHandlers = (deps: HandlerDependencies): void => {
    const {
        io,
        socket,
        conversationHistoryService,
        logToFile,
        userId: currentUserId, // Again, use ensureAuthenticated for actual operations
        socketId,
        sendChatError,
        sendChatWarning,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
    } = deps;

    const baseLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}]`;

    logToFile(`${baseLogContext}[${currentUserId}] Registering message event handlers.`);

    socket.on('send_message', async (data: unknown) => {
        const eventName = 'send_message';
        const handlerId = `${socketId.substring(0, 4)}-${Date.now()}`;
        // Initial log context before we confirm user ID
        let tempLogContext = `${baseLogContext}[${currentUserId}][Req:${handlerId}]`;

        const authenticatedUserId = ensureAuthenticated(tempLogContext, eventName);
        if (!authenticatedUserId) return;
        // Update log context with confirmed user ID
        const handlerLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}][${authenticatedUserId}][Req:${handlerId}]`;


        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogContext, 'Auth session error. Re-login.', 'missing_token_auth', { userId: authenticatedUserId });
        }

        if (
            typeof data !== 'object' || data === null ||
            typeof (data as SendMessageData)?.userInput !== 'string' || !(data as SendMessageData).userInput?.trim() ||
            typeof (data as SendMessageData)?.language !== 'string' || !(data as SendMessageData).language
        ) {
            return sendChatError(handlerLogContext, 'Invalid message: Missing "userInput" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const { userInput, isStreaming = true, language, conversationId: payloadConversationId, frontendMessageId } = data as SendMessageData;
        socket.data.language = language; // Store language

        logToFile(
            `[INFO] ${handlerLogContext} Req received.` +
            ` Input: "${userInput.substring(0, 30) + (userInput.length > 30 ? '...' : '')}"` +
            `, Stream: ${isStreaming}, Lang: ${language}, PayloadConvId: ${payloadConversationId || 'N/A'}`
        );

        let targetConversationId: string;
        let currentConvLogContext = handlerLogContext; // Initialize with base handler log context

        if (payloadConversationId) {
            targetConversationId = payloadConversationId;
            currentConvLogContext = `${handlerLogContext}[Conv:${targetConversationId}]`; // Update context
            if (socket.data.currentConversationId !== targetConversationId) {
                socket.data.currentConversationId = targetConversationId;
            }
            logToFile(`[INFO] ${currentConvLogContext} Using payload convId.`);
        } else {
            logToFile(`[INFO] ${handlerLogContext} No payloadConvId. Client requests new conv.`);
            try {
                const newConvResult = await conversationHistoryService.createNewConversation(authenticatedUserId, language);
                targetConversationId = newConvResult.conversationId;
                currentConvLogContext = `${handlerLogContext}[Conv:${targetConversationId}]`; // Update context
                socket.data.currentConversationId = targetConversationId;

                logToFile(`[INFO] ${currentConvLogContext} Created new conv. Title: "${newConvResult.title}"`);
                socket.emit('new_conversation_started', {
                    conversationId: targetConversationId,
                    title: newConvResult.title,
                    lastActivity: newConvResult.lastActivity.toISOString(),
                    isPinned: newConvResult.isPinned,
                });
                await emitUpdatedConversationList(currentConvLogContext, authenticatedUserId, 'new conv from send_message', language);
            } catch (error: any) {
                return sendChatError(handlerLogContext, `Could not start new chat as requested.`, 'explicit_new_conv_payload_fail', { userId: authenticatedUserId, error: error.message });
            }
        }

        if (!targetConversationId) { // Should not happen if logic above is correct
            return sendChatError(handlerLogContext, 'Internal error: Could not determine chat session.', 'target_id_undetermined');
        }

        let currentHistory: HistoryItem[];
        try {
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, authenticatedUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                if (socket.data.currentConversationId === targetConversationId) {
                    socket.data.currentConversationId = undefined;
                }
                return sendChatError(currentConvLogContext, 'Chat session error or invalid ID.', 'history_not_found_send', { convId: targetConversationId });
            }
            currentHistory = fetchedHistory;
            logToFile(`[INFO] ${currentConvLogContext} Fetched history. Count: ${currentHistory.length}`);
        } catch (error: any) {
            return sendChatError(currentConvLogContext, `Could not load history.`, 'history_fetch_fail_send', { convId: targetConversationId, error: error.message });
        }

        try {
            let updatedHistory: HistoryItem[] | void | undefined = undefined;
            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io);
                }
            };

            if (isStreaming) {
                updatedHistory = await handleStreaming(userInput, currentHistory, socket, language as Language, handlerId, handleAction, frontendMessageId);
            } else {
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language as Language, handlerId, frontendMessageId);
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    handleAction(handlerResult.action);
                }
            }

            if (Array.isArray(updatedHistory)) {
                const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, authenticatedUserId, updatedHistory);
                if (updateSuccess) {
                    await emitUpdatedConversationList(currentConvLogContext, authenticatedUserId, 'message saved', language);
                } else {
                    sendChatWarning(currentConvLogContext, 'Failed to save history. Conv out of sync.', 'history_save_fail_target', { convId: targetConversationId });
                }
            } else {
                logToFile(`[INFO] ${currentConvLogContext} No history array from handler. DB not updated by this block.`);
            }
        } catch (handlerError: any) {
            sendChatError(currentConvLogContext, `Error processing message: ${handlerError.message}`, 'handler_exception', { error: handlerError.message });
        }
    });

    socket.on('edit_user_message', async (data: unknown) => {
        const eventName = 'edit_user_message';
        const handlerIdSuffix = Date.now();
        const tempLogContext = `${baseLogContext}[${currentUserId}][Req:${handlerIdSuffix}]`;

        const authenticatedUserId = ensureAuthenticated(tempLogContext, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}][${authenticatedUserId}][Req:${handlerIdSuffix}]`;


        const payload = data as BackendEditUserMessagePayload;
        if (!payload || typeof payload.conversationId !== 'string' || typeof payload.messageIdToEdit !== 'string' || typeof payload.newText !== 'string' || typeof payload.language !== 'string') {
            return sendChatError(handlerLogContext, 'Invalid payload for edit_user_message.', 'invalid_payload_edit', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const { conversationId, messageIdToEdit, newText, language } = payload;
        const isStreaming = socket.data.isStreamingEnabled ?? true;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}][Msg:${messageIdToEdit}]`;
        logToFile(`[INFO] ${convLogContext} Edit req. Text: "${newText.substring(0, 30)}...", Stream: ${isStreaming}, Lang: ${language}`);

        try {
            const prepareResult = await conversationHistoryService.updateUserMessageAndPrepareHistory(authenticatedUserId, conversationId, messageIdToEdit, newText);

            if (!prepareResult) {
                return sendChatError(convLogContext, 'Internal error preparing edit.', 'edit_prepare_service_critical_fail');
            }
            if (!prepareResult.originalConversationFound) {
                return sendChatError(convLogContext, 'Conv not found for edit.', 'edit_conv_not_found');
            }
            if (!prepareResult.messageFoundAndIsLastUserMessage) {
                return sendChatError(convLogContext, 'Msg not found or not latest user msg.', 'edit_msg_invalid_target');
            }

            const { editedUserMessage, historyForNewBotResponse } = prepareResult;
            let finalHistoryFromAI: HistoryItem[] | void | undefined;
            const tokenForAction = socket.data.token as string | undefined;
            const aiHandlerId = `${eventName}-${handlerIdSuffix}`;

            const handleAIActionCallback = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && tokenForAction) {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, tokenForAction, socket.id, aiHandlerId, io);
                }
                // actionFromAI = action; // Store if needed for other logic
            };

            if (isStreaming) {
                finalHistoryFromAI = await handleStreaming(newText, historyForNewBotResponse, socket, language as Language, aiHandlerId, handleAIActionCallback, messageIdToEdit);
            } else {
                const nonStreamingResult = await handleNonStreaming(newText, historyForNewBotResponse, socket, language as Language, aiHandlerId, messageIdToEdit);
                if (nonStreamingResult) {
                    finalHistoryFromAI = nonStreamingResult.history;
                    if (nonStreamingResult.action) handleAIActionCallback(nonStreamingResult.action);
                }
            }

            if (!Array.isArray(finalHistoryFromAI) || finalHistoryFromAI.length === 0) {
                sendChatWarning(convLogContext, 'Msg edited, but AI inconclusive.', 'edit_ai_no_history');
                // Even if AI fails, the user message is edited in DB by prepareResult.
                // Frontend needs to know this. We need to emit the editedUserMessage.
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
                return sendChatError(convLogContext, 'Failed to save edited msg after AI.', 'edit_final_save_fail_db');
            }

            await emitUpdatedConversationList(convLogContext, authenticatedUserId, `message edited in conv ${conversationId}`, language);

            let newBotMessageForClient: HistoryItem | undefined;
            // Simplified logic: assume last model message added by AI handler is the new one.
            // This might need refinement if AI can return multiple messages or complex structures.
            for (let i = historyToSaveInDB.length - 1; i >= historyForNewBotResponse.length; i--) {
                if (historyToSaveInDB[i].role === 'model') {
                    newBotMessageForClient = historyToSaveInDB[i];
                    break;
                }
            }
            if (!newBotMessageForClient && historyToSaveInDB.length > historyForNewBotResponse.length) {
                const lastMessageInSavedHistory = historyToSaveInDB[historyToSaveInDB.length - 1];
                if (lastMessageInSavedHistory.role === 'model') newBotMessageForClient = lastMessageInSavedHistory;
            }


            if (!newBotMessageForClient) {
                sendChatWarning(convLogContext, 'Msg edited, new bot response unclear.', 'edit_bot_response_unclear');
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
            logToFile(`[INFO] ${convLogContext} Emitted 'conversation_updated_after_edit'.`);

        } catch (error: any) {
            sendChatError(convLogContext, `Server error during edit: ${error.message || 'Unknown'}`, 'edit_exception_unhandled', { errorDetails: error.message });
        }
    });

    logToFile(`${baseLogContext}[${currentUserId}] Message event handlers registered.`);
};