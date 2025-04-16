import express, { Request, Response, NextFunction, RequestHandler } from 'express';

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import bodyParser from 'body-parser';
import fs from 'fs';
import multer from 'multer';
import cron from 'node-cron';

// Import modules from server-crawl (using relative paths)
import { logger } from './conference/11_utils';
import { getConferenceList as getConferenceListFromCrawl } from './conference/3_core_portal_scraping';
import { crawlConferences } from './conference/crawl_conferences';
import { crawlJournals } from './journal/crawl_journals';
import { ConferenceData } from './conference/types'; // Import ConferenceData type

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

// // --- Database Path ---
// const conferencesListFilePath = path.resolve(__dirname, './database/DB.json');


// // --- Route Imports ---
// import { getConferenceById } from './route/getConferenceById';
// import { getConferenceList } from './route/getConferenceList';
// import { followConference } from './route/followConference';
// import { getUserById } from './route/getUserById';
// import { updateUser } from './route/updateUser';
// import { addConference } from './route/addConference';
// import { getMyConferences } from './route/getMyConferences';
// import { addToCalendar } from './route/addToCalendar';
// import { getUserCalendar } from './route/getUserCalendar';
// import { addFeedback } from './route/addFeedback';
// import { deleteUser } from './route/deleteUser';
// import { getUserNotifications } from './route/getNotifications';
// import { updateNotifications } from './route/updateNotifications';
// import { markAllNotificationsAsRead } from './route/markAllNotificationsAsRead';
// import { adminConferences_GET, adminConferences_POST } from './route/adminConferences';
// import { saveConferenceData } from './route/saveConferenceData';
// import { saveConferenceDetails } from './route/saveConferenceDetails';
// import { signupUser } from './route/signupUser';
// import { signinUser } from './route/signinUser';
// import { googleLogin } from './route/googleLogin';
// import { checkUpcomingConferenceDates } from './route/checkUpcomingConferenceDates';
// import { verifyPassword } from './route/verifyPassword';
// import { changePassword } from './route/changePassword';
// import { blacklistConference } from './route/addToBlacklist';
// import { getVisualizationData } from './route/getVisualizationData';
// import { verifyEmail } from './route/verifyEmail';

// // --- Route Definitions ---
// app.get('/api/v1/conference/:id', getConferenceById);
// app.get('/api/v1/conference', getConferenceList);
// app.post('/api/v1/user/follow', followConference);
// app.get('/api/v1/user/:id', getUserById);
// app.put('/api/v1/user/:id', updateUser);
// app.post('/api/v1/user/add-conference', addConference);
// app.get('/api/v1/user/:id/my-conferences', getMyConferences);
// app.post('/api/v1/user/add-to-calendar', addToCalendar);
// app.post('/api/v1/user/blacklist', blacklistConference);
// app.get('/api/v1/user/:id/calendar', getUserCalendar);
// app.post('/api/v1/conferences/:conferenceId/feedback', addFeedback);
// app.delete('/api/v1/user/:id', deleteUser);
// app.get('/api/v1/user/:id/notifications', getUserNotifications);
// app.put('/api/v1/user/:id/notifications', updateNotifications);
// app.put('/api/v1/user/:id/notifications/mark-all-as-read', markAllNotificationsAsRead);
// app.get('/admin/conferences', adminConferences_GET);
// app.post('/admin/conferences', upload.single('csvFile'), adminConferences_POST);
// app.post('/api/v1/conferences/save', saveConferenceData);
// app.post('/api/v1/conferences/details/save', saveConferenceDetails);
// app.post('/api/v1/user/signup', signupUser);
// app.post('/api/v1/user/signin', signinUser);
// app.post('/api/v1/user/google-login', googleLogin);
// app.post('/api/v1/user/verify-password', verifyPassword);
// app.post('/api/v1/user/change-password', changePassword);
// app.post('/api/v1/user/verify-email', verifyEmail);
// app.get('/api/v1/visualization/conference', getVisualizationData);

// app.get('/api/v1/topics', async (req, res) => {
//     try {
//         const rawData = await fs.promises.readFile(conferencesListFilePath, 'utf8');
//         const data = JSON.parse(rawData);


//         let allTopics: string[] = [];
//         for (const conferenceData of data.payload) {
//             if (conferenceData.topics && Array.isArray(conferenceData.topics)) {
//                 allTopics = allTopics.concat(conferenceData.topics);
//             }
//         }


//         const uniqueTopics = [...new Set(allTopics)];

//         if (uniqueTopics.length === 0) {
//             res.status(404).json({ error: 'Topics not found in the data' });
//             return
//         }

//         res.json(uniqueTopics);

//     } catch (error) {
//         if ((error as any).code === 'ENOENT') {
//             console.error('Error: DB_details.json not found at:', conferencesListFilePath);
//             res.status(500).json({ error: 'Database file not found' });
//         } else if (error instanceof SyntaxError) {
//             console.error('Error: Invalid JSON in DB_details.json:', error);
//             res.status(500).json({ error: 'Invalid database file format' });
//         } else {
//             console.error('Error reading or parsing DB_details.json:', error);
//             res.status(500).json({ error: 'Failed to retrieve topics' });
//         }
//     }
// });

// import { saveCrawlConferenceFromCsvToJson } from './route/saveCrawlConferenceFromCsvToJson'; // Adjust path
// app.post('/api/v1/conference/save-to-json', saveCrawlConferenceFromCsvToJson);



// // --- API Endpoints (mỗi hàm một endpoint) ---
// app.post('/log', (req, res) => {
//     const logData = req.body;
//     const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(logData, null, 2)}\n`;
//     const logFilePath: string = path.join(__dirname, 'app.log'); // Log file in the same directory

//     fs.appendFile(logFilePath, logEntry, (err) => {
//         if (err) {
//             console.error('Lỗi khi ghi vào file log:', err);
//             return res.status(500).send('Lỗi khi ghi log.');
//         }
//         console.log('Đã ghi log vào file.');
//         res.status(200).send('Đã ghi log.');
//     });
// });



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

// --- Function to handle the crawl-conferences logic ---
async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = (req as any).log || logger.child({ requestId, route: '/crawl-conferences' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to crawl/update conferences");

    const startTime = Date.now();
    const dataSource = (req.query.dataSource as string) || 'api'; // Mặc định là 'api'

    try {
        let conferenceList: ConferenceData[];

        routeLogger.info({ dataSource }, "Determining conference data source");

        // --- Lấy danh sách conference ---
        if (dataSource === 'client') {
            // --- Luồng UPDATE từ Client ---
            conferenceList = req.body;
            if (!Array.isArray(conferenceList) || conferenceList.length === 0) {
                routeLogger.warn({ bodyType: typeof conferenceList, count: conferenceList?.length }, "Invalid or empty conference list in request body for 'client' source.");
                res.status(400).json({ message: 'Invalid or empty conference list provided in the request body.' });
                return;
            }
            // Kiểm tra sơ bộ cấu trúc cần thiết cho update (ví dụ: có mainLink)
            const hasRequiredLinks = conferenceList.every(c => c.Acronym && c.Title && c.mainLink && c.cfpLink && c.impLink);
            if (!hasRequiredLinks) {
                routeLogger.warn("Client data source selected, but some conferences lack required links (main, cfp, imp) for the update flow.");
                // Quyết định: Báo lỗi hay vẫn tiếp tục và bỏ qua các conference thiếu link?
                // Hiện tại báo lỗi để rõ ràng:
                 res.status(400).json({ message: "Client data source requires all conferences to have Acronym, Title, mainLink, cfpLink, and impLink for the update flow." });
                 return;
                // Hoặc lọc ra các conference hợp lệ:
                // const validConferences = conferenceList.filter(c => c.Acronym && c.Title && c.mainLink && c.cfpLink && c.impLink);
                // if (validConferences.length === 0) { /* ... xử lý không có conf hợp lệ ... */ }
                // conferenceList = validConferences;
                // routeLogger.info({ originalCount: req.body.length, validCount: validConferences.length }, "Filtered conferences for update flow.");
            }
            routeLogger.info({ count: conferenceList.length }, "Using conference list provided by client (expecting UPDATE flow)");

        } else {
            // --- Luồng CRAWL/SAVE từ API ---
            if (req.body && Object.keys(req.body).length > 0) {
                routeLogger.warn("Received body when dataSource is 'api'. Ignoring body.");
            }
            try {
                routeLogger.info("Fetching conference list from internal source for CRAWL flow...");
                conferenceList = await getConferenceListFromCrawl() as ConferenceData[]; // Hàm này phải trả về ConferenceData[]
                routeLogger.info({ count: conferenceList.length }, "Successfully fetched conference list from internal source");
            } catch (apiError: any) {
                routeLogger.error({ err: apiError }, "Failed to fetch conference list from internal source");
                res.status(500).json({ message: 'Failed to fetch conference list from internal source', error: apiError.message });
                return;
            }
        }

        // --- Kiểm tra conferenceList cuối cùng ---
        if (!conferenceList || !Array.isArray(conferenceList)) {
             routeLogger.error("conferenceList is not a valid array after source determination.");
             res.status(500).json({ message: "Internal Server Error: Invalid conference list." });
             return;
        }
        if (conferenceList.length === 0) {
             routeLogger.warn("Conference list is empty. Nothing to process.");
             res.status(200).json({
                 message: 'Conference list provided or fetched was empty. No processing performed.',
                 runtime: `0.00 s`,
                 outputJsonlPath: FINAL_OUTPUT_PATH, // Vẫn trả về path file (dù có thể trống)
                 outputCsvPath: EVALUATE_CSV_PATH
             });
             return;
        }

        // --- Gọi hàm core ---
        routeLogger.info({ conferenceCount: conferenceList.length, dataSource }, `Calling crawlConferences (expecting ${dataSource === 'client' ? 'UPDATE results' : 'SAVE to file'})`);

        // *** THAY ĐỔI: Nhận kết quả trả về từ crawlConferences ***
        const crawlResults: (ProcessedResponseData | null)[] = await crawlConferences(conferenceList, routeLogger);

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        // --- Xử lý Response dựa trên dataSource ---
        if (dataSource === 'client') {
            // --- Trả về kết quả UPDATE cho Client ---
            const processedClientResults = crawlResults.filter(result => result !== null) as ProcessedResponseData[];
            routeLogger.info({
                runtimeSeconds: runTimeSeconds,
                totalProcessed: crawlResults.length, // Tổng số conf đã xử lý
                resultsReturned: processedClientResults.length, // Số kết quả thực sự trả về
                event: 'update_process_finished_successfully',
                outputJsonl: FINAL_OUTPUT_PATH, // Vẫn ghi file JSONL
                outputCsv: EVALUATE_CSV_PATH
            }, "Conference UPDATE process finished. Returning processed data.");

            res.status(200).json({
                message: `Conference update process completed. ${processedClientResults.length} conference(s) processed successfully.`,
                runtime: `${runTimeSeconds} s`,
                data: processedClientResults, // *** TRẢ KẾT QUẢ ĐÃ XỬ LÝ ***
                outputJsonlPath: FINAL_OUTPUT_PATH,
                outputCsvPath: EVALUATE_CSV_PATH
            });
             routeLogger.info({ statusCode: 200, resultsCount: processedClientResults.length }, "Sent successful response with processed data");

        } else {
            // --- Chỉ xác nhận CRAWL/SAVE thành công cho Client ---
            routeLogger.info({
                runtimeSeconds: runTimeSeconds,
                event: 'crawl_process_finished_successfully',
                outputJsonl: FINAL_OUTPUT_PATH,
                outputCsv: EVALUATE_CSV_PATH
            }, "Conference CRAWL/SAVE process finished successfully. Results written to files.");

            res.status(200).json({
                message: `Conference crawling process completed successfully! Results saved to server at specified paths.`,
                runtime: `${runTimeSeconds} s`,
                outputJsonlPath: FINAL_OUTPUT_PATH,
                outputCsvPath: EVALUATE_CSV_PATH
            });
             routeLogger.info({ statusCode: 200 }, "Sent successful response (file confirmation only)");
        }

    } catch (error: any) {
        const endTime = Date.now();
        const runTime = endTime - startTime;
        routeLogger.error({ err: error, stack: error.stack, runtimeMs: runTime, dataSource }, "Conference processing failed within route handler");

        if (!res.headersSent) {
             res.status(500).json({
                 message: 'Conference processing failed',
                 error: error.message,
                 dataSource: dataSource // Có thể thêm thông tin này vào lỗi
             });
             routeLogger.warn({ statusCode: 500 }, "Sent error response");
        } else {
             routeLogger.error("Headers already sent, could not send 500 error response for processing failure.");
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
        const journalData = await crawlJournals(routeLogger); // Call crawlJournals function
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
            data: journalData,
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

import { performLogAnalysis } from './client/route/logAnalysisService'; // <<< Import service mới
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