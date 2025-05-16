// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { ConversationHistoryService, ConversationMetadata } from '../../chatbot/services/conversationHistory.service';
import logToFile from '../../utils/logger';

// --- Import sub-handler registration functions ---
import { registerConversationHandlers } from './conversation.handler';
import { registerMessageHandlers } from './message.handler';
import { registerConfirmationHandlers } from './confirmation.handler';

// --- Import types ---
import { HandlerDependencies } from './handler.types';
import { ClientConversationMetadata, ErrorUpdate, Language, WarningUpdate } from '../../chatbot/shared/types';

// --- Constants ---
const CORE_ORCHESTRATOR_NAME = 'coreOrchestrator'; // Renamed for clarity
const DEFAULT_HISTORY_LIMIT = 50;

export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket
): void => {
    const socketId = socket.id;
    // userId sẽ được lấy trong ensureAuthenticated hoặc khi cần,
    // nhưng chúng ta có thể lấy sớm nếu nó ổn định sau khi kết nối.
    // socket.data.userId có thể chưa có ngay khi hàm này được gọi nếu auth là async.
    // Tạm thời lấy ở đây, nhưng ensureAuthenticated vẫn là chốt chặn quan trọng.
    const getUserId = () => socket.data.userId || 'Anonymous';

    let conversationHistoryService: ConversationHistoryService;
    try {
        conversationHistoryService = container.resolve(ConversationHistoryService);
    } catch (error: any) {
        logToFile(`[${CORE_ORCHESTRATOR_NAME}][${socketId}][${getUserId()}] CRITICAL: Failed to resolve ConversationHistoryService: ${error.message}, Stack: ${error.stack}`);
        socket.emit('critical_error', { message: "Server configuration error. Please try reconnecting later." });
        socket.disconnect(true);
        return;
    }

    logToFile(`[${CORE_ORCHESTRATOR_NAME}][${socketId}][${getUserId()}] Initializing handler registration.`);

    // --- Common Utility Functions (sẽ được truyền cho sub-handlers) ---
    const sendChatError = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        const logMessage = `[ERROR] ${logContext} Chat error. Step: ${step}, Msg: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        logToFile(logMessage);
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    const sendChatWarning = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        const logMessage = `[WARNING] ${logContext} Chat warning. Step: ${step}, Msg: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        logToFile(logMessage);
        socket.emit('chat_warning', { type: 'warning', message, step } as WarningUpdate);
    };

    const emitUpdatedConversationList = async (
        logContext: string,
        userIdToList: string, // Đảm bảo userId này là userId thực sự của user
        reason: string,
        language?: Language
    ): Promise<void> => {
        const langForLog = language || 'N/A';
        logToFile(`[DEBUG] ${logContext} Emitting updated conversation list. Reason: ${reason}, Lang: ${langForLog}, ForUser: ${userIdToList}`);
        try {
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userIdToList, undefined, language);
            socket.emit('conversation_list', updatedList as ClientConversationMetadata[]);
            logToFile(`[INFO] ${logContext} Emitted updated list. Reason: ${reason}, Count: ${updatedList.length}, Lang: ${langForLog}, ForUser: ${userIdToList}`);
        } catch (error: any) {
            logToFile(`[WARNING] ${logContext} Failed to emit updated list. Reason: ${reason}, Error: ${error.message}, Lang: ${langForLog}, ForUser: ${userIdToList}`);
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

    // --- Prepare Dependencies for Sub-Handlers ---
    // userId sẽ được cập nhật mỗi khi ensureAuthenticated được gọi trong các sub-handler,
    // nhưng chúng ta cần một giá trị ban đầu hoặc một getter.
    // Cách tốt hơn là để mỗi sub-handler gọi ensureAuthenticated và sử dụng userId trả về.
    // Vậy, userId trong HandlerDependencies sẽ là giá trị user ID hiện tại của socket.
    const dependencies: HandlerDependencies = {
        io,
        socket,
        conversationHistoryService,
        logToFile,
        get userId() { return socket.data.userId || 'Anonymous'; }, // Use a getter to always get the latest
        socketId,
        sendChatError,
        sendChatWarning,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
    };

    // --- Register Sub-Handlers ---
    logToFile(`[${CORE_ORCHESTRATOR_NAME}][${socketId}][${dependencies.userId}] Registering sub-handlers.`);
    registerConversationHandlers(dependencies);
    registerMessageHandlers(dependencies);
    registerConfirmationHandlers(dependencies);

    logToFile(`[INFO] [${CORE_ORCHESTRATOR_NAME}][${socketId}][${dependencies.userId}] All event handlers successfully registered.`);
};