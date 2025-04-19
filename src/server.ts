import express, { Request, Response, NextFunction } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import bodyParser from 'body-parser';
import cron from 'node-cron';
import { logger } from './conference/11_utils';
import { handleCrawlConferences, handleCrawlJournals } from './crawl/crawl';
import { performLogAnalysis } from './client/service/logAnalysisService';
import { LogAnalysisResult } from './client/types/logAnalysis';

import { handleUserInputStreaming } from './chatbot/handlers/intentHandler';
import logToFile from './chatbot/utils/logger';
import { HistoryItem, ErrorUpdate } from './chatbot/shared/types';
import { saveCrawlConferenceFromCsvToJson } from './client/route/client/saveCrawlConferenceFromCsvToJson';

const app = express();


// --- CORS Configuration ---
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || ['http://localhost:8386'];
logToFile(`[Server] Allowed CORS Origins: ${allowedOrigins.join(', ')}`);
const corsOptions = {
    origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
        // Allow requests with no origin (like mobile apps or curl requests) during development maybe, or be stricter
        if (!origin || allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            logToFile(`[CORS] Blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


const httpServer = new HttpServer(app);
export const io = new SocketIOServer(httpServer, { // <<< Export 'io'
    cors: {
        origin: "*", // <<< Cấu hình CORS chặt chẽ hơn
        methods: ["GET", "POST"]
    }
});


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

app.use(bodyParser.urlencoded({ extended: true }));
// --- Basic Route ---
app.get('/', (req, res) => {
    res.send('Crawl, Chatbot Server is Running');
});

// --- server_crawl.ts Route Definitions ---
app.post('/crawl-conferences', handleCrawlConferences);
app.post('/crawl-journals', handleCrawlJournals);
app.post('/api/v1/conference/save-to-json', async (req: Request, res: Response) => {
    console.log('Received request to save conference from CSV to JSON.');
    console.log(`Request body: ${JSON.stringify(req.body)}`);
    return req.body
})

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



// --- Store History Per Socket Connection ---
// IMPORTANT: This is in-memory storage. For production, consider a more persistent
// solution (Redis, database) if you need history to survive server restarts or scale horizontally.
const sessionHistories: Map<string, HistoryItem[]> = new Map();

// --- Socket.IO Connection Logic ---
io.on('connection', (socket: Socket) => {
    logToFile(`[Socket.IO] Client connected: ${socket.id}`);

    // Initialize history for this session
    sessionHistories.set(socket.id, []);
    logToFile(`[Socket.IO ${socket.id}] Initialized empty history.`);

    // --- Handle Incoming Chat Messages ---
    // Expecting only { userInput: string } from the client now
    socket.on('send_message', async (data: { userInput: string }) => {
        const { userInput } = data; // Only userInput is expected
        const socketId = socket.id;

        logToFile(`[Socket.IO ${socketId}] Received 'send_message': UserInput = "${userInput}"`);

        if (!userInput || typeof userInput !== 'string' || !userInput.trim()) {
            logToFile(`[Socket.IO ${socketId}] Invalid 'send_message' data: Missing or invalid userInput.`);
            socket.emit('chat_error', {
                type: 'error',
                message: 'Invalid request: Missing or invalid userInput.',
                step: 'validation',
            } as ErrorUpdate);
            return;
        }

        // Retrieve the current history for *this* socket
        const currentHistory = sessionHistories.get(socketId);
        if (currentHistory === undefined) {
            // Should not happen if initialized correctly, but handle defensively
            logToFile(`[Socket.IO ${socketId}] CRITICAL Error: History not found for connected socket. Re-initializing.`);
            sessionHistories.set(socketId, []); // Re-initialize
            // Optionally send an error to the client
            socket.emit('chat_error', {
                type: 'error',
                message: 'Internal server error: Session history lost. Please try again.',
                step: 'history_missing',
            } as ErrorUpdate);
            return; // Stop processing this message
        }

        logToFile(`[Socket.IO ${socketId}] Retrieved history with ${currentHistory.length} items.`);

        try {
            // --- Call the handler, passing the backend-managed history ---
            // The handler will now RETURN the updated history
            const updatedHistory = await handleUserInputStreaming(
                userInput,
                currentHistory, // Pass the retrieved history
                socket // Pass the socket object for emitting
            );

            // --- Store the updated history back ---
            if (updatedHistory) {
                sessionHistories.set(socketId, updatedHistory);
                logToFile(`[Socket.IO ${socketId}] Updated history stored (${updatedHistory.length} items).`);
            } else {
                // Handler might return void/undefined on critical internal error where history state is uncertain
                logToFile(`[Socket.IO ${socketId}] Warning: handleUserInputStreaming did not return updated history. History might be unchanged or invalid.`);
                // Decide if you want to clear history here or leave it as is
                // sessionHistories.set(socketId, []); // Example: Clear history
            }

            logToFile(`[Socket.IO ${socketId}] handleUserInputStreaming finished processing for: "${userInput}"`);

        } catch (error: any) {
            logToFile(`[Socket.IO ${socketId}] CRITICAL Error during 'send_message' handling: ${error.message}, Stack: ${error.stack}`);
            // Send a generic error back to the client if the handler failed unexpectedly
            try {
                // Ensure socket is still connected before emitting
                if (socket.connected) {
                    socket.emit('chat_error', {
                        type: 'error',
                        message: error.message || 'An unexpected server error occurred while processing your message.',
                        step: 'handler_exception',
                        // Include thoughts accumulated *before* the crash if possible, though likely empty/incomplete
                    } as ErrorUpdate);
                } else {
                    logToFile(`[Socket.IO ${socketId}] Client disconnected before critical handler error could be sent.`);
                }
            } catch (emitError: any) {
                logToFile(`[Socket.IO ${socketId}] FAILED to emit critical error to client: ${emitError.message}`);
            }
            // Optionally clear history on unhandled handler error
            // sessionHistories.set(socketId, []);
        }
    });

    // --- Handle Disconnection ---
    socket.on('disconnect', (reason: string) => {
        logToFile(`[Socket.IO] Client disconnected: ${socket.id}. Reason: ${reason}`);
        // Clean up history for the disconnected socket to prevent memory leaks
        sessionHistories.delete(socket.id);
        logToFile(`[Socket.IO ${socket.id}] Removed history from memory.`);
    });

    // --- Optional: Handle other socket errors ---
    socket.on('error', (err) => {
        logToFile(`[Socket.IO ${socket.id}] Socket Error: ${err.message}`);
        // Consider disconnecting the socket or other cleanup if necessary
        // socket.disconnect(true);
    });
});


// --- Start Server ---
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server (including Socket.IO) is running on port ${PORT}`); // Original console log
    // logToFile(`Server (including Socket.IO) started on port ${PORT}`);
});