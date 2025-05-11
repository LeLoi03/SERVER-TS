// src/socket/middleware/socketAuth.middleware.ts
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { container } from 'tsyringe'; // Giữ nguyên container
// import { Logger } from 'pino'; // Xóa import Logger type
// import { LoggingService } from '../../services/logging.service'; // Xóa import LoggingService
import { ConfigService } from '../../config/config.service';

import logToFile from '../../utils/logger';

interface ExtendedError extends Error {
    data?: any;
}

export const socketAuthMiddleware = (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token as string | undefined;
    const socketId = socket.id;

    // --- Resolve Services ---
    // LoggingService không cần resolve nữa
    const configService = container.resolve(ConfigService);

    // --- No Need to Create Pino Logger ---

    const logContext = `[socketAuth][${socketId}]`; // Chuỗi context cho log

    // <<< Use logToFile
    logToFile(`${logContext} Authentication attempt. Has token: ${!!token}`);

    if (!token) {
        logToFile(`${logContext} No token provided. Treating as anonymous.`);
        // Mark as anonymous
        socket.data.userId = null;
        socket.data.user = null;
        socket.data.token = null;
        return next();
    }

    try {
        // Lấy secret từ ConfigService
        const jwtSecret = configService.config.JWT_SECRET;
        if (!jwtSecret) {
             // Đây là lỗi cấu hình nghiêm trọng, nên log thật rõ
             logToFile(`[FATAL ERROR] ${logContext} JWT_SECRET is not configured. Cannot authenticate.`);
             const error: ExtendedError = new Error(`Server configuration error: JWT secret is missing.`);
             error.data = { code: 'SERVER_CONFIG_ERROR', message: 'JWT_SECRET is not set.' };
             return next(error); // Reject connection do lỗi server
        }

        jwt.verify(token, jwtSecret);

        logToFile(`${logContext} Token signature validated successfully.`); // <<< Use logToFile

        // Store original token for connection handler
        socket.data.token = token;
        socket.data.userId = null; // To be filled by connection handler
        socket.data.user = null;   // To be filled by connection handler

        next(); // Allow connection

    } catch (err: any) {
        // <<< Use logToFile for authentication failure (Warn level seems appropriate)
        logToFile(`[WARNING] ${logContext} Token validation failed. Reason: ${err.message}`);

        const error: ExtendedError = new Error(`Authentication error: Invalid or expired token.`);
        error.data = { code: 'AUTH_FAILED', message: err.message };
        next(error); // Reject connection
    }
};