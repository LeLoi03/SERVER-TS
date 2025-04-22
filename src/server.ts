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
import { handleNonStreaming , handleStreaming } from './chatbot/handlers/intentHandler'; // Chỉ cần handleStreaming nếu chỉ dùng socket
import { HistoryItem, ErrorUpdate, ConfirmSendEmailAction } from './chatbot/shared/types';
import { createLogAnalysisRouter } from './client/route/logAnalysisRoutes'; // <<< Import hàm tạo router
import { Language } from './chatbot/shared/types';
import jwt from 'jsonwebtoken'; // <<< Import JWT
import { handleUserEmailCancellation, handleUserEmailConfirmation, stageEmailConfirmation } from './chatbot/utils/confirmationManager';
import { FrontendAction } from './chatbot/shared/types';

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


// --- Socket.IO Connection Handling ---
io.on('connection', (socket: Socket) => {
    const socketId = socket.id;
    const authenticatedToken = socket.data.token as string | null; // Attached by middleware

    if (authenticatedToken) {
        logToFile(`[Socket.IO] Client connected: ${socketId} (Authenticated via Token)`);
    } else {
        logToFile(`[Socket.IO] Client connected: ${socketId} (Anonymous)`);
    }

    sessionHistories.set(socketId, []);
    logToFile(`[Socket.IO ${socketId}] Initialized empty chat history.`);

    socket.on('disconnect', (reason: string) => {
        const token = socket.data.token as string | null;
        logToFile(`[Socket.IO] Client disconnected: ${socketId}. Reason: ${reason}`);
        if (token) logToFile(`[Socket.IO ${socketId}] Authenticated user disconnected.`);
        else logToFile(`[Socket.IO ${socketId}] Anonymous user disconnected.`);
        sessionHistories.delete(socketId);
        logToFile(`[Socket.IO ${socketId}] Removed chat history.`);
        // Clean up any pending confirmations specifically for this socket?
        // Might be complex if user reconnects quickly. Timeout handles cleanup eventually.
    });

    socket.on('error', (err: Error) => { logToFile(`[Socket.IO ${socketId}] Socket Error: ${err.message}`); });

    // --- Handle 'send_message' ---
    socket.on('send_message', async (data: { userInput: string; isStreaming?: boolean; language: Language }) => {
        const { userInput, isStreaming = true, language } = data;
        const handlerId = `MsgHandler-${Date.now()}`; // Unique ID for this message handling
        logToFile(`[Socket.IO ${socketId}] Received 'send_message': UserInput = "${userInput}", Streaming = ${isStreaming}, Language = ${language}, HandlerId: ${handlerId}`);

        const currentHistory = sessionHistories.get(socketId);
        if (currentHistory === undefined) {
            logToFile(`[Socket.IO ${socketId}] CRITICAL Error: History not found. Re-initializing.`);
            sessionHistories.set(socketId, []);
            return socket.emit('chat_error', { type: 'error', message: 'Internal server error: Session history lost. Please refresh.', step: 'history_missing' } as ErrorUpdate);
        }

        try {
            let updatedHistory: HistoryItem[] | void;
            let resultAction: FrontendAction | undefined = undefined; // Variable to capture action from handlers

            // --- Define a callback to potentially receive action from handlers ---
            // This part is tricky, how intentHandler returns the action needs adjustment
            // For non-streaming, it's easier as it returns the final state.
            // For streaming, the action might come with the *final* chunk.
            // Let's assume for now handleNonStreaming can return { history: updatedHistory, action: resultAction }
            // And handleStreaming might emit a final event containing the action.

            if (isStreaming) {
                logToFile(`[Socket.IO ${socketId} ${handlerId}] Calling handleStreaming...`);
                // NOTE: handleStreaming needs modification to potentially emit the frontendAction
                // with its *final* 'chat_result' or a separate 'final_action' event.
                // For now, we assume it handles emits internally, including potential action staging.
                // We might need a more complex structure if handleStreaming needs to return the action
                // *before* finishing streaming the text.
                updatedHistory = await handleStreaming(
                    userInput,
                    currentHistory,
                    socket,
                    language,
                    handlerId, // Pass handlerId
                    (action) => { // A callback passed into handleStreaming to receive the action
                        if (action?.type === 'confirmEmailSend') {
                            stageEmailConfirmation(
                                action.payload as ConfirmSendEmailAction, // Type assertion
                                socket.data.token,
                                socketId,
                                handlerId, // Use the message handler ID
                                io // Pass io instance
                            );
                        }
                    }
                );

                // If handleStreaming returned the history directly
                if (updatedHistory) {
                    sessionHistories.set(socketId, updatedHistory);
                    logToFile(`[Socket.IO ${socketId} ${handlerId}] Updated history from Streaming Handler stored (${updatedHistory.length} items).`);
                } else {
                    logToFile(`[Socket.IO ${socketId} ${handlerId}] Streaming Handler finished, history managed internally or failed.`);
                }

            } else {
                logToFile(`[Socket.IO ${socketId} ${handlerId}] Calling handleNonStreaming...`);
                // Modify handleNonStreaming to return an object if needed
                const handlerResult = await handleNonStreaming(
                    userInput,
                    currentHistory,
                    socket,
                    language,
                    handlerId // Pass handlerId
                );

                // Assuming handleNonStreaming now returns { history: HistoryItem[], action?: FrontendAction }
                if (handlerResult) {
                    updatedHistory = handlerResult.history;
                    resultAction = handlerResult.action; // Capture action returned by non-streaming handler
                    sessionHistories.set(socketId, updatedHistory);
                    logToFile(`[Socket.IO ${socketId} ${handlerId}] Updated history from NonStreaming Handler stored (${updatedHistory.length} items).`);

                    // --- STAGE CONFIRMATION IF ACTION RECEIVED ---
                    if (resultAction?.type === 'confirmEmailSend') {
                        stageEmailConfirmation(
                            resultAction.payload as ConfirmSendEmailAction, // Type assertion
                            socket.data.token, // Get token associated with the socket
                            socketId,
                            handlerId, // Use the message handler ID
                            io // Pass io instance
                        );
                        // Action already sent to frontend by intentHandler's safeEmit
                    }
                } else {
                    logToFile(`[Socket.IO ${socketId} ${handlerId}] NonStreaming Handler did not return updated history.`);
                    // Decide how to handle this - maybe keep old history?
                }

            }

        } catch (error: any) {
            logToFile(`[Socket.IO ${socketId} ${handlerId}] CRITICAL Error during handler execution: ${error.message}\nStack: ${error.stack}`);
            try {
                if (socket.connected) {
                    socket.emit('chat_error', {
                        type: 'error',
                        message: error.message || 'An unexpected server error occurred.',
                        step: 'handler_exception',
                    } as ErrorUpdate);
                }
            } catch (emitError: any) {
                logToFile(`[Socket.IO ${socketId}] FAILED to emit critical error: ${emitError.message}`);
            }
            sessionHistories.set(socketId, []); // Reset history on error
        }
    });


    // --- LISTEN FOR USER CONFIRMATION/CANCELLATION EVENTS ---
    socket.on('user_confirm_email', (data: { confirmationId: string }) => {
        if (data && data.confirmationId) {
            logToFile(`[Socket.IO ${socketId}] Received 'user_confirm_email' for ID: ${data.confirmationId}`);
            handleUserEmailConfirmation(data.confirmationId, socket); // Pass socket for reply
        } else {
            logToFile(`[Socket.IO ${socketId}] Received invalid 'user_confirm_email' event data: ${JSON.stringify(data)}`);
        }
    });

    socket.on('user_cancel_email', (data: { confirmationId: string }) => {
        if (data && data.confirmationId) {
            logToFile(`[Socket.IO ${socketId}] Received 'user_cancel_email' for ID: ${data.confirmationId}`);
            handleUserEmailCancellation(data.confirmationId, socket); // Pass socket for reply
        } else {
            logToFile(`[Socket.IO ${socketId}] Received invalid 'user_cancel_email' event data: ${JSON.stringify(data)}`);
        }
    });

}); // End io.on('connection')



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