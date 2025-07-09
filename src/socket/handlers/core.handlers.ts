// src/socket/handlers/core.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe'; // Dependency Injection container
import { ConversationHistoryService, ConversationMetadata } from '../../chatbot/services/conversationHistory.service';

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
 * This function sets up common utility functions (like error/warning emitters, authentication check)
 * and then delegates to specialized sub-handler registration functions.
 *
 * @param {SocketIOServer} io - The global Socket.IO server instance.
 * @param {Socket} socket - The specific Socket instance for the connected client.
 */
export const registerCoreHandlers = (
    io: SocketIOServer,
    socket: Socket
): void => {
    const socketId = socket.id;

    // A getter to dynamically retrieve the userId from socket.data.
    // This ensures that even if `socket.data.userId` is set asynchronously after connection,
    // subsequent calls to `getUserId()` within these handlers will get the updated value.
    const getUserId = (): string => socket.data.userId || 'Anonymous';
    let userIdForInitialLog = getUserId(); // Get initial value for early logging

    let conversationHistoryService: ConversationHistoryService;
    try {
        // Resolve ConversationHistoryService from the DI container.
        conversationHistoryService = container.resolve(ConversationHistoryService);
    } catch (error: any) {
        // Log a critical error if the service cannot be resolved, indicating a DI setup issue.
        
        // Emit a critical error to the client and then disconnect.
        socket.emit('critical_error', { message: "Server configuration error. Please try reconnecting later." });
        socket.disconnect(true); // Force disconnect
        return; // Prevent further execution if critical service is unavailable.
    }

    

    // --- Common Utility Functions (to be passed to sub-handlers) ---

    /**
     * Emits a 'chat_error' event to the client and logs the error to file.
     * @param {string} logContext - Context string for the log message (e.g., from which handler).
     * @param {string} message - User-friendly error message.
     * @param {string} step - The specific step or stage where the error occurred.
     * @param {Record<string, any>} [details] - Optional additional details to include in logs.
     */
    const sendChatError = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        // const fullLogContext = `${logContext}[ChatError][${getUserId()}]`;
        // const logMessage = `[ERROR] ${fullLogContext} Step: ${step}, Msg: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        
        socket.emit('chat_error', { type: 'error', message, step } as ErrorUpdate);
    };

    /**
     * Emits a 'chat_warning' event to the client and logs the warning to file.
     * @param {string} logContext - Context string for the log message.
     * @param {string} message - User-friendly warning message.
     * @param {string} step - The specific step or stage where the warning occurred.
     * @param {Record<string, any>} [details] - Optional additional details to include in logs.
     */
    const sendChatWarning = (logContext: string, message: string, step: string, details?: Record<string, any>): void => {
        // const fullLogContext = `${logContext}[ChatWarning][${getUserId()}]`;
        // const logMessage = `[WARNING] ${fullLogContext} Step: ${step}, Msg: "${message}"${details ? `, Details: ${JSON.stringify(details)}` : ''}`;
        
        socket.emit('chat_warning', { type: 'warning', message, step } as WarningUpdate);
    };

    /**
     * Fetches the latest conversation list for a given user and emits it to the client.
     * @param {string} logContext - Context string for the log message.
     * @param {string} userIdToList - The ID of the user whose conversation list needs to be fetched.
     * @param {string} reason - The reason for emitting the updated list (for logging).
     * @param {Language} [language] - Optional language preference for conversation list.
     * @returns {Promise<void>} A promise that resolves after emitting or logging failure.
     */
    const emitUpdatedConversationList = async (
        logContext: string,
        userIdToList: string,
        reason: string,
        language?: Language
    ): Promise<void> => {
        // const langForLog = language || 'N/A';
        // const fullLogContext = `${logContext}[EmitConversationList][${userIdToList}]`;
        
        try {
            const updatedList: ConversationMetadata[] = await conversationHistoryService.getConversationListForUser(userIdToList, undefined, language);
            socket.emit('conversation_list', updatedList as ClientConversationMetadata[]);
            
        } catch (error: any) {
            
        }
    };

    /**
     * Utility function to ensure that the current socket has an authenticated user ID.
     * If not, it emits a 'chat_error' and returns null.
     * @param {string} logContext - Context string for the log message.
     * @param {string} eventName - The name of the event requiring authentication.
     * @returns {string | null} The user ID if authenticated, otherwise null.
     */
    const ensureAuthenticated = (logContext: string, eventName: string): string | null => {
        const currentUserId = socket.data.userId as string | undefined;
        if (!currentUserId) {
            sendChatError(logContext, `Authentication required to process event '${eventName}'. Please log in.`, 'auth_required', { event: eventName });
            return null;
        }
        return currentUserId;
    };

    // --- Prepare Dependencies Object for Sub-Handlers ---
    // The `userId` property is defined as a getter to ensure it always retrieves
    // the most current `socket.data.userId` value, especially after authentication.
    const dependencies: HandlerDependencies = {
        io,
        socket,
        conversationHistoryService,
        get userId() { return socket.data.userId || 'Anonymous'; }, // Getter for dynamic userId
        socketId,
        sendChatError,
        sendChatWarning,
        emitUpdatedConversationList,
        ensureAuthenticated,
        DEFAULT_HISTORY_LIMIT,
    };

    // --- Register Sub-Handlers ---
    // Delegate to specialized functions to register event handlers for different categories.
    
    registerConversationHandlers(dependencies);
    registerMessageHandlers(dependencies);
    registerConfirmationHandlers(dependencies);

    
};