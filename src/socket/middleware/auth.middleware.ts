import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe'; // <<< Import container
import { Logger } from 'pino'; // <<< Import Logger type
import { LoggingService } from '../../services/logging.service'; // <<< Import LoggingService (Adjust path if needed)
import { ConfigService } from '../../config/config.service';

interface ExtendedError extends Error {
    data?: any;
}

export const socketAuthMiddleware = (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token as string | undefined;
    const socketId = socket.id;

    // <<< Resolve LoggingService
    const loggingService = container.resolve(LoggingService);
    const configService = container.resolve(ConfigService);

    // <<< Create a logger specific to this socket's auth attempt
    const logger: Logger = loggingService.getLogger({
        middleware: 'socketAuth',
        socketId,
    });

    // <<< Use logger instance
    logger.info({ hasToken: !!token }, 'Authentication attempt');

    if (!token) {
        logger.info('No token provided. Treating as anonymous.');
        // Mark as anonymous
        socket.data.userId = null;
        socket.data.user = null;
        socket.data.token = null;
        return next();
    }

    try {
        jwt.verify(token, configService.config.JWT_SECRET);

        logger.info('Token signature validated successfully.'); // <<< Use logger

        // Store original token for connection handler
        socket.data.token = token;
        socket.data.userId = null; // To be filled by connection handler
        socket.data.user = null;   // To be filled by connection handler

        next(); // Allow connection

    } catch (err: any) {
        // <<< Use logger for authentication failure (Warn level seems appropriate)
        logger.warn({ reason: err.message }, `Token validation failed.`);

        const error: ExtendedError = new Error(`Authentication error: Invalid or expired token.`);
        error.data = { code: 'AUTH_FAILED', message: err.message };
        next(error); // Reject connection
    }
};