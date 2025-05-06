import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe'; // <<< Import container
import { Logger } from 'pino'; // <<< Import Logger type
import { LoggingService } from '../../services/logging.service'; // <<< Import LoggingService (Adjust path if needed)

interface HttpError extends Error {
    status?: number;
    statusCode?: number;
    isOperational?: boolean;
}

export const errorHandlerMiddleware = (
    err: HttpError,
    req: Request,
    res: Response,
    next: NextFunction // Keep next for Express signature
): void => {
    // <<< Resolve LoggingService
    const loggingService = container.resolve(LoggingService);
    // <<< Create a logger specific to this request/error context
    const logger: Logger = loggingService.getLogger({
        middleware: 'errorHandler',
        requestId: (req as any).id, // Assuming you have a request ID middleware (like express-pino-logger or custom)
        method: req.method,
        url: req.originalUrl,
    });

    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    // Treat non-operational errors and status >= 500 as server errors
    const isServerError = !err.isOperational || statusCode >= 500;

    // <<< Use the logger instance
    if (isServerError) {
        // Log the full error object for server errors, pino handles stack trace serialization
        logger.error({ err, statusCode }, `Unhandled error occurred: ${message}`);
    } else {
        // Log operational/client errors as warnings
        // No need to log stack trace for expected errors usually
        logger.warn({ err: { message: err.message }, statusCode }, `Handled operational error: ${message}`);
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
};

// --- Middleware cho route không tồn tại ---
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    // No specific logging needed here, as the error is passed to errorHandlerMiddleware
    // which will log it.
    const error: HttpError = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    error.isOperational = true; // Mark as expected
    next(error); // Pass to the main error handler
};