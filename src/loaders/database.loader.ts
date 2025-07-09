// src/loaders/database.loader.ts
import { connectDB as connectMongo } from '../config/database'; // Alias `connectDB` to `connectMongo` to avoid naming conflict

/**
 * Connects to the application's MongoDB database.
 *
 * @returns {Promise<void>} A promise that resolves if the connection is successful,
 *                          or rejects if an error occurs during connection.
 * @throws {Error} If the database connection fails, the error is re-thrown.
 */
export const connectDB = async (): Promise<void> => {
    try {
        // Call the actual database connection function from `config/database.ts`.
        await connectMongo();
    } catch (error: any) {
        // Re-throw the error to halt the application startup in `initLoaders` or `server.ts`.
        throw error;
    }
};