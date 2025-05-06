// src/jobs/logAnalysis.job.ts
import cron from 'node-cron';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../services/logging.service'; // <<< Import LoggingService
import { getIO } from '../loaders/socket.loader';
// import logToFile from '../utils/logger'; // <<< XÓA
import { LogAnalysisService } from '../services/logAnalysis.service';
import { ConfigService } from '../config/config.service';

export const scheduleLogAnalysisJob = () => {
    // <<< Resolve logging service sớm
    const loggingService = container.resolve(LoggingService);
    const parentLogger = loggingService.getLogger({ job: 'LogAnalysisScheduler' }); // <<< Logger cho việc schedule

    try {
        const configService = container.resolve(ConfigService);
        const cronSchedule = configService.config.LOG_ANALYSIS_CRON_SCHEDULE || '*/30 * * * *';
        const timezone = configService.config.CRON_TIMEZONE || "Asia/Ho_Chi_Minh";

        parentLogger.info({ schedule: cronSchedule, timezone }, 'Scheduling log analysis job...'); // <<< Dùng parentLogger

        cron.schedule(cronSchedule, async () => {
            // <<< Tạo child logger cho mỗi lần chạy job
            const jobLogger: Logger = loggingService.getLogger({ job: 'LogAnalysisRun', runId: Date.now() });
            const jobStartTime = Date.now();
            jobLogger.info('Starting scheduled task...'); // <<< Dùng jobLogger
            try {
                // Resolve services bên trong callback
                const logAnalysisService = container.resolve(LogAnalysisService);
                const io = getIO(); // Lấy IO instance

                const results = await logAnalysisService.performAnalysisAndUpdate();

                io.emit('log_analysis_update', results);

                const duration = Date.now() - jobStartTime;
                jobLogger.info({ durationMs: duration }, 'Scheduled task completed successfully. Results broadcasted.'); // <<< Dùng jobLogger

            } catch (error) {
                const duration = Date.now() - jobStartTime;
                const errorMessage = error instanceof Error ? error.message : String(error);
                jobLogger.error({ durationMs: duration, error: errorMessage, stack: error instanceof Error ? error.stack : undefined }, 'Scheduled task failed.'); // <<< Dùng jobLogger
                try {
                    getIO().emit('log_analysis_error', {
                        message: 'Scheduled log analysis failed to complete.',
                        timestamp: new Date(),
                        error: errorMessage
                    });
                } catch (ioError: any) {
                    jobLogger.error({ error: ioError.message }, 'Failed to emit error via Socket.IO'); // <<< Dùng jobLogger
                }
            }
        }, {
            scheduled: true,
            timezone: timezone
        });

        parentLogger.info('Log analysis job scheduled successfully.'); // <<< Dùng parentLogger

    } catch (scheduleError: any) {
        // Lỗi xảy ra NGAY KHI schedule job
        parentLogger.fatal({ error: scheduleError.message, stack: scheduleError.stack }, 'Failed to schedule log analysis job.'); // <<< Dùng parentLogger
        // throw new Error(`Failed to schedule log analysis job: ${scheduleError.message}`);
    }
};