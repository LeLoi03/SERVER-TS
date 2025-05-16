// src/socket/handlers/handler.types.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { Language } from '../../chatbot/shared/types';
import type logToFileType from '../../utils/logger'; // Import type của logToFile

export interface HandlerDependencies {
    io: SocketIOServer;
    socket: Socket;
    conversationHistoryService: ConversationHistoryService;
    logToFile: typeof logToFileType;
    userId: string;
    socketId: string;
    sendChatError: (logContext: string, message: string, step: string, details?: Record<string, any>) => void;
    sendChatWarning: (logContext: string, message: string, step: string, details?: Record<string, any>) => void;
    emitUpdatedConversationList: (logContext: string, userId: string, reason: string, language?: Language) => Promise<void>;
    ensureAuthenticated: (logContext: string, eventName: string) => string | null;
    DEFAULT_HISTORY_LIMIT: number;
}