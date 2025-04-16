import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
const userFilePath = path.resolve(__dirname, '../database/users_list.json');


// 12. Delete User
export const deleteUser: RequestHandler<{ id: string }, { message: string } | { error: string }, any, any> = async (req, res): Promise<any> => {
    try {
        const userId = req.params.id;
        if (!userId) {
            return res.status(400).json({ message: 'Missing userId' });
        }

        let usersData: string;

        try {
            usersData = await fs.promises.readFile(userFilePath, 'utf-8');
        } catch (readError: any) {
            if (readError.code === 'ENOENT') {
                // File doesn't exist, meaning no users.  That's not really an error in this context.
                return res.status(404).json({ message: 'No users found.' });
            }
            console.error("Error reading users file:", readError);
            return res.status(500).json({ message: "Error reading user data" });
        }

        let users: UserResponse[];
        try {
            users = JSON.parse(usersData);
        } catch (parseError) {
            console.error("Error parsing user data:", parseError);
            return res.status(500).json({ message: 'Invalid user data format.' });
        }


        const userIndex = users.findIndex(user => user.id === userId);


        console.log(userIndex)
        if (userIndex === -1) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Remove the user from the array
        users.splice(userIndex, 1);

        try {
            await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
        } catch (writeError) {
            console.error("Error writing updated user data:", writeError);
            return res.status(500).json({ message: "Error saving updated user data." });
        }

        res.status(200).json({ message: 'User deleted successfully' });

    } catch (error: any) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};