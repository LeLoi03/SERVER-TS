import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');


// 4. Lấy thông tin user theo ID ---
export const getUserById: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
    try {
        const userId = req.params.id;

        if (!userId) {
            res.status(400).json({ message: 'Missing userId' });
        }

        const data = await fs.promises.readFile(userFilePath, 'utf-8');
        const users: UserResponse[] = JSON.parse(data);

        const user = users.find(u => u.id === userId);

        if (!user) {
            res.status(404).json({ message: 'User not found' });
        }

        res.status(200).json(user);

    } catch (error: any) {
        console.error('Error get user data:', error);
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in user-list.json' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'user-list.json not found' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};