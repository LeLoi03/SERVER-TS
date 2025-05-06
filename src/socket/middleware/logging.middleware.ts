import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe'; // <<< Import container
import { Logger } from 'pino'; // <<< Import Logger type
import { LoggingService } from '../../services/logging.service'; // <<< Import LoggingService (Adjust path if needed)
// import logToFile from '../../utils/logger'; // <<< REMOVE

export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Skip logging for specific paths
    if (req.url.startsWith('/socket.io/') || req.url === '/favicon.ico') {
        return next();
    }

    const start = Date.now();
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || 'N/A';

    // <<< Resolve LoggingService
    const loggingService = container.resolve(LoggingService);
    // <<< Create a logger specific to this request
    const logger: Logger = loggingService.getLogger({
        middleware: 'requestLogger',
        requestId: (req as any).id, // Assuming request ID middleware
        method,
        url: originalUrl,
        ip,
        userAgent,
    });

    // <<< Log start of request
    // Context (method, url, ip, userAgent) is already bound to the logger
    logger.info('Request received');

    // Log when response finishes
    res.on('finish', () => {
        const duration = Date.now() - start;
        const { statusCode } = res;
        const responseData = { statusCode, duration };

        // <<< Use appropriate log level based on status code
        if (statusCode >= 500) {
            logger.error(responseData, `Request finished - Server Error`);
        } else if (statusCode >= 400) {
            logger.warn(responseData, `Request finished - Client Error/Warn`);
        } else {
            logger.info(responseData, `Request finished successfully`);
        }
    });

    next();
};