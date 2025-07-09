// src/middleware/requestLogger.middleware.ts
import { Request, Response, NextFunction } from 'express';


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

    // Attach a listener to the 'finish' event of the response object.
    // This event is emitted when the response has been sent completely.
    res.on('finish', () => {
        const { statusCode } = res; // Get the HTTP status code of the response.

       
        // Determine log level prefix based on status code for better log categorization.
        let logLevelPrefix = '[INFO]'; // Default for successful responses (2xx)

        if (statusCode >= 500) {
            logLevelPrefix = '[ERROR]'; // Server error (5xx)
        } else if (statusCode >= 400) {
            logLevelPrefix = '[WARNING]'; // Client error (4xx)
        }

        // Log the end of the request with status code and duration.
        
    });

    next(); // Pass control to the next middleware in the chain.
};