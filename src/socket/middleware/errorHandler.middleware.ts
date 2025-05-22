// src/middleware/errorHandler.middleware.ts
import { Request, Response, NextFunction } from 'express';
import logToFile from '../../utils/logger';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

/**
 * Extends the Error interface to include common HTTP-related properties.
 * This helps in standardizing error objects passed through middleware.
 */
interface HttpError extends Error {
    status?: number;
    statusCode?: number;
    /**
     * Indicates if the error is "operational" (expected, e.g., validation errors, 404s)
     * versus "programmer" errors (unexpected, e.g., bugs, uncaught exceptions).
     * Operational errors can be safely exposed to the client; programmer errors should not.
     */
    isOperational?: boolean;
}

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
 * Global error handling middleware for Express applications.
 * This middleware catches all errors passed via `next(err)` or thrown in routes/middleware.
 * It logs detailed error information and sends a standardized JSON error response to the client.
 *
 * @param {HttpError} err - The error object caught.
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function (kept for signature, not typically called here).
 */
export const errorHandlerMiddleware = (
    err: HttpError,
    req: Request,
    res: Response,
    next: NextFunction
): void => {
    const requestId = getRequestId(req);
    const logContext = `[errorHandler]${requestId ? `[Req:${requestId}]` : ''}[${req.method} ${req.originalUrl}]`;

    const statusCode = err.status || err.statusCode || 500;
    const message = err.message || 'Internal Server Error';
    // Differentiate between operational errors (expected, client-related) and server errors.
    const isServerError = !err.isOperational || statusCode >= 500;

    // Extract error details safely using the utility
    const { message: errMessageForLog, stack: errStackForLog } = getErrorMessageAndStack(err);

    if (isServerError) {
        // Log critical server errors with full stack trace.
        logToFile(`[ERROR] ${logContext} Unhandled server error. Status: ${statusCode}, Message: "${errMessageForLog}". Stack: ${errStackForLog}`);
    } else {
        // Log operational/client errors as warnings (stack trace often not needed here).
        logToFile(`[WARNING] ${logContext} Handled operational error. Status: ${statusCode}, Message: "${errMessageForLog}".`);
    }

    // Determine the message sent to the client.
    // In production, hide generic 500-level error details for security.
    const clientMessage = (statusCode === 500 && process.env.NODE_ENV === 'production')
        ? 'An unexpected error occurred on the server.'
        : message;

    // Send a JSON error response to the client.
    if (!res.headersSent) {
        res.status(statusCode).json({
            status: 'error',
            statusCode,
            message: clientMessage,
            // Optionally, include stack or full error in dev environment:
            // ...(process.env.NODE_ENV !== 'production' && { stack: errStackForLog, fullError: err })
        });
    } else {
        logToFile(`[WARNING] ${logContext} Headers already sent for error, cannot send JSON response. Error: "${errMessageForLog}".`);
    }

    // Do not call `next(err)` here, as this middleware is typically the final error handler
    // responsible for sending the response.
};

/**
 * Middleware for handling requests to non-existent routes (404 Not Found).
 * It creates an `HttpError` with status 404 and passes it to the `errorHandlerMiddleware`.
 *
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function.
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    const error: HttpError = new Error(`Not Found - ${req.originalUrl}`);
    error.status = 404;
    error.isOperational = true; // Mark as an expected operational error.
    next(error); // Pass the error to the main error handler.
};