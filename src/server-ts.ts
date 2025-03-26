import express from 'express';
import { Server as HttpServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import 'dotenv/config';
import path from 'path';
import bodyParser from 'body-parser';
import fs from 'fs';
import multer from 'multer';
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

app.use(cors(corsOptions));
app.use(express.json());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));



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


const conferencesListFilePath = path.resolve(__dirname, './database/DB.json');
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

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
import { verifyEmail } from './route/signupUser';
import { blacklistConference } from './route/addToBlacklist';

app.get('/api/v1/conference/:id', getConferenceById);
app.get('/api/v1/conference', getConferenceList);
app.post('/api/v1/user/:id/follow', followConference);
app.get('/api/v1/user/:id', getUserById);
app.put('/api/v1/user/:id', updateUser);
app.post('/api/v1/user/add-conference', addConference);
app.get('/api/v1/user/:id/conferences', getMyConferences);
app.post('/api/v1/user/:id/add-to-calendar', addToCalendar);
app.post('/api/v1/user/:id/blacklist', blacklistConference);
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
app.post('/api/v1/user/verify-password', verifyPassword);
app.post('/api/v1/user/change-password', changePassword);
app.get('/api/v1/user/verify-email/:token', verifyEmail);



import cron from 'node-cron';
cron.schedule('*/60 * * * *', checkUpcomingConferenceDates);

httpServer.listen(3001, () => {
    console.log(`Server is running on port 3001`);
});