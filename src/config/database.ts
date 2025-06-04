// src/config/database.ts
import 'reflect-metadata'; // Essential for Tsyringe to work with decorators and reflection.
import { container } from 'tsyringe'; // Import the Tsyringe IoC container for dependency resolution.
import mongoose from 'mongoose'; // MongoDB Object-Document Mapper (ODM).
import logToFile from '../utils/logger'; // Import the custom logging utility.
import { ConfigService } from './index'; // Import the application's configuration service.

/**
 * A consistent prefix for log messages originating from the MongoDB connection service.
 * @type {string}
 */
const LOG_PREFIX: string = "[MongoDBService]";

// --- Resolve ConfigService Instance ---
// Resolve the singleton instance of ConfigService to access application configurations.
// This should be done early as database URI is a critical dependency.
const configService = container.resolve(ConfigService);

// --- Retrieve MongoDB Connection URI from ConfigService ---
// Access MONGODB_URI using the specific getter provided by the refactored ConfigService
const MONGODB_URI = configService.mongodbUri;

// Perform an immediate critical check for MONGODB_URI.
// If it's missing, log a fatal error and throw to prevent application startup.
if (!MONGODB_URI) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: MONGODB_URI is not configured in the environment variables.`);
    // Throw an error to halt the application initialization process.
    throw new Error("MONGODB_URI environment variable is not configured. Please check your .env file.");
}

/**
 * Establishes a connection to the MongoDB database using Mongoose.
 * This function also sets up listeners for connection events (error, disconnected)
 * to ensure robust logging of database status changes.
 *
 * @returns {Promise<void>} A promise that resolves if the MongoDB connection is successful,
 *                          or rejects if an initial connection error occurs.
 * @throws {Error} If the initial connection to MongoDB fails, the error is re-thrown
 *                 to allow higher-level loaders or the main application process to handle it.
 */
export const connectDB = async (): Promise<void> => {
    try {
        logToFile(`${LOG_PREFIX} Attempting to establish MongoDB connection...`);

        // Attempt to connect to MongoDB using the URI obtained from ConfigService.
        await mongoose.connect(MONGODB_URI);

        logToFile(`${LOG_PREFIX} MongoDB Connected Successfully.`);

        // --- Register Mongoose Connection Event Listeners ---

        /**
         * Event listener for Mongoose connection errors.
         * Logs the error message to the application log file.
         */
        mongoose.connection.on('error', (err: mongoose.Error) => {
            logToFile(`${LOG_PREFIX} MongoDB runtime error: ${err.message}`);
        });

        /**
         * Event listener for Mongoose disconnection.
         * Logs a warning to the application log file.
         */
        mongoose.connection.on('disconnected', () => {
            logToFile(`${LOG_PREFIX} MongoDB disconnected.`);
        });

        // Optionally, you might add a 'connected' listener if you want to log every re-connection.
        // mongoose.connection.on('connected', () => {
        //     logToFile(`${LOG_PREFIX} MongoDB re-connected.`);
        // });

    } catch (error: any) {
        // Catch any errors that occur during the initial `mongoose.connect()` call.
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack available.';

        logToFile(`${LOG_PREFIX} MongoDB Initial Connection Error: "${errorMessage}". Stack: ${errorStack}`);

        // Re-throw the error to `src/loaders/database.loader.ts` (and then `src/loaders/index.ts`)
        // to ensure that the application startup process is halted if the database cannot be reached.
        throw error;
    }
};