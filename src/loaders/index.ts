// src/loaders/index.ts
import { Express } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { loadExpress } from './express.loader';
import { connectDB } from './database.loader'; // Hàm connect từ loader database
import { initSocketIO } from './socket.loader'; // Hàm init từ loader socket
import { scheduleJobs } from './jobs.loader'; // Hàm schedule từ loader jobs
import { ConversationHistoryService } from '../chatbot/services/conversationHistory.service';
import logToFile from '../utils/logger';
import { LogAnalysisService } from '../services/logAnalysis.service';

interface LoadersResult {
    app: Express;
    httpServer: HttpServer;
    io: SocketIOServer;
}

export const initLoaders = async (): Promise<LoadersResult> => {
    logToFile('[Loader] Starting application loading process...');

    // 1. Connect to Database
    await connectDB(); // loader này sẽ gọi connectDB từ config/database
    logToFile('[Loader] Database loaded.');

    // 2. Load Express App
    const app = loadExpress();
    const httpServer = new HttpServer(app); // Tạo HTTP server từ Express app
    logToFile('[Loader] Express loaded.');

    // 3. Initialize Services (Inject dependencies if needed)
    const conversationHistoryService = new ConversationHistoryService();
    const logAnalysisService = new LogAnalysisService(); // Khởi tạo service log
    logToFile('[Loader] Services initialized.');

    // 4. Initialize Socket.IO (pass dependencies)
    const io = initSocketIO(httpServer, conversationHistoryService);
    logToFile('[Loader] Socket.IO loaded.');

    // 5. Schedule Cron Jobs (pass dependencies like services and io)
    scheduleJobs(logAnalysisService, io);
    logToFile('[Loader] Jobs scheduled.');

    // 6. Perform initial tasks (e.g., initial log analysis) - Optional
    try {
        logToFile('[Loader] Performing initial log analysis...');
        await logAnalysisService.performAnalysisAndUpdate(); // Gọi hàm trong service
        logToFile('[Loader] Initial log analysis completed.');
    } catch (error) {
        logToFile('[Loader] Initial log analysis failed.');
    }

    logToFile('[Loader] All loaders completed successfully.');

    return { app, httpServer, io };
};