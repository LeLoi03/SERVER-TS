import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server';
import { AddedConference } from '../types/addConference';
import { ConferenceListResponse } from '../types/conference.list.response';
import { ConferenceInfo } from '../types/conference.list.response';


const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const addConferencesFilePath = path.resolve(__dirname, '../database/add_conferences.json');
const conferencesListFilePath = path.resolve(__dirname, '../database/DB.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');

// --- Multer Setup (for handling file uploads) ---
// Store files in memory for simplicity. For large files, consider disk storage.
const storage = multer.memoryStorage();

// --- Helper function to read JSON safely ---
async function readJsonFile<T>(filePath: string, defaultValue: T): Promise<T> {
    try {
        const data = await fs.promises.readFile(filePath, 'utf-8');
        return data.trim() ? JSON.parse(data) : defaultValue;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return defaultValue; // File not found, return default
        }
        console.error(`Error reading JSON file ${filePath}:`, error);
        throw error; // Re-throw other errors
    }
}

// --- Main Controller ---
// We use upload.single('csvFile') as middleware *only* for the POST route handling
export const adminConferences_GET: RequestHandler = async (req, res): Promise<void> => {
    // --- GET Request Logic (Approval/Rejection View) ---
    try {
        const addConferences = await readJsonFile<AddedConference[]>(addConferencesFilePath, []);
        const pendingConferences = addConferences.filter(c => c.status === 'Pending');

        // Create the HTML response including the CSV upload form
        const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Admin Panel - Conference Management</title>
        <style>
          body { font-family: sans-serif; margin: 20px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          h1, h2 { border-bottom: 1px solid #ccc; padding-bottom: 5px; }
          .form-section { margin-bottom: 20px; padding: 15px; border: 1px solid #ccc; border-radius: 5px; }
          label { display: block; margin-bottom: 5px; }
          input[type="file"] { margin-bottom: 10px; }
          button { padding: 8px 15px; cursor: pointer; }
          .action-forms form { display: inline-block; margin-right: 5px; }
        </style>
      </head>
      <body>
        <h1>Admin Conference Management</h1>

        <!-- Section for CSV Import -->
        <div class="form-section">
          <h2>Import Less Reputable Conferences (CSV)</h2>
          <form action="/admin/conferences" method="POST" enctype="multipart/form-data">
             <input type="hidden" name="action" value="import_csv"> <!-- Identifier for this action -->
             <label for="csvFile">Select CSV File:</label>
             <input type="file" id="csvFile" name="csvFile" accept=".csv" required>
             <br>
             <button type="submit">Import CSV</button>
             <p><small>CSV Format: ..., Title (Column 2), Acronym (Column 3), ...</small></p>
          </form>
        </div>

        <!-- Section for Pending Approvals -->
        <h2>Pending Conferences for Approval</h2>
        ${pendingConferences.length > 0 ? `
        <table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Acronym</th>
              <th>Created At</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pendingConferences.map(conf => `
              <tr>
                <td>${conf.conference.title}</td>
                <td>${conf.conference.acronym}</td>
                <td>${new Date(conf.conference.createdAt).toLocaleString()}</td>
                <td class="action-forms">
                  <form action="/admin/conferences" method="POST">
                    <input type="hidden" name="conferenceId" value="${conf.conference.id}">
                    <input type="hidden" name="action" value="approve">
                    <button type="submit">Approve</button>
                  </form>
                  <form action="/admin/conferences" method="POST">
                    <input type="hidden" name="conferenceId" value="${conf.conference.id}">
                    <input type="hidden" name="action" value="reject">
                    <button type="submit">Reject</button>
                  </form>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : '<p>No pending conferences.</p>'}
      </body>
      </html>
    `;

        res.status(200).send(html);

    } catch (error) {
        console.error('Error rendering admin page:', error);
        res.status(500).send('Internal Server Error');
    }
};

export const adminConferences_POST: RequestHandler = async (req, res): Promise<void> => {
    // --- POST Request Logic (Handles Approve/Reject AND CSV Import) ---
    const { conferenceId, action } = req.body;

    // // *** IMPORTANT: Get the Admin's User ID ***  REMOVED - No longer needed
    // // Replace this with your actual authentication/session logic
    // const adminUserId = req.body.adminId; //  PLACEHOLDER - Replace this!  e.g., req.session.userId, req.user.id
    //   if (!adminUserId) {
    //     return res.status(401).send('Unauthorized: Missing adminUserId');
    //   }

    // --- CSV Import Logic ---
    if (action === 'import_csv') {
        if (!req.file) {
            return res.status(400).send('Bad Request: No CSV file uploaded.') as any;
        }

        console.log('Processing CSV import...');
        let updatedListCount = 0;
        let updatedDetailsCount = 0;

        try {
            // 1. Read existing data
            const conferencesList = await readJsonFile<ConferenceListResponse>(conferencesListFilePath, { payload: [], meta: { curPage: 0, perPage: 0, prevPage: null, totalPage: 0, nextPage: null, totalItems: 0 } });
            const conferenceDetailsList = await readJsonFile<ConferenceResponse[]>(conferenceDetailsFilePath, []);

            // 2. Parse the CSV
            const csvData = req.file.buffer.toString('utf-8');
            const records: string[][] = parse(csvData, {
                skip_empty_lines: true,
                trim: true, // Trim whitespace from fields
            });

            // 3. Process each CSV record
            for (const record of records) {
                if (record.length < 3) {
                    console.warn('Skipping incomplete CSV row:', record);
                    continue; // Skip rows that don't have at least Title and Acronym
                }
                const csvTitle = record[1]?.trim(); // Column 2
                const csvAcronym = record[2]?.trim(); // Column 3

                if (!csvTitle || !csvAcronym) {
                    console.warn('Skipping CSV row with missing Title or Acronym:', record);
                    continue;
                }

                // 4. Find and update in conferencesList (DB.json)
                conferencesList.payload.forEach(conf => {
                    if (conf.title?.trim().toLowerCase() === csvTitle.toLowerCase() &&
                        conf.acronym?.trim().toLowerCase() === csvAcronym.toLowerCase()) {
                        if (!conf.isLessReputable) { // Only count if it changed
                            updatedListCount++;
                        }
                        conf.isLessReputable = true;
                        conf.updatedAt = new Date().toISOString(); // Also update timestamp
                        console.log(`Marked ${conf.acronym} in list as less reputable.`);
                    }
                });

                // 5. Find and update in conferenceDetailsList (DB_details.json)
                conferenceDetailsList.forEach(detail => {
                    if (detail.conference.title?.trim().toLowerCase() === csvTitle.toLowerCase() &&
                        detail.conference.acronym?.trim().toLowerCase() === csvAcronym.toLowerCase()) {
                        if (!detail.isLessReputable) { // Only count if it changed
                            updatedDetailsCount++;
                        }
                        detail.isLessReputable = true;
                        if (detail.conference) { // Update timestamp if conference object exists
                            detail.conference.updatedAt = new Date().toISOString();
                        }
                        console.log(`Marked ${detail.conference.acronym} in details as less reputable.`);
                    }
                });
            } // End of loop through CSV records

            // 6. Write updated data back to files
            await Promise.all([
                fs.promises.writeFile(conferencesListFilePath, JSON.stringify(conferencesList, null, 2)),
                fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferenceDetailsList, null, 2)),
            ]);

            console.log(`CSV Import Complete: Marked ${updatedListCount} in list, ${updatedDetailsCount} in details.`);
            // Redirect back with a success message (optional query param for feedback)
            res.redirect('/admin/conferences?importStatus=success');

        } catch (error) {
            console.error('Error processing CSV import:', error);
            res.status(500).send(`Internal Server Error during CSV import: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        return; // Stop execution after handling CSV import
    }

    // --- Approve/Reject Logic (Existing Code) ---
    if ((action === 'approve' || action === 'reject') && conferenceId) {
        console.log(`Processing ${action} for conference ID: ${conferenceId}`);
        try {
            // Read files (using helper function)
            let addConferences = await readJsonFile<AddedConference[]>(addConferencesFilePath, []);
            let conferencesList = await readJsonFile<ConferenceListResponse>(conferencesListFilePath, { payload: [], meta: { curPage: 0, perPage: 0, prevPage: null, totalPage: 0, nextPage: null, totalItems: 0 } });
            let conferenceDetailsList = await readJsonFile<ConferenceResponse[]>(conferenceDetailsFilePath, []);
            let usersList = await readJsonFile<UserResponse[]>(userFilePath, []);

            // Find the conference in add_conferences
            const conferenceIndex = addConferences.findIndex(c => c.conference.id === conferenceId);
            if (conferenceIndex === -1) {
                return res.status(404).send('Pending conference not found') as any;
            }
            const conferenceToProcess = addConferences[conferenceIndex];

            // Check if already processed
            if (conferenceToProcess.status !== 'Pending') {
                console.log(`Conference ${conferenceId} already processed with status: ${conferenceToProcess.status}.`);
                return res.redirect('/admin/conferences?processStatus=already_done');
            }


            const creatorId = conferenceToProcess.conference.creatorId;
            const userIndex = usersList.findIndex(user => user.id === creatorId);
            if (userIndex === -1) {
                console.error(`User (creator) with ID ${creatorId} not found for conference ${conferenceId}`);
                // Decide how to handle: maybe reject automatically, or just log and continue if possible
                // For now, let's prevent the action if the user isn't found.
                return res.status(404).send('Creator user not found, cannot process conference.') as any;
            }

            const now = new Date().toISOString();
            let notificationType: 'Approve Conference' | 'Reject Conference';
            let notificationMessage: string;

            // --- Action Logic ---
            if (action === 'approve') {
                conferenceToProcess.status = 'Approved';
                notificationType = 'Approve Conference';
                notificationMessage = `Your conference "${conferenceToProcess.conference.title}" has been approved.`;

                // --- Create entries for the main DB files ---
                // Note: Ensure the structure matches your ConferenceInfo and ConferenceResponse types
                const newConferenceListItem: ConferenceInfo = {
                    id: conferenceToProcess.conference.id,
                    title: conferenceToProcess.conference.title,
                    acronym: conferenceToProcess.conference.acronym,
                    // Safely access nested properties, providing defaults or null
                    location: conferenceToProcess.location ? {
                        cityStateProvince: conferenceToProcess.location.cityStateProvince ?? null,
                        country: conferenceToProcess.location.country ?? null,
                        address: conferenceToProcess.location.address ?? null,
                        continent: conferenceToProcess.location.continent ?? null,
                    } : null,
                    year: conferenceToProcess.organization?.year ?? null,
                    rank: conferenceToProcess.rank,
                    source: conferenceToProcess.source,
                    researchFields: conferenceToProcess.researchFields,
                    topics: conferenceToProcess.organization?.topics ?? [],
                    // Find the specific date type or provide a default null structure
                    dates: {
                        fromDate: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.fromDate || '',
                        toDate: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.toDate || '',
                        name: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.name || '',
                        type: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.type || ''
                    },                    link: conferenceToProcess.organization?.link ?? null,
                    createdAt: conferenceToProcess.conference.createdAt, // Use original creation time
                    updatedAt: now,
                    creatorId: conferenceToProcess.conference.creatorId,
                    accessType: conferenceToProcess.organization?.accessType ?? null,
                    publisher: conferenceToProcess.organization?.publisher ?? null,
                    status: 'Approved', // Set status explicitly
                    isLessReputable: false // Default for newly approved
                };
                // Avoid duplicates if somehow approved again
                if (!conferencesList.payload.some(c => c.id === newConferenceListItem.id)) {
                    conferencesList.payload.push(newConferenceListItem);
                    conferencesList.meta.totalItems++; // Increment total count
                }


                const newConferenceDetailItem: ConferenceResponse = {
                    conference: conferenceToProcess.conference,
                    organization: conferenceToProcess.organization ?? null,
                    location: conferenceToProcess.location ?? null,
                    dates: conferenceToProcess.dates ?? null,
                    // Ensure ranks array structure is correct
                    ranks: (conferenceToProcess.rank || conferenceToProcess.source || conferenceToProcess.researchFields)
                        ? [{
                            rank: conferenceToProcess.rank ?? 'N/A', // Provide default if null
                            source: conferenceToProcess.source ?? null,
                            // Adapt fieldOfResearch based on how it's stored in AddedConference
                            fieldOfResearch: Array.isArray(conferenceToProcess.researchFields) ? conferenceToProcess.researchFields.join(', ') : conferenceToProcess.researchFields ?? null,
                        }]
                        : [], // Use empty array if no rank info
                    feedBacks: [], // Initialize as empty
                    followedBy: [], // Initialize as empty
                    isLessReputable: false // Default for newly approved
                };
                // Avoid duplicates if somehow approved again
                if (!conferenceDetailsList.some(d => d.conference.id === newConferenceDetailItem.conference.id)) {
                    conferenceDetailsList.push(newConferenceDetailItem);
                }


                // Update user's myConferences
                if (usersList[userIndex].myConferences) {
                    const myConfIndex = usersList[userIndex].myConferences!.findIndex(c => c.id === conferenceId);
                    if (myConfIndex !== -1) {
                        usersList[userIndex].myConferences![myConfIndex].status = 'Approved';
                        usersList[userIndex].myConferences![myConfIndex].statusTime = now;
                    } else {
                        console.warn(`Conference ${conferenceId} not found in myConferences for user ${creatorId}`);
                    }
                } else {
                    console.warn(`myConferences array not found for user ${creatorId}`);
                }


            } else { // action === 'reject'
                conferenceToProcess.status = 'Rejected';
                notificationType = 'Reject Conference';
                notificationMessage = `Your conference "${conferenceToProcess.conference.title}" has been rejected.`;

                // Update user's myConferences
                if (usersList[userIndex].myConferences) {
                    const myConfIndex = usersList[userIndex].myConferences!.findIndex(c => c.id === conferenceId);
                    if (myConfIndex !== -1) {
                        usersList[userIndex].myConferences![myConfIndex].status = 'Rejected';
                        usersList[userIndex].myConferences![myConfIndex].statusTime = now;
                    } else {
                        console.warn(`Conference ${conferenceId} not found in myConferences for user ${creatorId} during rejection`);
                    }
                } else {
                    console.warn(`myConferences array not found for user ${creatorId} during rejection`);
                }

                // Optionally remove from main lists if it was mistakenly added before rejection?
                // Generally, rejected conferences don't go into the main DB.json/DB_details.json
                // So, no need to add/remove from conferencesList or conferenceDetailsList here.
            }

            // --- Notifications ---
            const creatorNotification: Notification = {
                id: uuidv4(),
                conferenceId: conferenceId,
                createdAt: now,
                isImportant: true,
                seenAt: null,
                deletedAt: null,
                message: notificationMessage,
                type: notificationType,
            };

            if (!usersList[userIndex].notifications) {
                usersList[userIndex].notifications = [];
            }
            usersList[userIndex].notifications.push(creatorNotification);

            // Real-time notification
            const creatorSocket = connectedUsers.get(creatorId);
            if (creatorSocket) {
                creatorSocket.emit('notification', creatorNotification);
                console.log(`Sent real-time notification to creator ${creatorId}`);
            } else {
                console.log(`Creator ${creatorId} not connected for real-time notification.`);
            }

            // //3. Notification for the ADMIN  REMOVED - No admin notification needed
            // const adminNotification: Notification = {
            //   id: uuidv4(),
            //   createdAt: now,
            //   isImportant: false, // Probably important for the creator
            //   seenAt: null,
            //   deletedAt: null,
            //   message: `You ${action} conference ${conferenceToProcess.conference.title}`,
            //   type: notificationType,
            // }

            // if (!usersList[adminIndex].notifications) {
            //   usersList[adminIndex].notifications = [];
            // }
            // usersList[adminIndex].notifications.push(adminNotification);

            // // 4. Real-time notification to the ADMIN  REMOVED - No admin notification needed
            // const adminSocket = connectedUsers.get(adminUserId);
            // if (adminSocket) {
            //   adminSocket.emit('notification', adminNotification);
            // }

            // Update addConferences status
            addConferences[conferenceIndex] = conferenceToProcess;

            // --- Write back to files ---
            await Promise.all([
                fs.promises.writeFile(addConferencesFilePath, JSON.stringify(addConferences, null, 2)),
                fs.promises.writeFile(conferencesListFilePath, JSON.stringify(conferencesList, null, 2)),
                fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferenceDetailsList, null, 2)),
                fs.promises.writeFile(userFilePath, JSON.stringify(usersList, null, 2)),
            ]);

            console.log(`Successfully processed ${action} for conference ${conferenceId}`);
            res.redirect('/admin/conferences'); // Redirect after successful approve/reject

        } catch (error) {
            console.error(`Error processing ${action} for conference ${conferenceId}:`, error);
            res.status(500).send(`Internal Server Error processing action: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
        return; // Stop execution after handling approve/reject
    }

    // If neither CSV import nor valid approve/reject action
    console.warn('Invalid POST request to /admin/conferences:', req.body);
    res.status(400).send('Bad Request: Invalid action or missing parameters.');
};