// src/loaders/express.loader.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { container } from 'tsyringe'; // For resolving ConfigService
import { ConfigService } from '../config/config.service';
import { requestLoggerMiddleware } from '../socket/middleware/requestLogger.middleware';
import apiRouter from '../api'; // Your main API router
import { errorHandlerMiddleware, notFoundHandler } from '../socket/middleware/errorHandler.middleware';


/**
 * Configures and returns the Express application instance.
 * This function sets up core middleware, routes, and error handlers for the Express app.
 *
 * @returns {Express} The fully configured Express application instance.
 */
export const loadExpress = (): Express => {
    // Resolve ConfigService to access application configurations, e.g., CORS origins.
    const configService = container.resolve(ConfigService);


    const app = express();

    // Configure CORS options based on `ConfigService`.
    const corsOptions = {
        origin: configService.corsAllowedOrigins,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        credentials: true,
        optionsSuccessStatus: 200
    };

    // --- Core Middleware Setup ---
    app.use(cors(corsOptions)); // Enable Cross-Origin Resource Sharing

    // Parse JSON payloads with an increased limit.
    app.use(express.json({ limit: '50mb' }));

    // Parse URL-encoded payloads with an increased limit.
    app.use(express.urlencoded({ limit: '50mb', extended: true }));

    // Parse text/plain and text/csv payloads.
    app.use(express.text({ type: ['text/plain', 'text/csv'] }));

    // Apply the request logger middleware.
    app.use(requestLoggerMiddleware);

    // --- Basic Root Route ---
    // A simple health check or welcome route.
    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Crawl, Chatbot, and Log Analysis Server is Running')
    });

    // --- API Routes ---
    // Mount the main API router under the '/api' path.
    // `apiRouter()` is expected to resolve its own dependencies internally via DI.
    app.use('/api', apiRouter());

    // --- Error Handling Middleware ---
    // `notFoundHandler` catches requests to undefined routes and forwards them to `errorHandlerMiddleware`.
    // Both are expected to handle their own logging.
    app.use(notFoundHandler);

    // `errorHandlerMiddleware` is the global error handler for all Express errors.
    app.use(errorHandlerMiddleware);
    return app;
};