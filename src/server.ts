import express, { Request, Response, NextFunction } from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from './conference/11_utils'; // Giả sử logger được cấu hình đúng
import logToFile from './chatbot/utils/logger'; // Giả sử logger này khác với pino logger?

import cors from 'cors';
import 'dotenv/config';
import cron from 'node-cron';
import { handleCrawlConferences, handleCrawlJournals } from './crawl/crawl';
import { performLogAnalysis } from './client/service/logAnalysisService';
import { LogAnalysisResult } from './client/types/logAnalysis';
import { handleNonStreaming, handleStreaming } from './chatbot/handlers/intentHandler'; // Chỉ cần handleStreaming nếu chỉ dùng socket
import { HistoryItem, ErrorUpdate } from './chatbot/shared/types';
import { createLogAnalysisRouter } from './client/route/logAnalysisRoutes'; // <<< Import hàm tạo router
import { Language } from './chatbot/shared/types';
import jwt from 'jsonwebtoken'; // <<< Import JWT

// --- Interface for Decoded Token Payload ---
// --- Interface for Decoded Token Payload (Optional but good practice) ---
// We might not use its content directly here, but it's good for verify structure
interface DecodedToken {
    // Expect fields required by your backend API authentication
    // Example: might still contain 'id' or 'sub' but we won't store it in socket.data.user
    [key: string]: any; // Allow other fields
    iat?: number;
    exp?: number;
}


// --- Core Application Setup ---
const app = express();
const httpServer = new HttpServer(app);

// --- Configuration ---
const PORT = process.env.PORT || 3001;
const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || [`http://localhost:8386`, `https://confhub.ddns.net`]; // Hoặc một port client khác
const JWT_SECRET = process.env.JWT_SECRET; // <<< Load your JWT secret key
if (!JWT_SECRET) {
    logToFile('[Server Config] CRITICAL ERROR: JWT_SECRET environment variable is not set!');
    process.exit(1); // Exit if secret is missing
}
logToFile(`[Server Config] Allowed CORS Origins: ${allowedOrigins.join(', ')}`);

// --- Global State Variables ---
// Dùng Map để lưu trữ socket của người dùng đã đăng ký (nếu cần map token -> socket)
// Dùng Map để lưu trữ lịch sử chat cho mỗi phiên kết nối socket
const sessionHistories: Map<string, HistoryItem[]> = new Map();
// Lưu trữ kết quả phân tích log mới nhất
let latestOverallAnalysisResult: LogAnalysisResult | null = null;

// --- CORS Configuration ---
const corsOptions = {
    // origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    //     // Cho phép yêu cầu không có origin (vd: mobile apps, curl) hoặc từ origin được phép
    //     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
    //         callback(null, true);
    //     } else {
    //         logToFile(`[CORS] Blocked origin: ${origin}`);
    //         callback(new Error(`Origin ${origin} not allowed by CORS`));
    //     }
    // },
    origin: "*", // Sửa thành "*" để cho phép tất cả các origin

    methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
    credentials: true,
};

// --- Middleware Setup ---
app.use(cors(corsOptions)); // Áp dụng CORS cho HTTP requests
app.use(express.json()); // Middleware để parse JSON bodies (thay thế bodyParser.json())
app.use(express.urlencoded({ extended: true })); // Middleware để parse URL-encoded bodies (thay thế bodyParser.urlencoded())

// --- Basic Logging Middleware ---
app.use((req: Request, res: Response, next: NextFunction) => {
    // Bỏ qua logging cho các request nội bộ của Socket.IO
    if (req.url.startsWith('/socket.io/')) {
        return next();
    }
    const start = Date.now();
    logToFile(`[HTTP Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
    res.on('finish', () => {
        const duration = Date.now() - start;
        logToFile(`[HTTP Response] ${res.statusCode} for ${req.method} ${req.originalUrl} in ${duration}ms`);
    });
    next();
});

// --- Socket.IO Setup ---
export const io = new SocketIOServer(httpServer, {
    cors: {
        origin: allowedOrigins, // Sử dụng cùng allowedOrigins với Express
        methods: ["GET", "POST"],
        credentials: true // Thường cần thiết nếu client gửi credentials (cookies, auth headers)
    }
});



// --- Socket.IO Authentication Middleware (REVISED - Token Only) ---
io.use((socket: Socket, next) => {
    const token = socket.handshake.auth.token as string | undefined;
    const socketId = socket.id;

    logToFile(`[Socket Auth Middleware] Attempting auth for socket ${socketId}. Token provided: ${!!token}`);

    if (!token) {
        logToFile(`[Socket Auth Middleware] No token provided for socket ${socketId}. Allowing anonymous connection.`);
        socket.data.token = null; // Mark as anonymous / no token
        return next(); // Allow connection
    }

    try {
        // Verify the token's validity (signature, expiration)
        jwt.verify(token, JWT_SECRET); // We don't need the decoded payload here

        // --- Token is valid ---
        logToFile(`[Socket Auth Middleware] Token validated successfully for socket ${socketId}.`);

        // Attach ONLY the token to the socket data
        socket.data.token = token;

        next(); // Proceed to the connection handler

    } catch (err: any) {
        // --- Token is invalid or expired ---
        logToFile(`[Socket Auth Middleware] Token validation failed for socket ${socketId}. Reason: ${err.message}`);
        const error = new Error(`Authentication error: Invalid or expired token.`); // More generic error
        // error.data = { code: 'AUTH_FAILED', message: err.message };
        next(error); // Reject the connection
    }
});
// --- End Socket.IO Authentication Middleware ---


// --- Socket.IO Connection Handling (REVISED - Token Only) ---
io.on('connection', (socket: Socket) => {
    const socketId = socket.id;
    const authenticatedToken = socket.data.token as string | null; // Get token attached by middleware

    // Log connection status based on token presence
    if (authenticatedToken) {
        logToFile(`[Socket.IO] Client connected: ${socketId} (Authenticated via Token)`);
        // No need to manage connectedUsers map here based on token alone usually
    } else {
        logToFile(`[Socket.IO] Client connected: ${socketId} (Anonymous)`);
    }

    sessionHistories.set(socketId, []);
    logToFile(`[Socket.IO ${socketId}] Initialized empty chat history.`);

    // --- Disconnect Handling (REVISED) ---
    socket.on('disconnect', (reason: string) => {
        const token = socket.data.token as string | null;
        logToFile(`[Socket.IO] Client disconnected: ${socketId}. Reason: ${reason}`);
        if (token) {
            logToFile(`[Socket.IO ${socketId}] Authenticated user (identified by token) disconnected.`);
            // Remove from connectedUsers if you were tracking by token, but likely not needed
        } else {
            logToFile(`[Socket.IO ${socketId}] Anonymous user disconnected.`);
        }
        sessionHistories.delete(socketId);
        logToFile(`[Socket.IO ${socketId}] Removed chat history.`);
    });

    // --- Error Handling (Keep as is) ---
    socket.on('error', (err: Error) => { logToFile(`[Socket.IO ${socketId}] Socket Error: ${err.message}`); });

    // --- Handle 'send_message' (Keep as is - it calls intentHandler) ---
    socket.on('send_message', async (data: { userInput: string; isStreaming?: boolean; language: Language }) => {
        const { userInput, isStreaming = true, language } = data;
        // <<< IMPORTANT: Add Auth Check before calling handlers that require it >>>
        // Example: Check if the requested action requires auth
        // if (actionRequiresAuth(userInput) && !socket.data.user) {
        //      logToFile(`[Socket.IO ${socketId}] Blocked unauthorized attempt for input: ${userInput}`);
        //      return socket.emit('chat_error', { type: 'error', message: 'You must be logged in to perform this action.', step: 'authorization' } as ErrorUpdate);
        // }
        // For follow/unfollow, the check happens *inside* executeFunctionCall


        logToFile(`[Socket.IO ${socketId}] Received 'send_message': UserInput = "${userInput}", Streaming = ${isStreaming}, Language = ${language}`);
        const currentHistory = sessionHistories.get(socketId);
        if (currentHistory === undefined) {
            logToFile(`[Socket.IO ${socketId}] CRITICAL Error: History not found. Re-initializing.`);
            sessionHistories.set(socketId, []);
            return socket.emit('chat_error', { type: 'error', message: 'Internal server error: Session history lost. Please refresh.', step: 'history_missing' } as ErrorUpdate);
        }
        logToFile(`[Socket.IO ${socketId}] Retrieved history with ${currentHistory.length} items.`);


        try {
            let updatedHistory;

            if (isStreaming) {
                // --- Gọi Handler Streaming ---
                logToFile(`[Socket.IO ${socketId}] Calling handleStreaming...`);
                // handleStreaming sẽ tự emit 'status_update', 'chat_update', 'chat_result'/'chat_error'
                // Nó cũng nên trả về lịch sử đã cập nhật (bao gồm cả phản hồi cuối cùng của assistant)
                updatedHistory = await handleStreaming(
                    userInput, // userInput thực ra không cần nữa nếu đã thêm vào historyForHandler? Xem lại logic handleStreaming
                    currentHistory, // <<< Truyền lịch sử đã bao gồm input của user
                    socket,
                    language // <<< Pass language

                );
                logToFile(`[Socket.IO ${socketId}] handleStreaming finished.`);

            } else {
                // --- Gọi Handler Non-Streaming ---
                logToFile(`[Socket.IO ${socketId}] Calling handleNonStreaming...`);
                // Giả sử handleNonStreaming trả về một object chứa kết quả cuối cùng
                // Nó KHÔNG emit gì cả.
                updatedHistory = await handleNonStreaming(
                    userInput,
                    currentHistory, // Pass the retrieved history
                    socket, // Pass the socket object for emitting
                    language // <<< Pass language

                );
            }

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

        } catch (error: any) {
            logToFile(`[Socket.IO ${socketId}] CRITICAL Error during handler execution: ${error.message}\nStack: ${error.stack}`);
            try {
                if (socket.connected) {
                    socket.emit('chat_error', {
                        type: 'error',
                        message: error.message || 'An unexpected server error occurred during processing.',
                        step: 'handler_exception',
                        // thoughts: error.thoughts // Nếu lỗi có chứa thoughts
                    } as ErrorUpdate);
                }
            } catch (emitError: any) {
                logToFile(`[Socket.IO ${socketId}] FAILED to emit critical error to client: ${emitError.message}`);
            }
            // Khi có lỗi, có thể reset history về trạng thái trước khi xử lý
            sessionHistories.set(socketId, []);
        }
    });

});



// --- HTTP Route Definitions ---

// Basic Root Route
app.get('/', (req: Request, res: Response) => {
    res.send('Crawl, Chatbot, and Log Analysis Server is Running');
});

// Crawl Routes
app.post('/crawl-conferences', handleCrawlConferences);
app.post('/crawl-journals', handleCrawlJournals);

// --- Log Analysis API Routes ---
// Tạo router bằng cách gọi hàm tạo và truyền dependencies
const logAnalysisRouter = createLogAnalysisRouter({
    performLogAnalysisService: performLogAnalysis, // Truyền hàm service
    routeLogger: logger                    // Truyền instance logger
});
// Mount router vào ứng dụng với base path
app.use('/api/v1/logs/analysis', logAnalysisRouter); // <<< Mount router


// --- Scheduled Tasks (Cron Jobs) ---

// Initial Log Analysis on Startup (Optional)
(async () => {
    logger.info('Performing initial log analysis on startup...');
    try {
        latestOverallAnalysisResult = await performLogAnalysis();
        logger.info('Initial log analysis completed successfully.');
    } catch (error) {
        logger.error({ err: error }, 'Initial log analysis failed.');
    }
})();

// Periodic Log Analysis Cron Job (e.g., every hour at 30 minutes past)
cron.schedule('30 * * * *', async () => {
    logger.info('[Cron] Running scheduled log analysis...');
    try {
        const results = await performLogAnalysis(); // Perform analysis without filters
        latestOverallAnalysisResult = results; // Update the latest global results
        io.emit('log_analysis_update', results); // Broadcast the update to ALL connected clients
        logger.info('[Cron] Log analysis finished and results broadcasted via Socket.IO.');
    } catch (error) {
        logger.error({ err: error }, '[Cron] Scheduled log analysis failed.');
        // Decide whether to emit an error event or keep the old `latestOverallAnalysisResult`
        io.emit('log_analysis_error', { message: 'Scheduled log analysis failed.', timestamp: new Date() });
    }
});


// --- Start Server ---
httpServer.listen(PORT, () => {
    console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}`);
    logger.info(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}. Allowed origins: ${allowedOrigins.join(', ')}`);
    logToFile(`[Server Start] Server listening on port ${PORT}.`); // Use logToFile as well if needed
});

// Optional: Graceful Shutdown Handling
process.on('SIGTERM', () => {
    logger.info('SIGTERM signal received: closing HTTP server');
    httpServer.close(() => {
        logger.info('HTTP server closed');
        // Close database connections, etc.
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    logger.info('SIGINT signal received: closing HTTP server');
    httpServer.close(() => {
        logger.info('HTTP server closed');
        process.exit(0);
    });
});