// src/middleware/requestLogger.middleware.ts
import { Request, Response, NextFunction } from 'express';
import logToFile from '../../utils/logger';

/**
 * Attempts to retrieve a request ID from the Express request object.
 * Assumes a prior middleware (e.g., `uuid-middleware`) has set `req.id`.
 * @param {Request} req - The Express request object.
 * @returns {string | undefined} The request ID if found, otherwise undefined.
 */
const getRequestId = (req: Request): string | undefined => {
    return (req as any).id as string | undefined;
};

/**
 * Middleware for logging incoming HTTP requests and their responses.
 * It logs request details at the start and response status/duration at the end.
 * It skips logging for specific internal paths (e.g., Socket.IO handshake, favicon).
 *
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function.
 */
export const requestLoggerMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // Skip logging for specific paths (e.g., Socket.IO internal handshakes, browser favicon requests).
    if (req.url.startsWith('/socket.io/') || req.url === '/favicon.ico') {
        return next();
    }

    const start = Date.now(); // Record start time for duration calculation.
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || 'N/A';
    const requestId = getRequestId(req);

    // Context string for logging, including request ID if available.
    const startLogContext = `[requestLogger]${requestId ? `[Req:${requestId}]` : ''}[${method} ${originalUrl}]`;

    // Log the start of the request.
    logToFile(`[INFO] ${startLogContext} Request received. IP: ${ip}, UserAgent: "${userAgent}".`);

    // Attach a listener to the 'finish' event of the response object.
    // This event is emitted when the response has been sent completely.
    res.on('finish', () => {
        const duration = Date.now() - start; // Calculate request duration.
        const { statusCode } = res; // Get the HTTP status code of the response.

        // Context string for logging the end of the request.
        const finishLogContext = `[requestLogger]${requestId ? `[Req:${requestId}]` : ''}[${method} ${originalUrl}]`;

        // Determine log level prefix based on status code for better log categorization.
        let logLevelPrefix = '[INFO]'; // Default for successful responses (2xx)

        if (statusCode >= 500) {
            logLevelPrefix = '[ERROR]'; // Server error (5xx)
        } else if (statusCode >= 400) {
            logLevelPrefix = '[WARNING]'; // Client error (4xx)
        }

        // Log the end of the request with status code and duration.
        logToFile(`${logLevelPrefix} ${finishLogContext} Request finished. Status: ${statusCode}, Duration: ${duration}ms.`);
    });

    next(); // Pass control to the next middleware in the chain.
};