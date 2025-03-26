import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';

const userFilePath = path.resolve(__dirname, './database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, './database/DB_details.json');



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
export const addToCalendar: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
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