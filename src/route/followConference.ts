import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { FollowerInfo } from '../types/conference.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const addConferencesFilePath = path.resolve(__dirname, '../database/add_conferences.json');
const conferencesListFilePath = path.resolve(__dirname, '../database/DB.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// 3. Follow conference (CORRECTED - No Duplicate Notifications)
// --- Helper Function to Check Notification Settings ---
function shouldSendFollowNotification(user: UserResponse, notificationType: 'Follow' | 'Unfollow'): boolean {
    const settings = user.setting;

    if (!settings) {
        return false; // No settings, default to no notifications.
    }

    if (settings.receiveNotifications === false) {
        return false; // User has disabled all notifications.
    }

    if (notificationType === 'Follow' && settings.notificationWhenFollow === false) {
        return false;
    }
    if (notificationType === 'Unfollow' && settings.notificationWhenFollow === false) {
        return false;
    }


    return true; // All checks passed, send notification.
}

// --- Follow/Unfollow Conference Handler ---

export const followConference: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
    try {
        const { conferenceId, userId } = req.body;

        if (!conferenceId || !userId) {
            res.status(400).json({ message: 'Missing conferenceId or userId' });
            return;
        }

        const [userData, conferenceData] = await Promise.all([
            fs.promises.readFile(userFilePath, 'utf-8'),
            fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
        ]);

        const users: UserResponse[] = JSON.parse(userData);
        const conferences: ConferenceResponse[] = JSON.parse(conferenceData);

        const userIndex = users.findIndex(u => u.id === userId);
        if (userIndex === -1) {
            res.status(404).json({ message: 'User not found' });
            return;
        }

        const conferenceIndex = conferences.findIndex(c => c.conference.id === conferenceId);
        if (conferenceIndex === -1) {
            res.status(404).json({ message: 'Conference not found' });
            return;
        }

        const updatedUser: UserResponse = { ...users[userIndex] };
        const updatedConference: ConferenceResponse = { ...conferences[conferenceIndex] };
        const now = new Date().toISOString();

        if (!updatedUser.followedConferences) {
            updatedUser.followedConferences = [];
        }
        if (!updatedConference.followedBy) {
            updatedConference.followedBy = [];
        }

        const existingFollowIndex = updatedUser.followedConferences.findIndex(fc => fc.id === conferenceId);

        let notificationType: 'Follow Conference' | 'Unfollow Conference';
        let notificationMessage: string;
        let isFollowing: boolean; // Keep track of follow/unfollow

        if (existingFollowIndex !== -1) {
            // Unfollow:
            updatedUser.followedConferences.splice(existingFollowIndex, 1);
            updatedConference.followedBy = updatedConference.followedBy.filter(followedBy => followedBy.id !== userId);
            notificationType = 'Unfollow Conference';
            notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} unfollowed the conference: ${updatedConference.conference.title}`;
            isFollowing = false;
        } else {
            // Follow:
            updatedUser.followedConferences.push({
                id: conferenceId,
                createdAt: now,
                updatedAt: now,
            });

            const followerInfo: FollowerInfo = {
                id: updatedUser.id,
                email: updatedUser.email,
                firstName: updatedUser.firstName,
                lastName: updatedUser.lastName,
                createdAt: now,
                updatedAt: now,
            };
            updatedConference.followedBy.push(followerInfo);
            notificationType = 'Follow Conference';
            notificationMessage = `${updatedUser.firstName} ${updatedUser.lastName} followed the conference: ${updatedConference.conference.title}`;
            isFollowing = true;
        }

        // --- Notification Logic (with settings check) ---
        const notification: Notification = {
            id: uuidv4(),
            createdAt: now,
            isImportant: false,
            seenAt: null,
            deletedAt: null,
            message: notificationMessage,
            type: notificationType,
        };
        // 1.  ACTING USER
        if (shouldSendFollowNotification(updatedUser, isFollowing ? 'Follow' : 'Unfollow')) {
            if (!updatedUser.notifications) {
                updatedUser.notifications = [];
            }
            updatedUser.notifications.push(notification);

            const actingUserSocket = connectedUsers.get(userId);
            if (actingUserSocket) {
                actingUserSocket.emit('notification', notification);
            }
        }

        // 2. OTHER FOLLOWERS (only on follow, and check THEIR settings)
        if (isFollowing) {
            if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
                updatedConference.followedBy.forEach(followedBy => {
                    if (followedBy.id !== userId) {
                        const userFollowIndex = users.findIndex(u => u.id === followedBy.id);
                        if (userFollowIndex !== -1) {
                            const followerUser = users[userFollowIndex];
                            if (shouldSendFollowNotification(followerUser, 'Follow')) {
                                const followerNotification: Notification = {
                                    id: uuidv4(),
                                    createdAt: now,
                                    isImportant: false,
                                    seenAt: null,
                                    deletedAt: null,
                                    message: notificationMessage,
                                    type: notificationType,
                                };

                                if (!followerUser.notifications) {
                                    followerUser.notifications = [];
                                }
                                followerUser.notifications.push(followerNotification);
                                const userSocket = connectedUsers.get(followedBy.id);
                                if (userSocket) {
                                    userSocket.emit('notification', followerNotification);
                                }


                            }

                        }
                    }
                });
            }
        }



        // --- Update user and conference data ---
        users[userIndex] = updatedUser;
        conferences[conferenceIndex] = updatedConference;

        await Promise.all([
            fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
            fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
        ]);

        res.status(200).json(updatedUser);

    } catch (error: any) {
        console.error('Error updating user/conference data:', error);
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in a JSON file' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'A required JSON file was not found' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};