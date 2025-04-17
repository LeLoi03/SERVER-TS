import express, { Request, Response, NextFunction } from 'express';

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import bodyParser from 'body-parser';
import fs from 'fs';
import multer from 'multer';
import cron from 'node-cron';
import { logger } from './conference/11_utils';
import { getConferenceList as getConferenceListFromCrawl } from './conference/3_core_portal_scraping';
import { crawlConferences } from './conference/crawl_conferences';
import { crawlJournals } from './journal/crawl_journals';
import { ConferenceData } from './conference/types';

export const OUTPUT_JSON: string = path.join(__dirname, './journal/data/all_journal_data.json');

const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
};

const app = express();
const httpServer = new HttpServer(app);
export const io = new SocketIOServer(httpServer, { // <<< Export 'io'
    cors: {
        origin: "*", // <<< Cấu hình CORS chặt chẽ hơn
        methods: ["GET", "POST"]
    }
});

// --- Middleware ---
app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Multer setup
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// --- Socket.IO ---
export const connectedUsers = new Map<string, Socket>();

io.on('connection', (socket: Socket) => {
    console.log('A user connected:', socket.id);

    socket.on('register', (userId: string) => {
        connectedUsers.set(userId, socket);
        console.log(`User ${userId} registered with socket ${socket.id}`);
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);

        connectedUsers.forEach((userSocket, userId) => {
            if (userSocket.id === socket.id) {
                connectedUsers.delete(userId);
            }
        });
    });
});

// --- server_crawl.ts routes ---
// Custom middleware with types
const conditionalJsonBodyParser = (req: Request, res: Response, next: NextFunction) => {
    if (req.query.dataSource === 'client') {
        bodyParser.json()(req, res, next);
    } else {
        req.body = null; // Đặt req.body thành null
        next();
    }
};

app.use(conditionalJsonBodyParser);

// Định nghĩa đường dẫn file output (nên lấy từ config hoặc nơi tập trung)
const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
const EVALUATE_CSV_PATH = path.join(__dirname, './data/evaluate.csv');


import { ProcessedResponseData } from './conference/types';

// --- Function to handle the combined crawl/update logic ---
async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = (req as any).log || logger.child({ requestId, route: '/crawl-conferences' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to process conferences");

    const startTime = Date.now();
    const dataSource = (req.query.dataSource as string) || 'api'; // Mặc định là 'api'

    try {
        let conferenceList: ConferenceData[];

        routeLogger.info({ dataSource }, "Determining conference data source");

        // --- Lấy danh sách conference (Logic này giữ nguyên) ---
        if (dataSource === 'client') {
            conferenceList = req.body;
            if (!Array.isArray(conferenceList)) { // Chỉ cần kiểm tra là mảng
                routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list in request body for 'client' source.");
                res.status(400).json({ message: 'Invalid conference list provided in the request body (must be an array).' });
                return;
            }
            // Không cần kiểm tra link ở đây nữa, crawlConferences sẽ tự xử lý
            routeLogger.info({ count: conferenceList.length }, "Using conference list provided by client");
        } else { // dataSource === 'api' hoặc không được cung cấp
            if (req.body && Object.keys(req.body).length > 0) {
                routeLogger.warn("Received body when dataSource is not 'client'. Ignoring body.");
            }
            try {
                routeLogger.info("Fetching conference list from internal source...");
                conferenceList = await getConferenceListFromCrawl() as ConferenceData[];
                routeLogger.info({ count: conferenceList.length }, "Successfully fetched conference list from internal source");
            } catch (apiError: any) {
                routeLogger.error({ err: apiError }, "Failed to fetch conference list from internal source");
                res.status(500).json({ message: 'Failed to fetch conference list from internal source', error: apiError.message });
                return;
            }
        }

        // --- Kiểm tra conferenceList cuối cùng (Logic này giữ nguyên) ---
        if (!conferenceList || !Array.isArray(conferenceList)) {
             routeLogger.error("Internal Error: conferenceList is not a valid array after source determination.");
             res.status(500).json({ message: "Internal Server Error: Invalid conference list." });
             return;
        }
        if (conferenceList.length === 0) {
             routeLogger.warn("Conference list is empty. Nothing to process.");
             res.status(200).json({
                 message: 'Conference list provided or fetched was empty. No processing performed.',
                 runtime: `0.00 s`,
                 outputJsonlPath: FINAL_OUTPUT_PATH,
                 outputCsvPath: EVALUATE_CSV_PATH
             });
             return;
        }

        // --- Gọi hàm core (Logic này giữ nguyên) ---
        routeLogger.info({ conferenceCount: conferenceList.length, dataSource }, "Calling crawlConferences core function...");

        // *** Gọi crawlConferences và nhận kết quả (ProcessedResponseData | null)[] ***
        const crawlResults: (ProcessedResponseData | null)[] = await crawlConferences(conferenceList, routeLogger);

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        // --- Xử lý và gửi Response (Logic này áp dụng cho cả hai dataSource) ---

        // Lọc ra các kết quả không null (chỉ những kết quả từ luồng update thành công)
        const processedUpdateResults = crawlResults.filter(result => result !== null) as ProcessedResponseData[];

        routeLogger.info({
            runtimeSeconds: runTimeSeconds,
            totalProcessed: conferenceList.length, // Tổng số conf được yêu cầu xử lý
            updateResultsReturned: processedUpdateResults.length, // Số kết quả từ luồng update trả về
            event: 'processing_finished_successfully',
            outputJsonl: FINAL_OUTPUT_PATH,
            outputCsv: EVALUATE_CSV_PATH
        }, "Conference processing finished. Returning any available update results.");

        // *** Luôn trả về cấu trúc response này ***
        res.status(200).json({
            message: `Conference processing completed. ${processedUpdateResults.length} conference(s) yielded update data. All processing results (updates/saves) are reflected in server files.`,
            runtime: `${runTimeSeconds} s`,
            results: processedUpdateResults, // Trả về mảng kết quả update (có thể rỗng)
            outputJsonlPath: FINAL_OUTPUT_PATH,
            outputCsvPath: EVALUATE_CSV_PATH
        });
        routeLogger.info({ statusCode: 200, updateResultsCount: processedUpdateResults.length }, "Sent successful response");


    } catch (error: any) {
        const endTime = Date.now();
        const runTime = endTime - startTime;
        routeLogger.error({ err: error, stack: error.stack, runtimeMs: runTime, dataSource }, "Conference processing failed within route handler");

        if (!res.headersSent) {
             res.status(500).json({
                 message: 'Conference processing failed',
                 error: error.message
             });
             routeLogger.warn({ statusCode: 500 }, "Sent error response");
        } else {
             routeLogger.error("Headers already sent, could not send 500 error response.");
        }
    }
}



// --- Function to handle the crawl-journals logic ---
async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    console.log("Call crawl journals")
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = logger.child({ requestId, route: '/crawl-journals' });

    routeLogger.info({ method: req.method }, "Received request to crawl journals");

    const startTime = Date.now();

    try {
        routeLogger.info("Starting journal crawling...");
        await crawlJournals(routeLogger); // Call crawlJournals function
        routeLogger.info("Journal crawling completed.");

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        routeLogger.info({ runtimeSeconds: runTimeSeconds }, "Journal crawling finished successfully.");

        try {
            const runtimeFilePath = path.resolve(__dirname, 'crawl_journals_runtime.txt');
            await fs.promises.writeFile(runtimeFilePath, `Execution time: ${runTimeSeconds} s`);
            routeLogger.debug({ path: runtimeFilePath }, "Successfully wrote runtime file.");

        } catch (writeError: any) {
            routeLogger.warn(writeError, "Could not write journal crawling runtime or data file");
        }

        res.status(200).json({
            message: 'Journal crawling completed successfully!',
            // data: journalData,
            runtime: `${runTimeSeconds} s`
        });
        routeLogger.info({ statusCode: 200 }, "Sent successful response");

    } catch (error: any) {
        routeLogger.error(error, "Journal crawling failed within route handler");

        res.status(500).json({
            message: 'Journal crawling failed',
            error: error.message,
            stack: error.stack,
        });
        routeLogger.warn({ statusCode: 500 }, "Sent error response");
    }
}

// --- server_crawl.ts Route Definitions ---
app.post('/crawl-conferences', async (req: Request<{}, any, ConferenceData[]>, res: Response) => {
    await handleCrawlConferences(req, res);
});

app.post('/crawl-journals', async (req: Request, res: Response) => {
    await handleCrawlJournals(req, res);
});

// // --- Cron Job ---
// cron.schedule('0 2 * * *', checkUpcomingConferenceDates);
/////////////////////////////////////////////////////////////////////

import { performLogAnalysis } from './client/route/service'; // <<< Import service mới
import { LogAnalysisResult } from './client/types/logAnalysis'; // <<< Import interface


// --- Lưu trữ kết quả phân tích mới nhất ---
let latestOverallAnalysisResult: LogAnalysisResult | null = null;


// --- Chạy phân tích lần đầu khi server khởi động (Tùy chọn) ---
(async () => {
    logger.info('Performing initial log analysis on startup...');
    try {
        latestOverallAnalysisResult = await performLogAnalysis();
        logger.info('Initial log analysis completed.');
    } catch (error) {
        logger.error({ err: error }, 'Initial log analysis failed.');
    }
})();

// --- Cron Job để phân tích định kỳ ---
// Ví dụ: Chạy mỗi phút
cron.schedule('30 * * * *', async () => {
    logger.info('[Cron] Running scheduled log analysis...');
    try {
        const results = await performLogAnalysis();
        latestOverallAnalysisResult = results; // Cập nhật kết quả mới nhất
        io.emit('log_analysis_update', results); // <<< Phát sự kiện đến tất cả client
        logger.info('[Cron] Log analysis finished and results emitted via Socket.IO.');
    } catch (error) {
        logger.error({ err: error }, '[Cron] Scheduled log analysis failed.');
        // Quyết định xem có nên emit lỗi không, hoặc giữ nguyên latestOverallAnalysisResult cũ
    }
});


// Route để lấy dữ liệu phân tích, chấp nhận bộ lọc thời gian
app.get('/api/v1/logs/analysis/latest', async (req: Request, res: Response) => {
    try {
        // Đọc và parse tham số query (dạng string) thành number (milliseconds)
        const filterStartTimeStr = req.query.filterStartTime as string | undefined;
        const filterEndTimeStr = req.query.filterEndTime as string | undefined;

        let filterStartTime: number | undefined = undefined;
        let filterEndTime: number | undefined = undefined;

        if (filterStartTimeStr && !isNaN(parseInt(filterStartTimeStr, 10))) {
            filterStartTime = parseInt(filterStartTimeStr, 10);
        }

        if (filterEndTimeStr && !isNaN(parseInt(filterEndTimeStr, 10))) {
            filterEndTime = parseInt(filterEndTimeStr, 10);
        }

        console.log(`Backend received request with filterStartTime: ${filterStartTime}, filterEndTime: ${filterEndTime}`);

        // Gọi hàm phân tích với các tham số thời gian (hoặc undefined nếu không có)
        const results = await performLogAnalysis(filterStartTime, filterEndTime);

        // Cập nhật kết quả mới nhất *tổng thể* nếu không có bộ lọc (dành cho socket?)
        // Hoặc bạn có thể quyết định không cần biến này nữa nếu socket cũng gửi dữ liệu lọc.
        // Tạm thời vẫn cập nhật nếu không lọc:
        if (filterStartTime === undefined && filterEndTime === undefined) {
            latestOverallAnalysisResult = results;
        }

        // Trả về kết quả (đã lọc hoặc không)
        res.status(200).json(results);

    } catch (error: any) {
        console.error("Error performing log analysis:", error);
        // Có thể trả về lỗi cụ thể hơn
        // Kiểm tra xem lỗi có phải do chưa có dữ liệu không
        if (error.message === 'No log data found for the specified period') {
            res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period.' });
        } else {
            res.status(500).json({ message: 'Failed to perform log analysis.', error: error.message });
        }
    }
});






///////////////////////////////////////////

// import { Server as SocketIOServer, Socket } from 'socket.io'; // Import Socket.IO types
import { handleUserInputStreaming } from './chatbot/handlers/intentHandler'; // We'll adapt this handler
import logToFile from './chatbot/utils/logger';
import { HistoryItem, ErrorUpdate } from './chatbot/shared/types'; // Keep shared types



// --- Basic Logging Middleware (Keep as is) ---
app.use((req: Request, res: Response, next: NextFunction) => {
    // ... (keep existing logging middleware for standard HTTP requests if any) ...
    // You might want less logging here if most traffic moves to sockets
    if (!req.url.startsWith('/socket.io/')) { // Avoid logging socket.io polls/requests
        const start = Date.now();
        logToFile(`Incoming HTTP Request: ${req.method} ${req.url}`);
        res.on('finish', () => {
            const duration = Date.now() - start;
            logToFile(`HTTP Response Sent: ${res.statusCode} for ${req.method} ${req.url} in ${duration}ms`);
        });
    }
    next();
});

// --- REMOVE the OLD SSE Endpoint ---
// app.post('/api/stream-chat', streamChatHandler); // DELETE or comment out this line

// --- Socket.IO Connection Logic ---
io.on('connection', (socket: Socket) => {
    logToFile(`[Socket.IO] Client connected: ${socket.id}`);

    // --- Handle Incoming Chat Messages ---
    socket.on('send_message', async (data: { userInput: string; history: HistoryItem[] }) => {
        const { userInput, history } = data;
        logToFile(`[Socket.IO ${socket.id}] Received 'send_message': UserInput = ${userInput}`);

        if (!userInput || typeof userInput !== 'string' || !userInput.trim()) {
            logToFile(`[Socket.IO ${socket.id}] Invalid 'send_message' data: Missing or invalid userInput`);
            // Send error back to *this specific client*
            socket.emit('chat_error', {
                type: 'error',
                message: 'Invalid request: Missing or invalid userInput',
                step: 'validation' // Add step if helpful
            } as ErrorUpdate);
            return;
        }

        try {
            // --- *** ADAPTED Handler Call *** ---
            // Pass the socket instance instead of response object
            // The handler will now use socket.emit instead of res.write
            await handleUserInputStreaming(
                userInput,
                history || [], // Ensure history is an array
                socket // Pass the socket object
            );
            // The handler is now responsible for emitting results/errors/status
            logToFile(`[Socket.IO ${socket.id}] handleUserInputStreaming finished for: "${userInput}"`);

        } catch (error: any) {
            logToFile(`[Socket.IO ${socket.id}] CRITICAL Error during 'send_message' handling: ${error.message}, Stack: ${error.stack}`);
            // Send a generic error back to the client if the handler failed unexpectedly
            try {
                socket.emit('chat_error', {
                    type: 'error',
                    message: error.message || 'An unexpected server error occurred while processing your message.',
                    step: 'handler_exception' // Add step if helpful
                } as ErrorUpdate);
            } catch (emitError: any) {
                 logToFile(`[Socket.IO ${socket.id}] FAILED to emit critical error to client: ${emitError.message}`);
            }
        }
    });

    // --- Handle Disconnection ---
    socket.on('disconnect', (reason: string) => {
        logToFile(`[Socket.IO] Client disconnected: ${socket.id}. Reason: ${reason}`);
        // IMPORTANT: The handleUserInputStreaming function MUST check
        // `socket.connected` before/after long operations to stop processing
        // if the client disconnects mid-way. Socket.IO doesn't automatically
        // kill the async operations started for a disconnected socket.
    });

     // --- Optional: Handle other socket errors ---
     socket.on('error', (err) => {
        logToFile(`[Socket.IO ${socket.id}] Socket Error: ${err.message}`);
     });
});


// --- Start Server ---
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server (including Socket.IO) is running on port ${PORT}`); // Original console log
    // logToFile(`Server (including Socket.IO) started on port ${PORT}`);
});