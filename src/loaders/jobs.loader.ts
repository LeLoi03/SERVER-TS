import { Server as SocketIOServer } from 'socket.io';
import { scheduleLogAnalysisJob } from '../jobs/logAnalysis.job';
import logToFile from '../utils/logger';
import { LogAnalysisService } from '../services/logAnalysis.service';

export const scheduleJobs = (
    logAnalysisService: LogAnalysisService,
    io: SocketIOServer
) => {
    logToFile('[Loader Jobs] Scheduling background jobs...');

    // Lên lịch cho job phân tích log
    scheduleLogAnalysisJob(logAnalysisService, io);

    // Lên lịch cho các jobs khác nếu có
    // scheduleAnotherJob(...);

    logToFile('[Loader Jobs] Background jobs scheduled.');
};