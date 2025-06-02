// server.ts
import 'reflect-metadata'; // IMPORTANT: Must be the first import to enable decorator metadata reflection
import './container'; // Initialize the IoC container
import { container } from 'tsyringe';
import { initLoaders } from './loaders'; // Contains database, express, socket.io, and job initializers
import { LoggingService } from './services/logging.service';
import { Logger } from 'pino'; // Explicitly import Logger type
import { ConfigService } from './config/config.service';
import http from 'http'; // Node.js built-in HTTP module
import mongoose from 'mongoose'; // MongoDB ORM

/**
 * Global variable to store the main application logger instance.
 * Initialized after `LoggingService` is resolved.
 */
let logger: Logger;

/**
 * Global variable to store the `LoggingService` instance.
 * Provides access to logging functionalities and flush operations.
 */
let loggingService: LoggingService;

/**
 * Global variable to store the `ConfigService` instance.
 * Provides access to all application configurations.
 */
let configService: ConfigService;

/**
 * Global variable to store the HTTP server instance.
 * Allows graceful shutdown of the server.
 */
let httpServer: http.Server;

/**
 * Global flag to prevent multiple shutdown sequences from being initiated.
 * Ensures the graceful shutdown logic runs only once.
 */
let isShuttingDown = false;

/**
 * The main asynchronous function to start the application server.
 * It orchestrates the initialization of core services, loaders, and server listening.
 */
async function startServer(): Promise<void> {
    try {
        // --- 1. Initialize Core Services (Config and Logging must be first) ---
        // Resolve ConfigService first as other services might depend on its configurations.
        configService = container.resolve(ConfigService);
        // Resolve LoggingService to set up the application's logging infrastructure.
        // loggingService = container.resolve(LoggingService);
        // Get the pino Logger instance from the LoggingService.
        // logger = loggingService.logger;

        // logger.info('[Server Start] Core services (Config, Logging) resolved successfully.');

        // --- 2. Initialize API Examples from ConfigService ---
        // This step is crucial for LLM-dependent features that use few-shot examples.
        // logger.info('[Server Start] Initiating API examples loading...');
        try {
            await configService.initializeExamples(); // Call the async function to load examples
            // logger.info('[Server Start] API examples initialized successfully.');
        } catch (exampleError: any) {
            // If example loading fails, decide whether to halt or continue with a warning.
            // Current decision: Log error and re-throw to halt if examples are considered critical.
            const errorMessage = exampleError instanceof Error ? exampleError.message : String(exampleError);
            const errorStack = exampleError instanceof Error ? exampleError.stack : undefined;
            // logger.error(`[Server Start] FAILED to initialize API examples: ${errorMessage}`, { stack: errorStack });
            throw new Error(`Critical: Failed to load necessary API examples. Server cannot proceed.`);
            // Alternative: If examples are optional, use logger.warn and continue:
            // logger.warn(`[Server Start] Continuing without all API examples due to loading error: ${errorMessage}`);
        }

        // --- 3. Initialize Loaders (Database, Express App, Socket.IO, Cron Jobs, etc.) ---
        // Loaders can now safely access `configService` and `loggingService` (which holds `logger`).
        // logger.info('[Server Start] Initializing application loaders...');
        const loaderResult = await initLoaders();
        // The HTTP server instance is returned by `initLoaders`.
        httpServer = loaderResult.httpServer;
        // logger.info('[Server Start] All loaders initialized successfully.');

        // --- 4. Start the HTTP Server ---
        const port = configService.config.PORT;
        httpServer.listen(port, () => {
            const serverUrl = `http://localhost:${port}`; // Or `https://your-domain.com:${port}` in production
            // logger.info(`🚀 Server (HTTP & Socket.IO) is now listening on port ${port}`);
            // logger.info(`🔗 Application accessible at: ${serverUrl}`);
            const allowedOrigins = configService.config.CORS_ALLOWED_ORIGINS.join(', ');
            // logger.info(`🌐 Configured CORS allowed origins: ${allowedOrigins}`);
            // A basic console log for quick visibility during development
            console.log(`🚀 Server ready at ${serverUrl}`);
        });

    } catch (error: any) {
        // This catch block handles errors during the initial server startup sequence.
        // It's important to use the logger if available, otherwise fall back to `console`.
        // const currentLogger = logger || console;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        // currentLogger.fatal(`[Server Start] FATAL ERROR during application initialization: ${errorMessage}`, { stack: errorStack });

        // Attempt a graceful shutdown if not already in the process of shutting down.
        if (!isShuttingDown) {
            await gracefulShutdown('Initialization Error', error);
        } else {
            // If already shutting down and another error occurs, force exit to prevent hang.
            process.exit(1);
        }
    }
}

/**
 * Initiates a graceful shutdown of the application.
 * This function attempts to close all open resources (HTTP server, database connections, etc.)
 * in a controlled manner to prevent data loss or resource leaks.
 * @param {string} signal - The signal that triggered the shutdown (e.g., 'SIGINT', 'SIGTERM').
 * @param {Error | unknown} [error] - Optional error object if shutdown is triggered by an error.
 */
async function gracefulShutdown(signal: string, error?: Error | unknown): Promise<void> {
    // Construct a reason string for logging.
    const reason = error ? `error (${error instanceof Error ? error.message : String(error)})` : `signal (${signal})`;

    // Prevent multiple shutdown sequences from running simultaneously.
    if (isShuttingDown) {
        // logger?.warn(`[Shutdown] Already in shutdown process (triggered by ${reason}). Ignoring subsequent trigger (${signal}).`);
        return;
    }
    isShuttingDown = true; // Set the global shutdown flag.

    // Determine the exit code: 1 for error, 0 for clean shutdown.
    let exitCode = error ? 1 : 0;

    // Use the main logger if available, otherwise fall back to console for critical early errors.
    // const currentLogger = logger || console;
    // currentLogger.info(`[Shutdown] Received ${reason}. Initiating graceful shutdown...`);

    // Set a timeout for the graceful shutdown process. If exceeded, force exit.
    const shutdownTimeoutMs = 15000; // You might want to get this from `configService.config.SHUTDOWN_TIMEOUT_MS`
    const shutdownTimeout = setTimeout(() => {
        // currentLogger.error(`[Shutdown] Graceful shutdown timeout of ${shutdownTimeoutMs}ms exceeded. Forcing application exit.`);
        // Attempt a final log flush if `loggingService` is available.
        // loggingService?.flushLogsAndClose();
        process.exit(1); // Force exit with error code 1.
    }, shutdownTimeoutMs);

    try {
        // --- Cleanup Step 1: Close HTTP Server ---
        if (httpServer && httpServer.listening) {
            // currentLogger.info('[Shutdown] Attempting to close HTTP server...');
            await new Promise<void>((resolve) => {
                httpServer.close((err) => {
                    if (err) {
                        // currentLogger.error('[Shutdown] Error while closing HTTP server:', err);
                        // Do not reject here; allow other cleanup steps to proceed even if HTTP server closing fails.
                    } else {
                        // currentLogger.info('[Shutdown] HTTP server closed successfully.');
                    }
                    resolve(); // Always resolve the promise.
                });
            });
        } else {
            // currentLogger.info('[Shutdown] HTTP server not listening or not initialized. Skipping HTTP server close.');
        }

        // --- Cleanup Step 2: Close Database Connection (MongoDB) ---
        try {
            // Check if Mongoose connection is active (readyState === 1 means connected).
            if (mongoose.connection && mongoose.connection.readyState === 1) {
                // currentLogger.info('[Shutdown] Attempting to close MongoDB connection...');
                await mongoose.connection.close();
                // currentLogger.info('[Shutdown] MongoDB connection closed successfully.');
            } else {
                // currentLogger.info('[Shutdown] MongoDB connection not active or not initialized. Skipping MongoDB close.');
            }
        } catch (dbErr: any) {
            // currentLogger.error('[Shutdown] Error during MongoDB connection close:', dbErr);
            exitCode = 1; // Mark exit as failure if DB close fails.
        }

        // --- Cleanup Step 3: Add any other application-specific cleanup tasks here ---
        // Examples: Close Redis connections, stop job queues, release file handles.
        // currentLogger.info('[Shutdown] Executing additional cleanup tasks...');
        // await someOtherCleanupFunction(); // Placeholder for other cleanup
        // currentLogger.info('[Shutdown] Additional cleanup tasks completed.');

    } catch (cleanupError: any) {
        // Catch any errors that occur during the cleanup phase.
        // currentLogger.error('[Shutdown] An unexpected error occurred during cleanup tasks:', cleanupError);
        exitCode = 1; // Mark exit as failure.
    } finally {
        // --- Final Cleanup Step: Flush Logs and Exit Process ---
        // currentLogger.info('[Shutdown] Performing final log flush...');
        // if (loggingService) {
        //     // Assuming `flushLogsAndClose` is asynchronous and handles graceful closing of log transports.
        //     await loggingService.flushLogsAndClose();
        //     // currentLogger.info('[Shutdown] Logs flushed and transports closed.');
        // } else {
        //     // Fallback for extremely early errors where loggingService might not be available.
        //     console.error("[Shutdown] Logging service not available for final flush. Logs might be incomplete.");
        // }

        // Clear the shutdown timeout as graceful shutdown is completing.
        clearTimeout(shutdownTimeout);
        // currentLogger.info(`[Shutdown] Graceful shutdown process finalized. Exiting application with code ${exitCode}.`);

        // A small delay to ensure all async log writes complete before process exits.
        await new Promise(resolve => setTimeout(resolve, 100));

        // Exit the Node.js process.
        process.exit(exitCode);
    }
}

// --- Register Process Event Listeners for Graceful Shutdown ---
/**
 * Array of POSIX signals that trigger a graceful shutdown.
 */
const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

shutdownSignals.forEach((signal) => {
    process.on(signal, () => {
        // Log the received signal for debugging purposes.
        // logger?.info(`[Process Event] Received signal: ${signal}`);
        gracefulShutdown(signal);
    });
});

/**
 * Handles uncaught exceptions, which are errors that occur synchronously
 * and are not caught by any `try...catch` block.
 * Logs the error and attempts a graceful shutdown.
 */
process.on('uncaughtException', (err: Error, origin: string) => {
    // const currentLogger = logger || console; // Use logger if available
    // currentLogger.fatal({ err: { message: err.message, stack: err.stack, name: err.name }, origin }, 'Uncaught Exception detected. Initiating emergency shutdown.');
    // Only trigger shutdown if not already in the process of shutting down.
    if (!isShuttingDown) {
        gracefulShutdown('uncaughtException', err);
    } else {
        // currentLogger.warn('[Shutdown] Uncaught exception occurred during an ongoing shutdown. Forcing immediate exit.');
        process.exit(1); // Force exit to prevent a hung process.
    }
});

/**
 * Handles unhandled promise rejections, which occur when a Promise is rejected
 * but there is no `.catch()` handler to deal with the rejection.
 * Logs the rejection reason and attempts a graceful shutdown.
 */
process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
    // const currentLogger = logger || console; // Use logger if available
    // Attempt to convert reason to an Error object for consistent logging.
    const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Unknown unhandled rejection reason'));
    // currentLogger.fatal({ err: { message: error.message, stack: error.stack, name: error.name }, reason }, 'Unhandled Promise Rejection detected. Initiating emergency shutdown.');
    // Only trigger shutdown if not already in the process of shutting down.
    if (!isShuttingDown) {
        gracefulShutdown('unhandledRejection', error);
    } else {
        // currentLogger.warn('[Shutdown] Unhandled rejection occurred during an ongoing shutdown. Forcing immediate exit.');
        process.exit(1); // Force exit to prevent a hung process.
    }
});

// --- Start the Application ---
// Call the main server startup function to begin the application lifecycle.
startServer();