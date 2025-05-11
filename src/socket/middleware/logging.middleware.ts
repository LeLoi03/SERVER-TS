// src/middleware/requestLogger.middleware.ts
import { Request, Response, NextFunction } from 'express';
// import { container } from 'tsyringe'; // Xóa import container nếu không dùng service nào khác
// import { Logger } from 'pino'; // Xóa import Logger type
// import { LoggingService } from '../../services/logging.service'; // Xóa import LoggingService
import logToFile from '../../utils/logger';

// Cố gắng lấy request ID nếu có (từ middleware khác)
const getRequestId = (req: Request): string | undefined => {
    // Giả sử req.id được set bởi middleware request ID (ví dụ: uuid)
    return (req as any).id as string | undefined;
};


export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Skip logging for specific paths
    if (req.url.startsWith('/socket.io/') || req.url === '/favicon.ico') {
        return next();
    }

    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || 'N/A';
    const requestId = getRequestId(req);

    // --- No Need to Resolve Services or Create Pino Logger ---
    // const loggingService = container.resolve(LoggingService); // Xóa resolve
    // const logger: Logger = loggingService.getLogger({ ... }); // Xóa logger

    // Chuỗi context cho log bắt đầu request
    const startLogContext = `[requestLogger]${requestId ? `[Req:${requestId}]` : ''}[${method} ${originalUrl}]`;

    // <<< Log start of request using logToFile
    logToFile(`${startLogContext} Request received. IP: ${ip}, UserAgent: "${userAgent}"`);


    // Log when response finishes
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { statusCode } = res;

        // Chuỗi context cho log kết thúc request
        const finishLogContext = `[requestLogger]${requestId ? `[Req:${requestId}]` : ''}[${method} ${originalUrl}]`;

        // <<< Use logToFile with status code check for log level simulation
        let logLevelPrefix = '[INFO]'; // Default for success

        if (statusCode >= 500) {
            logLevelPrefix = '[ERROR]'; // Server Error
        } else if (statusCode >= 400) {
            logLevelPrefix = '[WARNING]'; // Client Error/Warn
        }

        logToFile(`${logLevelPrefix} ${finishLogContext} Request finished. Status: ${statusCode}, Duration: ${duration}ms`);
    });

    next();
};