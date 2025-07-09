// src/socket/middleware/socketAuth.middleware.ts
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe';
import { ConfigService } from '../../config/config.service';
import { getErrorMessageAndStack } from '../../utils/errorUtils';
interface ExtendedError extends Error {
    data?: {
        code: string;
        message: string;
    };
}

export const socketAuthMiddleware = (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token as string | undefined;
    // Resolve ConfigService to access JWT_SECRET.
    const configService = container.resolve(ConfigService);
    if (!token) {
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

            const error: ExtendedError = new Error(`Server configuration error: JWT secret is missing.`);
            error.data = { code: 'SERVER_CONFIG_ERROR', message: 'JWT_SECRET is not set.' };
            return next(error); // Reject connection due to critical server misconfiguration.
        }

        // Verify the JWT token using the configured secret.
        // This will throw an error if the token is invalid or expired.
        jwt.verify(token, jwtSecret);


        // Store the original token on `socket.data` for later use (e.g., by `fetchUserInfo`).
        socket.data.token = token;
        // userId and user objects will be populated by the `handleConnection` handler
        // after fetching user info from an external authentication service.
        socket.data.userId = null;
        socket.data.user = null;

        next(); // Allow connection to proceed.

    } catch (err: unknown) { // Catch unknown errors from `jwt.verify`
        const { message: errorMessage } = getErrorMessageAndStack(err); // Extract message safely

        const error: ExtendedError = new Error(`Authentication error: Invalid or expired token.`);
        error.data = { code: 'AUTH_FAILED', message: errorMessage };
        next(error); // Reject connection with a specific authentication error.
    }
};