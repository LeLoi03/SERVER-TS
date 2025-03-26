import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';

const userFilePath = path.resolve(__dirname, './database/users_list.json');


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


export const updateUser: RequestHandler<{ id: string }, UserResponse | { message: string }, Partial<UserResponse>, any> = async (req, res) => {
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