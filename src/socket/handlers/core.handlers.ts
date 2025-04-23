// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { mapHistoryToFrontendMessages } from '../../chatbot/utils/historyMapper';
import logToFile from '../../utils/logger';
import { handleStreaming, handleNonStreaming } from '../../chatbot/handlers/intentHandler'; // Import intent handlers
import { stageEmailConfirmation, handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager'; // Import confirmation utils
import { HistoryItem, Language, FrontendAction, ConfirmSendEmailAction, ErrorUpdate } from '../../chatbot/shared/types'; // Import các type cần thiết

// Kiểu dữ liệu mong đợi từ client
interface SendMessageData {
    userInput: string;
    isStreaming?: boolean;
    language: Language;
}

interface LoadConversationData {
    conversationId: string;
}

interface ConfirmationEventData {
    confirmationId: string;
}

/**
 * Đăng ký tất cả các trình xử lý sự kiện cốt lõi cho một socket client.
 * Bao gồm quản lý conversation, gửi/nhận tin nhắn, và xử lý xác nhận.
 * @param io - Instance Socket.IO server.
 * @param socket - Instance Socket của client hiện tại.
 * @param conversationHistoryService - Instance của ConversationHistoryService.
 */
export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket,
    conversationHistoryService: ConversationHistoryService
) => {
    const socketId = socket.id;

    // Helper function để gửi lỗi chuẩn hóa về client
    const sendChatError = (message: string, step: string, handlerId?: string) => {
        logToFile(`[Socket ${socketId}${handlerId ? ` ${handlerId}` : ''}] Error: ${message} (Step: ${step})`);
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    logToFile(`[Socket ${socketId}] Registering core event handlers. UserID: ${socket.data.userId || 'Anonymous'}`);

    // --- Handler: Lấy danh sách conversations ---
    socket.on('get_conversation_list', async () => {
        const currentUserId = socket.data.userId as string | undefined; // <<< Dùng userId thật
        if (!currentUserId) {
            return sendChatError('Authentication required to fetch conversation list.', 'auth_required');
        }
        logToFile(`[Socket ${socketId}] Event 'get_conversation_list' received for user ${currentUserId}.`);
        try {
            const conversationList = await conversationHistoryService.getConversationListForUser(currentUserId);
            socket.emit('conversation_list', conversationList);
            logToFile(`[Socket ${socketId}] Sent conversation list (${conversationList.length} items) to user ${currentUserId}.`);
        } catch (error: any) {
            sendChatError(`Could not fetch conversation list: ${error.message}`, 'list_fetch_fail');
        }
    });

    // --- Handler: Load một conversation cụ thể ---
    socket.on('load_conversation', async (data: unknown) => { // Validate input
        const currentUserId = socket.data.userId as string | undefined; // <<< Dùng userId thật
        if (!currentUserId) {
            return sendChatError('Authentication required to load conversation.', 'auth_required');
        }

        // Validate data
        if (
            typeof data !== 'object' || data === null ||
            !('conversationId' in data) || typeof (data as LoadConversationData).conversationId !== 'string' ||
            (data as LoadConversationData).conversationId.length === 0
        ) {
            return sendChatError('Invalid request: Missing or invalid conversation ID.', 'invalid_request_load');
        }
        const requestedConvId = (data as LoadConversationData).conversationId;

        logToFile(`[Socket ${socketId}] Event 'load_conversation' received for ID: ${requestedConvId}, User: ${currentUserId}.`);
        try {
            const historyLimit = 50; // Or make this configurable
            // <<< Truyền userId thật vào service để kiểm tra quyền
            const history = await conversationHistoryService.getConversationHistory(requestedConvId, currentUserId, historyLimit);

            if (history === null) {
                return sendChatError('Conversation not found or access denied.', 'history_not_found_load');
            }

            const frontendMessages = mapHistoryToFrontendMessages(history);
            socket.data.currentConversationId = requestedConvId; // <<< Lưu ID đang ACTIVE
            socket.emit('initial_history', { conversationId: requestedConvId, messages: frontendMessages });
            logToFile(`[Socket ${socketId}] Sent history for conversation ${requestedConvId}. Set as active.`);
        } catch (error: any) {
            sendChatError(`Could not load conversation history: ${error.message}`, 'history_load_fail');
        }
    });

    // --- Handler: Bắt đầu cuộc trò chuyện mới ---
    socket.on('start_new_conversation', async () => {
        const currentUserId = socket.data.userId as string | undefined; // <<< Dùng userId thật
        if (!currentUserId) {
            return sendChatError('Authentication required to start a new conversation.', 'auth_required');
        }
        logToFile(`[Socket ${socketId}] Event 'start_new_conversation' received for user ${currentUserId}.`);
        try {
            // <<< Truyền userId thật vào service
            const { conversationId } = await conversationHistoryService.createNewConversation(currentUserId);
            socket.data.currentConversationId = conversationId; // <<< Lưu ID mới làm ACTIVE
            socket.emit('new_conversation_started', { conversationId }); // Chỉ gửi ID mới
            logToFile(`[Socket ${socketId}] Started new conversation ${conversationId}. Set as active.`);
            // Client sẽ tự fetch lại list nếu cần cập nhật UI ngay lập tức
            // Hoặc có thể gửi list mới từ đây:
            // const updatedList = await conversationHistoryService.getConversationListForUser(currentUserId);
            // socket.emit('conversation_list', updatedList);
        } catch (error: any) {
            sendChatError(`Could not start new conversation: ${error.message}`, 'new_conv_fail');
        }
    });

    // --- Handler: Gửi tin nhắn ---
    socket.on('send_message', async (data: unknown) => { // Validate input
        const handlerId = `MsgHandler-${Date.now()}`;
        const currentUserId = socket.data.userId as string | undefined; // <<< Dùng userId thật
        const token = socket.data.token as string | undefined; // Lấy token để dùng cho stageEmail

        // --- Auth Check ---
        if (!currentUserId) {
            return sendChatError('Authentication required to send messages.', 'auth_required', handlerId);
        }
        if (!token) {
            // Lỗi này không nên xảy ra nếu user đã xác thực
            return sendChatError('Authentication session error. Please re-login.', 'missing_token_auth', handlerId);
        }

        // --- Input Validation ---
        if (
            typeof data !== 'object' || data === null ||
            !('userInput' in data) || typeof (data as SendMessageData).userInput !== 'string' || (data as SendMessageData).userInput.trim().length === 0 ||
            !('language' in data) || typeof (data as SendMessageData).language !== 'string'
        ) {
            return sendChatError('Invalid message data received.', 'invalid_input_send', handlerId);
        }
        const { userInput, isStreaming = true, language } = data as SendMessageData;
        const activeConversationId = socket.data.currentConversationId as string | undefined;

        logToFile(`[Socket ${socketId} ${handlerId}] Event 'send_message' received: UserInput="${userInput.substring(0, 20)}...", Streaming=${isStreaming}, Lang=${language}, UserID=${currentUserId}, ActiveConvID=${activeConversationId}`);

        // --- Xác định/Tạo Target Conversation ID ---
        let targetConversationId: string | null = activeConversationId || null;
        if (!targetConversationId) {
            logToFile(`[Socket ${socketId} ${handlerId}] No active conversation. Creating new implicitly.`);
            try {
                const { conversationId: newConvId } = await conversationHistoryService.createNewConversation(currentUserId); // <<< userId thật
                targetConversationId = newConvId;
                socket.data.currentConversationId = newConvId; // Set active mới
                logToFile(`[Socket ${socketId} ${handlerId}] Implicitly created/set active conv ${targetConversationId}`);
                socket.emit('new_conversation_started', { conversationId: targetConversationId }); // Thông báo cho client ID mới
            } catch (error: any) {
                return sendChatError(`Could not start chat session: ${error.message}`, 'implicit_new_conv_fail', handlerId);
            }
        }
        // -----------------------------------------

        // --- Lấy History ---
        let currentHistory: HistoryItem[] = [];
        try {
            const historyLimit = 50;
            // <<< Truyền userId thật và target ID
            const fetchedHistory = await conversationHistoryService.getConversationHistory(targetConversationId, currentUserId, historyLimit);
            if (fetchedHistory === null) {
                return sendChatError('Chat session error. Please select a conversation or start a new one.', 'history_not_found_send', handlerId);
            }
            currentHistory = fetchedHistory;
            logToFile(`[Socket ${socketId} ${handlerId}] Fetched ${currentHistory.length} history items for conv ${targetConversationId}.`);
        } catch (error: any) {
            return sendChatError(`Could not load chat history: ${error.message}`, 'history_fetch_fail_send', handlerId);
        }
        // -----------------

        // --- Gọi Intent Handler ---
        try {
            let updatedHistory: HistoryItem[] | undefined | void = undefined;
            let resultAction: FrontendAction | undefined = undefined;

            // Callback để xử lý action từ intent handler
            const handleAction = (action: FrontendAction | undefined) => {
                if (action?.type === 'confirmEmailSend') {
                    logToFile(`[Socket ${socketId} ${handlerId}] Staging email confirmation...`);
                    // Gọi hàm staging, truyền token gốc
                    stageEmailConfirmation(
                        action.payload as ConfirmSendEmailAction,
                        token, // <<< Truyền token gốc
                        socketId,
                        handlerId,
                        io // Truyền io nếu cần emit global
                    );
                }
                // Xử lý các actions khác nếu cần (navigate, openMap...)
            };

            // Gọi handler phù hợp (streaming/non-streaming)
            if (isStreaming) {
                updatedHistory = await handleStreaming(
                    userInput,
                    currentHistory,
                    socket, // Truyền socket để emit trực tiếp
                    language,
                    handlerId,
                    handleAction // Truyền callback xử lý action
                );
            } else {
                const handlerResult = await handleNonStreaming(
                    userInput,
                    currentHistory,
                    socket, // Truyền socket để emit trực tiếp
                    language,
                    handlerId
                );
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    resultAction = handlerResult.action;
                    handleAction(resultAction); // Xử lý action trả về
                }
            }

            // --- Lưu History Mới ---
            if (Array.isArray(updatedHistory)) {
                // --- Add detailed logging here ---
                logToFile(`[${handlerId} Save History Check] History to save. Size: ${updatedHistory.length}. Content: ${JSON.stringify(updatedHistory, null, 2)}`); // Pretty print JSON
                // ---------------------------------
                try {

                    // <<< Truyền userId thật và target ID
                    const updateSuccess = await conversationHistoryService.updateConversationHistory(targetConversationId, currentUserId, updatedHistory);
                    if (updateSuccess) {
                        logToFile(`[Socket ${socketId} ${handlerId}] Successfully updated history in DB for conv ${targetConversationId}.`);
                        // Cập nhật danh sách bên client để thay đổi lastActivity/title
                        const updatedList = await conversationHistoryService.getConversationListForUser(currentUserId);
                        socket.emit('conversation_list', updatedList);
                    } else {
                        // Lỗi này đã được log bên trong service
                        // Có thể gửi warning về client nếu muốn
                        sendChatError('Failed to save message history. Conversation might be out of sync.', 'history_save_fail_warn', handlerId);
                    }
                } catch (updateError: any) {
                    // Lỗi nghiêm trọng khi update DB
                    logToFile(`[Socket ${socketId} ${handlerId}] CRITICAL Error updating history for conv ${targetConversationId}: ${updateError.message}`);
                    // Không nhất thiết báo về client, nhưng cần log kỹ
                }
            } else {
                logToFile(`[Socket ${socketId} ${handlerId}] Intent handler did not return an updated history array. DB not updated.`);
            }
            // -----------------------

        } catch (handlerError: any) {
            // Lỗi từ intent handler (Gemini, function call...)
            sendChatError(`Error processing message: ${handlerError.message}`, 'handler_exception', handlerId);
        }
        // -------------------------
    });

    // --- Handlers cho Confirmation ---
    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const currentUserId = socket.data.userId as string | undefined; // Lấy userId để log hoặc kiểm tra quyền nếu cần
        if (!currentUserId) { return sendChatError('Authentication required.', 'auth_required'); }

        if (
            typeof data === 'object' && data !== null && 'confirmationId' in data &&
            typeof (data as ConfirmationEventData).confirmationId === 'string' && (data as ConfirmationEventData).confirmationId.length > 0
        ) {
            const confirmationId = (data as ConfirmationEventData).confirmationId;
            logToFile(`[Socket ${socketId}] Event '${eventName}' received for ID: ${confirmationId}, User: ${currentUserId}`);
            // Gọi hàm xử lý, truyền socket để reply, có thể truyền userId nếu hàm cần
            handleUserEmailConfirmation(confirmationId, socket /*, currentUserId */);
        } else {
            logToFile(`[Socket ${socketId}] WARN: Received invalid '${eventName}' event data. Data: ${JSON.stringify(data)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) { return sendChatError('Authentication required.', 'auth_required'); }

        if (
            typeof data === 'object' && data !== null && 'confirmationId' in data &&
            typeof (data as ConfirmationEventData).confirmationId === 'string' && (data as ConfirmationEventData).confirmationId.length > 0
        ) {
            const confirmationId = (data as ConfirmationEventData).confirmationId;
            logToFile(`[Socket ${socketId}] Event '${eventName}' received for ID: ${confirmationId}, User: ${currentUserId}`);
            handleUserEmailCancellation(confirmationId, socket /*, currentUserId */);
        } else {
            logToFile(`[Socket ${socketId}] WARN: Received invalid '${eventName}' event data. Data: ${JSON.stringify(data)}`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data.' });
        }
    });

    logToFile(`[Socket ${socketId}] Core event handlers registered.`);
}; // Kết thúc registerCoreHandlers