import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';
import { ImportantDate, Location } from '../types/conference.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// --- Helper Function to Compare Conference Details and Generate Detailed Message ---
function getConferenceChanges(oldConf: ConferenceResponse, newConf: ConferenceResponse): { hasChanges: boolean; message: string } {
    let message = "Conference updates:";
    let hasChanges = false;

    function addChange(field: string, oldValue: any, newValue: any) {
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            message += `\n- ${field}: Changed from "${oldValue ?? 'N/A'}" to "${newValue ?? 'N/A'}".\n`;
            hasChanges = true;
        }
    }

    function addChangeDate(field: string, oldDates: ImportantDate[] | null, newDates: ImportantDate[] | null) {
        if (!oldDates && !newDates) return;

        if (!oldDates || !newDates || oldDates.length !== newDates.length) {
            message += `- ${field}: Dates have been changed.\n`;
            hasChanges = true;
            return;
        }

        for (let i = 0; i < oldDates.length; i++) {
            const oldDate = oldDates[i];
            const newDate = newDates[i];

            if (!oldDate && !newDate) continue;
            if (!oldDate || !newDate) {
                message += `- ${field}: Dates have been changed.\n`;
                hasChanges = true;
                return;
            }

            // Only check and provide detailed changes for "conferenceDates"
            if (oldDate.type === "conferenceDates" && newDate.type === "conferenceDates") {
                if (oldDate.fromDate !== newDate.fromDate) {
                    message += `- ${field}: Conference start date changed from "${oldDate.fromDate ?? 'N/A'}" to "${newDate.fromDate ?? 'N/A'}".\n`;
                    hasChanges = true;
                }
                if (oldDate.toDate !== newDate.toDate) {
                    message += `- ${field}: Conference end date changed from "${oldDate.toDate ?? 'N/A'}" to "${newDate.toDate ?? 'N/A'}".\n`;
                    hasChanges = true;
                }
            } else if (oldDate.fromDate !== newDate.fromDate || oldDate.toDate !== newDate.toDate || oldDate.name !== newDate.name || oldDate.type !== newDate.type) {
                // For other date types, just indicate a change
                message += `- ${field}: Dates have been changed.\n`;
                hasChanges = true;
                return; // Important: Exit the loop after finding a change in non-conference dates
            }
        }
    }

    function addChangeLocation(field: string, oldLocation: Location | null, newLocation: Location | null) {
        if (!oldLocation && !newLocation) return;
        if (!oldLocation || !newLocation) {
            message += `\n- ${field}: Location has been changed.\n`;
            hasChanges = true;
            return;
        }
        if (oldLocation.address !== newLocation.address) {
            message += `\n  - ${field}: Address changed from "${oldLocation.address ?? 'N/A'}" to "${newLocation.address ?? 'N/A'}".\n`;
            hasChanges = true;
        }
        if (oldLocation.cityStateProvince !== newLocation.cityStateProvince) {
            message += `\n  - ${field}:  City/State/Province from "${oldLocation.cityStateProvince ?? 'N/A'}" to "${newLocation.cityStateProvince ?? 'N/A'}".\n`;
            hasChanges = true;
        }
        if (oldLocation.country !== newLocation.country) {
            message += `\n  - ${field}: Country changed from "${oldLocation.country ?? 'N/A'}" to "${newLocation.country ?? 'N/A'}".\n`;
            hasChanges = true;
        }
        if (oldLocation.continent !== newLocation.continent) {
            message += `\n  - ${field}: Continent changed from "${oldLocation.continent ?? 'N/A'}" to "${newLocation.continent ?? 'N/A'}".\n`;
            hasChanges = true;
        }
    }


    addChange("Title", oldConf.conference.title, newConf.conference.title);
    addChange("Acronym", oldConf.conference.acronym, newConf.conference.acronym);
    addChange("Organization Link", oldConf.organization?.link, newConf.organization?.link);
    addChange("Publisher", oldConf.organization?.publisher, newConf.organization?.publisher);
    addChange("Access Type", oldConf.organization?.accessType, newConf.organization?.accessType);
    addChange("Year", oldConf.organization?.year, newConf.organization?.year);
    addChangeDate("Dates", oldConf.dates, newConf.dates);
    addChangeLocation("Location", oldConf.location, newConf.location);
    addChange("Ranks", JSON.stringify(oldConf.ranks), JSON.stringify(newConf.ranks));


    return { hasChanges, message: hasChanges ? message : "" };
}

// --- Helper Function to Check Notification Settings ---
function shouldSendUpdateConferenceNotification(user: UserResponse, notificationType: string): boolean {
    const settings = user.setting;

    if (!settings) {
        return false; // Default to no notifications if settings are missing
    }

    if (settings.receiveNotifications === false) {
        return false; // User has disabled all notifications
    }
    if (notificationType === "Conference Update" && settings.notificationWhenConferencesChanges === false) {
        return false;
    }

    // Add more specific checks here based on notificationType and user settings
    return true; // All checks passed, or no specific checks for this type
}

// --- Save Conference Details ---
export const saveConferenceDetails: RequestHandler<any, { message: string }, ConferenceResponse, any> = async (req, res) => {
    try {
        const receivedData: ConferenceResponse = req.body;
        // console.log("Received Data:", receivedData)

        if (!receivedData || !receivedData.conference || !receivedData.conference.id) {
            return res.status(400).json({ message: 'Invalid data format received.  Missing conference ID.' }) as any;
        }

        const conferenceId = receivedData.conference.id;

        let dbDetailsData: ConferenceResponse[] = [];
        let users: UserResponse[] = [];

        try {
            const fileContent = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
            dbDetailsData = JSON.parse(fileContent);
            if (!Array.isArray(dbDetailsData)) {
                dbDetailsData = [];
            }
        } catch (error: any) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
                console.error('Error reading DB_details.json:', error);
                return res.status(500).json({ message: 'Error reading DB_details.json' });
            }
        }

        try {
            const usersFileContent = await fs.promises.readFile(userFilePath, 'utf-8');
            users = JSON.parse(usersFileContent);

            if (!Array.isArray(users)) {
                users = [];
            }
        } catch (userError: any) {
            if (userError.code !== 'ENOENT' && !(userError instanceof SyntaxError)) {
                console.error('Error reading users.json:', userError);
                return res.status(500).json({ message: 'Error reading users.json' });
            }
        }

        const existingConferenceIndex = dbDetailsData.findIndex(conf => conf.conference.id === conferenceId);

        if (existingConferenceIndex === -1) {
            // Conference doesn't exist, add it (no notifications on initial add).
            receivedData.followedBy = [];
            receivedData.feedBacks = [];

            dbDetailsData.push(receivedData);
            await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8');
            console.log("Add new conference details successfully!");

            return res.status(200).json({ message: 'Conference details saved successfully.' });
        } else {

            // Conference exists, update it.
            const oldConference = { ...dbDetailsData[existingConferenceIndex] };
            const updatedConference = { ...oldConference };

            updatedConference.conference = receivedData.conference;
            updatedConference.organization = receivedData.organization;
            updatedConference.location = receivedData.location;
            updatedConference.dates = receivedData.dates;
            updatedConference.ranks = receivedData.ranks;
            // Do NOT update feedBacks and followedBy

            const { hasChanges, message: detailedMessage } = getConferenceChanges(oldConference, updatedConference);

            if (hasChanges) {
                dbDetailsData[existingConferenceIndex] = updatedConference;
                await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8');

                // --- Notification Logic ---
                const now = new Date().toISOString();

                // 1. Notify Followers:
                if (updatedConference.followedBy && updatedConference.followedBy.length > 0) {
                    updatedConference.followedBy.forEach(followerInfo => {
                        const user = users.find(u => u.id === followerInfo.id);
                        // Find the follow information for this conference
                        const followInfo = user?.followedConferences?.find(f => f.id === conferenceId);
                        // Construct base message with conference and follow details
                        const baseMessage = `Update for conference "${updatedConference.conference.title}" (Followed at ${followInfo?.createdAt.toString().substring(0, 10) ?? 'N/A'}):\n`;

                        if (user && shouldSendUpdateConferenceNotification(user, "Conference Update")) {
                            const notification: Notification = {
                                id: uuidv4(),
                                conferenceId: conferenceId,
                                createdAt: now,
                                isImportant: true,
                                seenAt: null,
                                deletedAt: null,
                                message: baseMessage + detailedMessage, // Combine base and detailed messages
                                type: 'Conference Update',
                            };
                            if (!user.notifications) {
                                user.notifications = [];
                            }
                            user.notifications.push(notification);

                            const userSocket = connectedUsers.get(user.id);
                            if (userSocket) {
                                userSocket.emit('notification', notification);
                            }
                        }
                    });
                }

                // 2. Notify Users who added to Calendar:
                users.forEach(user => {
                    if (user.calendar && user.calendar.some(c => c.id === conferenceId)) {
                        //Find the calendar information for this conference
                        const calendarInfo = user.calendar.find(c => c.id === conferenceId);
                        // Construct base message with conference and calendar details
                        const baseMessage = `Update for conference "${updatedConference.conference.title}" (Added to calendar at ${calendarInfo?.createdAt.toString().substring(0, 10) ?? 'N/A'}):\n`;

                        if (shouldSendUpdateConferenceNotification(user, "Conference Update")) {
                            const calendarNotification: Notification = {
                                id: uuidv4(),
                                conferenceId: conferenceId,
                                createdAt: now,
                                isImportant: true,
                                seenAt: null,
                                deletedAt: null,
                                message: baseMessage + detailedMessage, // Combine base and detailed
                                type: 'Conference Update',
                            };

                            if (!user.notifications) {
                                user.notifications = [];
                            }
                            user.notifications.push(calendarNotification);

                            const userSocket = connectedUsers.get(user.id);
                            if (userSocket) {
                                userSocket.emit('notification', calendarNotification);
                            }
                        }
                    }
                });

                await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
                console.log("Update new conference details successfully!");


                return res.status(200).json({ message: 'Conference details updated successfully. Notifications sent.' });
            } else {
                console.log("No changes detected in conference details.")
                return res.status(200).json({ message: 'Conference details updated. No changes detected.' });
            }
        }
    } catch (error: any) {
        console.error('Error saving/updating conference details:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
