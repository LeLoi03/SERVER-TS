// src/loaders/index.ts
import { Express } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe'; // Tsyringe IoC container for dependency resolution

// Import specific loaders
import { loadExpress } from './express.loader';
import { connectDB } from './database.loader';
import { initSocketIO } from './socket.loader'; // No need for getIO here unless directly used
// import { scheduleJobs } from './jobs.loader';

// Import services that need to be resolved and invoked
import { ConferenceLogAnalysisService } from '../services/conferenceLogAnalysis.service';
import { JournalLogAnalysisService } from '../services/journalLogAnalysis.service';

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
 *
 * @returns {Promise<LoadersResult>} A promise that resolves with an object containing
 *                                   the initialized Express app, HTTP server, and Socket.IO server.
 * @throws {Error} If any critical loading step fails, the error is re-thrown to halt application startup.
 */
export const initLoaders = async (): Promise<LoadersResult> => {
    // Define a consistent context string for logs originating from this loader.
    const logContext = `[MainLoader]`;

    // Log the start of the overall loading process.


    try {
        // --- 1. Connect to Database ---
        
        await connectDB();
    

        // --- 2. Initialize Services Managed by DI Container ---
        // Note: Services themselves are registered in `src/container.ts` and
        // are resolved by `tsyringe` where needed. This step merely acknowledges
        // their availability via DI for subsequent use if needed.
    

        // --- 3. Load Express Application ---
        
        const app = loadExpress();
        // Create a new HTTP server instance using the Express app.
        const httpServer = new HttpServer(app);
    

        // --- 4. Initialize Socket.IO Server ---
        
        const io = initSocketIO(httpServer);
    

        // // --- 5. Schedule Cron Jobs ---
        
    
        // scheduleJobs();
        //

        // --- 6. Perform Initial Application Tasks ---
        // This section executes any necessary one-time tasks on startup.
        try {


            // Resolve and invoke the ConferenceLogAnalysis.
            
            const conferenceConferenceLogAnalysis = container.resolve(ConferenceLogAnalysisService);
            const journalLogAnalysisService = container.resolve(JournalLogAnalysisService);

            await conferenceConferenceLogAnalysis.performConferenceAnalysisAndUpdate();
            await journalLogAnalysisService.performJournalAnalysisAndUpdate();

        
        } catch (error: any) {
         
        }

        // --- Final Check --

        // Return the initialized instances for the main server.ts to use.
        return { app, httpServer, io };

    } catch (error: any) {

    
        throw error;
    }
};