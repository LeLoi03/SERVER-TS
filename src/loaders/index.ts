// src/loaders/index.ts
import { Express } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../services/logging.service'; // <<< Import LoggingService
import { loadExpress } from './express.loader';
import { connectDB } from './database.loader';
import { initSocketIO, getIO } from './socket.loader';
import { scheduleJobs } from './jobs.loader';
// import logToFile from '../utils/logger'; // <<< XÓA
import { LogAnalysisService } from '../services/logAnalysis.service';

interface LoadersResult {
    app: Express;
    httpServer: HttpServer;
    io: SocketIOServer;
}

export const initLoaders = async (): Promise<LoadersResult> => {
    // <<< Resolve LoggingService sớm nhất có thể
    const loggingService = container.resolve(LoggingService);
    const logger: Logger = loggingService.getLogger({ loader: 'Main' }); // <<< Tạo child logger chính

    logger.info('Starting application loading process...'); // <<< Dùng logger

    // 1. Connect to Database (connectDB tự log bên trong)
    await connectDB();
    logger.info('Database loaded.'); // <<< Dùng logger chính

    // 2. Services Managed by DI Container
    logger.info('Services will be managed by DI container.'); // <<< Dùng logger chính

    // 3. Load Express App (loadExpress tự log bên trong)
    const app = loadExpress();
    const httpServer = new HttpServer(app);
    logger.info('Express loaded.'); // <<< Dùng logger chính

    // 4. Initialize Socket.IO (initSocketIO tự log bên trong)
    const io = initSocketIO(httpServer);
    logger.info('Socket.IO loaded.'); // <<< Dùng logger chính

    // 5. Schedule Cron Jobs (scheduleJobs tự log bên trong)
    scheduleJobs();
    logger.info('Jobs scheduled.'); // <<< Dùng logger chính

    // 6. Perform initial tasks
    try {
        // Tạo child logger cho task cụ thể này
        const taskLogger = logger.child({ task: 'initialLogAnalysis' });
        taskLogger.info('Performing initial log analysis...'); // <<< Dùng taskLogger
        const logAnalysisService = container.resolve(LogAnalysisService);
        await logAnalysisService.performAnalysisAndUpdate();
        taskLogger.info('Initial log analysis completed.'); // <<< Dùng taskLogger
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Ghi lỗi bằng logger chính hoặc logger của task
        logger.error({ task: 'initialLogAnalysis', error: errorMessage, stack: error instanceof Error ? error.stack : undefined }, 'Initial log analysis failed.'); // <<< Dùng logger chính với context
        console.error("Initial log analysis failed:", error); // Giữ console.error cho lỗi nghiêm trọng khi khởi động
        // Consider throwing error if critical
        // throw new Error(`Initial log analysis failed: ${errorMessage}`);
    }

    // 7. Data manager examples moved to server.ts

    logger.info('All basic loaders completed successfully.'); // <<< Dùng logger chính

    return { app, httpServer, io };
};