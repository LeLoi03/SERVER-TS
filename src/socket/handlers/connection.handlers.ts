// src/socket/handlers/connection.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../../services/logging.service';
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { registerCoreHandlers } from './core.handlers';
import { fetchUserInfo } from '../../utils/chatbot/apiClient';

export const handleConnection = async (
    io: SocketIOServer,
    socket: Socket
) => {
    const socketId = socket.id;
    const loggingService = container.resolve(LoggingService);
    const conversationHistoryService = container.resolve(ConversationHistoryService);
    const logger: Logger = loggingService.getLogger({ handler: 'connection', socketId });

    logger.info(`[SERVER GLOBAL] New connection. Socket ID: ${socket.id}. Initial socket.data.userId: ${socket.data.userId}`);

    socket.onAny((eventName, ...args) => {
        logger.info({ eventName, args }, `[SERVER SOCKET ${socket.id} - ON ANY]`);
    });

    // XÓA KHỐI NÀY VÌ NÓ KHÔNG HIỆU QUẢ Ở ĐÂY
    // if (socket.data.userId) {
    //     console.log(`[SERVER GLOBAL] Registering core handlers for authenticated socket ID: ${socket.id}, User ID: ${socket.data.userId}`);
    //     registerCoreHandlers(io, socket);
    // } else {
    //     console.error(`[SERVER GLOBAL] Cannot register core handlers for socket ID: ${socket.id}. User ID not set.`);
    // }

    const token = socket.data.token as string | undefined; // token này được set từ middleware socketAuth
    logger.info({ hasToken: !!token }, 'Client connected, processing authentication.');

    try {
        if (token) {
            logger.info('Attempting to fetch user info using token...');
            const userInfo = await fetchUserInfo(token);

            if (userInfo && userInfo.id) {
                socket.data.user = userInfo;
                socket.data.userId = userInfo.id; // Quan trọng: userId được set ở đây
                logger.info({ userId: userInfo.id, email: userInfo.email, role: userInfo.role }, 'User info fetched successfully.');

                // ĐĂNG KÝ CORE HANDLERS NGAY SAU KHI CÓ USERID VÀ TRƯỚC KHI EMIT BẤT KỲ GÌ BÁO HIỆU SẴN SÀNG
                logger.info({ userId: userInfo.id }, 'Registering core event handlers NOW.');
                registerCoreHandlers(io, socket);
                logger.info({ userId: userInfo.id }, 'Core event handlers registered successfully after user auth.');

                // BÂY GIỜ MỚI EMIT connection_ready
                logger.info({ userId: userInfo.id }, 'Authenticated user session ready. Emitting connection_ready.');
                socket.emit('connection_ready', { userId: userInfo.id, email: userInfo.email }); // Client sẽ đợi event này


                // Gửi danh sách conversation ban đầu (vẫn giữ lại nếu cần)
                try {
                    logger.info({ userId: userInfo.id }, 'Fetching initial conversation list...');
                    const conversationList = await conversationHistoryService.getConversationListForUser(userInfo.id);
                    socket.emit('conversation_list', conversationList);
                    logger.info({ userId: userInfo.id, count: conversationList.length }, 'Sent initial conversation list.');
                } catch (listError: any) {
                    logger.error({ userId: userInfo.id, error: listError.message }, 'Error fetching initial conversation list.');
                    socket.emit('chat_error', { type: 'warning', message: 'Could not load initial conversation list.', step: 'initial_list_fail' });
                }


                logger.info({ userId: userInfo.id }, 'Core event handlers registered successfully after user auth.');
                socket.emit('server_ready', { userId: userInfo.id }); // <<< GỬI TÍN HIỆU NÀY
                logger.info({ userId: userInfo.id }, 'Emitted "server_ready" to client.');

            } else {
                logger.warn('Failed to fetch user info from API /me. Disconnecting.');
                socket.emit('auth_error', { message: 'Failed to verify user information. Please log in again.' });
                socket.disconnect(true);
                return;
            }

        } else {
            // Xử lý cho user không có token (anonymous) nếu có
            logger.warn('No auth token found on socket. Potentially anonymous user or auth middleware issue. Disconnecting.');
            socket.emit('auth_error', { message: 'Authentication token not found.' });
            socket.disconnect(true);
            return;
            // Nếu cho phép anonymous:
            // logger.info('Anonymous user connected.');
            // socket.data.userId = `anonymous-${socket.id}`; // Gán một ID tạm
            // logger.info('Registering core handlers for anonymous user.');
            // registerCoreHandlers(io, socket);
            // logger.info('Core event handlers registered for anonymous user.');
            // socket.emit('connection_ready', { userId: socket.data.userId });
        }

        // XÓA LẦN GỌI registerCoreHandlers Ở ĐÂY VÌ ĐÃ DI CHUYỂN LÊN TRÊN
        // registerCoreHandlers(io, socket);
        // logger.info('Core event handlers registered.');

        socket.on('disconnect', (reason: string) => {
            const userIdOnDisconnect = socket.data.userId as string | undefined;
            const convIdOnDisconnect = socket.data.currentConversationId as string | undefined;
            const disconnectLogger = loggingService.getLogger({ handler: 'disconnect', socketId });
            disconnectLogger.info({ reason, userId: userIdOnDisconnect || 'N/A', activeConvId: convIdOnDisconnect || 'N/A' }, 'Client disconnected.');
        });

        socket.on('error', (err: Error) => {
            const errorLogger = loggingService.getLogger({ handler: 'socketError', socketId });
            errorLogger.error({ error: err.message, stack: err.stack }, 'Socket Error occurred.');
        });

    } catch (error: any) {
        logger.fatal({ error: error.message, stack: error.stack }, 'CRITICAL ERROR handling connection');
        socket.emit('server_error', { message: 'A critical server error occurred during connection setup.' });
        socket.disconnect(true);
    }
};