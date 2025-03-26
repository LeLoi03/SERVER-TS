import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { GoogleLoginRequestBody } from '../types/google-login';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');

export const googleLogin: RequestHandler<any, { message: string; user?: Omit<UserResponse, 'password'> }, GoogleLoginRequestBody, any> = async (req, res) => {
    try {
        const { email, name, photoUrl } = req.body;
        console.log("Received from frontend:", { email, name, photoUrl }); // Log

        if (!email || !name) {
            console.log("Missing email or name in request body");
            return res.status(400).json({ message: "Missing email or name" }) as any;
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
        }
        // --- Find or Create User ---
        let user = users.find(u => u.email === email);
        if (!user) {
            // Create
            const newUser: UserResponse = {
                id: uuidv4(),
                firstName: name.split(' ')[0],
                lastName: name.split(' ').slice(1).join(' '),
                email,
                password: '', // Important:  Empty password
                dob: '',
                role: 'user',
                followedConferences: [],
                myConferences: [],
                calendar: [],
                feedBacks: [],
                notifications: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                avatar: photoUrl || '', // Use provided photo URL
                aboutme: '',
                interestedTopics: [],
                background: '',
                setting: {
                    receiveNotifications: true,
                    autoAddFollowToCalendar: true,
                    notificationWhenConferencesChanges: true,
                    upComingEvent: true,
                    notificationThrough: "System",
                    notificationWhenUpdateProfile: true,
                    notificationWhenFollow: true,
                    notificationWhenAddTocalendar: true
                }
            };
            users.push(newUser);
            user = newUser;
            console.log("New user created:", user); // Log

        }
        else {
            // Update avatar
            if (photoUrl && user.avatar !== photoUrl) {
                user.avatar = photoUrl;
                console.log("User avatar updated:", user); // Log
            }
            console.log("User updated:", JSON.stringify(user, null, 2));

        }

        // --- Save User Data ---
        try {
            await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2));
            console.log("User data saved to file."); // Log

        }
        catch (err) {
            console.error("Error write user data:", err)
            return res.status(500).json({ message: "Error write file user data" })
        }

        // --- Return User Data ---


        const { password, ...userWithoutPassword } = user;
        console.log("Sending userWithoutPassword:", JSON.stringify(userWithoutPassword, null, 2));
        res.status(200).json({ message: 'Google login successful', user: userWithoutPassword });


    } catch (error) {
        console.error("Google login backend error:", error); // Log tổng quát
        res.status(500).json({ message: 'Internal server error' });
    }
};
