// src/controllers/userController.ts (or your relevant controller file)

import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid'; // Import uuid

// Import necessary types
import { UserResponse, BlackList, Notification } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response'; // Need this for conference title

// Import WebSocket connections map
import { connectedUsers } from '../server-ts'; // Adjust path as needed

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
// *** Need conference details to get the title for the notification message ***
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');

// --- Helper Function to Read/Write JSON Safely ---
async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return data.trim() ? JSON.parse(data) : defaultValue;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return defaultValue;
        }
        console.error(`Error reading JSON file ${filePath}:`, error);
        throw error;
    }
}

async function writeJsonFile<T>(filePath: string, data: T): Promise<void> {
    try {
        await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
        console.error(`Error writing JSON file ${filePath}:`, error);
        throw error;
    }
}

// --- Helper Function to Check Notification Settings for Blacklist ---
function shouldSendBlacklistNotification(user: UserResponse, notificationType: 'Add to Blacklist' | 'Remove from Blacklist'): boolean {
    const settings = user.setting;

    if (!settings) {
        console.log(`User ${user.id} has no settings defined.`);
        return false; // No settings, default to no notifications.
    }

    if (settings.receiveNotifications === false) {
        console.log(`User ${user.id} has disabled all notifications.`);
        return false; // User has disabled all notifications.
    }

    // Check the specific setting for blacklist notifications
    if (settings.notificationWhenAddToBlacklist === false) {
        console.log(`User ${user.id} has disabled blacklist notifications.`);
        return false;
    }

    // If we reach here, all checks passed
    console.log(`User ${user.id} should receive notification type: ${notificationType}`);
    return true;
}

// --- Blacklist/Unblacklist Conference Handler ---
export const blacklistConference: RequestHandler<
    { id: string },
    UserResponse | { message: string },
    { conferenceId: string },
    any
> = async (req, res): Promise<void> => {
    const userId = req.params.id;
    const { conferenceId } = req.body;

    if (!conferenceId || !userId) {
        res.status(400).json({ message: 'Missing conferenceId or userId' });
        return;
    }

    try {
        // Fetch both user and conference data concurrently
        const [users, conferences] = await Promise.all([
            readJsonFile<UserResponse[]>(userFilePath, []),
            readJsonFile<ConferenceResponse[]>(conferenceDetailsFilePath, []) // Fetch conference details
        ]);

        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        // Find the conference to get its title
        const conferenceIndex = conferences.findIndex(c => c.conference?.id === conferenceId);
        if (conferenceIndex === -1) {
            // Optional: You might allow blacklisting even if details aren't found,
            // but notifications won't have the title.
            console.warn(`Conference details not found for ID: ${conferenceId}. Blacklisting without title.`);
            // If you *require* details to exist:
            // return res.status(404).json({ message: 'Conference details not found' });
        }
        const targetConference = conferences[conferenceIndex]; // Might be undefined if not found
        const conferenceTitle = targetConference?.conference?.title || `Conference ID ${conferenceId}`; // Fallback title

        // Create a mutable copy of the user
        const updatedUser: UserResponse = { ...users[userIndex] };
        const now = new Date().toISOString();

        // Initialize blacklist if it doesn't exist
        if (!updatedUser.blacklist) {
            updatedUser.blacklist = [];
        }

        const existingBlacklistIndex = updatedUser.blacklist.findIndex(bc => bc.id === conferenceId);

        let notificationType: 'Add to Blacklist' | 'Remove from Blacklist';
        let notificationMessage: string;
        let isBlacklisting: boolean; // To pass to the settings check

        if (existingBlacklistIndex !== -1) {
            // --- Un-blacklist ---
            updatedUser.blacklist.splice(existingBlacklistIndex, 1);
            notificationType = 'Remove from Blacklist';
            notificationMessage = `You removed "${conferenceTitle}" from your blacklist.`;
            isBlacklisting = false; // Action is removal
            console.log(`User ${userId} removed conference ${conferenceId} from blacklist.`);
        } else {
            // --- Blacklist ---
            const newBlacklistItem: BlackList = {
                id: conferenceId,
                addedAt: now,
            };
            updatedUser.blacklist.push(newBlacklistItem);
            notificationType = 'Add to Blacklist';
            notificationMessage = `You added "${conferenceTitle}" to your blacklist.`;
            isBlacklisting = true; // Action is addition
            console.log(`User ${userId} added conference ${conferenceId} to blacklist.`);
        }

        // --- Notification Logic ---
        if (shouldSendBlacklistNotification(updatedUser, notificationType)) {
            const notification: Notification = {
                id: uuidv4(),
                createdAt: now,
                isImportant: false, // Blacklisting might not be considered "important"
                seenAt: null,
                deletedAt: null,
                message: notificationMessage,
                type: notificationType,
            };

            // 1. Add to persistent notifications in user object
            if (!updatedUser.notifications) {
                updatedUser.notifications = [];
            }
            updatedUser.notifications.push(notification);
            console.log(`Added persistent notification for user ${userId}: ${notificationType}`);

            // 2. Send real-time notification via WebSocket
            const userSocket = connectedUsers.get(userId);
            if (userSocket) {
                userSocket.emit('notification', notification);
                console.log(`Sent real-time notification to user ${userId}: ${notificationType}`);
            } else {
                console.log(`User ${userId} is not connected for real-time notification.`);
            }
        } else {
             console.log(`Notification suppressed for user ${userId} due to settings.`);
        }


        // --- Update user data in the array ---
        users[userIndex] = updatedUser;

        // --- Write the entire users array back to the file ---
        await writeJsonFile(userFilePath, users);

        // --- Return the updated user object ---
        res.status(200).json(updatedUser);

    } catch (error: any) {
        console.error('Error updating user blacklist:', error);
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in data file' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'A required data file was not found' });
        } else {
            res.status(500).json({ message: 'Internal server error while updating blacklist' });
        }
    }
};
