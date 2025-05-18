// src/loaders/express.loader.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { container } from 'tsyringe';
import { ConfigService } from '../config/config.service';
import { requestLoggerMiddleware } from '../socket/middleware/logging.middleware'; // Assuming this uses LoggingService internally or gets logger passed
// import logToFile from '../utils/logger'; // <<< XÓA
import apiRouter from '../api';
import { errorHandlerMiddleware, notFoundHandler } from '../socket/middleware/errorHandler.middleware'; // Assuming these use LoggingService internally or get logger passed
import logToFile from '../utils/logger';

export const loadExpress = (): Express => {
    // <<< Resolve services cần thiết
    // LoggingService không cần resolve nữa
    const configService = container.resolve(ConfigService);
    // const logger: Logger = loggingService.getLogger({ loader: 'Express' }); // Xóa logger

    const logContext = `[ExpressLoader]`; // Chuỗi context cho log

    // <<< Use logToFile
    logToFile(`${logContext} Configuring Express app...`);

    const app = express();

    const corsOptions = {
        origin: configService.config.CORS_ALLOWED_ORIGINS,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        credentials: true,
        optionsSuccessStatus: 200
    };

    // --- Core Middleware ---
    app.use(cors(corsOptions));
    // app.use(express.json());
    // app.use(express.urlencoded({ extended: true }));

    // Tăng giới hạn cho JSON payloads
    app.use(express.json({ limit: '1mb' })); // Ví dụ: tăng lên 1mb

    // Tăng giới hạn cho URL-encoded payloads (nếu bạn cũng dùng)
    app.use(express.urlencoded({ limit: '1mb', extended: true }));
    app.use(express.text({ type: ['text/plain', 'text/csv'] }));
    // Middleware ghi log request đã được điều chỉnh để dùng logToFile
    app.use(requestLoggerMiddleware);
    // <<< Use logToFile
    logToFile(`${logContext} Core middleware applied (CORS, JSON, URLencoded, Text, RequestLogger).`);

    // --- Basic Root Route ---
    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Crawl, Chatbot, and Log Analysis Server is Running');
    });

    // API Routes
    app.use('/api', apiRouter()); // apiRouter tự resolve dependencies
    // <<< Use logToFile
    logToFile(`${logContext} Mounted API routes at /api.`);

    // --- Not Found Handler ---
    // notFoundHandler đã được điều chỉnh để chuyển lỗi đến errorHandlerMiddleware
    app.use(notFoundHandler);
    // <<< Use logToFile
    logToFile(`${logContext} Registered Not Found handler.`);

    // --- Global Error Handler ---
    // errorHandlerMiddleware đã được điều chỉnh để dùng logToFile
    app.use(errorHandlerMiddleware);
    // <<< Use logToFile
    logToFile(`${logContext} Registered Global Error handler.`);

    // <<< Use logToFile
    logToFile(`${logContext} Express app configured successfully.`);
    return app;
};