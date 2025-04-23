import { connectDB as connectMongo } from '../config/database'; // Đổi tên để tránh trùng lặp
import logToFile from '../utils/logger';

export const connectDB = async (): Promise<void> => {

    logToFile('[Loader DB] Attempting database connection...');
    try {
        await connectMongo(); // Gọi hàm kết nối từ config

        logToFile('[Loader DB] Database connection successful.');
    } catch (error) {

        logToFile(`[Loader DB] Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
        // Ném lại lỗi để initLoaders có thể bắt và dừng khởi động server
        throw error;
    }
};