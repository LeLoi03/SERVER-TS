import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../../types/user.response';
const userFilePath = path.resolve(__dirname, '../database/users_list.json');

// 18. Login user
export const signinUser: RequestHandler<any, { message: string; user?: Omit<UserResponse, "password"> }, { email: string; password: string }, any> = async (req, res): Promise<any> => {
    try {
        const { email, password } = req.body;

        // --- Basic Validation ---
        if (!email || !password) {
            return res.status(400).json({ message: 'Missing email or password' });
        }

        // --- Read User Data ---
        let users: UserResponse[] = [];
        try {
            const userData = await fs.promises.readFile(userFilePath, 'utf-8');
            users = JSON.parse(userData);
        } catch (error: any) {
            if (error.code !== 'ENOENT') {
                console.error('Error reading or parsing user data:', error);
                return res.status(500).json({ message: 'Internal server error' });
            }
            // If file doesn't exist, there are no users, login will fail.
        }

        // --- Find User by Email ---
        const user = users.find(u => u.email === email);
        if (!user) {
            return res.status(401).json({ message: 'Invalid email or password' }); // 401 Unauthorized
        }

        // --- Check Password (DIRECT comparison - NOT RECOMMENDED) ---
        if (user.password !== password) { //  So sánh trực tiếp. KHÔNG AN TOÀN!
            return res.status(401).json({ message: 'Invalid email or password' }); // 401 Unauthorized
        }
        // --- Return Success Response (200 OK) ---
        // Create a copy of the user object and remove the password.  VERY IMPORTANT!
        const responseUser: Omit<UserResponse, "password"> = {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            email: user.email,
            dob: user.dob,
            role: user.role,
            avatar: user.avatar,
            aboutme: user.aboutme,
            interestedTopics: user.interestedTopics,
            background: user.background,
            followedConferences: user.followedConferences,
            myConferences: user.myConferences,
            calendar: user.calendar,
            feedBacks: user.feedBacks,
            notifications: user.notifications,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            isVerified: true
            
        };

        res.status(200).json({ message: 'Login successful', user: responseUser });


    } catch (error: any) {
        console.error('Error signing in user:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};