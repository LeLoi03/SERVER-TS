import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');

// 21. API Đổi Mật Khẩu (Change Password) ---
export const changePassword: RequestHandler<any, { message: string }, { id: string; newPassword?: string; confirmNewPassword?: string }, any> = async (req, res): Promise<any> => {
    try {
        const { id, newPassword, confirmNewPassword } = req.body;

        // --- 1. Basic Validation ---
        if (!id || !newPassword || !confirmNewPassword) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        if (newPassword !== confirmNewPassword) {
            return res.status(400).json({ message: 'New password and confirmation do not match' });
        }

        // --- 2. Read User Data ---
        let users: UserResponse[] = [];
        try {
            const userData = await fs.promises.readFile(userFilePath, 'utf-8');
            users = JSON.parse(userData);

        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('Error reading or parsing user data:', error);
                return res.status(500).json({ message: 'Internal server error' });
            }
            // If file is not found, that's an error (no users exist).
            return res.status(404).json({ message: "Users not found" })
        }

        // --- 3. Find User ---
        const userIndex = users.findIndex(u => u.id === id);
        console.log(userIndex)
        if (userIndex === -1) {
            console.log(userIndex)
            return res.status(404).json({ message: 'User not found' });
        }
        const user = users[userIndex];

        // --- 4. Validate New Password (ADD MORE CHECKS AS NEEDED) ---
        if (newPassword.length < 8) {
            return res.status(400).json({ message: 'New password must be at least 8 characters long' });
        }
        // Check for password strength (add more checks as needed)
        //   if (!/[a-z]/.test(newPassword)) {
        //     return res.status(400).json({ message: "Password must contain a lowercase letter" });
        //   }
        //   if (!/[A-Z]/.test(newPassword)) {
        //       return res.status(400).json({ message: "Password must contain an uppercase letter" });
        //   }
        //   if (!/[0-9]/.test(newPassword)) {
        //       return res.status(400).json({ message: "Password must contain a number" });
        //   }
        //   if (!/[^a-zA-Z0-9\s]/.test(newPassword)) {
        //     return res.status(400).json({ message: "Password must contain a special character" });
        // }

        // // --- 5. Hash New Password (NẾU DÙNG HASH) ---
        //  const saltRounds = 10;
        //  const hashedNewPassword = await bcrypt.hash(newPassword, saltRounds);

        // --- 6. Update User Data ---
        users[userIndex] = { ...users[userIndex], password: newPassword, updatedAt: new Date().toISOString() }; // KHÔNG HASH
        // users[userIndex] = { ...users[userIndex], password: hashedNewPassword, updatedAt: new Date().toISOString() }; // CÓ HASH
        await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');

        // --- 7. Return Success ---
        res.status(200).json({ message: 'Password changed successfully' });

    } catch (error: any) {
        console.error('Error changing password:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
