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



import { ConferenceResponse, FollowerInfo, ImportantDates, Location } from './types/conference.response';
import { ConferenceListResponse, ConferenceInfo, Meta } from './types/conference.list.response';
import { UserResponse, MyConference, Notification } from './types/user.response';
import { AddedConference, ConferenceFormData } from './types/addConference';
import { CalendarEvent } from './types/calendar';
import { Feedback } from './types/conference.response';
import { GoogleLoginRequestBody } from './types/google-login';
import { v4 as uuidv4 } from 'uuid'; // Import thư viện uuid

// --- Route Handlers ---



const userFilePath = path.resolve(__dirname, './database/users_list.json');
const addConferencesFilePath = path.resolve(__dirname, './database/add_conferences.json');
const conferencesListFilePath = path.resolve(__dirname, './database/DB.json');
const conferenceDetailsFilePath = path.resolve(__dirname, './database/DB_details.json');

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
        if (date?.fromDate) {
          date.fromDate = new Date(date?.fromDate).toISOString();
        }
        if (date?.toDate) {
          date.toDate = new Date(date?.toDate).toISOString();
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
app.get('/api/v1/conference', getConferenceList);



// 3. Follow conference (CORRECTED - No Duplicate Notifications)
// --- Helper Function to Check Notification Settings ---
function shouldSendFollowNotification(user: UserResponse, notificationType: 'Follow' | 'Unfollow'): boolean {
  const settings = user.setting;

  if (!settings) {
    return false; // No settings, default to no notifications.
  }

  if (settings.receiveNotifications === false) {
    return false; // User has disabled all notifications.
  }

  if (notificationType === 'Follow' && settings.notificationWhenFollow === false) {
    return false;
  }
  if (notificationType === 'Unfollow' && settings.notificationWhenFollow === false) {
    return false;
  }


  return true; // All checks passed, send notification.
}

// --- Follow/Unfollow Conference Handler ---

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
      updatedConference.followedBy = updatedConference.followedBy.filter(followedBy => followedBy.id !== userId);
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

    // --- Notification Logic (with settings check) ---
    const notification: Notification = {
      id: uuidv4(),
      createdAt: now,
      isImportant: false,
      seenAt: null,
      deletedAt: null,
      message: notificationMessage,
      type: notificationType,
    };
    // 1.  ACTING USER
    if (shouldSendFollowNotification(updatedUser, isFollowing ? 'Follow' : 'Unfollow')) {
      if (!updatedUser.notifications) {
        updatedUser.notifications = [];
      }
      updatedUser.notifications.push(notification);

      const actingUserSocket = connectedUsers.get(userId);
      if (actingUserSocket) {
        actingUserSocket.emit('notification', notification);
      }
    }

    // 2. OTHER FOLLOWERS (only on follow, and check THEIR settings)
    if (isFollowing) {
      if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
        updatedConference.followedBy.forEach(followedBy => {
          if (followedBy.id !== userId) {
            const userFollowIndex = users.findIndex(u => u.id === followedBy.id);
            if (userFollowIndex !== -1) {
              const followerUser = users[userFollowIndex];
              if (shouldSendFollowNotification(followerUser, 'Follow')) {
                const followerNotification: Notification = {
                  id: uuidv4(),
                  createdAt: now,
                  isImportant: false,
                  seenAt: null,
                  deletedAt: null,
                  message: notificationMessage,
                  type: notificationType,
                };

                if (!followerUser.notifications) {
                  followerUser.notifications = [];
                }
                followerUser.notifications.push(followerNotification);
                const userSocket = connectedUsers.get(followedBy.id);
                if (userSocket) {
                  userSocket.emit('notification', followerNotification);
                }


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


function shouldSendUpdateProfileNotification(user: UserResponse): boolean {
  const settings = user.setting;

  if (!settings) {
    return false;
  }

  if (settings.receiveNotifications === false) {
    return false;
  }

  if (settings.notificationWhenUpdateProfile === false) {
    return false;
  }

  return true;
}


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

    const oldUser = { ...users[userIndex] }; // Copy of old user data
    const updatedUser = { ...users[userIndex], ...updatedData }; // Merge updates

    // --- Determine changed fields ---
    const changedFields: string[] = [];
    if (oldUser.firstName !== updatedUser.firstName) changedFields.push('First Name');
    if (oldUser.lastName !== updatedUser.lastName) changedFields.push('Last Name');
    if (oldUser.email !== updatedUser.email) changedFields.push("Email");
    if (oldUser.aboutme !== updatedUser.aboutme) changedFields.push("About me");
    if (oldUser.avatar !== updatedUser.avatar) changedFields.push("Avatar");
    if (!areArraysEqual(oldUser.interestedTopics, updatedUser.interestedTopics)) changedFields.push("Interested topics");
    if (oldUser.background !== updatedUser.background) changedFields.push("Interests");

    const settingChangedFields: string[] = [];
    if (oldUser.setting?.autoAddFollowToCalendar !== updatedUser.setting?.autoAddFollowToCalendar) settingChangedFields.push("Auto Add Follow To Calendar");
    if (oldUser.setting?.notificationWhenConferencesChanges !== updatedUser.setting?.notificationWhenConferencesChanges) settingChangedFields.push("Notification When Conferences Change");
    if (oldUser.setting?.upComingEvent !== updatedUser.setting?.upComingEvent) settingChangedFields.push("Upcoming Event");
    if (oldUser.setting?.notificationThrough !== updatedUser.setting?.notificationThrough) settingChangedFields.push("Notification Delivery Method");

    // --- Check for non-setting changes ---
    const hasNonSettingChanges = changedFields.length > 0;

    // --- Create and send notification (only for non-setting changes AND if settings allow) ---
    if (hasNonSettingChanges && shouldSendUpdateProfileNotification(updatedUser)) { // Key change: Check settings
      const now = new Date().toISOString();
      let notificationMessage = `Your profile has been updated: ${changedFields.join(', ')} were changed.`;

      const notification: Notification = {
        id: uuidv4(),
        createdAt: now,
        isImportant: false,
        seenAt: null,
        deletedAt: null,
        message: notificationMessage,
        type: 'Profile Update',
      };

      if (!updatedUser.notifications) {
        updatedUser.notifications = [];
      }
      updatedUser.notifications.push(notification);

      // --- Send real-time notification (if connected) ---
      const userSocket = connectedUsers.get(userId);
      if (userSocket) {
        userSocket.emit('notification', notification); // Send via Socket.IO
      }
    }


    // --- Update user data ---
    users[userIndex] = updatedUser;
    await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

    res.status(200).json(updatedUser);

  } catch (error: any) {
    console.error('Error updating user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.put('/api/v1/user/:id', updateUser);

// 6. Add conference (updated with notifications)
// --- Helper function to check notification settings ---
function shouldSendAddConferenceNotification(user: UserResponse): boolean {
  const settings = user.setting;

  if (!settings || settings.receiveNotifications === false) {
    return false; // No settings or notifications disabled.
  }

  // Currently, there's no specific setting for "add conference" notifications,
  // so we just check receiveNotifications.  If you add a specific setting
  // in the future (e.g., notificationWhenAddConference), you'd check it here.

  return true; // All checks passed, send notification.
}

// 6. Add conference (updated with notifications and settings check)
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
        publisher: "",
        isAvailable: true,
        conferenceId: conferenceId,
        summerize: conferenceData.description,
        callForPaper: '',
        link: conferenceData.link,
        cfpLink: '',
        impLink: '',
        topics: conferenceData.topics,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      location: {
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
      rank: "",
      source: "",
      researchFields: "",
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
    let usersList: UserResponse[] = [];

    try {
      const usersFileExists = await fs.promises.access(userFilePath).then(() => true).catch(() => false);
      if (usersFileExists) {
        const usersData = await fs.promises.readFile(userFilePath, 'utf-8');
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
    // --- NOTIFICATIONS ---

    const now = new Date().toISOString();
    const notificationMessage = `You added a new conference: ${addedConference.conference.title}`;

    // 1. Notification for the ACTING user (check settings!)
    if (shouldSendAddConferenceNotification(usersList[userIndex])) {
      const userNotification: Notification = {
        id: uuidv4(),
        createdAt: now,
        isImportant: false,
        seenAt: null,
        deletedAt: null,
        message: notificationMessage,
        type: 'Add Conference',
      };

      if (!usersList[userIndex].notifications) {
        usersList[userIndex].notifications = [];
      }
      usersList[userIndex].notifications.push(userNotification);

      // 2. Real-time notification to the ACTING user
      const actingUserSocket = connectedUsers.get(userId);
      if (actingUserSocket) {
        actingUserSocket.emit('notification', userNotification);
      }
    }

    // 3. Notification for ADMIN users (always send to admins)
    const adminNotificationMessage = `User ${usersList[userIndex].firstName} ${usersList[userIndex].lastName} added a new conference: ${addedConference.conference.title}`;

    for (const user of usersList) {
      if (user.role === 'admin') { // Assuming you have a 'role' property
        // Admins *always* get notifications, so no settings check needed here.
        const adminNotification: Notification = {
          id: uuidv4(),
          createdAt: now,
          isImportant: true, // Mark as important for admins
          seenAt: null,
          deletedAt: null,
          message: adminNotificationMessage,
          type: 'Add Conference',
        };

        if (!user.notifications) {
          user.notifications = [];
        }
        user.notifications.push(adminNotification);

        // Real-time notification to the admin
        const adminSocket = connectedUsers.get(user.id);
        if (adminSocket) {
          adminSocket.emit('notification', adminNotification);
        }
      }
    }

    // Write the updated users list back to the file
    await fs.promises.writeFile(userFilePath, JSON.stringify(usersList, null, 2), 'utf-8');
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


    let addedConferences: AddedConference[] = []; // Initialize as empty array

    try {
      const data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
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


// Helper Function:  shouldSendAddToCalendarNotification (DRY principle)
function shouldSendAddToCalendarNotification(user: UserResponse, action: 'add' | 'remove'): boolean {
  const settings = user.setting;

  if (!settings) {
    return false; // Default to not sending if no settings
  }

  if (settings.receiveNotifications === false) {
    return false; // User has disabled all notifications
  }
  if (action === 'add') {
    if (settings.notificationWhenAddTocalendar === false) {
      return false;
    }
  }
  if (action === 'remove') {
    if (settings.notificationWhenAddTocalendar === false) {
      return false;
    }
  }


  return true; // All checks passed, send the notification
}
// 8. Add to calendar (with real-time notifications)
const addToCalendar: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
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

    // --- 1. Add notification to the ACTING user's notifications (IF SETTINGS ALLOW) ---
    if (shouldSendAddToCalendarNotification(updatedUser, isAdding ? 'add' : 'remove')) {
      if (!updatedUser.notifications) {
        updatedUser.notifications = [];
      }
      updatedUser.notifications.push(notification);

      // --- 2. Send real-time notification to the ACTING user ---
      const actingUserSocket = connectedUsers.get(userId);
      if (actingUserSocket) {
        actingUserSocket.emit('notification', notification);
      }
    }

    // --- 3. Add notification to OTHER followers (and send real-time) ---
    // ONLY if it's an ADD action, and EXCLUDE the acting user.
    //  AND ONLY if the user is also following the conference.
    //  AND ONLY if the follower's settings allow it.
    if (isAdding) {  //Only send notification add
      if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
        updatedConference.followedBy.forEach(followedBy => {
          if (followedBy.id !== userId) { // Exclude acting user
            const userFollowIndex = users.findIndex(u => u.id === followedBy.id);
            if (userFollowIndex !== -1) {
              const followerUser = users[userFollowIndex];
              //Check user is following the conference
              if (followerUser.followedConferences?.find(fc => fc.id === conferenceId)) {
                // Check follower's settings!
                if (shouldSendAddToCalendarNotification(followerUser, 'add')) {
                  const followerNotification: Notification = {
                    id: uuidv4(),
                    createdAt: now,
                    isImportant: false,
                    seenAt: null,
                    deletedAt: null,
                    message: notificationMessage, //Same message
                    type: notificationType
                  };

                  if (!followerUser.notifications) {
                    followerUser.notifications = [];
                  }
                  followerUser.notifications?.push(followerNotification);

                  //Realtime
                  const userSocket = connectedUsers.get(followedBy.id);
                  if (userSocket) {
                    userSocket.emit('notification', followerNotification);
                  }
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


const getUserCalendar: RequestHandler = async (req, res) => {
  console.log(`[START] getUserCalendar for user ID: ${req.params.id}`); // Bắt đầu request
  try {
    const userId = req.params.id;
    console.log(`[1] userId: ${userId}`);

    if (!userId) {
      console.log('[ERROR] Missing userId');
      return res.status(400).json({ message: 'Missing userId' }) as any;
    }

    let users: UserResponse[] = [];
    try {
      const userData = await fs.promises.readFile(userFilePath, 'utf-8');
      users = JSON.parse(userData);
      console.log(`[2] Users loaded from file. Number of users: ${users.length}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error("[ERROR] Error reading or parsing users_list.json:", error);
        return res.status(500).json({ message: 'Error reading or parsing user data' });
      }
      console.log('[2] users_list.json not found or empty.  Continuing with empty users array.');
    }

    const user = users.find(u => u.id === userId);
    console.log(`[3] User found (or not): ${user ? 'Yes' : 'No'}`);

    if (!user) {
      console.log(`[ERROR] User not found for ID: ${userId}`);
      return res.status(404).json({ message: 'User not found' });
    }

    if (!user.calendar || user.calendar.length === 0) {
      console.log(`[4] User has no calendar entries.`);
      return res.status(200).json([]); // Trả về mảng rỗng, không phải lỗi
    }

    const calendarIds = user.calendar.map(item => item.id);
    console.log(`[5] Calendar IDs for user: ${calendarIds.join(', ')}`);

    let detailsConferences: ConferenceResponse[] = [];
    try {
      const detailsData = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
      detailsConferences = JSON.parse(detailsData);
      console.log(`[6] Conference details loaded. Number of conferences: ${detailsConferences.length}`);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error("[ERROR] Error reading or parsing conference_details_list.json:", error);
        return res.status(500).json({ message: "Error reading or parsing details conference data." });
      }
      console.log('[6] conference_details_list.json not found or empty. Continuing with empty array.');
    }

    if (detailsConferences.length === 0) {
      console.log('[7] No conference details found.');
      return res.status(200).json([]);
    }

    const allConferences = detailsConferences.map(c => ({
      id: c.conference.id,
      title: c.conference.title || "No Title", // Handle null titles
      dates: c.dates || [],
    }));
    console.log(`[8] allConferences (mapped):`, allConferences);

    const calendar = allConferences.filter(conf => calendarIds.includes(conf.id));
    console.log(`[9] Filtered conferences (calendar):`, calendar);

    if (calendar.length === 0) {
      console.log('[10] No matching conferences found in user calendar.');
      return res.status(200).json([]);
    }

    const calendarEvents: CalendarEvent[] = [];

    calendar.forEach(conf => {
      console.log(`[11] Processing conference: ${conf.title} (ID: ${conf.id})`);
      if (conf.dates) {
        conf.dates.forEach(date => {
          console.log(`[12] Processing date:`, date);
          // Check for null values on date properties
          if (date && date.fromDate && date.toDate) {
            const fromDate = new Date(date.fromDate);
            const toDate = new Date(date.toDate);

            if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
              console.error(`[ERROR] Invalid date format for conference ${conf.id}, date:`, date);
              return;
            }

            const diffTime = Math.abs(toDate.getTime() - fromDate.getTime());
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            console.log(`[13] Date difference in days: ${diffDays}`);

            if (diffDays > 0) {
              for (let i = 0; i <= diffDays; i++) {
                const currentDate = new Date(fromDate);
                currentDate.setDate(fromDate.getDate() + i);
                console.log(`[14] Adding event for date: ${currentDate.toLocaleDateString()}`);
                calendarEvents.push({
                  day: currentDate.getDate(),
                  month: currentDate.getMonth() + 1,
                  year: currentDate.getFullYear(),
                  type: date.type, // Already handled null type in interface
                  conference: conf.title,
                  conferenceId: conf.id,
                });
              }
            } else {
              console.log(`[14] Adding single-day event for date: ${fromDate.toLocaleDateString()}`);
              calendarEvents.push({
                day: fromDate.getDate(),
                month: fromDate.getMonth() + 1,
                year: fromDate.getFullYear(),
                type: date.type, // Already handled null type in interface
                conference: conf.title,
                conferenceId: conf.id,
              });
            }
          } else {
            console.warn(`[WARN] Skipping date for conference ${conf.id} due to missing fromDate or toDate`);
          }
        });
      } else {
        console.warn(`[WARN] Skipping conference ${conf.id} due to missing dates`);
      }
    });

    console.log('[15] Final calendarEvents:', calendarEvents);
    return res.status(200).json(calendarEvents);

  } catch (error: any) {
    console.error('[ERROR] Error fetching calendar events:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

app.get('/api/v1/user/:id/calendar', getUserCalendar);


// 11. Add feedback (with real-time notifications)
const addFeedback: RequestHandler<{ conferenceId: string }, Feedback | { message: string }, { description: string; star: number; creatorId: string }> = async (req, res) => {
  const { conferenceId } = req.params;
  const { description, star, creatorId } = req.body;
  if (!description || star === undefined || star < 1 || star > 5 || !creatorId) {
    res.status(400).json({ message: 'Invalid feedback data' });
    return;
  }

  try {

    const [conferenceData, userData] = await Promise.all([
      fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
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
    const organizedId = updatedConference.organization?.id;

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
      updatedConference.followedBy.forEach(followedBy => {
        if (followedBy.id !== creatorId) {  // Exclude the feedback creator
          const followerIndex = users.findIndex(u => u.id === followedBy.id);
          if (followerIndex !== -1) {
            const followerUser = users[followerIndex];

            // Create a separate notification object for each followedBy
            const followerNotification: Notification = {
              ...notification, // Copy common properties
              id: uuidv4(),     // Ensure unique ID
            };

            if (!followerUser.notifications) {
              followerUser.notifications = [];
            }
            followerUser.notifications.push(followerNotification);

            // Real-time notification to followedBy
            const followerSocket = connectedUsers.get(followedBy.id);
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
      fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
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

    let usersData: string;

    try {
      usersData = await fs.promises.readFile(userFilePath, 'utf-8');
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
      await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
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

    // console.log(sortedNotifications)
    res.status(200).json(sortedNotifications);

  } catch (error) {
    console.error('Error getting user notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.get('/api/v1/user/:id/notifications', getUserNotifications);

// 14. Update User Notifications:
// NEW ROUTE: Update user notifications
interface UpdateNotificationsRequest extends Request {
  params: {
    id: string;
  };
  body: {  //Define the body type
    notifications: Notification[];
  };
}

const updateNotificationsHandler: RequestHandler<UpdateNotificationsRequest["params"], { message: string }, UpdateNotificationsRequest["body"]> = async (req, res) => {
  try {
    const { id } = req.params;
    const { notifications } = req.body;
    console.log(id)
    // 1. Read the users_list.json file
    const fileContent = await fs.promises.readFile(userFilePath, 'utf-8');
    const usersList = JSON.parse(fileContent);

    // 2. Find the user by ID
    const userIndex = usersList.findIndex((user: any) => user.id === id);
    console.log(userIndex)
    if (userIndex === -1) {
      return res.status(404).json({ message: 'User not found' }) as any;
    }

    // 3. Validate the notifications data (optional, but recommended)
    if (!Array.isArray(notifications)) {
      return res.status(400).json({ message: 'Invalid notifications data. Must be an array.' });
    }
    // You might add more specific validation of the Notification objects here.

    // 4. Update the user's notifications
    usersList[userIndex].notifications = notifications;

    // 5. Write the updated data back to the file
    await fs.promises.writeFile(userFilePath, JSON.stringify(usersList, null, 2), 'utf-8');

    res.status(200).json({ message: 'Notifications updated successfully' });

  } catch (error: any) {
    console.error('Error updating notifications:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.put('/api/v1/user/:id/notifications', updateNotificationsHandler);

// 15. Mark All Notifications as Read
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


  if (req.method === 'GET') {
    // ... (Your existing GET request handling - no changes needed) ...
    try {
      let data = '';
      try {
        data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
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

    // // *** IMPORTANT: Get the Admin's User ID ***  REMOVED - No longer needed
    // // Replace this with your actual authentication/session logic
    // const adminUserId = req.body.adminId; //  PLACEHOLDER - Replace this!  e.g., req.session.userId, req.user.id
    //   if (!adminUserId) {
    //     return res.status(401).send('Unauthorized: Missing adminUserId');
    //   }

    if (!conferenceId || !action || (action !== 'approve' && action !== 'reject')) {
      res.status(400).send('Bad Request: Invalid input');
      return; // Added return to prevent further execution
    }

    try {
      // Read files (handling potential errors)
      let addConferences: AddedConference[] = [];
      try {
        const data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
        addConferences = data.trim() ? JSON.parse(data) : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      let conferencesList: ConferenceListResponse;
      try {
        const data = await fs.promises.readFile(conferencesListFilePath, 'utf-8');
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
        const data = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
        conferenceDetailsList = data.trim() ? JSON.parse(data) : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }

      let usersList: UserResponse[] = [];
      try {
        const data = await fs.promises.readFile(userFilePath, 'utf-8');
        usersList = data.trim() ? JSON.parse(data) : [];
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }


      // Find the conference
      const conferenceIndex = addConferences.findIndex(c => c.conference.id === conferenceId);
      if (conferenceIndex === -1) {
        res.status(404).send('Conference not found'); // Added return
      }
      const conferenceToProcess = addConferences[conferenceIndex];

      // Get the creator's ID.  *CRITICAL* for updating the user's record.
      const creatorId = conferenceToProcess.conference.creatorId;

      // Find the user in users_list.json
      const userIndex = usersList.findIndex(user => user.id === creatorId);
      if (userIndex === -1) {
        res.status(404).json({ message: 'User not found' }); // Very important!  Added return
      }

      //   // Find Admin user  REMOVED - No longer needed
      //   const adminIndex = usersList.findIndex(user => user.id === adminUserId);
      //   if (adminIndex === -1) {
      //       return res.status(404).json({ message: 'Admin not found' });
      //   }

      const now = new Date().toISOString();
      let notificationType: 'Approve Conference' | 'Reject Conference';
      let notificationMessage: string;

      // Approve/Reject logic
      if (action === 'approve') {
        conferenceToProcess.status = 'Approved';
        notificationType = 'Approve Conference';
        notificationMessage = `Your conference "${conferenceToProcess.conference.title}" has been approved.`;


        const newConferenceListItem: ConferenceInfo = {
          id: conferenceToProcess.conference.id,
          title: conferenceToProcess.conference.title,
          acronym: conferenceToProcess.conference.acronym,
          location: {
            cityStateProvince: conferenceToProcess.location.cityStateProvince,
            country: conferenceToProcess.location.country,
            address: conferenceToProcess.location.address,
            continent: conferenceToProcess.location.continent
          },
          year: conferenceToProcess.organization.year,
          rank: conferenceToProcess.rank,
          source: conferenceToProcess.source,
          researchFields: conferenceToProcess.researchFields,
          topics: conferenceToProcess.organization.topics,
          dates: {
            fromDate: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.fromDate || '',
            toDate: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.toDate || '',
            name: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.name || '',
            type: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.type || ''
          },
          link: conferenceToProcess.organization.link,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          creatorId: conferenceToProcess.conference.creatorId,
          accessType: conferenceToProcess.organization.accessType,
          publisher: conferenceToProcess.organization.publisher,
          status: conferenceToProcess.status
        };
        conferencesList.payload.push(newConferenceListItem);

        const newConferenceDetailItem: ConferenceResponse = {
          conference: conferenceToProcess.conference,
          organization: conferenceToProcess.organization,
          location: conferenceToProcess.location,
          dates: conferenceToProcess.dates,
          ranks: [{
            rank: conferenceToProcess.rank,
            source: conferenceToProcess.source,
            fieldOfResearch: conferenceToProcess.researchFields,
          }],

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
        notificationType = 'Reject Conference';
        notificationMessage = `Your conference "${conferenceToProcess.conference.title}" has been rejected.`;

        // Find and update the conference status in the user's myConferences array
        const myConfIndex = usersList[userIndex].myConferences?.findIndex(c => c.id === conferenceId);
        if (myConfIndex !== undefined && myConfIndex !== -1) {
          usersList[userIndex].myConferences![myConfIndex].status = 'Rejected'; // Update the status
          usersList[userIndex].myConferences![myConfIndex].statusTime = new Date().toISOString(); // Update the status; // Update the status

        }
      }

      // --- Notifications ---

      // 1. Notification for the CONFERENCE CREATOR
      const creatorNotification: Notification = {
        id: uuidv4(),
        createdAt: now,
        isImportant: true, // Probably important for the creator
        seenAt: null,
        deletedAt: null,
        message: notificationMessage,
        type: notificationType,
      };

      if (!usersList[userIndex].notifications) {
        usersList[userIndex].notifications = [];
      }
      usersList[userIndex].notifications.push(creatorNotification);

      // 2. Real-time notification to the CONFERENCE CREATOR
      const creatorSocket = connectedUsers.get(creatorId);
      if (creatorSocket) {
        creatorSocket.emit('notification', creatorNotification);
      }

      // //3. Notification for the ADMIN  REMOVED - No admin notification needed
      // const adminNotification: Notification = {
      //   id: uuidv4(),
      //   createdAt: now,
      //   isImportant: false, // Probably important for the creator
      //   seenAt: null,
      //   deletedAt: null,
      //   message: `You ${action} conference ${conferenceToProcess.conference.title}`,
      //   type: notificationType,
      // }

      // if (!usersList[adminIndex].notifications) {
      //   usersList[adminIndex].notifications = [];
      // }
      // usersList[adminIndex].notifications.push(adminNotification);

      // // 4. Real-time notification to the ADMIN  REMOVED - No admin notification needed
      // const adminSocket = connectedUsers.get(adminUserId);
      // if (adminSocket) {
      //   adminSocket.emit('notification', adminNotification);
      // }


      // Update addConferences (for both approve and reject)
      addConferences[conferenceIndex] = conferenceToProcess;

      // Write back to files
      await Promise.all([
        fs.promises.writeFile(addConferencesFilePath, JSON.stringify(addConferences, null, 2)),
        fs.promises.writeFile(conferencesListFilePath, JSON.stringify(conferencesList, null, 2)),
        fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferenceDetailsList, null, 2)),
        fs.promises.writeFile(userFilePath, JSON.stringify(usersList, null, 2)), // Update users_list.json
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



// 16. DB to JSON : Receive and save conference data
// --- Save Conference List ---
const saveConferenceData: RequestHandler<any, { message: string }, ConferenceListResponse, any> = async (
  req,
  res
) => {
  try {
    const receivedData: ConferenceListResponse = req.body;

    if (!receivedData || !receivedData.payload || !Array.isArray(receivedData.payload)) {
      return res.status(400).json({ message: 'Invalid data format received.' }) as any;
    }

    let dbData: ConferenceListResponse = { payload: [], meta: {} as Meta }; // Initialize with an empty structure
    try {
      const fileContent = await fs.promises.readFile(conferencesListFilePath, 'utf-8');
      dbData = JSON.parse(fileContent);

      //Ensure that dbData and its payload are arrays.
      if (!dbData || !dbData.payload || !Array.isArray(dbData.payload)) {
        dbData = { payload: [], meta: dbData?.meta || {} as Meta }; //Re-initialize if necessary
      }

    } catch (error: any) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        console.error('Error reading DB.json:', error);
        return res.status(500).json({ message: 'Error reading DB.json' });
      }
      // If the file doesn't exist, it's fine; dbData is already initialized.
    }

    // Iterate through received conferences and add them if they don't exist.
    let addedCount = 0;
    for (const conference of receivedData.payload) {
      const exists = dbData.payload.some(existingConf => existingConf.id === conference.id);
      if (!exists) {
        dbData.payload.push(conference);
        addedCount++;
      }
    }
    dbData.meta = receivedData.meta;


    // Only write if there are new conferences.
    if (addedCount > 0) {
      await fs.promises.writeFile(conferencesListFilePath, JSON.stringify(dbData, null, 2), 'utf-8');
      res.status(200).json({ message: `${addedCount} new conferences added.` });
    } else {
      res.status(200).json({ message: 'No new conferences to add.' }); // Still a 200 OK
    }

  } catch (error: any) {
    console.error('Error saving conference data:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.post('/api/v1/conferences/save', saveConferenceData);


// --- Save Conference Details ---

// --- Helper Function to Compare Conference Details and Generate Detailed Message ---
function getConferenceChanges(oldConf: ConferenceResponse, newConf: ConferenceResponse): { hasChanges: boolean; message: string } {
  let message = "Conference updates:";
  let hasChanges = false;

  function addChange(field: string, oldValue: any, newValue: any) {
    if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
      message += `\n- ${field}: Changed from "${oldValue ?? 'N/A'}" to "${newValue ?? 'N/A'}".\n`;
      hasChanges = true;
    }
  }

  function addChangeDate(field: string, oldDates: ImportantDates[] | null, newDates: ImportantDates[] | null) {
    if (!oldDates && !newDates) return;

    if (!oldDates || !newDates || oldDates.length !== newDates.length) {
      message += `- ${field}: Dates have been changed.\n`;
      hasChanges = true;
      return;
    }

    for (let i = 0; i < oldDates.length; i++) {
      const oldDate = oldDates[i];
      const newDate = newDates[i];

      if (!oldDate && !newDate) continue;
      if (!oldDate || !newDate) {
        message += `- ${field}: Dates have been changed.\n`;
        hasChanges = true;
        return;
      }

      // Only check and provide detailed changes for "conferenceDates"
      if (oldDate.type === "conferenceDates" && newDate.type === "conferenceDates") {
        if (oldDate.fromDate !== newDate.fromDate) {
          message += `- ${field}: Conference start date changed from "${oldDate.fromDate ?? 'N/A'}" to "${newDate.fromDate ?? 'N/A'}".\n`;
          hasChanges = true;
        }
        if (oldDate.toDate !== newDate.toDate) {
          message += `- ${field}: Conference end date changed from "${oldDate.toDate ?? 'N/A'}" to "${newDate.toDate ?? 'N/A'}".\n`;
          hasChanges = true;
        }
      } else if (oldDate.fromDate !== newDate.fromDate || oldDate.toDate !== newDate.toDate || oldDate.name !== newDate.name || oldDate.type !== newDate.type) {
        // For other date types, just indicate a change
        message += `- ${field}: Dates have been changed.\n`;
        hasChanges = true;
        return; // Important: Exit the loop after finding a change in non-conference dates
      }
    }
  }

  function addChangeLocation(field: string, oldLocation: Location | null, newLocation: Location | null) {
    if (!oldLocation && !newLocation) return;
    if (!oldLocation || !newLocation) {
      message += `\n- ${field}: Location has been changed.\n`;
      hasChanges = true;
      return;
    }
    if (oldLocation.address !== newLocation.address) {
      message += `\n  - ${field}: Address changed from "${oldLocation.address ?? 'N/A'}" to "${newLocation.address ?? 'N/A'}".\n`;
      hasChanges = true;
    }
    if (oldLocation.cityStateProvince !== newLocation.cityStateProvince) {
      message += `\n  - ${field}:  City/State/Province from "${oldLocation.cityStateProvince ?? 'N/A'}" to "${newLocation.cityStateProvince ?? 'N/A'}".\n`;
      hasChanges = true;
    }
    if (oldLocation.country !== newLocation.country) {
      message += `\n  - ${field}: Country changed from "${oldLocation.country ?? 'N/A'}" to "${newLocation.country ?? 'N/A'}".\n`;
      hasChanges = true;
    }
    if (oldLocation.continent !== newLocation.continent) {
      message += `\n  - ${field}: Continent changed from "${oldLocation.continent ?? 'N/A'}" to "${newLocation.continent ?? 'N/A'}".\n`;
      hasChanges = true;
    }
  }


  addChange("Title", oldConf.conference.title, newConf.conference.title);
  addChange("Acronym", oldConf.conference.acronym, newConf.conference.acronym);
  addChange("Organization Link", oldConf.organization?.link, newConf.organization?.link);
  addChange("Publisher", oldConf.organization?.publisher, newConf.organization?.publisher);
  addChange("Access Type", oldConf.organization?.accessType, newConf.organization?.accessType);
  addChange("Year", oldConf.organization?.year, newConf.organization?.year);
  addChangeDate("Dates", oldConf.dates, newConf.dates);
  addChangeLocation("Location", oldConf.location, newConf.location);
  addChange("Ranks", JSON.stringify(oldConf.ranks), JSON.stringify(newConf.ranks));


  return { hasChanges, message: hasChanges ? message : "" };
}

// --- Helper Function to Check Notification Settings ---
function shouldSendUpdateConferenceNotification(user: UserResponse, notificationType: string): boolean {
  const settings = user.setting;

  if (!settings) {
    return false; // Default to no notifications if settings are missing
  }

  if (settings.receiveNotifications === false) {
    return false; // User has disabled all notifications
  }
  if (notificationType === "Conference Update" && settings.notificationWhenConferencesChanges === false) {
    return false;
  }

  // Add more specific checks here based on notificationType and user settings
  return true; // All checks passed, or no specific checks for this type
}

// --- Save Conference Details ---
// --- Save Conference Details ---
const saveConferenceDetails: RequestHandler<any, { message: string }, ConferenceResponse, any> = async (req, res) => {
  try {
    const receivedData: ConferenceResponse = req.body;

    if (!receivedData || !receivedData.conference || !receivedData.conference.id) {
      return res.status(400).json({ message: 'Invalid data format received.  Missing conference ID.' }) as any;
    }

    const conferenceId = receivedData.conference.id;

    let dbDetailsData: ConferenceResponse[] = [];
    let users: UserResponse[] = [];

    try {
      const fileContent = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
      dbDetailsData = JSON.parse(fileContent);
      if (!Array.isArray(dbDetailsData)) {
        dbDetailsData = [];
      }
    } catch (error: any) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
        console.error('Error reading DB_details.json:', error);
        return res.status(500).json({ message: 'Error reading DB_details.json' });
      }
    }

    try {
      const usersFileContent = await fs.promises.readFile(userFilePath, 'utf-8');
      users = JSON.parse(usersFileContent);

      if (!Array.isArray(users)) {
        users = [];
      }
    } catch (userError: any) {
      if (userError.code !== 'ENOENT' && !(userError instanceof SyntaxError)) {
        console.error('Error reading users.json:', userError);
        return res.status(500).json({ message: 'Error reading users.json' });
      }
    }

    const existingConferenceIndex = dbDetailsData.findIndex(conf => conf.conference.id === conferenceId);

    if (existingConferenceIndex === -1) {
      // Conference doesn't exist, add it (no notifications on initial add).
      dbDetailsData.push(receivedData);
      await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8');
      return res.status(200).json({ message: 'Conference details saved successfully.' });
    } else {
      // Conference exists, update it.
      const oldConference = { ...dbDetailsData[existingConferenceIndex] };
      const updatedConference = { ...oldConference };

      updatedConference.conference = receivedData.conference;
      updatedConference.organization = receivedData.organization;
      updatedConference.location = receivedData.location;
      updatedConference.dates = receivedData.dates;
      updatedConference.ranks = receivedData.ranks;
      // Do NOT update feedBacks and followedBy

      const { hasChanges, message: detailedMessage } = getConferenceChanges(oldConference, updatedConference);

      if (hasChanges) {
        dbDetailsData[existingConferenceIndex] = updatedConference;
        await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8');

        // --- Notification Logic ---
        const now = new Date().toISOString();

        // 1. Notify Followers:
        if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
          updatedConference.followedBy.forEach(followerInfo => {
            const user = users.find(u => u.id === followerInfo.id);
            // Find the follow information for this conference
            const followInfo = user?.followedConferences?.find(f => f.id === conferenceId);
            // Construct base message with conference and follow details
            const baseMessage = `Update for conference "${updatedConference.conference.title}" (Followed since ${followInfo?.createdAt.toString().substring(0, 10) ?? 'N/A'}):\n`;

            if (user && shouldSendUpdateConferenceNotification(user, "Conference Update")) {
              const notification: Notification = {
                id: uuidv4(),
                createdAt: now,
                isImportant: true,
                seenAt: null,
                deletedAt: null,
                message: baseMessage + detailedMessage, // Combine base and detailed messages
                type: 'Conference Update',
              };
              if (!user.notifications) {
                user.notifications = [];
              }
              user.notifications.push(notification);

              const userSocket = connectedUsers.get(user.id);
              if (userSocket) {
                userSocket.emit('notification', notification);
              }
            }
          });
        }

        // 2. Notify Users who added to Calendar:
        users.forEach(user => {
          if (user.calendar && user.calendar.some(c => c.id === conferenceId)) {
            //Find the calendar information for this conference
            const calendarInfo = user.calendar.find(c => c.id === conferenceId);
            // Construct base message with conference and calendar details
            const baseMessage = `Update for conference "${updatedConference.conference.title}" (Added to calendar since ${calendarInfo?.createdAt ?? 'N/A'}):\n`;

            if (shouldSendUpdateConferenceNotification(user, "Conference Update")) {
              const calendarNotification: Notification = {
                id: uuidv4(),
                createdAt: now,
                isImportant: true,
                seenAt: null,
                deletedAt: null,
                message: baseMessage + detailedMessage, // Combine base and detailed
                type: 'Conference Update',
              };

              if (!user.notifications) {
                user.notifications = [];
              }
              user.notifications.push(calendarNotification);

              const userSocket = connectedUsers.get(user.id);
              if (userSocket) {
                userSocket.emit('notification', calendarNotification);
              }
            }
          }
        });

        await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

        return res.status(200).json({ message: 'Conference details updated successfully. Notifications sent.' });
      } else {
        return res.status(200).json({ message: 'Conference details updated. No changes detected.' });
      }
    }
  } catch (error: any) {
    console.error('Error saving/updating conference details:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

app.post('/api/v1/conferences/details/save', saveConferenceDetails);

// 17. Register User
const signupUser: RequestHandler<any, { message: string } | UserResponse, { firstname: string; lastname: string; email: string; password: string }, any> = async (req, res): Promise<any> => {
  try {
    const { firstname, lastname, email, password } = req.body;

    // --- Basic Validation (giống như trong form, nhưng nên validate cả ở backend) ---
    if (!firstname || !lastname || !email || !password) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Simple email format check (improve as needed)
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Invalid email format' });
    }

    // --- Check for Existing User (IMPORTANT) ---
    let users: UserResponse[] = [];
    try {
      const userData = await fs.promises.readFile(userFilePath, 'utf-8');
      users = JSON.parse(userData);
    } catch (error: any) {
      if (error.code !== 'ENOENT') { // Ignore "file not found", as that just means it's the first user.
        console.error('Error reading or parsing user data:', error);
        return res.status(500).json({ message: 'Internal server error' });
      }
      // If ENOENT (file not found), `users` will remain an empty array, which is fine.
    }

    const emailExists = users.some(user => user.email === email);
    if (emailExists) {
      return res.status(409).json({ message: 'Email already registered' }); // 409 Conflict
    }

    // --- Create User Object ---
    const now = new Date().toISOString();
    const newUser: UserResponse = {
      id: uuidv4(), // Generate unique ID
      firstName: firstname,  // Corrected casing
      lastName: lastname,    // Corrected casing
      email,
      password, //  Store the password (ideally, you'd hash this)
      dob: "",
      role: 'user', // Default role
      followedConferences: [],
      myConferences: [],
      calendar: [],
      feedBacks: [],
      notifications: [],
      createdAt: now,
      updatedAt: now,
    };
    // --- Add to Users Array and Save ---
    users.push(newUser);
    await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

    // --- Return Success Response (201 Created) ---
    //   It's good practice to return *some* user data, but NOT the password!
    const responseUser: UserResponse = { ...newUser };
    delete responseUser.password; //  Remove the password field
    res.status(201).json(responseUser);

  } catch (error: any) {
    console.error('Error signing up user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.post('/api/v1/user/signup', signupUser); // Register the route

// 18. Login user
const signinUser: RequestHandler<any, { message: string; user?: Omit<UserResponse, "password"> }, { email: string; password: string }, any> = async (req, res): Promise<any> => {
  try {
    const { email, password } = req.body;

    // --- Basic Validation ---
    if (!email || !password) {
      return res.status(400).json({ message: 'Missing email or password' });
    }

    // --- Read User Data ---
    let users: UserResponse[] = [];
    try {
      const userData = await fs.promises.readFile(userFilePath, 'utf-8');
      users = JSON.parse(userData);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading or parsing user data:', error);
        return res.status(500).json({ message: 'Internal server error' });
      }
      // If file doesn't exist, there are no users, login will fail.
    }

    // --- Find User by Email ---
    const user = users.find(u => u.email === email);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password' }); // 401 Unauthorized
    }

    // --- Check Password (DIRECT comparison - NOT RECOMMENDED) ---
    if (user.password !== password) { //  So sánh trực tiếp. KHÔNG AN TOÀN!
      return res.status(401).json({ message: 'Invalid email or password' }); // 401 Unauthorized
    }
    // --- Return Success Response (200 OK) ---
    // Create a copy of the user object and remove the password.  VERY IMPORTANT!
    const responseUser: Omit<UserResponse, "password"> = {
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      dob: user.dob,
      role: user.role,
      followedConferences: user.followedConferences,
      myConferences: user.myConferences,
      calendar: user.calendar,
      feedBacks: user.feedBacks,
      notifications: user.notifications,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      // Include any other fields you want to send *except* password
      ...(user.avatar && { avatar: user.avatar }),         // Conditionally include avatar
      ...(user.aboutme && { aboutme: user.aboutme }),   // Conditionally include aboutme
      ...(user.interestedTopics && { interestedTopics: user.interestedTopics }),
      ...(user.background && { background: user.background }),
    };

    res.status(200).json({ message: 'Login successful', user: responseUser });


  } catch (error: any) {
    console.error('Error signing in user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};
app.post('/api/v1/user/signin', signinUser); // Register the route


const googleLoginHandler: RequestHandler<any, { message: string; user?: Omit<UserResponse, 'password'> }, GoogleLoginRequestBody, any> = async (req, res) => {
  try {
    const { email, name, photoUrl } = req.body;
    console.log("Received from frontend:", { email, name, photoUrl }); // Log

    if (!email || !name) {
      console.log("Missing email or name in request body");
      return res.status(400).json({ message: "Missing email or name" }) as any;
    }

    // --- Read User Data ---
    let users: UserResponse[] = [];
    try {
      const userData = await fs.promises.readFile(userFilePath, 'utf-8');
      users = JSON.parse(userData);
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        console.error('Error reading or parsing user data:', error);
        return res.status(500).json({ message: 'Internal server error' });
      }
    }
    // --- Find or Create User ---
    let user = users.find(u => u.email === email);
    if (!user) {
      // Create
      const newUser: UserResponse = {
        id: uuidv4(),
        firstName: name.split(' ')[0],
        lastName: name.split(' ').slice(1).join(' '),
        email,
        password: '', // Important:  Empty password
        dob: '',
        role: 'user',
        followedConferences: [],
        myConferences: [],
        calendar: [],
        feedBacks: [],
        notifications: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        avatar: photoUrl || '', // Use provided photo URL
        aboutme: '',
        interestedTopics: [],
        background: '',
        setting: {
          receiveNotifications: true,
          autoAddFollowToCalendar: true,
          notificationWhenConferencesChanges: true,
          upComingEvent: true,
          notificationThrough: "System",
          notificationWhenUpdateProfile: true,
          notificationWhenFollow: true,
          notificationWhenAddTocalendar: true
        }
      };
      users.push(newUser);
      user = newUser;
      console.log("New user created:", user); // Log

    }
    else {
      // Update avatar
      if (photoUrl && user.avatar !== photoUrl) {
        user.avatar = photoUrl;
        console.log("User avatar updated:", user); // Log
      }
    }

    // --- Save User Data ---
    try {
      await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2));
      console.log("User data saved to file."); // Log

    }
    catch (err) {
      console.error("Error write user data:", err)
      return res.status(500).json({ message: "Error write file user data" })
    }

    // --- Return User Data ---
    const { password, ...userWithoutPassword } = user;
    res.status(200).json({ message: 'Google login successful', user: userWithoutPassword });

  } catch (error) {
    console.error("Google login backend error:", error); // Log tổng quát
    res.status(500).json({ message: 'Internal server error' });
  }
};

app.post('/api/v1/user/google-login', googleLoginHandler); // Register the route


// 19. Get Topics
app.get('/api/v1/topics', async (req, res) => {
  try {
    const rawData = await fs.promises.readFile(conferencesListFilePath, 'utf8');
    const data = JSON.parse(rawData); // data is now an ARRAY

    // Accumulate topics from all conferences
    let allTopics: string[] = [];
    for (const conferenceData of data.payload) {
      if (conferenceData.topics && Array.isArray(conferenceData.topics)) {
        allTopics = allTopics.concat(conferenceData.topics);
      }
    }

    // Remove duplicate topics (important!)
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


// --- Scheduled Task (using node-cron) ---

// Helper Function: shouldSendUpcomingEventNotification
function shouldSendUpcomingEventNotification(user: UserResponse): boolean {
  const settings = user.setting;
  // console.log(`Checking settings for user ${user.id}:`, settings); // Log user settings
  if (!settings) {
    // console.log(`User ${user.id} has no settings.  Not sending notification.`);
    return false;
  }

  if (settings.receiveNotifications === false) {
    // console.log(`User ${user.id} has receiveNotifications disabled. Not sending notification.`);
    return false;
  }
  if (settings.upComingEvent === false) {
    // console.log(`User ${user.id} has upComingEvent disabled. Not sending notification.`);
    return false;
  }
  // console.log(`User ${user.id} settings allow upcoming event notifications.`);
  return true;
}

async function checkUpcomingConferenceDates() {
  // console.log('--- Starting checkUpcomingConferenceDates ---');
  try {
    const [userData, conferenceData] = await Promise.all([
      fs.promises.readFile(userFilePath, 'utf-8').catch(err => {
        console.error("Error reading user file:", err);
        throw err; // Re-throw to be caught by the outer catch
      }),
      fs.promises.readFile(conferenceDetailsFilePath, 'utf-8').catch(err => {
        console.error("Error reading conference file:", err);
        throw err;
      }),
    ]);

    // console.log('Successfully read user and conference data.');

    const users: UserResponse[] = JSON.parse(userData);
    const conferences: ConferenceResponse[] = JSON.parse(conferenceData);

    const now = new Date();
    // console.log('Current time:', now.toISOString());

    for (const conference of conferences) {
      // console.log(`Checking conference: ${conference.conference.title} (ID: ${conference.conference.id})`);
      // Check if dates exist and are an array
      if (conference.dates && Array.isArray(conference.dates)) {
        for (const date of conference.dates) {
          // Check if fromDate exists
          if (date && date.fromDate) {
            const startDate = new Date(date.fromDate);
            const timeDiffMs = startDate.getTime() - now.getTime();
            const hoursBefore = timeDiffMs / (1000 * 60 * 60);

            // console.log(`  Checking date: ${date.name} (ID: ${date.id}), Start Date: ${startDate.toISOString()}, Hours Before: ${hoursBefore.toFixed(2)}`);

            // Example: Notify 24 hours and 1 hour before. Adjust as needed.
            if ((hoursBefore > 5 && hoursBefore <= 96) || (hoursBefore > 0.9 && hoursBefore <= 1)) {
              // console.log(`    Date is within notification window.`);

              // Find users following this conference.
              if (conference.followedBy) {
                // console.log(`    Conference has ${conference.followedBy.length} followers.`);
                for (const follower of conference.followedBy) {
                  const user = users.find(u => u.id === follower.id);

                  if (user) {
                    // console.log(`    Checking follower: ${user.firstName} ${user.lastName} (ID: ${user.id})`);

                    if (shouldSendUpcomingEventNotification(user)) {
                      const notificationMessage = `Upcoming event in conference "${conference.conference.title}": ${date.name || 'Event'} on ${date.fromDate.toString().substring(0, 10)}`; console.log(`      Sending notification to user ${user.id}: ${notificationMessage}`);

                      const notification: Notification = {
                        id: uuidv4(),
                        createdAt: new Date().toISOString(),
                        isImportant: true, // Mark as important
                        seenAt: null,
                        deletedAt: null,
                        message: notificationMessage,
                        type: 'Upcoming Conference',
                      };

                      if (!user.notifications) {
                        user.notifications = [];
                      }
                      user.notifications.push(notification);

                      // Send real-time notification.
                      const userSocket = connectedUsers.get(user.id);
                      if (userSocket) {
                        // console.log(`        Sending real-time notification to user ${user.id}`);
                        userSocket.emit('notification', notification);
                      } else {
                        // console.log(`        User ${user.id} is not currently connected.`);
                      }
                    } else {
                      // console.log(`      User ${user.id} does not meet notification criteria.`);
                    }
                  } else {
                    // console.log(`    Follower with ID ${follower.id} not found in users.`);
                  }
                }
              } else {
                console.log('    Conference has no followers.');
              }

              //Write to file  //MOVED INSIDE THE DATE/USER LOOP
              // console.log("    Writing updated data to files...");
              await Promise.all([
                fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
                fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8')
              ]).then(() => console.log("    Data written to files successfully."))
                .catch(err => console.error("    Error writing to files:", err));

            } else {
              // console.log('    Date is not within notification window.');
            }
          } else {
            // console.log('    Date or fromDate is missing for a conference date.');
          }
        }
      } else {
        // console.log('    Conference dates are missing or not an array.');
      }
    }
    // console.log('--- Finished checkUpcomingConferenceDates ---');

  } catch (error) {
    console.error('Error in checkUpcomingConferenceDates:', error);
  }
}

import cron from 'node-cron';

// Schedule the task.  Run every 30 minutes.  Adjust as needed.
cron.schedule('*/30 * * * *', checkUpcomingConferenceDates);


// // --- Start the server ---
// app.listen(3000, () => {
//   console.log(`Server listening on port 3000`);
// });

httpServer.listen(3000, () => {
  console.log(`Server is running on port 3000`);
});
