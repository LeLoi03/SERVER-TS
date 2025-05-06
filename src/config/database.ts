// src/config/database.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import mongoose from 'mongoose';
import logToFile from '../utils/logger';
import { ConfigService } from './config.service';


const LOG_PREFIX = "[MongoDBService]";


// --- Lấy ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Lấy cấu hình từ ConfigService ---
// Đảm bảo MONGODB_URI tồn tại trong config
const MONGODB_URI = configService.config.MONGODB_URI;
if (!MONGODB_URI) {
    logToFile(`${LOG_PREFIX} CRITICAL ERROR: MONGODB_URI is not configured.`);
    throw new Error("MONGODB_URI is not configured.");
}


export const connectDB = async (): Promise<void> => {
    try {
        logToFile('[Database] Attempting MongoDB connection...');
        await mongoose.connect(MONGODB_URI);
        logToFile('[Database] MongoDB Connected Successfully.');

        mongoose.connection.on('error', (err) => {
            logToFile(`[Database] MongoDB runtime error: ${err.message}`);
        });

        mongoose.connection.on('disconnected', () => {
            logToFile('[Database] MongoDB disconnected.');
        });

    } catch (error: any) {
        logToFile(`[Database] MongoDB Initial Connection Error: ${error.message}`);
        // Ném lỗi ra ngoài để loader xử lý hoặc thoát tiến trình
        throw error; // Re-throw để loader có thể bắt
    }
};