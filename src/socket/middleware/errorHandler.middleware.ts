import { Request, Response, NextFunction } from 'express';
import logToFile from '../../utils/logger';

interface HttpError extends Error {
    status?: number;
    statusCode?: number; // Một số thư viện dùng statusCode
    isOperational?: boolean; // Đánh dấu lỗi dự kiến (vd: validation error)
}

export const errorHandlerMiddleware = (
    err: HttpError,
    req: Request,
    res: Response,
    next: NextFunction // Mặc dù không dùng next() ở đây, nó cần thiết cho Express nhận diện đây là error handler
): void => {
    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    const isOperational = err.isOperational === true; // Lỗi có phải do client hay logic nghiệp vụ dự kiến không?

    const logFileMethod = isOperational || statusCode < 500 ? '[WARN]' : '[ERROR]';

    
    logToFile(`[Error Handler] ${logFileMethod} ${statusCode} ${req.method} ${req.originalUrl} - ${err.message}${err.stack ? `\nStack: ${err.stack}` : ''}`);

    // Chỉ gửi thông tin lỗi cơ bản về client, đặc biệt với lỗi 500
    // Không nên gửi stack trace về client trong môi trường production
    const clientMessage = (statusCode === 500 && process.env.NODE_ENV === 'production')
        ? 'An unexpected error occurred on the server.'
        : message;

    // Trả về JSON response
    res.status(statusCode).json({
        status: 'error',
        statusCode,
        message: clientMessage,
        // Có thể thêm các trường khác như 'code' nếu cần
    });
};

// --- Middleware cho route không tồn tại (đặt SAU các routes khác, TRƯỚC errorHandlerMiddleware) ---
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    const error: HttpError = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    error.isOperational = true; // Đánh dấu là lỗi dự kiến
    next(error); // Chuyển đến errorHandlerMiddleware
};