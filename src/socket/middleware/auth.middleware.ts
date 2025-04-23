// src/socket/middleware/auth.middleware.ts
import { Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
// Bỏ import crypto nếu không dùng nữa
import { config } from '../../config/environment';
import logToFile from '../../utils/logger';

interface ExtendedError extends Error {
    data?: any;
}

export const socketAuthMiddleware = (socket: Socket, next: (err?: ExtendedError) => void) => {
    const token = socket.handshake.auth.token as string | undefined;
    const socketId = socket.id;
    logToFile(`[Socket Auth MW] Attempting auth for socket ${socketId}. Token provided: ${!!token}`);

    if (!token) {
        logToFile(`[Socket Auth MW] No token provided for socket ${socketId}. Treating as anonymous.`);
        // Đánh dấu là anonymous và không có token/user data
        socket.data.userId = null;
        socket.data.user = null; // Sẽ chứa { id, email, role } sau khi fetch
        socket.data.token = null;
        return next();
    }

    try {
        // Chỉ cần verify token, không cần decode ở đây nữa
        jwt.verify(token, config.jwtSecret);

        logToFile(`[Socket Auth MW] Token signature validated successfully for socket ${socketId}.`);

        // --- LƯU TOKEN GỐC ---
        // Không tạo hash nữa. Lưu token để handler connection sử dụng gọi API /me
        socket.data.token = token;
        // Khởi tạo các trường user data là null, sẽ được điền sau khi fetch /me
        socket.data.userId = null;
        socket.data.user = null;
        // --------------------

        next(); // Cho phép kết nối

    } catch (err: any) {
        logToFile(`[Socket Auth MW] Token validation failed for socket ${socketId}. Reason: ${err.message}`);
        const error: ExtendedError = new Error(`Authentication error: Invalid or expired token.`);
        error.data = { code: 'AUTH_FAILED', message: err.message };
        next(error); // Từ chối kết nối
    }
};