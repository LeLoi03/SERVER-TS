import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { Feedback } from '../types/conference.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../../server';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// 11. Add feedback (with real-time notifications)
export const addFeedback: RequestHandler<{ conferenceId: string }, Feedback | { message: string }, { description: string; star: number; creatorId: string }> = async (req, res) => {
    const { conferenceId } = req.params;
    const { description, star, creatorId } = req.body;
    if (!description || star === undefined || star < 1 || star > 5 || !creatorId) {
        res.status(400).json({ message: 'Invalid feedback data' });
        return;
    }

    try {

        const [conferenceData, userData] = await Promise.all([
            fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
            fs.promises.readFile(userFilePath, 'utf-8'), // Read user data
        ]);

        const conferences: ConferenceResponse[] = JSON.parse(conferenceData);
        const users: UserResponse[] = JSON.parse(userData); // Parse user data

        const conferenceIndex = conferences.findIndex(c => c.conference.id === conferenceId);
        if (conferenceIndex === -1) {
            res.status(404).json({ message: 'Conference not found' });
            return;
        }

        const updatedConference: ConferenceResponse = { ...conferences[conferenceIndex] };
        const organizedId = updatedConference.organization?.id;

        // --- Find the creator user ---
        const creatorIndex = users.findIndex(u => u.id === creatorId);
        if (creatorIndex === -1) {
            res.status(404).json({ message: 'Creator user not found' });
            return; // Important: Return to prevent further execution
        }
        const creatorUser = users[creatorIndex];

        const newFeedback: Feedback = {
            id: uuidv4(),
            organizedId,
            creatorId,
            firstName: creatorUser.firstName,
            lastName: creatorUser.lastName,
            avatar: creatorUser.avatar,
            description,
            star,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        if (!updatedConference.feedBacks) {
            updatedConference.feedBacks = [];
        }
        updatedConference.feedBacks.push(newFeedback);


        // --- Create the notification message ---
        const creatorNotificationMessage = `You provided feedback for the conference "${updatedConference.conference.title}": ${star} stars.`;
        const followersNotificationMessage = `${creatorUser.firstName} ${creatorUser.lastName} provided feedback for the conference "${updatedConference.conference.title}" which you followed: ${star} stars.`;

        // --- Create the notification object ---
        const notification: Notification = {
            id: uuidv4(),
            conferenceId: conferenceId,
            createdAt: new Date().toISOString(),
            isImportant: false, // Set as appropriate
            seenAt: null,
            deletedAt: null,
            message: creatorNotificationMessage,
            type: 'New Feedback', // Consistent notification type
        };

        // --- 1. Send real-time notification to the ACTING user (the feedback creator) ---
        const actingUserSocket = connectedUsers.get(creatorId);
        if (actingUserSocket) {
            const creatorNotification: Notification = { ...notification, id: uuidv4() }; // Create a separate notification object
            if (!creatorUser.notifications) {
                creatorUser.notifications = [];
            }
            creatorUser.notifications.push(creatorNotification);
            actingUserSocket.emit('notification', creatorNotification); // Notify the creator
        }


        // --- 2. Send to followers (excluding the creator) ---
        if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
            updatedConference.followedBy.forEach(followedBy => {
                if (followedBy.id !== creatorId) {  // Exclude the feedback creator
                    const followerIndex = users.findIndex(u => u.id === followedBy.id);
                    if (followerIndex !== -1) {
                        const followerUser = users[followerIndex];

                        // --- Create the notification object ---
                        const followerNotification: Notification = {
                            id: uuidv4(),
                            conferenceId: conferenceId,
                            createdAt: new Date().toISOString(),
                            isImportant: false, // Set as appropriate
                            seenAt: null,
                            deletedAt: null,
                            message: followersNotificationMessage,
                            type: 'New Feedback', // Consistent notification type
                        };

                        if (!followerUser.notifications) {
                            followerUser.notifications = [];
                        }
                        followerUser.notifications.push(followerNotification);

                        // Real-time notification to followedBy
                        const followerSocket = connectedUsers.get(followedBy.id);
                        if (followerSocket) {
                            followerSocket.emit('notification', followerNotification);
                        }
                    }
                }
            });
        }

        // --- Update conference and users data ---
        conferences[conferenceIndex] = updatedConference; // Update the conference
        users[creatorIndex] = creatorUser; //Update creator

        await Promise.all([
            fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
            fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'), // Write updated users
        ]);


        res.status(201).json(newFeedback);
    } catch (error: any) {
        console.error('Error adding feedback:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};