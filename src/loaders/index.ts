// src/loaders/index.ts
import { Express } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { loadExpress } from './express.loader';
import { connectDB } from './database.loader';
import { initSocketIO } from './socket.loader';
import { scheduleJobs } from './jobs.loader';
import { ConversationHistoryService } from '../chatbot/services/conversationHistory.service';
import logToFile from '../utils/logger';
import { LogAnalysisService } from '../services/logAnalysis.service'; // Đã import
import { init as initDataManager } from '../conference/8_data_manager'; // Rename init import

interface LoadersResult {
    app: Express;
    httpServer: HttpServer;
    io: SocketIOServer;
    logAnalysisService: LogAnalysisService; // <<< Thêm service vào kết quả trả về
}

export const initLoaders = async (): Promise<LoadersResult> => {
    logToFile('[Loader] Starting application loading process...');

    // 1. Connect to Database
    await connectDB();
    logToFile('[Loader] Database loaded.');

    // 2. Initialize Services (Inject dependencies if needed)
    const conversationHistoryService = new ConversationHistoryService();
    const logAnalysisService = new LogAnalysisService(); // <<< Khởi tạo service log
    logToFile('[Loader] Services initialized.');

    // 3. Load Express App (Truyền service vào)
    const app = loadExpress(logAnalysisService); // <<< Truyền service vào express loader
    const httpServer = new HttpServer(app);
    logToFile('[Loader] Express loaded.');

    // 4. Initialize Socket.IO (pass dependencies)
    const io = initSocketIO(httpServer, conversationHistoryService);
    logToFile('[Loader] Socket.IO loaded.');

    // 5. Schedule Cron Jobs (pass dependencies like services and io)
    scheduleJobs(logAnalysisService, io);
    logToFile('[Loader] Jobs scheduled.');

    // 6. Perform initial tasks
    try {
        logToFile('[Loader] Performing initial log analysis...');
        await logAnalysisService.performAnalysisAndUpdate(); // <<< Gọi hàm trong service
        logToFile('[Loader] Initial log analysis completed.');
    } catch (error) {
        logToFile('[Loader] Initial log analysis failed.');
        // Cân nhắc log chi tiết lỗi ở đây
        console.error("Initial log analysis failed:", error);
    }

    // 7. Data manager (few-show examples)
    await initDataManager();


    logToFile('[Loader] All loaders completed successfully.');

    return { app, httpServer, io, logAnalysisService }; // <<< Trả về service
};