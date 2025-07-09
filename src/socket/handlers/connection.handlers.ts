// src/socket/handlers/connection.handlers.ts
import { Socket, Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe'; // Dependency Injection container

// Import necessary services and utilities
import { ConversationHistoryService } from '../../chatbot/services/conversationHistory.service';
import { registerCoreHandlers } from './core.handlers'; // Function to register core Socket.IO event handlers
import { fetchUserInfo } from '../../chatbot/utils/auth'; // Utility to fetch user info based on token

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

    // Attach a general listener for all incoming events (useful for debugging).
    socket.onAny((eventName, ...args) => {

    });

    // Retrieve the authentication token from `socket.data`.
    // This token is typically set by an earlier Socket.IO middleware (e.g., `socketAuthMiddleware`).
    const token = socket.data.token as string | undefined;

    try {
        if (token) {

            const userInfo = await fetchUserInfo(token); // Call external utility to validate token and get user info.

            if (userInfo && userInfo.id) {
                // Store user information on the socket.data for access in subsequent handlers.
                socket.data.user = userInfo;
                socket.data.userId = userInfo.id; // CRITICAL: Set userId here for authentication.


                // --- Register Core Event Handlers ---
                // It is crucial to register handlers *after* `socket.data.userId` is set,
                // as many handlers rely on this for authentication and context.

                registerCoreHandlers(io, socket);


                // --- Emit Connection Ready Signals ---
                // Emit 'connection_ready' and 'server_ready' to inform the client that the session is authenticated and ready.
                // Clients might wait for these events before sending user-specific requests.

                socket.emit('connection_ready', { userId: userInfo.id, email: userInfo.email });


                socket.emit('server_ready', { userId: userInfo.id });


                // --- Fetch and Emit Initial Conversation List ---
                // Send the user's conversation history immediately after successful connection.
                try {

                    const conversationList = await conversationHistoryService.getConversationListForUser(userInfo.id);
                    socket.emit('conversation_list', conversationList);

                } catch (listError: any) {
                    // Log but do not block the connection if initial conversation list fetch fails.

                    socket.emit('chat_error', { type: 'warning', message: 'Could not load initial conversation list.', step: 'initial_list_fail' });
                }

            } else {
                // If user info cannot be fetched or is invalid, disconnect the client.

                socket.emit('auth_error', { message: 'Failed to verify user information. Please log in again.' });
                socket.disconnect(true);
                return;
            }

        } else {
            // --- Handle Case: No Authentication Token ---

            socket.emit('auth_error', { message: 'Authentication token not found or invalid. Please ensure you are logged in.' });
            socket.disconnect(true);
            return;

        }

        // --- Register Common Socket Event Listeners (for all users, authenticated or not) ---

        /**
         * Listener for the 'disconnect' event. Logs the disconnection reason.
         */
        socket.on('disconnect', (reason: string) => {
            // const userIdOnDisconnect = socket.data.userId as string || 'N/A';
            // const convIdOnDisconnect = socket.data.currentConversationId as string || 'N/A'; // Assuming you might store this

        });

        /**
         * Listener for general 'error' events on the socket.
         */
        socket.on('error', (err: Error) => {
            // const userIdOnError = socket.data.userId as string || 'N/A';

        });

    } catch (error: any) {
        // --- Handle Critical Errors during Connection Setup ---
        // This catches unexpected errors that occur during the initial connection handling process
        // (e.g., issues with `fetchUserInfo` API calls, or other unforeseen errors).
        // const errorMessage = error instanceof Error ? error.message : String(error);
        // const errorStack = error instanceof Error ? error.stack : undefined;


        // Emit a general server error to the client and then force disconnect.
        socket.emit('server_error', { message: 'A critical server error occurred during connection setup. Please try again later.' });
        socket.disconnect(true);
    }
};