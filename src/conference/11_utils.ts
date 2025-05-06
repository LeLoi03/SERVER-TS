// import pino, { Logger, LoggerOptions, stdTimeFunctions } from 'pino';
import fs from 'fs';
import { Mutex } from 'async-mutex';
// import { APP_LOG_FILE_PATH, LOG_LEVEL, LOGS_DIRECTORY } from '../config'; // Import từ config.ts

// import { PinoFileDestination } from './types';


// // --- Đảm bảo thư mục log tồn tại ---
// // // LOGS_DIRECTORY và APP_LOG_FILE_PATH đã là đường dẫn tuyệt đối từ config.ts
// // console.log(`[DEBUG] Target log directory: ${LOGS_DIRECTORY}`);
// // console.log(`[DEBUG] Target absolute log file path: ${APP_LOG_FILE_PATH}`);

// try {
//     // Kiểm tra và tạo thư mục nếu chưa tồn tại
//     if (!fs.existsSync(LOGS_DIRECTORY)) {
//         fs.mkdirSync(LOGS_DIRECTORY, { recursive: true });
//         console.log(`[DEBUG] Log directory created: ${LOGS_DIRECTORY}`);
//     }
//     // Kiểm tra quyền ghi vào thư mục
//     fs.accessSync(LOGS_DIRECTORY, fs.constants.W_OK);
//     // console.log(`[DEBUG] Write access to directory ${LOGS_DIRECTORY} confirmed.`);
// } catch (err: unknown) {
//     // Sử dụng unknown và kiểm tra kiểu lỗi
//     const errorMessage = err instanceof Error ? err.message : String(err);
//     console.error(`CRITICAL: Error checking/creating log directory or no write access: ${LOGS_DIRECTORY}. Error: ${errorMessage}`, err instanceof Error ? err.stack : '');
//     process.exit(1); // Thoát nếu không thể ghi log
// }

// // --- Cấu hình Pino ---
// // Định nghĩa kiểu cho levelLabels rõ ràng hơn
// const levelLabels: { [key: number]: string } = {
//     10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal',
// };

// // Sử dụng LoggerOptions để định kiểu cho cấu hình
// const pinoConfig: LoggerOptions = {
//     level: LOG_LEVEL, // Đã có kiểu AllowedLogLevel từ config
//     // timestamp: () => `,"time":"${dayjs().tz(VIETNAM_TIMEZONE).format('YYYY-MM-DD')}"`,
//     timestamp: stdTimeFunctions.isoTime, // Sử dụng hàm chuẩn của Pino
//     formatters: {
//         level: (label: string, number: number): { level: string } => ({
//             level: levelLabels[number] || label
//         }),
//     },

//     base: undefined, // Bỏ các trường mặc định như pid, hostname
// };

// // --- Khởi tạo Pino Logger ---
// // Interface tối thiểu cho fallback logger để đảm bảo tính nhất quán
// interface MinimalLogger {
//     info: (...args: any[]) => void;
//     warn: (...args: any[]) => void;
//     error: (...args: any[]) => void;
//     fatal: (...args: any[]) => void;
//     debug: (...args: any[]) => void;
//     trace: (...args: any[]) => void;
//     child: (bindings: Record<string, any>) => MinimalLogger;
// }

// // Khai báo logger và destination stream với kiểu tùy chỉnh
// export let logger: Logger | MinimalLogger; // Logger có thể là Pino Logger hoặc fallback
// let fileDestination: PinoFileDestination | undefined = undefined; // Sử dụng interface tùy chỉnh

// // Hàm tạo fallback logger
// const createFallbackLogger = (): MinimalLogger => ({
//     info: (...args: any[]) => console.info('[FALLBACK LOGGER]', ...args),
//     warn: (...args: any[]) => console.warn('[FALLBACK LOGGER]', ...args),
//     error: (...args: any[]) => console.error('[FALLBACK LOGGER]', ...args),
//     fatal: (...args: any[]) => console.error('[FALLBACK LOGGER]', ...args),
//     debug: (...args: any[]) => console.debug('[FALLBACK LOGGER]', ...args),
//     trace: (...args: any[]) => console.trace('[FALLBACK LOGGER]', ...args),
//     child: function() { return this; }, // Trả về chính nó để tránh lỗi khi gọi .child()
// });


// // console.log('[DEBUG] Initializing Pino logger with pino.destination...');
// try {
//     // Sử dụng Type Assertion hai bước (as unknown as PinoFileDestination)
//     // để ép kiểu kết quả trả về từ pino.destination
//     fileDestination = pino.destination({
//         dest: APP_LOG_FILE_PATH, // Đường dẫn tuyệt đối
//         sync: false, // false để có hiệu năng tốt hơn, flush khi thoát
//         minLength: 4096, // Buffer size (bytes) before flushing (optional, default 4096)
//         mkdir: false, // Đã tự tạo thư mục ở trên
//     }) as unknown as PinoFileDestination; // <--- ÉP KIỂU QUA UNKNOWN ĐỂ FIX LỖI TS(2352)

//     // Bắt sự kiện error trên stream - .on hợp lệ vì kế thừa Writable
//     fileDestination.on('error', (err: Error) => {
//       console.error('[PINO DESTINATION ERROR] Error writing to log file:', err);
//       // Cân nhắc chuyển sang fallback logger nếu lỗi ghi file nghiêm trọng
//       // if (!isShuttingDown) { // Tránh chuyển đổi logger trong quá trình shutdown
//       //    console.warn('[PINO DESTINATION ERROR] Switching to fallback logger due to file write error.');
//       //    logger = createFallbackLogger();
//       // }
//     });

//     // Khởi tạo logger Pino thật sự, truyền vào destination đã được ép kiểu
//     logger = pino(pinoConfig, fileDestination);

//     // console.log('[DEBUG] Pino logger initialization successful (pino.destination).');
//     // Sử dụng logger đã khởi tạo
//     logger.fatal({ initCheck: true }, "LOGGER INITIALIZED (pino.destination). This should appear in the log file.");
//     // console.log("[DEBUG] Called logger.fatal right after initialization.");

// } catch (pinoInitError: unknown) {
//     const errorMessage = pinoInitError instanceof Error ? pinoInitError.message : String(pinoInitError);
//     console.error("[DEBUG] !!! CRITICAL Error during Pino logger initialization:", errorMessage, pinoInitError);

//     // Tạo logger giả lập tuân thủ MinimalLogger interface
//     logger = createFallbackLogger();
//     console.warn("[DEBUG] Using fallback console logger due to initialization error.");
// }

// // --- Xử lý tín hiệu thoát ---
// // Định nghĩa một kiểu union cho các tín hiệu hoặc lý do thoát
// type ShutdownSignal = NodeJS.Signals | 'uncaughtException' | 'unhandledRejection';

// let isShuttingDown = false; // Cờ để tránh gọi shutdown nhiều lần

// const gracefulShutdown = (signal: ShutdownSignal, error?: Error | unknown): void => {
//     if (isShuttingDown) {
//         console.log(`[GRACEFUL SHUTDOWN] Already shutting down (${signal})... Ignoring subsequent call.`);
//         return;
//     }
//     isShuttingDown = true; // Đánh dấu đang shutdown

//     // Sử dụng logger hiện tại (Pino hoặc fallback)
//     const logFn = logger;

//     logFn.info(`Received ${signal}. Shutting down gracefully...`);

//     let exitCode = 0;
//     if (error) {
//         // Ghi log lỗi chi tiết hơn nếu là Error object
//         if (error instanceof Error) {
//             logFn.error({ err: { message: error.message, stack: error.stack, name: error.name } }, `Error triggered shutdown (${signal})`);
//         } else {
//             logFn.error({ errorDetails: error }, `Non-Error triggered shutdown (${signal})`);
//         }
//         exitCode = 1; // Đặt mã thoát là 1 nếu có lỗi
//     }

//     // Quan trọng: Đảm bảo flushSync khi dùng pino.destination({ sync: false })
//     // Kiểm tra sự tồn tại và phương thức flushSync (đã được đảm bảo bởi interface PinoFileDestination)
//     if (fileDestination && typeof fileDestination.flushSync === 'function') {
//         console.log('[GRACEFUL SHUTDOWN] Attempting to flush logs...');
//         try {
//             fileDestination.flushSync(); // Ghi đồng bộ phần log còn lại vào file
//             console.log('[GRACEFUL SHUTDOWN] Logs flushed successfully.');
//         } catch (flushErr: unknown) {
//             const flushErrMsg = flushErr instanceof Error ? flushErr.message : String(flushErr);
//             // Log lỗi flush bằng console vì logger có thể không ghi được nữa
//             console.error('[GRACEFUL SHUTDOWN] CRITICAL: Error flushing logs:', flushErrMsg, flushErr);
//             if (exitCode === 0) exitCode = 1; // Đặt mã lỗi nếu flush thất bại
//         }
//     } else if (fileDestination) {
//          console.warn('[GRACEFUL SHUTDOWN] Log destination exists but flushSync is not available? (Type issue or sync=true?)');
//     } else {
//          console.log('[GRACEFUL SHUTDOWN] No file destination to flush (using fallback logger or sync=true).');
//     }

//     // Đóng stream nếu cần (thường không bắt buộc sau flushSync, nhưng có thể giúp giải phóng tài nguyên ngay lập tức)
//     // Lưu ý: destroy() có thể không tồn tại trên mọi phiên bản/cấu hình
//     // if (fileDestination && typeof (fileDestination as any).destroy === 'function') {
//     //     try {
//     //        (fileDestination as any).destroy();
//     //        console.log('[GRACEFUL SHUTDOWN] Log destination stream destroyed.');
//     //     } catch (destroyErr) {
//     //        console.error('[GRACEFUL SHUTDOWN] Error destroying log stream:', destroyErr);
//     //     }
//     // }

//     console.log(`[GRACEFUL SHUTDOWN] Exiting process with code ${exitCode}.`);
//     // Delay nhỏ để đảm bảo các I/O cuối cùng (như console.log) có cơ hội hoàn thành
//     // Đặc biệt quan trọng nếu có log async nào đó đang chạy
//     setTimeout(() => {
//         process.exit(exitCode);
//     }, 100); // Chờ 100ms trước khi thoát
// };

// // Gắn các trình xử lý tín hiệu
// process.on('SIGINT', () => gracefulShutdown('SIGINT'));
// process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// // Lỗi chưa bắt được
// process.on('uncaughtException', (err: Error, origin: string) => {
//     // Log lỗi này bằng console vì logger có thể không ổn định
//     console.error(`[FATAL] Uncaught Exception at: ${origin}`, err);
//     // Gọi gracefulShutdown với lỗi, chỉ gọi nếu chưa shutdown
//     if (!isShuttingDown) {
//         gracefulShutdown('uncaughtException', err);
//     } else {
//         console.error('[FATAL] Uncaught exception occurred during shutdown process.');
//         // Có thể cần thoát ngay lập tức nếu lỗi xảy ra trong quá trình shutdown
//         process.exit(1);
//     }
// });

// // Promise rejection chưa được xử lý
// process.on('unhandledRejection', (reason: unknown, promise: Promise<any>) => {
//     // Log lỗi này bằng console
//     console.error('[FATAL] Unhandled Promise Rejection:', reason);
//     // Cố gắng chuyển reason thành Error object
//     const error = reason instanceof Error ? reason : new Error(String(reason ?? 'Unknown rejection reason'));
//     // Log thêm chi tiết promise nếu có thể (tuỳ chọn)
//     // console.error('Unhandled Promise:', promise);
//     // Gọi gracefulShutdown với lỗi, chỉ gọi nếu chưa shutdown
//     if (!isShuttingDown) {
//         gracefulShutdown('unhandledRejection', error);
//     } else {
//          console.error('[FATAL] Unhandled promise rejection occurred during shutdown process.');
//          // Có thể cần thoát ngay lập tức
//          process.exit(1);
//     }
// });

// --- Mutex và Hàm tiện ích ---
const acronymMutex = new Mutex(); // Kiểu được suy luận từ thư viện

/**
 * Thêm một từ viết tắt vào Set một cách an toàn (thread-safe),
 * tự động thêm hậu tố _diffN nếu từ viết tắt đã tồn tại.
 * @param set - Set chứa các từ viết tắt (phải là Set<string>).
 * @param acronymIndex - Từ viết tắt cần thêm.
 * @returns Từ viết tắt đã được điều chỉnh và thêm vào Set, hoặc chuỗi rỗng nếu đầu vào không hợp lệ hoặc có lỗi.
 */
export const addAcronymSafely = async (set: Set<string>, acronymIndex: string): Promise<string> => {
    // Kiểm tra kiểu đầu vào nghiêm ngặt hơn với TypeScript
    if (!(set instanceof Set)) {
        // logger.error({ inputSetType: typeof set, inputSetValue: set }, "addAcronymSafely: Input 'set' is not a valid Set object.");
        return ""; // Trả về chuỗi rỗng để chỉ ra lỗi đầu vào
    }
    if (typeof acronymIndex !== 'string' || acronymIndex.trim() === '') {
        // logger.error({ inputAcronymType: typeof acronymIndex, inputAcronymValue: acronymIndex }, "addAcronymSafely: Input 'acronymIndex' must be a non-empty string.");
        return ""; // Trả về chuỗi rỗng
    }

    // Sử dụng Mutex để đảm bảo chỉ một thao tác kiểm tra và thêm diễn ra tại một thời điểm
    const release = await acronymMutex.acquire();
    // logger.trace({ acronym: acronymIndex }, 'Acquired mutex for acronym check');

    try {
        let adjustedAcronym = acronymIndex;
        let counter = 1;
        // Xóa hậu tố _N hiện có (nếu có) để lấy base
        const baseAcronym = acronymIndex.replace(/_\d+$/, '');

        adjustedAcronym = baseAcronym; // Bắt đầu kiểm tra từ base

        // Kiểm tra xem base hoặc các phiên bản _N đã tồn tại chưa
        if (set.has(adjustedAcronym)) {
            // logger.debug({ acronym: adjustedAcronym }, 'Base acronym exists, starting  check.');
            do {
                adjustedAcronym = `${baseAcronym}_${counter}`;
                counter++;
                // Thêm giới hạn để tránh vòng lặp vô hạn tiềm ẩn (tuỳ chọn)
                if (counter > 10000) { // Tăng giới hạn nếu cần
                    // logger.warn({ baseAcronym, attempt: counter }, 'addAcronymSafely: Excessive  counter reached, potential infinite loop or very high collision rate.');
                    // Trả về giá trị lỗi hoặc throw để báo hiệu vấn đề nghiêm trọng
                    return `${baseAcronym}_limit_reached`; // Hoặc throw new Error(...)
                }
            } while (set.has(adjustedAcronym));
            // logger.debug({ original: acronymIndex, adjusted: adjustedAcronym }, 'Found non-conflicting acronym with _.');
        } else {
            // logger.debug({ acronym: adjustedAcronym }, 'Base acronym does not exist, using it directly.');
        }

        // Thêm từ viết tắt đã được điều chỉnh vào Set
        set.add(adjustedAcronym);
        // logger.debug({ addedAcronym: adjustedAcronym, setSize: set.size }, "Acronym added to set.");
        return adjustedAcronym; // Trả về từ viết tắt đã thêm thành công

    } catch (error: unknown) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        // Log lỗi xảy ra bên trong critical section
        // logger.error({
        //     err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
        //     originalAcronym: acronymIndex
        // }, `Error occurred within addAcronymSafely critical section: ${errorMsg}`);
        // Trả về chuỗi rỗng khi có lỗi xử lý không mong muốn
        return "";
    } finally {
        // Luôn giải phóng mutex dù thành công hay thất bại
        release();
        // logger.trace({ acronym: acronymIndex }, 'Released mutex for acronym check');
    }
};

// console.log('[DEBUG] End of utils/logger.ts execution. Logger should be exported.');

// Optional: Export thêm các thành phần khác nếu cần
// export { pinoConfig, levelLabels, fileDestination }; // Không nên export fileDestination trực tiếp trừ khi thực sự cần


import { v4 as uuidv4 } from 'uuid';
import path from 'path';

// --- Thư mục lưu file tạm ---
const TEMP_TEXT_DIR = path.join(__dirname, './data/temp_texts');


// --- Hàm tiện ích ghi file tạm ---
export async function writeTempFile(
    content: string,
    baseFileName: string,
    directoryPath?: string
): Promise<string> {
    const uniqueId = uuidv4();

    const tempDir = directoryPath || TEMP_TEXT_DIR; // Use provided path or default
    const fileName = `${baseFileName}_${uniqueId}.txt`;
    const filePath = path.join(tempDir, fileName);


    try {
        // Ensure the directory exists
        if (!fs.existsSync(tempDir)) {
            await fs.promises.mkdir(tempDir, { recursive: true });
            // Optional: Add logging here if you move the logger util here too
            // console.log(`Created temporary directory: ${tempDir}`);
        }
        await fs.promises.writeFile(filePath, content || '', 'utf8'); // Write empty string if content is null/undefined
        return filePath;
    } catch (error) {
        // Optional: Add logging here
        // console.error(`Error writing temporary file ${filePath}:`, error);
        throw error; // Re-throw the error
    }
}

// --- Hàm tiện ích đọc file ---
export async function readContentFromFile(filePath: string | undefined | null): Promise<string> {
    if (!filePath) return "";
    try {
        return await fs.promises.readFile(filePath, 'utf8');
    } catch (error) {
        console.error(`Error reading file ${filePath}:`, error);
        return ""; // Hoặc throw lỗi tùy ngữ cảnh
    }
}

// --- Thêm hàm dọn dẹp ---
export const cleanupTempFiles = async (): Promise<void> => {
    try {
        if (fs.existsSync(TEMP_TEXT_DIR)) {
            await fs.promises.rm(TEMP_TEXT_DIR, { recursive: true, force: true });
            console.log(`Cleaned up temporary directory: ${TEMP_TEXT_DIR}`);
        }
    } catch (error) {
        console.error("Error cleaning up temporary files:", error);
    }
};


