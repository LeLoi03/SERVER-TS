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
    SendMessageData, // Expects `parts: Part[]` now
    Language,
    BackendEditUserMessagePayload, // This will now include personalizationData
    BackendConversationUpdatedAfterEditPayload,
    ChatHistoryItem,
    PersonalizationPayload, // Import if needed for explicit typing
} from '../../chatbot/shared/types';
// Import the new error utility
import { getErrorMessageAndStack } from '../../utils/errorUtils';
import { Part } from '@google/genai';
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

        const {
            parts, // <<< USE `parts` from data
            isStreaming = true,
            language,
            conversationId: payloadConversationId,
            frontendMessageId,
            personalizationData
        } = data;
        socket.data.language = language;



        // Extract a text summary for logging if possible
        const textForLog = parts.find(p => p.text)?.text || `[${parts.length} parts, non-text content]`;
        logToFile(
            `[INFO] ${handlerLogContext} 'send_message' request received.` +
            ` Input Parts: "${textForLog.substring(0, 50) + (textForLog.length > 50 ? '...' : '')}"` +
            `, Streaming: ${isStreaming}, Language: ${language}, PayloadConvId: ${payloadConversationId || 'N/A'}` +
            (personalizationData ? `, Personalization: Enabled` : ``)
        );
        if (parts.some(p => p.inlineData || p.fileData)) {
            logToFile(`[DEBUG] ${handlerLogContext} Message contains file/image data.`);
        }


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
                updatedHistory = await handleStreaming(
                    parts, // <<< PASS `parts`
                    currentHistory,
                    socket,
                    language,
                    handlerId,
                    handleAction,
                    frontendMessageId,
                    personalizationData
                );
            } else {
                const handlerResult = await handleNonStreaming(
                    parts, // <<< PASS `parts`
                    currentHistory,
                    socket,
                    language,
                    handlerId,
                    frontendMessageId,
                    personalizationData
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
                // finalHistoryFromAIHandler được trả về từ handleStreaming/NonStreaming.
                // Nó nên chứa: [...historyForAIHandler, user_turn_corresponding_to_partsForAIHandler, new_bot_message (nếu có)]
                // Chúng ta cần trích xuất new_bot_message.
                const lastMessageFromAI = finalHistoryFromAIHandler[finalHistoryFromAIHandler.length - 1];
                if (lastMessageFromAI.role === 'model') {
                    newBotMessageForClient = lastMessageFromAI;
                    // Lịch sử để lưu vào DB sẽ là:
                    // historyForNewBotResponse (đã chứa editedUserMessage ở cuối) + newBotMessageForClient
                    historyToSaveInDB = [...historyForNewBotResponse, newBotMessageForClient];
                    logToFile(`[INFO] ${convLogContext} AI responded. New bot message UUID: ${newBotMessageForClient.uuid}. History to save length: ${historyToSaveInDB.length}`);
                } else {
                    // AI handler không trả về model message ở cuối (có thể là lỗi hoặc function call không được xử lý hết)
                    logToFile(`[WARN] ${convLogContext} AI handler finished, but last message was not 'model'. Last role: ${lastMessageFromAI.role}.`);
                    historyToSaveInDB = [...historyForNewBotResponse]; // Chỉ lưu đến tin nhắn user đã edit
                }
            } else {
                // AI handler không trả về gì hoặc trả về rỗng.
                logToFile(`[WARN] ${convLogContext} User message edited, but AI handler returned no history or inconclusive response.`);
                historyToSaveInDB = [...historyForNewBotResponse]; // Chỉ lưu đến tin nhắn user đã edit
            }

            const saveSuccess = await conversationHistoryService.updateConversationHistory(
                conversationId,
                authenticatedUserId,
                historyToSaveInDB // Ghi đè toàn bộ lịch sử bằng phiên bản mới này
            );

            if (!saveSuccess) {
                // Gửi lỗi nhưng không dừng hẳn, vẫn cố gắng cập nhật client nếu có thể
                sendChatError(convLogContext, 'Failed to save edited message and new AI response to database. Client data might be inconsistent.', 'edit_final_save_fail_db');
            } else {
                logToFile(`[INFO] ${convLogContext} Successfully saved updated history to DB. Length: ${historyToSaveInDB.length}`);
            }

            await emitUpdatedConversationList(convLogContext, authenticatedUserId, `message edited in conv ${conversationId}`, language);

            // Bước 4: Gửi kết quả cuối cùng cho client.
            const frontendPayload: BackendConversationUpdatedAfterEditPayload = {
                editedUserMessage: editedUserMessage, // Tin nhắn user đã được cập nhật (từ prepareResult)
                newBotMessage: newBotMessageForClient, // Tin nhắn bot mới (nếu có)
                conversationId: conversationId,
            };
            socket.emit('conversation_updated_after_edit', frontendPayload);
            logToFile(`[INFO] ${convLogContext} Emitted 'conversation_updated_after_edit' event. BotMsg UUID: ${newBotMessageForClient?.uuid || 'N/A'}`);

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error during message edit: ${errorMessage || 'Unknown'}.`, 'edit_exception_unhandled', { errorDetails: errorMessage, stack: errorStack });
        }
    });

    logToFile(`${baseLogContext}[${deps.userId}] Message event handlers successfully registered.`);
};



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