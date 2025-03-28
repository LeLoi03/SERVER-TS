import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid'; // Import uuid

// Import necessary types
import { UserResponse, Blacklist, Notification, Setting, defaultUserSettings } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response'; // Need this for conference title
import * as emailService from './emailService'; // Import the email service

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


// --- Helper Function Renamed & Updated (using defaults) ---
// Checks IF a notification EVENT should be generated based on master/specific toggles
function shouldGenerateBlacklistNotificationEvent(user: UserResponse | undefined): boolean {
    // Removed notificationType parameter as the setting covers both add/remove
    if (!user) return false;

    const settings: Setting = { ...defaultUserSettings, ...(user.setting || {}) }; // Merge with defaults

    if (settings.receiveNotifications === false) {
        return false; // Master switch off
    }

    // Check specific toggle for blacklist events
    if (settings.notificationWhenAddToBlacklist === false) {
        return false;
    }

    return true; // Checks passed, event can be generated.
}


// --- Blacklist/Unblacklist Conference Handler ---
export const blacklistConference: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
    const { conferenceId, userId } = req.body;

    if (!conferenceId || !userId) {
        res.status(400).json({ message: 'Missing conferenceId or userId' });
        return;
    }

    try {
        // --- Data Loading ---
        const [usersData, conferencesData] = await Promise.all([
            readJsonFile<UserResponse[]>(userFilePath, []),
            readJsonFile<ConferenceResponse[]>(conferenceDetailsFilePath, [])
        ]);

        // Use 'let' for users array in case we needed to modify others (though not in this specific case)
        let users: UserResponse[] = usersData;
        const conferences: ConferenceResponse[] = conferencesData;


        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        // Find conference for title
        const conferenceIndex = conferences.findIndex(c => c.conference?.id === conferenceId);
        const targetConference = conferences[conferenceIndex];
        const conferenceTitle = targetConference?.conference?.title || `Conference ID ${conferenceId}`; // Fallback

        // Use a copy for modifications
        const actingUser: UserResponse = { ...users[userIndex] };
        const now = new Date().toISOString();

        // Initialize arrays if needed
        if (!actingUser.blacklist) actingUser.blacklist = [];
        if (!actingUser.notifications) actingUser.notifications = [];


        const existingBlacklistIndex = actingUser.blacklist.findIndex(bc => bc.id === conferenceId);

        let notificationBaseType: 'Add to Blacklist' | 'Remove from Blacklist';
        let notificationMessageForActor: string;
        let isBlacklisting: boolean;

        // --- Add/Remove Logic (operates on actingUser copy) ---
        if (existingBlacklistIndex !== -1) {
            // Un-blacklist:
            actingUser.blacklist.splice(existingBlacklistIndex, 1);
            notificationBaseType = 'Remove from Blacklist';
            notificationMessageForActor = `You removed "${conferenceTitle}" from your blacklist.`;
            isBlacklisting = false;
            console.log(`User ${userId} removing conference ${conferenceId} from blacklist.`);
        } else {
            // Blacklist:
            actingUser.blacklist.push({ id: conferenceId, blacklistedAt: now });
            notificationBaseType = 'Add to Blacklist';
            notificationMessageForActor = `You added "${conferenceTitle}" to your blacklist.`;
            isBlacklisting = true;
            console.log(`User ${userId} adding conference ${conferenceId} to blacklist.`);
        }

        // --- NOTIFICATION DISPATCH LOGIC ---
        if (shouldGenerateBlacklistNotificationEvent(actingUser)) { // Check if event should trigger
            const userSettings: Setting = { ...defaultUserSettings, ...(actingUser.setting || {}) };
            const preferredChannels = userSettings.notificationThrough || defaultUserSettings.notificationThrough; // Default to System

            const notification: Notification = {
                id: uuidv4(), conferenceId: conferenceId, createdAt: now, isImportant: false,
                seenAt: null, deletedAt: null, message: notificationMessageForActor, type: notificationBaseType,
            };

            // Send via SYSTEM if preferred
            if (preferredChannels === 'System' || preferredChannels === 'All') {
                actingUser.notifications.push(notification); // Add to the copy's list
                // Send real-time via Socket.IO
                const actingUserSocket = connectedUsers.get(userId);
                if (actingUserSocket) {
                    actingUserSocket.emit('notification', notification);
                    console.log(`System blacklist notification sent to acting user ${userId}`);
                } else {
                     console.log(`Acting user ${userId} not connected for real-time blacklist notification.`);
                }
            }

            // Send via EMAIL if preferred
            if (preferredChannels === 'Email' || preferredChannels === 'All') {
                try {
                    await emailService.sendBlacklistNotificationEmail({
                        recipientUser: actingUser, // The actor is the recipient
                        conferenceTitle: conferenceTitle,
                        isBlacklisting: isBlacklisting
                    });
                } catch (emailError) {
                    console.error(`Failed attempt to send blacklist action email to acting user ${actingUser.email}:`, emailError);
                    // Logged in service
                }
            }
             console.log(`Notification processing complete for user ${userId}. Channels: ${preferredChannels}`);

        } else {
             console.log(`Blacklist notifications suppressed for user ${userId} based on settings.`);
        }


        // --- Update main users array and Save Data ---
        users[userIndex] = actingUser; // Place the updated user copy back into the main array
        await writeJsonFile(userFilePath, users);

        // --- Return updated user ---
        res.status(200).json(users[userIndex]); // Return the final state from the users array

    } catch (error: any) {
        console.error('Error in blacklistConference handler:', error);
        // Error Handling (Keep as is)
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in data file' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'A required data file was not found' });
        } else {
            res.status(500).json({ message: 'Internal server error while updating blacklist' });
        }
    }
};