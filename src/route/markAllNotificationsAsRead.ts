import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');

// 15. Mark All Notifications as Read
export const markAllNotificationsAsRead: RequestHandler<{ id: string }, { message: string }, any, any> = async (req, res) => {
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
