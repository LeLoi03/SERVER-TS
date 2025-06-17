// src/loaders/database.loader.ts
import { connectDB as connectMongo } from '../config/database'; // Alias `connectDB` to `connectMongo` to avoid naming conflict
import logToFile from '../utils/logger'; // Import the custom logging utility

/**
 * Connects to the application's MongoDB database.
 * This function encapsulates the database connection logic and logs its status using `logToFile`.
 *
 * @returns {Promise<void>} A promise that resolves if the connection is successful,
 *                          or rejects if an error occurs during connection.
 * @throws {Error} If the database connection fails, the error is re-thrown.
 */
export const connectDB = async (): Promise<void> => {
    // Define a consistent context string for logs originating from this loader.
    const logContext = `[DatabaseLoader]`;

    logToFile(`${logContext} Attempting to establish database connection...`);

    try {
        // Call the actual database connection function from `config/database.ts`.
        await connectMongo();

        logToFile(`${logContext} Database connection successful.`);
    } catch (error: any) {
        // Catch and log any errors that occur during the database connection process.
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : 'No stack available.';

        logToFile(`[ERROR] ${logContext} Database connection failed. Error: "${errorMessage}". Stack: ${errorStack}`);

        // Re-throw the error to halt the application startup in `initLoaders` or `server.ts`.
        throw error;
    }
};