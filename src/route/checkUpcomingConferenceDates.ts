import 'dotenv/config';
import path from 'path';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');

// --- Scheduled Task (using node-cron) ---

// Helper Function: shouldSendUpcomingEventNotification
function shouldSendUpcomingEventNotification(user: UserResponse): boolean {
    const settings = user.setting;
    // console.log(`Checking settings for user ${user.id}:`, settings); // Log user settings
    if (!settings) {
        // console.log(`User ${user.id} has no settings.  Not sending notification.`);
        return false;
    }

    if (settings.receiveNotifications === false) {
        // console.log(`User ${user.id} has receiveNotifications disabled. Not sending notification.`);
        return false;
    }
    if (settings.upComingEvent === false) {
        // console.log(`User ${user.id} has upComingEvent disabled. Not sending notification.`);
        return false;
    }
    // console.log(`User ${user.id} settings allow upcoming event notifications.`);
    return true;
}

export async function checkUpcomingConferenceDates() {
    // console.log('--- Starting checkUpcomingConferenceDates ---');
    try {
        const [userData, conferenceData] = await Promise.all([
            fs.promises.readFile(userFilePath, 'utf-8').catch(err => {
                console.error("Error reading user file:", err);
                throw err; // Re-throw to be caught by the outer catch
            }),
            fs.promises.readFile(conferenceDetailsFilePath, 'utf-8').catch(err => {
                console.error("Error reading conference file:", err);
                throw err;
            }),
        ]);

        // console.log('Successfully read user and conference data.');

        const users: UserResponse[] = JSON.parse(userData);
        const conferences: ConferenceResponse[] = JSON.parse(conferenceData);

        const now = new Date();
        // console.log('Current time:', now.toISOString());

        for (const conference of conferences) {
            // console.log(`Checking conference: ${conference.conference.title} (ID: ${conference.conference.id})`);
            // Check if dates exist and are an array
            if (conference.dates && Array.isArray(conference.dates)) {
                for (const date of conference.dates) {
                    // Check if fromDate exists
                    if (date && date.fromDate) {
                        const startDate = new Date(date.fromDate);
                        const timeDiffMs = startDate.getTime() - now.getTime();
                        const hoursBefore = timeDiffMs / (1000 * 60 * 60);

                        // console.log(`  Checking date: ${date.name} (ID: ${date.id}), Start Date: ${startDate.toISOString()}, Hours Before: ${hoursBefore.toFixed(2)}`);

                        // Example: Notify 24 hours and 1 hour before. Adjust as needed.
                        if ((hoursBefore > 5 && hoursBefore <= 96) || (hoursBefore > 0.9 && hoursBefore <= 1)) {
                            // console.log(`    Date is within notification window.`);

                            // Find users following this conference.
                            if (conference.followedBy) {
                                // console.log(`    Conference has ${conference.followedBy.length} followers.`);
                                for (const follower of conference.followedBy) {
                                    const user = users.find(u => u.id === follower.id);

                                    if (user) {
                                        // console.log(`    Checking follower: ${user.firstName} ${user.lastName} (ID: ${user.id})`);

                                        if (shouldSendUpcomingEventNotification(user)) {
                                            const notificationMessage = `Upcoming event in conference "${conference.conference.title}": ${date.name || 'Event'} on ${date.fromDate.toString().substring(0, 10)}`; console.log(`      Sending notification to user ${user.id}: ${notificationMessage}`);

                                            const notification: Notification = {
                                                id: uuidv4(),
                                                conferenceId: conference.conference.id,
                                                createdAt: new Date().toISOString(),
                                                isImportant: true, // Mark as important
                                                seenAt: null,
                                                deletedAt: null,
                                                message: notificationMessage,
                                                type: 'Upcoming Conference',
                                            };

                                            if (!user.notifications) {
                                                user.notifications = [];
                                            }
                                            user.notifications.push(notification);

                                            // Send real-time notification.
                                            const userSocket = connectedUsers.get(user.id);
                                            if (userSocket) {
                                                // console.log(`        Sending real-time notification to user ${user.id}`);
                                                userSocket.emit('notification', notification);
                                            } else {
                                                // console.log(`        User ${user.id} is not currently connected.`);
                                            }
                                        } else {
                                            // console.log(`      User ${user.id} does not meet notification criteria.`);
                                        }
                                    } else {
                                        // console.log(`    Follower with ID ${follower.id} not found in users.`);
                                    }
                                }
                            } else {
                                console.log('    Conference has no followers.');
                            }

                            //Write to file  //MOVED INSIDE THE DATE/USER LOOP
                            // console.log("    Writing updated data to files...");
                            await Promise.all([
                                fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8'),
                                fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferences, null, 2), 'utf-8')
                            ]).then(() => console.log("    Data written to files successfully."))
                                .catch(err => console.error("    Error writing to files:", err));

                        } else {
                            // console.log('    Date is not within notification window.');
                        }
                    } else {
                        // console.log('    Date or fromDate is missing for a conference date.');
                    }
                }
            } else {
                // console.log('    Conference dates are missing or not an array.');
            }
        }
        // console.log('--- Finished checkUpcomingConferenceDates ---');

    } catch (error) {
        console.error('Error in checkUpcomingConferenceDates:', error);
    }
}