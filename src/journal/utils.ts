// src/journal/utils.ts

import fs from 'fs';
import path from 'path';
import { parse, Parser } from 'csv-parse'; // Use specific import if possible
import { CSVRecord } from './types'; // Assuming CSVRecord type definition
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe';
import pino, { Logger, LoggerOptions, stdTimeFunctions, LevelWithSilent } from 'pino';

import { JournalDetails } from './types'; // Assuming you have this interface defined
import { ConfigService } from '../config/config.service';
import { PinoFileDestination } from './types';




export interface RetryOptions {
    retries: number;
    minTimeout: number; // Corresponds to your 'delay'
    factor: number;     // Exponential backoff factor
    // Potentially other properties like maxTimeout, randomize, onRetry, etc.
}

// --- Resolve ConfigService via tsyringe ---
// Ensure this runs early enough for subsequent code needing config
let configService: ConfigService;
try {
    configService = container.resolve(ConfigService);
} catch (error) {
    console.error("CRITICAL ERROR: Failed to resolve ConfigService via tsyringe.", error);
    // Depending on the application structure, you might need a fallback or just exit
    process.exit(1);
}

// --- Get configuration values from ConfigService ---
// Use getters for resolved paths
const LOGS_DIRECTORY: string = configService.logsDirectory;
const APP_LOG_FILE_PATH: string = configService.journalLogFilePath;
// Get log level directly from the parsed config object
const LOG_LEVEL: LevelWithSilent = configService.config.LOG_LEVEL;

// --- Define a separate log file for journal-specific crawling (if needed) ---
// This seems independent of the main application log defined by APP_LOG_FILE_PATH
export const JOURNAL_CRAWL_LOG_FILE: string = path.join(__dirname, './data/crawl_journal.log');
// Ensure its directory exists too (optional, depending on requirements)
// const journalLogDir = path.dirname(JOURNAL_CRAWL_LOG_FILE);
// if (!fs.existsSync(journalLogDir)) {
//     fs.mkdirSync(journalLogDir, { recursive: true });
// }


// --- Simple logging function (for early use or specific files like crawl_journal.log) ---
// Note: This writes to JOURNAL_CRAWL_LOG_FILE, not APP_LOG_FILE_PATH
const LOG_PREFIX = `[${new Date().toISOString()}]`;
export function logToFile(message: string): void {
    try {
        fs.appendFileSync(JOURNAL_CRAWL_LOG_FILE, `${LOG_PREFIX} ${message}\n`);
    } catch (err) {
        // Fallback to console if file logging fails
        console.error(`${LOG_PREFIX} FAILED TO WRITE TO LOG FILE (${JOURNAL_CRAWL_LOG_FILE}): ${message}`, err);
    }
}

// --- Validate essential config paths retrieved ---
if (!LOGS_DIRECTORY) {
    // Use console.error as the main logger might not be ready/writable yet
    console.error(`${LOG_PREFIX} CRITICAL ERROR: Logs directory path could not be determined from ConfigService.`);
    // Optionally use logToFile for the journal log as a fallback record
    logToFile(`CRITICAL ERROR: Logs directory path could not be determined from ConfigService.`);
    throw new Error("Logs directory path is not configured or retrievable.");
}
if (!APP_LOG_FILE_PATH) {
    console.error(`${LOG_PREFIX} CRITICAL ERROR: Application log file path could not be determined from ConfigService.`);
    logToFile(`CRITICAL ERROR: Application log file path could not be determined from ConfigService.`);
    throw new Error("Application log file path is not configured or retrievable.");
}

// --- Ensure the main application log directory exists and is writable ---
// Use the resolved LOGS_DIRECTORY from ConfigService
console.log(`[DEBUG] Ensuring main log directory exists and is writable: ${LOGS_DIRECTORY}`);
try {
    // Check/create directory
    if (!fs.existsSync(LOGS_DIRECTORY)) {
        fs.mkdirSync(LOGS_DIRECTORY, { recursive: true });
        console.log(`[DEBUG] Main log directory created: ${LOGS_DIRECTORY}`);
    }
    // Check write access
    fs.accessSync(LOGS_DIRECTORY, fs.constants.W_OK);
    // console.log(`[DEBUG] Write access to directory ${LOGS_DIRECTORY} confirmed.`);
} catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Use console.error for critical startup issues
    console.error(`CRITICAL: Error checking/creating log directory or no write access: ${LOGS_DIRECTORY}. Error: ${errorMessage}`, err instanceof Error ? err.stack : '');
    // Optionally try logging to the separate journal log
    logToFile(`CRITICAL: Error checking/creating log directory or no write access: ${LOGS_DIRECTORY}. Error: ${errorMessage}`);
    process.exit(1); // Exit if main logging directory isn't usable
}
// --- Cấu hình Pino ---
// Định nghĩa kiểu cho levelLabels rõ ràng hơn
const levelLabels: { [key: number]: string } = {
    10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
};

// Sử dụng LoggerOptions để định kiểu cho cấu hình
const pinoConfig: LoggerOptions = {
    level: LOG_LEVEL, // Đã có kiểu AllowedLogLevel từ config
    // timestamp: () => `,"time":"${dayjs().tz(VIETNAM_TIMEZONE).format('YYYY-MM-DD')}"`,
    timestamp: stdTimeFunctions.isoTime, // Sử dụng hàm chuẩn của Pino
    formatters: {
        level: (label: string, number: number): { level: string } => ({
            level: levelLabels[number] || label
        }),
    },

    base: undefined, // Bỏ các trường mặc định như pid, hostname
};

// --- Khởi tạo Pino Logger ---
// Interface tối thiểu cho fallback logger để đảm bảo tính nhất quán
interface MinimalLogger {
    info: (...args: any[]) => void;
    warn: (...args: any[]) => void;
    error: (...args: any[]) => void;
    fatal: (...args: any[]) => void;
    debug: (...args: any[]) => void;
    trace: (...args: any[]) => void;
    child: (bindings: Record<string, any>) => MinimalLogger;
}

// Khai báo logger và destination stream với kiểu tùy chỉnh
export let logger: Logger | MinimalLogger; // Logger có thể là Pino Logger hoặc fallback
let fileDestination: PinoFileDestination | undefined = undefined; // Sử dụng interface tùy chỉnh

// Hàm tạo fallback logger
const createFallbackLogger = (): MinimalLogger => ({
    info: (...args: any[]) => console.info('[FALLBACK LOGGER]', ...args),
    warn: (...args: any[]) => console.warn('[FALLBACK LOGGER]', ...args),
    error: (...args: any[]) => console.error('[FALLBACK LOGGER]', ...args),
    fatal: (...args: any[]) => console.error('[FALLBACK LOGGER]', ...args),
    debug: (...args: any[]) => console.debug('[FALLBACK LOGGER]', ...args),
    trace: (...args: any[]) => console.trace('[FALLBACK LOGGER]', ...args),
    child: function () { return this; }, // Trả về chính nó để tránh lỗi khi gọi .child()
});


// console.log('[DEBUG] Initializing Pino logger with pino.destination...');
try {
    // Sử dụng Type Assertion hai bước (as unknown as PinoFileDestination)
    // để ép kiểu kết quả trả về từ pino.destination
    fileDestination = pino.destination({
        dest: APP_LOG_FILE_PATH, // Đường dẫn tuyệt đối
        sync: false, // false để có hiệu năng tốt hơn, flush khi thoát
        minLength: 4096, // Buffer size (bytes) before flushing (optional, default 4096)
        mkdir: false, // Đã tự tạo thư mục ở trên
    }) as unknown as PinoFileDestination; // <--- ÉP KIỂU QUA UNKNOWN ĐỂ FIX LỖI TS(2352)

    // Bắt sự kiện error trên stream - .on hợp lệ vì kế thừa Writable
    fileDestination.on('error', (err: Error) => {
        console.error('[PINO DESTINATION ERROR] Error writing to log file:', err);
        // Cân nhắc chuyển sang fallback logger nếu lỗi ghi file nghiêm trọng
        // if (!isShuttingDown) { // Tránh chuyển đổi logger trong quá trình shutdown
        //    console.warn('[PINO DESTINATION ERROR] Switching to fallback logger due to file write error.');
        //    logger = createFallbackLogger();
        // }
    });

    // Khởi tạo logger Pino thật sự, truyền vào destination đã được ép kiểu
    logger = pino(pinoConfig, fileDestination);

    // console.log('[DEBUG] Pino logger initialization successful (pino.destination).');
    // Sử dụng logger đã khởi tạo
    logger.fatal({ initCheck: true }, "LOGGER INITIALIZED (pino.destination). This should appear in the log file.");
    // console.log("[DEBUG] Called logger.fatal right after initialization.");

} catch (pinoInitError: unknown) {
    const errorMessage = pinoInitError instanceof Error ? pinoInitError.message : String(pinoInitError);
    console.error("[DEBUG] !!! CRITICAL Error during Pino logger initialization:", errorMessage, pinoInitError);

    // Tạo logger giả lập tuân thủ MinimalLogger interface
    logger = createFallbackLogger();
    console.warn("[DEBUG] Using fallback console logger due to initialization error.");
}

// --- Xử lý tín hiệu thoát ---
// Định nghĩa một kiểu union cho các tín hiệu hoặc lý do thoát
type ShutdownSignal = NodeJS.Signals | 'uncaughtException' | 'unhandledRejection';

let isShuttingDown = false; // Cờ để tránh gọi shutdown nhiều lần

const gracefulShutdown = (signal: ShutdownSignal, error?: Error | unknown): void => {
    if (isShuttingDown) {
        console.log(`[GRACEFUL SHUTDOWN] Already shutting down (${signal})... Ignoring subsequent call.`);
        return;
    }
    isShuttingDown = true; // Đánh dấu đang shutdown

    // Sử dụng logger hiện tại (Pino hoặc fallback)
    const logFn = logger;

    logFn.info(`Received ${signal}. Shutting down gracefully...`);

    let exitCode = 0;
    if (error) {
        // Ghi log lỗi chi tiết hơn nếu là Error object
        if (error instanceof Error) {
            logFn.error({ err: { message: error.message, stack: error.stack, name: error.name } }, `Error triggered shutdown (${signal})`);
        } else {
            logFn.error({ errorDetails: error }, `Non-Error triggered shutdown (${signal})`);
        }
        exitCode = 1; // Đặt mã thoát là 1 nếu có lỗi
    }

    // Quan trọng: Đảm bảo flushSync khi dùng pino.destination({ sync: false })
    // Kiểm tra sự tồn tại và phương thức flushSync (đã được đảm bảo bởi interface PinoFileDestination)
    if (fileDestination && typeof fileDestination.flushSync === 'function') {
        console.log('[GRACEFUL SHUTDOWN] Attempting to flush logs...');
        try {
            fileDestination.flushSync(); // Ghi đồng bộ phần log còn lại vào file
            console.log('[GRACEFUL SHUTDOWN] Logs flushed successfully.');
        } catch (flushErr: unknown) {
            const flushErrMsg = flushErr instanceof Error ? flushErr.message : String(flushErr);
            // Log lỗi flush bằng console vì logger có thể không ghi được nữa
            console.error('[GRACEFUL SHUTDOWN] CRITICAL: Error flushing logs:', flushErrMsg, flushErr);
            if (exitCode === 0) exitCode = 1; // Đặt mã lỗi nếu flush thất bại
        }
    } else if (fileDestination) {
        console.warn('[GRACEFUL SHUTDOWN] Log destination exists but flushSync is not available? (Type issue or sync=true?)');
    } else {
        console.log('[GRACEFUL SHUTDOWN] No file destination to flush (using fallback logger or sync=true).');
    }

    // Đóng stream nếu cần (thường không bắt buộc sau flushSync, nhưng có thể giúp giải phóng tài nguyên ngay lập tức)
    // Lưu ý: destroy() có thể không tồn tại trên mọi phiên bản/cấu hình
    // if (fileDestination && typeof (fileDestination as any).destroy === 'function') {
    //     try {
    //        (fileDestination as any).destroy();
    //        console.log('[GRACEFUL SHUTDOWN] Log destination stream destroyed.');
    //     } catch (destroyErr) {
    //        console.error('[GRACEFUL SHUTDOWN] Error destroying log stream:', destroyErr);
    //     }
    // }

    console.log(`[GRACEFUL SHUTDOWN] Exiting process with code ${exitCode}.`);
    // Delay nhỏ để đảm bảo các I/O cuối cùng (như console.log) có cơ hội hoàn thành
    // Đặc biệt quan trọng nếu có log async nào đó đang chạy
    setTimeout(() => {
        process.exit(exitCode);
    }, 100); // Chờ 100ms trước khi thoát
};

// Gắn các trình xử lý tín hiệu
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Lỗi chưa bắt được
process.on('uncaughtException', (err: Error, origin: string) => {
    // Log lỗi này bằng console vì logger có thể không ổn định
    console.error(`[FATAL] Uncaught Exception at: ${origin}`, err);
    // Gọi gracefulShutdown với lỗi, chỉ gọi nếu chưa shutdown
    if (!isShuttingDown) {
        gracefulShutdown('uncaughtException', err);
    } else {
        console.error('[FATAL] Uncaught exception occurred during shutdown process.');
        // Có thể cần thoát ngay lập tức nếu lỗi xảy ra trong quá trình shutdown
        process.exit(1);
    }
});

// Promise rejection chưa được xử lý
process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
    // Log lỗi này bằng console
    console.error('[FATAL] Unhandled Promise Rejection:', reason);
    // Cố gắng chuyển reason thành Error object
    const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Unknown rejection reason'));
    // Log thêm chi tiết promise nếu có thể (tuỳ chọn)
    // console.error('Unhandled Promise:', promise);
    // Gọi gracefulShutdown với lỗi, chỉ gọi nếu chưa shutdown
    if (!isShuttingDown) {
        gracefulShutdown('unhandledRejection', error);
    } else {
        console.error('[FATAL] Unhandled promise rejection occurred during shutdown process.');
        // Có thể cần thoát ngay lập tức
        process.exit(1);
    }
});



// 1. traverseNodes: Giữ nguyên, đã khá tốt.
export const traverseNodes = (node: Node | null): string => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent?.trim() || '';
    } else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
        return Array.from(node.childNodes).map(traverseNodes).join(' ').trim();
    }
    return '';
};

// 2. createURLList: Giữ nguyên, đã khá tốt.
export const createURLList = (baseURL: string, lastPageNumber: number): string[] => {
    return Array.from({ length: lastPageNumber }, (_, i) => `${baseURL}&page=${i + 1}`);
};

// 3. formatISSN: Giữ nguyên, logic đã được cải thiện.
export const formatISSN = (issn: string): string | null => {
    if (!issn) {
        return null;
    }
    const issnValues = issn.split(',').map(item => item.trim());
    const issnToSearch = (issnValues[1] || issnValues[0] || '').replace(/-/g, '');
    const issnRegex = /^(\d{4})(\d{3}[\dX])$/i;
    const match = issnToSearch.match(issnRegex);
    if (match) {
        return `${match[1]}-${match[2]}`;
    }
    return null;
};




// 4. retryAsync:
//    - Đã có logging cơ bản.
//    - Đảm bảo logger được truyền vào và sử dụng đúng cách.
//    - Event names đã có (`retry_max_attempts_reached`, `retry_attempt_failed`) là tốt.
export const retryAsync = async <T>(
    fn: (attempt: number) => Promise<T>,
    options: RetryOptions,
    logger: Logger | MinimalLogger // Đảm bảo logger được truyền vào
): Promise<T> => {
    const { retries, minTimeout, factor } = options;
    let lastError: any = null;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn(attempt);
        } catch (error: any) {
            lastError = error;
            const isLastAttempt = attempt >= retries;
            const timeout = Math.round(minTimeout * Math.pow(factor, attempt - 1));

            // Chuẩn bị context log
            const logContext = {
                event: isLastAttempt ? 'retry_max_attempts_reached' : 'retry_attempt_failed',
                attempt,
                maxRetries: retries,
                err: { // Log chi tiết lỗi
                    message: error.message,
                    name: error.name,
                    stack: error.stack?.substring(0, 500), // Giới hạn stack trace
                    ...(error.response && { responseStatus: error.response.status, responseData: error.response.data }), // Nếu là lỗi HTTP
                    ...(error.code && { code: error.code }), // Mã lỗi (vd: ECONNREFUSED)
                },
                ...(isLastAttempt ? {} : { delayMs: timeout }), // Chỉ log delayMs nếu không phải lần cuối
            };

            if (isLastAttempt) {
                logger.error(logContext, `Function failed after maximum ${retries} attempts. Throwing last error.`);
                throw lastError;
            } else {
                logger.warn(logContext, `Attempt ${attempt}/${retries} failed. Retrying in ${timeout}ms...`);
                await new Promise((resolve) => setTimeout(resolve, timeout));
            }
        }
    }
    // Fallback, không nên xảy ra nếu retries >= 1
    logger.error({ event: 'retry_logic_error', err: lastError }, "Retry loop completed without success or throwing an error (unexpected).");
    throw lastError || new Error("Retry failed after multiple attempts, but no specific error was captured.");
};



/**
 * Pre-processes a CSV string to correctly escape double quotes within quoted fields.
 * Assumes semicolon delimiter and standard quoting rules, but fixes cases
 * where inner quotes are not properly doubled (e.g., "a"b" -> "a""b""").
 * Also refines the logic for detecting the start of a quoted field.
 *
 * @param {string} csvString The raw CSV string.
 * @param {string} delimiter The delimiter character (default: ';').
 * @returns {string} The processed CSV string with inner quotes properly escaped.
 */
const escapeQuotesInQuotedFields = (csvString: string, delimiter = ';', logger?: Logger | MinimalLogger) => {
    let result = '';
    let inQuotes = false;
    const len = csvString.length;

    for (let i = 0; i < len; i++) {
        const char = csvString[i];
        const nextChar = i < len - 1 ? csvString[i + 1] : null;
        const prevChar = i > 0 ? csvString[i - 1] : null; // Get previous character from original string

        if (!inQuotes) {
            // --- Outside of a quoted field ---
            result += char;
            // Check if this character starts a quoted field
            if (char === '"') {
                // A quote starts a field if it's at the beginning of the string OR follows a delimiter or newline
                if (i === 0 || prevChar === delimiter || prevChar === '\n' || prevChar === '\r') {
                    inQuotes = true;
                }
                // Else: It's a quote within an unquoted field, treat it literally (already added to result)
            }
        } else {
            // --- Inside a quoted field ---
            if (char === '"') {
                if (nextChar === '"') {
                    // This is a correctly escaped quote ("")
                    result += '""';
                    i++; // Skip the next quote as we've already processed it
                } else if (nextChar === delimiter || nextChar === '\n' || nextChar === '\r' || nextChar === null || i === len - 1) {
                    // This is the closing quote of the field
                    result += '"';
                    inQuotes = false;
                } else {
                    // This is an unescaped quote *inside* the field. Escape it.
                    result += '""'; // Add the escaped version
                }
            } else {
                // Any other character inside the quotes
                result += char;
            }
        }
    }

    // Optional: Check for unterminated quotes
    if (inQuotes) {
        logger?.warn("[escapeQuotesInQuotedFields] Warning: CSV string potentially ended with an unterminated quoted field.");
        // Consider adding a closing quote if recovery is desired, though this might hide data issues.
        // result += '"';
    }

    return result;
};



/**
 * Parses CSV content provided as a string.
 * Handles semicolon delimiters and standard CSV parsing options.
 * Includes pre-processing to fix unescaped double quotes within quoted fields.
 * @param csvContent The raw CSV content as a string.
 * @param parentLogger Optional logger instance to use.
 * @returns A promise resolving to an array of parsed CSV records (objects).
 * @throws Error if parsing fails.
 */
export const parseCSVString = async (
    csvContent: string,
    parentLogger: Logger | MinimalLogger // Yêu cầu logger
): Promise<CSVRecord[]> => {
    // Tạo child logger với context batchRequestId nếu có từ parentLogger
    // Điều này quan trọng để các log từ đây được nhóm đúng.
    // Nếu parentLogger không có batchRequestId, nó sẽ không được thêm.
    const csvLogger = parentLogger.child({
        service: 'parseCSVStringUtil', // Đặt tên service cụ thể cho utility này
        // batchRequestId: (parentLogger as any).bindings?.()?.batchRequestId // Cách lấy batchRequestId nếu có
    });

    // Log event cho log analysis
    csvLogger.info({
        event: 'parse_csv_string_start', // EVENT CHO LOG ANALYSIS
        inputLength: csvContent.length,
        // batchRequestId: (csvLogger as any).bindings?.()?.batchRequestId // Đảm bảo batchRequestId được log
    }, `Attempting to parse CSV string content.`);

    let processedCsvContent: string;
    try {
        // csvLogger.debug({ event: 'csv_preprocess_start' }, `Starting pre-processing to escape inner quotes.`);
        processedCsvContent = escapeQuotesInQuotedFields(csvContent, ';', csvLogger); // Truyền logger vào escapeQuotes
        // csvLogger.debug({ event: 'csv_preprocess_success', outputLength: processedCsvContent.length }, `Finished pre-processing.`);
    } catch (preProcessError: any) {
        csvLogger.error({
            event: 'parse_csv_string_failed', // EVENT CHO LOG ANALYSIS
            stage: 'preprocessing',
            err: { message: preProcessError.message, stack: preProcessError.stack?.substring(0, 500) },
            // batchRequestId: (csvLogger as any).bindings?.()?.batchRequestId
        }, `Error during CSV pre-processing.`);
        throw new Error(`Failed during CSV pre-processing: ${preProcessError.message}`);
    }

    return new Promise((resolve, reject) => {
        const records: CSVRecord[] = [];
        const parser: Parser = parse(processedCsvContent, {
            columns: true,
            skip_empty_lines: true,
            delimiter: ';',
            trim: true,
        });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
            }
        });

        parser.on('error', (err) => {
            csvLogger.error({
                event: 'parse_csv_string_failed', // EVENT CHO LOG ANALYSIS
                stage: 'parsing',
                err: { message: err.message, stack: err.stack?.substring(0, 500) },
                // batchRequestId: (csvLogger as any).bindings?.()?.batchRequestId
            }, `Error parsing pre-processed CSV string.`);
            reject(new Error(`Failed to parse CSV string (after pre-processing): ${err.message}`));
        });

        parser.on('end', () => {
            csvLogger.info({
                event: 'parse_csv_string_success', // EVENT CHO LOG ANALYSIS
                recordCount: records.length,
                // batchRequestId: (csvLogger as any).bindings?.()?.batchRequestId
            }, `Successfully parsed ${records.length} records from CSV string.`);
            resolve(records);
        });
    });
};

/**
 * Reads a CSV file and parses its content using parseCSVString.
 * Handles semicolon delimiters.
 * @param filePath Path to the CSV file.
 * @param parentLogger Optional logger instance to use.
 * @returns A promise resolving to an array of parsed CSV records (objects). Returns empty array on file read error.
 */
export const readCSV = async (
    filePath: string,
    parentLogger: Logger | MinimalLogger // Yêu cầu logger
): Promise<CSVRecord[]> => {
    const fileReadLogger = parentLogger.child({
        service: 'readCSVUtil',
        filePath
        // batchRequestId: (parentLogger as any).bindings?.()?.batchRequestId
    });

    fileReadLogger.info({
        event: 'read_csv_file_start', // EVENT CHO LOG ANALYSIS
        // batchRequestId: (fileReadLogger as any).bindings?.()?.batchRequestId
    }, `Attempting to read CSV file.`);

    try {
        const fileContent = await fs.promises.readFile(filePath, { encoding: 'utf8' });
        // fileReadLogger.debug({ event: 'csv_file_read_raw_success', fileSize: fileContent.length }, `Successfully read file content.`);

        // Gọi parseCSVString, nó sẽ log các event parse_csv_string_*
        const records = await parseCSVString(fileContent, fileReadLogger);

        fileReadLogger.info({
            event: 'read_csv_file_success', // EVENT CHO LOG ANALYSIS (bao gồm cả parse thành công)
            recordCount: records.length,
            // batchRequestId: (fileReadLogger as any).bindings?.()?.batchRequestId
        }, `Successfully read and parsed CSV file.`);
        return records;

    } catch (error: any) { // Lỗi có thể từ readFile hoặc từ parseCSVString (nếu reject)
        fileReadLogger.error({
            event: 'read_csv_file_failed', // EVENT CHO LOG ANALYSIS
            err: { message: error.message, stack: error.stack?.substring(0, 500) },
            // batchRequestId: (fileReadLogger as any).bindings?.()?.batchRequestId
        }, `Error reading or parsing CSV file.`);
        // Quyết định trả về mảng rỗng hay throw lỗi tùy theo yêu cầu.
        // Hiện tại đang trả về mảng rỗng. Nếu muốn throw, hãy throw error;
        return [];
    }
};



export async function appendJournalToFile(
    journalData: JournalDetails,
    filePath: string,
    taskLogger: Logger | MinimalLogger // Yêu cầu logger
): Promise<void> {
    // taskLogger đã là child logger từ crawlJournals, nên đã có context (batchRequestId, journalTitle, etc.)
    taskLogger.debug({
        event: 'append_journal_to_file_start', // EVENT CHO LOG ANALYSIS
        // journalTitle: journalData?.title || 'Untitled', // Đã có trong taskLogger bindings
        // filePath: filePath // Đã có trong taskLogger bindings nếu bạn thêm vào
    }, "Attempting to append journal to file.");

    let jsonLine: string;
    try {
        jsonLine = JSON.stringify(journalData);
    } catch (stringifyError: any) {
        taskLogger.error({
            event: 'append_journal_to_file_failed', // EVENT CHO LOG ANALYSIS
            stage: 'stringify',
            // journalTitle: journalData?.title || 'Untitled',
            err: { message: stringifyError.message, stack: stringifyError.stack?.substring(0, 500) }
        }, "CRITICAL ERROR DURING JSON.stringify!");
        // Không throw lỗi ở đây để không làm dừng toàn bộ batch nếu chỉ 1 record lỗi stringify,
        // nhưng log analysis sẽ ghi nhận lỗi này cho journal cụ thể.
        return;
    }

    if (!jsonLine) { // Trường hợp hiếm JSON.stringify trả về undefined (ví dụ input là undefined)
        taskLogger.error({
            event: 'append_journal_to_file_failed', // EVENT CHO LOG ANALYSIS
            stage: 'stringify_undefined',
            // journalTitle: journalData?.title || 'Untitled',
        }, "CRITICAL: JSON.stringify returned undefined!");
        return;
    }

    const lineToWrite = jsonLine + '\n';
    try {
        await fs.promises.appendFile(filePath, lineToWrite, 'utf8');
        taskLogger.info({
            event: 'append_journal_to_file_success', // EVENT CHO LOG ANALYSIS
            // journalTitle: journalData?.title || 'Untitled',
        }, `Successfully appended journal.`);
    } catch (appendError: any) {
        taskLogger.error({
            event: 'append_journal_to_file_failed', // EVENT CHO LOG ANALYSIS
            stage: 'append_fs',
            // journalTitle: journalData?.title || 'Untitled',
            err: { message: appendError.message, stack: appendError.stack?.substring(0, 500), code: appendError.code }
        }, `CRITICAL ERROR during fs.appendFile!`);
        // Tương tự, không throw để batch có thể tiếp tục, lỗi được ghi nhận.
    }
}