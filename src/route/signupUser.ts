import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
// --- Route Handlers ---
import nodemailer from 'nodemailer'; // Import nodemailer
import cryptoRandomString from 'crypto-random-string'; // Import token generator


import { UserResponse } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';

const userFilePath = path.resolve(__dirname, './database/users_list.json');


// --- Cấu hình Nodemailer (Ví dụ với Gmail - Không khuyến khích cho production) ---
// Thay thế bằng thông tin SMTP của bạn hoặc dịch vụ email khác
const transporter = nodemailer.createTransport({
    service: 'gmail', // Hoặc cấu hình SMTP khác
    auth: {
        user: process.env.EMAIL_USER, // Đặt biến môi trường
        pass: process.env.EMAIL_PASS, // Đặt biến môi trường (nên dùng App Password cho Gmail)
    },
});

// --- Helper function gửi email (nên tách ra module riêng) ---
async function sendVerificationEmail(toEmail: string, token: string) {
    const verificationLink = `${process.env.FRONTEND_URL}/auth/verify-email/${token}`; // Đường dẫn frontend xử lý xác thực

    const mailOptions = {
        from: `"Global Conference Hub" <${process.env.EMAIL_USER}>`,
        to: toEmail,
        subject: 'Verify Your Email Address for Global Conference Hub',
        html: `
        <h1>Welcome to Global Conference Hub!</h1>
        <p>Please click the link below to verify your email address:</p>
        <a href="${verificationLink}" target="_blank">Verify Email</a>
        <p>If you did not create an account, please ignore this email.</p>
        <p>This link will expire in 1 hour.</p> 
      `, // Bạn có thể dùng template engine đẹp hơn
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        console.log('Verification email sent: %s', info.messageId);
    } catch (error) {
        console.error('Error sending verification email:', error);
        // Cần xử lý lỗi này - có thể thử gửi lại hoặc ghi log
    }
}


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


// 17. Register User - Đã cập nhật
export const signupUser: RequestHandler<any, { message: string }, { firstName: string; lastName: string; email: string; password: string }, any> = async (req, res): Promise<any> => {
    try {
        const { firstName, lastName, email, password } = req.body;

        // --- Validation ---
        if (!firstName || !lastName || !email || !password) {
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

        const emailExists = users.some(user => user.email === email);
        if (emailExists) {
            // Có thể cần xử lý trường hợp user tồn tại nhưng chưa verify
            const existingUser = users.find(user => user.email === email);
            if (existingUser && !existingUser.isVerified) {
                // Option 1: Gửi lại email xác thực
                // Option 2: Thông báo email đã đăng ký nhưng chưa xác thực
                return res.status(409).json({ message: 'Email already registered but not verified. Check your inbox or register again later.' });
            }
            return res.status(409).json({ message: 'Email already registered' });
        }

        // --- Hash Password (RẤT QUAN TRỌNG) ---
        // Bạn PHẢI hash password trước khi lưu. Ví dụ dùng bcrypt:
        // const bcrypt = require('bcrypt');
        // const saltRounds = 10;
        // const hashedPassword = await bcrypt.hash(password, saltRounds);
        const hashedPassword = password; // <<< THAY THẾ BẰNG HASH THỰC SỰ

        // --- Tạo Token và Thời gian hết hạn ---
        const verificationToken = cryptoRandomString({ length: 40, type: 'url-safe' });
        const now = new Date();
        const expires = new Date(now.getTime() + 3600 * 1000); // Hết hạn sau 1 giờ

        // --- Tạo User Object ---
        const newUser: UserResponse = {
            id: uuidv4(),
            firstName,
            lastName,
            email,
            password: hashedPassword, // Lưu password đã hash
            dob: "",
            role: 'user',
            followedConferences: [],
            myConferences: [],
            calendar: [],
            feedBacks: [],
            notifications: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
            avatar: '',
            aboutme: '',
            interestedTopics: [],
            background: '',
            setting: { /* default settings */ },
            isVerified: false, // <<< Mặc định chưa xác thực
            verificationToken: verificationToken, // <<< Lưu token
            verificationTokenExpires: expires.toISOString(), // <<< Lưu thời gian hết hạn
        };

        // --- Thêm user và Lưu ---
        users.push(newUser);
        await writeUsers(users); // Ghi lại file

        // --- Gửi Email Xác thực ---
        await sendVerificationEmail(newUser.email, verificationToken);

        // --- Return Success Response (201 Created) ---
        // Không trả về thông tin user, chỉ cần thông báo
        res.status(201).json({ message: 'Registration successful. Please check your email to verify your account.' });

    } catch (error: any) {
        console.error('Error signing up user:', error);
        // Phân biệt lỗi đọc/ghi file với lỗi khác
        if (error.message.includes('Could not read') || error.message.includes('Could not save')) {
            return res.status(500).json({ message: 'Server error handling user data.' });
        }
        res.status(500).json({ message: 'An internal server error occurred during registration.' });
    }
};

// --- Endpoint mới để Xác thực Email ---
export const verifyEmail: RequestHandler<{ token: string }, { message: string }, any, any> = async (req, res): Promise<any> => {
    try {
        const { token } = req.params;

        if (!token) {
            return res.status(400).json({ message: 'Verification token is missing.' });
        }

        let users = await readUsers();
        const userIndex = users.findIndex(user => user.verificationToken === token && !user.isVerified);

        if (userIndex === -1) {
            // Kiểm tra xem có phải token đã được dùng rồi không
            const alreadyVerified = users.some(user => user.verificationToken === token && user.isVerified);
            if (alreadyVerified) {
                return res.status(400).json({ message: 'Email already verified.' });
            }
            return res.status(400).json({ message: 'Invalid or expired verification token.' });
        }

        const userToVerify = users[userIndex];

        // Kiểm tra thời gian hết hạn
        if (userToVerify.verificationTokenExpires && new Date() > new Date(userToVerify.verificationTokenExpires)) {
            // Xử lý token hết hạn (ví dụ: xóa user hoặc yêu cầu gửi lại email)
            // Option: Xóa user chưa verify hết hạn
            // users.splice(userIndex, 1);
            // await writeUsers(users);
            // return res.status(400).json({ message: 'Verification token has expired. Please register again.' });

            // Option: Cho phép gửi lại ( phức tạp hơn)
            return res.status(400).json({ message: 'Verification token has expired.' });
        }

        // --- Cập nhật User ---
        users[userIndex].isVerified = true;
        users[userIndex].verificationToken = null; // Vô hiệu hóa token
        users[userIndex].verificationTokenExpires = null;
        users[userIndex].updatedAt = new Date().toISOString();

        await writeUsers(users); // Lưu lại thay đổi

        // Trả về thành công (có thể redirect ở frontend dựa vào response này)
        res.status(200).json({ message: 'Email verified successfully. You can now log in.' });

    } catch (error: any) {
        console.error('Error verifying email:', error);
        if (error.message.includes('Could not read') || error.message.includes('Could not save')) {
            return res.status(500).json({ message: 'Server error handling user data.' });
        }
        res.status(500).json({ message: 'An internal server error occurred during verification.' });
    }
};
