import { CorsOptions } from 'cors';
import { config } from './environment';
import logToFile from '../utils/logger';

export const corsOptions: CorsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Cho phép yêu cầu không có origin (vd: mobile apps, curl) hoặc từ origin được phép
        if (!origin || config.allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            logToFile(`[CORS] Blocked origin: ${origin}`);
            callback(new Error(`Origin ${origin} not allowed by CORS`));
        }
    },
    // origin: "*", // Hoặc dùng "*" nếu muốn cho phép tất cả
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};