import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';
import { AddedConference } from '../types/addConference';
import { ConferenceFormData } from '../types/addConference';
import { MyConference } from '../types/user.response';


const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const addConferencesFilePath = path.resolve(__dirname, '../database/add_conferences.json');


// 6. Add conference (updated with notifications and settings check)
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

export const addConference: RequestHandler<any, AddedConference | { message: string }, any, any> = async (req, res): Promise<void> => {
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