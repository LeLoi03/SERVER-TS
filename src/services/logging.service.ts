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

export type LoggerContext = { service?: string;[key: string]: any };
export type LoggerType = 'conference' | 'journal' | 'saveConferenceEvent' | 'saveJournalEvent';

@singleton()
export class LoggingService {
    private conferenceLogger!: Logger; // Sử dụng ! để báo TypeScript sẽ được khởi tạo trong constructor
    private journalLogger!: Logger;
    private saveConferenceEventLogger!: Logger;
    private saveJournalEventLogger!: Logger;

    private conferenceFileDestination: PinoFileDestination | null = null;
    private journalFileDestination: PinoFileDestination | null = null;
    private saveConferenceEventFileDestination: PinoFileDestination | null = null;
    private saveJournalEventFileDestination: PinoFileDestination | null = null;

    private readonly logLevel: LevelWithSilent;
    private readonly conferenceLogFilePath: string;
    private readonly journalLogFilePath: string;
    private readonly saveConferenceEventLogFilePath: string;
    private readonly saveJournalEventLogFilePath: string;

    private isShuttingDown = false;

    constructor(@inject(ConfigService) private configService: ConfigService) {
        console.log('[LoggingService:Constructor] Initializing loggers...');

        this.logLevel = this.configService.config.LOG_LEVEL;
        this.conferenceLogFilePath = this.configService.conferenceLogFilePath;
        this.journalLogFilePath = this.configService.journalLogFilePath; // Đảm bảo ConfigService có journalLogFilePath
        this.saveConferenceEventLogFilePath = this.configService.getSaveConferenceEventLogFilePath();
        this.saveJournalEventLogFilePath = this.configService.getSaveJournalEventLogFilePath();

        // --- Phase 1: Ensure Log Directories Exist and are Writable ---
        const conferenceLogDir = path.dirname(this.conferenceLogFilePath);
        const journalLogDir = path.dirname(this.journalLogFilePath);
        // Lấy thư mục từ đường dẫn file log save event
        const saveConferenceEventLogDir = path.dirname(this.saveConferenceEventLogFilePath);
        const saveJournalEventLogDir = path.dirname(this.saveJournalEventLogFilePath);

        this.ensureDirectory(conferenceLogDir, 'Conference Log');
        this.ensureDirectory(journalLogDir, 'Journal Log');
        this.ensureDirectory(saveConferenceEventLogDir, 'Save Conference Event Log'); // SỬA Ở ĐÂY
        this.ensureDirectory(saveJournalEventLogDir, 'Save Journal Event Log');       // SỬA Ở ĐÂY

        // --- Phase 2: Configure Pino Options and Streams ---
        const pinoOptions: LoggerOptions = {
            level: this.logLevel,
            timestamp: stdTimeFunctions.isoTime,
            formatters: { level: (label) => ({ level: label }) },
            base: undefined,
        };

        // --- Configure Conference Logger ---
        const conferencePinoStreams: pino.StreamEntry[] = this.getPinoStreams('conference', this.conferenceLogFilePath);
        this.conferenceLogger = this.createPinoInstance(pinoOptions, conferencePinoStreams, 'Conference', this.conferenceLogFilePath);

        // --- Configure Journal Logger ---
        const journalPinoStreams: pino.StreamEntry[] = this.getPinoStreams('journal', this.journalLogFilePath);
        this.journalLogger = this.createPinoInstance(pinoOptions, journalPinoStreams, 'Journal', this.journalLogFilePath);

        // --- Configure Save Conference Event Logger ---
        const saveConferenceEventPinoStreams: pino.StreamEntry[] = this.getPinoStreams('saveConferenceEvent', this.saveConferenceEventLogFilePath);
        this.saveConferenceEventLogger = this.createPinoInstance(pinoOptions, saveConferenceEventPinoStreams, 'SaveConferenceEvent', this.saveConferenceEventLogFilePath);

        // --- Configure Save Journal Event Logger ---
        const saveJournalEventPinoStreams: pino.StreamEntry[] = this.getPinoStreams('saveJournalEvent', this.saveJournalEventLogFilePath);
        this.saveJournalEventLogger = this.createPinoInstance(pinoOptions, saveJournalEventPinoStreams, 'SaveJournalEvent', this.saveJournalEventLogFilePath);
    }

    private ensureDirectory(dirPath: string, logType: string): void {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`[LoggingService:EnsureDir] ${logType} directory created: ${dirPath}`);
            }
            // Kiểm tra quyền ghi sau khi tạo (hoặc nếu đã tồn tại)
            fs.accessSync(dirPath, fs.constants.W_OK);
            console.log(`[LoggingService:EnsureDir] ${logType} directory is writable: ${dirPath}`);
        } catch (err: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:EnsureDir] CRITICAL: Error ensuring ${logType} directory "${dirPath}" exists or is writable: "${errorMessage}". Stack: ${errorStack}`);
            // Cân nhắc không exit(1) ở đây mà throw lỗi để service khởi tạo có thể bắt và xử lý
            // Hoặc log một lỗi nghiêm trọng và tiếp tục với console logging nếu có thể
            // process.exit(1); // Tạm thời comment để tránh dừng đột ngột khi dev
            throw new Error(`Failed to ensure directory for ${logType}: ${errorMessage}`);
        }
    }

    // Hàm helper để tránh lặp code khởi tạo pino
    private createPinoInstance(options: LoggerOptions, streams: pino.StreamEntry[], typeName: string, filePath: string): Logger {
        if (streams.length > 0) {
            const logger = pino(options, pino.multistream(streams));
            logger.info({ service: 'LoggingService', event: `${typeName.toLowerCase()}_logger_initialized_success`, path: filePath }, `${typeName} logger initialized.`);
            return logger;
        } else {
            console.error(`[LoggingService:CreatePino] CRITICAL: No valid streams for ${typeName} logger (Path: ${filePath}). Falling back to basic console logger.`);
            const fallbackLogger = pino({ level: this.logLevel || 'info', name: `${typeName}Fallback` });
            fallbackLogger.error({ service: 'LoggingService', event: `${typeName.toLowerCase()}_logger_fallback_active`, path: filePath }, `${typeName} logger fallback active due to no streams.`);
            return fallbackLogger;
        }
    }

    private getPinoStreams(loggerType: LoggerType, logFilePath: string): pino.StreamEntry[] {
        const streams: pino.StreamEntry[] = [];

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
            // Đảm bảo thư mục đã tồn tại trước khi tạo destination
            // ensureDirectory đã được gọi trong constructor cho các thư mục log chính
            const logDir = path.dirname(logFilePath);
            if (!fs.existsSync(logDir)) {
                 // Điều này không nên xảy ra nếu ensureDirectory hoạt động đúng
                console.warn(`[LoggingService:getPinoStreams] Log directory ${logDir} for ${loggerType} does not exist. Attempting to create.`);
                this.ensureDirectory(logDir, `${loggerType} Log (runtime check)`);
            }


            const fileDest = pino.destination({
                dest: logFilePath, sync: false, minLength: 1, mkdir: false, // mkdir: false vì ensureDirectory đã làm
            }) as unknown as PinoFileDestination;

            fileDest.on('error', (err: unknown) => {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
                console.error(`[LoggingService:FileDestination:${loggerType}] CRITICAL: Error in log file destination stream for ${logFilePath}: "${errorMessage}". Stack: ${errorStack}`);
            });

            streams.push({ level: this.logLevel as Level, stream: fileDest });

            if (loggerType === 'conference') {
                this.conferenceFileDestination = fileDest;
            } else if (loggerType === 'journal') {
                this.journalFileDestination = fileDest;
            } else if (loggerType === 'saveConferenceEvent') {
                this.saveConferenceEventFileDestination = fileDest;
            } else if (loggerType === 'saveJournalEvent') {
                this.saveJournalEventFileDestination = fileDest;
            }
            console.log(`[LoggingService:getPinoStreams] File logging configured for ${loggerType}. File: ${logFilePath}`);

        } catch (err: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:getPinoStreams] CRITICAL: Failed to create pino file destination for ${loggerType} at "${logFilePath}": "${errorMessage}". Stack: ${errorStack}`);
            // Gán null cho destination tương ứng nếu tạo thất bại
            if (loggerType === 'conference') this.conferenceFileDestination = null;
            else if (loggerType === 'journal') this.journalFileDestination = null;
            else if (loggerType === 'saveConferenceEvent') this.saveConferenceEventFileDestination = null;
            else if (loggerType === 'saveJournalEvent') this.saveJournalEventFileDestination = null;
        }
        return streams;
    }


    public flushLogsAndClose(): void {
        if (this.isShuttingDown) {
            console.log('[LoggingService:Flush] Flush already in progress or completed. Skipping.');
            return;
        }
        this.isShuttingDown = true;

        // Log sự kiện bắt đầu flush bằng một logger chắc chắn hoạt động (ví dụ: conferenceLogger hoặc console)
        const primaryLoggerForFlush = this.conferenceLogger || console;
        primaryLoggerForFlush.info({ service: 'LoggingService', event: 'log_flush_start_all' }, 'Initiating log flush for all loggers before application exit...');
        console.log('[LoggingService:Flush] Attempting to flush logs...');

        this.flushDestination(this.conferenceFileDestination, 'Conference Log', this.conferenceLogger);
        this.flushDestination(this.journalFileDestination, 'Journal Log', this.journalLogger);
        this.flushDestination(this.saveConferenceEventFileDestination, 'Save Conference Event Log', this.saveConferenceEventLogger);
        this.flushDestination(this.saveJournalEventFileDestination, 'Save Journal Event Log', this.saveJournalEventLogger);
    }

    private flushDestination(destination: PinoFileDestination | null, logTypeName: string, loggerInstance?: Logger): void {
        // Thêm kiểm tra loggerInstance tồn tại
        const effectiveLogger = loggerInstance || console; // Fallback về console nếu loggerInstance không có

        if (destination && typeof destination.flushSync === 'function') {
            try {
                destination.flushSync();
                console.log(`[LoggingService:Flush] ${logTypeName} logs flushed successfully.`);
                effectiveLogger.info({ service: 'LoggingService', event: `${logTypeName.toLowerCase().replace(/\s+/g, '_')}_log_flush_success` }, `${logTypeName} logs flushed to file successfully.`);
            } catch (flushErr: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(flushErr);
                console.error(`[LoggingService:Flush] CRITICAL: Error flushing ${logTypeName} logs to file: "${errorMessage}". Stack: ${errorStack}`);
                effectiveLogger.error({ service: 'LoggingService', event: `${logTypeName.toLowerCase().replace(/\s+/g, '_')}_log_flush_error`, err: { message: errorMessage, stack: errorStack } }, `Critical error during ${logTypeName} log flush.`);
            }
        } else {
            // console.log(`[LoggingService:Flush] No file destination to flush for ${logTypeName} or flushSync method not available.`);
            effectiveLogger.warn({ service: 'LoggingService', event: `${logTypeName.toLowerCase().replace(/\s+/g, '_')}_log_flush_skipped` }, `Skipped ${logTypeName} log flush: No file destination or flushSync missing.`);
        }
    }

    public getLogger(type: LoggerType = 'conference', context?: LoggerContext): Logger {
        let targetLogger: Logger | undefined; // Cho phép undefined ban đầu

        switch (type) {
            case 'journal':
                targetLogger = this.journalLogger;
                break;
            case 'saveJournalEvent':
                targetLogger = this.saveJournalEventLogger;
                break;
            case 'saveConferenceEvent':
                targetLogger = this.saveConferenceEventLogger;
                break;
            case 'conference':
            default:
                targetLogger = this.conferenceLogger;
                break;
        }

        if (!targetLogger) {
            const fallbackMsg = `[LoggingService:getLogger] Logger type '${type}' not fully initialized or available. Returning basic console logger. This is unexpected.`;
            console.error(fallbackMsg); // Log lỗi này nghiêm trọng hơn
            const fallbackPinoOptions: LoggerOptions = {
                level: this.logLevel || 'info',
                name: `FallbackLogger-${type}`,
                timestamp: stdTimeFunctions.isoTime,
            };
            const fallbackLogger = pino(fallbackPinoOptions);
            if (context) return fallbackLogger.child(context);
            return fallbackLogger;
        }

        return context ? targetLogger.child(context) : targetLogger;
    }

    public get conferenceLog(): Logger {
        return this.conferenceLogger;
    }
}