// src/socket/handlers/handler.types.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { Language } from '../../chatbot/shared/types';
import { Logger } from 'pino';
/**
 * Defines the common dependencies that are passed to all Socket.IO sub-handlers.
 * This pattern helps centralize dependency management and ensures consistent access
 * to core services and utility functions across different handler modules.
 */
export interface HandlerDependencies {
    /** The global Socket.IO server instance, used for emitting events to all clients or rooms. */
    io: SocketIOServer;
    /** The specific Socket instance for the connected client, used for emitting events to this client only. */
    socket: Socket;
    /** Service for managing and persisting conversation history. */
    conversationHistoryService: ConversationHistoryService;
    /** The ID of the authenticated user associated with this socket. */
    userId: string;
    /** The unique ID of the current socket connection. */
    socketId: string;
    /** A utility function to emit a 'chat_error' event to the client and log the error. */
    sendChatError: (logContext: string, message: string, step: string, details?: Record<string, any>) => void;
    /** A utility function to emit a 'chat_warning' event to the client and log the warning. */
    sendChatWarning: (logContext: string, message: string, step: string, details?: Record<string, any>) => void;
    /** A utility function to fetch and emit the updated list of conversations for a user. */
    emitUpdatedConversationList: (logContext: string, userId: string, reason: string, language?: Language) => Promise<void>;
    /** A utility function to ensure the user is authenticated and return their ID, or handle authentication failure. */
    ensureAuthenticated: (logContext: string, eventName: string) => string | null;
    /** The default limit for fetching conversation history (e.g., number of messages). */
    DEFAULT_HISTORY_LIMIT: number;
    logger: Logger; // <<< THÊM MỚI

}