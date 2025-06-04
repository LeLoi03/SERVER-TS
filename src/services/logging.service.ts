// src/services/logging.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import pino, { Logger, LoggerOptions, LevelWithSilent, stdTimeFunctions, Level, StreamEntry, DestinationStream } from 'pino';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { getErrorMessageAndStack } from '../utils/errorUtils';
// pino-roll sẽ được require có điều kiện
// import pinoRoll, { PinoRollOptions, PinoRollStream, Frequency as PinoRollFrequency } from 'pino-roll'; // Gỡ bỏ import trực tiếp
import { Writable } from 'stream';
import { LogDescriptor } from 'pino';

export type LoggerContext = { service?: string; batchRequestId?: string;[key: string]: any };
export type LoggerType = 'app' | 'conference' | 'journal' | 'saveConferenceEvent' | 'saveJournalEvent';
export type RequestSpecificLoggerType = 'conference' | 'journal';
export type SharedLoggerType = 'app' | 'saveConferenceEvent' | 'saveJournalEvent';

interface RequestLoggerEntry {
    logger: Logger;
    stream: DestinationStream; // pino.destination() trả về DestinationStream
    filePath: string;
}

@singleton()
export class LoggingService {
    private appLoggerInternal!: Logger;
    private saveConferenceEventLoggerInternal!: Logger;
    private saveJournalEventLoggerInternal!: Logger;

    private requestLoggers: Map<string, RequestLoggerEntry> = new Map();
    private sharedPinoRollStreams: { [key in SharedLoggerType]?: any } = {}; // Kiểu 'any' cho pino-roll stream

    private readonly logLevel: LevelWithSilent;
    private readonly appLogFilePathForWriting: string;
    private readonly saveConferenceEventLogFilePathForWriting: string;
    private readonly saveJournalEventLogFilePathForWriting: string;
    private readonly appLoggerForInternalOps: Logger; // Logger riêng cho các hoạt động nội bộ của LoggingService

    private isShuttingDown = false;
    private isInitialized = false;

    constructor(@inject(ConfigService) private configService: ConfigService) {
        this.logLevel = this.configService.logLevel;

        this.appLogFilePathForWriting = this.configService.appLogFilePathForWriting;
        this.saveConferenceEventLogFilePathForWriting = this.configService.getSaveConferenceEventLogFilePath();
        this.saveJournalEventLogFilePathForWriting = this.configService.getSaveJournalEventLogFilePath();
        this.appLoggerForInternalOps = pino({ name: 'LoggingServiceInternal', level: this.logLevel });

        console.log('[LoggingService:Constructor] Service instantiated. Call initialize() to setup loggers.');
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) {
            console.warn('[LoggingService:Initialize] Loggers already initialized.');
            return;
        }
        console.log('[LoggingService:Initialize] Initializing loggers...');

        // Đảm bảo các thư mục log chính và thư mục con tồn tại
        this.ensureDirectory(this.configService.logsDirectory, 'Main Logs Directory');
        this.ensureDirectory(this.configService.appConfiguration.appLogDirectory, 'App Log Directory');
        this.ensureDirectory(this.configService.appConfiguration.conferenceRequestLogDirectory, 'Conference Request Logs Directory');
        this.ensureDirectory(this.configService.appConfiguration.journalRequestLogDirectory, 'Journal Request Logs Directory');
        this.ensureDirectory(this.configService.appConfiguration.saveConferenceEventLogDirectory, 'Save Conference Event Log Directory');
        this.ensureDirectory(this.configService.appConfiguration.saveJournalEventLogDirectory, 'Save Journal Event Log Directory');

        if (this.configService.logArchiveDirectoryPath &&
            !this.configService.logArchiveDirectoryPath.startsWith(this.configService.logsDirectory)) {
            this.ensureDirectory(this.configService.logArchiveDirectoryPath, 'Log Archive Directory (custom path)');
        }

        const pinoBaseOptions: LoggerOptions = {
            level: this.logLevel,
            timestamp: stdTimeFunctions.isoTime,
            formatters: { level: (label) => ({ level: label }) },
            base: undefined, // Không tự động thêm pid, hostname
        };

        try {
            this.appLoggerInternal = await this.createSharedLogger('app', this.appLogFilePathForWriting, pinoBaseOptions);
            this.saveConferenceEventLoggerInternal = await this.createSharedLogger('saveConferenceEvent', this.saveConferenceEventLogFilePathForWriting, pinoBaseOptions);
            this.saveJournalEventLoggerInternal = await this.createSharedLogger('saveJournalEvent', this.saveJournalEventLogFilePathForWriting, pinoBaseOptions);

            this.isInitialized = true;
            this.appLogger.info({ service: 'LoggingService' }, 'Shared loggers initialized.');
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            console.error(`[LoggingService:Initialize] CRITICAL: Failed to initialize shared loggers: ${message}. Stack: ${stack}.`, error);
            throw error; // Ném lỗi để báo hiệu khởi tạo thất bại
        }
    }

    private ensureDirectory(dirPath: string, logTypeDesc: string): void {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`[LoggingService:EnsureDir] ${logTypeDesc} directory created: ${dirPath}`);
            }
            fs.accessSync(dirPath, fs.constants.W_OK); // Kiểm tra quyền ghi
        } catch (err: unknown) {
            const { message: errorMessage } = getErrorMessageAndStack(err);
            const errorMsg = `CRITICAL: Error ensuring ${logTypeDesc} directory "${dirPath}" exists or is writable: "${errorMessage}". Logging to this path may fail.`;
            console.error(`[LoggingService:EnsureDir] ${errorMsg}`);
            throw new Error(errorMsg);
        }
    }

    private async createSharedLogger(
        loggerType: SharedLoggerType,
        logFilePath: string,
        basePinoOptions: LoggerOptions
    ): Promise<Logger> {
        const streams: StreamEntry[] = [];

        if (this.configService.logToConsole) {
            if (this.configService.nodeEnv !== 'production') {
                streams.push({
                    level: this.logLevel as Level,
                    stream: require('pino-pretty')({
                        colorize: true, levelFirst: true, translateTime: 'SYS:standard', ignore: 'pid,hostname,service',
                    }),
                });
            } else {
                streams.push({ level: this.logLevel as Level, stream: process.stdout });
            }
        }

        // Chỉ dùng pino-roll nếu có cấu hình xoay vòng
        // const useRotation = this.configService.logRotationFrequency && this.configService.logRotationSize;

        // if (useRotation) {
        //     try {
        //         const pinoRoll = require('pino-roll'); // require pino-roll ở đây
        //         const pinoRollFileOptions: any = { // Kiểu PinoRollOptions
        //             file: logFilePath,
        //             // frequency: this.configService.logRotationFrequency,
        //             // size: this.configService.logRotationSize,
        //             mkdir: true, // pino-roll tự tạo thư mục cha trực tiếp của file log
        //             // symlink: true, // Tạo current.log
        //         };
        //         if (this.configService.logRotationDateFormat) pinoRollFileOptions.dateFormat = this.configService.logRotationDateFormat;
        //         if (this.configService.logRotationLimitCount && this.configService.logRotationLimitCount > 0) {
        //             pinoRollFileOptions.limit = { count: this.configService.logRotationLimitCount };
        //         }

        //         const rollStream = await pinoRoll(pinoRollFileOptions);
        //         rollStream.on('error', (err: unknown) => {
        //             const { message: errMsg } = getErrorMessageAndStack(err);
        //             console.error(`[LoggingService:PinoRoll:${loggerType}] CRITICAL: Error in pino-roll stream for ${logFilePath}: "${errMsg}".`);
        //         });
        //         streams.push({ level: this.logLevel as Level, stream: rollStream });
        //         this.sharedPinoRollStreams[loggerType] = rollStream;
        //         console.log(`[LoggingService:CreateSharedLogger] File logging with pino-roll for ${loggerType}. File: ${logFilePath}.`);
        //     } catch (err) {
        //         const { message: errMsg, stack } = getErrorMessageAndStack(err);
        //         console.error(`[LoggingService:CreateSharedLogger] CRITICAL: Failed to create pino-roll stream for ${loggerType} at "${logFilePath}". Error: "${errMsg}". Stack: ${stack}. Falling back to simple file logging if possible.`, err);
        //         // Fallback to simple file logging if pino-roll fails
        //         try {
        //             const fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: false });
        //             streams.push({ level: this.logLevel as Level, stream: fileStream });
        //             console.warn(`[LoggingService:CreateSharedLogger] Fallback: Simple file logging for ${loggerType}. File: ${logFilePath}.`);
        //         } catch (fallbackErr) {
        //             const { message: fallbackMsg } = getErrorMessageAndStack(fallbackErr);
        //             console.error(`[LoggingService:CreateSharedLogger] CRITICAL: Fallback simple file stream also failed for ${loggerType} at "${logFilePath}". Error: "${fallbackMsg}".`, fallbackErr);
        //             // Nếu không có stream nào, pino sẽ log ra stdout theo mặc định nếu không có stream nào được cung cấp
        //         }
        //     }
        // } else {
        // Ghi file đơn giản nếu không có cấu hình xoay vòng
        try {
            const fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: false });
            streams.push({ level: this.logLevel as Level, stream: fileStream });
            console.log(`[LoggingService:CreateSharedLogger] Simple file logging for ${loggerType}. File: ${logFilePath}.`);
        } catch (err) {
            const { message: errMsg } = getErrorMessageAndStack(err);
            console.error(`[LoggingService:CreateSharedLogger] CRITICAL: Failed to create simple file stream for ${loggerType} at "${logFilePath}". Error: "${errMsg}".`, err);
        }
        // }

        if (streams.length > 0) {
            return pino(basePinoOptions, pino.multistream(streams));
        } else {
            console.warn(`[LoggingService:CreateSharedLogger] WARNING: No streams configured for ${loggerType} (not even console). Fallback to basic console pino.`);
            return pino({ ...basePinoOptions, name: `${loggerType}EmergencyFallback` });
        }
    }

    public getRequestSpecificLogger(
        type: RequestSpecificLoggerType,
        batchRequestId: string,
        baseContext?: LoggerContext
    ): Logger {
        this.checkInitialized(); // Kiểm tra service đã init chưa
        const loggerKey = `${type}-${batchRequestId}`;

        if (this.requestLoggers.has(loggerKey)) {
            const entry = this.requestLoggers.get(loggerKey)!;
            return baseContext ? entry.logger.child(baseContext) : entry.logger;
        }

        const logFilePath = this.configService.getRequestSpecificLogFilePath(type, batchRequestId);
        // Đảm bảo thư mục cha của file log này tồn tại (đã được làm trong initialize, nhưng kiểm tra lại không thừa)
        try {
            this.ensureDirectory(path.dirname(logFilePath), `${type} request log directory for ${batchRequestId}`);
        } catch (dirError) {
            // Nếu không tạo được thư mục, log ra console và trả về một logger khẩn cấp
            console.error(`[LoggingService:GetRequestLogger] Failed to ensure directory for ${loggerKey}. Error: ${getErrorMessageAndStack(dirError).message}. Using emergency console logger.`);
            const emergencyLogger = pino({ level: 'info', name: `Emergency-${loggerKey}` });
            return baseContext ? emergencyLogger.child(baseContext) : emergencyLogger;
        }


        const pinoOptions: LoggerOptions = {
            level: this.logLevel,
            timestamp: stdTimeFunctions.isoTime,
            formatters: { level: (label) => ({ level: label }) },
            base: { batchRequestId }, // Tự động thêm batchRequestId vào mỗi log entry
        };

        const streams: StreamEntry[] = [];
        if (this.configService.logToConsole) {
            if (this.configService.nodeEnv !== 'production') {
                streams.push({
                    level: this.logLevel as Level,
                    stream: require('pino-pretty')({
                        colorize: true,
                        levelFirst: true,
                        translateTime: 'SYS:standard',
                        ignore: 'pid,hostname,service', // 'service' sẽ được hiển thị qua messageFormat
                        messageFormat: (log: LogDescriptor, messageKey: string): string => {
                            // LogDescriptor là một kiểu từ pino, bao gồm các trường cơ bản
                            // Bạn có thể mở rộng nó nếu cần: interface MyLog extends LogDescriptor { myField: string; }
                            // Hoặc dùng Record<string, any> nếu không chắc chắn: (log: Record<string, any>, messageKey: string)
                            const { batchRequestId: bId, service, ...restOfLog } = log as any; // Ép kiểu nếu các trường này không có trong LogDescriptor chuẩn
                            const msg = (restOfLog as any)[messageKey] || ''; // Lấy message, fallback về chuỗi rỗng

                            const bIdDisplay = bId ? String(bId).slice(-6) : 'NO_ID';
                            const serviceDisplay = service ? ` (${service})` : '';

                            return `[${bIdDisplay}]${serviceDisplay} ${msg}`;
                        }
                    }),
                });
            } else {
                // Production: log JSON ra stdout
                streams.push({ level: this.logLevel as Level, stream: process.stdout });
            }
        }

        let fileStream: DestinationStream;
        try {
            fileStream = pino.destination({ dest: logFilePath, mkdir: true, sync: false }); // sync: false cho hiệu suất
            streams.push({ level: this.logLevel as Level, stream: fileStream });
        } catch (fileStreamError) {
            console.error(`[LoggingService:GetRequestLogger] CRITICAL: Failed to create file stream for ${loggerKey} at "${logFilePath}". Error: "${getErrorMessageAndStack(fileStreamError).message}". Request-specific file logging will be disabled for this request.`);
            // Nếu không tạo được file stream, logger sẽ chỉ log ra console (nếu được bật)
            // Hoặc sẽ là một logger không làm gì nếu console cũng tắt.
            // Cần đảm bảo `newLogger` vẫn được tạo.
            const emergencyLogger = pino({ level: 'info', name: `Emergency-${loggerKey}-NoFile` });
            return baseContext ? emergencyLogger.child(baseContext) : emergencyLogger;
        }


        const newLogger = streams.length > 0
            ? pino(pinoOptions, pino.multistream(streams))
            : pino({ ...pinoOptions, name: `${loggerKey}EmergencyFallbackNoStreams` }); // Logger khẩn cấp nếu không có stream nào

        this.requestLoggers.set(loggerKey, { logger: newLogger, stream: fileStream, filePath: logFilePath });
        console.log(`[LoggingService:GetRequestLogger] Created logger for ${loggerKey}. File: ${logFilePath}`);
        newLogger.info({ event: 'request_logger_created', logFilePath }, `Logger initialized for this request.`);

        return baseContext ? newLogger.child(baseContext) : newLogger;
    }

    public async closeRequestSpecificLogger(type: RequestSpecificLoggerType, batchRequestId: string): Promise<void> {
        const loggerKey = `${type}-${batchRequestId}`;
        const entry = this.requestLoggers.get(loggerKey);

        if (entry) {
            const { logger, stream, filePath } = entry; // logger ở đây là request logger sắp bị đóng

            // Log ý định đóng bằng logger của request (lần cuối nó được dùng)
            logger.info({ event: 'request_logger_closing_initiated', logFilePath: filePath }, `Initiating closure for request logger ${batchRequestId}.`);

            const writableStream = stream as unknown as Writable;

            return new Promise((resolve, reject) => {
                if (writableStream && typeof writableStream.end === 'function') {
                    let finished = false;
                    let errored = false;

                    const onFinish = () => {
                        if (!finished && !errored) {
                            finished = true;
                            this.requestLoggers.delete(loggerKey);
                            // Sử dụng appLoggerForInternalOps để log việc stream đã đóng
                            this.appLoggerForInternalOps.info({
                                event: 'request_logger_stream_closed',
                                loggerKey,
                                filePath
                            }, `Stream closed and logger removed for ${loggerKey}.`);
                            resolve();
                        }
                    };

                    const onError = (err: Error) => {
                        if (!finished && !errored) {
                            errored = true;
                            // Sử dụng appLoggerForInternalOps để log lỗi
                            this.appLoggerForInternalOps.error({
                                err,
                                event: 'request_logger_stream_close_error',
                                loggerKey,
                                filePath
                            }, `Error closing stream for ${loggerKey}.`);
                            this.requestLoggers.delete(loggerKey);
                            reject(err);
                        }
                    };

                    writableStream.on('finish', onFinish);
                    writableStream.on('error', onError);
                    writableStream.end();

                    setTimeout(() => {
                        if (!finished && !errored) {
                            // Sử dụng appLoggerForInternalOps
                            this.appLoggerForInternalOps.warn({
                                event: 'request_logger_stream_close_timeout',
                                loggerKey,
                                filePath
                            }, `Timeout waiting for 'finish' or 'error' event for ${loggerKey}. Assuming closed.`);
                            this.requestLoggers.delete(loggerKey);
                            resolve();
                        }
                    }, 3000);

                } else {
                    // Sử dụng appLoggerForInternalOps
                    this.appLoggerForInternalOps.warn({
                        event: 'request_logger_stream_not_closable',
                        loggerKey
                    }, `Stream for ${loggerKey} not found or not closable. Removing from map.`);
                    this.requestLoggers.delete(loggerKey);
                    resolve();
                }
            });
        }
        return Promise.resolve();
    }

    public flushLogsAndClose(): void {
        if (!this.isInitialized || this.isShuttingDown) {
            if (!this.isInitialized) console.warn('[LoggingService:Flush] Attempted to flush logs before initialization.');
            if (this.isShuttingDown) console.warn('[LoggingService:Flush] Attempted to flush logs while already shutting down.');
            return;
        }
        this.isShuttingDown = true;
        const currentAppLogger = this.appLoggerInternal || pino({ name: `EmergencyFlushLogger-${Date.now()}`, level: 'info' });
        currentAppLogger.info({ service: 'LoggingService', event: 'log_stream_close_start_all' }, 'Initiating stream close for all loggers before application exit...');

        const sharedStreamClosePromises = Object.entries(this.sharedPinoRollStreams).map(([type, stream]) => {
            if (stream && typeof stream.end === 'function') {
                currentAppLogger.info({ service: 'LoggingService', event: 'shared_stream_closing', loggerType: type }, `Closing shared stream for ${type}.`);
                return new Promise<void>((resolve, reject) => {
                    let resolved = false;
                    const timeoutId = setTimeout(() => {
                        if (!resolved) {
                            resolved = true;
                            currentAppLogger.warn({ service: 'LoggingService', event: 'shared_stream_close_timeout', loggerType: type }, `Timeout closing shared stream for ${type}.`);
                            reject(new Error(`Timeout closing shared stream for ${type}`));
                        }
                    }, 5000);

                    stream.once('close', () => {
                        if (!resolved) { resolved = true; clearTimeout(timeoutId); currentAppLogger.info({ service: 'LoggingService', event: 'shared_stream_closed', loggerType: type }, `Shared stream for ${type} closed.`); resolve(); }
                    });
                    stream.once('error', (err: any) => {
                        if (!resolved) { resolved = true; clearTimeout(timeoutId); currentAppLogger.error({ service: 'LoggingService', event: 'shared_stream_close_error', loggerType: type, error: getErrorMessageAndStack(err).message }, `Error closing shared stream for ${type}.`); reject(err); }
                    });
                    stream.end();
                });
            }
            return Promise.resolve();
        });

        const requestLoggerClosePromises = Array.from(this.requestLoggers.keys()).map(loggerKey => {
            const [type, batchRequestId] = loggerKey.split('-') as [RequestSpecificLoggerType, string];
            const entry = this.requestLoggers.get(loggerKey); // Lấy lại entry để đảm bảo nó vẫn còn
            if (entry) {
                currentAppLogger.info({ service: 'LoggingService', event: 'request_specific_logger_closing_on_shutdown', loggerKey, filePath: entry.filePath }, `Closing request-specific logger for ${loggerKey}.`);
                return this.closeRequestSpecificLogger(type, batchRequestId)
                    .catch(err => {
                        currentAppLogger.error({ service: 'LoggingService', event: 'request_specific_logger_close_on_shutdown_error', loggerKey, error: getErrorMessageAndStack(err).message }, `Error closing ${loggerKey} during shutdown.`);
                    });
            }
            return Promise.resolve();
        });


        Promise.allSettled([...sharedStreamClosePromises, ...requestLoggerClosePromises])
            .then((results) => {
                results.forEach((result, index) => {
                    if (result.status === 'rejected') {
                        currentAppLogger.error({ service: 'LoggingService', event: 'any_stream_close_settled_error', index, error: result.reason?.message || result.reason }, `A stream (index ${index}) failed to close properly during shutdown.`);
                    }
                });
                currentAppLogger.info({ service: 'LoggingService', event: 'all_streams_close_attempted' }, 'All stream close attempts finished during shutdown.');
            })
            .catch(err => {
                currentAppLogger.error({ service: 'LoggingService', event: 'error_processing_stream_close_promises', error: getErrorMessageAndStack(err) }, 'Unexpected error processing stream close promises.');
            })
            .finally(() => {
                this.isInitialized = false;
                this.sharedPinoRollStreams = {};
                this.requestLoggers.clear();
                console.log('[LoggingService:Flush] LoggingService shutdown complete.');
            });
    }

    private checkInitialized(loggerType?: LoggerType): void {
        if (!this.isInitialized && !this.isShuttingDown) { // Chỉ log lỗi nếu chưa init và không phải đang shutdown
            console.error(`[LoggingService:Error] Logger accessed before LoggingService.initialize() was completed. Type: ${loggerType || 'N/A'}. Fallback to emergency logger if possible.`);
        }
    }

    public getLogger(type: LoggerType = 'app', context?: LoggerContext): Logger {
        // Nếu service chưa init và không phải đang shutdown, log cảnh báo và trả về logger khẩn cấp
        if (!this.isInitialized && !this.isShuttingDown) {
            console.warn(`[LoggingService:getLogger] Attempting to get logger type '${type}' before initialization or after shutdown. Returning emergency logger.`);
            const emergencyLogger = pino({ level: 'info', name: `PreInitEmergencyLogger-${type}-${Date.now()}` });
            return context ? emergencyLogger.child(context) : emergencyLogger;
        }
        // Nếu đang shutdown, cũng trả về logger khẩn cấp
        if (this.isShuttingDown) {
            const shutdownEmergencyLogger = pino({ level: 'info', name: `ShutdownEmergencyLogger-${type}-${Date.now()}` });
            return context ? shutdownEmergencyLogger.child(context) : shutdownEmergencyLogger;
        }


        if (context?.batchRequestId && (type === 'conference' || type === 'journal')) {
            return this.getRequestSpecificLogger(type, context.batchRequestId, context);
        }

        let targetLogger: Logger | undefined;
        switch (type) {
            case 'saveConferenceEvent': targetLogger = this.saveConferenceEventLoggerInternal; break;
            case 'saveJournalEvent': targetLogger = this.saveJournalEventLoggerInternal; break;
            case 'app': default: targetLogger = this.appLoggerInternal; break;
        }

        if (!targetLogger) {
            const emergencyLogger = pino({ level: 'info', name: `EmergencyLogger-${type}-${Date.now()}` });
            console.error(`[LoggingService:getLogger] CRITICAL: Shared logger type '${type}' is unexpectedly undefined AFTER initialization. Using emergency logger.`);
            return context ? emergencyLogger.child(context) : emergencyLogger;
        }
        return context ? targetLogger.child(context) : targetLogger;
    }

    public get appLogger(): Logger {
        if (!this.isInitialized && !this.isShuttingDown) return pino({ name: `PreInitEmergencyAppLogger-${Date.now()}`, level: 'info' });
        if (this.isShuttingDown) return pino({ name: `ShutdownEmergencyAppLogger-${Date.now()}`, level: 'info' });
        return this.appLoggerInternal;
    }
    public get saveConferenceEvent(): Logger {
        if (!this.isInitialized && !this.isShuttingDown) return pino({ name: `PreInitEmergencySaveConfEvent-${Date.now()}`, level: 'info' });
        if (this.isShuttingDown) return pino({ name: `ShutdownEmergencySaveConfEvent-${Date.now()}`, level: 'info' });
        return this.saveConferenceEventLoggerInternal;
    }
    public get saveJournalEvent(): Logger {
        if (!this.isInitialized && !this.isShuttingDown) return pino({ name: `PreInitEmergencySaveJourEvent-${Date.now()}`, level: 'info' });
        if (this.isShuttingDown) return pino({ name: `ShutdownEmergencySaveJourEvent-${Date.now()}`, level: 'info' });
        return this.saveJournalEventLoggerInternal;
    }
}
