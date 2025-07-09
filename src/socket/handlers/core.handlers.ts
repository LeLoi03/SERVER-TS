// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { ConversationHistoryService, ConversationMetadata } from '../../chatbot/services/conversationHistory.service';
import { LoggingService } from '../../services/logging.service'; // <<< ĐÃ THÊM
import { Logger } from 'pino'; // <<< ĐÃ THÊM

// --- Import sub-handler registration functions ---
import { registerConversationHandlers } from './conversation.handler';
import { registerMessageHandlers } from './message.handler';
import { registerConfirmationHandlers } from './confirmation.handler';

// --- Import types ---
import { HandlerDependencies } from './handler.types';
import { ClientConversationMetadata, ErrorUpdate, Language, WarningUpdate } from '../../chatbot/shared/types';

/**
 * Default limit for fetching conversation history when not specified.
 */
const DEFAULT_HISTORY_LIMIT = 50;

/**
 * Registers the core set of Socket.IO event handlers for a given client socket.
 * This function sets up common utility functions and then delegates to specialized sub-handler registration functions.
 *
 * @param {SocketIOServer} io - The global Socket.IO server instance.
 * @param {Socket} socket - The specific Socket instance for the connected client.
 */
export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket
): void => {
    const socketId = socket.id;

    // <<< SỬA ĐỔI: Lấy logger từ DI container >>>
    const loggingService = container.resolve(LoggingService);
    const logger = loggingService.getLogger('app');
    // <<< KẾT THÚC SỬA ĐỔI >>>

    let conversationHistoryService: ConversationHistoryService;
    try {
        // Resolve ConversationHistoryService from the DI container.
        conversationHistoryService = container.resolve(ConversationHistoryService);
    } catch (error: any) {
        // <<< SỬA ĐỔI: Sử dụng logger để ghi lỗi nghiêm trọng >>>
        logger.error({ err: error, socketId }, "Critical error resolving ConversationHistoryService. Disconnecting client.");
        // <<< KẾT THÚC SỬA ĐỔI >>>
        socket.emit('critical_error', { message: "Server configuration error. Please try reconnecting later." });
        socket.disconnect(true); // Force disconnect
        return; // Prevent further execution if critical service is unavailable.
    }

    // --- Common Utility Functions (to be passed to sub-handlers) ---

    const sendChatError = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        // Ghi log lỗi ở đây nếu cần, ví dụ:
        // logger.error({ context: logContext, step, details }, message);
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    const sendChatWarning = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        // Ghi log cảnh báo ở đây nếu cần, ví dụ:
        // logger.warn({ context: logContext, step, details }, message);
        socket.emit('chat_warning', { type: 'warning', message, step } as WarningUpdate);
    };

    const emitUpdatedConversationList = async (
        logContext: string,
        userIdToList: string,
        reason: string,
        language?: Language
    ): Promise<void> => {
        try {
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userIdToList, undefined, language);
            socket.emit('conversation_list', updatedList as ClientConversationMetadata[]);
        } catch (error: any) {
            // Ghi log lỗi ở đây nếu cần
            logger.error({ err: error, context: logContext, userId: userIdToList, reason }, "Failed to emit updated conversation list.");
        }
    };

    const ensureAuthenticated = (logContext: string, eventName: string): string | null => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            sendChatError(logContext, `Authentication required to process event '${eventName}'. Please log in.`, 'auth_required', { event: eventName });
            return null;
        }
        return currentUserId;
    };

    // --- Prepare Dependencies Object for Sub-Handlers ---
    const dependencies: HandlerDependencies = {
        io,
        socket,
        conversationHistoryService,
        get userId() { return socket.data.userId || 'Anonymous'; },
        socketId,
        sendChatError,
        sendChatWarning,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
        logger, // <<< THÊM MỚI: Truyền logger vào dependencies
    };

    // --- Register Sub-Handlers ---
    registerConversationHandlers(dependencies);
    registerMessageHandlers(dependencies);
    registerConfirmationHandlers(dependencies);
};