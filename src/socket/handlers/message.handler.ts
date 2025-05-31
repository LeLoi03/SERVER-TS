// src/socket/handlers/message.handler.ts
import { HandlerDependencies } from './handler.types';
import {
    handleStreaming,
    handleNonStreaming
} from '../../chatbot/handlers/intentHandler.orchestrator';
import { stageEmailConfirmation } from '../../chatbot/utils/confirmationManager';
import { Part } from '@google/genai'; // <<< ĐẢM BẢO ĐÃ IMPORT

// --- Import types from shared/types.ts ---
import {
    FrontendAction,
    ConfirmSendEmailAction,
    SendMessageData,
    BackendEditUserMessagePayload,
    BackendConversationUpdatedAfterEditPayload,
    ChatHistoryItem,
} from '../../chatbot/shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
const MESSAGE_HANDLER_NAME = 'MessageHandler';

// Constants cho page context
const PAGE_CONTEXT_START_MARKER = "[START CURRENT PAGE CONTEXT]";
const PAGE_CONTEXT_END_MARKER = "[END CURRENT PAGE CONTEXT]";


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
            return sendChatError(handlerLogContext, 'Invalid message payload: Missing "parts" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const payload = data as SendMessageData;
        let { // <<< Sử dụng let để có thể thay đổi parts
            parts: originalPartsFromClient, // Đổi tên để rõ ràng
            isStreaming,
            language,
            conversationId: payloadConvId,
            frontendMessageId,
            personalizationData,
            originalUserFiles
        } = payload;

        socket.data.language = language;

        // --- XỬ LÝ PAGE CONTEXT ---
        let pageContextText: string | undefined = undefined;
        let userQueryParts: Part[] = []; // Parts thực sự của user sau khi tách context

        if (originalPartsFromClient && originalPartsFromClient.length > 0) {
            const firstPart = originalPartsFromClient[0];
            if (firstPart.text && firstPart.text.startsWith(PAGE_CONTEXT_START_MARKER)) {
                const endIndex = firstPart.text.indexOf(PAGE_CONTEXT_END_MARKER);
                if (endIndex > -1) {
                    // Trích xuất context
                    pageContextText = firstPart.text.substring(PAGE_CONTEXT_START_MARKER.length, endIndex).trim();
                    
                    // Phần còn lại của firstPart (nếu có) là query của user
                    let remainingFirstPartText = firstPart.text.substring(endIndex + PAGE_CONTEXT_END_MARKER.length).trim();
                    
                    // Tìm vị trí "User query:" và loại bỏ nó nếu có
                    const userQueryMarker = "User query:";
                    if (remainingFirstPartText.startsWith(userQueryMarker)) {
                        remainingFirstPartText = remainingFirstPartText.substring(userQueryMarker.length).trim();
                    }

                    if (remainingFirstPartText) {
                        userQueryParts.push({ text: remainingFirstPartText });
                    }
                    // Thêm các parts còn lại (nếu có) vào userQueryParts
                    if (originalPartsFromClient.length > 1) {
                        userQueryParts.push(...originalPartsFromClient.slice(1));
                    }
                    logToFile(`[INFO] ${handlerLogContext} Page context detected and extracted. Length: ${pageContextText.length}. User query parts count: ${userQueryParts.length}`);
                } else {
                    // Marker bắt đầu có nhưng không có marker kết thúc -> coi toàn bộ là query của user
                    userQueryParts = [...originalPartsFromClient];
                    logToFile(`[WARN] ${handlerLogContext} Page context start marker found, but no end marker. Treating all as user query.`);
                }
            } else {
                // Không có context marker
                userQueryParts = [...originalPartsFromClient];
            }
        }
        // Nếu userQueryParts rỗng và có pageContext, vẫn cho phép xử lý (ví dụ: user chỉ gửi @currentpage)
        if (userQueryParts.length === 0 && pageContextText) {
             logToFile(`[INFO] ${handlerLogContext} No explicit user query parts, but page context is present. Proceeding with context.`);
        } else if (userQueryParts.length === 0 && !pageContextText) {
            // Không có query, không có context -> không làm gì
             logToFile(`[WARN] ${handlerLogContext} No user query parts and no page context. Aborting send_message.`);
             return sendChatError(handlerLogContext, 'Cannot send an empty message without page context.', 'empty_message_no_context');
        }
        // --- KẾT THÚC XỬ LÝ PAGE CONTEXT ---


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
            } catch (error: unknown) {
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
        } catch (error: unknown) {
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

            // userQueryParts là parts của user sẽ được lưu vào DB.
            // pageContextText sẽ được truyền riêng cho AI handler.
            if (isStreaming) {
                updatedHistory = await handleStreaming(
                    userQueryParts, // <<< Chỉ truyền parts của user
                    currentHistory,
                    socket,
                    language,
                    handlerId,
                    handleAction,
                    frontendMessageId,
                    personalizationData,
                    originalUserFiles,
                    pageContextText // <<< TRUYỀN PAGE CONTEXT
                );
            } else {
                const handlerResult = await handleNonStreaming(
                    userQueryParts, // <<< Chỉ truyền parts của user
                    currentHistory,
                    socket,
                    language,
                    handlerId,
                    frontendMessageId,
                    personalizationData,
                    originalUserFiles,
                    pageContextText // <<< TRUYỀN PAGE CONTEXT
                );
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    handleAction(handlerResult.action);
                }
            }

            if (Array.isArray(updatedHistory)) {
                // `updatedHistory` trả về từ AI handler đã bao gồm tin nhắn user (với userQueryParts) và tin nhắn model.
                // Nó KHÔNG chứa pageContextText như một tin nhắn riêng biệt.
                const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, authenticatedUserId, updatedHistory);
                if (updateSuccess) {
                    await emitUpdatedConversationList(currentConvLogContext, authenticatedUserId, 'message processed and history saved', language);
                } else {
                    sendChatWarning(currentConvLogContext, 'Failed to save updated history after AI processing. Conversation might be out of sync.', 'history_save_fail_target', { convId: targetConversationId });
                }
            } else {
                logToFile(`[INFO] ${currentConvLogContext} AI handler did not return an updated history array. Database update skipped by this block.`);
            }
        } catch (handlerError: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(handlerError);
            sendChatError(currentConvLogContext, `Error processing message with AI: ${errorMessage}.`, 'handler_exception', { error: errorMessage });
        }
    });

    // ... (socket.on('edit_user_message', ...) giữ nguyên, vì edit không dùng page context)
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
            messageIdToEdit, 
            newText,
            language,
            personalizationData
        } = data;

        const isStreaming = socket.data.isStreamingEnabled ?? true; 
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}][Msg:${messageIdToEdit}]`;
        logToFile(
            `[INFO] ${convLogContext} 'edit_user_message' request received. New text: "${newText.substring(0, 30) + (newText.length > 30 ? '...' : '')}", Streaming: ${isStreaming}, Language: ${language}` +
            (personalizationData ? `, Personalization: Enabled` : `, Personalization: Disabled`)
        );

        try {
            const prepareResult = await conversationHistoryService.updateUserMessageAndPrepareHistory(
                authenticatedUserId,
                conversationId,
                messageIdToEdit, 
                newText
            );

            if (!prepareResult) {
                return sendChatError(convLogContext, 'Internal error preparing conversation history for edit (service returned null).', 'edit_prepare_service_null');
            }
            if (!prepareResult.originalConversationFound) {
                return sendChatError(convLogContext, 'Conversation not found for edit operation.', 'edit_conv_not_found');
            }
            if (!prepareResult.messageFoundAndIsLastUserMessage || !prepareResult.editedUserMessage || !prepareResult.historyForNewBotResponse) {
                return sendChatError(convLogContext, 'Message to edit not found, is not the latest user message, or history preparation failed.', 'edit_msg_invalid_target_or_prepare_fail');
            }

            const {
                editedUserMessage, 
                historyForNewBotResponse 
            } = prepareResult;

            const historyForAIHandler = historyForNewBotResponse.slice(0, -1); 
            const partsForAIHandler = editedUserMessage.parts; 

            logToFile(`[DEBUG] ${convLogContext} History for AI Handler (length ${historyForAIHandler.length}): ${historyForAIHandler.map(m => m.uuid).join(', ')}. Parts for AI: ${partsForAIHandler.find(p => p.text)?.text?.substring(0, 20)}...`);


            let finalHistoryFromAIHandler: ChatHistoryItem[] | void | undefined;
            const tokenForAction = socket.data.token as string | undefined;
            const aiHandlerId = `${eventName}-${handlerIdSuffix}`;

            const handleAIActionCallback = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && tokenForAction) {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, tokenForAction, socket.id, aiHandlerId, io);
                }
            };

            if (isStreaming) {
                finalHistoryFromAIHandler = await handleStreaming(
                    partsForAIHandler,
                    historyForAIHandler,
                    socket, language, aiHandlerId,
                    handleAIActionCallback, messageIdToEdit, personalizationData,
                    undefined // originalUserFiles không áp dụng cho edit
                    // pageContextText không áp dụng cho edit
                );
            } else {
                const nonStreamingResult = await handleNonStreaming(
                    partsForAIHandler,
                    historyForAIHandler,
                    socket, language, aiHandlerId,
                    messageIdToEdit, personalizationData,
                    undefined, // originalUserFiles không áp dụng cho edit
                    undefined // pageContextText không áp dụng cho edit
                );
                if (nonStreamingResult) {
                    finalHistoryFromAIHandler = nonStreamingResult.history;
                    if (nonStreamingResult.action) handleAIActionCallback(nonStreamingResult.action);
                }
            }

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
                    historyToSaveInDB = [...historyForNewBotResponse]; 
                }
            } else {
                logToFile(`[WARN] ${convLogContext} User message edited, but AI handler returned no history or inconclusive response.`);
                historyToSaveInDB = [...historyForNewBotResponse]; 
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
            
            if (newBotMessageForClient) {
                const frontendPayload: BackendConversationUpdatedAfterEditPayload = {
                    editedUserMessage: editedUserMessage, 
                    newBotMessage: newBotMessageForClient, 
                    conversationId: conversationId,
                };
                socket.emit('conversation_updated_after_edit', frontendPayload);
                logToFile(`[INFO] ${convLogContext} Emitted 'conversation_updated_after_edit' event. BotMsg UUID: ${newBotMessageForClient.uuid}`);
            } else {
                logToFile(
                    `[WARN] ${convLogContext} User message (ID: ${editedUserMessage.uuid}) was edited and saved, ` +
                    `but no new bot message was generated by the AI. ` +
                    `The 'conversation_updated_after_edit' event was NOT sent.`
                );
            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error during message edit: ${errorMessage || 'Unknown'}.`, 'edit_exception_unhandled', { errorDetails: errorMessage, stack: errorStack });
        }
    })
}

function isSendMessageData(data: unknown): data is SendMessageData {
    return (
        typeof data === 'object' &&
        data !== null &&
        Array.isArray((data as SendMessageData).parts) && // parts có thể rỗng nếu chỉ có context
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