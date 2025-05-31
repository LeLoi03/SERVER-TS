// src/socket/handlers/message.handler.ts
import { HandlerDependencies } from './handler.types';
import {
    handleStreaming,
    handleNonStreaming
} from '../../chatbot/handlers/intentHandler.orchestrator';
import { stageEmailConfirmation } from '../../chatbot/utils/confirmationManager';

// --- Import types from shared/types.ts ---
import {
    FrontendAction,
    ConfirmSendEmailAction,
    SendMessageData, // Expects `parts: Part[]` now
    BackendEditUserMessagePayload, // This will now include personalizationData
    BackendConversationUpdatedAfterEditPayload,
    ChatHistoryItem,
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

        if (!isSendMessageData(data)) { // isSendMessageData needs to check for `parts`
            return sendChatError(handlerLogContext, 'Invalid message payload: Missing "parts" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const payload = data as SendMessageData; // Giả sử bạn đã có type SendMessageData
        const {
            parts,
            isStreaming,
            language,
            conversationId: payloadConvId,
            frontendMessageId,
            personalizationData,
            originalUserFiles // <<< LẤY RA TỪ PAYLOAD
        } = payload;

        socket.data.language = language;


        let targetConversationId: string;
        let currentConvLogContext = handlerLogContext;

        if (payloadConvId) {
            targetConversationId = payloadConvId;
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

            // Khi gọi handleStreaming/handleNonStreaming, `parts` được truyền vào.
            // `handleStreaming` sẽ tạo `currentUserTurn` với `parts` này.
            // `ChatHistoryItem` này sau đó sẽ được lưu vào DB bởi `conversationHistoryService.updateConversationHistory`.
            // Vì `partSchema` đã được cập nhật để lưu `displayName` và `originalSize` trong `fileData`,
            // nếu `parts` từ client chứa các thông tin này, chúng sẽ được lưu.

            if (isStreaming) {
                updatedHistory = await handleStreaming(
                    parts,
                    currentHistory,
                    socket,
                    language,
                    handlerId,
                    handleAction, // Callback để emit 'frontend_action'
                    frontendMessageId,
                    personalizationData,
                    originalUserFiles // <<< TRUYỀN VÀO
                );
            } else {
                const handlerResult = await handleNonStreaming(
                    parts,
                    currentHistory,
                    socket,
                    language,
                    handlerId,
                    frontendMessageId,
                    personalizationData,
                    originalUserFiles // <<< TRUYỀN VÀO
                );
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

        const {
            conversationId,
            messageIdToEdit, // Đây là UUID của tin nhắn user cần edit
            newText,
            language,
            personalizationData
        } = data;

        const isStreaming = socket.data.isStreamingEnabled ?? true; // Lấy từ socket data hoặc default
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}][Msg:${messageIdToEdit}]`;
        logToFile(
            `[INFO] ${convLogContext} 'edit_user_message' request received. New text: "${newText.substring(0, 30) + (newText.length > 30 ? '...' : '')}", Streaming: ${isStreaming}, Language: ${language}` +
            (personalizationData ? `, Personalization: Enabled` : `, Personalization: Disabled`)
        );

        try {
            // Bước 1: Chuẩn bị lịch sử từ DB.
            // `updateUserMessageAndPrepareHistory` sẽ trả về:
            // - `editedUserMessage`: Object ChatHistoryItem của tin nhắn người dùng đã được cập nhật (chưa lưu DB).
            // - `historyForNewBotResponse`: Lịch sử bao gồm các tin nhắn TRƯỚC tin nhắn được edit, VÀ tin nhắn đã edit.
            //                               VD: [UserMsg1, ModelMsg1, UserMsg2_edited]
            const prepareResult = await conversationHistoryService.updateUserMessageAndPrepareHistory(
                authenticatedUserId,
                conversationId,
                messageIdToEdit, // UUID của tin nhắn user
                newText
            );

            if (!prepareResult) {
                return sendChatError(convLogContext, 'Internal error preparing conversation history for edit (service returned null).', 'edit_prepare_service_null');
            }
            if (!prepareResult.originalConversationFound) {
                return sendChatError(convLogContext, 'Conversation not found for edit operation.', 'edit_conv_not_found');
            }
            if (!prepareResult.messageFoundAndIsLastUserMessage || !prepareResult.editedUserMessage || !prepareResult.historyForNewBotResponse) {
                // messageFoundAndIsLastUserMessage bao gồm cả việc messageIdToEdit có hợp lệ không.
                // editedUserMessage và historyForNewBotResponse phải tồn tại nếu messageFoundAndIsLastUserMessage là true.
                return sendChatError(convLogContext, 'Message to edit not found, is not the latest user message, or history preparation failed.', 'edit_msg_invalid_target_or_prepare_fail');
            }

            const {
                editedUserMessage, // Tin nhắn user đã được cập nhật (chưa lưu DB)
                historyForNewBotResponse // Lịch sử dạng [..., editedUserMessage]
            } = prepareResult;

            // Bước 2: Chuẩn bị input cho AI handler.
            // Lịch sử cho AI handler KHÔNG nên bao gồm tin nhắn user đang được edit.
            // `partsForAIHandler` sẽ là nội dung mới của tin nhắn đó.
            const historyForAIHandler = historyForNewBotResponse.slice(0, -1); // Bỏ tin nhắn user đã edit ở cuối ra
            const partsForAIHandler = editedUserMessage.parts; // Lấy parts từ tin nhắn user đã edit

            logToFile(`[DEBUG] ${convLogContext} History for AI Handler (length ${historyForAIHandler.length}): ${historyForAIHandler.map(m => m.uuid).join(', ')}. Parts for AI: ${partsForAIHandler.find(p => p.text)?.text?.substring(0, 20)}...`);


            let finalHistoryFromAIHandler: ChatHistoryItem[] | void | undefined;
            const tokenForAction = socket.data.token as string | undefined;
            const aiHandlerId = `${eventName}-${handlerIdSuffix}`;

            const handleAIActionCallback = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && tokenForAction) {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, tokenForAction, socket.id, aiHandlerId, io);
                }
                // Các action khác có thể được xử lý ở đây nếu cần
            };

            if (isStreaming) {
                finalHistoryFromAIHandler = await handleStreaming(
                    partsForAIHandler,
                    historyForAIHandler,
                    socket, language, aiHandlerId,
                    handleAIActionCallback, messageIdToEdit, personalizationData // messageIdToEdit dùng làm frontendMessageId cho AI handler
                );
            } else {
                const nonStreamingResult = await handleNonStreaming(
                    partsForAIHandler,
                    historyForAIHandler,
                    socket, language, aiHandlerId,
                    messageIdToEdit, personalizationData // messageIdToEdit dùng làm frontendMessageId cho AI handler
                );
                if (nonStreamingResult) {
                    finalHistoryFromAIHandler = nonStreamingResult.history;
                    if (nonStreamingResult.action) handleAIActionCallback(nonStreamingResult.action);
                }
            }

            // Bước 3: Xử lý kết quả từ AI handler và lưu vào DB.
            let newBotMessageForClient: ChatHistoryItem | undefined = undefined;
            let historyToSaveInDB: ChatHistoryItem[];

            if (Array.isArray(finalHistoryFromAIHandler) && finalHistoryFromAIHandler.length > 0) {
                const lastMessageFromAI = finalHistoryFromAIHandler[finalHistoryFromAIHandler.length - 1];
                if (lastMessageFromAI.role === 'model') {
                    newBotMessageForClient = lastMessageFromAI;
                    historyToSaveInDB = [...historyForNewBotResponse, newBotMessageForClient];
                    logToFile(`[INFO] ${convLogContext} AI responded. New bot message UUID: ${newBotMessageForClient.uuid}. History to save length: ${historyToSaveInDB.length}`);
                } else {
                    logToFile(`[WARN] ${convLogContext} AI handler finished, but last message was not 'model'. Last role: ${lastMessageFromAI.role}.`);
                    historyToSaveInDB = [...historyForNewBotResponse]; // Chỉ lưu đến tin nhắn user đã edit
                }
            } else {
                logToFile(`[WARN] ${convLogContext} User message edited, but AI handler returned no history or inconclusive response.`);
                historyToSaveInDB = [...historyForNewBotResponse]; // Chỉ lưu đến tin nhắn user đã edit
            }

            const saveSuccess = await conversationHistoryService.updateConversationHistory(
                conversationId,
                authenticatedUserId,
                historyToSaveInDB
            );

            if (!saveSuccess) {
                sendChatError(convLogContext, 'Failed to save edited message and new AI response to database. Client data might be inconsistent.', 'edit_final_save_fail_db');
            } else {
                logToFile(`[INFO] ${convLogContext} Successfully saved updated history to DB. Length: ${historyToSaveInDB.length}`);
            }

            await emitUpdatedConversationList(convLogContext, authenticatedUserId, `message edited in conv ${conversationId}`, language);

            // Bước 4: Gửi kết quả cuối cùng cho client.
            // Only emit 'conversation_updated_after_edit' if a new bot message was generated,
            // to satisfy the strict type BackendConversationUpdatedAfterEditPayload.newBotMessage: ChatHistoryItem.
            if (newBotMessageForClient) {
                const frontendPayload: BackendConversationUpdatedAfterEditPayload = {
                    editedUserMessage: editedUserMessage, // Tin nhắn user đã được cập nhật (từ prepareResult)
                    newBotMessage: newBotMessageForClient, // newBotMessageForClient is confirmed to be ChatHistoryItem here
                    conversationId: conversationId,
                };
                socket.emit('conversation_updated_after_edit', frontendPayload);
                // The log message can now safely access .uuid as newBotMessageForClient is defined.
                logToFile(`[INFO] ${convLogContext} Emitted 'conversation_updated_after_edit' event. BotMsg UUID: ${newBotMessageForClient.uuid}`);
            } else {
                // If no new bot message was generated, we cannot satisfy the BackendConversationUpdatedAfterEditPayload type.
                // The edited user message IS saved, but this specific event isn't sent.
                // This might require the client to have other ways to update the UI for the edited user message
                // if no bot reply follows, or the type definition for newBotMessage should be made optional.
                logToFile(
                    `[WARN] ${convLogContext} User message (ID: ${editedUserMessage.uuid}) was edited and saved, ` +
                    `but no new bot message was generated by the AI. ` +
                    `The 'conversation_updated_after_edit' event was NOT sent because the 'BackendConversationUpdatedAfterEditPayload' type strictly requires a 'newBotMessage'. ` +
                    `Consider making 'newBotMessage' optional in 'types.ts' or using a different event to notify client of user message edits without a bot reply.`
                );
                // To ensure the client *always* knows the user message was updated, even without a new bot message,
                // you might consider emitting a simpler, different event here, e.g.:
                // socket.emit('user_message_text_updated', {
                //     conversationId: conversationId,
                //     messageId: editedUserMessage.uuid,
                //     newText: editedUserMessage.text, // or newParts
                //     timestamp: editedUserMessage.timestamp,
                // });
                // This would be a separate client-side handling path.
            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error during message edit: ${errorMessage || 'Unknown'}.`, 'edit_exception_unhandled', { errorDetails: errorMessage, stack: errorStack });
        }
    })
}



// Update type guard for SendMessageData
function isSendMessageData(data: unknown): data is SendMessageData {
    return (
        typeof data === 'object' &&
        data !== null &&
        Array.isArray((data as SendMessageData).parts) &&
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