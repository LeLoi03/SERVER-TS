// src/services/logging.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import pino, { Logger, LoggerOptions, LevelWithSilent, DestinationStream, stdTimeFunctions, Level } from 'pino';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { Writable } from 'stream';
import { getErrorMessageAndStack } from '../utils/errorUtils'; // Import the error utility

/**
 * Custom interface for Pino's file destination stream, extending Writable
 * to include the synchronous flush method.
 */
export interface PinoFileDestination extends Writable {
    flushSync(): void;
}

/**
 * Service responsible for configuring and providing a centralized logging mechanism using Pino.
 * It handles log levels, console/file output, and ensures log directory existence.
 * This service is initialized early in the application lifecycle.
 */
@singleton()
export class LoggingService {
    public readonly logger: Logger; // The main Pino logger instance
    private fileDestination: PinoFileDestination | null = null; // Reference to the file stream destination
    private readonly logLevel: LevelWithSilent; // Configured log level
    private readonly logFilePath: string; // Path to the log file
    private isShuttingDown = false; // Flag to prevent multiple flush calls during shutdown

    /**
     * Constructs an instance of LoggingService.
     * Initializes the Pino logger based on application configuration.
     * Handles creation of log directories and critical errors during setup.
     * @param {ConfigService} configService - The injected configuration service.
     */
    constructor(@inject(ConfigService) private configService: ConfigService) {
        console.log('[LoggingService:Constructor] Initializing logger...');

        this.logLevel = this.configService.config.LOG_LEVEL;
        this.logFilePath = this.configService.appLogFilePath;
        const logDir = path.dirname(this.logFilePath);

        // --- Phase 1: Ensure Log Directory Exists and is Writable ---
        try {
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                console.log(`[LoggingService:Constructor] Log directory created: ${logDir}`);
            }
            fs.accessSync(logDir, fs.constants.W_OK); // Check if directory is writable
            console.log(`[LoggingService:Constructor] Log directory is writable: ${logDir}`);
        } catch (err: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:Constructor] CRITICAL: Error ensuring log directory "${logDir}" exists or is writable: "${errorMessage}". Stack: ${errorStack}`);
            // Exit the process as logging is a critical component
            process.exit(1);
        }

        // --- Phase 2: Configure Pino Streams ---
        const pinoOptions: LoggerOptions = {
            level: this.logLevel, // Set the global log level for the logger
            timestamp: stdTimeFunctions.isoTime, // Use ISO 8601 format for timestamps
            formatters: { level: (label) => ({ level: label }) }, // Format level as an object { level: 'info' }
            base: undefined, // Remove default `pid` and `hostname` from base properties
            // The `mixin` option could be used here to inject common properties if needed globally
            // mixin: () => ({ someGlobalContext: 'value' }),
        };

        const pinoStreams: pino.StreamEntry[] = [];

        // --- Console Transport Configuration ---
        if (this.configService.config.LOG_TO_CONSOLE) {
            // Use pino-pretty for development environments for readable output
            if (this.configService.config.NODE_ENV !== 'production') {
                pinoStreams.push({
                    level: this.logLevel as Level,
                    stream: require('pino-pretty')({
                        colorize: true, // Enable colorful output
                        levelFirst: true, // Show log level first
                        translateTime: 'SYS:standard', // Translate timestamp to human-readable format
                        ignore: 'pid,hostname', // Ignore default Pino properties for cleaner output
                    }),
                });
                console.log(`[LoggingService:Constructor] Console logging enabled with pino-pretty. Level: ${this.logLevel}`);
            } else {
                // In production, use standard process.stdout for JSON output
                pinoStreams.push({
                    level: this.logLevel as Level,
                    stream: process.stdout,
                });
                console.log(`[LoggingService:Constructor] Console logging enabled (production mode). Level: ${this.logLevel}`);
            }
        } else {
            console.log('[LoggingService:Constructor] Console logging is DISABLED by configuration.');
        }

        // --- File Transport Configuration ---
        try {
            // Create a Pino destination stream for file logging
            this.fileDestination = pino.destination({
                dest: this.logFilePath,
                sync: false, // Asynchronous logging for better performance
                minLength: 4096, // Buffer size before flushing
                mkdir: false, // Directory should already exist from Phase 1
            }) as unknown as PinoFileDestination; // Cast to custom interface for flushSync

            // Handle errors specifically for the file destination stream
            this.fileDestination.on('error', (err: unknown) => {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
                console.error(`[LoggingService:FileDestination] CRITICAL: Error in log file destination stream: "${errorMessage}". Stack: ${errorStack}`);
            });

            pinoStreams.push({
                level: this.logLevel as Level,
                stream: this.fileDestination,
            });

            console.log(`[LoggingService:Constructor] File logging configured. Level: ${this.logLevel}. File: ${this.logFilePath}`);

        } catch (err: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:Constructor] CRITICAL: Failed to create pino file destination for "${this.logFilePath}": "${errorMessage}". Stack: ${errorStack}`);
            this.fileDestination = null; // Ensure fileDestination is null if creation fails
        }

        // --- Phase 3: Create the main Logger instance ---
        if (pinoStreams.length > 0) {
            this.logger = pino(pinoOptions, pino.multistream(pinoStreams, {}));
            // Log the initialization success using the newly created logger
            this.logger.info({ service: 'LoggingService', event: 'logger_initialized_success' }, 'Primary logger initialized successfully with configured streams.');
        } else {
            // Fallback: If no valid streams could be configured (e.g., both console and file failed or were disabled)
            console.error('[LoggingService:Constructor] CRITICAL: No valid logging streams configured. Falling back to basic console logger.');
            // Create a bare minimum logger that only outputs to console
            this.logger = pino({ level: this.logLevel || 'info' }); // Use configured level or default to 'info'
            this.logger.error({ service: 'LoggingService', event: 'logger_fallback_active' }, 'Failed to initialize primary logger with configured streams. Using a basic console logger as a fallback.');
        }
    }

    /**
     * Flushes any buffered logs to their destinations and performs necessary cleanup before application exit.
     * This method should be called during application shutdown to ensure all logs are written.
     * It prevents multiple flush calls.
     */
    public flushLogsAndClose(): void {
        if (this.isShuttingDown) {
            console.log('[LoggingService:Flush] Flush already in progress or completed. Skipping.');
            return;
        }
        this.isShuttingDown = true;

        // Log the start of flushing using the configured logger (if available)
        this.logger?.info({ service: 'LoggingService', event: 'log_flush_start' }, 'Initiating log flush before application exit...');
        // Also use console.log as a direct fallback for critical flush messages
        console.log('[LoggingService:Flush] Attempting to flush logs...');

        if (this.fileDestination && typeof this.fileDestination.flushSync === 'function') {
            try {
                this.fileDestination.flushSync();
                console.log('[LoggingService:Flush] Logs flushed successfully.');
                this.logger?.info({ service: 'LoggingService', event: 'log_flush_success' }, 'Logs flushed to file successfully.');
            } catch (flushErr: unknown) { // Catch as unknown
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(flushErr);
                console.error(`[LoggingService:Flush] CRITICAL: Error flushing logs to file: "${errorMessage}". Stack: ${errorStack}`);
                this.logger?.error({ service: 'LoggingService', event: 'log_flush_error', err: { message: errorMessage, stack: errorStack } }, `Critical error during log flush.`);
            }
        } else {
            console.log('[LoggingService:Flush] No file destination to flush or flushSync method not available.');
            this.logger?.warn({ service: 'LoggingService', event: 'log_flush_skipped_no_file_dest' }, 'Skipped log flush: No file destination available or flushSync method is missing.');
        }
    }

    /**
     * Retrieves a Pino logger instance. If a context object is provided,
     * it returns a child logger with that context bound.
     * This allows for detailed, contextual logging across different parts of the application.
     * @param {object} [context] - Optional: An object containing properties to bind to the logger (e.g., { service: 'MyService' }).
     * @returns {Logger} A Pino logger instance.
     */
    public getLogger(context?: object): Logger {
        // Fallback check: if for some reason `this.logger` is not yet initialized
        // (highly unlikely given `@singleton` and constructor logic, but defensive programming).
        if (!this.logger) {
            // This warning will go to console because the main logger isn't ready.
            console.warn('[LoggingService:getLogger] Attempted to get logger before it was fully initialized. Returning a basic console logger.');
            return pino({ level: 'info' }); // Return a basic logger to prevent errors
        }
        return context ? this.logger.child(context) : this.logger;
    }
}