// src/config/environment.ts
import 'dotenv/config';
import logToFile from '../utils/logger'; // Hoặc logger chính
import path from 'path';
import { DATABASE_URL } from '../config';

// --- Validate and Export Environment Variables ---
const getEnvVar = (key: string, required: boolean = true): string => {
    const value = process.env[key];
    if (!value && required) {
        const errorMsg = `[Server Config] CRITICAL ERROR: Environment variable ${key} is not set!`;
        logToFile(errorMsg); // Log lỗi trước khi thoát
        console.error(errorMsg);
        process.exit(1);
    }
    return value || ''; // Return empty string if not required and not set
};

export const logFilePath = path.join(__dirname, '../../logs/app.log'); // !!! DOUBLE-CHECK THIS PATH !!!


export const config = {
    port: parseInt(getEnvVar('PORT', false) || '3001', 10),
    jwtSecret: getEnvVar('JWT_SECRET'),
    mongodbUri: getEnvVar('MONGODB_URI'),
    allowedOrigins: getEnvVar('CORS_ALLOWED_ORIGINS', false)?.split(',') || [`http://localhost:8386`, `https://confhub.ddns.net`],
    logFilePath,
    DATABASE_URL: getEnvVar('DATABASE_URL') || 'http://confhub.engineer/api/v1'
};




logToFile(`[Server Config] Loaded PORT: ${config.port}`);
logToFile(`[Server Config] Loaded MONGODB_URI: ${config.mongodbUri ? 'Set' : 'Not Set'}`); // Không log URI đầy đủ
logToFile(`[Server Config] Loaded JWT_SECRET: ${config.jwtSecret ? 'Set' : 'Not Set'}`); // Không log secret
logToFile(`[Server Config] Allowed CORS Origins: ${config.allowedOrigins.join(', ')}`);
logToFile(`[Server Config] Loaded LOG_FILE_PATH: ${config.logFilePath || 'Not Set (Using default)'}`);
