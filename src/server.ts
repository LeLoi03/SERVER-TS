import 'reflect-metadata'; // QUAN TRỌNG: Phải là import đầu tiên
import './container'; // Khởi tạo IoC container
import { container } from 'tsyringe';
import { initLoaders } from './loaders';
import { LoggingService } from './services/logging.service';
import { Logger } from 'pino';
import { ConfigService } from './config/config.service';
import http from 'http';
import mongoose from 'mongoose';

/**
 * Logger toàn cục của ứng dụng.
 * Được khởi tạo sau khi LoggingService sẵn sàng.
 */
let logger: Logger;

/**
 * Instance của LoggingService.
 * Cung cấp quyền truy cập vào các chức năng logging và đóng stream.
 */
let loggingService: LoggingService;

/**
 * Instance của ConfigService.
 * Cung cấp quyền truy cập vào tất cả cấu hình ứng dụng.
 */
let configService: ConfigService;

/**
 * Instance của HTTP server.
 * Cho phép tắt server một cách an toàn.
 */
let httpServer: http.Server;

/**
 * Cờ để ngăn chặn việc gọi shutdown nhiều lần.
 */
let isShuttingDown = false;

/**
 * Hàm chính để khởi động server ứng dụng.
 */
async function startServer(): Promise<void> {
    try {
        // --- 1. Khởi tạo các Service Cốt lõi (Config và Logging phải đi trước) ---
        configService = container.resolve(ConfigService);
        loggingService = container.resolve(LoggingService); // Gán vào biến toàn cục

        try {
            await loggingService.initialize();
            logger = loggingService.getLogger('app'); // Gán logger toàn cục ngay sau khi init
        } catch (error) {
            console.error("FATAL: Không thể khởi tạo logging service. Đang thoát.", error);
            process.exit(1);
        }

        // --- 2. Khởi tạo các ví dụ API từ ConfigService ---
        try {
            await configService.initializeExamples();
        } catch (exampleError: any) {
            const errorMessage = exampleError instanceof Error ? exampleError.message : String(exampleError);
            const errorStack = exampleError instanceof Error ? exampleError.stack : undefined;
            logger.error(`[Server Start] THẤT BẠI khi khởi tạo ví dụ API: ${errorMessage}`, { stack: errorStack });
            throw new Error(`Lỗi nghiêm trọng: Không thể tải các ví dụ API cần thiết. Server không thể tiếp tục.`);
        }

        // --- 3. Khởi tạo các Loaders (Database, Express, Socket.IO, Cron Jobs, etc.) ---
        const loaderResult = await initLoaders();
        httpServer = loaderResult.httpServer;

        // --- 4. Bắt đầu lắng nghe trên HTTP Server ---
        const port = configService.port;
        httpServer.listen(port, () => {
            const serverUrl = `http://localhost:${port}`;
            const allowedOrigins = configService.corsAllowedOrigins.join(', ');
            console.log(`🚀 Server sẵn sàng tại ${serverUrl}`);
        });

    } catch (error: any) {
        // Bắt các lỗi trong quá trình khởi động ban đầu.
        const currentLogger = logger || console;
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        currentLogger.fatal(`[Server Start] LỖI NGHIÊM TRỌNG trong quá trình khởi tạo ứng dụng: ${errorMessage}`, { stack: errorStack });

        if (!isShuttingDown) {
            await gracefulShutdown('Initialization Error', error);
        } else {
            process.exit(1);
        }
    }
}

/**
 * Bắt đầu quá trình tắt ứng dụng một cách an toàn.
 * @param {string} signal - Tín hiệu gây ra việc tắt (ví dụ: 'SIGINT', 'uncaughtException').
 * @param {Error | unknown} [error] - Lỗi (nếu có) gây ra việc tắt.
 */
async function gracefulShutdown(signal: string, error?: Error | unknown): Promise<void> {
    const reason = error ? `lỗi (${error instanceof Error ? error.message : String(error)})` : `tín hiệu (${signal})`;

    if (isShuttingDown) {
        logger?.warn(`[Shutdown] Đã ở trong quá trình tắt (gây ra bởi ${reason}). Bỏ qua trigger tiếp theo (${signal}).`);
        return;
    }
    isShuttingDown = true;

    let exitCode = error ? 1 : 0;
    const currentLogger = logger || console;
    currentLogger.info(`[Shutdown] Nhận được ${reason}. Bắt đầu quá trình tắt an toàn...`);

    const shutdownTimeoutMs = 15000;
    const shutdownTimeout = setTimeout(() => {
        currentLogger.error(`[Shutdown] Quá trình tắt an toàn vượt quá ${shutdownTimeoutMs}ms. Buộc thoát ứng dụng.`);
        loggingService?.flushLogsAndClose(); // Cố gắng flush lần cuối
        process.exit(1);
    }, shutdownTimeoutMs);

    try {
        // --- Bước 1: Đóng HTTP Server ---
        if (httpServer && httpServer.listening) {
            currentLogger.info('[Shutdown] Đang đóng HTTP server...');
            await new Promise<void>((resolve) => {
                httpServer.close((err) => {
                    if (err) {
                        currentLogger.error('[Shutdown] Lỗi khi đóng HTTP server:', err);
                    } else {
                        currentLogger.info('[Shutdown] HTTP server đã đóng thành công.');
                    }
                    resolve();
                });
            });
        } else {
            currentLogger.info('[Shutdown] HTTP server không hoạt động. Bỏ qua việc đóng.');
        }

        // --- Bước 2: Đóng kết nối Database (MongoDB) ---
        try {
            if (mongoose.connection && mongoose.connection.readyState === 1) {
                currentLogger.info('[Shutdown] Đang đóng kết nối MongoDB...');
                await mongoose.connection.close();
                currentLogger.info('[Shutdown] Kết nối MongoDB đã đóng thành công.');
            } else {
                currentLogger.info('[Shutdown] Kết nối MongoDB không hoạt động. Bỏ qua việc đóng.');
            }
        } catch (dbErr: any) {
            currentLogger.error('[Shutdown] Lỗi khi đóng kết nối MongoDB:', dbErr);
            exitCode = 1;
        }

        // --- Bước 3: Thêm các tác vụ dọn dẹp khác tại đây ---
        currentLogger.info('[Shutdown] Đang thực thi các tác vụ dọn dẹp bổ sung...');
        // await someOtherCleanupFunction();
        currentLogger.info('[Shutdown] Các tác vụ dọn dẹp bổ sung đã hoàn tất.');

    } catch (cleanupError: any) {
        currentLogger.error('[Shutdown] Lỗi không mong muốn trong quá trình dọn dẹp:', cleanupError);
        exitCode = 1;
    } finally {
        // --- Bước cuối: Flush logs và thoát tiến trình ---
        currentLogger.info('[Shutdown] Đang thực hiện flush log lần cuối...');
        if (loggingService) {
            await loggingService.flushLogsAndClose();
            // Không log sau dòng này vì stream đã đóng
            console.log('[Shutdown] Logs đã được flush và các transport đã đóng.');
        } else {
            console.error("[Shutdown] Logging service không khả dụng để flush lần cuối. Logs có thể không đầy đủ.");
        }

        clearTimeout(shutdownTimeout);
        console.log(`[Shutdown] Quá trình tắt an toàn đã hoàn tất. Thoát ứng dụng với mã ${exitCode}.`);

        // Thoát tiến trình Node.js.
        process.exit(exitCode);
    }
}

// --- Đăng ký các trình lắng nghe sự kiện để tắt an toàn ---
const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];

shutdownSignals.forEach((signal) => {
    process.on(signal, () => {
        logger?.info(`[Process Event] Nhận được tín hiệu: ${signal}`);
        gracefulShutdown(signal);
    });
});

/**
 * Xử lý các exception không được bắt.
 */
process.on('uncaughtException', (err: Error, origin: string) => {
    const currentLogger = logger || console;
    currentLogger.fatal({ err: { message: err.message, stack: err.stack, name: err.name }, origin }, 'Phát hiện Uncaught Exception. Bắt đầu tắt khẩn cấp.');
    if (!isShuttingDown) {
        gracefulShutdown('uncaughtException', err);
    } else {
        currentLogger.warn('[Shutdown] Uncaught exception xảy ra trong quá trình đang tắt. Buộc thoát ngay lập tức.');
        process.exit(1);
    }
});

/**
 * Xử lý các promise rejection không được xử lý.
 */
process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
    const currentLogger = logger || console;
    const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Lý do unhandled rejection không xác định'));
    currentLogger.fatal({ err: { message: error.message, stack: error.stack, name: error.name }, reason }, 'Phát hiện Unhandled Promise Rejection. Bắt đầu tắt khẩn cấp.');
    if (!isShuttingDown) {
        gracefulShutdown('unhandledRejection', error);
    } else {
        currentLogger.warn('[Shutdown] Unhandled rejection xảy ra trong quá trình đang tắt. Buộc thoát ngay lập tức.');
        process.exit(1);
    }
});

// --- Bắt đầu ứng dụng ---
startServer();