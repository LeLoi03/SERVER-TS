import express, { Request, Response, NextFunction } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';

// Import các module đã tạo (cho chatbot)
import { runNonStreamChat, saveHistoryToFile } from './chatbotService';
import logToFile from './utils/logger';

const app = express();

const corsOptions = {
    origin: '*', // Replace with the actual origin(s) of your frontend
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());

// Database connection
const pool = new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "localhost",
    database: process.env.DB_NAME || "Conferences",
    password: process.env.DB_PASSWORD || "123456",
    port: parseInt(process.env.DB_PORT || "5432"),
});

// Test database connection
pool.connect()
    .then(client => {
        console.log('Successfully connected to the database!');
        client.release();
    })
    .catch(err => {
        console.error('Error connecting to the database:', err);
    });

// Middleware để xử lý lỗi async
const asyncHandler = (fn: RequestHandler) => (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// --- Chat endpoint ---
const nonStreamChatHandler: RequestHandler = async (req, res) => {
    logToFile("--- /api/non-stream-chat: Endpoint hit ---");
    try {
        const userInput = req.body?.userInput;
        let history: any[] = req.body?.history || [];
        logToFile(`/api/non-stream-chat: userInput = ${userInput}`);
        logToFile(`/api/non-stream-chat: Received History = ${JSON.stringify(history)}`);

        if (!userInput) {
            logToFile("/api/non-stream-chat: Invalid request: Missing userInput");
            res.status(400).json({ error: 'Invalid request body: Missing userInput' });
            return;
        }

        // Move history saving to the top to avoid errors after sending a response
        const historyFilePath = path.join(process.cwd(), 'chat_history.txt');
        try {
            await saveHistoryToFile(history, historyFilePath);
        } catch (historyError: any) {
            logToFile(`/api/non-stream-chat: Error saving history: ${historyError.message}`);
            // Handle the error, but don't send a response yet.  Perhaps log it.
        }



        const chatResponse: any = await runNonStreamChat(userInput, history);
        logToFile(`/api/non-stream-chat: chatResponse = ${JSON.stringify(chatResponse)}`);

        if (chatResponse.type === 'chart') {
            const sqlResult = await pool.query(chatResponse.sqlQuery);
            logToFile(`/api/non-stream-chat: SQL Result = ${JSON.stringify(sqlResult.rows)}`);
            res.json({ type: 'chart', echartsConfig: chatResponse.echartsConfig, sqlResult: sqlResult.rows, description: chatResponse.description });
            return; // ADDED RETURN
        } else if (chatResponse.type === 'text') {
            res.json({ type: 'text', message: chatResponse.message });
            return; // ADDED RETURN
        } else if (chatResponse.type === 'navigation') {
            res.json(chatResponse);
            return; // ADDED RETURN
        } else if (chatResponse.type === 'error') {
            res.status(500).json({ error: chatResponse.message || 'An unknown error occurred.', thought: chatResponse.thought });
            return; // ADDED RETURN
        } else {
            logToFile("/api/non-stream-chat: Error: Unknown response type or error from runNonStreamChat");
            res.status(500).json({ error: 'An unknown error occurred.' });
            return; // ADDED RETURN
        }


    } catch (error: any) {
        logToFile(`/api/non-stream-chat: Error: ${error.message}`);
        res.status(500).json({ error: 'Internal Server Error', details: error.message });
    } finally {
        logToFile("--- /api/non-stream-chat: Endpoint completed ---");
    }
};

app.post('/api/non-stream-chat', asyncHandler(nonStreamChatHandler));

// --- Start the server ---
app.listen(3000, () => {
    console.log(`Server listening on port 3000`);
});