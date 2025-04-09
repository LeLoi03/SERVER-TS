import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import crypto from 'crypto'; // <<< Import crypto để tạo mã
import { sendVerificationEmail } from './emailService';
import { UserResponse } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';

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

// --- Hash Password Function (QUAN TRỌNG - Sử dụng bcrypt) ---
// npm install bcrypt @types/bcrypt --save
// import bcrypt from 'bcrypt';
// const saltRounds = 10;
// async function hashPassword(password: string): Promise<string> {
//     return bcrypt.hash(password, saltRounds);
// }
// Tạm thời chưa hash để tập trung vào logic email
async function hashPassword(password: string): Promise<string> {
    console.warn("SECURITY WARNING: Password hashing is NOT implemented. Storing plain text password.");
    return password; // <<< THAY BẰNG BCRYPT TRONG THỰC TẾ
}

// --- Generate Verification Code ---
function generateVerificationCode(length: number = 6): string {
    // Tạo số ngẫu nhiên an toàn hơn Math.random()
    return crypto.randomInt(0, Math.pow(10, length)).toString().padStart(length, '0');
}

// --- signupUser Controller ---

export const signupUser: RequestHandler<any, { message: string }, { firstName: string; lastName: string; dob: string; email: string; password: string }, any> = async (req, res): Promise<any> => {
    try {
        const { firstName, lastName, dob, email, password } = req.body;

        // --- Validation ---
        if (!firstName || !lastName || !email || !password || !dob) {
            return res.status(400).json({ message: 'Missing required fields' });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ message: 'Invalid email format' });
        }
        // Thêm validation độ dài password nếu cần (như frontend)
        if (password.length < 8) {
            return res.status(400).json({ message: 'Password must be at least 8 characters long' });
        }

        let users: UserResponse[] = await readUsers(); // Đọc users

        // --- KIỂM TRA EMAIL TỒN TẠI (QUAN TRỌNG) ---
        const existingUser = users.find(user => user.email === email);
        if (existingUser) {
            // Nếu user tồn tại NHƯNG CHƯA XÁC THỰC, có thể gửi lại email xác thực? (Tùy chọn)
            if (!existingUser.isVerified) {
                 // Cân nhắc: Có nên tạo lại code và gửi lại email không?
                 // Hoặc chỉ thông báo là email đã đăng ký, vui lòng xác thực?
                 // Hiện tại: Báo lỗi trùng email đơn giản.
                 return res.status(409).json({ message: 'Email already registered. Please verify or login.' });
            } else {
                // User đã tồn tại và đã xác thực
                return res.status(409).json({ message: 'Email already registered. Please login.' });
            }
        }


        const hashedPassword = await hashPassword(password);
        const now = new Date();
        const verificationCode = generateVerificationCode(); // Tạo mã 6 chữ số
        const verificationCodeExpires = new Date(now.getTime() + 15 * 60 * 1000); // Hết hạn sau 15 phút



        // --- Tạo User Object ---
        const newUser: UserResponse = {
            id: uuidv4(),
            firstName,
            lastName,
            email,
            password: hashedPassword, // Lưu password đã hash
            dob: dob,
            role: 'user',
            followedConferences: [],
            myConferences: [],
            calendar: [],
            feedBacks: [],
            notifications: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            avatar: `https://ui-avatars.com/api/?name=${firstName}+${lastName}&background=random&size=32`,
            aboutme: "",
            interestedTopics: [],
            background: "",
            setting: {
                receiveNotifications: true,
                autoAddFollowToCalendar: true,
                notificationWhenConferencesChanges: true,
                upComingEvent: true,
                notificationThrough: "System",
                notificationWhenUpdateProfile: true,
                notificationWhenFollow: true,
                notificationWhenAddTocalendar: true,
                notificationWhenAddToBlacklist: true
            },
            // --- Thông tin xác thực ---
            isVerified: false, // <<< Mặc định là chưa xác thực
            verificationCode: verificationCode,
            verificationCodeExpires: verificationCodeExpires.toISOString(),

        };

          // --- GỬI EMAIL XÁC THỰC ---
          try {
            await sendVerificationEmail(newUser.email, newUser.firstName, verificationCode);
        } catch (emailError) {
            // Gửi email thất bại -> Không nên tạo user hoặc báo lỗi cụ thể
            console.error("Failed to send verification email during signup:", emailError);
            // Có thể không muốn lộ lỗi chi tiết cho client
            return res.status(500).json({ message: 'Registration failed: Could not send verification email.' });
        }

        // --- Thêm user (chưa xác thực) và Lưu ---
        users.push(newUser);
        await writeUsers(users);

        // --- Return Success Response (201 Created) ---
        // Thông báo user cần kiểm tra email
        res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });

    } catch (error: any) {
        console.error('Error signing up user:', error);
        if (error.message.includes('Could not read') || error.message.includes('Could not save')) {
            return res.status(500).json({ message: 'Server error handling user data.' });
        }
        // Bắt lỗi từ sendVerificationEmail nếu nó throw error
        if (error.message.includes('Failed to send verification email')) {
             return res.status(500).json({ message: error.message });
        }
        res.status(500).json({ message: 'An internal server error occurred during registration.' });
    }
};