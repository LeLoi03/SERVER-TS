// src/loaders/jobs.loader.ts
import { container } from 'tsyringe';
// import { Logger } from 'pino'; // Xóa import Logger
// import { LoggingService } from '../services/logging.service'; // Xóa import LoggingService
import { scheduleLogAnalysisJob } from '../jobs/logAnalysis.job'; // Giữ nguyên import
import logToFile from '../utils/logger';

export const scheduleJobs = () => {
    // --- No Need to Resolve Services or Create Pino Logger ---
    // const loggingService = container.resolve(LoggingService); // Xóa resolve
    // const logger: Logger = loggingService.getLogger({ loader: 'Jobs' }); // Xóa logger

    const logContext = `[JobsLoader]`; // Chuỗi context cho log

    // <<< Use logToFile
    logToFile(`${logContext} Scheduling background jobs...`);

    // scheduleLogAnalysisJob sẽ tự resolve dependencies và logger bên trong nó
    // Bạn cần đảm bảo scheduleLogAnalysisJob và các job khác cũng đã được điều chỉnh để dùng logToFile
    scheduleLogAnalysisJob();

    // Lên lịch cho các jobs khác nếu có
    // scheduleAnotherJob();

    // <<< Use logToFile
    logToFile(`${logContext} Background jobs scheduling initiated.`);
};