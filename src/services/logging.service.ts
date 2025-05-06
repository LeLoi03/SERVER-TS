// src/services/logging.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import pino, { Logger, LoggerOptions, LevelWithSilent, DestinationStream, stdTimeFunctions, Level } from 'pino'; // <<< Import Level
import fs from 'fs';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { Writable } from 'stream';

// --- Interface PinoFileDestination giữ nguyên ---
export interface PinoFileDestination extends Writable {
    flushSync(): void;
}

@singleton()
export class LoggingService {
    public readonly logger: Logger;
    private fileDestination: PinoFileDestination | null = null;
    private readonly logLevel: LevelWithSilent;
    private readonly logFilePath: string;
    private isShuttingDown = false;

    constructor(@inject(ConfigService) private configService: ConfigService) {
        console.log('[LoggingService] Initializing...');

        this.logLevel = this.configService.config.LOG_LEVEL;
        this.logFilePath = this.configService.appLogFilePath;
        const logDir = path.dirname(this.logFilePath);

        // --- Ensure Log Directory Exists ---
        try {
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
                console.log(`[LoggingService] Log directory created: ${logDir}`);
            }
            fs.accessSync(logDir, fs.constants.W_OK);
        } catch (err: any) {
            console.error(`[LoggingService] CRITICAL: Error ensuring log directory ${logDir} exists or is writable: ${err.message}`, err.stack);
            process.exit(1);
        }

        // --- Configure Pino ---
        const pinoOptions: LoggerOptions = {
            level: this.logLevel, // <<< Chính ở đây đã xử lý 'silent' cho toàn bộ logger
            timestamp: stdTimeFunctions.isoTime,
            formatters: { level: (label) => ({ level: label }) },
            base: undefined,
        };

        const pinoStreams: pino.StreamEntry[] = [];

        // Console transport
        if (this.configService.config.NODE_ENV !== 'production') {
             pinoStreams.push({
                 // <<< Cast to Level: Nếu logLevel là 'silent', main option đã chặn rồi
                 level: this.logLevel as Level,
                 stream: require('pino-pretty')({
                     colorize: true,
                     levelFirst: true,
                     translateTime: 'SYS:standard',
                     ignore: 'pid,hostname',
                 }),
             });
        } else {
             pinoStreams.push({
                 // <<< Cast to Level >>>
                 level: this.logLevel as Level,
                 stream: process.stdout,
             });
        }

        // File transport
        try {
            this.fileDestination = pino.destination({
                dest: this.logFilePath,
                sync: false,
                minLength: 4096,
                mkdir: false,
            }) as unknown as PinoFileDestination;

            this.fileDestination.on('error', (err) => {
                console.error('[LoggingService] CRITICAL: Error in log file destination stream:', err);
            });

            pinoStreams.push({
                 // <<< Cast to Level >>>
                 level: this.logLevel as Level,
                 stream: this.fileDestination,
             });

            console.log(`[LoggingService] File logging configured. Level: ${this.logLevel}. File: ${this.logFilePath}`);

        } catch (err: any) {
            console.error(`[LoggingService] CRITICAL: Failed to create pino file destination for ${this.logFilePath}: ${err.message}`, err.stack);
            this.fileDestination = null;
        }

        // Create the logger instance với streams
        // Chỉ tạo logger nếu có ít nhất một stream hợp lệ
        if (pinoStreams.length > 0) {
            this.logger = pino(pinoOptions, pino.multistream(pinoStreams, {}));
             // Log đầu tiên sử dụng logger đã tạo
             this.logger.info({ service: 'LoggingService' }, 'Logger initialized successfully.');
        } else {
            // Fallback nếu không có stream nào được cấu hình (ví dụ: lỗi tạo file)
            console.error('[LoggingService] CRITICAL: No logging streams configured. Using basic console logger.');
            // Tạo một logger tối thiểu chỉ ghi ra console để tránh lỗi ở các phần khác
            this.logger = pino({ level: 'info' }); // Hoặc level khác tùy nhu cầu fallback
            this.logger.error({ service: 'LoggingService' }, 'Failed to initialize primary logger streams. Falling back to basic console logging.');
        }
    }

    // --- flushLogsAndClose giữ nguyên ---
    public flushLogsAndClose(): void {
        if (this.isShuttingDown) {
            console.log('[LoggingService] Flush already in progress or completed.');
            return;
        }
        this.isShuttingDown = true;
        // Sử dụng logger để ghi log bắt đầu flush (nếu logger tồn tại)
        this.logger?.info({ service: 'LoggingService' }, 'Flushing logs before exit...');
        console.log('[LoggingService] Flushing logs...'); // Vẫn giữ console log

        if (this.fileDestination && typeof this.fileDestination.flushSync === 'function') {
            try {
                this.fileDestination.flushSync();
                console.log('[LoggingService] Logs flushed successfully.');
            } catch (flushErr: any) {
                console.error('[LoggingService] CRITICAL: Error flushing logs:', flushErr.message, flushErr.stack);
            }
        } else {
            console.log('[LoggingService] No file destination to flush or flushSync not available.');
        }
    }

    // --- getLogger giữ nguyên ---
    public getLogger(context?: object): Logger {
        // Thêm kiểm tra phòng trường hợp this.logger chưa kịp khởi tạo (dù ít khả năng)
        if (!this.logger) {
             console.warn('[LoggingService] Attempted to get logger before it was fully initialized. Returning basic logger.');
             return pino({ level: 'info' }); // Trả về logger cơ bản
        }
        return context ? this.logger.child(context) : this.logger;
    }
}