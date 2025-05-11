// src/loaders/index.ts
import { Express } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { container } from 'tsyringe';
// import { Logger } from 'pino'; // Xóa import Logger
// import { LoggingService } from '../services/logging.service'; // Xóa import LoggingService
import { loadExpress } from './express.loader';
import { connectDB } from './database.loader';
import { initSocketIO, getIO } from './socket.loader';
import { scheduleJobs } from './jobs.loader';
import { LogAnalysisService } from '../services/logAnalysis.service';
import logToFile from '../utils/logger';

interface LoadersResult {
    app: Express;
    httpServer: HttpServer;
    io: SocketIOServer;
}

export const initLoaders = async (): Promise<LoadersResult> => {
    // --- No Need to Resolve Services or Create Pino Logger ---
    // const loggingService = container.resolve(LoggingService); // Xóa resolve
    // const logger: Logger = loggingService.getLogger({ loader: 'Main' }); // Xóa logger

    const logContext = `[MainLoader]`; // Chuỗi context cho log chính

    // <<< Use logToFile
    logToFile(`${logContext} Starting application loading process...`);

    try {
        // 1. Connect to Database (connectDB đã được điều chỉnh để dùng logToFile bên trong)
        await connectDB();
        // <<< Use logToFile
        logToFile(`${logContext} Database loaded.`);

        // 2. Services Managed by DI Container
        // <<< Use logToFile
        logToFile(`${logContext} Services will be managed by DI container.`);

        // 3. Load Express App (loadExpress đã được điều chỉnh để dùng logToFile bên trong)
        const app = loadExpress();
        const httpServer = new HttpServer(app);
        // <<< Use logToFile
        logToFile(`${logContext} Express loaded.`);

        // 4. Initialize Socket.IO (initSocketIO sẽ được điều chỉnh để dùng logToFile bên trong)
        const io = initSocketIO(httpServer);
        // <<< Use logToFile
        logToFile(`${logContext} Socket.IO loaded.`);

        // 5. Schedule Cron Jobs (scheduleJobs sẽ cần điều chỉnh hoặc đảm bảo nó dùng logToFile)
        scheduleJobs(); // Cần đảm bảo scheduleJobs cũng dùng logToFile
        // <<< Use logToFile
        logToFile(`${logContext} Jobs scheduled.`);

        // 6. Perform initial tasks
        try {
            // Tạo chuỗi context cho task cụ thể này
            const taskLogContext = `${logContext}[Task:InitialLogAnalysis]`;
            // <<< Use logToFile
            logToFile(`${taskLogContext} Performing initial log analysis...`);
            const logAnalysisService = container.resolve(LogAnalysisService);
            await logAnalysisService.performAnalysisAndUpdate(); // Cần đảm bảo LogAnalysisService cũng dùng logToFile
            // <<< Use logToFile
            logToFile(`${taskLogContext} Initial log analysis completed.`);
        } catch (error: any) { // Chỉ định loại lỗi là any
            const errorMessage = error instanceof Error ? error.message : String(error);
            // Ghi lỗi bằng logToFile
            logToFile(`[ERROR] ${logContext}[Task:InitialLogAnalysis] Initial log analysis failed. Error: "${errorMessage}", Stack: ${error.stack}`);
            console.error("Initial log analysis failed:", error); // Giữ console.error cho lỗi nghiêm trọng khi khởi động
            // Consider throwing error if critical
            // throw new Error(`Initial log analysis failed: ${errorMessage}`);
        }

        // 7. Data manager examples moved to server.ts

        // <<< Use logToFile
        logToFile(`${logContext} All basic loaders completed successfully.`);

        return { app, httpServer, io };

    } catch (error: any) { // Bắt lỗi chung trong quá trình loader
        const errorMessage = error instanceof Error ? error.message : String(error);
        // Ghi lỗi nghiêm trọng khi toàn bộ quá trình loader thất bại
         logToFile(`[FATAL ERROR] ${logContext} Application loading failed. Error: "${errorMessage}", Stack: ${error.stack}`);
         console.error("FATAL: Application failed to load.", error); // Giữ console.error cho lỗi nghiêm trọng

         // Ném lại lỗi để quá trình main có thể xử lý (ví dụ: thoát)
         throw error;
    }
};