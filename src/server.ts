import express, { Request, Response, NextFunction } from 'express';
import pkg from 'pg';
const { Pool } = pkg;
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import bodyParser from 'body-parser';
import fs from 'fs';

// Import các module đã tạo (cho chatbot)
import { runNonStreamChat, saveHistoryToFile } from './chatbotService';
import logToFile from './utils/logger';
// import { handleDrawChartIntent, handleWebsiteNavigationIntent, handleFindInformationConferenceIntent, handleFindInformationJournalIntent, handleFindInformationWebsiteIntent, handleNoIntent, handleInvalidIntent } from "./handlers/intentHandler"


const corsOptions = {
  origin: '*', // Replace with the actual origin(s) of your frontend
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204,
};

const app = express();

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // Quan trọng để nhận dữ liệu từ form HTML

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
      // const sqlResult = await pool.query(chatResponse.sqlQuery);
      // logToFile(`/api/non-stream-chat: SQL Result = ${JSON.stringify(sqlResult.rows)}`);
      // res.json({ type: 'chart', echartsConfig: chatResponse.echartsConfig, sqlResult: sqlResult.rows, description: chatResponse.description });
      //  // ADDED RETURN
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

// Live API route
import { filterConferences, filterJournals } from './handlers/filterInformationHandler';
// --- Các hàm xử lý (mỗi hàm cho một function calling) ---

async function getConferences(filter: any): Promise<any> {
  console.log("Filtering conferences:", filter);
  const conferenceResults = await filterConferences(
    filter,
    "./evaluate.csv",
    "./output.txt"
  );
  return conferenceResults;
}

async function getJournals(filter: any): Promise<any> {
  console.log("Filtering journals:", filter);
  const journalResults = await filterJournals(
    filter,
    "./scimagojr_2023.csv",
    "./journal_output.txt"
  );
  return journalResults;
}

async function getWebsiteInformation(filter: any): Promise<any> {
  console.log("get Website Infomation:", filter);
  return [
    { name: "Website A", topic: "AI" },
    { name: "Website B", topic: "ML" },
  ]; // Example data
}

async function drawChart(data: any): Promise<any> {
  console.log("Drawing chart with data:", data);
  // Thay thế bằng logic vẽ biểu đồ thực tế của bạn (có thể trả về URL ảnh, SVG, v.v.)
  return { type: "chart", data: "/* Dữ liệu biểu đồ ở đây (ví dụ: base64 encoded image) */" };
}

// --- API Endpoints (mỗi hàm một endpoint) ---

app.post('/api/get_conferences', async (req, res) => {
  try {
    const filter = req.body;
    const result = await getConferences(filter);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

app.post('/api/get_journals', async (req, res) => {
  try {
    const filter = req.body;
    const result = await getJournals(filter);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

app.post('/api/get_website_information', async (req, res) => {
  try {
    const filter = req.body;
    const result = await getWebsiteInformation(filter);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

app.post('/api/draw_chart', async (req, res) => {
  try {
    const data = req.body;
    const result = await drawChart(data);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || "An unexpected error occurred." });
  }
});

app.post('/log', (req, res) => {
  const logData = req.body;
  const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(logData, null, 2)}\n`;
  const logFilePath: string = path.join(__dirname, 'app.log'); // Log file in the same directory

  fs.appendFile(logFilePath, logEntry, (err) => {
    if (err) {
      console.error('Lỗi khi ghi vào file log:', err);
      return res.status(500).send('Lỗi khi ghi log.');
    }
    console.log('Đã ghi log vào file.');
    res.status(200).send('Đã ghi log.');
  });
});

// --- Start the server ---
app.listen(3000, () => {
  console.log(`Server listening on port 3000`);
});


