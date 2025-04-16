import 'dotenv/config';
import path from 'path';
import { Request } from 'express';
import { RequestHandler } from 'express';
import fs from 'fs';


import { Notification } from '../../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');


// 14. Update User Notifications:
// NEW ROUTE: Update user notifications
export interface UpdateNotificationsRequest extends Request {
    params: {
        id: string;
    };
    body: {  //Define the body type
        notifications: Notification[];
    };
}

export const updateNotifications: RequestHandler<UpdateNotificationsRequest["params"], { message: string }, UpdateNotificationsRequest["body"]> = async (req, res) => {
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