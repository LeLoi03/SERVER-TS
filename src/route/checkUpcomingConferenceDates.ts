// src/jobs/upcomingEventsChecker.ts (or wherever this function lives)

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Import types and services
import { UserResponse, Notification, Setting, defaultUserSettings } from '../types/user.response'; // Import Setting/default
import { ConferenceResponse, ImportantDate } from '../types/conference.response';
import { connectedUsers } from '../server'; // Adjust path if needed
import * as emailService from './emailService'; // Import email service

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');

// --- Helper Function Renamed & Updated (using defaults) ---
// Checks IF a notification EVENT should be generated based on master/specific toggles
function shouldGenerateUpcomingEventNotification(user: UserResponse | undefined): boolean {
    if (!user) return false;

    const settings: Setting = { ...defaultUserSettings, ...(user.setting || {}) }; // Merge with defaults

    if (settings.receiveNotifications === false) {
        return false; // Master switch off
    }

    // Check specific toggle for upcoming events
    if (settings.upComingEvent === false) {
        return false;
    }

    return true; // Checks passed, event can be generated.
}

export async function checkUpcomingConferenceDates() {
    console.log(`[${new Date().toISOString()}] Starting checkUpcomingConferenceDates job...`);
    let usersModified = false; // Flag to track if users file needs saving

    try {
        const [userData, conferenceData] = await Promise.all([
            fs.promises.readFile(userFilePath, 'utf-8'),
            fs.promises.readFile(conferenceDetailsFilePath, 'utf-8'),
        ]);

        // Use 'let' to allow modification of user notification arrays
        let users: UserResponse[] = JSON.parse(userData);
        const conferences: ConferenceResponse[] = JSON.parse(conferenceData);

        const now = new Date();

        for (const conference of conferences) {
            if (!conference.dates || !Array.isArray(conference.dates)) continue; // Skip if no dates

            for (const date of conference.dates) {
                // Skip if date is null or fromDate is missing
                if (!date || !date.fromDate) continue;

                const startDate = new Date(date.fromDate);
                const timeDiffMs = startDate.getTime() - now.getTime();
                const hoursBefore = timeDiffMs / (1000 * 60 * 60);

                // Define notification windows (e.g., ~24h, ~1h)
                // Adjust ranges slightly to avoid missing exact times due to cron schedule jitter
                const notify24h = hoursBefore > 2 && hoursBefore <= 96; // Around 24 hours before
                const notify1h = hoursBefore > 0.9 && hoursBefore <= 1.1;   // Around 1 hour before

                // Add more windows if needed (e.g., 48h)
                // const notify48h = hoursBefore > 47.9 && hoursBefore <= 48.1;

                if (notify24h || notify1h /* || notify48h */) {
                    console.log(`[Upcoming Event] Found relevant date: ${date.name || 'Event'} in "${conference.conference.title}" (${hoursBefore.toFixed(1)}h)`);

                    if (!conference.followedBy || conference.followedBy.length === 0) continue; // Skip if no followers

                    for (const follower of conference.followedBy) {
                        const userIndex = users.findIndex(u => u.id === follower.id);
                        if (userIndex === -1) continue; // Follower not found in current user list

                        const user = users[userIndex]; // Get user reference from the main array

                        // Check if this user should get *any* notification for upcoming events
                        if (shouldGenerateUpcomingEventNotification(user)) {
                            const userSettings: Setting = { ...defaultUserSettings, ...(user.setting || {}) };
                            const preferredChannels = userSettings.notificationThrough || defaultUserSettings.notificationThrough;

                            // Check if this specific notification was already sent recently (prevent duplicates if cron runs often)
                            // Basic check: Look for a similar notification in the last N hours (e.g., 6 hours)
                            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
                            const alreadyNotified = user.notifications?.some(n =>
                                n.type === 'Upcoming Conference' &&
                                n.conferenceId === conference.conference.id &&
                                // Check message content loosely using optional chaining for fromDate
                                // If date.fromDate is null, date.fromDate?.substring(...) becomes undefined.
                                // The nullish coalescing operator (|| '') provides an empty string fallback
                                // if both date.name and the substring result are null/undefined.
                                n.message.includes(date.name || date.fromDate?.substring(0, 10) || '') &&
                                n.createdAt > sixHoursAgo
                            );

                            if (alreadyNotified) {
                                console.log(` -> User ${user.id}: Already notified recently. Skipping.`);
                                continue; // Skip if already notified recently
                            }

                            // --- Create Notification Object ---
                            let notificationMessage = `Upcoming: ${date.name || 'Event'} in "${conference.conference.title}"`;
                            if (notify1h) notificationMessage += ` starting soon (~1 hour)`;
                            else if (notify24h) notificationMessage += ` starting tomorrow`;
                            // Add date/time for clarity
                            notificationMessage += ` (${new Date(date.fromDate).toLocaleDateString()} ${new Date(date.fromDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;


                            const notification: Notification = {
                                id: uuidv4(),
                                conferenceId: conference.conference.id,
                                createdAt: now.toISOString(), // Use consistent timestamp
                                isImportant: true, // Mark as important
                                seenAt: null,
                                deletedAt: null,
                                message: notificationMessage,
                                type: 'Upcoming Conference',
                            };

                            console.log(` -> User ${user.id}: Preparing notification via [${preferredChannels}].`);

                            // --- Dispatch based on channel preference ---

                            // Send via SYSTEM if preferred
                            if (preferredChannels === 'System' || preferredChannels === 'All') {
                                // IMPORTANT: Modify the user object directly in the 'users' array
                                if (!users[userIndex].notifications) {
                                    users[userIndex].notifications = [];
                                }
                                users[userIndex].notifications.push(notification);
                                usersModified = true; // Mark that file needs saving
                                console.log(`   - System notification added for user ${user.id}`);

                                // Send real-time via Socket.IO
                                const userSocket = connectedUsers.get(user.id);
                                if (userSocket) {
                                    userSocket.emit('notification', notification);
                                    console.log(`   - Real-time notification emitted to user ${user.id}`);
                                }
                            }

                            // Send via EMAIL if preferred
                            if (preferredChannels === 'Email' || preferredChannels === 'All') {
                                console.log(`   - Attempting email notification for user ${user.id}`);
                                try {
                                    // Pass relevant info to email service
                                    await emailService.sendUpcomingEventEmail({
                                        recipientUser: user,
                                        conference: conference,
                                        importantDate: date,
                                        hoursBefore: hoursBefore // Pass hours for potentially better email content
                                    });
                                    // No need to modify users array for email, service handles it
                                } catch (emailError) {
                                    // Error is already logged in the service
                                    console.error(`   - Email sending failed for user ${user.id} (error logged in emailService).`);
                                }
                            }
                        } else {
                            console.log(` -> User ${user.id}: Notification suppressed by settings.`);
                        }
                    } // End follower loop
                } // End if (notify24h || notify1h)
            } // End date loop
        } // End conference loop

        // --- Save User Data **ONCE** if modifications were made ---
        if (usersModified) {
            console.log(`[${new Date().toISOString()}] Saving modified user data...`);
            await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
            console.log(`[${new Date().toISOString()}] User data saved.`);
        } else {
            console.log(`[${new Date().toISOString()}] No user modifications detected, skipping save.`);
        }

        console.log(`[${new Date().toISOString()}] Finished checkUpcomingConferenceDates job.`);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] FATAL ERROR in checkUpcomingConferenceDates:`, error);
    }
}