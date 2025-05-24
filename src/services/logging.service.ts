// src/services/logging.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import pino, { Logger, LoggerOptions, LevelWithSilent, stdTimeFunctions, Level } from 'pino';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { Writable } from 'stream';
import { getErrorMessageAndStack } from '../utils/errorUtils';

export interface PinoFileDestination extends Writable {
    flushSync(): void;
}

// Định nghĩa kiểu cho context của getLogger để rõ ràng hơn
export type LoggerContext = { service?: string;[key: string]: any };
export type LoggerType = 'main' | 'saveEvent'; // Thêm kiểu logger

@singleton()
export class LoggingService {
    private mainLogger: Logger; // Đổi tên từ logger thành mainLogger
    private saveEventLogger: Logger; // Logger mới cho save events

    private mainFileDestination: PinoFileDestination | null = null;
    private saveEventFileDestination: PinoFileDestination | null = null; // Destination cho save events

    private readonly logLevel: LevelWithSilent;
    private readonly mainLogFilePath: string; // Path cho log chính
    private readonly saveEventLogFilePath: string; // Path cho log save events

    private isShuttingDown = false;

    constructor(@inject(ConfigService) private configService: ConfigService) {
        console.log('[LoggingService:Constructor] Initializing loggers...');

        this.logLevel = this.configService.config.LOG_LEVEL;
        this.mainLogFilePath = this.configService.appLogFilePath; // Log chính từ config

        // Lấy đường dẫn cho save event log từ ConfigService hoặc đặt mặc định
        // Giả sử ConfigService có phương thức getSaveEventLogFilePath()
        // Hoặc bạn có thể hardcode/tính toán ở đây
        this.saveEventLogFilePath = this.configService.getSaveEventLogFilePath(); // BẠN CẦN THÊM PHƯƠNG THỨC NÀY VÀO ConfigService

        const mainLogDir = path.dirname(this.mainLogFilePath);
        const saveEventLogDir = path.dirname(this.saveEventLogFilePath);

        // --- Phase 1: Ensure Log Directories Exist and are Writable ---
        this.ensureDirectory(mainLogDir, 'Main Log');
        this.ensureDirectory(saveEventLogDir, 'Save Event Log');


        // --- Phase 2: Configure Pino Options and Streams ---
        const pinoOptions: LoggerOptions = {
            level: this.logLevel,
            timestamp: stdTimeFunctions.isoTime,
            formatters: { level: (label) => ({ level: label }) },
            base: undefined,
        };

        // --- Configure Main Logger ---
        const mainPinoStreams: pino.StreamEntry[] = this.getPinoStreams('main', this.mainLogFilePath);
        if (mainPinoStreams.length > 0) {
            this.mainLogger = pino(pinoOptions, pino.multistream(mainPinoStreams));
            this.mainLogger.info({ service: 'LoggingService', event: 'main_logger_initialized_success', path: this.mainLogFilePath }, 'Main logger initialized.');
        } else {
            console.error('[LoggingService:Constructor] CRITICAL: No valid streams for main logger. Falling back.');
            this.mainLogger = pino({ level: this.logLevel || 'info' });
            this.mainLogger.error({ service: 'LoggingService', event: 'main_logger_fallback_active' }, 'Main logger fallback active.');
        }

        // --- Configure Save Event Logger ---
        const saveEventPinoStreams: pino.StreamEntry[] = this.getPinoStreams('saveEvent', this.saveEventLogFilePath);
        if (saveEventPinoStreams.length > 0) {
            this.saveEventLogger = pino(pinoOptions, pino.multistream(saveEventPinoStreams));
            this.saveEventLogger.info({ service: 'LoggingService', event: 'save_event_logger_initialized_success', path: this.saveEventLogFilePath }, 'Save Event logger initialized.');
        } else {
            console.error('[LoggingService:Constructor] CRITICAL: No valid streams for save event logger. Falling back.');
            this.saveEventLogger = pino({ level: this.logLevel || 'info' }); // Dùng logger riêng, không child từ main
            this.saveEventLogger.error({ service: 'LoggingService', event: 'save_event_logger_fallback_active' }, 'Save Event logger fallback active.');
        }
    }

    private ensureDirectory(dirPath: string, logType: string): void {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`[LoggingService:EnsureDir] ${logType} directory created: ${dirPath}`);
            }
            fs.accessSync(dirPath, fs.constants.W_OK);
            console.log(`[LoggingService:EnsureDir] ${logType} directory is writable: ${dirPath}`);
        } catch (err: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:EnsureDir] CRITICAL: Error ensuring ${logType} directory "${dirPath}" exists or is writable: "${errorMessage}". Stack: ${errorStack}`);
            process.exit(1);
        }
    }

    private getPinoStreams(loggerType: LoggerType, logFilePath: string): pino.StreamEntry[] {
        const streams: pino.StreamEntry[] = [];

        // Console Transport
        if (this.configService.config.LOG_TO_CONSOLE) {
            if (this.configService.config.NODE_ENV !== 'production') {
                streams.push({
                    level: this.logLevel as Level,
                    stream: require('pino-pretty')({
                        colorize: true, levelFirst: true, translateTime: 'SYS:standard', ignore: 'pid,hostname',
                    }),
                });
            } else {
                streams.push({ level: this.logLevel as Level, stream: process.stdout });
            }
        }

        // File Transport
        try {
            const fileDest = pino.destination({
                dest: logFilePath, sync: false, minLength: 1, mkdir: false,
            }) as unknown as PinoFileDestination;

            fileDest.on('error', (err: unknown) => {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
                console.error(`[LoggingService:FileDestination:${loggerType}] CRITICAL: Error in log file destination stream for ${logFilePath}: "${errorMessage}". Stack: ${errorStack}`);
            });

            streams.push({ level: this.logLevel as Level, stream: fileDest });

            // Gán destination cho việc flush sau này
            if (loggerType === 'main') {
                this.mainFileDestination = fileDest;
            } else if (loggerType === 'saveEvent') {
                this.saveEventFileDestination = fileDest;
            }
            console.log(`[LoggingService:getPinoStreams] File logging configured for ${loggerType}. File: ${logFilePath}`);

        } catch (err: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:getPinoStreams] CRITICAL: Failed to create pino file destination for ${loggerType} at "${logFilePath}": "${errorMessage}". Stack: ${errorStack}`);
            if (loggerType === 'main') this.mainFileDestination = null;
            else if (loggerType === 'saveEvent') this.saveEventFileDestination = null;
        }
        return streams;
    }


    public flushLogsAndClose(): void {
        if (this.isShuttingDown) {
            console.log('[LoggingService:Flush] Flush already in progress or completed. Skipping.');
            return;
        }
        this.isShuttingDown = true;

        this.mainLogger?.info({ service: 'LoggingService', event: 'log_flush_start' }, 'Initiating log flush before application exit...');
        console.log('[LoggingService:Flush] Attempting to flush logs...');

        this.flushDestination(this.mainFileDestination, 'Main Log', this.mainLogger);
        this.flushDestination(this.saveEventFileDestination, 'Save Event Log', this.saveEventLogger); // Flush cả logger mới
    }

    private flushDestination(destination: PinoFileDestination | null, logTypeName: string, loggerInstance: Logger): void {
        if (destination && typeof destination.flushSync === 'function') {
            try {
                destination.flushSync();
                console.log(`[LoggingService:Flush] ${logTypeName} logs flushed successfully.`);
                loggerInstance?.info({ service: 'LoggingService', event: `${logTypeName.toLowerCase().replace(' ', '_')}_log_flush_success` }, `${logTypeName} logs flushed to file successfully.`);
            } catch (flushErr: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(flushErr);
                console.error(`[LoggingService:Flush] CRITICAL: Error flushing ${logTypeName} logs to file: "${errorMessage}". Stack: ${errorStack}`);
                loggerInstance?.error({ service: 'LoggingService', event: `${logTypeName.toLowerCase().replace(' ', '_')}_log_flush_error`, err: { message: errorMessage, stack: errorStack } }, `Critical error during ${logTypeName} log flush.`);
            }
        } else {
            console.log(`[LoggingService:Flush] No file destination to flush for ${logTypeName} or flushSync method not available.`);
            loggerInstance?.warn({ service: 'LoggingService', event: `${logTypeName.toLowerCase().replace(' ', '_')}_log_flush_skipped` }, `Skipped ${logTypeName} log flush: No file destination or flushSync missing.`);
        }
    }

    // Getter để truy cập mainLogger (tùy chọn)
    public get logger(): Logger {
        return this.mainLogger;
    }

    /**
     * Retrieves a specific Pino logger instance (main or saveEvent).
     * If a context object is provided, it returns a child logger with that context bound.
     * @param {LoggerType} [type='main'] - The type of logger to retrieve ('main' or 'saveEvent').
     * @param {LoggerContext} [context] - Optional: An object containing properties to bind to the logger.
     * @returns {Logger} A Pino logger instance.
     */
    public getLogger(type: LoggerType = 'main', context?: LoggerContext): Logger {
        let targetLogger: Logger;

        switch (type) {
            case 'saveEvent':
                targetLogger = this.saveEventLogger;
                break;
            case 'main':
            default:
                targetLogger = this.mainLogger;
                break;
        }

        if (!targetLogger) {
            // Fallback nếu logger chưa được khởi tạo (rất khó xảy ra)
            const fallbackMsg = `[LoggingService:getLogger] Logger type '${type}' not fully initialized. Returning basic console logger.`;
            console.warn(fallbackMsg);
            const fallbackLogger = pino({ level: this.logLevel || 'info' });
            if (context) return fallbackLogger.child(context);
            return fallbackLogger;
        }

        return context ? targetLogger.child(context) : targetLogger;
    }
}