import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');

// 20. API Xác Thực (Verify Password) ---
export const verifyPassword: RequestHandler<any, { message: string }, { id: string; currentPassword?: string }, any> = async (req, res): Promise<any> => {
    try {
        const { id, currentPassword } = req.body;

        if (!id || !currentPassword) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const userData = await fs.promises.readFile(userFilePath, 'utf-8');
        const users: UserResponse[] = JSON.parse(userData);

        const user = users.find(u => u.id === id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        // So sánh mật khẩu (Dùng bcrypt nếu bạn hash mật khẩu)
        // const passwordMatch = await bcrypt.compare(currentPassword, user.password); // Dùng bcrypt để compare
        const passwordMatch = currentPassword === user.password; // So sánh trực tiếp (KHÔNG AN TOÀN!)
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        res.status(200).json({ message: 'Password verified' });

    } catch (error: any) {
        console.error('Error verifying password:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
