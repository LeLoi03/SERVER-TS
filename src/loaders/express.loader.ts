import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { corsOptions } from '../config/cors';
import { requestLoggerMiddleware } from '../socket/middleware/logging.middleware'; // Middleware log request
import logToFile from '../utils/logger';
import router from '../api';
import { errorHandlerMiddleware, notFoundHandler } from '../socket/middleware/errorHandler.middleware';

export const loadExpress = (): Express => {
    const app = express();

    // --- Core Middleware ---
    app.use(cors(corsOptions)); // Áp dụng CORS
    app.use(express.json()); // Parse JSON bodies
    app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

    // --- Logging Middleware ---
    app.use(requestLoggerMiddleware); // Sử dụng middleware log riêng

    // --- Basic Root Route ---
    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Crawl, Chatbot, and Log Analysis Server is Running');
    });

    // API Routes
    app.use('/api', router); // Router tổng API (chứa v1, v2,...)
    logToFile('[Express] Mounted API routes at /api');

    // --- Not Found Handler (sau các routes khác) ---
    app.use(notFoundHandler);
    logToFile('[Express] Registered Not Found handler.');

    // --- Global Error Handler (cuối cùng) ---
    app.use(errorHandlerMiddleware);
    logToFile('[Express] Registered Global Error handler.');


    logToFile('[Express] Express app configured.');
    return app;
};