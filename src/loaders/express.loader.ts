// src/loaders/express.loader.ts
import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import { container } from 'tsyringe'; // For resolving ConfigService
import { ConfigService } from '../config/config.service';

// Import custom middleware and router, assuming they use `logToFile` or other logging mechanisms internally.
import { requestLoggerMiddleware } from '../socket/middleware/requestLogger.middleware';
import apiRouter from '../api'; // Your main API router
import { errorHandlerMiddleware, notFoundHandler } from '../socket/middleware/errorHandler.middleware';

// Import the custom logging utility for this loader.
import logToFile from '../utils/logger';

/**
 * Configures and returns the Express application instance.
 * This function sets up core middleware, routes, and error handlers for the Express app.
 * It logs its configuration steps using `logToFile`.
 *
 * @returns {Express} The fully configured Express application instance.
 */
export const loadExpress = (): Express => {
    // Resolve ConfigService to access application configurations, e.g., CORS origins.
    const configService = container.resolve(ConfigService);

    // Define a consistent context string for logs originating from this loader.
    const logContext = `[ExpressLoader]`;

    // logToFile(`${logContext} Starting Express application configuration...`);

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
    // logToFile(`${logContext} CORS middleware applied with origins: ${configService.config.CORS_ALLOWED_ORIGINS.join(', ')}.`);

    // Parse JSON payloads with an increased limit.
    app.use(express.json({ limit: '1mb' }));
    // logToFile(`${logContext} JSON body parser middleware applied (limit: 1mb).`);

    // Parse URL-encoded payloads with an increased limit.
    app.use(express.urlencoded({ limit: '1mb', extended: true }));
    // logToFile(`${logContext} URL-encoded body parser middleware applied (limit: 1mb).`);

    // Parse text/plain and text/csv payloads.
    app.use(express.text({ type: ['text/plain', 'text/csv'] }));
    // logToFile(`${logContext} Text/CSV body parser middleware applied.`);

    // Apply the request logger middleware.
    // This middleware is expected to handle its own logging internally using `logToFile` or similar.
    app.use(requestLoggerMiddleware);
    // logToFile(`${logContext} Request logging middleware applied.`);

    // --- Basic Root Route ---
    // A simple health check or welcome route.
    app.get('/', (req: Request, res: Response) => {
        res.status(200).send('Crawl, Chatbot, and Log Analysis Server is Running');
        logToFile(`${logContext} Root route (/) accessed.`); // Optional: Log each access to root
    });
    // logToFile(`${logContext} Basic root route (/) registered.`);

    // --- API Routes ---
    // Mount the main API router under the '/api' path.
    // `apiRouter()` is expected to resolve its own dependencies internally via DI.
    app.use('/api', apiRouter());
    // logToFile(`${logContext} API routes mounted at /api.`);

    // --- Error Handling Middleware ---
    // `notFoundHandler` catches requests to undefined routes and forwards them to `errorHandlerMiddleware`.
    // Both are expected to handle their own logging.
    app.use(notFoundHandler);
    // logToFile(`${logContext} Not Found (404) handler registered.`);

    // `errorHandlerMiddleware` is the global error handler for all Express errors.
    app.use(errorHandlerMiddleware);
    // logToFile(`${logContext} Global error handler registered.`);

    logToFile(`${logContext} Express app configured successfully.`);
    return app;
};