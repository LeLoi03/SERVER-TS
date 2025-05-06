// src/loaders/jobs.loader.ts
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../services/logging.service'; // <<< Import LoggingService
import { scheduleLogAnalysisJob } from '../jobs/logAnalysis.job';
// import logToFile from '../utils/logger'; // <<< XÓA

export const scheduleJobs = () => {
    // <<< Resolve LoggingService
    const loggingService = container.resolve(LoggingService);
    const logger: Logger = loggingService.getLogger({ loader: 'Jobs' }); // <<< Tạo child logger

    logger.info('Scheduling background jobs...'); // <<< Dùng logger

    // scheduleLogAnalysisJob sẽ tự resolve dependencies và logger bên trong nó
    scheduleLogAnalysisJob();

    // Lên lịch cho các jobs khác nếu có
    // scheduleAnotherJob();

    logger.info('Background jobs scheduling initiated.'); // <<< Dùng logger
};