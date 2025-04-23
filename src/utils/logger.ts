import * as fs from 'fs'; // Use the synchronous version for CommonJS
import * as path from 'path';

const logFilePath: string = path.join(__dirname, '../app.log'); // Log file in the same directory

function logToFile(message: string): void {
    try {
        const timestamp: string = new Date().toISOString();
        const logMessage: string = `[${timestamp}] ${message}\n`;
        fs.appendFileSync(logFilePath, logMessage, 'utf8'); // Use appendFileSync
    } catch (error: any) { // Specify error type as 'any' or 'Error'
        console.error('Error writing to log file:', error);
        // Don't re-throw; we want the application to continue even if logging fails
    }
}


export default logToFile;