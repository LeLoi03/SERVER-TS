import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

// Import types and services
import { UserResponse, Notification, Setting, defaultUserSettings } from '../types/user.response';
import { ConferenceResponse, ImportantDate, Location } from '../types/conference.response';
import { connectedUsers } from '../server-ts';
import * as emailService from './emailService'; // Import email service

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');

// --- Helper Function: getConferenceChanges (Keep as is) ---
function getConferenceChanges(oldConf: ConferenceResponse, newConf: ConferenceResponse): { hasChanges: boolean; message: string } {
    // ... (implementation remains the same)
     let message = ""; // Initialize as empty string
    let hasChanges = false;

    function addChange(field: string, oldValue: any, newValue: any) {
        if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
            message += `\n- ${field}: Changed from "${oldValue ?? 'N/A'}" to "${newValue ?? 'N/A'}".`; // Removed extra \n
            hasChanges = true;
        }
    }
     // --- Refined Date Change Logic ---
    function addChangeDate(field: string, oldDates: ImportantDate[] | null, newDates: ImportantDate[] | null) {
        const format = (d: ImportantDate | null) => d ? `${d.name || d.type || 'Date'}: ${d.fromDate?.substring(0, 10) ?? 'N/A'}${d.toDate ? ` to ${d.toDate.substring(0, 10)}` : ''}` : 'N/A';
        const oldDatesMap = new Map((oldDates || []).filter(d => d).map(d => [d!.id || `${d!.type}-${d!.name}`, format(d)]));
        const newDatesMap = new Map((newDates || []).filter(d => d).map(d => [d!.id || `${d!.type}-${d!.name}`, format(d)]));

        let dateChangesDetected = false;
        let dateChangeMessage = `\n- ${field}:`;

        // Check for added/modified dates
        for (const [key, newVal] of newDatesMap) {
            const oldVal = oldDatesMap.get(key);
            if (!oldVal) {
                dateChangeMessage += `\n  - Added: ${newVal}`;
                dateChangesDetected = true;
            } else if (oldVal !== newVal) {
                dateChangeMessage += `\n  - Modified: ${oldVal} -> ${newVal}`;
                dateChangesDetected = true;
            }
        }
        // Check for removed dates
        for (const [key, oldVal] of oldDatesMap) {
            if (!newDatesMap.has(key)) {
                dateChangeMessage += `\n  - Removed: ${oldVal}`;
                dateChangesDetected = true;
            }
        }

        if (dateChangesDetected) {
            message += dateChangeMessage;
            hasChanges = true;
        }
    }
     // --- Refined Location Change Logic ---
    function addChangeLocation(field: string, oldLocation: Location | null, newLocation: Location | null) {
         if (JSON.stringify(oldLocation) === JSON.stringify(newLocation)) return; // Quick exit if identical

         let locationChangeMessage = `\n- ${field}:`;
         let locationChangesDetected = false;

         if (!oldLocation && newLocation) {
             locationChangeMessage += ` Added (Address: ${newLocation.address ?? 'N/A'}, City: ${newLocation.cityStateProvince ?? 'N/A'}, Country: ${newLocation.country ?? 'N/A'})`;
             locationChangesDetected = true;
         } else if (oldLocation && !newLocation) {
              locationChangeMessage += ` Removed (was Address: ${oldLocation.address ?? 'N/A'}, City: ${oldLocation.cityStateProvince ?? 'N/A'}, Country: ${oldLocation.country ?? 'N/A'})`;
              locationChangesDetected = true;
         } else if (oldLocation && newLocation) {
              if (oldLocation.address !== newLocation.address) {
                 locationChangeMessage += `\n  - Address: "${oldLocation.address ?? 'N/A'}" -> "${newLocation.address ?? 'N/A'}"`;
                 locationChangesDetected = true;
             }
              if (oldLocation.cityStateProvince !== newLocation.cityStateProvince) {
                  locationChangeMessage += `\n  - City/State/Province: "${oldLocation.cityStateProvince ?? 'N/A'}" -> "${newLocation.cityStateProvince ?? 'N/A'}"`;
                  locationChangesDetected = true;
              }
              if (oldLocation.country !== newLocation.country) {
                   locationChangeMessage += `\n  - Country: "${oldLocation.country ?? 'N/A'}" -> "${newLocation.country ?? 'N/A'}"`;
                   locationChangesDetected = true;
              }
             // Continent change might be less relevant for users, keep if needed
             // if (oldLocation.continent !== newLocation.continent) {
             //     locationChangeMessage += `\n  - Continent: "${oldLocation.continent ?? 'N/A'}" -> "${newLocation.continent ?? 'N/A'}"`;
             //     locationChangesDetected = true;
             // }
         }

         if (locationChangesDetected) {
             message += locationChangeMessage;
             hasChanges = true;
         }
    }

    addChange("Title", oldConf.conference.title, newConf.conference.title);
    addChange("Acronym", oldConf.conference.acronym, newConf.conference.acronym);
    // Organization details changes (Example)
    addChange("Organization Link", oldConf.organization?.link, newConf.organization?.link);
    addChange("Publisher", oldConf.organization?.publisher, newConf.organization?.publisher);
    // Call refined date/location checkers
    addChangeDate("Dates", oldConf.dates, newConf.dates);
    addChangeLocation("Location", oldConf.location, newConf.location);
    // Ranks - Keep simple JSON compare or implement detailed rank diff if needed
    addChange("Ranks", JSON.stringify(oldConf.ranks), JSON.stringify(newConf.ranks));

    // Clean up leading/trailing whitespace from the message
    message = message.trim();

    return { hasChanges, message };
}


// --- Helper Function Renamed & Updated (using defaults) ---
// Checks IF a notification EVENT should be generated based on master/specific toggles
function shouldGenerateConferenceUpdateNotification(user: UserResponse | undefined): boolean {
    if (!user) return false;

    const settings: Setting = { ...defaultUserSettings, ...(user.setting || {}) }; // Merge with defaults

    if (settings.receiveNotifications === false) {
        return false; // Master switch off
    }

    // Check specific toggle for conference change events
    if (settings.notificationWhenConferencesChanges === false) {
        return false;
    }

    return true; // Checks passed, event can be generated.
}


// --- Save Conference Details ---
export const saveConferenceDetails: RequestHandler<any, { message: string }, ConferenceResponse, any> = async (req, res) => {
    try {
        const receivedData: ConferenceResponse = req.body;

        if (!receivedData?.conference?.id) {
             return res.status(400).json({ message: 'Invalid data format: Missing conference ID.' }) as any;
        }

        const conferenceId = receivedData.conference.id;
        let dbDetailsData: ConferenceResponse[] = [];
        let usersData: UserResponse[] = [];
        let usersModified = false; // Flag to track if user notifications are changed

        // --- Load Data (Simplified error handling)---
        try {
            const [fileContent, usersFileContent] = await Promise.all([
                fs.promises.readFile(conferenceDetailsFilePath, 'utf-8').catch(() => '[]'), // Default to empty array string on error/ENOENT
                fs.promises.readFile(userFilePath, 'utf-8').catch(() => '[]')
            ]);
            dbDetailsData = JSON.parse(fileContent);
            usersData = JSON.parse(usersFileContent);

            if (!Array.isArray(dbDetailsData)) dbDetailsData = [];
            if (!Array.isArray(usersData)) usersData = [];

        } catch (parseError) {
            console.error('Error parsing JSON data:', parseError);
            return res.status(500).json({ message: 'Error reading or parsing data files.' });
        }

        // Use 'let' for users array as it will be modified
        let users: UserResponse[] = usersData;

        const existingConferenceIndex = dbDetailsData.findIndex(conf => conf.conference?.id === conferenceId);

        // --- Handle Add vs Update ---
        if (existingConferenceIndex === -1) {
            // Add New Conference
            receivedData.followedBy = receivedData.followedBy || []; // Ensure arrays exist
            receivedData.feedBacks = receivedData.feedBacks || [];
            dbDetailsData.push(receivedData);
            await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8');
            console.log(`Added new conference: ${conferenceId}`);
            return res.status(201).json({ message: 'New conference details saved successfully.' }); // 201 Created
        } else {
            // Update Existing Conference
            const oldConference = dbDetailsData[existingConferenceIndex];
            // Create updated version, preserving followers and feedback
            const updatedConference: ConferenceResponse = {
                ...receivedData, // Take all new data first
                followedBy: oldConference.followedBy || [], // Keep existing followers
                feedBacks: oldConference.feedBacks || [],   // Keep existing feedback
            };

            // Ensure core properties are taken from receivedData if they exist
            updatedConference.conference = receivedData.conference || oldConference.conference;
            updatedConference.organization = receivedData.organization || oldConference.organization;
            updatedConference.location = receivedData.location !== undefined ? receivedData.location : oldConference.location; // Handle null location explicitly
            updatedConference.dates = receivedData.dates !== undefined ? receivedData.dates : oldConference.dates; // Handle null dates
            updatedConference.ranks = receivedData.ranks !== undefined ? receivedData.ranks : oldConference.ranks; // Handle null ranks


            const { hasChanges, message: detailedChangeMessage } = getConferenceChanges(oldConference, updatedConference);

            if (!hasChanges) {
                console.log(`No functional changes detected for conference: ${conferenceId}`);
                 // Optionally update the DB anyway if you want updatedAt timestamps etc., to change
                 // dbDetailsData[existingConferenceIndex] = updatedConference;
                 // await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8');
                return res.status(200).json({ message: 'Conference details checked. No functional changes detected.' });
            }

            console.log(`Changes detected for conference: ${conferenceId}. Preparing notifications.`);
            dbDetailsData[existingConferenceIndex] = updatedConference; // Update the array
            await fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(dbDetailsData, null, 2), 'utf-8'); // Save updated conference data

            // --- Notification Logic ---
            const now = new Date().toISOString();
            const notifiedUserIds = new Set<string>(); // Track users notified in this cycle

            // Combine follower list and calendar users list for efficient processing
            const potentiallyAffectedUserIds = new Set<string>();
            (updatedConference.followedBy || []).forEach(f => potentiallyAffectedUserIds.add(f.id));
            users.forEach(u => {
                if (u.calendar?.some(c => c.id === conferenceId)) {
                    potentiallyAffectedUserIds.add(u.id);
                }
            });

            for (const userId of potentiallyAffectedUserIds) {
                 if (notifiedUserIds.has(userId)) continue; // Already processed this user

                 const userIndex = users.findIndex(u => u.id === userId);
                 if (userIndex === -1) continue; // User not found

                 const user = users[userIndex];

                 // Check if user wants *any* conference update notifications
                 if (shouldGenerateConferenceUpdateNotification(user)) {
                    const userSettings: Setting = { ...defaultUserSettings, ...(user.setting || {}) };
                    const preferredChannels = userSettings.notificationThrough || defaultUserSettings.notificationThrough;

                    // Construct notification message (consider adding context like 'followed' or 'in calendar')
                    let context = '';
                    if (updatedConference.followedBy?.some(f => f.id === userId)) context += '(following)';
                    if (user.calendar?.some(c => c.id === conferenceId)) context += (context ? ' & in calendar' : '(in calendar)');

                    const notificationMessage = `Update for "${updatedConference.conference.title}" ${context}:\n${detailedChangeMessage.trim()}`;

                    const notification: Notification = {
                        id: uuidv4(), conferenceId: conferenceId, createdAt: now, isImportant: true, // Updates are likely important
                        seenAt: null, deletedAt: null, message: notificationMessage, type: 'Conference Update',
                    };

                     console.log(` -> User ${userId}: Preparing notification via [${preferredChannels}].`);

                    // Send via SYSTEM if preferred
                    if (preferredChannels === 'System' || preferredChannels === 'All') {
                        if (!users[userIndex].notifications) users[userIndex].notifications = [];
                        users[userIndex].notifications.push(notification);
                        usersModified = true; // Mark for saving
                        console.log(`   - System notification added for user ${userId}`);

                        const userSocket = connectedUsers.get(userId);
                        if (userSocket) {
                            userSocket.emit('notification', notification);
                            console.log(`   - Real-time notification emitted to user ${userId}`);
                        }
                    }

                    // Send via EMAIL if preferred
                    if (preferredChannels === 'Email' || preferredChannels === 'All') {
                        console.log(`   - Attempting email notification for user ${userId}`);
                        try {
                            await emailService.sendConferenceUpdateEmail({
                                recipientUser: user,
                                conference: updatedConference,
                                changeDetails: detailedChangeMessage.trim() // Pass trimmed changes
                            });
                        } catch (emailError) {
                             console.error(`   - Email sending failed for user ${userId} (error logged in emailService).`);
                        }
                    }

                    notifiedUserIds.add(userId); // Mark user as notified for this update cycle
                 } else {
                      console.log(` -> User ${userId}: Notification suppressed by settings.`);
                 }
            } // End loop through potentially affected users

            // Save modified user data ONCE if needed
            if (usersModified) {
                await fs.promises.writeFile(userFilePath, JSON.stringify(users, null, 2), 'utf-8');
                console.log("User notifications updated and saved.");
            }

            return res.status(200).json({ message: 'Conference details updated successfully. Notifications processed.' });
        }
    } catch (error: any) {
        console.error('Error in saveConferenceDetails handler:', error);
        res.status(500).json({ message: 'Internal server error during save/update.' });
    }
};