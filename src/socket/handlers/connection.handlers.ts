// src/socket/handlers/connection.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { Logger } from 'pino'; // <<< Import Logger type
import { LoggingService } from '../../services/logging.service'; // <<< Import LoggingService
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
// import logToFile from '../../utils/logger'; // <<< XÓA
import { registerCoreHandlers } from './core.handlers';
import { fetchUserInfo } from '../../utils/chatbot/apiClient';

export const handleConnection = async (
    io: SocketIOServer,
    socket: Socket
) => {
    const socketId = socket.id;

    // <<< Resolve services
    const loggingService = container.resolve(LoggingService);
    const conversationHistoryService = container.resolve(ConversationHistoryService);
    // <<< Tạo child logger cho connection này
    const logger: Logger = loggingService.getLogger({ handler: 'connection', socketId });

    const token = socket.data.token as string | undefined;
    logger.info({ hasToken: !!token }, 'Client connected.'); // <<< Dùng logger

    try {
        if (token) {
            logger.info('Attempting to fetch user info using token...'); // <<< Dùng logger
            const userInfo = await fetchUserInfo(token);

            if (userInfo && userInfo.id) {
                socket.data.user = userInfo;
                socket.data.userId = userInfo.id;
                logger.info({ userId: userInfo.id, email: userInfo.email, role: userInfo.role }, 'User info fetched successfully.'); // <<< Dùng logger

                // --- BACKEND PROACTIVELY SENDS LIST ---
                try {
                    logger.info({ userId: userInfo.id }, 'Fetching initial conversation list...'); // <<< Dùng logger
                    const conversationList = await conversationHistoryService.getConversationListForUser(userInfo.id);
                    socket.emit('conversation_list', conversationList);
                    logger.info({ userId: userInfo.id, count: conversationList.length }, 'Sent initial conversation list.'); // <<< Dùng logger
                } catch (listError: any) {
                    logger.error({ userId: userInfo.id, error: listError.message }, 'Error fetching initial conversation list.'); // <<< Dùng logger
                    socket.emit('chat_error', { type: 'warning', message: 'Could not load initial conversation list.', step: 'initial_list_fail' });
                }
                // --------------------------------------

                logger.info({ userId: userInfo.id }, 'Authenticated user session ready.'); // <<< Dùng logger
                socket.emit('connection_ready', { userId: userInfo.id, email: userInfo.email });

            } else {
                logger.warn('Failed to fetch user info from API /me. Disconnecting.'); // <<< Dùng logger
                socket.emit('auth_error', { message: 'Failed to verify user information. Please log in again.' });
                socket.disconnect(true);
                return;
            }

        } else {
            logger.info('Anonymous user connected.'); // <<< Dùng logger
            socket.data.conversationId = null;
            socket.emit('connection_ready', { userId: null });
        }

        // registerCoreHandlers tự resolve logger và service bên trong nó
        registerCoreHandlers(io, socket);
        logger.info('Core event handlers registered.'); // <<< Dùng logger

        // --- Xử lý disconnect ---
        socket.on('disconnect', (reason: string) => {
            const userIdOnDisconnect = socket.data.userId as string | undefined;
            const convIdOnDisconnect = socket.data.currentConversationId as string | undefined;
            // <<< Tạo logger mới hoặc dùng logger cũ cho disconnect event
            const disconnectLogger = loggingService.getLogger({ handler: 'disconnect', socketId });
            disconnectLogger.info({ reason, userId: userIdOnDisconnect || 'Anonymous', activeConvId: convIdOnDisconnect || 'N/A' }, 'Client disconnected.'); // <<< Dùng logger
        });

        // --- Xử lý lỗi socket ---
        socket.on('error', (err: Error) => {
             // <<< Tạo logger mới hoặc dùng logger cũ cho error event
            const errorLogger = loggingService.getLogger({ handler: 'socketError', socketId });
            errorLogger.error({ error: err.message, stack: err.stack }, 'Socket Error occurred.'); // <<< Dùng logger
        });

    } catch (error: any) {
        // Lỗi nghiêm trọng trong quá trình xử lý connection ban đầu
        logger.fatal({ error: error.message, stack: error.stack }, 'CRITICAL ERROR handling connection'); // <<< Dùng logger
        socket.emit('server_error', { message: 'A critical server error occurred during connection setup.' });
        socket.disconnect(true);
    }
};