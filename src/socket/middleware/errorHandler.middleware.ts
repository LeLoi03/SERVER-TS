// src/middleware/errorHandler.middleware.ts
import { Request, Response, NextFunction } from 'express';
// import { container } from 'tsyringe'; // Xóa import container nếu không dùng service nào khác
// import { Logger } from 'pino'; // Xóa import Logger type
// import { LoggingService } from '../../services/logging.service'; // Xóa import LoggingService
import logToFile from '../../utils/logger';

interface HttpError extends Error {
    status?: number;
    statusCode?: number;
    isOperational?: boolean;
}

// Cố gắng lấy request ID nếu có (từ middleware khác)
const getRequestId = (req: Request): string | undefined => {
    // Giả sử req.id được set bởi middleware request ID (ví dụ: uuid)
    return (req as any).id as string | undefined;
};


export const errorHandlerMiddleware = (
    err: HttpError,
    req: Request,
    res: Response,
    next: NextFunction // Keep next for Express signature
): void => {
    // --- No Need to Resolve Services or Create Pino Logger ---
    // const loggingService = container.resolve(LoggingService); // Xóa resolve
    // const logger: Logger = loggingService.getLogger({ ... }); // Xóa logger

    const requestId = getRequestId(req);
    const logContext = `[errorHandler]${requestId ? `[Req:${requestId}]` : ''}[${req.method} ${req.originalUrl}]`;


    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    // Treat non-operational errors and status >= 500 as server errors
    const isServerError = !err.isOperational || statusCode >= 500;

    // <<< Use logToFile
    if (isServerError) {
        // Ghi log lỗi server, bao gồm stack trace
        logToFile(`[ERROR] ${logContext} Unhandled error occurred. Status: ${statusCode}, Message: "${message}", Error: ${err.message}, Stack: ${err.stack}`);
    } else {
        // Ghi log lỗi hoạt động/client dưới dạng cảnh báo (thường không cần stack trace)
        logToFile(`[WARNING] ${logContext} Handled operational error. Status: ${statusCode}, Message: "${message}"`);
    }

    // Determine client message (hide details in production for 500 errors)
    const clientMessage = (statusCode === 500 && process.env.NODE_ENV === 'production')
        ? 'An unexpected error occurred on the server.'
        : message;

    // Send JSON response
    res.status(statusCode).json({
        status: 'error',
        statusCode,
        message: clientMessage,
    });

    // Không gọi next(err) ở đây nữa vì chúng ta đã xử lý response.
    // Nếu bạn có middleware xử lý lỗi khác sau này, bạn có thể cân nhắc gọi next(err)
    // nhưng thường thì middleware xử lý lỗi cuối cùng sẽ gửi response.
};

// --- Middleware cho route không tồn tại ---
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    // Middleware này vẫn chỉ tạo lỗi và chuyển tiếp cho errorHandlerMiddleware
    // Logger sẽ được xử lý trong errorHandlerMiddleware
    const error: HttpError = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    error.isOperational = true; // Mark as expected operational error
    next(error); // Pass to the main error handler
};