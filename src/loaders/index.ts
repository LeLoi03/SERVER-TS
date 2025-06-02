// src/loaders/index.ts
import { Express } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe'; // Tsyringe IoC container for dependency resolution

// Import specific loaders
import { loadExpress } from './express.loader';
import { connectDB } from './database.loader';
import { initSocketIO } from './socket.loader'; // No need for getIO here unless directly used
import { scheduleJobs } from './jobs.loader';

// Import services that need to be resolved and invoked
import { LogAnalysisService } from '../services/logAnalysisConference.service';
import { LogAnalysisJournalService } from '../services/logAnalysisJournal.service';

// Import the custom logging utility
import logToFile from '../utils/logger';

/**
 * Interface defining the structure of the object returned by `initLoaders`.
 * Provides access to the initialized Express app, HTTP server, and Socket.IO server.
 */
interface LoadersResult {
    /** The initialized Express application instance. */
    app: Express;
    /** The initialized Node.js HTTP server instance. */
    httpServer: HttpServer;
    /** The initialized Socket.IO server instance. */
    io: SocketIOServer;
}

/**
 * The main loader function responsible for initializing all core components of the application.
 * This includes connecting to the database, setting up the Express application,
 * initializing Socket.IO, scheduling cron jobs, and performing initial setup tasks.
 *
 * It uses `logToFile` for logging its progress and any errors encountered during the loading process.
 *
 * @returns {Promise<LoadersResult>} A promise that resolves with an object containing
 *                                   the initialized Express app, HTTP server, and Socket.IO server.
 * @throws {Error} If any critical loading step fails, the error is re-thrown to halt application startup.
 */
export const initLoaders = async (): Promise<LoadersResult> => {
    // Define a consistent context string for logs originating from this loader.
    const logContext = `[MainLoader]`;

    // Log the start of the overall loading process.
    // logToFile(`${logContext} Starting application loading process...`);

    try {
        // --- 1. Connect to Database ---
        // `connectDB` is expected to use `logToFile` internally for its own logging.
        logToFile(`${logContext} Attempting to connect to database...`);
        await connectDB();
        // logToFile(`${logContext} Database connection established successfully.`);

        // --- 2. Initialize Services Managed by DI Container ---
        // Note: Services themselves are registered in `src/container.ts` and
        // are resolved by `tsyringe` where needed. This step merely acknowledges
        // their availability via DI for subsequent use if needed.
        // logToFile(`${logContext} Core services managed by Dependency Injection container are ready.`);

        // --- 3. Load Express Application ---
        // `loadExpress` is expected to set up routes, middleware, etc., and use `logToFile`.
        logToFile(`${logContext} Initializing Express application...`);
        const app = loadExpress();
        // Create a new HTTP server instance using the Express app.
        const httpServer = new HttpServer(app);
        // logToFile(`${logContext} Express application initialized and HTTP server created.`);

        // --- 4. Initialize Socket.IO Server ---
        // `initSocketIO` is expected to attach Socket.IO to the HTTP server and use `logToFile`.
        logToFile(`${logContext} Initializing Socket.IO server...`);
        const io = initSocketIO(httpServer);
        // logToFile(`${logContext} Socket.IO server initialized.`);

        // --- 5. Schedule Cron Jobs ---
        // `scheduleJobs` is expected to define and start cron tasks, and should use `logToFile`.
        logToFile(`${logContext} Scheduling cron jobs...`);
        scheduleJobs();
        // logToFile(`${logContext} Cron jobs scheduled.`);

        // --- 6. Perform Initial Application Tasks ---
        // This section executes any necessary one-time tasks on startup.
        try {
            // Define a specific context for this initial task for clearer logs.
            const taskLogContext = `${logContext}[Task:InitialLogAnalysis]`;
            // logToFile(`${taskLogContext} Performing initial log analysis...`);

            // Resolve and invoke the LogAnalysisService.
            // This service is expected to use `logToFile` internally for its operations.
            const conferenceLogAnalysisService = container.resolve(LogAnalysisService);
            const journalLogAnalysisService = container.resolve(LogAnalysisJournalService);

            await conferenceLogAnalysisService.performConferenceAnalysisAndUpdate();
            await journalLogAnalysisService.performJournalAnalysisAndUpdate();

            // logToFile(`${taskLogContext} Initial log analysis completed successfully.`);
        } catch (error: any) {
            // Catch and log errors specific to the initial log analysis task.
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack : 'No stack available.';
            logToFile(`[ERROR] ${logContext}[Task:InitialLogAnalysis] Initial log analysis failed. Error: "${errorMessage}". Stack: ${errorStack}`);
            // Also log to console for immediate visibility of critical errors during startup.
            console.error(`[ERROR] ${logContext}[Task:InitialLogAnalysis] Initial log analysis failed:`, error);
            // Decide whether to re-throw: If this task is critical for app function, re-throw.
            // If not critical, just log and continue. For now, we log and proceed.
        }

        // --- Final Check ---
        logToFile(`${logContext} All basic application loaders completed successfully.`);

        // Return the initialized instances for the main server.ts to use.
        return { app, httpServer, io };

    } catch (error: any) {
        // Catch any unhandled errors that occur during the main loading process.
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack available.';

        // Log a fatal error indicating the overall application loading failure.
        logToFile(`[FATAL ERROR] ${logContext} Application loading failed. Error: "${errorMessage}". Stack: ${errorStack}`);
        // Also log to console for immediate visibility of fatal errors.
        console.error(`[FATAL ERROR] ${logContext} Application failed to load:`, error);

        // Re-throw the error so that the calling process (e.g., `server.ts`) can handle it,
        // typically by performing a graceful shutdown and exiting.
        throw error;
    }
};