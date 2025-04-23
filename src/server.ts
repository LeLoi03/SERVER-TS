// import express, { Request, Response, NextFunction } from 'express';
// import { Server as HttpServer } from 'http';
// import { Server as SocketIOServer, Socket } from 'socket.io';
// import { logger } from './conference/11_utils'; // Giả sử logger được cấu hình đúng
// import logToFile from './chatbot/utils/logger'; // Giả sử logger này khác với pino logger?

// import cors from 'cors';
// import 'dotenv/config';
// import cron from 'node-cron';
// import { handleCrawlConferences, handleCrawlJournals } from './crawl/crawl';
// import { performLogAnalysis } from './client/service/logAnalysisService';
// import { LogAnalysisResult } from './client/types/logAnalysis';
// import { handleNonStreaming, handleStreaming } from './chatbot/handlers/intentHandler'; // Chỉ cần handleStreaming nếu chỉ dùng socket
// import { HistoryItem, ErrorUpdate, ConfirmSendEmailAction } from './chatbot/shared/types';
// import { createLogAnalysisRouter } from './client/route/logAnalysisRoutes'; // <<< Import hàm tạo router
// import { Language } from './chatbot/shared/types';
// import jwt from 'jsonwebtoken'; // <<< Import JWT
// import { handleUserEmailCancellation, handleUserEmailConfirmation, stageEmailConfirmation } from './chatbot/utils/confirmationManager';
// import { FrontendAction } from './chatbot/shared/types';
// import { ConversationHistoryService } from './chatbot/services/conversationHistory.service'; // Import service
// import crypto from 'crypto'; // Import crypto

// import mongoose from 'mongoose';
// import { MONGODB_URI } from './config'; // Lấy URI từ biến môi trường/config 
// import { mapHistoryToFrontendMessages } from './chatbot/utils/historyMapper';

// // --- Hàm kết nối DB (có thể đặt trong file riêng như src/config/database.ts) ---
// const connectDB = async () => {
//     try {
//         logToFile('[Database] Attempting MongoDB connection...');
//         await mongoose.connect(MONGODB_URI!, {
//             // serverSelectionTimeoutMS: 5000 // Có thể giảm timeout nếu muốn fail nhanh hơn khi có lỗi
//         });
//         logToFile('[Database] MongoDB Connected Successfully.');
//     } catch (error: any) {
//         logToFile(`[Database] MongoDB Connection Error: ${error.message}`);
//         logToFile(`[Database] URI Used: ${MONGODB_URI}`); // Log URI để kiểm tra
//         // Ném lỗi ra ngoài để hàm startServer bắt được
//         process.exit(1); // Exit if secret is missing
//     }
// };

// async function connectToDB() {

//     await connectDB(); // Đảm bảo kết nối xong trước khi tiếp tục
// }

// connectToDB();

// // --- Interface for Decoded Token Payload (Optional but good practice) ---
// // We might not use its content directly here, but it's good for verify structure
// interface DecodedToken {
//     // Expect fields required by your backend API authentication
//     // Example: might still contain 'id' or 'sub' but we won't store it in socket.data.user
//     [key: string]: any; // Allow other fields
//     iat?: number;
//     exp?: number;
// }


// // --- Core Application Setup ---
// const app = express();
// const httpServer = new HttpServer(app);

// // --- Configuration ---
// const PORT = process.env.PORT || 3001;
// const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS?.split(',') || [`http://localhost:8386`, `https://confhub.ddns.net`]; // Hoặc một port client khác
// const JWT_SECRET = process.env.JWT_SECRET; // <<< Load your JWT secret key
// if (!JWT_SECRET) {
//     logToFile('[Server Config] CRITICAL ERROR: JWT_SECRET environment variable is not set!');
//     process.exit(1); // Exit if secret is missing
// }
// logToFile(`[Server Config] Allowed CORS Origins: ${allowedOrigins.join(', ')}`);

// // --- Global State Variables ---
// // Dùng Map để lưu trữ socket của người dùng đã đăng ký (nếu cần map token -> socket)
// // Dùng Map để lưu trữ lịch sử chat cho mỗi phiên kết nối socket
// const sessionHistories: Map<string, HistoryItem[]> = new Map();
// // Lưu trữ kết quả phân tích log mới nhất
// let latestOverallAnalysisResult: LogAnalysisResult | null = null;

// // --- CORS Configuration ---
// const corsOptions = {
//     // origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
//     //     // Cho phép yêu cầu không có origin (vd: mobile apps, curl) hoặc từ origin được phép
//     //     if (!origin || allowedOrigins.indexOf(origin) !== -1) {
//     //         callback(null, true);
//     //     } else {
//     //         logToFile(`[CORS] Blocked origin: ${origin}`);
//     //         callback(new Error(`Origin ${origin} not allowed by CORS`));
//     //     }
//     // },
//     origin: "*", // Sửa thành "*" để cho phép tất cả các origin

//     methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
//     credentials: true,
// };

// // --- Middleware Setup ---
// app.use(cors(corsOptions)); // Áp dụng CORS cho HTTP requests
// app.use(express.json()); // Middleware để parse JSON bodies (thay thế bodyParser.json())
// app.use(express.urlencoded({ extended: true })); // Middleware để parse URL-encoded bodies (thay thế bodyParser.urlencoded())

// // --- Basic Logging Middleware ---
// app.use((req: Request, res: Response, next: NextFunction) => {
//     // Bỏ qua logging cho các request nội bộ của Socket.IO
//     if (req.url.startsWith('/socket.io/')) {
//         return next();
//     }
//     const start = Date.now();
//     logToFile(`[HTTP Request] ${req.method} ${req.originalUrl} from ${req.ip}`);
//     res.on('finish', () => {
//         const duration = Date.now() - start;
//         logToFile(`[HTTP Response] ${res.statusCode} for ${req.method} ${req.originalUrl} in ${duration}ms`);
//     });
//     next();
// });

// // --- Socket.IO Setup ---
// export const io = new SocketIOServer(httpServer, {
//     cors: {
//         origin: allowedOrigins, // Sử dụng cùng allowedOrigins với Express
//         methods: ["GET", "POST"],
//         credentials: true // Thường cần thiết nếu client gửi credentials (cookies, auth headers)
//     }
// });


// const conversationHistoryService = new ConversationHistoryService(); // Khởi tạo instance


// // --- Socket.IO Authentication Middleware (REVISED - Token Only) ---
// io.use((socket: Socket, next) => {
//     const token = socket.handshake.auth.token as string | undefined;
//     const socketId = socket.id;
//     logToFile(`[Socket Auth Middleware] Attempting auth for socket ${socketId}. Token provided: ${!!token}`);

//     if (!token) {
//         logToFile(`[Socket Auth Middleware] No token provided for socket ${socketId}. Allowing anonymous connection.`);
//         socket.data.userIdentifier = null; // Đánh dấu là anonymous
//         socket.data.token = null;
//         return next();
//     }

//     try {
//         // Chỉ Verify token, không cần decode payload ở đây nữa
//         jwt.verify(token, JWT_SECRET);

//         // --- Token is valid ---
//         logToFile(`[Socket Auth Middleware] Token validated successfully for socket ${socketId}.`);

//         // --- Tạo định danh từ hash của token ---
//         const userIdentifier = crypto.createHash('sha256').update(token).digest('hex');
//         logToFile(`[Socket Auth Middleware] Generated User Identifier (hash): ${userIdentifier.substring(0, 10)}... for socket ${socketId}`);

//         // --- Lưu định danh (hash) và token gốc vào socket data ---
//         socket.data.userIdentifier = userIdentifier; // Dùng để query DB
//         socket.data.token = token; // Giữ lại token gốc nếu cần cho các việc khác (ví dụ: stageEmailConfirmation)

//         next(); // Proceed

//     } catch (err: any) {
//         // --- Token is invalid or expired ---
//         logToFile(`[Socket Auth Middleware] Token validation failed for socket ${socketId}. Reason: ${err.message}`);
//         const error = new Error(`Authentication error: Invalid or expired token.`);
//         next(error); // Reject
//     }
// });

// // --- End Socket.IO Authentication Middleware ---

// io.on('connection', async (socket: Socket) => {
//     const socketId = socket.id;
//     const userId = socket.data.userId as string | undefined;

//     if (userId) {
//         logToFile(`[Socket.IO ${socketId}] Authenticated user ${userId} connected.`);
//         try {
//             const { conversationId, history } = await conversationHistoryService.startOrResumeConversation(userId);
//             socket.data.conversationId = conversationId;
//             logToFile(`[Socket.IO ${socketId}] Resumed/Started conversation ${conversationId} for user ${userId}. Initial history length: ${history.length}`);

//             // --- GỬI LỊCH SỬ BAN ĐẦU VỀ CLIENT ---
//             const initialHistoryLimit = 20; // Số lượng tin nhắn cuối cùng cần gửi
//             const historyToSend = history.slice(-initialHistoryLimit); // Lấy N tin nhắn cuối

//             // --- QUAN TRỌNG: Map sang định dạng Frontend trước khi gửi ---
//             const frontendMessages = mapHistoryToFrontendMessages(historyToSend);

//             logToFile(`[Socket.IO ${socketId}] Sending initial history (${frontendMessages.length} messages) for conv ${conversationId}`);
//             socket.emit('initial_history', {
//                 conversationId: conversationId,
//                 messages: frontendMessages // Gửi dữ liệu đã map
//             });
//             // -----------------------------------------

//         } catch (error: any) {
//             logToFile(`[Socket.IO ${socketId}] CRITICAL Error starting/resuming conversation for user ${userId}: ${error.message}`);
//             socket.emit('chat_error', { type: 'error', message: 'Could not load your chat history. Please try again later.', step: 'history_load_fail' });
//             socket.disconnect(true);
//             return;
//         }
//     } else {
//         logToFile(`[Socket.IO ${socketId}] Anonymous user connected. History persistence not enabled in Phase 1.`);
//         socket.data.conversationId = null;
//     }

//     socket.on('disconnect', (reason: string) => {
//         // --- Log userIdentifier khi disconnect ---
//         const identifierOnDisconnect = socket.data.userIdentifier as string | undefined;
//         const convIdOnDisconnect = socket.data.conversationId as string | undefined;
//         logToFile(`[Socket.IO] Client disconnected: ${socketId}. Reason: ${reason}. Identifier: ${identifierOnDisconnect ? identifierOnDisconnect.substring(0, 10) + '...' : 'Anonymous'}. ConvID: ${convIdOnDisconnect || 'N/A'}`);
//     });

//     socket.on('error', (err: Error) => { logToFile(`[Socket.IO ${socketId}] Socket Error: ${err.message}`); });

//     // --- Handle 'send_message' ---
//     socket.on('send_message', async (data: { userInput: string; isStreaming?: boolean; language: Language }) => {
//         const { userInput, isStreaming = true, language } = data;
//         const handlerId = `MsgHandler-${Date.now()}`;
//         const conversationId = socket.data.conversationId as string | undefined;
//         // --- Lấy lại userIdentifier để kiểm tra ---
//         const currentUserIdentifier = socket.data.userIdentifier as string | undefined;

//         logToFile(`[Socket.IO ${socketId}] Received 'send_message': ..., ConvID: ${conversationId}, Identifier: ${currentUserIdentifier ? currentUserIdentifier.substring(0, 10) + '...' : 'Anonymous'}`);

//         // --- KIỂM TRA ĐIỀU KIỆN ---
//         if (!conversationId) {
//             logToFile(`[Socket.IO ${socketId} ${handlerId}] Error: Missing conversationId on socket.`);
//             return socket.emit('chat_error', { type: 'error', message: 'Session error. Please refresh.', step: 'missing_conv_id' });
//         }
//         // Chỉ xử lý user đã xác thực trong Phase 1
//         if (!currentUserIdentifier) {
//             logToFile(`[Socket.IO ${socketId} ${handlerId}] Ignoring message: Anonymous user history not supported in Phase 1.`);
//             return socket.emit('chat_error', { type: 'error', message: 'Please log in to use the chat feature.', step: 'anon_user_phase1' });
//         }

//         // -------------------------

//         // --- LẤY HISTORY TỪ SERVICE ---
//         let currentHistory: HistoryItem[] = [];
//         try {
//             const historyLimit = 50; // Giới hạn số tin nhắn lấy về cho context LLM
//             const fetchedHistory = await conversationHistoryService.getConversationHistory(conversationId, historyLimit);
//             if (fetchedHistory === null) {
//                 logToFile(`[Socket.IO ${socketId} ${handlerId}] Error: Conversation ${conversationId} not found for identifier ${currentUserIdentifier.substring(0, 10)}...`);
//                 return socket.emit('chat_error', { type: 'error', message: 'Chat session error. Please refresh.', step: 'history_not_found' });
//             }
//             currentHistory = fetchedHistory;
//             logToFile(`[Socket.IO ${socketId} ${handlerId}] Fetched ${currentHistory.length} history items for conversation ${conversationId}.`);
//         } catch (error: any) {
//             logToFile(`[Socket.IO ${socketId} ${handlerId}] CRITICAL Error fetching history for conversation ${conversationId}: ${error.message}`);
//             return socket.emit('chat_error', { type: 'error', message: 'Could not load chat history. Please try again.', step: 'history_fetch_fail' });
//         }
//         // ---------------------------

//         // --- GỌI INTENT HANDLER ---
//         try {
//             // Khởi tạo updatedHistory là undefined
//             let updatedHistory: HistoryItem[] | undefined | void = undefined;
//             let resultAction: FrontendAction | undefined = undefined;

//             if (isStreaming) {
//                 // handleStreaming trả về Promise<HistoryItem[] | void>
//                 updatedHistory = await handleStreaming(
//                     userInput,
//                     currentHistory,
//                     socket,
//                     language,
//                     handlerId,
//                     (action) => {
//                         // ... (logic stageEmailConfirmation) ...
//                         if (action?.type === 'confirmEmailSend') {
//                             stageEmailConfirmation(
//                                 action.payload as ConfirmSendEmailAction,
//                                 socket.data.token,
//                                 socketId,
//                                 handlerId,
//                                 io
//                             );
//                         }
//                     }
//                 );
//                 // Lưu ý: Nếu handleStreaming trả về void, updatedHistory sẽ là void.
//                 // Action trong streaming thường được xử lý qua callback hoặc emit cuối cùng,
//                 // nên không cần gán resultAction ở đây.

//             } else {
//                 // handleNonStreaming trả về Promise<NonStreamingHandlerResult | void>
//                 const handlerResult = await handleNonStreaming(
//                     userInput,
//                     currentHistory,
//                     socket,
//                     language,
//                     handlerId
//                 );

//                 // Chỉ gán nếu handlerResult không phải là void
//                 if (handlerResult) {
//                     updatedHistory = handlerResult.history; // Gán history từ kết quả
//                     resultAction = handlerResult.action;    // Gán action từ kết quả
//                     if (resultAction?.type === 'confirmEmailSend') {
//                         // ... (logic stageEmailConfirmation) ...
//                         stageEmailConfirmation(
//                             resultAction.payload as ConfirmSendEmailAction,
//                             socket.data.token,
//                             socketId,
//                             handlerId,
//                             io
//                         );
//                     }
//                 }
//                 // Nếu handlerResult là void, updatedHistory sẽ giữ nguyên giá trị undefined ban đầu.
//             }
//             // -------------------------

//             // --- LƯU HISTORY MỚI ---
//             // Kiểm tra xem updatedHistory có phải là một mảng không (không phải undefined và không phải void)
//             if (Array.isArray(updatedHistory)) {
//                 try {
//                     await conversationHistoryService.updateConversationHistory(conversationId, updatedHistory);
//                     logToFile(`[Socket.IO ${socketId} ${handlerId}] Successfully updated history in DB for conversation ${conversationId} (${updatedHistory.length} items).`);
//                 } catch (updateError: any) {
//                     logToFile(`[Socket.IO ${socketId} ${handlerId}] CRITICAL Error updating history for conversation ${conversationId}: ${updateError.message}`);
//                 }
//             } else {
//                 // Log nếu handler không trả về history (trả về void hoặc undefined)
//                 logToFile(`[Socket.IO ${socketId} ${handlerId}] Intent handler did not return an updated history array. DB not updated.`);
//             }
//             // -----------------------

//         } catch (handlerError: any) {
//             logToFile(`[Socket.IO ${socketId} ${handlerId}] CRITICAL Error during handler execution: ${handlerError.message}\nStack: ${handlerError.stack}`);
//             // Gửi lỗi về client nếu cần, ví dụ:
//             socket.emit('chat_error', { type: 'error', message: 'An error occurred while processing your message.', step: 'handler_exception' });
//         }
//     }); // End 'send_message' handler




//     // --- LISTEN FOR USER CONFIRMATION/CANCELLATION EVENTS ---
//     socket.on('user_confirm_email', (data: { confirmationId: string }) => {
//         if (data && data.confirmationId) {
//             logToFile(`[Socket.IO ${socketId}] Received 'user_confirm_email' for ID: ${data.confirmationId}`);
//             handleUserEmailConfirmation(data.confirmationId, socket); // Pass socket for reply
//         } else {
//             logToFile(`[Socket.IO ${socketId}] Received invalid 'user_confirm_email' event data: ${JSON.stringify(data)}`);
//         }
//     });

//     socket.on('user_cancel_email', (data: { confirmationId: string }) => {
//         if (data && data.confirmationId) {
//             logToFile(`[Socket.IO ${socketId}] Received 'user_cancel_email' for ID: ${data.confirmationId}`);
//             handleUserEmailCancellation(data.confirmationId, socket); // Pass socket for reply
//         } else {
//             logToFile(`[Socket.IO ${socketId}] Received invalid 'user_cancel_email' event data: ${JSON.stringify(data)}`);
//         }
//     });

// }); // End io.on('connection')



// // --- HTTP Route Definitions ---

// // Basic Root Route
// app.get('/', (req: Request, res: Response) => {
//     res.send('Crawl, Chatbot, and Log Analysis Server is Running');
// });

// // Crawl Routes
// app.post('/crawl-conferences', handleCrawlConferences);
// app.post('/crawl-journals', handleCrawlJournals);

// // --- Log Analysis API Routes ---
// // Tạo router bằng cách gọi hàm tạo và truyền dependencies
// const logAnalysisRouter = createLogAnalysisRouter({
//     performLogAnalysisService: performLogAnalysis, // Truyền hàm service
//     routeLogger: logger                    // Truyền instance logger
// });
// // Mount router vào ứng dụng với base path
// app.use('/api/v1/logs/analysis', logAnalysisRouter); // <<< Mount router


// // --- Scheduled Tasks (Cron Jobs) ---

// // Initial Log Analysis on Startup (Optional)
// (async () => {
//     logger.info('Performing initial log analysis on startup...');
//     try {
//         latestOverallAnalysisResult = await performLogAnalysis();
//         logger.info('Initial log analysis completed successfully.');
//     } catch (error) {
//         logger.error({ err: error }, 'Initial log analysis failed.');
//     }
// })();

// // Periodic Log Analysis Cron Job (e.g., every hour at 30 minutes past)
// cron.schedule('30 * * * *', async () => {
//     logger.info('[Cron] Running scheduled log analysis...');
//     try {
//         const results = await performLogAnalysis(); // Perform analysis without filters
//         latestOverallAnalysisResult = results; // Update the latest global results
//         io.emit('log_analysis_update', results); // Broadcast the update to ALL connected clients
//         logger.info('[Cron] Log analysis finished and results broadcasted via Socket.IO.');
//     } catch (error) {
//         logger.error({ err: error }, '[Cron] Scheduled log analysis failed.');
//         // Decide whether to emit an error event or keep the old `latestOverallAnalysisResult`
//         io.emit('log_analysis_error', { message: 'Scheduled log analysis failed.', timestamp: new Date() });
//     }
// });


// // --- Start Server ---
// httpServer.listen(PORT, () => {
//     console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}`);
//     logger.info(`🚀 Server (HTTP + Socket.IO) listening on port ${PORT}. Allowed origins: ${allowedOrigins.join(', ')}`);
//     logToFile(`[Server Start] Server listening on port ${PORT}.`); // Use logToFile as well if needed
// });

// // Optional: Graceful Shutdown Handling
// process.on('SIGTERM', () => {
//     logger.info('SIGTERM signal received: closing HTTP server');
//     httpServer.close(() => {
//         logger.info('HTTP server closed');
//         // Close database connections, etc.
//         process.exit(0);
//     });
// });

// process.on('SIGINT', () => {
//     logger.info('SIGINT signal received: closing HTTP server');
//     httpServer.close(() => {
//         logger.info('HTTP server closed');
//         process.exit(0);
//     });
// });



import { config } from './config/environment';
import { initLoaders } from './loaders'; // Import orchestrator
import logToFile from './utils/logger';

async function startServer() {
    try {
        logToFile('[Server Start] Initializing loaders...');
        const { httpServer } = await initLoaders(); // Chỉ cần httpServer để listen

        // --- Start Server ---
        httpServer.listen(config.port, () => {
            const serverUrl = `http://localhost:${config.port}`; // Hoặc IP thực tế
            logToFile(`🚀 Server (HTTP + Socket.IO) listening on port ${config.port}`);
            logToFile(`🔗 Access the server at: ${serverUrl}`);
            logToFile(`🌐 Allowed CORS origins: ${config.allowedOrigins.join(', ')}`);
            logToFile(`[Server Start] Server listening on port ${config.port}. Access at ${serverUrl}`);
            
            console.log(`🚀 Server (HTTP + Socket.IO) listening on port ${config.port}`)
            console.log(`🔗 Access the server at: ${serverUrl}`)
            console.log(`🌐 Allowed CORS origins: ${config.allowedOrigins.join(', ')}`)
            console.log(`[Server Start] Server listening on port ${config.port}. Access at ${serverUrl}`)

        });

        // --- Graceful Shutdown Handling ---
        const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];

        signals.forEach((signal) => {
            process.on(signal, async () => {
                logToFile(`[Server Shutdown] Received ${signal}. Starting graceful shutdown...`);

                // 1. Close HTTP Server (stop accepting new connections)
                httpServer.close(async (err) => {
                    if (err) {
                        logToFile('[Server Shutdown] Error closing HTTP server');
                        process.exit(1); // Exit immediately on server close error
                    }
                    logToFile('[Server Shutdown] HTTP server closed.');

                    // 2. Close Database Connection
                    try {
                        // Giả sử bạn có hàm disconnectDB hoặc dùng mongoose.connection.close()
                        // await disconnectDB();
                        const mongoose = await import('mongoose'); // Import động để tránh cyclical deps nếu cần
                        await mongoose.connection.close();
                        logToFile('[Server Shutdown] MongoDB connection closed.');
                    } catch (dbErr) {
                        logToFile('[Server Shutdown] Error closing MongoDB connection');
                    }

                    // 3. Add any other cleanup tasks here (e.g., close external connections)

                    logToFile('[Server Shutdown] Graceful shutdown completed.');
                    process.exit(0); // Exit successfully
                });

                // Force shutdown after a timeout if graceful shutdown takes too long
                setTimeout(() => {
                    logToFile('[Server Shutdown] Graceful shutdown timeout exceeded. Forcing exit.');
                    process.exit(1);
                }, 10000); // 10 seconds timeout
            });
        });

    } catch (error) {
        logToFile(`[Server Start] FATAL ERROR during initialization: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}

startServer();