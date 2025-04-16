import express, { Request, Response, NextFunction } from 'express';

import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import bodyParser from 'body-parser';
import fs from 'fs';
import cron from 'node-cron';
import { logger } from './conference/11_utils';
import { getConferenceList as getConferenceListFromCrawl } from './conference/3_core_portal_scraping';
import { crawlConferences } from './conference/crawl_conferences';
import { crawlJournals } from './journal/crawl_journals';
import { ConferenceData } from './conference/types';
import { ProcessedResponseData } from './conference/types';

import { performLogAnalysis } from './client/route/logAnalysisService';
import { LogAnalysisResult } from './client/types/logAnalysis';

import { handleUserInputStreaming } from './chatbot/handlers/intentHandler';
import logToFile from './chatbot/utils/logger';
import { HistoryItem, ErrorUpdate } from './chatbot/shared/types';


const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
const EVALUATE_CSV_PATH = path.join(__dirname, './data/evaluate.csv');

const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
};

const app = express();
const httpServer = new HttpServer(app);
export const io = new SocketIOServer(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// --- Middleware ---
app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

const conditionalJsonBodyParser = (req: Request, res: Response, next: NextFunction) => {
    if (req.query.dataSource === 'client') {
        bodyParser.json()(req, res, next);
    } else {
        req.body = null;
        next();
    }
};
app.use(conditionalJsonBodyParser);

// --- Function to handle the crawl-conferences logic ---
async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = (req as any).log || logger.child({ requestId, route: '/crawl-conferences' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to crawl/update conferences");

    const startTime = Date.now();
    const dataSource = (req.query.dataSource as string) || 'api';

    try {
        let conferenceList: ConferenceData[];

        routeLogger.info({ dataSource }, "Determining conference data source");


        if (dataSource === 'client') {

            conferenceList = req.body;
            if (!Array.isArray(conferenceList) || conferenceList.length === 0) {
                routeLogger.warn({ bodyType: typeof conferenceList, count: conferenceList?.length }, "Invalid or empty conference list in request body for 'client' source.");
                res.status(400).json({ message: 'Invalid or empty conference list provided in the request body.' });
                return;
            }

            const hasRequiredLinks = conferenceList.every(c => c.Acronym && c.Title && c.mainLink && c.cfpLink && c.impLink);
            if (!hasRequiredLinks) {
                routeLogger.warn("Client data source selected, but some conferences lack required links (main, cfp, imp) for the update flow.");


                res.status(400).json({ message: "Client data source requires all conferences to have Acronym, Title, mainLink, cfpLink, and impLink for the update flow." });
                return;





            }
            routeLogger.info({ count: conferenceList.length }, "Using conference list provided by client (expecting UPDATE flow)");

        } else {

            if (req.body && Object.keys(req.body).length > 0) {
                routeLogger.warn("Received body when dataSource is 'api'. Ignoring body.");
            }
            try {
                routeLogger.info("Fetching conference list from internal source for CRAWL flow...");
                conferenceList = await getConferenceListFromCrawl() as ConferenceData[];
                routeLogger.info({ count: conferenceList.length }, "Successfully fetched conference list from internal source");
            } catch (apiError: any) {
                routeLogger.error({ err: apiError }, "Failed to fetch conference list from internal source");
                res.status(500).json({ message: 'Failed to fetch conference list from internal source', error: apiError.message });
                return;
            }
        }


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
                outputJsonlPath: FINAL_OUTPUT_PATH,
                outputCsvPath: EVALUATE_CSV_PATH
            });
            return;
        }


        routeLogger.info({ conferenceCount: conferenceList.length, dataSource }, `Calling crawlConferences (expecting ${dataSource === 'client' ? 'UPDATE results' : 'SAVE to file'})`);


        const crawlResults: (ProcessedResponseData | null)[] = await crawlConferences(conferenceList, routeLogger);

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);


        if (dataSource === 'client') {

            const processedClientResults = crawlResults.filter(result => result !== null) as ProcessedResponseData[];
            routeLogger.info({
                runtimeSeconds: runTimeSeconds,
                totalProcessed: crawlResults.length,
                resultsReturned: processedClientResults.length,
                event: 'update_process_finished_successfully',
                outputJsonl: FINAL_OUTPUT_PATH,
                outputCsv: EVALUATE_CSV_PATH
            }, "Conference UPDATE process finished. Returning processed data.");

            res.status(200).json({
                message: `Conference update process completed. ${processedClientResults.length} conference(s) processed successfully.`,
                runtime: `${runTimeSeconds} s`,
                data: processedClientResults,
                outputJsonlPath: FINAL_OUTPUT_PATH,
                outputCsvPath: EVALUATE_CSV_PATH
            });
            routeLogger.info({ statusCode: 200, resultsCount: processedClientResults.length }, "Sent successful response with processed data");

        } else {

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
                dataSource: dataSource
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
        await crawlJournals(routeLogger);
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
cron.schedule('30 * * * *', async () => {
    logger.info('[Cron] Running scheduled log analysis...');
    try {
        const results = await performLogAnalysis();
        latestOverallAnalysisResult = results;
        io.emit('log_analysis_update', results);
        logger.info('[Cron] Log analysis finished and results emitted via Socket.IO.');
    } catch (error) {
        logger.error({ err: error }, '[Cron] Scheduled log analysis failed.');

    }
});


// Route để lấy dữ liệu phân tích, chấp nhận bộ lọc thời gian
app.get('/api/v1/logs/analysis/latest', async (req: Request, res: Response) => {
    try {

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
        const results = await performLogAnalysis(filterStartTime, filterEndTime);
        if (filterStartTime === undefined && filterEndTime === undefined) {
            latestOverallAnalysisResult = results;
        }
        res.status(200).json(results);

    } catch (error: any) {
        console.error("Error performing log analysis:", error);
        if (error.message === 'No log data found for the specified period') {
            res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period.' });
        } else {
            res.status(500).json({ message: 'Failed to perform log analysis.', error: error.message });
        }
    }
});


app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.url.startsWith('/socket.io/')) {
        const start = Date.now();
        logToFile(`Incoming HTTP Request: ${req.method} ${req.url}`);
        res.on('finish', () => {
            const duration = Date.now() - start;
            logToFile(`HTTP Response Sent: ${res.statusCode} for ${req.method} ${req.url} in ${duration}ms`);
        });
    }
    next();
});

// --- Socket.IO Connection Logic ---
io.on('connection', (socket: Socket) => {
    logToFile(`[Socket.IO] Client connected: ${socket.id}`);


    socket.on('send_message', async (data: { userInput: string; history: HistoryItem[] }) => {
        const { userInput, history } = data;
        logToFile(`[Socket.IO ${socket.id}] Received 'send_message': UserInput = ${userInput}`);

        if (!userInput || typeof userInput !== 'string' || !userInput.trim()) {
            logToFile(`[Socket.IO ${socket.id}] Invalid 'send_message' data: Missing or invalid userInput`);

            socket.emit('chat_error', {
                type: 'error',
                message: 'Invalid request: Missing or invalid userInput',
                step: 'validation'
            } as ErrorUpdate);
            return;
        }
        try {
            await handleUserInputStreaming(
                userInput,
                history || [],
                socket
            );

            logToFile(`[Socket.IO ${socket.id}] handleUserInputStreaming finished for: "${userInput}"`);

        } catch (error: any) {
            logToFile(`[Socket.IO ${socket.id}] CRITICAL Error during 'send_message' handling: ${error.message}, Stack: ${error.stack}`);

            try {
                socket.emit('chat_error', {
                    type: 'error',
                    message: error.message || 'An unexpected server error occurred while processing your message.',
                    step: 'handler_exception'
                } as ErrorUpdate);
            } catch (emitError: any) {
                logToFile(`[Socket.IO ${socket.id}] FAILED to emit critical error to client: ${emitError.message}`);
            }
        }
    });

    socket.on('disconnect', (reason: string) => {
        logToFile(`[Socket.IO] Client disconnected: ${socket.id}. Reason: ${reason}`);
    });

    socket.on('error', (err) => {
        logToFile(`[Socket.IO ${socket.id}] Socket Error: ${err.message}`);
    });
});

// --- Start Server ---
const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
    console.log(`Server (including Socket.IO) is running on port ${PORT}`);

});