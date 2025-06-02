// src/jobs/logAnalysis.job.ts
import cron from 'node-cron'; // Import the node-cron library for scheduling tasks
import { container } from 'tsyringe'; // Import the Tsyringe IoC container for dependency resolution
import { Logger } from 'pino'; // Import the Logger type from pino for type safety

// Import necessary services
import { LoggingService } from '../services/logging.service';
import { getIO } from '../loaders/socket.loader'; // Function to get the Socket.IO server instance
import { ConfigService } from '../config/config.service';
import { LogAnalysisJournalService } from '../services/logAnalysisJournal.service';
/**
 * Schedules the recurring log analysis job.
 * This function retrieves the cron schedule and timezone from `ConfigService`,
 * then sets up a `node-cron` task to periodically perform log analysis.
 *
 * Each run of the job logs its progress and status using a dedicated child logger,
 * and broadcasts results or errors via Socket.IO.
 */
export const scheduleLogAnalysisJob = (): void => {
    // Resolve the LoggingService early to obtain a logger for the scheduling process itself.
    // const loggingService = container.resolve(LoggingService);
    // Create a parent logger specific to the job scheduler.
    // const parentLogger: Logger = loggingService.getLogger('conference', { job: 'LogAnalysisScheduler' });
    // const parentLogger: Logger = loggingService.getLogger('journal', { job: 'LogAnalysisScheduler' });

    try {
        // Resolve ConfigService to get job-specific configurations.
        const configService = container.resolve(ConfigService);
        // Retrieve cron schedule from config, defaulting to every 30 minutes if not set.
        const cronSchedule = configService.config.LOG_ANALYSIS_CRON_SCHEDULE || '*/30 * * * *';
        // Retrieve timezone for cron job, defaulting to Vietnam's timezone.
        const timezone = configService.config.CRON_TIMEZONE || "Asia/Ho_Chi_Minh";

        // parentLogger.info(
        //     { schedule: cronSchedule, timezone },
        //     `Attempting to schedule log analysis job with cron expression: '${cronSchedule}' and timezone: '${timezone}'.`
        // );

        // Schedule the cron job using `node-cron`.
        cron.schedule(cronSchedule, async () => {
            // --- Logic to execute on each scheduled job run ---
            const jobStartTime = Date.now();
            // Create a *new child logger* for each job run. This helps in tracing individual job executions
            // by attaching a unique `runId` to all logs generated within this specific run.
            // const jobLogger: Logger = loggingService.getLogger('main', { job: 'LogAnalysisRun', runId: jobStartTime });

            // jobLogger.info('Starting scheduled log analysis task...');

            try {
                // Resolve services needed for the job inside the callback.
                // This ensures that if services were re-registered or needed a fresh instance,
                // the job gets the latest available. For singletons, it's just getting the instance.
                const logAnalysisService = container.resolve(LogAnalysisJournalService);
                const io = getIO(); // Get the global Socket.IO server instance.

                // Perform the log analysis and update results.
                const results = await logAnalysisService.performJournalAnalysisAndUpdate();

                // Emit the updated analysis results to all connected Socket.IO clients.
                io.emit('log_analysis_update', results);

                const duration = Date.now() - jobStartTime;
                // jobLogger.info(
                //     { durationMs: duration, timestamp: new Date(jobStartTime).toISOString() },
                //     'Scheduled log analysis task completed successfully. Results broadcasted via Socket.IO.'
                // );

            } catch (error: any) {
                // Handle errors occurring during the execution of a scheduled job run.
                const duration = Date.now() - jobStartTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                const errorStack = error instanceof Error ? error.stack : undefined;

                // jobLogger.error(
                //     { durationMs: duration, error: errorMessage, stack: errorStack, timestamp: new Date(jobStartTime).toISOString() },
                //     'Scheduled log analysis task failed to complete.'
                // );

                // Attempt to broadcast the error to connected Socket.IO clients.
                try {
                    getIO().emit('log_analysis_error', {
                        message: 'Scheduled log analysis failed to complete.',
                        timestamp: new Date().toISOString(),
                        error: errorMessage,
                        details: errorStack // Include stack for more details on client if needed
                    });
                } catch (ioError: any) {
                    // Log if there's an error even while trying to emit the error via Socket.IO.
                    // jobLogger.error(
                    //     { error: ioError.message, stack: ioError.stack },
                    //     'Failed to emit log analysis error via Socket.IO after a job failure.'
                    // );
                }
            }
        }, {
            // Options for `node-cron`:
            scheduled: true, // Indicates the task should be scheduled immediately upon definition.
            timezone: timezone // Specifies the timezone for cron scheduling.
        });

        // parentLogger.info('Log analysis job scheduled successfully.');

    } catch (scheduleError: any) {
        // This catch block handles errors that occur *during the scheduling process itself*
        // (e.g., invalid cron expression, configuration errors), not during job execution.
        const errorMessage = scheduleError instanceof Error ? scheduleError.message : String(scheduleError);
        const errorStack = scheduleError instanceof Error ? scheduleError.stack : undefined;

        // parentLogger.fatal(
        //     { error: errorMessage, stack: errorStack },
        //     'CRITICAL ERROR: Failed to schedule log analysis job. Application might not function as expected.'
        // );
        // Optionally, re-throw if this failure is critical enough to halt application startup.
        // throw new Error(`Failed to schedule log analysis job: ${errorMessage}`);
    }
};