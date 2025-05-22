// src/utils/logger.ts
import * as fs from 'fs';
import * as path from 'path';
import { getErrorMessageAndStack } from './errorUtils'; // Import the error utility

// Determine the path for the log file.
// It will be located in the parent directory of where this `logger.ts` file resides, named `app.log`.
const logFilePath: string = path.join(__dirname, '../../app.log'); // Adjust path to put it in the root folder

/**
 * Appends a timestamped message to a log file.
 * This is a basic file logger used for general application events.
 * Errors during logging are caught and printed to console, but not re-thrown,
 * to avoid disrupting application flow.
 *
 * @param {string} message - The log message content.
 */
function logToFile(message: string): void {
    try {
        const timestamp: string = new Date().toISOString();
        // Prepend log level/context if not already present in the message
        const finalMessage: string = `[${timestamp}] ${message}\n`;

        // Use synchronous append for simplicity in this basic logger.
        // For high-throughput logging, a more robust asynchronous or streaming solution would be preferred.
        fs.appendFileSync(logFilePath, finalMessage, 'utf8');
    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        // If logging to file fails, print to console as a fallback.
        // It's crucial not to re-throw here to prevent the application from crashing
        // due to a logging failure.
        console.error(`[CRITICAL] Error writing to log file "${logFilePath}": "${errorMessage}". Original Log Message: "${message}". Stack: ${errorStack}`);
    }
}

export default logToFile;