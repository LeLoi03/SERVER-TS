// src/loaders/socket.loader.ts
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { ConfigService } from '../config/config.service';
import { LoggingService } from '../services/logging.service'; // <<< Import LoggingService
import { socketAuthMiddleware } from '../socket/middleware/auth.middleware'; // Assume this uses LoggingService or gets logger passed
import { handleConnection } from '../socket/handlers/connection.handlers';
// import logToFile from '../utils/logger'; // <<< XÓA

let ioInstance: SocketIOServer | null = null;

export const initSocketIO = (
    httpServer: HttpServer
): SocketIOServer => {
    // <<< Resolve services
    const loggingService = container.resolve(LoggingService);
    const configService = container.resolve(ConfigService);
    const logger: Logger = loggingService.getLogger({ loader: 'SocketIO' }); // <<< Tạo child logger

    logger.info('Initializing Socket.IO server...'); // <<< Dùng logger

    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: configService.config.CORS_ALLOWED_ORIGINS,
            methods: ["GET", "POST"],
            credentials: true
        },
        // ... other configs ...
    });

    // --- Middleware ---
    // Assume middleware resolves LoggingService internally or gets logger passed
    io.use(socketAuthMiddleware);
    logger.info('Socket.IO authentication middleware applied.'); // <<< Dùng logger

    // --- Connection Handler ---
    io.on('connection', (socket: Socket) => {
        // handleConnection tự resolve dependencies và logger bên trong nó
        handleConnection(io, socket);
    });
    logger.info('Socket.IO connection handler registered.'); // <<< Dùng logger

    ioInstance = io;
    logger.info('Socket.IO server initialized successfully.'); // <<< Dùng logger
    return io;
};

export const getIO = (): SocketIOServer => {
    if (!ioInstance) {
        const errorMsg = "FATAL: Attempted to get IO instance before initialization. Call initSocketIO first.";
        try {
            // Cố gắng resolve logger để ghi lỗi, nếu không được thì dùng console
            const loggingService = container.resolve(LoggingService);
            const logger = loggingService.getLogger({ function: 'getIO' });
            logger.fatal(errorMsg); // <<< Dùng logger nếu resolve thành công
        } catch (resolveError) {
            console.error(`[getIO - Pre-Log Init] ${errorMsg}`); // Fallback to console if logger fails
        }
        throw new Error(errorMsg); // Ném lỗi như cũ
    }
    return ioInstance;
};