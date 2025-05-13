// src/loaders/socket.loader.ts
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { container } from 'tsyringe'; // Giữ container cho getIO fallback
// import { Logger } from 'pino'; // Xóa import Logger
import { ConfigService } from '../config/config.service';
// import { LoggingService } from '../services/logging.service'; // Xóa import LoggingService
import { handleConnection } from '../socket/handlers/connection.handlers'; // Giữ nguyên import
import { socketAuthMiddleware } from '../socket/middleware/auth.middleware';
import logToFile from '../utils/logger';

let ioInstance: SocketIOServer | null = null;

export const initSocketIO = (
    httpServer: HttpServer
): SocketIOServer => {
    // <<< Resolve services (Chỉ ConfigService còn cần)
    // LoggingService không cần resolve nữa
    const configService = container.resolve(ConfigService);
    // const logger: Logger = loggingService.getLogger({ loader: 'SocketIO' }); // Xóa logger

    const logContext = `[SocketIOLoader]`; // Chuỗi context cho log

    // <<< Use logToFile
    logToFile(`${logContext} Initializing Socket.IO server...`);

    const io = new SocketIOServer(httpServer, {
        cors: {
            origin: "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        // ... other configs ...
        // Bạn có thể thêm `pingTimeout`, `pingInterval`, etc. ở đây nếu cần
    });

    // --- Middleware ---
    // socketAuthMiddleware đã được điều chỉnh để dùng logToFile bên trong
    io.use(socketAuthMiddleware);
    // <<< Use logToFile
    logToFile(`${logContext} Socket.IO authentication middleware applied.`);

    // --- Connection Handler ---
    // handleConnection đã được điều chỉnh để dùng logToFile bên trong
    io.on('connection', (socket: Socket) => {
        handleConnection(io, socket); // Truyền io và socket
    });
    // <<< Use logToFile
    logToFile(`${logContext} Socket.IO connection handler registered.`);

    ioInstance = io;
    // <<< Use logToFile
    logToFile(`${logContext} Socket.IO server initialized successfully.`);
    return io;
};

export const getIO = (): SocketIOServer => {
    if (!ioInstance) {
        const errorMsg = "FATAL: Attempted to get IO instance before initialization. Call initSocketIO first.";
        // Thay vì cố gắng resolve logger, chỉ dùng logToFile và console.error fallback
        logToFile(`[FATAL ERROR][getIO] ${errorMsg}`);
        console.error(`[getIO - Pre-Log Init] ${errorMsg}`); // Fallback to console if logToFile somehow fails
        throw new Error(errorMsg); // Ném lỗi như cũ
    }
    return ioInstance;
};