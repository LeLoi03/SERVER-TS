// src/loaders/jobs.loader.ts
import { container } from 'tsyringe'; // Keep container if needed for other potential DI resolutions
import { scheduleLogAnalysisJob } from '../jobs/logAnalysis.job'; // Import the specific job scheduling function
import logToFile from '../utils/logger'; // Import the custom logging utility

/**
 * Schedules all background cron jobs for the application.
 * This function initiates the scheduling process for various automated tasks.
 * It logs its actions using `logToFile`.
 */
export const scheduleJobs = (): void => {
    // Define a consistent context string for logs originating from this loader.
    const logContext = `[JobsLoader]`;

    logToFile(`${logContext} Starting background jobs scheduling...`);

    // Schedule the log analysis job.
    // `scheduleLogAnalysisJob` is expected to resolve its own dependencies (e.g., LogAnalysisService)
    // and handle its own logging internally using `logToFile` or similar.
    scheduleLogAnalysisJob();
    logToFile(`${logContext} Log analysis job scheduling initiated.`);

    // Add calls to schedule other background jobs here if they exist.
    // Example:
    // scheduleAnotherJob();
    // logToFile(`${logContext} Another job scheduling initiated.`);

    logToFile(`${logContext} All background jobs scheduling initiated.`);
};