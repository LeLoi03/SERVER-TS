// src/socket/middleware/socketAuth.middleware.ts
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe';
import { ConfigService } from '../../config/config.service';

import logToFile from '../../utils/logger';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

/**
 * Defines a custom error interface extending the built-in Error,
 * to include additional data relevant for Socket.IO error handling.
 */
interface ExtendedError extends Error {
    data?: {
        code: string;
        message: string;
    };
}

/**
 * Socket.IO authentication middleware.
 * This middleware authenticates incoming socket connections using a JWT token
 * provided in `socket.handshake.auth.token`. It verifies the token's signature
 * against the configured JWT secret.
 *
 * If authentication succeeds, it stores the token on `socket.data` and allows the connection.
 * If authentication fails or no token is provided, it handles accordingly
 * (either allows anonymous or disconnects with an error).
 *
 * @param {Socket} socket - The Socket.IO socket instance for the connecting client.
 * @param {(err?: ExtendedError) => void} next - The callback to proceed with the connection or reject it with an error.
 */
export const socketAuthMiddleware = (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token as string | undefined;
    const socketId = socket.id;

    // Resolve ConfigService to access JWT_SECRET.
    const configService = container.resolve(ConfigService);

    const logContext = `[socketAuth][${socketId}]`;

    logToFile(`${logContext} Attempting authentication. Token provided: ${!!token}.`);

    if (!token) {
        logToFile(`${logContext} No authentication token provided. Allowing as anonymous connection.`);
        // Mark as anonymous, future handlers can check `socket.data.userId`
        // or handle anonymous logic.
        socket.data.userId = null;
        socket.data.user = null;
        socket.data.token = null;
        return next(); // Allow connection to proceed, but marked as unauthenticated
    }

    try {
        const jwtSecret = configService.jwtSecret;
        if (!jwtSecret) {
            // This is a critical server configuration error.
            logToFile(`[FATAL ERROR] ${logContext} JWT_SECRET is not configured in environment variables. Cannot authenticate.`);
            const error: ExtendedError = new Error(`Server configuration error: JWT secret is missing.`);
            error.data = { code: 'SERVER_CONFIG_ERROR', message: 'JWT_SECRET is not set.' };
            return next(error); // Reject connection due to critical server misconfiguration.
        }

        // Verify the JWT token using the configured secret.
        // This will throw an error if the token is invalid or expired.
        jwt.verify(token, jwtSecret);

        logToFile(`${logContext} Token signature validated successfully. Storing token on socket data.`);

        // Store the original token on `socket.data` for later use (e.g., by `fetchUserInfo`).
        socket.data.token = token;
        // userId and user objects will be populated by the `handleConnection` handler
        // after fetching user info from an external authentication service.
        socket.data.userId = null;
        socket.data.user = null;

        next(); // Allow connection to proceed.

    } catch (err: unknown) { // Catch unknown errors from `jwt.verify`
        const { message: errorMessage } = getErrorMessageAndStack(err); // Extract message safely
        logToFile(`[WARNING] ${logContext} Token validation failed. Reason: "${errorMessage}".`);

        const error: ExtendedError = new Error(`Authentication error: Invalid or expired token.`);
        error.data = { code: 'AUTH_FAILED', message: errorMessage };
        next(error); // Reject connection with a specific authentication error.
    }
};