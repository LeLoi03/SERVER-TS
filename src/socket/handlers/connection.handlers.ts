// src/socket/handlers/connection.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import logToFile from '../../utils/logger';
import { registerCoreHandlers } from './core.handlers';
import { fetchUserInfo } from '../../utils/apiClient';

export const handleConnection = async (
    io: SocketIOServer,
    socket: Socket,
    conversationHistoryService: ConversationHistoryService
) => {
    const socketId = socket.id;
    const token = socket.data.token as string | undefined;

    logToFile(`[Socket.IO ${socketId}] Client connected. Token present: ${!!token}`);

    if (token) {
        logToFile(`[Socket.IO ${socketId}] Attempting to fetch user info using token...`);
        const userInfo = await fetchUserInfo(token);

        if (userInfo && userInfo.id) {
            socket.data.user = userInfo;
            socket.data.userId = userInfo.id;
            logToFile(`[Socket.IO ${socketId}] User info fetched successfully. UserID: ${socket.data.userId}, Email: ${userInfo.email}, Role: ${userInfo.role}`);

            // --- BACKEND PROACTIVELY SENDS LIST ---
            try {
                logToFile(`[Socket.IO ${socketId}] Fetching initial conversation list for user ${socket.data.userId}...`);
                const conversationList = await conversationHistoryService.getConversationListForUser(socket.data.userId);
                socket.emit('conversation_list', conversationList); // <<< EMIT LIST HERE
                logToFile(`[Socket.IO ${socketId}] Sent initial conversation list (${conversationList.length} items) to user ${socket.data.userId}.`);
            } catch (listError: any) {
                logToFile(`[Socket.IO ${socketId}] Error fetching initial conversation list for user ${socket.data.userId}: ${listError.message}`);
                // Optionally emit an error, but the core connection is still ready
                socket.emit('chat_error', { type: 'warning', message: 'Could not load initial conversation list.', step: 'initial_list_fail' });
            }
            // --------------------------------------

            logToFile(`[Socket.IO ${socketId}] Authenticated user ${socket.data.userId} session ready.`);
            socket.emit('connection_ready', { userId: socket.data.userId, email: userInfo.email }); // Still useful to signal readiness

        } else {
            logToFile(`[Socket.IO ${socketId}] Failed to fetch user info from API /me. Disconnecting.`);
            socket.emit('auth_error', { message: 'Failed to verify user information. Please log in again.' });
            socket.disconnect(true);
            return;
        }

    } else {
        logToFile(`[Socket.IO ${socketId}] Anonymous user connected.`);
        socket.data.conversationId = null;
        socket.emit('connection_ready', { userId: null });
    }

    registerCoreHandlers(io, socket, conversationHistoryService);

    // -----------------------------------------

    // --- Xử lý disconnect ---
    socket.on('disconnect', (reason: string) => {
        const userIdOnDisconnect = socket.data.userId as string | undefined; // Lấy userId thật
        const convIdOnDisconnect = socket.data.currentConversationId as string | undefined; // Lấy ID đang active
        logToFile(`[Socket.IO ${socketId}] Client disconnected. Reason: ${reason}. UserID: ${userIdOnDisconnect || 'Anonymous'}. ActiveConvID: ${convIdOnDisconnect || 'N/A'}`);
    });

    // --- Xử lý lỗi socket ---
    socket.on('error', (err: Error) => {
        logToFile(`[Socket.IO ${socketId}] Socket Error: ${err.message}`);
    });
};