// src/loaders/socket.loader.ts
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { container } from 'tsyringe'; // Used for resolving ConfigService
import { ConfigService } from '../config/config.service';

// Import Socket.IO handlers and middleware, assuming they use `logToFile` internally.
import { handleConnection } from '../socket/handlers/connection.handlers';
import { socketAuthMiddleware } from '../socket/middleware/auth.middleware';

// Import the custom logging utility.
import logToFile from '../utils/logger';

/**
 * Global variable to store the Socket.IO server instance.
 * This allows other parts of the application to emit events without direct access to the `httpServer`.
 */
let ioInstance: SocketIOServer | null = null;

/**
 * Initializes and configures the Socket.IO server.
 * It attaches the Socket.IO server to the provided HTTP server, applies middleware,
 * and registers connection handlers. It logs its configuration steps using `logToFile`.
 *
 * @param {HttpServer} httpServer - The HTTP server instance to which Socket.IO will be attached.
 * @returns {SocketIOServer} The initialized Socket.IO server instance.
 */
export const initSocketIO = (httpServer: HttpServer): SocketIOServer => {
    // Resolve ConfigService to access application configurations, e.g., CORS origins for Socket.IO.
    const configService = container.resolve(ConfigService);

    // Define a consistent context string for logs originating from this loader.
    const logContext = `[SocketIOLoader]`;

    logToFile(`${logContext} Starting Socket.IO server initialization...`);

    // Create a new Socket.IO server instance.
    const io = new SocketIOServer(httpServer, {
        cors: {
            // Using '*' for origin is common for Socket.IO in development or for public APIs.
            // For production, it's safer to specify exact origins from `configService.config.CORS_ALLOWED_ORIGINS`.
            // Note: `configService.config.CORS_ALLOWED_ORIGINS` is usually for Express CORS.
            // For Socket.IO, `origin: *` might be desired, or you can dynamically set it.
            // Keeping `origin: "*"` as per your original code.
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        // Add other Socket.IO configuration options here as needed, e.g.:
        // pingTimeout: 60000, // Disconnect clients if no ping response for 60 seconds
        // pingInterval: 25000, // Send ping every 25 seconds
        // transports: ['websocket', 'polling'], // Prioritize WebSocket
    });
    logToFile(`${logContext} Socket.IO server instance created.`);

    // --- Apply Socket.IO Middleware ---
    // `socketAuthMiddleware` is expected to handle authentication and its own logging.
    io.use(socketAuthMiddleware);
    logToFile(`${logContext} Socket.IO authentication middleware applied.`);

    // --- Register Connection Handler ---
    // The `handleConnection` function is called for each new client connection.
    // It is expected to set up listeners for various events from that socket and handle its own logging.
    io.on('connection', (socket: Socket) => {
        logToFile(`${logContext} New Socket.IO connection received from ID: ${socket.id}.`);
        handleConnection(io, socket); // Pass both `io` and `socket` to the handler.
    });
    logToFile(`${logContext} Socket.IO 'connection' event handler registered.`);

    // Store the initialized Socket.IO instance for global access.
    ioInstance = io;
    logToFile(`${logContext} Socket.IO server initialized successfully and ready for connections.`);
    return io;
};

/**
 * Provides access to the globally initialized Socket.IO server instance.
 * This is used by other parts of the application to emit events to connected clients.
 *
 * @returns {SocketIOServer} The active Socket.IO server instance.
 * @throws {Error} If `getIO` is called before `initSocketIO` has been executed.
 */
export const getIO = (): SocketIOServer => {
    if (!ioInstance) {
        const errorMsg = "FATAL: Attempted to get Socket.IO instance before initialization. Ensure initSocketIO has been called.";
        // Log to file and console for critical errors before the main logger is fully ready or if it fails.
        logToFile(`[FATAL ERROR][getIO] ${errorMsg}`);
        console.error(`[FATAL ERROR][getIO] ${errorMsg}`); // Fallback to console
        throw new Error(errorMsg); // Re-throw to indicate a critical application setup error.
    }
    return ioInstance;
};