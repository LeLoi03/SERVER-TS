// src/socket/handlers/connection.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe'; // Dependency Injection container

// Import necessary services and utilities
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { registerCoreHandlers } from './core.handlers'; // Function to register core Socket.IO event handlers
import { fetchUserInfo } from '../../utils/chatbot/auth'; // Utility to fetch user info based on token
import logToFile from '../../utils/logger'; // Import the custom logging utility

/**
 * Handles a new Socket.IO client connection.
 * This function is responsible for:
 * 1. Logging the new connection.
 * 2. Authenticating the client using a token from `socket.data` (set by middleware).
 * 3. Populating `socket.data.userId` and `socket.data.user` upon successful authentication.
 * 4. Registering core Socket.IO event handlers for the authenticated user.
 * 5. Emitting `connection_ready` and `server_ready` events to the client.
 * 6. Fetching and sending the initial conversation list to the client.
 * 7. Setting up `disconnect` and `error` listeners for the socket.
 *
 * @param {SocketIOServer} io - The global Socket.IO server instance.
 * @param {Socket} socket - The specific Socket instance for the connected client.
 */
export const handleConnection = async (
    io: SocketIOServer,
    socket: Socket
): Promise<void> => {
    const socketId = socket.id; // Unique ID for the current socket connection.

    // Resolve ConversationHistoryService for initial data fetch (e.g., conversation list).
    const conversationHistoryService = container.resolve(ConversationHistoryService);

    // Log the initial connection status.
    logToFile(`[SocketConnectionHandler][${socketId}] New client connection received. Initial socket.data.userId: ${socket.data.userId || 'N/A'}.`);

    // Attach a general listener for all incoming events (useful for debugging).
    socket.onAny((eventName, ...args) => {
        logToFile(`[SocketConnectionHandler][${socketId}][onAny] Event: ${eventName}, Args: ${JSON.stringify(args)}`);
    });

    // Retrieve the authentication token from `socket.data`.
    // This token is typically set by an earlier Socket.IO middleware (e.g., `socketAuthMiddleware`).
    const token = socket.data.token as string | undefined;
    logToFile(`[SocketConnectionHandler][${socketId}] Processing client authentication. Token present: ${!!token}.`);

    try {
        if (token) {
            logToFile(`[SocketConnectionHandler][${socketId}] Attempting to fetch user information using provided token...`);
            const userInfo = await fetchUserInfo(token); // Call external utility to validate token and get user info.

            if (userInfo && userInfo.id) {
                // Store user information on the socket.data for access in subsequent handlers.
                socket.data.user = userInfo;
                socket.data.userId = userInfo.id; // CRITICAL: Set userId here for authentication.
                logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] User info fetched successfully. Email: ${userInfo.email}, Role: ${userInfo.role}.`);

                // --- Register Core Event Handlers ---
                // It is crucial to register handlers *after* `socket.data.userId` is set,
                // as many handlers rely on this for authentication and context.
                logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] Registering core event handlers for authenticated user.`);
                registerCoreHandlers(io, socket);
                logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] Core event handlers registered successfully.`);

                // --- Emit Connection Ready Signals ---
                // Emit 'connection_ready' and 'server_ready' to inform the client that the session is authenticated and ready.
                // Clients might wait for these events before sending user-specific requests.
                logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] Authenticated user session ready. Emitting 'connection_ready'.`);
                socket.emit('connection_ready', { userId: userInfo.id, email: userInfo.email });

                logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] Emitting 'server_ready' to client.`);
                socket.emit('server_ready', { userId: userInfo.id });


                // --- Fetch and Emit Initial Conversation List ---
                // Send the user's conversation history immediately after successful connection.
                try {
                    logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] Fetching initial conversation list for user.`);
                    const conversationList = await conversationHistoryService.getConversationListForUser(userInfo.id);
                    socket.emit('conversation_list', conversationList);
                    logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] Sent initial conversation list. Count: ${conversationList.length}.`);
                } catch (listError: any) {
                    // Log but do not block the connection if initial conversation list fetch fails.
                    logToFile(`[SocketConnectionHandler][${socketId}][${userInfo.id}] WARNING: Failed to fetch initial conversation list. Error: ${listError.message}, Stack: ${listError.stack}`);
                    socket.emit('chat_error', { type: 'warning', message: 'Could not load initial conversation list.', step: 'initial_list_fail' });
                }

            } else {
                // If user info cannot be fetched or is invalid, disconnect the client.
                logToFile(`[SocketConnectionHandler][${socketId}] WARNING: Failed to fetch valid user info from API /me. Disconnecting client.`);
                socket.emit('auth_error', { message: 'Failed to verify user information. Please log in again.' });
                socket.disconnect(true);
                return;
            }

        } else {
            // --- Handle Case: No Authentication Token ---
            logToFile(`[SocketConnectionHandler][${socketId}] WARNING: No authentication token found on socket. Disconnecting client.`);
            socket.emit('auth_error', { message: 'Authentication token not found or invalid. Please ensure you are logged in.' });
            socket.disconnect(true);
            return;
            // If anonymous access is allowed, uncomment and modify the following lines:
            // logToFile(`[SocketConnectionHandler][${socketId}] Anonymous user connected.`);
            // socket.data.userId = `anonymous-${socket.id}`; // Assign a temporary ID for anonymous users
            // logToFile(`[SocketConnectionHandler][${socketId}][${socket.data.userId}] Registering core handlers for anonymous user.`);
            // registerCoreHandlers(io, socket);
            // logToFile(`[SocketConnectionHandler][${socketId}][${socket.data.userId}] Core event handlers registered for anonymous user.`);
            // socket.emit('connection_ready', { userId: socket.data.userId });
        }

        // --- Register Common Socket Event Listeners (for all users, authenticated or not) ---

        /**
         * Listener for the 'disconnect' event. Logs the disconnection reason.
         */
        socket.on('disconnect', (reason: string) => {
            const userIdOnDisconnect = socket.data.userId as string || 'N/A';
            const convIdOnDisconnect = socket.data.currentConversationId as string || 'N/A'; // Assuming you might store this
            logToFile(`[SocketConnectionHandler][${socketId}][${userIdOnDisconnect}] Client disconnected. Reason: "${reason}", Active ConvId: ${convIdOnDisconnect}.`);
        });

        /**
         * Listener for general 'error' events on the socket.
         */
        socket.on('error', (err: Error) => {
            const userIdOnError = socket.data.userId as string || 'N/A';
            logToFile(`[SocketConnectionHandler][${socketId}][${userIdOnError}] ERROR: Socket error occurred. Message: ${err.message}, Stack: ${err.stack}`);
        });

    } catch (error: any) {
        // --- Handle Critical Errors during Connection Setup ---
        // This catches unexpected errors that occur during the initial connection handling process
        // (e.g., issues with `fetchUserInfo` API calls, or other unforeseen errors).
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        logToFile(`[SocketConnectionHandler][${socketId}] FATAL ERROR: A critical error occurred during connection setup. Error: "${errorMessage}", Stack: ${errorStack}`);

        // Emit a general server error to the client and then force disconnect.
        socket.emit('server_error', { message: 'A critical server error occurred during connection setup. Please try again later.' });
        socket.disconnect(true);
    }
};