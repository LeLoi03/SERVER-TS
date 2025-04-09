// src/controllers/yourControllerFile.ts (or wherever followConference is)

import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

import { UserResponse, Notification, Setting, defaultUserSettings } from '../types/user.response'; // Import Setting and default
import { ConferenceResponse, FollowerInfo } from '../types/conference.response';
import { connectedUsers } from '../server'; // Assuming server-ts exports this
import * as emailService from './emailService'; // Import the email service

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// --- Helper Function to Check *IF* Notification Should Be Sent AT ALL ---
// (Renamed for clarity - checks the specific event toggle and master switch)
function shouldGenerateNotificationEvent(user: UserResponse | undefined, eventType: 'Follow' | 'Unfollow'): boolean {
    if (!user) return false; // No user, no notification

    // Ensure settings exist, using defaults if necessary
    const settings: Setting = { ...defaultUserSettings, ...(user.setting || {}) }; // Merge with defaults

    if (settings.receiveNotifications === false) {
        return false; // User has disabled ALL notifications.
    }

    // Check specific toggle for follow/unfollow events
    if (settings.notificationWhenFollow === false) {
       return false;
    }
    // If more specific toggles existed (e.g., notificationWhenUnfollow), check here too

    return true; // All checks passed, notification event *can* be generated.
}

// --- Follow/Unfollow Conference Handler ---
export const followConference: RequestHandler<{ id: string }, UserResponse | { message: string }, any, any> = async (req, res): Promise<void> => {
    try {
        const { conferenceId, userId } = req.body;

        if (!conferenceId || !userId) {
            res.status(400).json({ message: 'Missing conferenceId or userId' });
            return;
        }

        // --- Data Loading (Keep as is) ---
        const [userData, conferenceData] = await Promise.all([
            fs.promises.readFile(userFilePath, 'utf-8'),
            fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
        ]);

        let users: UserResponse[] = JSON.parse(userData); // Use 'let' as we might modify followers' notifications
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

        // Use copies to avoid direct mutation until the end
        const actingUser: UserResponse = { ...users[userIndex] };
        const conferenceToUpdate: ConferenceResponse = { ...conferences[conferenceIndex] };
        const now = new Date().toISOString();

        // Initialize arrays if they don't exist
        if (!actingUser.followedConferences) actingUser.followedConferences = [];
        if (!conferenceToUpdate.followedBy) conferenceToUpdate.followedBy = [];
        if (!actingUser.notifications) actingUser.notifications = []; // Initialize notifications for acting user


        const existingFollowIndex = actingUser.followedConferences.findIndex(fc => fc.id === conferenceId);

        let notificationBaseType: 'Follow Conference' | 'Unfollow Conference';
        let notificationMessageForActor: string;
        let isFollowing: boolean;

        // --- Follow/Unfollow Logic (Keep as is, update copies) ---
        if (existingFollowIndex !== -1) {
            // Unfollow:
            actingUser.followedConferences.splice(existingFollowIndex, 1);
            conferenceToUpdate.followedBy = conferenceToUpdate.followedBy.filter(fb => fb.id !== userId);
            notificationBaseType = 'Unfollow Conference';
            notificationMessageForActor = `You unfollowed the conference: ${conferenceToUpdate.conference.title}`;
            isFollowing = false;
        } else {
            // Follow:
            actingUser.followedConferences.push({ id: conferenceId, createdAt: now, updatedAt: now });
            const followerInfo: FollowerInfo = {
                id: actingUser.id, email: actingUser.email, avatar: actingUser.avatar,
                firstName: actingUser.firstName, lastName: actingUser.lastName,
                createdAt: now, updatedAt: now,
            };
            conferenceToUpdate.followedBy.push(followerInfo);
            notificationBaseType = 'Follow Conference';
            notificationMessageForActor = `You followed the conference: ${conferenceToUpdate.conference.title}`;
            isFollowing = true;
        }

        // --- NOTIFICATION DISPATCH LOGIC ---

        // 1. NOTIFY THE ACTING USER
        // Check if *any* notification should be sent for this event type
        if (shouldGenerateNotificationEvent(actingUser, isFollowing ? 'Follow' : 'Unfollow')) {
            const userSettings: Setting = { ...defaultUserSettings, ...(actingUser.setting || {}) };
            const preferredChannels = userSettings.notificationThrough || defaultUserSettings.notificationThrough; // Default to System

            const notificationForActor: Notification = {
                id: uuidv4(), conferenceId: conferenceId, createdAt: now, isImportant: false,
                seenAt: null, deletedAt: null, message: notificationMessageForActor, type: notificationBaseType,
            };

            // Send via SYSTEM if preferred
            if (preferredChannels === 'System' || preferredChannels === 'All') {
                 // Ensure notifications array exists on the *copy* we are modifying
                if (!actingUser.notifications) {
                    actingUser.notifications = [];
                }
                actingUser.notifications.push(notificationForActor); // Add to user's list (on the copy)
                // Send real-time via Socket.IO
                const actingUserSocket = connectedUsers.get(userId);
                if (actingUserSocket) {
                    actingUserSocket.emit('notification', notificationForActor);
                    console.log(`System notification sent to acting user ${userId}`);
                }
            }

            // Send via EMAIL if preferred
            if (preferredChannels === 'Email' || preferredChannels === 'All') {
                // Use await, but wrap in try/catch so email failure doesn't stop the request
                try {
                    await emailService.sendFollowNotificationEmail({
                        recipientUser: actingUser, // The actor is the recipient here
                        // actingUser: null, // Or pass actingUser again, function handles isRecipientTheActor
                        conference: conferenceToUpdate,
                        isFollowing: isFollowing,
                        isRecipientTheActor: true
                    });
                } catch (emailError) {
                    console.error(`Failed to send follow/unfollow email to acting user ${actingUser.email}:`, emailError);
                    // Logged in service, maybe add specific log here if needed
                }
            }
        } else {
             console.log(`Notifications suppressed for acting user ${userId} based on settings.`);
        }


        // 2. NOTIFY OTHER FOLLOWERS (Only when someone *follows*)
        if (isFollowing && conferenceToUpdate.followedBy && conferenceToUpdate.followedBy.length > 0) {
            const notificationMessageForFollowers = `${actingUser.firstName || ''} ${actingUser.lastName || ''} followed the conference: ${conferenceToUpdate.conference.title}`;

            // Use a loop that allows modifying the main 'users' array if needed (e.g., `for...of` with index or `forEach` with index)
            // We need the index to update the correct user object in the main `users` array for system notifications.
            for (const followerInfo of conferenceToUpdate.followedBy) {
                 if (followerInfo.id === userId) continue; // Don't notify the actor again

                 const followerIndex = users.findIndex(u => u.id === followerInfo.id);
                 if (followerIndex === -1) continue; // Follower not found in user list

                 // Get the full follower user object *from the main array*
                 const followerUser = users[followerIndex];

                 // Check if this FOLLOWER wants notifications for this event type
                 if (shouldGenerateNotificationEvent(followerUser, 'Follow')) { // Check based on 'Follow' event
                    const followerSettings: Setting = { ...defaultUserSettings, ...(followerUser.setting || {}) };
                    const followerChannels = followerSettings.notificationThrough || defaultUserSettings.notificationThrough;

                    const notificationForFollower: Notification = {
                        id: uuidv4(), conferenceId: conferenceId, createdAt: now, isImportant: false,
                        seenAt: null, deletedAt: null, message: notificationMessageForFollowers, type: notificationBaseType, // Type is 'Follow Conference'
                    };

                    // Send via SYSTEM if preferred by the follower
                    if (followerChannels === 'System' || followerChannels === 'All') {
                        // IMPORTANT: Modify the user object directly in the 'users' array
                        if (!users[followerIndex].notifications) {
                             users[followerIndex].notifications = [];
                        }
                        users[followerIndex].notifications.push(notificationForFollower); // Add to the list in the main array
                        // Send real-time via Socket.IO
                        const followerSocket = connectedUsers.get(followerInfo.id);
                        if (followerSocket) {
                            followerSocket.emit('notification', notificationForFollower);
                             console.log(`System notification sent to follower ${followerInfo.id}`);
                        }
                    }

                     // Send via EMAIL if preferred by the follower
                    if (followerChannels === 'Email' || followerChannels === 'All') {
                        try {
                            await emailService.sendFollowNotificationEmail({
                                recipientUser: followerUser, // The follower is the recipient
                                actingUser: actingUser, // Person who did the following
                                conference: conferenceToUpdate,
                                isFollowing: true, // This notification is always for a follow action
                                isRecipientTheActor: false
                            });
                        } catch (emailError) {
                             console.error(`Failed to send follow notification email to follower ${followerUser.email}:`, emailError);
                        }
                    }
                 } else {
                     console.log(`Notifications suppressed for follower ${followerInfo.id} based on their settings.`);
                 }
            }
        }

        // --- Update user and conference data in the main arrays ---
        users[userIndex] = actingUser; // Update acting user with their notification changes
        conferences[conferenceIndex] = conferenceToUpdate;

        // --- Data Persistence (Keep as is) ---
        await Promise.all([
            fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
            fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8'),
        ]);

        // Return the updated acting user (including potentially new notifications)
        res.status(200).json(users[userIndex]); // Return the final state from the users array

    } catch (error: any) {
        console.error('Error in followConference handler:', error);
        // Error handling (Keep as is)
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in a JSON file' });
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'A required JSON file was not found' });
        } else {
            res.status(500).json({ message: 'Internal server error' });
        }
    }
};