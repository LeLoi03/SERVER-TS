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
const app = express();

const corsOptions = {
  origin: '*', // Replace with the actual origin(s) of your frontend
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true,
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());

// // Database connection
// const pool = new Pool({
//   user: process.env.DB_USER || "postgres",
//   host: process.env.DB_HOST || "localhost",
//   database: process.env.DB_NAME || "Conferences",
//   password: process.env.DB_PASSWORD || "123456",
//   port: parseInt(process.env.DB_PORT || "5432"),
// });

// // Test database connection
// pool.connect()
//   .then(client => {
//     console.log('Successfully connected to the database!');
//     client.release();
//   })
//   .catch(err => {
//     console.error('Error connecting to the database:', err);
//   });

// // Middleware để xử lý lỗi async
// const asyncHandler = (fn: RequestHandler) => (req: Request, res: Response, next: NextFunction) => {
//   Promise.resolve(fn(req, res, next)).catch(next);
// };

// // --- Chat endpoint ---
// const nonStreamChatHandler: RequestHandler = async (req, res) => {
//   logToFile("--- /api/non-stream-chat: Endpoint hit ---");
//   try {
//     const userInput = req.body?.userInput;
//     let history: any[] = req.body?.history || [];
//     logToFile(`/api/non-stream-chat: userInput = ${userInput}`);
//     logToFile(`/api/non-stream-chat: Received History = ${JSON.stringify(history)}`);

//     if (!userInput) {
//       logToFile("/api/non-stream-chat: Invalid request: Missing userInput");
//       res.status(400).json({ error: 'Invalid request body: Missing userInput' });
//       
//     }

//     // Move history saving to the top to avoid errors after sending a response
//     const historyFilePath = path.join(process.cwd(), 'chat_history.txt');
//     try {
//       await saveHistoryToFile(history, historyFilePath);
//     } catch (historyError: any) {
//       logToFile(`/api/non-stream-chat: Error saving history: ${historyError.message}`);
//       // Handle the error, but don't send a response yet.  Perhaps log it.
//     }



//     const chatResponse: any = await runNonStreamChat(userInput, history);
//     logToFile(`/api/non-stream-chat: chatResponse = ${JSON.stringify(chatResponse)}`);

//     if (chatResponse.type === 'chart') {
//       // const sqlResult = await pool.query(chatResponse.sqlQuery);
//       // logToFile(`/api/non-stream-chat: SQL Result = ${JSON.stringify(sqlResult.rows)}`);
//       // res.json({ type: 'chart', echartsConfig: chatResponse.echartsConfig, sqlResult: sqlResult.rows, description: chatResponse.description });
//       //  // ADDED RETURN
//     } else if (chatResponse.type === 'text') {
//       res.json({ type: 'text', message: chatResponse.message });
//       return; // ADDED RETURN
//     } else if (chatResponse.type === 'navigation') {
//       res.json(chatResponse);
//       return; // ADDED RETURN
//     } else if (chatResponse.type === 'error') {
//       res.status(500).json({ error: chatResponse.message || 'An unknown error occurred.', thought: chatResponse.thought });
//       return; // ADDED RETURN
//     } else {
//       logToFile("/api/non-stream-chat: Error: Unknown response type or error from runNonStreamChat");
//       res.status(500).json({ error: 'An unknown error occurred.' });
//       return; // ADDED RETURN
//     }


//   } catch (error: any) {
//     logToFile(`/api/non-stream-chat: Error: ${error.message}`);
//     res.status(500).json({ error: 'Internal Server Error', details: error.message });
//   } finally {
//     logToFile("--- /api/non-stream-chat: Endpoint completed ---");
//   }
// };

// app.post('/api/non-stream-chat', asyncHandler(nonStreamChatHandler));

// // Live API route
// import { filterConferences, filterJournals } from './handlers/filterInformationHandler';
// // --- Các hàm xử lý (mỗi hàm cho một function calling) ---

// async function getConferences(filter: any): Promise<any> {
//   console.log("Filtering conferences:", filter);
//   const conferenceResults = await filterConferences(
//     filter,
//     "./evaluate.csv",
//     "./output.txt"
//   );
//   return conferenceResults;
// }

// async function getJournals(filter: any): Promise<any> {
//   console.log("Filtering journals:", filter);
//   const journalResults = await filterJournals(
//     filter,
//     "./scimagojr_2023.csv",
//     "./journal_output.txt"
//   );
//   return journalResults;
// }

// async function getWebsiteInformation(filter: any): Promise<any> {
//   console.log("get Website Infomation:", filter);
//   return [
//     { name: "Website A", topic: "AI" },
//     { name: "Website B", topic: "ML" },
//   ]; // Example data
// }

// async function drawChart(data: any): Promise<any> {
//   console.log("Drawing chart with data:", data);
//   // Thay thế bằng logic vẽ biểu đồ thực tế của bạn (có thể trả về URL ảnh, SVG, v.v.)
//   return { type: "chart", data: "/* Dữ liệu biểu đồ ở đây (ví dụ: base64 encoded image) */" };
// }

// // --- API Endpoints (mỗi hàm một endpoint) ---

// app.post('/api/get_conferences', async (req, res) => {
//   try {
//     const filter = req.body;
//     const result = await getConferences(filter);
//     res.json(result);
//   } catch (error: any) {
//     res.status(500).json({ error: error.message || "An unexpected error occurred." });
//   }
// });

// app.post('/api/get_journals', async (req, res) => {
//   try {
//     const filter = req.body;
//     const result = await getJournals(filter);
//     res.json(result);
//   } catch (error: any) {
//     res.status(500).json({ error: error.message || "An unexpected error occurred." });
//   }
// });
// app.post('/api/get_website_information', async (req, res) => {
//   try {
//     const filter = req.body;
//     const result = await getWebsiteInformation(filter);
//     res.json(result);
//   } catch (error: any) {
//     res.status(500).json({ error: error.message || "An unexpected error occurred." });
//   }
// });

// app.post('/api/draw_chart', async (req, res) => {
//   try {
//     const data = req.body;
//     const result = await drawChart(data);
//     res.json(result);
//   } catch (error: any) {
//     res.status(500).json({ error: error.message || "An unexpected error occurred." });
//   }
// });


// app.post('/log', (req, res) => {
//   const logData = req.body;
//   const logEntry = `[${new Date().toISOString()}] ${JSON.stringify(logData, null, 2)}\n`;
//   const logFilePath: string = path.join(__dirname, 'app.log'); // Log file in the same directory

//   fs.appendFile(logFilePath, logEntry, (err) => {
//     if (err) {
//       console.error('Lỗi khi ghi vào file log:', err);
//       return res.status(500).send('Lỗi khi ghi log.');
//     }
//     console.log('Đã ghi log vào file.');
//     res.status(200).send('Đã ghi log.');
//   });
// });

// Replace for database

import { ConferenceResponse } from './types/conference.response';
import { ConferenceListResponse } from './types/conference.list.response';
import { UserResponse } from './types/user.response';
import { AddedConference, ConferenceFormData } from './types/addConference';
import { CalendarEvent } from './types/calendar';
import { v4 as uuidv4 } from 'uuid'; // Import thư viện uuid
import { promises } from 'dns';

// --- Route Handlers ---


// 1. Lấy Conference theo ID (giữ nguyên, nhưng chỉnh đường dẫn file)
const getConferenceById: RequestHandler<{ id: string }, ConferenceResponse | { message: string }, any, any> = async (
  req,
  res
): Promise<void> => {
  const conferenceId = req.params.id;

  try {
    const filePath = path.resolve(__dirname, './database/conference_details_list.json');
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const conferences: ConferenceResponse[] = JSON.parse(data); // Đổi kiểu này


    // Tìm conference theo ID
    const foundConference = conferences.find(c => c.conference.id === conferenceId);

    if (!foundConference) {
      res.status(404).json({ message: 'Conference not found' });
      return;
    }

    // Chuyển đổi ngày tháng (nếu cần)
    // Lưu ý: Chỉ chuyển đổi nếu bạn *thực sự* cần Date object ở backend.
    // Nếu bạn chỉ cần string ISO, bạn có thể bỏ qua phần này.
    if (foundConference.dates && foundConference.dates.length > 0) {
      foundConference.dates.forEach(date => {
        if (date.fromDate) {
          date.fromDate = new Date(date.fromDate).toISOString();
        }
        if (date.toDate) {
          date.toDate = new Date(date.toDate).toISOString();
        }
      });
    }
    console.log("success");
    // Trả về toàn bộ ConferenceResponse
    res.status(200).json(foundConference);
    return;

  } catch (error: any) {
    console.error('Error reading or processing conference data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in conference-list.json' });
      return;
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'conference-list.json not found' });
      return;
    } else {
      res.status(500).json({ message: 'Internal server error' });
      return;
    }
  }
};
app.get('/api/v1/conference/:id', getConferenceById);


// 2. Lấy danh sách Conferences
const getConferenceList: RequestHandler<any, ConferenceListResponse | { message: string }, any, any> = async (
  req,
  res
): Promise<void> => {
  try {
    const filePath = path.resolve(__dirname, './database/conferences_list.json');
    const data = await fs.promises.readFile(filePath, 'utf-8');

    // Parse toàn bộ file JSON thành đối tượng ConferenceListResponse
    const conferenceListResponse: ConferenceListResponse = JSON.parse(data);

    console.log("success");
    // Trả về đối tượng ConferenceListResponse đã parse
    res.status(200).json(conferenceListResponse);
    return;


  } catch (error: any) {
    console.error('Error reading or processing conference data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in conference-list.json' });
      return;
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'conference-list.json not found' });
      return;
    } else {
      res.status(500).json({ message: 'Internal server error' });
      return;
    }
  }
};
app.get('/api/v1/conferences', getConferenceList);

// 3. Follow conference
const followConference: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const { conferenceId, userId } = req.body;  // Lấy conferenceId và userId từ body

    if (!conferenceId || !userId) {
      res.status(400).json({ message: 'Missing conferenceId or userId' });
    }

    const filePath = path.resolve(__dirname, './database/users_list.json');
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const users: UserResponse[] = JSON.parse(data);

    const userIndex = users.findIndex(u => u.id === userId);  // Tìm theo ID, không phải email

    if (userIndex === -1) {
      res.status(404).json({ message: 'User not found' });
    }

    const updatedUser: UserResponse = { ...users[userIndex] };

    if (!updatedUser.followedConferences) {
      updatedUser.followedConferences = [];
    }

    const isFollowing = updatedUser.followedConferences.includes(conferenceId);

    if (isFollowing) {
      updatedUser.followedConferences = updatedUser.followedConferences.filter(id => id !== conferenceId);
    } else {
      if (!updatedUser.followedConferences.includes(conferenceId)) {
        updatedUser.followedConferences.push(conferenceId);
      }
    }

    // Ghi lại vào file (quan trọng!)
    users[userIndex] = updatedUser;
    await fs.promises.writeFile(filePath, JSON.stringify(users, null, 2), 'utf-8'); // Ghi lại, pretty-printed

    res.status(200).json(updatedUser); // Trả về user đã update
  } catch (error: any) {
    // Xử lý lỗi như trước
    console.error('Error updating user data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in user-list.json' });
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'user-list.json not found' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};
app.post('/api/v1/user/:id/follow', followConference);


// 4. Lấy thông tin user theo ID ---
const getUserById: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const userId = req.params.id;

    if (!userId) {
      res.status(400).json({ message: 'Missing userId' });
    }

    const filePath = path.resolve(__dirname, './database/users_list.json'); // Thay 'user-list.json' bằng tên file thực tế
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const users: UserResponse[] = JSON.parse(data);

    const user = users.find(u => u.id === userId);

    if (!user) {
      res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json(user);

  } catch (error: any) {
    console.error('Error get user data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in user-list.json' });
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'user-list.json not found' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};
app.get('/api/v1/user/:id', getUserById); // Route để lấy thông tin user


// 5. Add conference
const addConference: RequestHandler<any, AddedConference | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const conferenceData: ConferenceFormData = req.body;

    // Lấy userId TỪ req.body (KHÔNG an toàn)
    const { userId } = req.body; // Frontend phải gửi userId trong request body

    if (!userId) {
      res.status(401).json({ message: 'Unauthorized: Missing userId' }); // Trả về 401 Unauthorized
    }

    // Tạo các ID duy nhất
    const conferenceId = uuidv4();
    const organizationId = uuidv4();
    const locationId = uuidv4();

    // ... (phần tạo addedConference và ghi file giữ nguyên) ...
    const addedConference: AddedConference = {
      conference: {
        id: conferenceId,
        title: conferenceData.title,
        acronym: conferenceData.acronym,
        creatorId: userId, // LẤY USER ID TỪ REQUEST (KHÔNG AN TOÀN)
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      organization: {
        id: organizationId,
        year: new Date().getFullYear(), // Năm hiện tại
        accessType: conferenceData.type, // Lấy từ form
        isAvailable: true,
        conferenceId: conferenceId,
        summary: conferenceData.description, // Tạm dùng description làm summary
        callForPaper: '',   // Để trống, hoặc thêm logic tạo call for paper
        link: conferenceData.link,
        cfpLink: '',        // Để trống
        impLink: '',        // Để trống
        topics: conferenceData.topics,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      locations: {
        id: locationId,
        address: conferenceData.location.address,
        cityStateProvince: conferenceData.location.cityStateProvince,
        country: conferenceData.location.country,
        continent: conferenceData.location.continent,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isAvailable: true,
        organizeId: organizationId,
      },
      dates: conferenceData.dates.map(date => ({
        id: uuidv4(), // Tạo ID duy nhất cho mỗi date
        organizedId: organizationId,
        fromDate: new Date(date.fromDate).toISOString(), // Chuyển sang ISO string
        toDate: new Date(date.toDate).toISOString(),     // Chuyển sang ISO string
        type: date.type,
        name: date.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isAvailable: true,
      })),

      rankSourceFoRData: [],  // Để mảng rỗng, hoặc thêm logic
      status: 'Pending', // Trạng thái mặc định
    };


    const filePath = path.resolve(__dirname, './database/add_conferences.json');
    let existingConferences: AddedConference[] = [];

    try {
      const fileExists = await fs.promises.access(filePath).then(() => true).catch(() => false); // Kiểm tra file tồn tại
      if (fileExists) {
        const data = await fs.promises.readFile(filePath, 'utf-8');
        // CHỈ parse nếu chuỗi data không rỗng
        if (data.trim() !== "") {
          existingConferences = JSON.parse(data);
        }
      }
    } catch (error: any) {
      // Xử lý các lỗi khác (ngoài lỗi file không tồn tại)
      if (error.code !== 'ENOENT') {
        console.error('Error reading conference data:', error); // Thêm log lỗi chi tiết hơn ở đây.
        throw error;
      }
    }
    existingConferences.push(addedConference);
    await fs.promises.writeFile(filePath, JSON.stringify(existingConferences, null, 2), 'utf-8');

    res.status(201).json(addedConference); // Trả về conference đã thêm

  } catch (error: any) {
    console.error('Error adding conference:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in add_conferences.json' });
    }
    else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};
app.post('/api/v1/user/add-conferences', addConference);

// 6. Get User's Conferences ---
const getMyConferences: RequestHandler<{ id: string }, AddedConference[] | { message: string }, any, any> = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: 'Missing userId' }) as any;
    }

    const filePath = path.resolve(__dirname, 'add_conferences.json');
    const data = await fs.promises.readFile(filePath, 'utf-8').catch(() => '[]'); // Handle file not found
    const addedConferences: AddedConference[] = JSON.parse(data);

    // Filter conferences by creatorId
    const userConferences = addedConferences.filter(conf => conf.conference.creatorId === userId);

    res.status(200).json(userConferences);
  } catch (error: any) {
    console.error('Error fetching user conferences:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.get('/api/v1/user/:id/conferences', getMyConferences); // New route

// 7. Add to calendar
const addToCalendar: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const { conferenceId, userId } = req.body;  // Lấy conferenceId và userId từ body

    if (!conferenceId || !userId) {
      res.status(400).json({ message: 'Missing conferenceId or userId' });
    }

    const filePath = path.resolve(__dirname, './database/users_list.json');
    const data = await fs.promises.readFile(filePath, 'utf-8');
    const users: UserResponse[] = JSON.parse(data);

    const userIndex = users.findIndex(u => u.id === userId);  // Tìm theo ID, không phải email

    if (userIndex === -1) {
      res.status(404).json({ message: 'User not found' });
    }

    const updatedUser: UserResponse = { ...users[userIndex] };

    if (!updatedUser.calendar) {
      updatedUser.calendar = [];
    }

    const isAddToCalendar = updatedUser.calendar.includes(conferenceId);

    if (isAddToCalendar) {
      updatedUser.calendar = updatedUser.calendar.filter(id => id !== conferenceId);
    } else {
      if (!updatedUser.calendar.includes(conferenceId)) {
        updatedUser.calendar.push(conferenceId);
      }
    }

    // Ghi lại vào file (quan trọng!)
    users[userIndex] = updatedUser;
    await fs.promises.writeFile(filePath, JSON.stringify(users, null, 2), 'utf-8'); // Ghi lại, pretty-printed

    res.status(200).json(updatedUser); // Trả về user đã update
  } catch (error: any) {
    // Xử lý lỗi như trước
    console.error('Error updating user data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in user-list.json' });
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'user-list.json not found' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};
app.post('/api/v1/user/:id/add-to-calendar', addToCalendar);

// 8. Lấy calendar events
const getUserCalendar: RequestHandler = async (req, res) => {
  try {
    const userId = req.params.id;
    console.log("1. Received request for userId:", userId);

    if (!userId) {
      console.log("2. UserId is missing. Returning 400.");
      return res.status(400).json({ message: 'Missing userId' }) as any;
    }

    const userFilePath = path.resolve(__dirname, './database/users_list.json');
    console.log("3. User file path:", userFilePath);

    let userData: string;
    try {
      userData = await fs.promises.readFile(userFilePath, 'utf-8');
      console.log("4. User data read successfully.");
    } catch (error) {
      console.error("Error reading users_list.json:", error);
      return res.status(500).json({ message: 'Error reading user data' });
    }

    let users: UserResponse[];
    try {
      users = JSON.parse(userData);
      console.log("5. User data parsed successfully. Number of users:", users.length);
    } catch (error) {
      console.error("Error parsing users_list.json:", error);
      return res.status(500).json({ message: 'Error parsing user data' });
    }

    const user = users.find(u => u.id === userId);
    console.log("6. Found user:", user);

    if (!user || !user.calendar) {
      console.log("7. User not found or no calendar data. Returning 404.");
      return res.status(404).json({ message: 'User not found or no calendar data' });
    }

    const calendarIds = user.calendar;
    console.log("8. User's calendar IDs:", calendarIds);

    const detailsFilePath = path.resolve(__dirname, './database/conference_details_list.json');
    const addedFilePath = path.resolve(__dirname, './database/add_conferences.json');
    console.log("9. Conference details file path:", detailsFilePath);
    console.log("10. Added conferences file path:", addedFilePath);

    let detailsData: string;
    let addedData: string;
    try {
      [detailsData, addedData] = await Promise.all([
        fs.promises.readFile(detailsFilePath, 'utf-8').catch(() => '[]'),
        fs.promises.readFile(addedFilePath, 'utf-8').catch(() => '[]')
      ]);
      console.log("11. Conference data read successfully.");
    } catch (error) {
      console.error("Error reading conference files:", error);
      return res.status(500).json({ message: "Error reading conference data." });
    }

    let detailsConferences: ConferenceResponse[];
    let addedConferences: AddedConference[];
    try {
      detailsConferences = JSON.parse(detailsData);
      console.log("12. Details conferences parsed. Count:", detailsConferences.length);
    } catch (error) {
      console.error("Error parsing conference_details_list.json", error);
      return res.status(500).json({ message: "Error parsing details conference data." });
    }
    try {
      addedConferences = JSON.parse(addedData);
      console.log("13. Added conferences parsed. Count:", addedConferences.length);
    } catch (error) {
      console.error("Error parsing add_conferences.json", error);
      return res.status(500).json({ message: "Error parsing added conference data." });
    }

    const allConferences = [
      ...detailsConferences.map(c => ({
        id: c.conference.id,
        title: c.conference.title,
        dates: c.dates,
      })),
      ...addedConferences.map(c => ({
        id: c.conference.id,
        title: c.conference.title,
        dates: c.dates,
      })),
    ];
    console.log("14. All conferences combined. Count:", allConferences.length);

    const calendar = allConferences.filter(conf => calendarIds.includes(conf.id));
    console.log("15. Filtered calendar conferences. Count:", calendar.length);

    const calendarEvents: CalendarEvent[] = [];

    calendar.forEach((conf, confIndex) => {
      console.log(`16. Processing conference ${confIndex + 1}:`, conf.title);
      conf.dates.forEach((date, dateIndex) => {
        console.log(`  17. Processing date ${dateIndex + 1} for conference ${confIndex + 1}:`, date);
        const fromDate = new Date(date.fromDate);
        const toDate = new Date(date.toDate);
        const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays > 0) {
          for (let i = 0; i <= diffDays; i++) {
            const currentDate = new Date(fromDate);
            currentDate.setDate(fromDate.getDate() + i);
            calendarEvents.push({
              day: currentDate.getDate(),
              month: currentDate.getMonth() + 1,
              year: currentDate.getFullYear(),
              type: date.type,
              conference: conf.title,
              conferenceId: conf.id,
            });
          }
        } else {
          calendarEvents.push({
            day: fromDate.getDate(),
            month: fromDate.getMonth() + 1,
            year: fromDate.getFullYear(),
            type: date.type,
            conference: conf.title,
            conferenceId: conf.id,
          });
        }
      });
    });

    console.log("18. Calendar events created. Count:", calendarEvents.length);
    return res.status(200).json(calendarEvents);

  } catch (error: any) {
    console.error('Error fetching calendar events:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};
app.get('/api/v1/user/:id/calendar', getUserCalendar);

// 9. Filter conferences
const getFilteredConferences: RequestHandler<any, { items: CombinedConference[]; total: number; } | { message: string }, any, any> = async (req, res) => {
  console.log("Request received at /api/v1/filter-conferences");
  console.log("Request query parameters:", req.query);

  try {
    const detailsFilePath = path.resolve(__dirname, './database/conference_details_list.json');
    const addedFilePath = path.resolve(__dirname, './database/add_conferences.json');

    console.log("detailsFilePath:", detailsFilePath);
    console.log("addedFilePath:", addedFilePath);

    const detailsData = await fs.promises.readFile(detailsFilePath, 'utf-8').catch(() => {
      console.log("Error reading detailsFilePath. Returning empty array.");
      return '[]';
    });
    const addedData = await fs.promises.readFile(addedFilePath, 'utf-8').catch(() => {
      console.log("Error reading addedFilePath. Returning empty array.");
      return '[]';
    });

    console.log("detailsData (first 100 chars):", detailsData.substring(0, 100));
    console.log("addedData (first 100 chars):", addedData.substring(0, 100));

    let detailsConferences: ConferenceResponse[];
    let addedConferences: AddedConference[];

    try {
      detailsConferences = JSON.parse(detailsData);
      addedConferences = JSON.parse(addedData);
      console.log("detailsConferences length:", detailsConferences.length);
      console.log("addedConferences length:", addedConferences.length);
    } catch (parseError) {
      console.error("Error parsing JSON:", parseError);
      res.status(500).json({ message: 'Error parsing JSON data' });
      return;
    }


    const allConferences: CombinedConference[] = [
      ...detailsConferences.map(c => ({
        id: c.conference.id,
        title: c.conference.title,
        acronym: c.conference.acronym,
        location: c.locations,
        year: c.organization.year,
        rankSourceFoRData: c.rankSourceFoRData?.[0], // Use optional chaining
        topics: c.organization.topics,
        dates: c.dates[0],
        link: c.organization.link,
        accessType: c.organization.accessType,
        creatorId: c.conference.creatorId,
        callForPaper: c.organization.callForPaper,
        summary: c.organization.summary,
      })),
      ...addedConferences.map(c => ({
        id: c.conference.id,
        title: c.conference.title,
        acronym: c.conference.acronym,
        location: c.locations,
        year: c.organization.year,
        rankSourceFoRData: c.rankSourceFoRData?.[0], // Use optional chaining
        topics: c.organization.topics,
        dates: c.dates[0],
        link: c.organization.link,
        accessType: c.organization.accessType,
        creatorId: c.conference.creatorId,
        status: c.status,
        callForPaper: c.organization.callForPaper,
        summary: c.organization.summary,
      })),
    ];

    console.log("allConferences length:", allConferences.length);

    const queryParams = new URLSearchParams(req.query as any);

    const topics = queryParams.getAll('topics');
    const publishers = queryParams.getAll('publisher');
    const countries = queryParams.getAll('country');
    const types = queryParams.getAll('type');
    const keyword = queryParams.get('keyword');
    const startDateStr = queryParams.get('startDate');
    const endDateStr = queryParams.get('endDate');
    const rank = queryParams.get('rank');
    const sourceYear = queryParams.get('sourceYear');
    const page = parseInt(queryParams.get('page') || '1', 10);
    const sortBy = queryParams.get('sortBy') || 'date';
    const limit = parseInt(queryParams.get('limit') || '8', 10);
    const sortOrder = queryParams.get('sortOrder') || 'asc'; // Get sortOrder

    console.log("Filtering with parameters:");
    console.log("  topics:", topics);
    console.log("  publishers:", publishers);
    console.log("  countries:", countries);
    console.log("  types:", types);
    console.log("  keyword:", keyword);
    console.log("  startDateStr:", startDateStr);
    console.log("  endDateStr:", endDateStr);
    console.log("  rank:", rank);
    console.log("  sourceYear:", sourceYear);
    console.log("  page:", page);
    console.log("  sortBy:", sortBy);
    console.log("  limit:", limit);
    console.log("  sortOrder:", sortOrder); // Log sortOrder


    let filteredConferences = allConferences;

    // --- FILTERING (Same as before) ---
    if (keyword) {
      const keywordLower = keyword.toLowerCase();
      console.log("Before keyword filter:", filteredConferences.length);
      filteredConferences = filteredConferences.filter(conf =>
        conf.title.toLowerCase().includes(keywordLower) ||
        conf.acronym.toLowerCase().includes(keywordLower) ||
        conf.topics.some(topic => topic.toLowerCase().includes(keywordLower)) ||
        (conf.summary && conf.summary.toLowerCase().includes(keywordLower)) ||
        (conf.callForPaper && conf.callForPaper.toLowerCase().includes(keywordLower))
      );
      console.log("After keyword filter:", filteredConferences.length);
    }
    if (topics.length > 0) {
      console.log("Before topics filter:", filteredConferences.length);
      filteredConferences = filteredConferences.filter(conf =>
        topics.some(topic => conf.topics.includes(topic))
      );
      console.log("After topics filter:", filteredConferences.length);
    }
    if (publishers.length > 0) {
      console.log("Before publishers filter:", filteredConferences.length);
      filteredConferences = filteredConferences.filter(conf =>
        conf.rankSourceFoRData?.source && publishers.includes(conf.rankSourceFoRData.source)
      ); // Use optional chaining and check for existence
      console.log("After publishers filter:", filteredConferences.length);
    }

    if (countries.length > 0) {
      console.log("Before countries filter:", filteredConferences.length);
      filteredConferences = filteredConferences.filter(conf =>
        countries.includes(conf.location.country)
      );
      console.log("After countries filter:", filteredConferences.length);
    }

    if (types.length > 0) {
      console.log("Before types filter:", filteredConferences.length);
      filteredConferences = filteredConferences.filter(conf =>
        types.includes(conf.accessType)
      );
      console.log("After types filter:", filteredConferences.length);
    }

    if (startDateStr) {
      const startDate = new Date(startDateStr);
      console.log("Before startDate filter:", filteredConferences.length);
      console.log("startDate:", startDate);
      filteredConferences = filteredConferences.filter(conf => {
        const confStartDate = new Date(conf.dates.fromDate);
        console.log("confStartDate:", confStartDate);
        return confStartDate >= startDate;
      });
      console.log("After startDate filter:", filteredConferences.length);
    }
    if (endDateStr) {
      const endDate = new Date(endDateStr);
      console.log("Before endDate filter:", filteredConferences.length);
      console.log("endDate:", endDate);
      filteredConferences = filteredConferences.filter(conf => {
        const confEndDate = new Date(conf.dates.toDate);
        console.log("confEndDate:", confEndDate);
        return confEndDate <= endDate;
      });
      console.log("After endDate filter:", filteredConferences.length);
    }

    if (rank) {
      console.log("Before rank filter:", filteredConferences.length);
      filteredConferences = filteredConferences.filter(conf =>
        conf.rankSourceFoRData?.rank && conf.rankSourceFoRData.rank === rank
      ); // Use optional chaining and check for existence

      console.log("After rank filter:", filteredConferences.length);
    }

    if (sourceYear) {
      const year = parseInt(sourceYear);
      console.log("Before sourceYear filter:", filteredConferences.length);
      if (!isNaN(year)) {
        filteredConferences = filteredConferences.filter(conf => conf.year === year);
      }
      console.log("After sourceYear filter:", filteredConferences.length);
    }


    // --- SORTING (Server-Side) WITH sortOrder ---
    console.log("Before sorting:", filteredConferences.length);
    if (sortBy === 'date' || sortBy === 'startDate') {
      filteredConferences.sort((a, b) => {
        const dateA = a.dates.fromDate ? new Date(a.dates.fromDate).getTime() : (sortOrder === 'asc' ? Infinity : -Infinity);
        const dateB = b.dates.fromDate ? new Date(b.dates.fromDate).getTime() : (sortOrder === 'asc' ? Infinity : -Infinity);
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA; // Use sortOrder
      });
    } else if (sortBy === 'endDate') {
      filteredConferences.sort((a, b) => {
        const dateA = a.dates.toDate ? new Date(a.dates.toDate).getTime() : (sortOrder === 'asc' ? Infinity : -Infinity);
        const dateB = b.dates.toDate ? new Date(b.dates.toDate).getTime() : (sortOrder === 'asc' ? Infinity : -Infinity);
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA; // Use sortOrder
      });
    } else if (sortBy === 'rank') {
      filteredConferences.sort((a, b) => {
        const rankA = a.rankSourceFoRData?.rank || '';
        const rankB = b.rankSourceFoRData?.rank || '';
        return sortOrder === 'asc' ? rankA.localeCompare(rankB) : rankB.localeCompare(rankA); // Use sortOrder
      });
    } else if (sortBy === 'name') {
      filteredConferences.sort((a, b) => {
        return sortOrder === 'asc' ? a.title.localeCompare(b.title) : b.title.localeCompare(a.title); // Use sortOrder
      });
    }
    console.log("After sorting:", filteredConferences.length);

    // --- PAGINATION (Server-Side) ---
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;
    console.log("startIndex:", startIndex);
    console.log("endIndex:", endIndex);
    const paginatedConferences = filteredConferences.slice(startIndex, endIndex);
    console.log("paginatedConferences length:", paginatedConferences.length);

    // --- RETURN PAGINATED RESULTS AND TOTAL COUNT ---
    res.status(200).json({
      items: paginatedConferences,
      total: filteredConferences.length,
    });

  } catch (error: any) {
    console.error('Error filtering conferences:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.get('/api/v1/filter-conferences', getFilteredConferences);

// --- Start the server ---
app.listen(3000, () => {
  console.log(`Server listening on port 3000`);
});
