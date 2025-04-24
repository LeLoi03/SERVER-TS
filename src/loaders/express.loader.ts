// src/loaders/express.loader.ts
import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { corsOptions } from '../config/cors';
import { requestLoggerMiddleware } from '../socket/middleware/logging.middleware';
import logToFile from '../utils/logger';
import apiRouter from '../api'; // <<< Đổi tên import để tránh trùng lặp
import { errorHandlerMiddleware, notFoundHandler } from '../socket/middleware/errorHandler.middleware';
import { LogAnalysisService } from '../services/logAnalysis.service'; // <<< Import service

// <<< Nhận service làm tham số
export const loadExpress = (logAnalysisService: LogAnalysisService): Express => {
    const app = express();

    // --- Core Middleware ---
    app.use(cors(corsOptions));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));
    app.use(requestLoggerMiddleware);

    // --- Basic Root Route ---
    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Crawl, Chatbot, and Log Analysis Server is Running');
    });

    // API Routes
    // <<< Truyền service vào router tổng
    app.use('/api', apiRouter(logAnalysisService));
    logToFile('[Express] Mounted API routes at /api');

    // --- Not Found Handler ---
    app.use(notFoundHandler);
    logToFile('[Express] Registered Not Found handler.');

    // --- Global Error Handler ---
    app.use(errorHandlerMiddleware);
    logToFile('[Express] Registered Global Error handler.');

    logToFile('[Express] Express app configured.');
    return app;
};