import mongoose from 'mongoose';
import { config } from './environment';
import logToFile from '../utils/logger';

export const connectDB = async (): Promise<void> => {
    try {
        logToFile('[Database] Attempting MongoDB connection...');
        await mongoose.connect(config.mongodbUri);
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