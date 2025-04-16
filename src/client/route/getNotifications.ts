import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { Notification } from '../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');

// 13. Get notifications
export const getUserNotifications: RequestHandler<{ id: string }, Notification[] | { message: string }, any, any> = async (req, res) => {
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