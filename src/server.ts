import express, { Request, Response, NextFunction } from 'express';
import pkg from 'pg';
import { Server as HttpServer } from 'http'; // Import HttpServer
import { Server as SocketIOServer, Socket } from 'socket.io'; // Import Socket.IO
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

const httpServer = new HttpServer(app); // Create an HTTP server
const io = new SocketIOServer(httpServer, { // Initialize Socket.IO
  cors: {
    origin: "*",  // Adjust as needed for security in production!
    methods: ["GET", "POST"]
  }
});

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // Quan trọng để nhận dữ liệu từ form HTML

// --- Socket.IO Connection Handling ---

const connectedUsers = new Map<string, Socket>(); // Store connected users

io.on('connection', (socket: Socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register', (userId: string) => {
    connectedUsers.set(userId, socket);
    console.log(`User ${userId} registered with socket ${socket.id}`);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    // Remove user from connectedUsers map
    connectedUsers.forEach((userSocket, userId) => {
      if (userSocket.id === socket.id) {
        connectedUsers.delete(userId);
      }
    });
  });
});


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



import { ConferenceResponse, FollowerInfo } from './types/conference.response';
import { ConferenceListResponse, ConferenceInfo } from './types/conference.list.response';
import { UserResponse, MyConference, Notification } from './types/user.response';
import { AddedConference, ConferenceFormData } from './types/addConference';
import { CalendarEvent } from './types/calendar';
import { Feedback } from './types/conference.response';
import { v4 as uuidv4 } from 'uuid'; // Import thư viện uuid

// --- Route Handlers ---



const userFilePath = path.resolve(__dirname, './database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, './database/conference_details_list.json');
const conferencesListFilePath = path.resolve(__dirname, './database/conferences_list.json');
const addConferencesFilePath = path.resolve(__dirname, './database/add_conferences.json');

// 1. Lấy Conference theo ID
const getConferenceById: RequestHandler<{ id: string }, ConferenceResponse | { message: string }, any, any> = async (
  req,
  res
): Promise<void> => {
  const conferenceId = req.params.id;

  try {
    const data = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
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
    const data = await fs.promises.readFile(conferencesListFilePath, 'utf-8');

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


// 3. Follow conference (CORRECTED - No Duplicate Notifications)
const followConference: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const { conferenceId, userId } = req.body;

    if (!conferenceId || !userId) {
      res.status(400).json({ message: 'Missing conferenceId or userId' });
      return;
    }

    const [userData, conferenceData] = await Promise.all([
      fs.promises.readFile(userFilePath, 'utf-8'),
      fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
    ]);

    const users: UserResponse[] = JSON.parse(userData);
    const conferences: ConferenceResponse[] = JSON.parse(conferenceData);

    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const conferenceIndex = conferences.findIndex(c => c.conference.id === conferenceId);
    if (conferenceIndex === -1) {
      res.status(404).json({ message: 'Conference not found' });
      return;
    }

    const updatedUser: UserResponse = { ...users[userIndex] };
    const updatedConference: ConferenceResponse = { ...conferences[conferenceIndex] };
    const now = new Date().toISOString();

    if (!updatedUser.followedConferences) {
      updatedUser.followedConferences = [];
    }
    if (!updatedConference.followedBy) {
      updatedConference.followedBy = [];
    }

    const existingFollowIndex = updatedUser.followedConferences.findIndex(fc => fc.id === conferenceId);

    let notificationType: 'Follow Conference' | 'Unfollow Conference';
    let notificationMessage: string;
    let isFollowing: boolean; // Keep track of follow/unfollow

    if (existingFollowIndex !== -1) {
      // Unfollow:
      updatedUser.followedConferences.splice(existingFollowIndex, 1);
      updatedConference.followedBy = updatedConference.followedBy.filter(follower => follower.id !== userId);
      notificationType = 'Unfollow Conference';
      notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} unfollowed the conference: ${updatedConference.conference.title}`;
      isFollowing = false;
    } else {
      // Follow:
      updatedUser.followedConferences.push({
        id: conferenceId,
        createdAt: now,
        updatedAt: now,
      });

      const followerInfo: FollowerInfo = {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        createdAt: now,
        updatedAt: now,
      };
      updatedConference.followedBy.push(followerInfo);
      notificationType = 'Follow Conference';
      notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} followed the conference: ${updatedConference.conference.title}`;
      isFollowing = true;
    }

    // --- Create the notification object ---
    const notification: Notification = {
      id: uuidv4(),
      createdAt: now,
      isImportant: false,
      seenAt: null,
      deletedAt: null,
      message: notificationMessage,
      type: notificationType,
    };

    // --- 1. Add notification to the ACTING user's notifications ---
    if (!updatedUser.notifications) {
      updatedUser.notifications = [];
    }
    updatedUser.notifications.push(notification);

    // --- 2. Send real-time notification to the ACTING user ---
    const actingUserSocket = connectedUsers.get(userId);
    if (actingUserSocket) {
      actingUserSocket.emit('notification', notification);
    }

    // --- 3. Add notification to OTHER followers (and send real-time) ---
    // ONLY if it's a FOLLOW action, and EXCLUDE the acting user.
    if (isFollowing) { // Only send to other followers on FOLLOW
      if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
        updatedConference.followedBy.forEach(follower => {
          if (follower.id !== userId) { // Exclude the acting user!
            const userFollowIndex = users.findIndex(u => u.id === follower.id);
            if (userFollowIndex !== -1) {
              const followerNotification: Notification = {
                id: uuidv4(), // New ID for each!
                createdAt: now,
                isImportant: false,
                seenAt: null,
                deletedAt: null,
                message: notificationMessage, // Same message/type
                type: notificationType,
              };

              if (!users[userFollowIndex].notifications) {
                users[userFollowIndex].notifications = [];
              }
              users[userFollowIndex].notifications?.push(followerNotification);

              // Realtime
              const userSocket = connectedUsers.get(follower.id);
              if (userSocket) {
                userSocket.emit('notification', followerNotification); // Send to followers
              }
            }
          }
        });
      }
    }

    // --- Update user and conference data ---
    users[userIndex] = updatedUser;
    conferences[conferenceIndex] = updatedConference;

    await Promise.all([
      fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
      fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
    ]);

    res.status(200).json(updatedUser);

  } catch (error: any) {
    console.error('Error updating user/conference data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in a JSON file' });
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'A required JSON file was not found' });
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

    const data = await fs.promises.readFile(userFilePath, 'utf-8');
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


// Hàm so sánh mảng không quan tâm thứ tự
function areArraysEqual(arr1: any[] | undefined, arr2: any[] | undefined): boolean {
    if (!arr1 && !arr2) return true; // Cả hai đều undefined
    if (!arr1 || !arr2) return false; // Một trong hai là undefined
    if (arr1.length !== arr2.length) return false;

    const sortedArr1 = [...arr1].sort();
    const sortedArr2 = [...arr2].sort();

    for (let i = 0; i < sortedArr1.length; i++) {
        if (sortedArr1[i] !== sortedArr2[i]) return false;
    }

    return true;
}

// 5. Update User
const updateUser: RequestHandler<{ id: string }, UserResponse | { message: string }, Partial<UserResponse>, any> = async (req, res) => {
    try {
        const userId = req.params.id;
        const updatedData = req.body;

        if (!userId) {
            return res.status(400).json({ message: 'Missing userId' }) as any;
        }

        const data = await fs.promises.readFile(userFilePath, 'utf-8');
        const users: UserResponse[] = JSON.parse(data);

        const userIndex = users.findIndex(u => u.id === userId);

        if (userIndex === -1) {
            return res.status(404).json({ message: 'User not found' });
        }

        const oldUser = { ...users[userIndex] }; // Lưu lại user data cũ để so sánh
        const updatedUser = { ...users[userIndex], ...updatedData }; // Cập nhật thông tin user

        // --- Tạo notification ---
        const now = new Date().toISOString();
        let notificationMessage = `Your profile has been updated.`; // Default message

        // So sánh các trường quan trọng để tạo message chi tiết hơn (optional):
        const changedFields: string[] = [];
        if (oldUser.firstName !== updatedUser.firstName) {
            changedFields.push('First Name');
        }
        if (oldUser.lastName !== updatedUser.lastName) {
            changedFields.push('Last Name');
        }
        if (oldUser.email !== updatedUser.email) {
            changedFields.push("Email");
        }
        if (oldUser.aboutme !== updatedUser.aboutme) {
            changedFields.push("About me");
        }
        if (oldUser.avatar !== updatedUser.avatar) {
            changedFields.push("Avatar");
        }
        if (!areArraysEqual(oldUser.interestedTopics, updatedUser.interestedTopics)) {
            changedFields.push("Interested topics");
        }
        if (oldUser.background !== updatedUser.background) {
            changedFields.push("Interests");
        }


        if (changedFields.length > 0) {
             notificationMessage = `Your profile has been updated: ${changedFields.join(', ')} were changed.`;
        }
        //Tạo notification
        const notification: Notification = {
            id: uuidv4(),
            createdAt: now,
            isImportant: false, // Or true, depending on your needs
            seenAt: null,
            deletedAt: null,
            message: notificationMessage,
            type: 'Profile Update', // Set a notification type
        };

        // --- 1. Add to user's notifications ---
        if (!updatedUser.notifications) {
            updatedUser.notifications = [];
        }
        updatedUser.notifications.push(notification);

        // --- 2. Send real-time notification ---
        const userSocket = connectedUsers.get(userId);
        if (userSocket) {
            userSocket.emit('notification', notification);
        }


        // --- Update user data ---
        users[userIndex] = updatedUser;
        await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

        res.status(200).json(updatedUser);

    } catch (error: any) {
        console.error('Error updating user:', error);
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in user-list.json' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'user-list.json not found' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};

app.put('/api/v1/user/:id', updateUser);

// 6. Add conference (updated)
const addConference: RequestHandler<any, AddedConference | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const conferenceData: ConferenceFormData = req.body;
    const { userId } = req.body; // Get userId from request body

    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized: Missing userId' }) as any; // Return 401 Unauthorized
    }

    // Create unique IDs
    const conferenceId = uuidv4();
    const organizationId = uuidv4();
    const locationId = uuidv4();

    const addedConference: AddedConference = {
      conference: {
        id: conferenceId,
        title: conferenceData.title,
        acronym: conferenceData.acronym,
        creatorId: userId, // Get user ID from request
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      organization: {
        id: organizationId,
        year: new Date().getFullYear(), // Current year
        accessType: conferenceData.type, // Get from form
        isAvailable: true,
        conferenceId: conferenceId,
        summary: conferenceData.description,
        callForPaper: '',
        link: conferenceData.link,
        cfpLink: '',
        impLink: '',
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
        id: uuidv4(),
        organizedId: organizationId,
        fromDate: new Date(date.fromDate).toISOString(),
        toDate: new Date(date.toDate).toISOString(),
        type: date.type,
        name: date.name,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        isAvailable: true,
      })),

      rankSourceFoRData: [],
      status: 'Pending', // Default status
    };


    let existingConferences: AddedConference[] = [];

    // Read and update add_conferences.json (as before)
    try {
      const fileExists = await fs.promises.access(addConferencesFilePath).then(() => true).catch(() => false);
      if (fileExists) {
        const data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
        if (data.trim() !== "") {
          existingConferences = JSON.parse(data);
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading conference data:', error);
        throw error;
      }
    }
    existingConferences.push(addedConference);
    await fs.promises.writeFile(addConferencesFilePath, JSON.stringify(existingConferences, null, 2), 'utf-8');


    // --- Update users_list.json ---
    const usersListFilePath = path.resolve(__dirname, './database/users_list.json');
    let usersList: UserResponse[] = [];

    try {
      const usersFileExists = await fs.promises.access(usersListFilePath).then(() => true).catch(() => false);
      if (usersFileExists) {
        const usersData = await fs.promises.readFile(usersListFilePath, 'utf-8');
        if (usersData.trim() !== "") {
          usersList = JSON.parse(usersData);
        }
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading users data:', error);
        throw error;
      }
    }

    // Find the user in users_list.json
    const userIndex = usersList.findIndex(user => user.id === userId);

    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' }) as any; // User not found in users_list.json
    }

    // Create the MyConference object
    const newMyConference: MyConference = {
      id: conferenceId,
      status: 'Pending', // Initial status
      statusTime: "",
      submittedAt: new Date().toISOString(),
    };

    // Add or update the myConferences array
    if (!usersList[userIndex].myConferences) {
      usersList[userIndex].myConferences = [newMyConference];
    } else {
      usersList[userIndex].myConferences.push(newMyConference);
    }

    // Write the updated users list back to the file
    await fs.promises.writeFile(usersListFilePath, JSON.stringify(usersList, null, 2), 'utf-8');


    res.status(201).json(addedConference); // Return the added conference

  } catch (error: any) {
    console.error('Error adding conference:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in a JSON file' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};
app.post('/api/v1/user/add-conference', addConference);


// 7. Get User's Conferences ---
const getMyConferences: RequestHandler<{ id: string }, AddedConference[] | { message: string }, any, any> = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: 'Missing userId' }) as any;
    }

    const filePath = path.resolve(__dirname, './database/add_conferences.json');

    let addedConferences: AddedConference[] = []; // Initialize as empty array

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      // Check for empty file *before* parsing.  This is much more robust.
      if (data.trim() === '') {  // .trim() removes leading/trailing whitespace
        // File is empty, no need to parse. `addedConferences` is already [].
        // You *could* return here with a specific message, but it's not usually necessary.
      } else {
        addedConferences = JSON.parse(data);  // Parse only if there's content
      }


    } catch (error: any) {
      // Distinguish between file-not-found and other errors.
      if (error.code === 'ENOENT') {
        // File not found, `addedConferences` remains [].  This is a perfectly valid case.
        // Again, you could return a specific message if you wanted.
      } else {
        // Other I/O or parsing errors
        console.error('Error reading or parsing conference file:', error);
        return res.status(500).json({ message: 'Internal server error' });
      }
    }

    // Filter conferences by creatorId.  This will work correctly even if addedConferences is [].
    const userConferences = addedConferences.filter(conf => conf.conference.creatorId === userId);

    res.status(200).json(userConferences);
  } catch (error: any) {
    // This outer catch is probably not needed if you handle errors within the inner try/catch properly.
    console.error('Error fetching user conferences:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.get('/api/v1/user/:id/conferences', getMyConferences); // New route


// 8. Add to calendar (with real-time notifications)
const addToCalendar: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
  try {
    const { conferenceId, userId } = req.body;

    if (!conferenceId || !userId) {
      res.status(400).json({ message: 'Missing conferenceId or userId' });
      return;
    }

    const userFilePath = path.resolve(__dirname, './database/users_list.json');
    const conferenceFilePath = path.resolve(__dirname, './database/conference_details_list.json');

    const [userData, conferenceData] = await Promise.all([
      fs.promises.readFile(userFilePath, 'utf-8'),
      fs.promises.readFile(conferenceFilePath, 'utf-8'),
    ]);

    const users: UserResponse[] = JSON.parse(userData);
    const conferences: ConferenceResponse[] = JSON.parse(conferenceData);

    const userIndex = users.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const conferenceIndex = conferences.findIndex(c => c.conference.id === conferenceId);
    if (conferenceIndex === -1) {
      res.status(404).json({ message: 'Conference not found' });
      return;
    }

    const updatedUser: UserResponse = { ...users[userIndex] };
    const updatedConference: ConferenceResponse = { ...conferences[conferenceIndex] };
    const now = new Date().toISOString();

    if (!updatedUser.calendar) {
      updatedUser.calendar = [];
    }

    const existingCalendarIndex = updatedUser.calendar.findIndex(c => c.id === conferenceId);

    let notificationType: 'Add to Calendar' | 'Remove from Calendar';
    let notificationMessage: string;
    let isAdding: boolean; // Flag to indicate add or remove

    if (existingCalendarIndex !== -1) {
      // Remove from calendar:
      updatedUser.calendar.splice(existingCalendarIndex, 1);
      notificationType = 'Remove from Calendar';
      notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} removed the conference "${updatedConference.conference.title}" from their calendar.`;
      isAdding = false;
    } else {
      // Add to calendar:
      updatedUser.calendar.push({
        id: conferenceId,
        createdAt: now,
        updatedAt: now,
      });
      notificationType = 'Add to Calendar';
      notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} added the conference "${updatedConference.conference.title}" to their calendar.`;
      isAdding = true;
    }

    // --- Create the notification object ---
    const notification: Notification = {
      id: uuidv4(),
      createdAt: now,
      isImportant: false,  // Or true, based on your needs
      seenAt: null,
      deletedAt: null,
      message: notificationMessage,
      type: notificationType,
    };

    // --- 1. Add notification to the ACTING user's notifications ---
    if (!updatedUser.notifications) {
      updatedUser.notifications = [];
    }
    updatedUser.notifications.push(notification);

    // --- 2. Send real-time notification to the ACTING user ---
    const actingUserSocket = connectedUsers.get(userId);
    if (actingUserSocket) {
      actingUserSocket.emit('notification', notification);
    }

    // --- 3. Add notification to OTHER followers (and send real-time) ---
    // ONLY if it's an ADD action, and EXCLUDE the acting user.
    //  AND ONLY if the user is also following the conference.
    if (isAdding) {  //Only send notification add
      if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
        updatedConference.followedBy.forEach(follower => {
          if (follower.id !== userId) { // Exclude acting user
            const userFollowIndex = users.findIndex(u => u.id === follower.id);
            if (userFollowIndex !== -1) {
              //Check user is following the conference
              if (users[userFollowIndex].followedConferences?.find(fc => fc.id === conferenceId)) {
                const followerNotification: Notification = {
                  id: uuidv4(),
                  createdAt: now,
                  isImportant: false,
                  seenAt: null,
                  deletedAt: null,
                  message: notificationMessage, //Same message
                  type: notificationType
                };

                if (!users[userFollowIndex].notifications) {
                  users[userFollowIndex].notifications = [];
                }
                users[userFollowIndex].notifications?.push(followerNotification);

                //Realtime
                const userSocket = connectedUsers.get(follower.id);
                if (userSocket) {
                  userSocket.emit('notification', followerNotification);
                }
              }
            }
          }
        })
      }
    }



    // --- Update user and conference data ---
    users[userIndex] = updatedUser;
    conferences[conferenceIndex] = updatedConference; // Update conference as well (though no changes here, good practice)

    await Promise.all([
      fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
      fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
    ]);

    res.status(200).json(updatedUser);

  } catch (error: any) {
    console.error('Error updating user/conference data:', error);
    if (error instanceof SyntaxError) {
      res.status(500).json({ message: 'Invalid JSON format in a JSON file' });
    } else if (error.code === 'ENOENT') {
      res.status(500).json({ message: 'A required JSON file was not found' });
    } else {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
};
app.post('/api/v1/user/:id/add-to-calendar', addToCalendar);


// 9. Lấy calendar events
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

    const calendarIds = user.calendar.map(item => item.id);
    console.log("8. User's calendar IDs:", calendarIds);

    const detailsFilePath = path.resolve(__dirname, './database/conference_details_list.json');
    console.log("9. Conference details file path:", detailsFilePath);

    let detailsData: string;
    try {
      detailsData = await
        fs.promises.readFile(detailsFilePath, 'utf-8').catch(() => '[]');
      console.log("11. Conference data read successfully.");
    } catch (error) {
      console.error("Error reading conference files:", error);
      return res.status(500).json({ message: "Error reading conference data." });
    }

    let detailsConferences: ConferenceResponse[];
    try {
      detailsConferences = JSON.parse(detailsData);
      console.log("12. Details conferences parsed. Count:", detailsConferences.length);
    } catch (error) {
      console.error("Error parsing conference_details_list.json", error);
      return res.status(500).json({ message: "Error parsing details conference data." });
    }


    const allConferences = [
      ...detailsConferences.map(c => ({
        id: c.conference.id,
        title: c.conference.title,
        dates: c.dates,
      })),

    ];
    console.log("14. All conferences. Count:", allConferences.length);

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


// 10. Filter conferences
const getFilteredConferences: RequestHandler<any, { items: CombinedConference[]; total: number; } | { message: string }, any, any> = async (req, res) => {
  console.log("Request received at /api/v1/filter-conferences");
  console.log("Request query parameters:", req.query);

  try {
    const detailsFilePath = path.resolve(__dirname, './database/conference_details_list.json');

    console.log("detailsFilePath:", detailsFilePath);

    const detailsData = await fs.promises.readFile(detailsFilePath, 'utf-8').catch(() => {
      console.log("Error reading detailsFilePath. Returning empty array.");
      return '[]';
    });


    console.log("detailsData (first 100 chars):", detailsData.substring(0, 100));

    let detailsConferences: ConferenceResponse[];

    try {
      detailsConferences = JSON.parse(detailsData);
      console.log("detailsConferences length:", detailsConferences.length);
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


// 11. Add feedback (with real-time notifications)
const addFeedback: RequestHandler<{ conferenceId: string }, Feedback | { message: string }, { description: string; star: number; creatorId: string }> = async (req, res) => {
  const { conferenceId } = req.params;
  const { description, star, creatorId } = req.body;

  if (!description || star === undefined || star < 1 || star > 5 || !creatorId) {
    res.status(400).json({ message: 'Invalid feedback data' });
    return;
  }

  try {
    const conferenceFilePath = path.resolve(__dirname, './database/conference_details_list.json');
    const userFilePath = path.resolve(__dirname, './database/users_list.json'); // Need user data

    const [conferenceData, userData] = await Promise.all([
      fs.promises.readFile(conferenceFilePath, 'utf-8'),
      fs.promises.readFile(userFilePath, 'utf-8'), // Read user data
    ]);

    const conferences: ConferenceResponse[] = JSON.parse(conferenceData);
    const users: UserResponse[] = JSON.parse(userData); // Parse user data

    const conferenceIndex = conferences.findIndex(c => c.conference.id === conferenceId);
    if (conferenceIndex === -1) {
      res.status(404).json({ message: 'Conference not found' });
      return;
    }

    const updatedConference: ConferenceResponse = { ...conferences[conferenceIndex] };
    const organizedId = updatedConference.organization.id;

    // --- Find the creator user ---
    const creatorIndex = users.findIndex(u => u.id === creatorId);
    if (creatorIndex === -1) {
      res.status(404).json({ message: 'Creator user not found' });
      return; // Important: Return to prevent further execution
    }
    const creatorUser = users[creatorIndex];

    const newFeedback: Feedback = {
      id: uuidv4(),
      organizedId,
      creatorId,
      description,
      star,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (!updatedConference.feedBacks) {
      updatedConference.feedBacks = [];
    }
    updatedConference.feedBacks.push(newFeedback);


    // --- Create the notification message ---
    const notificationMessage = `${creatorUser.firstName} ${creatorUser.lastName} provided feedback for the conference "${updatedConference.conference.title}": ${star} stars.`;

    // --- Create the notification object ---
    const notification: Notification = {
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      isImportant: false, // Set as appropriate
      seenAt: null,
      deletedAt: null,
      message: notificationMessage,
      type: 'New Feedback', // Consistent notification type
    };

    // --- 1. Send real-time notification to the ACTING user (the feedback creator) ---
    const actingUserSocket = connectedUsers.get(creatorId);
    if (actingUserSocket) {
      const creatorNotification: Notification = { ...notification, id: uuidv4() }; // Create a separate notification object
      if (!creatorUser.notifications) {
        creatorUser.notifications = [];
      }
      creatorUser.notifications.push(creatorNotification);
      actingUserSocket.emit('notification', creatorNotification); // Notify the creator
    }


    // --- 2. Send to followers (excluding the creator) ---
    if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
      updatedConference.followedBy.forEach(follower => {
        if (follower.id !== creatorId) {  // Exclude the feedback creator
          const followerIndex = users.findIndex(u => u.id === follower.id);
          if (followerIndex !== -1) {
            const followerUser = users[followerIndex];

            // Create a separate notification object for each follower
            const followerNotification: Notification = {
              ...notification, // Copy common properties
              id: uuidv4(),     // Ensure unique ID
            };

            if (!followerUser.notifications) {
              followerUser.notifications = [];
            }
            followerUser.notifications.push(followerNotification);

            // Real-time notification to follower
            const followerSocket = connectedUsers.get(follower.id);
            if (followerSocket) {
              followerSocket.emit('notification', followerNotification);
            }
          }
        }
      });
    }

    // --- Update conference and users data ---
    conferences[conferenceIndex] = updatedConference; // Update the conference
    users[creatorIndex] = creatorUser; //Update creator

    await Promise.all([
      fs.promises.writeFile(conferenceFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
      fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'), // Write updated users
    ]);


    res.status(201).json(newFeedback);
  } catch (error: any) {
    console.error('Error adding feedback:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.post('/api/v1/conferences/:conferenceId/feedback', addFeedback); // Use conferenceId in URL


// 12. Delete User
const deleteUser: RequestHandler<{ id: string }, { message: string } | { error: string }, any, any> = async (req, res): Promise<any> => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({ message: 'Missing userId' });
    }

    const filePath = path.resolve(__dirname, './database/users_list.json'); // Path to your users file
    let usersData: string;

    try {
      usersData = await fs.promises.readFile(filePath, 'utf-8');
    } catch (readError: any) {
      if (readError.code === 'ENOENT') {
        // File doesn't exist, meaning no users.  That's not really an error in this context.
        return res.status(404).json({ message: 'No users found.' });
      }
      console.error("Error reading users file:", readError);
      return res.status(500).json({ message: "Error reading user data" });
    }

    let users: UserResponse[];
    try {
      users = JSON.parse(usersData);
    } catch (parseError) {
      console.error("Error parsing user data:", parseError);
      return res.status(500).json({ message: 'Invalid user data format.' });
    }


    const userIndex = users.findIndex(user => user.id === userId);


    console.log(userIndex)
    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Remove the user from the array
    users.splice(userIndex, 1);

    try {
      await fs.promises.writeFile(filePath, JSON.stringify(users, null, 2), 'utf-8');
    } catch (writeError) {
      console.error("Error writing updated user data:", writeError);
      return res.status(500).json({ message: "Error saving updated user data." });
    }

    res.status(200).json({ message: 'User deleted successfully' });

  } catch (error: any) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
app.delete('/api/v1/user/:id', deleteUser); // Define the DELETE route

// 13. Get notifications
const getUserNotifications: RequestHandler<{ id: string }, Notification[] | { message: string }, any, any> = async (req, res) => {
  try {
    const { id } = req.params;
    const userFilePath = path.resolve(__dirname, './database/users_list.json');

    const userData = await fs.promises.readFile(userFilePath, 'utf-8');
    const users: UserResponse[] = JSON.parse(userData);

    const user = users.find(u => u.id === id);
    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Sắp xếp notifications trước khi trả về
    const sortedNotifications = (user.notifications || []).sort((a, b) => {
      // Chuyển đổi chuỗi ngày tháng thành đối tượng Date để so sánh
      const dateA = new Date(a.createdAt);
      const dateB = new Date(b.createdAt);
      return dateB.getTime() - dateA.getTime(); // Sắp xếp giảm dần (mới nhất lên đầu)
    });

    res.status(200).json(sortedNotifications);

  } catch (error) {
    console.error('Error getting user notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.get('/api/v1/user/:id/notifications', getUserNotifications);

// 14. Mark All Notifications as Read
const markAllNotificationsAsRead: RequestHandler<{ id: string }, { message: string }, any, any> = async (req, res) => {
  try {
    const { id } = req.params;

    const userData = await fs.promises.readFile(userFilePath, 'utf-8');
    const users: UserResponse[] = JSON.parse(userData);

    const userIndex = users.findIndex(u => u.id === id);
    if (userIndex === -1) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const updatedUser: UserResponse = { ...users[userIndex] };

    // Mark all notifications as read (set seenAt)
    if (updatedUser.notifications && updatedUser.notifications.length > 0) {
      updatedUser.notifications = updatedUser.notifications.map(n => ({
        ...n,
        seenAt: n.seenAt ? n.seenAt : new Date().toISOString(), // Don't overwrite if already seen
      }));
    }

    users[userIndex] = updatedUser;
    await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

    res.status(200).json({ message: 'Notifications marked as read' });

  } catch (error) {
    console.error('Error marking notifications as read:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

app.put('/api/v1/user/:id/notifications/mark-all-as-read', markAllNotificationsAsRead); // Use PUT or POST


const adminConferences: RequestHandler = async (req, res): Promise<void> => {
  const addConferencesPath = path.resolve(__dirname, './database/add_conferences.json');
  const conferencesListPath = path.resolve(__dirname, './database/conferences_list.json');
  const conferenceDetailsListPath = path.resolve(__dirname, './database/conference_details_list.json');
  const usersListPath = path.resolve(__dirname, './database/users_list.json'); // Path to users_list.json


  if (req.method === 'GET') {
    // ... (Your existing GET request handling - no changes needed) ...
    try {
      let data = '';
      try {
        data = await fs.promises.readFile(addConferencesPath, 'utf-8');
      } catch (readError) {
        if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
          // File not found
          data = '[]';
        } else {
          throw readError; // Other errors
        }
      }
      const addConferences: AddedConference[] = data.trim() ? JSON.parse(data) : [];
      const pendingConferences = addConferences.filter(c => c.status === 'Pending');

      // Create the HTML response
      const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Admin Panel - Conference Approval</title>
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid black; padding: 8px; text-align: left; }
        </style>
      </head>
      <body>
        <h1>Pending Conferences</h1>
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Acronym</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pendingConferences.map(conf => `
              <tr>
                <td>${conf.conference.title}</td>
                <td>${conf.conference.acronym}</td>
                <td>${conf.conference.createdAt}</td>
                <td>
                  <form action="/admin/conferences" method="POST">
                    <input type="hidden" name="conferenceId" value="${conf.conference.id}">
                    <input type="hidden" name="action" value="approve">
                    <button type="submit">Approve</button>
                  </form>
                  <form action="/admin/conferences" method="POST">
                    <input type="hidden" name="conferenceId" value="${conf.conference.id}">
                    <input type="hidden" name="action" value="reject">
                    <button type="submit">Reject</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </body>
      </html>
    `;

      res.status(200).send(html);

    } catch (error) {
      console.error('Error reading or parsing add_conferences.json:', error);
      res.status(500).send('Internal Server Error');
    }

  } else if (req.method === 'POST') {
    const { conferenceId, action } = req.body;

    if (!conferenceId || !action || (action !== 'approve' && action !== 'reject')) {
      res.status(400).send('Bad Request: Invalid input');
    }

    try {
      // Read files (handling potential errors)
      let addConferences: AddedConference[] = [];
      try {
        const data = await fs.promises.readFile(addConferencesPath, 'utf-8');
        addConferences = data.trim() ? JSON.parse(data) : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      let conferencesList: ConferenceListResponse;
      try {
        const data = await fs.promises.readFile(conferencesListPath, 'utf-8');
        conferencesList = JSON.parse(data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          conferencesList = { payload: [], meta: { curPage: 0, perPage: 0, prevPage: 0, totalPage: 0, nextPage: 0, totalItems: 0 } }; // Initialize
        } else {
          throw error;
        }
      }


      let conferenceDetailsList: ConferenceResponse[] = [];
      try {
        const data = await fs.promises.readFile(conferenceDetailsListPath, 'utf-8');
        conferenceDetailsList = data.trim() ? JSON.parse(data) : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      let usersList: UserResponse[] = [];
      try {
        const data = await fs.promises.readFile(usersListPath, 'utf-8');
        usersList = data.trim() ? JSON.parse(data) : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }


      // Find the conference
      const conferenceIndex = addConferences.findIndex(c => c.conference.id === conferenceId);
      if (conferenceIndex === -1) {
        res.status(404).send('Conference not found');
      }
      const conferenceToProcess = addConferences[conferenceIndex];

      // Get the creator's ID.  *CRITICAL* for updating the user's record.
      const creatorId = conferenceToProcess.conference.creatorId;

      // Find the user in users_list.json
      const userIndex = usersList.findIndex(user => user.id === creatorId);
      if (userIndex === -1) {
        res.status(404).json({ message: 'User not found' }); // Very important!
      }

      // Approve/Reject logic
      if (action === 'approve') {
        conferenceToProcess.status = 'Approved';

        const newConferenceListItem: ConferenceInfo = {
          id: conferenceToProcess.conference.id,
          title: conferenceToProcess.conference.title,
          acronym: conferenceToProcess.conference.acronym,
          location: {
            cityStateProvince: conferenceToProcess.locations.cityStateProvince,
            country: conferenceToProcess.locations.country,
            address: conferenceToProcess.locations.address,
            continent: conferenceToProcess.locations.continent
          },
          year: conferenceToProcess.organization.year,
          rankSourceFoRData: conferenceToProcess.rankSourceFoRData[0],
          topics: conferenceToProcess.organization.topics,
          dates: {
            fromDate: conferenceToProcess.dates.find(d => d.type === 'Conference Date')?.fromDate || '',
            toDate: conferenceToProcess.dates.find(d => d.type === 'Conference Date')?.toDate || '',
            name: conferenceToProcess.dates.find(d => d.type === 'Conference Date')?.name || '',
            type: conferenceToProcess.dates.find(d => d.type === 'Conference Date')?.type || ''
          },
          link: conferenceToProcess.organization.link,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          creatorId: conferenceToProcess.conference.creatorId,
          accessType: conferenceToProcess.organization.accessType,
          status: conferenceToProcess.status
        };
        conferencesList.payload.push(newConferenceListItem);

        const newConferenceDetailItem: ConferenceResponse = {
          conference: conferenceToProcess.conference,
          organization: conferenceToProcess.organization,
          locations: conferenceToProcess.locations,
          dates: conferenceToProcess.dates,
          rankSourceFoRData: conferenceToProcess.rankSourceFoRData,
          feedBacks: [],
          followedBy: []
        };
        conferenceDetailsList.push(newConferenceDetailItem);

        // Find and update the conference status in the user's myConferences array
        const myConfIndex = usersList[userIndex].myConferences?.findIndex(c => c.id === conferenceId);
        if (myConfIndex !== undefined && myConfIndex !== -1) {
          usersList[userIndex].myConferences![myConfIndex].status = 'Approved'; // Update the status
          usersList[userIndex].myConferences![myConfIndex].statusTime = new Date().toISOString(); // Update the status; // Update the status

        }


      } else { // action === 'reject'
        conferenceToProcess.status = 'Rejected';

        // Find and update the conference status in the user's myConferences array
        const myConfIndex = usersList[userIndex].myConferences?.findIndex(c => c.id === conferenceId);
        if (myConfIndex !== undefined && myConfIndex !== -1) {
          usersList[userIndex].myConferences![myConfIndex].status = 'Rejected'; // Update the status
          usersList[userIndex].myConferences![myConfIndex].statusTime = new Date().toISOString(); // Update the status; // Update the status

        }
      }

      // Update addConferences (for both approve and reject)
      addConferences[conferenceIndex] = conferenceToProcess;

      // Write back to files
      await Promise.all([
        fs.promises.writeFile(addConferencesPath, JSON.stringify(addConferences, null, 2)),
        fs.promises.writeFile(conferencesListPath, JSON.stringify(conferencesList, null, 2)),
        fs.promises.writeFile(conferenceDetailsListPath, JSON.stringify(conferenceDetailsList, null, 2)),
        fs.promises.writeFile(usersListPath, JSON.stringify(usersList, null, 2)), // Update users_list.json
      ]);

      res.redirect('/admin/conferences');

    } catch (error) {
      console.error('Error processing approval/rejection:', error);
      res.status(500).send('Internal Server Error');
    }
  }
};

app.get('/admin/conferences', adminConferences);
app.post('/admin/conferences', adminConferences);


// // --- Start the server ---
// app.listen(3000, () => {
//   console.log(`Server listening on port 3000`);
// });

httpServer.listen(3000, () => {
  console.log(`Server is running on port 3000`);
});
