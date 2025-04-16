import fs from 'fs';
import { parse } from 'csv-parse/sync'; // Import thư viện csv-parse/sync
import path from 'path';


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
  return Array.from({ length: 1 }, (_, i) => `${baseURL}&page=${i + 1}`); // Corrected length
};

export const formatISSN = (issn: string): string | null => {
  const issnValues = issn.split(',').map(item => item.trim());
  const issnToSearch = issnValues[1] || issnValues[0];

  if (issnToSearch) {
    return issnToSearch.replace(/(\d{4})(\d{4})/, '$1-$2');
  }
  return null;
};

interface RetryOptions {
  retries: number;
  minTimeout: number;
  factor: number;
}

// Hàm retry bất đồng bộ
export const retryAsync = async <T>(fn: () => Promise<T>, options: RetryOptions): Promise<T> => {
  const { retries, minTimeout, factor } = options;
  let attempt = 0;

  while (attempt < retries) {
    try {
      return await fn();
    } catch (error: any) {
      attempt++;
      if (attempt >= retries) {
        throw error; // Ném lỗi nếu đã thử lại quá số lần quy định
      }

      const timeout = minTimeout * Math.pow(factor, attempt - 1);
      logger.warn(`Attempt ${attempt} failed: ${error.message}. Retrying in ${timeout}ms...`);
      await new Promise((resolve) => setTimeout(resolve, timeout));
    }
  }
  throw new Error("Retry failed after multiple attempts"); // Should not happen, but good to have
};

interface CSVRecord {
  [key: string]: string;
}

export const readCSV = async (filePath: string): Promise<CSVRecord[]> => {
  try {
    const fileContent = await fs.promises.readFile(filePath, { encoding: 'utf8' });
    const records: CSVRecord[] = parse(fileContent, {
      columns: true,
      skip_empty_lines: true,
    });
    return records;
  } catch (error: any) {
    logger.error(`Error read file csv ${filePath}: ${error}`);
    return [];
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