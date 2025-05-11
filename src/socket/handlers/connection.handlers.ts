// src/socket/handlers/connection.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
// import { Logger } from 'pino'; // Xóa import Logger
// import { LoggingService } from '../../services/logging.service'; // Xóa import LoggingService
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { registerCoreHandlers } from './core.handlers';
import { fetchUserInfo } from '../../utils/chatbot/apiClient';
import logToFile from '../../utils/logger';

export const handleConnection = async (
    io: SocketIOServer,
    socket: Socket
) => {
    const socketId = socket.id;
    // const loggingService = container.resolve(LoggingService); // Xóa resolve LoggingService
    const conversationHistoryService = container.resolve(ConversationHistoryService);
    // const logger: Logger = loggingService.getLogger({ handler: 'connection', socketId }); // Xóa khai báo logger

    logToFile(`[SERVER GLOBAL][connection][${socketId}] New connection. Socket ID: ${socket.id}. Initial socket.data.userId: ${socket.data.userId}`);

    socket.onAny((eventName, ...args) => {
        logToFile(`[SERVER SOCKET ${socket.id} - ON ANY] Event: ${eventName}, Args: ${JSON.stringify(args)}`);
    });

    const token = socket.data.token as string | undefined; // token này được set từ middleware socketAuth
    logToFile(`[SERVER GLOBAL][connection][${socketId}] Client connected, processing authentication. Has token: ${!!token}`);

    try {
        if (token) {
            logToFile(`[SERVER GLOBAL][connection][${socketId}] Attempting to fetch user info using token...`);
            const userInfo = await fetchUserInfo(token);

            if (userInfo && userInfo.id) {
                socket.data.user = userInfo;
                socket.data.userId = userInfo.id; // Quan trọng: userId được set ở đây
                logToFile(`[SERVER GLOBAL][connection][${socketId}] User info fetched successfully. UserId: ${userInfo.id}, Email: ${userInfo.email}, Role: ${userInfo.role}`);

                // ĐĂNG KÝ CORE HANDLERS NGAY SAU KHI CÓ USERID VÀ TRƯỚC KHI EMIT BẤT KỲ GÌ BÁO HIỆU SẴN SÀNG
                logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Registering core event handlers NOW.`);
                registerCoreHandlers(io, socket);
                logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Core event handlers registered successfully after user auth.`);

                // BÂY GIỜ MỚI EMIT connection_ready
                logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Authenticated user session ready. Emitting connection_ready.`);
                socket.emit('connection_ready', { userId: userInfo.id, email: userInfo.email }); // Client sẽ đợi event này


                // Gửi danh sách conversation ban đầu (vẫn giữ lại nếu cần)
                try {
                    logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Fetching initial conversation list...`);
                    const conversationList = await conversationHistoryService.getConversationListForUser(userInfo.id);
                    socket.emit('conversation_list', conversationList);
                    logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Sent initial conversation list. Count: ${conversationList.length}`);
                } catch (listError: any) {
                    logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] ERROR fetching initial conversation list. Error: ${listError.message}`);
                    socket.emit('chat_error', { type: 'warning', message: 'Could not load initial conversation list.', step: 'initial_list_fail' });
                }


                logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Core event handlers registered successfully after user auth.`);
                socket.emit('server_ready', { userId: userInfo.id }); // <<< GỬI TÍN HIỆU NÀY
                logToFile(`[SERVER GLOBAL][connection][${socketId}][${userInfo.id}] Emitted "server_ready" to client.`);

            } else {
                logToFile(`[SERVER GLOBAL][connection][${socketId}] WARNING: Failed to fetch user info from API /me. Disconnecting.`);
                socket.emit('auth_error', { message: 'Failed to verify user information. Please log in again.' });
                socket.disconnect(true);
                return;
            }

        } else {
            // Xử lý cho user không có token (anonymous) nếu có
            logToFile(`[SERVER GLOBAL][connection][${socketId}] WARNING: No auth token found on socket. Potentially anonymous user or auth middleware issue. Disconnecting.`);
            socket.emit('auth_error', { message: 'Authentication token not found.' });
            socket.disconnect(true);
            return;
            // Nếu cho phép anonymous:
            // logToFile(`[SERVER GLOBAL][connection][${socketId}] Anonymous user connected.`);
            // socket.data.userId = `anonymous-${socket.id}`; // Gán một ID tạm
            // logToFile(`[SERVER GLOBAL][connection][${socketId}] Registering core handlers for anonymous user.`);
            // registerCoreHandlers(io, socket);
            // logToFile(`[SERVER GLOBAL][connection][${socketId}] Core event handlers registered for anonymous user.`);
            // socket.emit('connection_ready', { userId: socket.data.userId });
        }


        socket.on('disconnect', (reason: string) => {
            const userIdOnDisconnect = socket.data.userId as string | undefined;
            const convIdOnDisconnect = socket.data.currentConversationId as string | undefined;
            logToFile(`[SERVER GLOBAL][disconnect][${socketId}] Client disconnected. Reason: ${reason}, UserId: ${userIdOnDisconnect || 'N/A'}, ActiveConvId: ${convIdOnDisconnect || 'N/A'}`);
        });

        socket.on('error', (err: Error) => {
            logToFile(`[SERVER GLOBAL][socketError][${socketId}] ERROR: Socket Error occurred. Error: ${err.message}, Stack: ${err.stack}`);
        });

    } catch (error: any) {
        logToFile(`[SERVER GLOBAL][connection][${socketId}] FATAL ERROR: CRITICAL ERROR handling connection. Error: ${error.message}, Stack: ${error.stack}`);
        socket.emit('server_error', { message: 'A critical server error occurred during connection setup.' });
        socket.disconnect(true);
    }
};