// server.ts
import 'reflect-metadata'; // MUST be first
import { container } from 'tsyringe';
import { initLoaders } from './loaders';
import { LoggingService } from './services/logging.service';
import { Logger } from 'pino';
import { ConfigService } from './config/config.service';
import http from 'http';
import mongoose from 'mongoose';
import { GeminiApiService } from './services/geminiApi.service';

// --- Global Variables ---
let logger: Logger;
let loggingService: LoggingService;
let configService: ConfigService;
let httpServer: http.Server; // Store httpServer instance
let isShuttingDown = false; // Global shutdown flag

// --- Main Application Logic ---
async function startServer() {
    try {
        // --- 1. Initialize Core Services (Config & Logging first) ---
        configService = container.resolve(ConfigService); // Resolve config first
        loggingService = container.resolve(LoggingService); // Resolve logging
        logger = loggingService.logger; // Get the main logger instance AFTER logging service is ready

        logger.info('[Server Start] Core services (Config, Logging) resolved.');

        // --- 2. Initialize API Examples from ConfigService --- <<< THÊM BƯỚC NÀY
        logger.info('[Server Start] Initializing API examples...');
        try {
            await configService.initializeExamples(); // Gọi hàm load examples từ ConfigService
            logger.info('[Server Start] API examples initialized successfully.');
        } catch (exampleError: any) {
            // Log lỗi cụ thể của việc load example nhưng vẫn có thể tiếp tục hoặc thoát tùy yêu cầu
            logger.error(`[Server Start] FAILED to initialize API examples: ${exampleError.message}`, exampleError.stack);
            // Quyết định: Ném lỗi ra ngoài để dừng hoàn toàn, hay chỉ cảnh báo và tiếp tục?
            // Ví dụ: Ném lỗi để dừng nếu examples là bắt buộc
            throw new Error(`Failed to load critical API examples: ${exampleError.message}`);
            // Hoặc chỉ log và bỏ qua nếu không bắt buộc:
            // logger.warn('[Server Start] Continuing without API examples due to loading error.');
        }

        // --- 3. Initialize Loaders (DB, Express, Socket, Jobs, etc.) ---
        logger.info('[Server Start] Initializing loaders...');
        const loaderResult = await initLoaders(); // Loaders bây giờ có thể dùng ConfigService đã có examples
        httpServer = loaderResult.httpServer; // Get the httpServer instance from loaders
        logger.info('[Server Start] Loaders initialized.');

        // --- 4. Start Server ---
        const port = configService.config.PORT;
        httpServer.listen(port, () => {
            const serverUrl = `http://localhost:${port}`; // Or actual IP
            logger.info(`🚀 Server (HTTP + Socket.IO) listening on port ${port}`);
            logger.info(`🔗 Access the server at: ${serverUrl}`);
            const allowedOrigins = configService.config.CORS_ALLOWED_ORIGINS ?? [];
            logger.info(`🌐 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
            console.log(`🚀 Server ready at ${serverUrl}`); // Minimal console log
        });

    } catch (error: any) {
        // Logger có thể đã hoặc chưa được khởi tạo ở đây
        const log = logger || console; // Ưu tiên logger nếu đã có
        log.error(`[Server Start] FATAL ERROR during initialization: ${error.message}`, { stack: error.stack }); // Log cả stack nếu có thể
        // Đảm bảo thoát nếu có lỗi nghiêm trọng trong quá trình khởi tạo
        if (!isShuttingDown) { // Tránh gọi shutdown nếu đang trong quá trình shutdown rồi
             await gracefulShutdown('Initialization Error', error); // Cố gắng shutdown nhẹ nhàng nếu có thể
        } else {
             process.exit(1); // Thoát ngay lập tức nếu đang shutdown rồi mà vẫn lỗi
        }
    }
}

// --- Graceful Shutdown Logic ---
async function gracefulShutdown(signal: string, error?: Error | unknown) {
    const reason = error ? `error (${error instanceof Error ? error.message : String(error)})` : `signal (${signal})`;

    if (isShuttingDown) {
        logger?.warn(`[Shutdown] Already shutting down (triggered by ${reason}). Ignoring subsequent trigger (${signal}).`); // Thêm thông tin
        return;
    }
    isShuttingDown = true;
    let exitCode = error ? 1 : 0; // Correctly determine initial exit code

    // Dùng logger nếu có, không thì console
    const log = logger || console;
    log.info(`[Shutdown] Received ${reason}. Starting graceful shutdown...`);

    const shutdownTimeoutMs = 10000; // Lấy timeout từ config nếu có
    const shutdownTimeout = setTimeout(() => {
        log.warn(`[Shutdown] Graceful shutdown timeout exceeded (${shutdownTimeoutMs}ms). Forcing exit.`);
        loggingService?.flushLogsAndClose(); // Attempt last flush
        process.exit(1); // Force exit
    }, shutdownTimeoutMs);

    try {
        // 1. Close HTTP Server
        if (httpServer && httpServer.listening) { // Chỉ đóng nếu đang lắng nghe
             log.info('[Shutdown] Closing HTTP server...');
            await new Promise<void>((resolve, reject) => {
                httpServer.close((err) => {
                    if (err) {
                        log.error('[Shutdown] Error closing HTTP server:', err);
                        // Don't reject, allow other cleanup
                        resolve();
                    } else {
                        log.info('[Shutdown] HTTP server closed.');
                        resolve();
                    }
                });
            });
        } else {
             log.info('[Shutdown] HTTP server not listening or not initialized, skipping close.');
        }

        // 2. Close Database Connection
        try {
            if (mongoose.connection.readyState === 1) { // 1 === connected
                 log.info('[Shutdown] Closing MongoDB connection...');
                await mongoose.connection.close();
                log.info('[Shutdown] MongoDB connection closed.');
            } else {
                 log.info('[Shutdown] MongoDB connection not active, skipping close.');
            }
        } catch (dbErr: any) {
            log.error('[Shutdown] Error closing MongoDB connection:', dbErr);
            exitCode = 1; // Mark exit as failure on DB close error
        }

        // 3. Add any other cleanup tasks here (e.g., close Redis, stop queues)
        log.info('[Shutdown] Running other cleanup tasks...');
        // Ví dụ: await stopJobQueues();
        log.info('[Shutdown] Cleanup tasks completed.');

    } catch (cleanupError: any) {
        log.error('[Shutdown] Error during cleanup tasks:', cleanupError);
        exitCode = 1; // Mark exit as failure on cleanup error
    } finally {
        // 4. Flush Logs (Crucial step)
         log.info('[Shutdown] Flushing logs...');
        if (loggingService) {
            await loggingService.flushLogsAndClose(); // Make sure this is async or sync based on its implementation
             log.info('[Shutdown] Logs flushed.');
        } else {
             console.error("[Shutdown] Logging service not available for final flush."); // Dùng console nếu logger không có
        }

        // 5. Exit Process
        clearTimeout(shutdownTimeout); // Cancel the force exit timeout
        log.info(`[Shutdown] Graceful shutdown finished. Exiting with code ${exitCode}.`);

        // Delay nhỏ giúp log cuối cùng được ghi ra (đặc biệt với transport bất đồng bộ)
        await new Promise(resolve => setTimeout(resolve, 100)); // Chờ 100ms

        process.exit(exitCode);
    }
}

// --- Register Shutdown Hooks ---
const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
signals.forEach((signal) => {
    process.on(signal, () => gracefulShutdown(signal));
});

process.on('uncaughtException', (err: Error, origin: string) => {
    const log = logger || console;
    log.fatal({ err: { message: err.message, stack: err.stack, name: err.name }, origin }, 'Uncaught Exception');
    // Chỉ shutdown nếu chưa shutdown, tránh vòng lặp
    if (!isShuttingDown) {
         gracefulShutdown('uncaughtException', err);
    } else {
        log.warn('[Shutdown] Uncaught exception occurred during shutdown. Forcing exit.');
        process.exit(1); // Thoát ngay nếu đang shutdown mà gặp lỗi này
    }
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
    const log = logger || console;
    const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Unknown rejection reason'));
    log.fatal({ err: { message: error.message, stack: error.stack, name: error.name }, reason }, 'Unhandled Promise Rejection');
     if (!isShuttingDown) {
        gracefulShutdown('unhandledRejection', error);
    } else {
        log.warn('[Shutdown] Unhandled rejection occurred during shutdown. Forcing exit.');
        process.exit(1); // Thoát ngay
    }
});

// --- Start the application ---
startServer(); // Call the main async function