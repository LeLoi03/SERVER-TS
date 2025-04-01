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

// Import modules from server-crawl (using relative paths)
import { logger } from './conference/11_utils';
import { getConferenceList as getConferenceListFromCrawl } from './conference/3_core_portal_scraping';
import { crawlConferences } from './conference/crawl_conferences';
import { crawlJournals } from './journal/crawl_journals';
import { ConferenceData } from './conference/types'; // Import ConferenceData type

export const OUTPUT_JSON: string = path.join(__dirname,'./journal/data/all_journal_data.json');

const corsOptions = {
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
    optionsSuccessStatus: 204,
};

const app = express();
const httpServer = new HttpServer(app);
const io = new SocketIOServer(httpServer, {
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

// --- Database Path ---
const conferencesListFilePath = path.resolve(__dirname, './database/DB.json');


// --- Route Imports ---
import { getConferenceById } from './route/getConferenceById';
import { getConferenceList } from './route/getConferenceList';
import { followConference } from './route/followConference';
import { getUserById } from './route/getUserById';
import { updateUser } from './route/updateUser';
import { addConference } from './route/addConference';
import { getMyConferences } from './route/getMyConferences';
import { addToCalendar } from './route/addToCalendar';
import { getUserCalendar } from './route/getUserCalendar';
import { addFeedback } from './route/addFeedback';
import { deleteUser } from './route/deleteUser';
import { getUserNotifications } from './route/getNotifications';
import { updateNotifications } from './route/updateNotifications';
import { markAllNotificationsAsRead } from './route/markAllNotificationsAsRead';
import { adminConferences_GET, adminConferences_POST } from './route/adminConferences';
import { saveConferenceData } from './route/saveConferenceData';
import { saveConferenceDetails } from './route/saveConferenceDetails';
import { signupUser } from './route/signupUser';
import { signinUser } from './route/signinUser';
import { googleLogin } from './route/googleLogin';
import { checkUpcomingConferenceDates } from './route/checkUpcomingConferenceDates';
import { verifyPassword } from './route/verifyPassword';
import { changePassword } from './route/changePassword';
import { blacklistConference } from './route/addToBlacklist';
import { getVisualizationData } from './route/getVisualizationData';
import { verifyEmail } from './route/verifyEmail';

// --- Route Definitions ---
app.get('/api/v1/conference/:id', getConferenceById);
app.get('/api/v1/conference', getConferenceList);
app.post('/api/v1/user/follow', followConference);
app.get('/api/v1/user/:id', getUserById);
app.put('/api/v1/user/:id', updateUser);
app.post('/api/v1/user/add-conference', addConference);
app.get('/api/v1/user/:id/my-conferences', getMyConferences);
app.post('/api/v1/user/add-to-calendar', addToCalendar);
app.post('/api/v1/user/blacklist', blacklistConference);
app.get('/api/v1/user/:id/calendar', getUserCalendar);
app.post('/api/v1/conferences/:conferenceId/feedback', addFeedback);
app.delete('/api/v1/user/:id', deleteUser);
app.get('/api/v1/user/:id/notifications', getUserNotifications);
app.put('/api/v1/user/:id/notifications', updateNotifications);
app.put('/api/v1/user/:id/notifications/mark-all-as-read', markAllNotificationsAsRead);
app.get('/admin/conferences', adminConferences_GET);
app.post('/admin/conferences', upload.single('csvFile'), adminConferences_POST);
app.post('/api/v1/conferences/save', saveConferenceData);
app.post('/api/v1/conferences/details/save', saveConferenceDetails);
app.post('/api/v1/user/signup', signupUser);
app.post('/api/v1/user/signin', signinUser);
app.post('/api/v1/user/google-login', googleLogin);
app.post('/api/v1/user/verify-password', verifyPassword);
app.post('/api/v1/user/change-password', changePassword);
app.post('/api/v1/user/verify-email', verifyEmail);
app.get('/api/v1/visualization/conference', getVisualizationData);

app.get('/api/v1/topics', async (req, res) => {
    try {
        const rawData = await fs.promises.readFile(conferencesListFilePath, 'utf8');
        const data = JSON.parse(rawData);


        let allTopics: string[] = [];
        for (const conferenceData of data.payload) {
            if (conferenceData.topics && Array.isArray(conferenceData.topics)) {
                allTopics = allTopics.concat(conferenceData.topics);
            }
        }


        const uniqueTopics = [...new Set(allTopics)];

        if (uniqueTopics.length === 0) {
            res.status(404).json({ error: 'Topics not found in the data' });
            return
        }

        res.json(uniqueTopics);

    } catch (error) {
        if ((error as any).code === 'ENOENT') {
            console.error('Error: DB_details.json not found at:', conferencesListFilePath);
            res.status(500).json({ error: 'Database file not found' });
        } else if (error instanceof SyntaxError) {
            console.error('Error: Invalid JSON in DB_details.json:', error);
            res.status(500).json({ error: 'Invalid database file format' });
        } else {
            console.error('Error reading or parsing DB_details.json:', error);
            res.status(500).json({ error: 'Failed to retrieve topics' });
        }
    }
});


// --- server_crawl.ts routes ---
// Custom middleware with types
const conditionalJsonBodyParser = (req: Request, res: Response, next: NextFunction) => {
    if (req.query.dataSource === 'client') {
        bodyParser.json()(req, res, next);
    } else {
        next();
    }
};

app.use(conditionalJsonBodyParser);

// --- Function to handle the crawl-conferences logic ---
async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = logger.child({ requestId, route: '/crawl-conferences' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to crawl conferences");

    const startTime = Date.now();

    try {
        const dataSource = (req.query.dataSource as string) || 'api';
        let conferenceList: ConferenceData[];

        routeLogger.info({ dataSource }, "Determining conference data source");

        if (dataSource === 'client') {
            conferenceList = req.body;
            if (!Array.isArray(conferenceList)) {
                routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list in request body");
                res.status(400).json({ message: 'Invalid conference list provided in the request body.' });
                return;
            }
            routeLogger.info({ count: conferenceList.length }, "Using conference list provided by client");
        } else {
            try {
                routeLogger.info("Fetching conference list from API...");
                conferenceList = await getConferenceListFromCrawl() as ConferenceData[];
                routeLogger.info({ count: conferenceList.length }, "Successfully fetched conference list from API");
            } catch (apiError: any) {
                routeLogger.error(apiError, "Failed to fetch conference list from API");
                res.status(500).json({
                    message: 'Failed to fetch conference list from API',
                    error: apiError.message
                });
                return;
            }
        }

        routeLogger.info({ conferenceCount: conferenceList.length }, "Calling crawlConferences...");
        const results = await crawlConferences(conferenceList);

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        routeLogger.info({ runtimeSeconds: runTimeSeconds, resultsPreview: results.slice(0, 3) }, "crawlConferences finished successfully.");

        try {
            const runtimeFilePath = path.resolve(__dirname, 'crawl_conferences_runtime.txt');
            await fs.promises.writeFile(runtimeFilePath, `Execution time: ${runTimeSeconds} s`);
            routeLogger.debug({ path: runtimeFilePath }, "Successfully wrote runtime file.");
        } catch (writeError: any) {
            routeLogger.warn(writeError, "Could not write crawl conferences runtime file");
        }

        res.status(200).json({
            message: 'Conference crawling completed successfully!',
            runtime: `${runTimeSeconds} s`
        });
        routeLogger.info({ statusCode: 200 }, "Sent successful response");

    } catch (error: any) {
        const endTime = Date.now();
        const runTime = endTime - startTime;
        routeLogger.error(error, "Conference crawling failed within route handler", { runtimeMs: runTime });

        res.status(500).json({
            message: 'Conference crawling failed',
            error: error.message
        });
        routeLogger.warn({ statusCode: 500 }, "Sent error response");
    }
}

// --- Function to handle the crawl-journals logic ---
async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = logger.child({ requestId, route: '/crawl-journals' });

    routeLogger.info({ method: req.method }, "Received request to crawl journals");

    const startTime = Date.now();

    try {
        routeLogger.info("Starting journal crawling...");
        const journalData = await crawlJournals(); // Call crawlJournals function
        routeLogger.info("Journal crawling completed.");

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        routeLogger.info({ runtimeSeconds: runTimeSeconds }, "Journal crawling finished successfully.");

        try {
            const runtimeFilePath = path.resolve(__dirname, 'crawl_journals_runtime.txt');
            await fs.promises.writeFile(runtimeFilePath, `Execution time: ${runTimeSeconds} s`);
            routeLogger.debug({ path: runtimeFilePath }, "Successfully wrote runtime file.");

            await fs.promises.writeFile(OUTPUT_JSON, JSON.stringify(journalData, null, 2), 'utf8');
            routeLogger.debug({ path: OUTPUT_JSON }, "Successfully wrote journal data to JSON file.");

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

// --- Cron Job ---
cron.schedule('0 2 * * *', checkUpcomingConferenceDates);
/////////////////////////////////////////////////////////////////////


import pkg from 'pg';

const { Pool } = pkg;
import 'dotenv/config';
import { RequestHandler } from 'express';

// Import các module đã tạo (cho chatbot)
import { runNonStreamChat, saveHistoryToFile } from './chatbotService';
import logToFile from './utils/logger';


// // Database connection
// const pool = new Pool({
//     user: process.env.DB_USER || "postgres",
//     host: process.env.DB_HOST || "localhost",
//     database: process.env.DB_NAME || "Conferences",
//     password: process.env.DB_PASSWORD || "123456",
//     port: parseInt(process.env.DB_PORT || "5432"),
// });

// // Test database connection
// pool.connect()
//     .then(client => {
//         console.log('Successfully connected to the database!');
//         client.release();
//     })
//     .catch(err => {
//         console.error('Error connecting to the database:', err);
//     });



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
            // // ADDED RETURN
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

app.post('/api/non-stream-chat', nonStreamChatHandler);

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

async function getWebsiteInformation(): Promise<any> {
    return [
        `1. **Website Title:** Global Conference & Journal Hub (GCJH)
2. **Website Overview:**
GCJH is a comprehensive online platform designed to connect researchers, academics, and professionals with relevant conferences and journals across all disciplines globally.  We provide a centralized, searchable database, offering detailed information to facilitate efficient research and networking opportunities. Our goal is to simplify the process of discovering and participating in relevant academic events and accessing high-quality scholarly publications.
3. **Key Features:**
    * **Comprehensive Database:**  Our database includes thousands of conferences and journals, encompassing a wide range of subjects and geographical locations.  Information is regularly updated to ensure accuracy and timeliness.  Data points include:
        * **Conferences:** Conference title, dates, location, organizers, abstract submission deadlines, registration fees, call for papers, keynote speakers, accepted papers (if available), contact information, links to official websites.
        * **Journals:** Journal title, ISSN, publisher, impact factor (where applicable), subject areas, open access status, indexing databases (e.g., Scopus, Web of Science), call for papers/submissions, editorial board information, links to official websites.
    * **Advanced Search Functionality:** Users can search our database using various parameters, including keywords, subject areas, dates, location, publication type (conference or journal), and more.  Boolean operators (AND, OR, NOT) are supported for refined searches.
    * **Personalized Profiles (for registered users):** Users can create personalized profiles to save their search preferences, track conferences and journals of interest, and receive relevant notifications.
    * **Calendar Integration:**  Users can add conference dates to their personal calendars directly from the website.
    * **Alert System:** Users can set up alerts to receive notifications about new conferences or journals matching their saved preferences.
    * **Community Forum (future development):** A planned community forum will enable users to connect, discuss research topics, and share information.
    * **AI-Powered Chatbot:**  A sophisticated AI-powered chatbot is integrated throughout the website to provide instant support and assistance.  The chatbot can:
        * **Answer Frequently Asked Questions (FAQs):**  Provide quick answers to common questions about the website's functionality, search capabilities, and account management.
        * **Assist with Searches:**  Refine search queries by understanding user intent and suggesting relevant keywords or filters.  It can handle complex search requests, including Boolean operators.
        * **Provide Information Extraction:** Extract specific information from conference and journal listings based on user requests (e.g., 'What are the keynote speakers at the ACM Conference?').
        * **Summarize Content:**  Provide concise summaries of conference abstracts or journal articles (with proper attribution and limitations clearly stated – e.g.,  'This is a brief summary generated by AI; please refer to the original content for complete information.').
        * **Multilingual Support:** Offer support in multiple languages.
        * **Personalized Recommendations:** Based on user activity and preferences, suggest relevant conferences or journals.
    * **Data Visualization and Analytics (Dashboard):** Registered users have access to a personalized dashboard providing data visualization tools:
        * **Conference Trends:** Visualize trends in conference participation over time, categorized by subject area, location, or other parameters (e.g., line charts, bar charts).
        * **Journal Impact:** Visualize journal impact factors and citation trends (where data is available) using various chart types (e.g., scatter plots, histograms).
        * **Research Area Analysis:** Explore the distribution and growth of research across various disciplines using interactive maps and charts.
        * **Personalized Statistics:**  Track user's saved items, search history, and alert activity through charts and graphs.
        * **Customizable Dashboards:** Users can customize their dashboards to display the most relevant data and visualizations.
4. **How to Use the Website:**
    1. **Navigation:** The website features a user-friendly interface with intuitive navigation. Users can easily browse by subject area, location, or use the advanced search bar.
    2. **Searching:** Use the search bar to input keywords or phrases related to your area of interest. Utilize the advanced search filters for more precise results.
    3. **Viewing Details:** Click on a conference or journal listing to access detailed information.
    4. **Saving & Tracking:** Registered users can save conferences and journals to their personal profiles for easy access and tracking.
    5. **Alerts:** Set up email alerts to receive notifications about upcoming events or publications relevant to your research interests.
5. **Account Registration:** Registration is free and allows access to personalized features. Users need to provide:
    * Email address
    * Password (meeting strong password criteria)
    * Name (optional)
    * Affiliation (optional - university, company etc.)
    * Research Interests (optional - allows for better alert customization)
6. **Account Benefits:**
    * **Personalized Search Results:** Save search preferences for faster and more efficient searches.
    * **Saved Items:** Create a personalized list of conferences and journals of interest.
    * **Email Alerts:** Receive notifications about new relevant content.
    * **Calendar Integration:** Add conference dates to your personal calendar.
    * **Profile Management:** Update personal information and preferences.
    * **AI-Powered Assistance:** Access to the integrated AI chatbot for personalized support and information retrieval.
    * **Data Visualization Dashboard:** Use interactive dashboards to analyze trends and visualize research data.
7. **Additional Information:**
    * **Contact Us:**  A dedicated 'Contact Us' page provides various methods (email, contact form) to reach our support team.
    * **FAQ:** A comprehensive FAQ section addresses common user questions.
    * **Terms of Service:**  Clearly defined terms and conditions governing website usage.
    * **Privacy Policy:**  A detailed privacy policy outlining how user data is collected, used, and protected.
    * **About Us:**  Information about the website's mission, team, and partners.
    * **AI Limitations:** A clear statement outlining the limitations of the AI chatbot and its capabilities.  This should include disclaimers about the accuracy of AI-generated summaries and recommendations.  Emphasize the need to always consult original sources.
    `
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
        const result = await getWebsiteInformation();
        console.log(result)
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



httpServer.listen(3001, () => {
    console.log(`Server is running on port 3001`);
});