import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';

import { UserResponse } from '../types/user.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');



// --- Hàm đọc Users từ file (Thêm xử lý lỗi) ---
async function readUsers(): Promise<UserResponse[]> {
    try {
        const userData = await fs.promises.readFile(userFilePath, 'utf-8');
        return JSON.parse(userData) as UserResponse[];
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return []; // File không tồn tại, trả về mảng rỗng
        }
        console.error('Error reading user data:', error);
        throw new Error('Could not read user data'); // Ném lỗi để hàm gọi xử lý
    }
}

// --- Hàm ghi Users vào file ---
async function writeUsers(users: UserResponse[]): Promise<void> {
    try {
        await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error writing user data:', error);
        throw new Error('Could not save user data'); // Ném lỗi
    }
}

export const verifyEmail: RequestHandler<any, { message: string }, { email: string; code: string }, any> = async (req, res): Promise<any> => {
    try {
        const { email, code } = req.body;

        if (!email || !code) {
            return res.status(400).json({ message: 'Email and verification code are required.' });
        }

        let users = await readUsers();
        const userIndex = users.findIndex(user => user.email === email);

        if (userIndex === -1) {
            return res.status(404).json({ message: 'User not found.' });
        }

        const user = users[userIndex];

        if (user.isVerified) {
            return res.status(400).json({ message: 'Account already verified.' });
        }

        if (!user.verificationCode || !user.verificationCodeExpires) {
             return res.status(400).json({ message: 'Verification data missing or invalid.' });
        }

        // Kiểm tra mã hết hạn
        const expires = new Date(user.verificationCodeExpires);
        if (expires < new Date()) {
            // Xóa mã hết hạn khỏi user để tránh dùng lại
            users[userIndex].verificationCode = null;
            users[userIndex].verificationCodeExpires = null;
            await writeUsers(users);
            return res.status(400).json({ message: 'Verification code expired. Please request a new one.' }); // (Cần thêm tính năng gửi lại code)
        }

        // Kiểm tra mã chính xác
        if (user.verificationCode !== code) {
            return res.status(400).json({ message: 'Invalid verification code.' });
        }

        // --- Xác thực thành công ---
        users[userIndex].isVerified = true;
        users[userIndex].verificationCode = null; // Xóa mã sau khi dùng
        users[userIndex].verificationCodeExpires = null; // Xóa thời gian hết hạn
        users[userIndex].updatedAt = new Date().toISOString(); // Cập nhật thời gian

        await writeUsers(users); // Lưu lại user đã được xác thực

        res.status(200).json({ message: 'Email verified successfully. You can now login.' });

    } catch (error: any) {
        console.error('Error verifying email:', error);
         if (error.message.includes('Could not read') || error.message.includes('Could not save')) {
            return res.status(500).json({ message: 'Server error handling user data.' });
        }
        res.status(500).json({ message: 'An internal server error occurred during email verification.' });
    }
};