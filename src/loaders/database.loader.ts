// src/loaders/database.loader.ts
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../services/logging.service'; // <<< Import LoggingService
import { connectDB as connectMongo } from '../config/database'; // Đổi tên để tránh trùng lặp
// import logToFile from '../utils/logger'; // <<< XÓA

export const connectDB = async (): Promise<void> => {
    // <<< Resolve LoggingService
    const loggingService = container.resolve(LoggingService);
    const logger: Logger = loggingService.getLogger({ loader: 'Database' }); // <<< Tạo child logger

    logger.info('Attempting database connection...'); // <<< Dùng logger
    try {
        await connectMongo(); // Gọi hàm kết nối từ config/database.ts

        logger.info('Database connection successful.'); // <<< Dùng logger
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMessage, stack: error instanceof Error ? error.stack : undefined }, 'Database connection failed.'); // <<< Dùng logger
        // Ném lại lỗi để initLoaders có thể bắt và dừng khởi động server
        throw error;
    }
};