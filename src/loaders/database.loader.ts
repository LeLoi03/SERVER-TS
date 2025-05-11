// src/loaders/database.loader.ts
import { container } from 'tsyringe';
// import { Logger } from 'pino'; // Xóa import Logger
// import { LoggingService } from '../services/logging.service'; // Xóa import LoggingService
import { connectDB as connectMongo } from '../config/database'; // Giữ nguyên import và đổi tên
import logToFile from '../utils/logger';

export const connectDB = async (): Promise<void> => {
    // --- No Need to Resolve Services or Create Pino Logger ---
    // const loggingService = container.resolve(LoggingService); // Xóa resolve
    // const logger: Logger = loggingService.getLogger({ loader: 'Database' }); // Xóa logger

    const logContext = `[DatabaseLoader]`; // Chuỗi context cho log

    // <<< Use logToFile
    logToFile(`${logContext} Attempting database connection...`);

    try {
        await connectMongo(); // Gọi hàm kết nối từ config/database.ts

        // <<< Use logToFile
        logToFile(`${logContext} Database connection successful.`);
    } catch (error: any) { // Chỉ định loại lỗi là any
        const errorMessage = error instanceof Error ? error.message : String(error);
        // <<< Use logToFile
        logToFile(`[ERROR] ${logContext} Database connection failed. Error: "${errorMessage}", Stack: ${error.stack}`);
        // Ném lại lỗi để initLoaders có thể bắt và dừng khởi động server
        throw error;
    }
};