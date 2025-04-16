// src/controllers/yourControllerFile.ts (or wherever addToCalendar is)

import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Import necessary types and services
import { UserResponse, Notification, Setting, defaultUserSettings } from '../../types/user.response';
import { ConferenceResponse } from '../../types/conference.response';
import { connectedUsers } from '../../../server';
import * as emailService from './emailService'; // Import the email service

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');

// --- Helper Function Renamed & Updated (using defaults) ---
// Checks IF a notification EVENT should be generated based on master/specific toggles
function shouldGenerateCalendarNotificationEvent(user: UserResponse | undefined, action: 'add' | 'remove'): boolean {
    if (!user) return false;

    const settings: Setting = { ...defaultUserSettings, ...(user.setting || {}) }; // Merge with defaults

    if (settings.receiveNotifications === false) {
        return false; // Master switch off
    }

    // Check specific toggle for calendar add/remove events
    if (settings.notificationWhenAddTocalendar === false) {
        return false;
    }
    // Note: Current setting covers both add/remove. If separate toggles existed, check here.

    return true; // Checks passed, event can be generated.
}

// 8. Add/Remove from calendar (with channel preference)
export const addToCalendar: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
    try {
        const { conferenceId, userId } = req.body;

        if (!conferenceId || !userId) {
            res.status(400).json({ message: 'Missing conferenceId or userId' });
            return;
        }

        // --- Data Loading ---
        const [userData, conferenceData] = await Promise.all([
            fs.promises.readFile(userFilePath, 'utf-8'),
            fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
        ]);

        let users: UserResponse[] = JSON.parse(userData); // Use let for potential updates to followers' notifications
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

        // Use copies for modification until save
        const actingUser: UserResponse = { ...users[userIndex] };
        const conferenceToUpdate: ConferenceResponse = { ...conferences[conferenceIndex] }; // Use copy even if not directly modified here
        const now = new Date().toISOString();

        // Initialize arrays if needed
        if (!actingUser.calendar) actingUser.calendar = [];
        if (!actingUser.notifications) actingUser.notifications = [];

        const existingCalendarIndex = actingUser.calendar.findIndex(c => c.id === conferenceId);

        let notificationBaseType: 'Add to Calendar' | 'Remove from Calendar';
        let notificationMessageForActor: string;
        let notificationMessageForOthers: string; // Keep for potential future use or follower notifications
        let isAdding: boolean;

        // --- Add/Remove Logic (operates on actingUser copy) ---
        if (existingCalendarIndex !== -1) {
            // Remove:
            actingUser.calendar.splice(existingCalendarIndex, 1);
            notificationBaseType = 'Remove from Calendar';
            notificationMessageForActor = `You removed the conference "${conferenceToUpdate.conference.title}" from your calendar.`;
            notificationMessageForOthers = `${actingUser.firstName} ${actingUser.lastName} removed "${conferenceToUpdate.conference.title}" from their calendar.`;
            isAdding = false;
        } else {
            // Add:
            actingUser.calendar.push({ id: conferenceId, createdAt: now, updatedAt: now });
            notificationBaseType = 'Add to Calendar';
            notificationMessageForActor = `You added the conference "${conferenceToUpdate.conference.title}" to your calendar.`;
            notificationMessageForOthers = `${actingUser.firstName} ${actingUser.lastName} added "${conferenceToUpdate.conference.title}" to their calendar.`;
            isAdding = true;
        }

        // --- NOTIFICATION DISPATCH LOGIC ---

        // 1. NOTIFY THE ACTING USER
        if (shouldGenerateCalendarNotificationEvent(actingUser, isAdding ? 'add' : 'remove')) {
            const userSettings: Setting = { ...defaultUserSettings, ...(actingUser.setting || {}) };
            const preferredChannels = userSettings.notificationThrough || defaultUserSettings.notificationThrough; // Default to System

            const notificationForActor: Notification = {
                id: uuidv4(), conferenceId: conferenceId, createdAt: now, isImportant: false,
                seenAt: null, deletedAt: null, message: notificationMessageForActor, type: notificationBaseType,
            };

            // Send via SYSTEM if preferred
            if (preferredChannels === 'System' || preferredChannels === 'All') {
                actingUser.notifications.push(notificationForActor); // Add to the copy's list
                // Send real-time via Socket.IO
                const actingUserSocket = connectedUsers.get(userId);
                if (actingUserSocket) {
                    actingUserSocket.emit('notification', notificationForActor);
                    console.log(`System calendar notification sent to acting user ${userId}`);
                }
            }

            // Send via EMAIL if preferred
            if (preferredChannels === 'Email' || preferredChannels === 'All') {
                try {
                    await emailService.sendCalendarNotificationEmail({
                        recipientUser: actingUser,
                        actingUser: actingUser, // Pass self as actor
                        conference: conferenceToUpdate,
                        isAdding: isAdding,
                        isRecipientTheActor: true
                    });
                } catch (emailError) {
                    console.error(`Failed to send calendar action email to acting user ${actingUser.email}:`, emailError);
                }
            }
        } else {
             console.log(`Calendar notifications suppressed for acting user ${userId} based on settings.`);
        }

        // --- 2. NOTIFY OTHER FOLLOWERS (Only on 'add' action, as per original logic) ---
        if (isAdding && conferenceToUpdate.followedBy && conferenceToUpdate.followedBy.length > 0) {
            // Loop through followers to potentially notify them
            for (const followerInfo of conferenceToUpdate.followedBy) {
                 if (followerInfo.id === userId) continue; // Skip the actor

                 const followerIndex = users.findIndex(u => u.id === followerInfo.id);
                 if (followerIndex === -1) continue; // Follower data not found

                 const followerUser = users[followerIndex]; // Get follower from main array

                 // Check if this FOLLOWER should be notified about this event type ('add')
                 if (shouldGenerateCalendarNotificationEvent(followerUser, 'add')) {
                    const followerSettings: Setting = { ...defaultUserSettings, ...(followerUser.setting || {}) };
                    const followerChannels = followerSettings.notificationThrough || defaultUserSettings.notificationThrough;

                    const notificationForFollower: Notification = {
                        id: uuidv4(), conferenceId: conferenceId, createdAt: now, isImportant: false,
                        seenAt: null, deletedAt: null, message: notificationMessageForOthers, type: notificationBaseType, // Type is 'Add to Calendar'
                    };

                    // Send via SYSTEM if preferred by the follower
                    if (followerChannels === 'System' || followerChannels === 'All') {
                        // IMPORTANT: Update the user object directly in the 'users' array
                        if (!users[followerIndex].notifications) {
                            users[followerIndex].notifications = [];
                        }
                        users[followerIndex].notifications.push(notificationForFollower); // Add to the list in the main array
                        // Send real-time via Socket.IO
                        const followerSocket = connectedUsers.get(followerInfo.id);
                        if (followerSocket) {
                            followerSocket.emit('notification', notificationForFollower);
                            console.log(`System calendar notification sent to follower ${followerInfo.id}`);
                        }
                    }

                    // Send via EMAIL if preferred by the follower
                    if (followerChannels === 'Email' || followerChannels === 'All') {
                        try {
                            await emailService.sendCalendarNotificationEmail({
                                recipientUser: followerUser,
                                actingUser: actingUser, // The user who added to calendar
                                conference: conferenceToUpdate,
                                isAdding: true, // This notification is for an 'add' action
                                isRecipientTheActor: false
                            });
                        } catch (emailError) {
                             console.error(`Failed to send calendar add notification email to follower ${followerUser.email}:`, emailError);
                        }
                    }
                 } else {
                     console.log(`Calendar add notification for follower ${followerInfo.id} suppressed based on their settings.`);
                 }
            }
        }

        // --- Update main users array and Save Data ---
        users[userIndex] = actingUser; // Place the updated user copy back into the main array
        // conferences[conferenceIndex] = conferenceToUpdate; // No changes to conference needed here, but good practice if there were

        await Promise.all([
            fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
            // Only write conference file if it actually changed, though writing it again is harmless
            // fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
        ]);

        // Return the final state of the acting user
        res.status(200).json(users[userIndex]);

    } catch (error: any) {
        console.error('Error in addToCalendar handler:', error);
        // Error Handling (Keep as is)
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in a JSON file' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'A required JSON file was not found' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};