// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { ConversationHistoryService, ConversationMetadata, UpdateUserMessageResult } from '../../chatbot/services/conversationHistory.service';
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper';
import { handleStreaming, handleNonStreaming } from '../../chatbot/handlers/intentHandler';
import { stageEmailConfirmation, handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager';
import logToFile from '../../utils/logger';
import { mapHistoryItemToChatMessage } from '../../chatbot/utils/mapHistoryItemToChatMessage';
// --- Import types ---
import {
    FrontendAction,
    ConfirmSendEmailAction,
    ErrorUpdate,
    SendMessageData,
    LoadConversationData,
    ConfirmationEventData,
    DeleteConversationData,
    ClearConversationData,
    Language,
    WarningUpdate,
    ChatMessage,
    RenameConversationData,
    PinConversationData,
    ClientConversationMetadata, // Ensure this type matches ConversationMetadata or is handled
    RenameResult,
    NewConversationResult, // Import NewConversationResult
    BackendEditUserMessagePayload, // <<< From your backend shared types
    BackendConversationUpdatedAfterEditPayload, // <<< From your backend shared types
    HistoryItem, // Assuming this is your backend message type
} from '../../chatbot/shared/types';

// --- Constants ---
const CORE_HANDLER_NAME = 'coreHandlers';
const DEFAULT_HISTORY_LIMIT = 50;

interface StartNewConversationPayload {
    language?: string;
}

export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket
): void => {
    const socketId = socket.id;
    const userId = socket.data.userId || 'Anonymous';

    let conversationHistoryService: ConversationHistoryService;
    try {
        conversationHistoryService = container.resolve(ConversationHistoryService);
    } catch (error: any) {
        logToFile(`[${CORE_HANDLER_NAME}][${socketId}][${userId}] CRITICAL: Failed to resolve core services: ${error.message}, Stack: ${error.stack}`);
        socket.emit('critical_error', { message: "Server configuration error. Please try reconnecting later." });
        socket.disconnect(true);
        return;
    }

    logToFile(`[${CORE_HANDLER_NAME}][${socketId}][${userId}] Registering core event handlers for connection.`);

    const sendChatError = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        const logMessage = `[ERROR] ${logContext} Chat error occurred. Step: ${step}, Message: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        logToFile(logMessage);
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    const sendChatWarning = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        const logMessage = `[WARNING] ${logContext} Chat warning occurred. Step: ${step}, Message: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        logToFile(logMessage);
        socket.emit('chat_warning', { type: 'warning', message, step } as WarningUpdate);
    };

    /**
     * Fetches the updated conversation list for the user and emits it via 'conversation_list'.
     * Logs success or failure.
     * @param logContext - Chuỗi context cho log.
     * @param userId - The ID of the user whose list should be updated.
     * @param reason - A brief description of why the list is being updated (for logging).
     * @param language - Optional: The language for generating default titles if needed.
     */
    const emitUpdatedConversationList = async (
        logContext: string,
        userId: string,
        reason: string,
        language?: string // << ADDED language parameter
    ): Promise<void> => {
        const langForLog = language || 'N/A';
        logToFile(`[DEBUG] ${logContext} Attempting to fetch and emit updated conversation list. Reason: ${reason}, Lang: ${langForLog}`);
        try {
            // Pass language to the service method
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userId, undefined, language);
            // Assuming ClientConversationMetadata is compatible with ConversationMetadata
            // or you have a mapping function if they differ significantly.
            socket.emit('conversation_list', updatedList as ClientConversationMetadata[]);
            logToFile(`[INFO] ${logContext} Emitted updated conversation list. Reason: ${reason}, Count: ${updatedList.length}, Lang: ${langForLog}`);
        } catch (error: any) {
            logToFile(`[WARNING] ${logContext} Failed to fetch/emit updated conversation list. Reason: ${reason}, Error: ${error.message}, Lang: ${langForLog}`);
        }
    };

    const ensureAuthenticated = (logContext: string, eventName: string): string | null => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            sendChatError(logContext, `Authentication required for ${eventName}.`, 'auth_required', { event: eventName });
            return null;
        }
        return currentUserId;
    };

    // --- Event Handlers ---

    socket.on('get_conversation_list', async () => { // Renamed from get_initial_conversations for clarity
        const eventName = 'get_conversation_list';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        logToFile(`[INFO] ${handlerLogContext} '${eventName}' request received.`);
        try {
            // For initial list, we might not have a specific language from client for *this call*.
            // The service will use its default logic.
            // If language is stored on socket.data.language from auth, you could use it.
            const userLanguage = socket.data.language as string | undefined; // Example: if you store it
            const conversationList = await conversationHistoryService.getConversationListForUser(currentUserId, undefined, userLanguage);
            socket.emit('conversation_list', conversationList as ClientConversationMetadata[]);
            logToFile(`[INFO] ${handlerLogContext} Sent conversation list. Count: ${conversationList.length}, Lang used: ${userLanguage || 'service_default'}`);
        } catch (error: any) {
            sendChatError(handlerLogContext, 'Failed to retrieve conversation list.', 'list_fetch_fail', { error: error.message });
        }
    });

    socket.on('load_conversation', async (data: unknown) => {
        const eventName = 'load_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;

        console.log(`[SERVER DEBUG - HANDLER ENTERED] Received 'load_conversation' event. Socket ID: ${socket.id}. Data:`, data);
        logToFile(`[INFO] ${handlerLogContext} Raw 'load_conversation' event received. Data: ${JSON.stringify(data)?.substring(0, 200) + (JSON.stringify(data)?.length > 200 ? '...' : '')}`);

        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as LoadConversationData)?.conversationId !== 'string' || !(data as LoadConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_load');
        }
        const requestedConvId = (data as LoadConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${requestedConvId}]`;

        logToFile(`[INFO] ${convLogContext} Request received.`);

        try {
            const history = await conversationHistoryService.getConversationHistory(requestedConvId, currentUserId, DEFAULT_HISTORY_LIMIT);

            if (history === null) {
                return sendChatError(convLogContext, 'Conversation not found or access denied.', 'history_not_found_load', { conversationId: requestedConvId });
            }

            const frontendMessages: ChatMessage[] = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId;
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            logToFile(`[INFO] ${convLogContext} Sent history. Set as active conversation. Message Count: ${frontendMessages.length}`);

        } catch (error: any) {
            sendChatError(convLogContext, `Server error loading conversation history.`, 'history_load_fail_server', { conversationId: requestedConvId, error: error.message });
        }
    });

    socket.on('start_new_conversation', async (payload: StartNewConversationPayload) => {
        const eventName = 'start_new_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        const language = payload?.language; // Extract language from payload
        socket.data.language = language; // Optionally store it on socket for other handlers if needed

        logToFile(`[INFO] ${handlerLogContext} Request received. Language: ${language || 'N/A'}`);
        try {
            // Pass language to the service method
            const newConversationData: NewConversationResult = await conversationHistoryService.createNewConversation(currentUserId, language);

            socket.data.currentConversationId = newConversationData.conversationId;
            const convLogContext = `${handlerLogContext}[Conv:${newConversationData.conversationId}]`;
            logToFile(`[DEBUG] ${convLogContext} Emitting 'new_conversation_started' with title: "${newConversationData.title}".`);

            // Emit the full NewConversationResult object or a subset
            socket.emit('new_conversation_started', {
                conversationId: newConversationData.conversationId,
                title: newConversationData.title, // This is the language-specific title
                lastActivity: newConversationData.lastActivity.toISOString(),
                isPinned: newConversationData.isPinned,
                // language: language // Optionally echo back the language if FE needs it
            });
            logToFile(`[INFO] ${convLogContext} Started new conversation. Title: "${newConversationData.title}". Set as active.`);

            // Update the list on the frontend, passing the language for consistency
            await emitUpdatedConversationList(handlerLogContext, currentUserId, 'new conversation started', language);

        } catch (error: any) {
            sendChatError(handlerLogContext, `Could not start new conversation.`, 'new_conv_fail_server', { userId: currentUserId, error: error.message });
        }
    });


    socket.on('send_message', async (data: unknown) => {
        const eventName = 'send_message';
        const handlerId = `${socketId.substring(0, 4)}-${Date.now()}`;
        let handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}][Req:${handlerId}]`;

        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;
        handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${currentUserId}][Req:${handlerId}]`;

        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogContext, 'Authentication session error. Please re-login.', 'missing_token_auth', { userId: currentUserId });
        }

        if (
            typeof data !== 'object' || data === null ||
            typeof (data as SendMessageData)?.userInput !== 'string' || !(data as SendMessageData).userInput?.trim() ||
            typeof (data as SendMessageData)?.language !== 'string' || !(data as SendMessageData).language
        ) {
            return sendChatError(handlerLogContext, 'Invalid message data: Missing or invalid "userInput" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const { userInput, isStreaming = true, language, conversationId: payloadConversationId, frontendMessageId } = data as SendMessageData;
        // Store language from message on socket.data if it's more reliable for subsequent calls in this session
        socket.data.language = language;

        logToFile(
            `[INFO] ${handlerLogContext} Request received.` +
            ` UserInput: "${userInput.substring(0, 30) + (userInput.length > 30 ? '...' : '')}"` +
            `, Streaming: ${isStreaming}` +
            `, Language: ${language}` +
            `, PayloadConvId: ${payloadConversationId || 'N/A'}` +
            `, SocketDataConvId: ${socket.data.currentConversationId || 'N/A'}`
        );

        let targetConversationId: string;

        if (payloadConversationId) {
            targetConversationId = payloadConversationId;
            handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${currentUserId}][Req:${handlerId}][Conv:${targetConversationId}]`;
            if (socket.data.currentConversationId !== targetConversationId) {
                logToFile(`[INFO] ${handlerLogContext} Updating socket.data.currentConversationId to match payloadConversationId. Old: ${socket.data.currentConversationId || 'N/A'}`);
                socket.data.currentConversationId = targetConversationId;
            }
            logToFile(`[INFO] ${handlerLogContext} Using conversationId from payload.`);
        } else {
            logToFile(`[INFO] ${handlerLogContext} payloadConversationId is null/undefined. Client requests new conversation.`);
            try {
                // Create new conversation with the language from the send_message payload
                const newConvResult = await conversationHistoryService.createNewConversation(currentUserId, language);
                targetConversationId = newConvResult.conversationId;
                handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${currentUserId}][Req:${handlerId}][Conv:${targetConversationId}]`;
                socket.data.currentConversationId = targetConversationId;

                logToFile(`[INFO] ${handlerLogContext} Explicitly created new conversation based on payload and set as active. Title: "${newConvResult.title}"`);
                socket.emit('new_conversation_started', {
                    conversationId: targetConversationId,
                    title: newConvResult.title,
                    lastActivity: newConvResult.lastActivity.toISOString(),
                    isPinned: newConvResult.isPinned,
                    // language: language // Optionally echo language
                });
                await emitUpdatedConversationList(handlerLogContext, currentUserId, 'new conversation from send_message', language);
            } catch (error: any) {
                return sendChatError(handlerLogContext, `Could not start new chat session as requested by client.`, 'explicit_new_conv_payload_fail', { userId: currentUserId, error: error.message });
            }
        }

        if (!targetConversationId) {
            logToFile(`[ERROR] ${handlerLogContext} CRITICAL: targetConversationId could not be determined.`);
            return sendChatError(handlerLogContext, 'Internal server error: Could not determine chat session.', 'target_id_undetermined');
        }

        let currentHistory: HistoryItem[];
        try {
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, currentUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                logToFile(`[ERROR] ${handlerLogContext} Failed to fetch history for target conversation.`);
                if (socket.data.currentConversationId === targetConversationId) {
                    socket.data.currentConversationId = undefined;
                    logToFile(`[INFO] ${handlerLogContext} Cleared socket.data.currentConversationId as target was invalid.`);
                }
                return sendChatError(handlerLogContext, 'Chat session error or invalid conversation ID. Please select a valid conversation or start a new one.', 'history_not_found_send', { convId: targetConversationId });
            }
            currentHistory = fetchedHistory;
            logToFile(`[INFO] ${handlerLogContext} Fetched current history. Count: ${currentHistory.length}`);
        } catch (error: any) {
            return sendChatError(handlerLogContext, `Could not load chat history.`, 'history_fetch_fail_send', { convId: targetConversationId, error: error.message });
        }

        try {
            let updatedHistory: HistoryItem[] | void | undefined = undefined;
            let resultAction: FrontendAction | undefined = undefined;

            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    logToFile(`[INFO] ${handlerLogContext} Staging email confirmation action. Confirmation ID: ${action.payload.confirmationId}`);
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, handlerId, io);
                }
            };

            if (isStreaming) {
                logToFile(`[DEBUG] ${handlerLogContext} Calling streaming intent handler.`);
                updatedHistory = await handleStreaming(userInput, currentHistory, socket, language as Language, handlerId, handleAction, frontendMessageId); // <<< Thêm frontendMessageId
            } else {
                logToFile(`[DEBUG] ${handlerLogContext} Calling non-streaming intent handler.`);
                const handlerResult = await handleNonStreaming(userInput, currentHistory, socket, language as Language, handlerId, frontendMessageId); // <<< Thêm frontendMessageId
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    resultAction = handlerResult.action;
                    handleAction(resultAction);
                }
            }

            if (Array.isArray(updatedHistory)) {
                logToFile(`[INFO] ${handlerLogContext} Intent handler returned updated history. Attempting save. New size: ${updatedHistory.length}`);
                try {
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);
                    if (updateSuccess) {
                        logToFile(`[INFO] ${handlerLogContext} Successfully updated history in DB.`);
                        // Pass language when updating list after saving message
                        await emitUpdatedConversationList(handlerLogContext, currentUserId, 'message saved', language);
                    } else {
                        logToFile(`[ERROR] ${handlerLogContext} History save failed: Target conversation not found or unauthorized during update.`);
                        sendChatWarning(handlerLogContext, 'Failed to save message history. Conversation might be out of sync.', 'history_save_fail_target', { convId: targetConversationId });
                    }
                } catch (dbError: any) {
                    logToFile(`[ERROR] ${handlerLogContext} CRITICAL: Error updating history in DB. Error: ${dbError.message}`);
                    sendChatError(handlerLogContext, 'A critical error occurred while saving your message.', 'history_save_exception', { error: dbError.message });
                }
            } else {
                logToFile(`[INFO] ${handlerLogContext} No history array returned by handler for explicit DB update here. DB not updated by this block. Reason: ${isStreaming ? 'Streaming handler (or void)' : 'Non-streaming handler returned no history'}`);
            }

        } catch (handlerError: any) {
            logToFile(`[ERROR] ${handlerLogContext} Error processing message via intent handler. Error: ${handlerError.message}`);
            sendChatError(handlerLogContext, `Error processing message: ${handlerError.message}`, 'handler_exception', { error: handlerError.message });
        }
    });

    socket.on('edit_user_message', async (data: unknown) => {
        const eventName = 'edit_user_message';
        const handlerIdSuffix = Date.now(); // Để tạo unique handlerId cho mỗi request
        const baseLogContext = `[${CORE_HANDLER_NAME}][${socketId}][Req:${handlerIdSuffix}]`;
        const currentUserId = ensureAuthenticated(baseLogContext, eventName);
        if (!currentUserId) return;
        const handlerLogContext = `${baseLogContext}[User:${currentUserId}]`;

        const payload = data as BackendEditUserMessagePayload;
        if (
            !payload ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.messageIdToEdit !== 'string' || !payload.messageIdToEdit ||
            typeof payload.newText !== 'string' || // Cho phép newText rỗng nếu muốn xóa, nhưng frontend nên trim()
            typeof payload.language !== 'string' || !payload.language
        ) {
            return sendChatError(handlerLogContext, 'Invalid payload for edit_user_message.', 'invalid_payload_edit', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const { conversationId, messageIdToEdit, newText, language } = payload; // messageIdToEdit IS THE UUID
        const isStreaming = socket.data.isStreamingEnabled ?? true; // Lấy từ client settings hoặc mặc định

        const convLogContext = `${handlerLogContext}[Conv:${conversationId}][Msg:${messageIdToEdit}]`;
        logToFile(`[INFO] ${convLogContext} Edit request. New text: "${newText.substring(0, 30)}...", Streaming: ${isStreaming}, Lang: ${language}`);

        try {
            // 1. Chuẩn bị dữ liệu từ service
            const prepareResult = await conversationHistoryService.updateUserMessageAndPrepareHistory(
                currentUserId,
                conversationId,
                messageIdToEdit, // Đây là UUID
                newText // Service sẽ trim() nếu cần thiết, hoặc frontend đã trim
            );

            if (!prepareResult) { // Lỗi nghiêm trọng trong service (ví dụ: DB error đã throw)
                return sendChatError(convLogContext, 'Internal server error preparing message for edit.', 'edit_prepare_service_critical_fail');
            }
            if (!prepareResult.originalConversationFound) {
                return sendChatError(convLogContext, 'Conversation not found for edit.', 'edit_conv_not_found', { conversationId });
            }
            if (!prepareResult.messageFoundAndIsLastUserMessage) {
                return sendChatError(convLogContext, 'Message to edit not found or is not the latest user message.', 'edit_msg_invalid_target', { messageIdToEdit });
            }

            const {
                editedUserMessage: preparedEditedUserMessage,
                historyForNewBotResponse
            } = prepareResult;

            // 2. Gọi handler AI (streaming hoặc non-streaming)
            let finalHistoryFromAI: HistoryItem[] | void | undefined;
            let actionFromAI: FrontendAction | undefined;
            const tokenForAction = socket.data.token as string | undefined; // Cần token cho một số action
            // handlerId dùng cho logging và các tác vụ liên quan đến request này
            const aiHandlerId = `${eventName}-${handlerIdSuffix}`;


            const handleAIActionCallback = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && tokenForAction) {
                    logToFile(`[INFO] ${convLogContext}[AIAction] Staging email confirmation. ConfID: ${action.payload.confirmationId}`);
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, tokenForAction, socket.id, aiHandlerId, io);
                }
                actionFromAI = action; // Lưu lại action nếu có
                // Thêm các xử lý action khác nếu cần
            };

            logToFile(`[DEBUG] ${convLogContext} Calling AI handler. History length: ${historyForNewBotResponse.length}. User input for AI (newText): "${newText}"`);

            if (isStreaming) {
                finalHistoryFromAI = await handleStreaming(
                    newText,
                    historyForNewBotResponse,
                    socket,
                    language as Language,
                    aiHandlerId,
                    handleAIActionCallback,
                    messageIdToEdit // <<<< PASS THE UUID OF THE MESSAGE BEING EDITED
                );
            } else {
                const nonStreamingResult = await handleNonStreaming(
                    newText,
                    historyForNewBotResponse,
                    socket,
                    language as Language,
                    aiHandlerId,
                    messageIdToEdit // <<<< PASS THE UUID OF THE MESSAGE BEING EDITED
                );
                if (nonStreamingResult) {
                    finalHistoryFromAI = nonStreamingResult.history;
                    // Nếu handleNonStreaming trả về action, xử lý nó
                    if (nonStreamingResult.action) {
                        handleAIActionCallback(nonStreamingResult.action);
                    }
                }
            }

            // 3. Xử lý và lưu lịch sử cuối cùng
            if (!Array.isArray(finalHistoryFromAI) || finalHistoryFromAI.length === 0) {
                logToFile(`[WARNING] ${convLogContext} AI handler did not return a valid history array.`);
                return sendChatWarning(convLogContext, 'Message edited, but AI interaction was inconclusive or did not return history.', 'edit_ai_no_history');
            }

            // finalHistoryFromAI lúc này nên là:
            // [..., historyForNewBotResponse trước đó..., editedUserMessage (từ historyForNewBotResponse), newBotMessage (từ AI)]
            // Vì handleStreaming/NonStreaming không push thêm user message mới do điều kiện if bên trong nó.

            const historyToSaveInDB = finalHistoryFromAI;
            logToFile(`[INFO] ${convLogContext} AI handler returned. Saving final history (size: ${historyToSaveInDB.length}) to DB.`);

            const saveSuccess = await conversationHistoryService.updateConversationHistory(
                conversationId, // ID cuộc trò chuyện gốc để update
                currentUserId,
                historyToSaveInDB
            );

            if (!saveSuccess) {
                logToFile(`[ERROR] ${convLogContext} Failed to save updated history to DB after AI response.`);
                return sendChatError(convLogContext, 'Failed to save edited message after AI response.', 'edit_final_save_fail_db');
            }

            logToFile(`[INFO] ${convLogContext} Successfully saved updated history to DB.`);
            await emitUpdatedConversationList(convLogContext, currentUserId, `message edited in conv ${conversationId}`, language);

            // Xác định newBotMessage từ historyToSaveInDB
            // Nó sẽ là tin nhắn cuối cùng nếu AI chỉ trả về 1 text response.
            // Nếu có function call sau đó, newBotMessage có thể phức tạp hơn.
            // Giả định đơn giản: newBotMessage là message cuối cùng có role 'model'.
            let newBotMessageForClient: HistoryItem | undefined;
            for (let i = historyToSaveInDB.length - 1; i >= 0; i--) {
                if (historyToSaveInDB[i].role === 'model') {
                    // Kiểm tra xem tin nhắn model này có phải là một phần của historyForNewBotResponse không
                    // (trừ trường hợp editedUserMessage chính là model, điều này không nên xảy ra)
                    // Điều này để đảm bảo chúng ta lấy đúng tin nhắn *mới* từ bot.
                    const isOldBotMessage = historyForNewBotResponse.some(
                        oldMsg => oldMsg.role === 'model' && JSON.stringify(oldMsg.parts) === JSON.stringify(historyToSaveInDB[i].parts) && oldMsg.timestamp === historyToSaveInDB[i].timestamp
                    );
                    // Hoặc một cách đơn giản hơn là tìm message cuối cùng trong historyToSaveInDB mà không có trong historyForNewBotResponse (ngoại trừ editedUserMessage)
                    // Vì historyForNewBotResponse chứa editedUserMessage ở cuối.
                    // Vậy, newBotMessage phải là message không có trong slice(0, historyForNewBotResponse.length) của historyToSaveInDB.
                    if (i >= historyForNewBotResponse.length) { // Nó nằm sau phần history đã gửi cho AI
                        newBotMessageForClient = historyToSaveInDB[i];
                        break;
                    }
                }
            }
            // Hoặc, nếu handleStreaming/NonStreaming trả về newBotMessage một cách rõ ràng, hãy dùng nó.
            // Hiện tại, chúng ta giả định newBotMessage là phần tử cuối cùng của `historyToSaveInDB` nếu role là 'model'.
            // Cần cẩn thận nếu AI có thể trả về nhiều message hoặc function call.
            if (!newBotMessageForClient && historyToSaveInDB.length > historyForNewBotResponse.length) {
                // Fallback: lấy message cuối cùng nếu nó là model và không phải là message đã có trước đó
                const lastMessageInSavedHistory = historyToSaveInDB[historyToSaveInDB.length - 1];
                if (lastMessageInSavedHistory.role === 'model') {
                    newBotMessageForClient = lastMessageInSavedHistory;
                }
            }


            if (!newBotMessageForClient) {
                logToFile(`[WARNING] ${convLogContext} Could not reliably identify the new bot message...`);
                const partialPayload: Partial<BackendConversationUpdatedAfterEditPayload> = {
                    // Map to the structure frontend expects (ChatMessage in backend shared types)
                    editedUserMessage: mapHistoryItemToChatMessage(preparedEditedUserMessage), // <<< MAP HERE
                    conversationId: conversationId,
                    // newBotMessage will be undefined here as per your backend shared type
                };
                socket.emit('conversation_updated_after_edit', partialPayload);
                return sendChatWarning(convLogContext, 'Message edited, but new bot response could not be identified clearly. User message updated.', 'edit_bot_response_unclear');
            }

            logToFile(`[INFO] ${convLogContext} Identified new bot message for client. UUID (if any): ${(newBotMessageForClient as any).uuid}`);

            // Map to the structure frontend expects
            const frontendPayload: BackendConversationUpdatedAfterEditPayload = {
                editedUserMessage: mapHistoryItemToChatMessage(preparedEditedUserMessage), // <<< MAP HERE
                newBotMessage: mapHistoryItemToChatMessage(newBotMessageForClient),       // <<< MAP HERE
                conversationId: conversationId,
            };
            socket.emit('conversation_updated_after_edit', frontendPayload);
            logToFile(`[INFO] ${convLogContext} Emitted 'conversation_updated_after_edit' to client with mapped messages.`);

        } catch (error: any) {
            logToFile(`[ERROR] ${convLogContext} Unhandled exception in edit_user_message: ${error.message}. Stack: ${error.stack}`);
            sendChatError(convLogContext, `Server error during message edit: ${error.message || 'Unknown error'}`, 'edit_exception_unhandled', { errorDetails: error.message });
        }
    });

    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            const confirmationLogContext = `${handlerLogContext}[Confirm:${confirmationId}]`;
            logToFile(`[INFO] ${confirmationLogContext} Request received.`);
            handleUserEmailConfirmation(confirmationId, socket);
        } else {
            logToFile(`[WARNING] ${handlerLogContext} Received invalid event data for email confirmation. Data: ${JSON.stringify(data)?.substring(0, 100)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data received.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            const confirmationLogContext = `${handlerLogContext}[Cancel:${confirmationId}]`;
            logToFile(`[INFO] ${confirmationLogContext} Request received.`);
            handleUserEmailCancellation(confirmationId, socket);
        } else {
            logToFile(`[WARNING] ${handlerLogContext} Received invalid event data for email cancellation. Data: ${JSON.stringify(data)?.substring(0, 100)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data received.' });
        }
    });

    socket.on('delete_conversation', async (data: unknown) => {
        const eventName = 'delete_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as DeleteConversationData)?.conversationId !== 'string' || !(data as DeleteConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_delete');
        }
        const conversationIdToDelete = (data as DeleteConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToDelete}]`;

        logToFile(`[INFO] ${convLogContext} Request received.`);
        try {
            const success = await conversationHistoryService.deleteConversation(conversationIdToDelete, currentUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed deletion.`);
                socket.emit('conversation_deleted', { conversationId: conversationIdToDelete });
                if (socket.data.currentConversationId === conversationIdToDelete) {
                    logToFile(`[INFO] ${convLogContext} Deleted conversation was active. Clearing active ID.`);
                    socket.data.currentConversationId = undefined;
                }
                // Get current language from socket.data if stored, otherwise let service use default
                const currentLanguage = socket.data.language as string | undefined;
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `deleted conversation ${conversationIdToDelete}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not delete conversation. It might not exist or you may not have permission.', 'delete_fail_permission', { conversationId: conversationIdToDelete });
            }
        } catch (error: any) {
            sendChatError(convLogContext, `Server error deleting conversation.`, 'delete_fail_server', { conversationId: conversationIdToDelete, error: error.message });
        }
    });

    socket.on('clear_conversation', async (data: unknown) => {
        const eventName = 'clear_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        if (typeof data !== 'object' || data === null || typeof (data as ClearConversationData)?.conversationId !== 'string' || !(data as ClearConversationData).conversationId) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId".', 'invalid_request_clear');
        }
        const conversationIdToClear = (data as ClearConversationData).conversationId;
        const convLogContext = `${handlerLogContext}[Conv:${conversationIdToClear}]`;

        logToFile(`[INFO] ${convLogContext} Request received.`);
        try {
            const success = await conversationHistoryService.clearConversationMessages(conversationIdToClear, currentUserId);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully processed message clearing.`);
                socket.emit('conversation_cleared', { conversationId: conversationIdToClear });
                if (socket.data.currentConversationId === conversationIdToClear) {
                    logToFile(`[INFO] ${convLogContext} Cleared conversation was active. Emitting empty history.`);
                    socket.emit('initial_history', { conversationId: conversationIdToClear, messages: [] });
                }
                const currentLanguage = socket.data.language as string | undefined;
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `cleared conversation ${conversationIdToClear}`, currentLanguage);
            } else {
                sendChatError(convLogContext, 'Could not clear conversation messages. It might not exist or you may not have permission.', 'clear_fail_permission', { conversationId: conversationIdToClear });
            }
        } catch (error: any) {
            sendChatError(convLogContext, `Server error clearing conversation messages.`, 'clear_fail_server', { conversationId: conversationIdToClear, error: error.message });
        }
    });

    socket.on('rename_conversation', async (data: unknown) => {
        const eventName = 'rename_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        const payload = data as RenameConversationData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.newTitle !== 'string'
        ) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId" or "newTitle".', 'invalid_request_rename');
        }
        const { conversationId, newTitle } = payload;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`;

        logToFile(`[INFO] ${convLogContext} Request received. New Title Preview: "${newTitle.substring(0, 30) + (newTitle.length > 30 ? '...' : '')}"`);

        try {
            const renameOpResult: RenameResult = await conversationHistoryService.renameConversation(conversationId, currentUserId, newTitle);

            if (renameOpResult.success) {
                logToFile(`[INFO] ${convLogContext} Successfully renamed conversation. Updated Title: "${renameOpResult.updatedTitle}"`);
                socket.emit('conversation_renamed', {
                    conversationId: renameOpResult.conversationId,
                    newTitle: renameOpResult.updatedTitle
                });
                const currentLanguage = socket.data.language as string | undefined;
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `renamed conv ${conversationId}`, currentLanguage);
            } else {
                logToFile(`[ERROR] ${convLogContext} Rename failed based on service logic.`);
                sendChatError(convLogContext, 'Could not rename. Check ID, permissions, or title validity.', 'rename_fail_logic', { conversationId });
            }
        } catch (error: any) {
            sendChatError(convLogContext, 'Server error renaming conversation.', 'rename_fail_server', { conversationId, error: error.message });
        }
    });

    socket.on('pin_conversation', async (data: unknown) => {
        const eventName = 'pin_conversation';
        const handlerLogContext = `[${CORE_HANDLER_NAME}][${socketId}][${userId}]`;
        const currentUserId = ensureAuthenticated(handlerLogContext, eventName);
        if (!currentUserId) return;

        const payload = data as PinConversationData;
        if (
            typeof payload !== 'object' || payload === null ||
            typeof payload.conversationId !== 'string' || !payload.conversationId ||
            typeof payload.isPinned !== 'boolean'
        ) {
            return sendChatError(handlerLogContext, 'Invalid request: Missing or invalid "conversationId" or "isPinned" status.', 'invalid_request_pin');
        }
        const { conversationId, isPinned } = payload;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}]`;

        logToFile(`[INFO] ${convLogContext} Request received. IsPinned: ${isPinned}`);

        try {
            const success = await conversationHistoryService.pinConversation(conversationId, currentUserId, isPinned);
            if (success) {
                logToFile(`[INFO] ${convLogContext} Successfully updated pin status. IsPinned: ${isPinned}`);
                socket.emit('conversation_pin_status_changed', { conversationId, isPinned });
                const currentLanguage = socket.data.language as string | undefined;
                await emitUpdatedConversationList(handlerLogContext, currentUserId, `pinned/unpinned conv ${conversationId}`, currentLanguage);
            } else {
                logToFile(`[ERROR] ${convLogContext} Pin status update failed. Check ID or permissions.`);
                sendChatError(convLogContext, 'Could not update pin status. Check ID or permissions.', 'pin_fail', { conversationId });
            }
        } catch (error: any) {
            sendChatError(convLogContext, 'Server error updating pin status.', 'pin_fail_server', { conversationId, error: error.message });
        }
    });

    logToFile(`[INFO] [${CORE_HANDLER_NAME}][${socketId}][${userId}] Core event handlers successfully registered.`);
};