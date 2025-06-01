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


export const traverseNodes = (node: Node | null): string => {
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent?.trim() || ''; // Null safe access
    } else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
        return Array.from(node.childNodes).map(traverseNodes).join(' ').trim();
    }
    return '';
};

export const createURLList = (baseURL: string, lastPageNumber: number): string[] => {
    return Array.from({ length: lastPageNumber }, (_, i) => `${baseURL}&page=${i + 1}`); // Corrected length
};

export const formatISSN = (issn: string): string | null => {
    if (!issn) { // Thêm kiểm tra đầu vào null/undefined/empty
        return null;
    }
    const issnValues = issn.split(',').map(item => item.trim());
    // Ưu tiên phần tử thứ 2 nếu có, nếu không lấy phần tử đầu tiên
    const issnToSearch = (issnValues[1] || issnValues[0] || '').replace(/-/g, ''); // Xóa dấu gạch nối cũ nếu có

    // Regex mới: 4 số, sau đó là 3 số và ký tự cuối cùng là số hoặc X
    // Thêm ^ và $ để đảm bảo khớp toàn bộ chuỗi 8 ký tự sau khi xóa gạch nối
    const issnRegex = /^(\d{4})(\d{3}[\dX])$/i; // i để không phân biệt hoa thường cho X

    const match = issnToSearch.match(issnRegex);

    if (match) {
        // match[1] là group 1 (\d{4})
        // match[2] là group 2 (\d{3}[\dX])
        return `${match[1]}-${match[2]}`;
    }

    // Nếu không khớp định dạng 8 ký tự chuẩn (vd: 12345, ABCDEFGH) thì trả về null
    return null;
};



/**
* Executes an async function with retries on failure.
* @param fn The async function to execute. It receives the current attempt number (starting from 1).
* @param options Retry configuration.
* @param logger A logger instance (e.g., Pino) for logging retry attempts.
* @returns The result of the function `fn` if successful.
* @throws The error from the last attempt if all retries fail.
*/
export const retryAsync = async <T>(
    fn: (attempt: number) => Promise<T>, // Function now accepts attempt number
    options: RetryOptions,
    logger: Logger | MinimalLogger // Accept logger instance
): Promise<T> => {
    const { retries, minTimeout, factor } = options;
    let lastError: any = null; // Store the last error

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            // Pass the current attempt number to the function
            return await fn(attempt);
        } catch (error: any) {
            lastError = error; // Store the error
            if (attempt >= retries) {
                logger.error({
                    event: 'retry_max_attempts_reached',
                    attempt,
                    maxRetries: retries,
                    err: lastError // Log the actual error object
                }, `Function failed after maximum ${retries} attempts. Throwing last error.`);
                throw lastError; // Throw the actual error from the last attempt
            }

            // Calculate delay using exponential backoff
            // Delay = minTimeout * (factor ^ (attempt - 1)) -> Common pattern
            // Or use factor ^ attempt for slightly faster increase: minTimeout * (factor ^ attempt)
            const timeout = Math.round(minTimeout * Math.pow(factor, attempt - 1));

            logger.warn({
                event: 'retry_attempt_failed',
                attempt,
                maxRetries: retries,
                delayMs: timeout,
                err: error // Log the error for this specific attempt
            }, `Attempt ${attempt}/${retries} failed. Retrying in ${timeout}ms...`);

            await new Promise((resolve) => setTimeout(resolve, timeout));
        }
    }

    // This part should theoretically not be reached if retries >= 1
    // But it satisfies TypeScript's need for a return/throw at the end
    logger.error({ event: 'retry_logic_error', err: lastError }, "Retry loop completed without success or throwing an error (unexpected). Throwing last encountered error.");
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
const escapeQuotesInQuotedFields = (csvString: string, delimiter = ';') => {
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
        logger.warn("[escapeQuotesInQuotedFields] Warning: CSV string potentially ended with an unterminated quoted field.");
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
export const parseCSVString = async (csvContent: string, parentLogger: typeof logger = logger): Promise<CSVRecord[]> => {
    const csvLogger = parentLogger.child({ service: 'parseCSVString' });
    csvLogger.info({ event: 'parse_start', inputLength: csvContent.length }, `Attempting to parse CSV string content.`);
    console.log(`[parseCSVString][parse_start] Attempting to parse CSV string content (Length: ${csvContent.length}).`);

    // --- BEGIN PRE-PROCESSING ---
    let processedCsvContent: string;
    try {
        csvLogger.info({ event: 'preprocess_start' }, `Starting pre-processing to escape inner quotes.`);
        console.log(`[parseCSVString][preprocess_start] Starting pre-processing to escape inner quotes.`); // CONSOLE ADDED
        processedCsvContent = escapeQuotesInQuotedFields(csvContent, ';');
        csvLogger.info({ event: 'preprocess_success', outputLength: processedCsvContent.length }, `Finished pre-processing.`);
        console.log(`[parseCSVString][preprocess_success] Finished pre-processing (New Length: ${processedCsvContent.length}).`); // CONSOLE ADDED
        // Optional: Log diff if significant changes occurred (for debugging)
        // if (processedCsvContent !== csvContent) {
        //     csvLogger.debug({ event: 'preprocess_diff' }, `CSV content modified by pre-processing.`);
        // }
    } catch (preProcessError: any) {
        csvLogger.error({ err: preProcessError, stack: preProcessError?.stack, event: 'preprocess_failed' }, `Error during CSV pre-processing.`);
        console.error(`[parseCSVString][preprocess_failed] Error during CSV pre-processing:`, preProcessError.message || preProcessError); // CONSOLE ADDED
        return Promise.reject(new Error(`Failed during CSV pre-processing: ${preProcessError.message}`));
    }
    // --- END PRE-PROCESSING ---

    return new Promise((resolve, reject) => {
        const records: CSVRecord[] = [];
        // Use the processed content here
        const parser: Parser = parse(processedCsvContent, {
            columns: true, // Use the first line as headers
            skip_empty_lines: true,
            delimiter: ';', // Specify the semicolon delimiter
            trim: true,     // Trim whitespace from headers and fields
            // relax_column_count: true, // Consider if needed based on data quality
            // relax_quotes: false, // Keep this false or default. We want strict quotes *after* our pre-processing.
            // escape: '"', // Default is already '"'
        });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
            }
        });

        parser.on('error', (err) => {
            csvLogger.error({ err: err, stack: err.stack, event: 'parse_failed' }, `Error parsing pre-processed CSV string.`);
            console.error(`[parseCSVString][parse_failed] Error parsing pre-processed CSV string:`, err.message || err); // CONSOLE ADDED
            console.error(`[parseCSVString][parse_failed] Stack trace:`, err.stack); // CONSOLE ADDED
            // Provide context about pre-processing
            reject(new Error(`Failed to parse CSV string (after pre-processing): ${err.message}`));
        });

        parser.on('end', () => {
            csvLogger.info({ event: 'parse_success', recordCount: records.length }, `Successfully parsed ${records.length} records from CSV string.`);
            console.log(`[parseCSVString][parse_success] Successfully parsed ${records.length} records from CSV string.`); // CONSOLE ADDED
            resolve(records); // Resolve the promise with the parsed records
        });

        // Error handling for the stream itself
        parser.on('error', (streamError) => {
            if (!parser.destroyed) {
                csvLogger.error({ err: streamError, event: 'parse_stream_error' }, `CSV parsing stream error.`);
                reject(new Error(`CSV parsing stream error: ${streamError.message}`));
            }
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
export const readCSV = async (filePath: string, parentLogger: typeof logger = logger): Promise<CSVRecord[]> => {
    const fileReadLogger = parentLogger.child({ service: 'readCSV', filePath });
    fileReadLogger.info({ event: 'read_start' }, `Attempting to read CSV file.`);
    console.log(`[readCSV][read_start] Attempting to read CSV file: ${filePath}`); // CONSOLE ADDED

    try {
        const fileContent = await fs.promises.readFile(filePath, { encoding: 'utf8' });
        fileReadLogger.debug({ event: 'read_success', fileSize: fileContent.length }, `Successfully read file content.`);
        console.log(`[readCSV][read_success] Successfully read file content (Size: ${fileContent.length} bytes).`); // CONSOLE ADDED

        // Delegate parsing to the dedicated string parsing function
        return await parseCSVString(fileContent, fileReadLogger); // Pass logger down

    } catch (error: any) {
        fileReadLogger.error({ err: error, stack: error.stack, event: 'read_failed' }, `Error reading CSV file.`);
        console.error(`[readCSV][read_failed] Error reading CSV file ${filePath}:`, error.message || error); // CONSOLE ADDED
        console.error(`[readCSV][read_failed] Stack trace:`, error.stack); // CONSOLE ADDED
        return []; // Return empty array on file reading failure
    }
};


// Define OUTPUT_JSON path if not already globally available in this scope
export async function appendJournalToFile(
    journalData: JournalDetails,
    filePath: string,
    taskLogger: typeof logger // Sử dụng kiểu logger được truyền vào
): Promise<void> {
    let jsonLine: string | undefined = undefined;
    try {
        // Log đối tượng gốc (sẽ trông giống Object Literal trên console)
        taskLogger.debug({ event: 'append_received_object', journalTitle: journalData?.title || 'Untitled' }, "Received journalData object for appending.");
        // console.log("Object received:", journalData); // Bật nếu cần xem chi tiết

        taskLogger.debug({ event: 'stringify_start' }, "Attempting to stringify journal data...");
        // ----> Bước 1: Cô lập lỗi stringify <----
        try {
            jsonLine = JSON.stringify(journalData);
            if (!jsonLine) {
                taskLogger.error({ event: 'stringify_failed_undefined', journalTitle: journalData?.title || 'Untitled' }, "CRITICAL: JSON.stringify returned undefined!");
                console.error(`!!!!!!!! STRINGIFY RETURNED UNDEFINED for ${journalData?.title || 'Untitled'} !!!!!!!!`);
                return;
            }
            // Log một phần chuỗi JSON đã được stringify
            taskLogger.debug({ event: 'stringify_success', firstChars: jsonLine.substring(0, 150) + "..." }, "Successfully stringified data. Output starts with keys in quotes.");
            // console.log("Stringified JSON:", jsonLine.substring(0,150)+"..."); // Bật nếu cần xem chuỗi JSON thực tế
        } catch (stringifyError: any) {
            taskLogger.error({ err: stringifyError, event: 'stringify_failed_exception', journalTitle: journalData?.title || 'Untitled' }, "CRITICAL ERROR DURING JSON.stringify!");
            console.error(`!!!!!!!! STRINGIFY FAILED for ${journalData?.title || 'Untitled'} !!!!!!!!`, stringifyError);
            // Xem xét stack trace của lỗi stringifyError để tìm nguyên nhân (ví dụ: circular structure)
            return; // Dừng lại nếu không stringify được
        }

        // ----> Bước 2: Thực hiện ghi file <----
        const lineToWrite = jsonLine + '\n';
        taskLogger.debug({ event: 'append_start', path: filePath }, `Attempting to append stringified data...`);
        await fs.promises.appendFile(filePath, lineToWrite, 'utf8');
        taskLogger.info({ event: 'append_success', path: filePath, journalTitle: journalData?.title || 'Untitled' }, `Successfully appended journal.`);
        // console.log("Append successful for:", journalData?.title);

    } catch (appendError: any) {
        // Lỗi này là lỗi của fs.promises.appendFile
        taskLogger.error({ err: appendError, path: filePath, event: 'append_failed_fs', journalTitle: journalData?.title || 'Untitled' }, `CRITICAL ERROR during fs.appendFile!`);
        console.error(`!!!!!!!! FS APPEND FAILED for ${journalData?.title || 'Untitled'} !!!!!!!!`, appendError);
    }
}