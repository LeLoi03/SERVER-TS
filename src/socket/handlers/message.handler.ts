// src/socket/handlers/message.handler.ts
import { HandlerDependencies } from './handler.types';
import {
    handleStreaming,
    handleNonStreaming
} from '../../chatbot/handlers/intentHandler.orchestrator';
import { stageEmailConfirmation } from '../../chatbot/utils/confirmationManager';
import { Part } from '@google/genai';
import { performance } from 'perf_hooks'; // <<< ĐÃ THÊM

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
const PAGE_CONTEXT_START_MARKER = "[START CURRENT PAGE CONTEXT]";
const PAGE_CONTEXT_END_MARKER = "[END CURRENT PAGE CONTEXT]";

export const registerMessageHandlers = (deps: HandlerDependencies): void => {
    const {
        io,
        socket,
        conversationHistoryService,
        socketId,
        sendChatError,
        sendChatWarning,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
        logger, // <<< ĐÃ THÊM
    } = deps;

    const baseLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}]`;

    socket.on('send_message', async (data: unknown) => {
        // <<< THÊM MỚI: Bắt đầu đo lường hiệu năng >>>
        const startTime = performance.now();
        (socket as any).requestStartTime = startTime; // Gán vào socket để các handler con có thể truy cập
        // <<< SỬA ĐỔI QUAN TRỌNG >>>
        // Lấy requestId từ client nếu có, nếu không thì mới tạo mới.
        // Điều này đảm bảo client và server dùng chung một ID.
        const payloadForId = data as { frontendMessageId?: string };
        const requestId = payloadForId.frontendMessageId || `${socketId.substring(0, 4)}-${Date.now()}`;
        // <<< KẾT THÚC SỬA ĐỔI >>>

        let performanceMetrics = {
            prepDuration_ms: 0,
            aiCallDuration_ms: 0,
        };
        // <<< KẾT THÚC THÊM MỚI >>>

        const eventName = 'send_message';
        let tempLogContext = `${baseLogContext}[${deps.userId}][Req:${requestId}]`;

        const authenticatedUserId = ensureAuthenticated(tempLogContext, eventName);
        if (!authenticatedUserId) return;

        const handlerLogContext = `[${MESSAGE_HANDLER_NAME}][${socketId}][${authenticatedUserId}][Req:${requestId}]`;

        const token = socket.data.token as string | undefined;
        if (!token) {
            return sendChatError(handlerLogContext, 'Authentication session error: token missing. Please re-login.', 'missing_token_auth', { userId: authenticatedUserId });
        }

        if (!isSendMessageData(data)) {
            return sendChatError(handlerLogContext, 'Invalid message payload: Missing "parts" or "language".', 'invalid_input_send', { dataReceived: JSON.stringify(data)?.substring(0, 200) });
        }

        const payload = data as SendMessageData;
        let {
            parts: originalPartsFromClient,
            isStreaming,
            language,
            conversationId: payloadConvId,
            frontendMessageId,
            personalizationData,
            originalUserFiles,
            pageContextUrl,
            model
        } = payload;

        socket.data.language = language;

        // --- XỬ LÝ PAGE CONTEXT (Giữ nguyên logic) ---
        let pageContextText: string | undefined = undefined;
        let userQueryParts: Part[] = [];
        if (originalPartsFromClient && originalPartsFromClient.length > 0) {
            const firstPart = originalPartsFromClient[0];
            if (firstPart.text && firstPart.text.startsWith(PAGE_CONTEXT_START_MARKER)) {
                const endIndex = firstPart.text.indexOf(PAGE_CONTEXT_END_MARKER);
                if (endIndex > -1) {
                    pageContextText = firstPart.text.substring(PAGE_CONTEXT_START_MARKER.length, endIndex).trim();
                    let remainingFirstPartText = firstPart.text.substring(endIndex + PAGE_CONTEXT_END_MARKER.length).trim();
                    const userQueryMarker = "User query:";
                    if (remainingFirstPartText.startsWith(userQueryMarker)) {
                        remainingFirstPartText = remainingFirstPartText.substring(userQueryMarker.length).trim();
                    }
                    if (remainingFirstPartText) {
                        userQueryParts.push({ text: remainingFirstPartText });
                    }
                    if (originalPartsFromClient.length > 1) {
                        userQueryParts.push(...originalPartsFromClient.slice(1));
                    }
                } else {
                    userQueryParts = [...originalPartsFromClient];
                }
            } else {
                userQueryParts = [...originalPartsFromClient];
            }
        }
        if (userQueryParts.length === 0 && !pageContextText) {
            return sendChatError(handlerLogContext, 'Cannot send an empty message without page context.', 'empty_message_no_context');
        }
        // --- KẾT THÚC XỬ LÝ PAGE CONTEXT ---

        // <<< THÊM MỚI: Log điểm bắt đầu (request_received) >>>
        logger.info({
            event: 'performance_log',
            stage: 'request_received',
            requestId,
            userId: authenticatedUserId,
            conversationId: payloadConvId || 'new',
            details: {
                isStreaming,
                language,
                model,
                messageLength: JSON.stringify(originalPartsFromClient).length,
                hasPageContext: !!pageContextText,
            }
        }, `Performance trace started for send_message.`);
        // <<< KẾT THÚC THÊM MỚI >>>

        let targetConversationId: string;
        let currentConvLogContext = handlerLogContext;

        // --- Xử lý Conversation ID (Giữ nguyên logic) ---
        if (payloadConvId) {
            targetConversationId = payloadConvId;
            currentConvLogContext = `${handlerLogContext}[Conv:${targetConversationId}]`;
            if (socket.data.currentConversationId !== targetConversationId) {
                socket.data.currentConversationId = targetConversationId;
            }
        } else {
            try {
                const newConvResult = await conversationHistoryService.createNewConversation(authenticatedUserId, language);
                targetConversationId = newConvResult.conversationId;
                currentConvLogContext = `${handlerLogContext}[Conv:${targetConversationId}]`;
                socket.data.currentConversationId = targetConversationId;
                socket.emit('new_conversation_started', {
                    conversationId: targetConversationId,
                    title: newConvResult.title,
                    lastActivity: newConvResult.lastActivity.toISOString(),
                    isPinned: newConvResult.isPinned,
                });
                await emitUpdatedConversationList(currentConvLogContext, authenticatedUserId, 'new conversation started from send_message', language);
            } catch (error: unknown) {
                const { message: errorMessage } = getErrorMessageAndStack(error);
                return sendChatError(handlerLogContext, `Could not start new chat session: ${errorMessage}.`, 'explicit_new_conv_payload_fail', { userId: authenticatedUserId, error: errorMessage });
            }
        }

        if (!targetConversationId) {
            return sendChatError(handlerLogContext, 'Internal error: Could not determine target chat session ID.', 'target_id_undetermined');
        }
        // --- Kết thúc xử lý Conversation ID ---

        let currentHistory: ChatHistoryItem[];
        try {
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, authenticatedUserId, DEFAULT_HISTORY_LIMIT);
            if (fetchedHistory === null) {
                if (socket.data.currentConversationId === targetConversationId) {
                    socket.data.currentConversationId = undefined;
                }
                return sendChatError(currentConvLogContext, 'Chat session not found or access denied.', 'history_not_found_send', { convId: targetConversationId });
            }
            currentHistory = fetchedHistory;
        } catch (error: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(error);
            return sendChatError(currentConvLogContext, `Could not load conversation history: ${errorMessage}.`, 'history_fetch_fail_send', { convId: targetConversationId, error: errorMessage });
        }

        try {
            let updatedHistory: ChatHistoryItem[] | void | undefined = undefined;

            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend' && token) {
                    stageEmailConfirmation(action.payload as ConfirmSendEmailAction, token, socketId, requestId, io);
                }
            };

            // <<< THÊM MỚI: Callback để nhận metrics từ các handler con >>>
            const performanceCallback = (metrics: { prep: number, ai: number }) => {
                performanceMetrics.prepDuration_ms = metrics.prep;
                performanceMetrics.aiCallDuration_ms = metrics.ai;
            };

            if (isStreaming) {
                // <<< SỬA ĐỔI: Truyền requestId, logger và callback xuống handler con >>>
                updatedHistory = await handleStreaming(
                    userQueryParts,
                    currentHistory,
                    socket,
                    language,
                    requestId, // Sử dụng requestId nhất quán
                    handleAction,
                    frontendMessageId,
                    personalizationData,
                    originalUserFiles,
                    pageContextText,
                    pageContextUrl,
                    model,
                    logger, // Truyền logger
                    performanceCallback // Truyền callback
                );
            } else {
                // Tương tự cho non-streaming nếu cần đo lường
                const handlerResult = await handleNonStreaming(
                    userQueryParts,
                    currentHistory,
                    socket,
                    language,
                    requestId,
                    frontendMessageId,
                    personalizationData,
                    originalUserFiles,
                    pageContextText,
                    pageContextUrl,
                    model
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
                    sendChatWarning(currentConvLogContext, 'Failed to save updated history after AI processing.', 'history_save_fail_target', { convId: targetConversationId });
                }
            } else {
                logger.warn({
                    requestId,
                    userId: authenticatedUserId,
                    conversationId: targetConversationId
                }, 'AI handler did not return an updated history array. History not saved.');
            }
        } catch (handlerError: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(handlerError);
            sendChatError(currentConvLogContext, `Error processing message with AI: ${errorMessage}.`, 'handler_exception', { error: errorMessage });
        } finally {
            // <<< THÊM MỚI: Log điểm kết thúc và tổng kết hiệu năng >>>
            const endTime = performance.now();
            const totalServerDuration_ms = endTime - startTime;
            // Tính toán thời gian xử lý sau khi AI trả về
            const postProcessingDuration_ms = Math.max(0, totalServerDuration_ms - performanceMetrics.prepDuration_ms - performanceMetrics.aiCallDuration_ms);

            logger.info({
                event: 'performance_log',
                stage: 'response_completed',
                requestId,
                userId: authenticatedUserId,
                conversationId: socket.data.currentConversationId,
                metrics: {
                    totalServerDuration_ms: parseFloat(totalServerDuration_ms.toFixed(2)),
                    prepDuration_ms: parseFloat(performanceMetrics.prepDuration_ms.toFixed(2)),
                    aiCallDuration_ms: parseFloat(performanceMetrics.aiCallDuration_ms.toFixed(2)),
                    postProcessingDuration_ms: parseFloat(postProcessingDuration_ms.toFixed(2)),
                }
            }, `Performance trace finished for send_message.`);
            // <<< KẾT THÚC THÊM MỚI >>>
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
            messageIdToEdit,
            newText,
            language,
            personalizationData
        } = data;

        const isStreaming = socket.data.isStreamingEnabled ?? true;
        const convLogContext = `${handlerLogContext}[Conv:${conversationId}][Msg:${messageIdToEdit}]`;


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
                editedUserMessage, // Tin nhắn user đã được cập nhật (để gửi lại cho client)
                historyForNewBotResponse // Lịch sử bao gồm tin nhắn user đã sửa, dùng để lưu DB
            } = prepareResult;

            // Lịch sử cho AI handler không bao gồm tin nhắn user vừa sửa (vì nó sẽ là input cho LLM)
            const historyForAIHandler = historyForNewBotResponse.slice(0, -1); // Bỏ tin nhắn user đã sửa ra khỏi history cho AI
            const partsForAIHandler = editedUserMessage.parts; // Parts của tin nhắn user đã sửa làm input cho AI




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
                    partsForAIHandler, // Input là tin nhắn user đã sửa
                    historyForAIHandler, // Lịch sử KHÔNG bao gồm tin nhắn user đã sửa
                    socket, language, aiHandlerId,
                    handleAIActionCallback, messageIdToEdit, personalizationData,
                    undefined, // originalUserFiles không áp dụng cho edit
                    undefined, // pageContextText không áp dụng cho edit
                    undefined // model không áp dụng cho edit, dùng default
                );
            } else {
                const nonStreamingResult = await handleNonStreaming(
                    partsForAIHandler,
                    historyForAIHandler,
                    socket, language, aiHandlerId,
                    messageIdToEdit, personalizationData,
                    undefined, // originalUserFiles không áp dụng cho edit
                    undefined, // pageContextText không áp dụng cho edit
                    undefined // model không áp dụng cho edit, dùng default
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

                } else {

                    historyToSaveInDB = [...historyForNewBotResponse];
                }
            } else {

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

            }

            await emitUpdatedConversationList(convLogContext, authenticatedUserId, `message edited in conv ${conversationId}`, language);

            if (newBotMessageForClient) {
                const frontendPayload: BackendConversationUpdatedAfterEditPayload = {
                    editedUserMessage: editedUserMessage,
                    newBotMessage: newBotMessageForClient,
                    conversationId: conversationId,
                };
                socket.emit('conversation_updated_after_edit', frontendPayload);

            }

        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            sendChatError(convLogContext, `Server error during message edit: ${errorMessage || 'Unknown'}.`, 'edit_exception_unhandled', { errorDetails: errorMessage, stack: errorStack });
        }
    })

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
}