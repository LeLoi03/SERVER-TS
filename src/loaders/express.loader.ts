// src/loaders/express.loader.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { container } from 'tsyringe';
import { Logger } from 'pino'; // Import Logger type
import { ConfigService } from '../config/config.service';
import { LoggingService } from '../services/logging.service'; // <<< Import LoggingService
import { requestLoggerMiddleware } from '../socket/middleware/logging.middleware'; // Assuming this uses LoggingService internally or gets logger passed
// import logToFile from '../utils/logger'; // <<< XÓA
import apiRouter from '../api';
import { errorHandlerMiddleware, notFoundHandler } from '../socket/middleware/errorHandler.middleware'; // Assuming these use LoggingService internally or get logger passed

export const loadExpress = (): Express => {
    // <<< Resolve services cần thiết
    const loggingService = container.resolve(LoggingService);
    const configService = container.resolve(ConfigService);
    const logger: Logger = loggingService.getLogger({ loader: 'Express' }); // <<< Tạo child logger

    logger.info('Configuring Express app...'); // <<< Dùng logger

    const app = express();

    const corsOptions = {
        origin: configService.config.CORS_ALLOWED_ORIGINS,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        credentials: true,
        optionsSuccessStatus: 200
    };

    // --- Core Middleware ---
    app.use(cors(corsOptions));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(express.text({ type: ['text/plain', 'text/csv'] }));
    // Pass logger to middleware if it needs it, otherwise assume it resolves LoggingService itself
    app.use(requestLoggerMiddleware); // Example: Assuming it resolves LoggingService
    logger.info('Core middleware applied (CORS, JSON, URLencoded, Text, RequestLogger).'); // <<< Dùng logger

    // --- Basic Root Route ---
    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Crawl, Chatbot, and Log Analysis Server is Running');
    });

    // API Routes
    app.use('/api', apiRouter()); // apiRouter tự resolve dependencies
    logger.info('Mounted API routes at /api.'); // <<< Dùng logger

    // --- Not Found Handler ---
    // Assume notFoundHandler uses LoggingService internally or gets logger passed
    app.use(notFoundHandler);
    logger.info('Registered Not Found handler.'); // <<< Dùng logger

    // --- Global Error Handler ---
    // Assume errorHandlerMiddleware uses LoggingService internally or gets logger passed
    app.use(errorHandlerMiddleware);
    logger.info('Registered Global Error handler.'); // <<< Dùng logger

    logger.info('Express app configured successfully.'); // <<< Dùng logger
    return app;
};