import fs from 'fs';
import path from 'path';
import { parse, Parser } from 'csv-parse'; // Use specific import if possible
import { CSVRecord } from './types'; // Assuming CSVRecord type definition


import { JournalDetails } from './types'; // Assuming you have this interface defined

export const LOG_FILE: string = path.join(__dirname, './data/crawl_journal.log');
import pino, { Logger, LoggerOptions, stdTimeFunctions } from 'pino';
import { APP_LOG_FILE_PATH, LOG_LEVEL, LOGS_DIRECTORY } from '../config'; // Import từ config.ts

import { PinoFileDestination } from './types';

// --- Đảm bảo thư mục log tồn tại ---
// // LOGS_DIRECTORY và APP_LOG_FILE_PATH đã là đường dẫn tuyệt đối từ config.ts
// console.log(`[DEBUG] Target log directory: ${LOGS_DIRECTORY}`);
// console.log(`[DEBUG] Target absolute log file path: ${APP_LOG_FILE_PATH}`);

try {
    // Kiểm tra và tạo thư mục nếu chưa tồn tại
    if (!fs.existsSync(LOGS_DIRECTORY)) {
        fs.mkdirSync(LOGS_DIRECTORY, { recursive: true });
        console.log(`[DEBUG] Log directory created: ${LOGS_DIRECTORY}`);
    }
    // Kiểm tra quyền ghi vào thư mục
    fs.accessSync(LOGS_DIRECTORY, fs.constants.W_OK);
    // console.log(`[DEBUG] Write access to directory ${LOGS_DIRECTORY} confirmed.`);
} catch (err: unknown) {
    // Sử dụng unknown và kiểm tra kiểu lỗi
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`CRITICAL: Error checking/creating log directory or no write access: ${LOGS_DIRECTORY}. Error: ${errorMessage}`, err instanceof Error ? err.stack : '');
    process.exit(1); // Thoát nếu không thể ghi log
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
    child: function() { return this; }, // Trả về chính nó để tránh lỗi khi gọi .child()
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



interface RetryOptions {
  retries: number;
  minTimeout: number; // Base delay in ms
  factor: number;     // Multiplier for exponential backoff
}

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
 * Parses CSV content provided as a string.
 * Handles semicolon delimiters and standard CSV parsing options.
 * @param csvContent The raw CSV content as a string.
 * @param parentLogger Optional logger instance to use.
 * @returns A promise resolving to an array of parsed CSV records (objects).
 * @throws Error if parsing fails.
 */
export const parseCSVString = async (csvContent: string, parentLogger: typeof logger = logger): Promise<CSVRecord[]> => {
    const csvLogger = parentLogger.child({ service: 'parseCSVString' });
    csvLogger.info({ event: 'parse_start', inputLength: csvContent.length }, `Attempting to parse CSV string content.`);
    console.log(`[parseCSVString][parse_start] Attempting to parse CSV string content (Length: ${csvContent.length}).`); // CONSOLE ADDED

    return new Promise((resolve, reject) => {
        const records: CSVRecord[] = [];
        const parser: Parser = parse(csvContent, {
            columns: true, // Use the first line as headers
            skip_empty_lines: true,
            delimiter: ';', // Specify the semicolon delimiter
            trim: true,     // Trim whitespace from headers and fields
            // relax_column_count: true, // Consider if needed based on data quality
        });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) {
                records.push(record);
            }
        });

        parser.on('error', (err) => {
            csvLogger.error({ err: err, stack: err.stack, event: 'parse_failed' }, `Error parsing CSV string.`);
            console.error(`[parseCSVString][parse_failed] Error parsing CSV string:`, err.message || err); // CONSOLE ADDED
            console.error(`[parseCSVString][parse_failed] Stack trace:`, err.stack); // CONSOLE ADDED
            reject(new Error(`Failed to parse CSV string: ${err.message}`)); // Reject the promise on error
        });

        parser.on('end', () => {
            csvLogger.info({ event: 'parse_success', recordCount: records.length }, `Successfully parsed ${records.length} records from CSV string.`);
            console.log(`[parseCSVString][parse_success] Successfully parsed ${records.length} records from CSV string.`); // CONSOLE ADDED
            resolve(records); // Resolve the promise with the parsed records
        });

        // Error handling for the stream itself (though parser 'error' usually catches it)
        parser.on('error', (streamError) => {
             if (!parser.destroyed) { // Prevent double rejection if 'error' event already fired
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