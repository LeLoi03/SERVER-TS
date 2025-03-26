import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { UserResponse } from '../types/user.response';
import { ConferenceResponse } from '../types/conference.response';
import { Notification } from '../types/user.response';
import { v4 as uuidv4 } from 'uuid';
import { connectedUsers } from '../server-ts';
import { AddedConference } from '../types/addConference';
import { ConferenceListResponse } from '../types/conference.list.response';
import { ConferenceInfo } from '../types/conference.list.response';


const userFilePath = path.resolve(__dirname, './database/users_list.json');
const addConferencesFilePath = path.resolve(__dirname, './database/add_conferences.json');
const conferencesListFilePath = path.resolve(__dirname, './database/DB.json');
const conferenceDetailsFilePath = path.resolve(__dirname, './database/DB_details.json');


export const adminConferences: RequestHandler = async (req, res): Promise<void> => {


    if (req.method === 'GET') {
        // ... (Your existing GET request handling - no changes needed) ...
        try {
            let data = '';
            try {
                data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
            } catch (readError) {
                if ((readError as NodeJS.ErrnoException).code === 'ENOENT') {
                    // File not found
                    data = '[]';
                } else {
                    throw readError; // Other errors
                }
            }
            const addConferences: AddedConference[] = data.trim() ? JSON.parse(data) : [];
            const pendingConferences = addConferences.filter(c => c.status === 'Pending');

            // Create the HTML response
            const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Admin Panel - Conference Approval</title>
        <style>
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid black; padding: 8px; text-align: left; }
        </style>
      </head>
      <body>
        <h1>Pending Conferences</h1>
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
                <td>${conf.conference.createdAt}</td>
                <td>
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
      </body>
      </html>
    `;

            res.status(200).send(html);

        } catch (error) {
            console.error('Error reading or parsing add_conferences.json:', error);
            res.status(500).send('Internal Server Error');
        }

    } else if (req.method === 'POST') {
        const { conferenceId, action } = req.body;

        // // *** IMPORTANT: Get the Admin's User ID ***  REMOVED - No longer needed
        // // Replace this with your actual authentication/session logic
        // const adminUserId = req.body.adminId; //  PLACEHOLDER - Replace this!  e.g., req.session.userId, req.user.id
        //   if (!adminUserId) {
        //     return res.status(401).send('Unauthorized: Missing adminUserId');
        //   }

        if (!conferenceId || !action || (action !== 'approve' && action !== 'reject')) {
            res.status(400).send('Bad Request: Invalid input');
            return; // Added return to prevent further execution
        }

        try {
            // Read files (handling potential errors)
            let addConferences: AddedConference[] = [];
            try {
                const data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
                addConferences = data.trim() ? JSON.parse(data) : [];
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }

            let conferencesList: ConferenceListResponse;
            try {
                const data = await fs.promises.readFile(conferencesListFilePath, 'utf-8');
                conferencesList = JSON.parse(data);
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                    conferencesList = { payload: [], meta: { curPage: 0, perPage: 0, prevPage: 0, totalPage: 0, nextPage: 0, totalItems: 0 } }; // Initialize
                } else {
                    throw error;
                }
            }


            let conferenceDetailsList: ConferenceResponse[] = [];
            try {
                const data = await fs.promises.readFile(conferenceDetailsFilePath, 'utf-8');
                conferenceDetailsList = data.trim() ? JSON.parse(data) : [];
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }

            let usersList: UserResponse[] = [];
            try {
                const data = await fs.promises.readFile(userFilePath, 'utf-8');
                usersList = data.trim() ? JSON.parse(data) : [];
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            }


            // Find the conference
            const conferenceIndex = addConferences.findIndex(c => c.conference.id === conferenceId);
            if (conferenceIndex === -1) {
                res.status(404).send('Conference not found'); // Added return
            }
            const conferenceToProcess = addConferences[conferenceIndex];

            // Get the creator's ID.  *CRITICAL* for updating the user's record.
            const creatorId = conferenceToProcess.conference.creatorId;

            // Find the user in users_list.json
            const userIndex = usersList.findIndex(user => user.id === creatorId);
            if (userIndex === -1) {
                res.status(404).json({ message: 'User not found' }); // Very important!  Added return
            }

            //   // Find Admin user  REMOVED - No longer needed
            //   const adminIndex = usersList.findIndex(user => user.id === adminUserId);
            //   if (adminIndex === -1) {
            //       return res.status(404).json({ message: 'Admin not found' });
            //   }

            const now = new Date().toISOString();
            let notificationType: 'Approve Conference' | 'Reject Conference';
            let notificationMessage: string;

            // Approve/Reject logic
            if (action === 'approve') {
                conferenceToProcess.status = 'Approved';
                notificationType = 'Approve Conference';
                notificationMessage = `Your conference "${conferenceToProcess.conference.title}" has been approved.`;


                const newConferenceListItem: ConferenceInfo = {
                    id: conferenceToProcess.conference.id,
                    title: conferenceToProcess.conference.title,
                    acronym: conferenceToProcess.conference.acronym,
                    location: {
                        cityStateProvince: conferenceToProcess.location.cityStateProvince,
                        country: conferenceToProcess.location.country,
                        address: conferenceToProcess.location.address,
                        continent: conferenceToProcess.location.continent
                    },
                    year: conferenceToProcess.organization.year,
                    rank: conferenceToProcess.rank,
                    source: conferenceToProcess.source,
                    researchFields: conferenceToProcess.researchFields,
                    topics: conferenceToProcess.organization.topics,
                    dates: {
                        fromDate: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.fromDate || '',
                        toDate: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.toDate || '',
                        name: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.name || '',
                        type: conferenceToProcess.dates.find(d => d.type === 'conferenceDates')?.type || ''
                    },
                    link: conferenceToProcess.organization.link,
                    createdAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    creatorId: conferenceToProcess.conference.creatorId,
                    accessType: conferenceToProcess.organization.accessType,
                    publisher: conferenceToProcess.organization.publisher,
                    status: conferenceToProcess.status
                };
                conferencesList.payload.push(newConferenceListItem);

                const newConferenceDetailItem: ConferenceResponse = {
                    conference: conferenceToProcess.conference,
                    organization: conferenceToProcess.organization,
                    location: conferenceToProcess.location,
                    dates: conferenceToProcess.dates,
                    ranks: [{
                        rank: conferenceToProcess.rank,
                        source: conferenceToProcess.source,
                        fieldOfResearch: conferenceToProcess.researchFields,
                    }],

                    feedBacks: [],
                    followedBy: []
                };
                conferenceDetailsList.push(newConferenceDetailItem);

                // Find and update the conference status in the user's myConferences array
                const myConfIndex = usersList[userIndex].myConferences?.findIndex(c => c.id === conferenceId);
                if (myConfIndex !== undefined && myConfIndex !== -1) {
                    usersList[userIndex].myConferences![myConfIndex].status = 'Approved'; // Update the status
                    usersList[userIndex].myConferences![myConfIndex].statusTime = new Date().toISOString(); // Update the status; // Update the status

                }


            } else { // action === 'reject'
                conferenceToProcess.status = 'Rejected';
                notificationType = 'Reject Conference';
                notificationMessage = `Your conference "${conferenceToProcess.conference.title}" has been rejected.`;

                // Find and update the conference status in the user's myConferences array
                const myConfIndex = usersList[userIndex].myConferences?.findIndex(c => c.id === conferenceId);
                if (myConfIndex !== undefined && myConfIndex !== -1) {
                    usersList[userIndex].myConferences![myConfIndex].status = 'Rejected'; // Update the status
                    usersList[userIndex].myConferences![myConfIndex].statusTime = new Date().toISOString(); // Update the status; // Update the status

                }
            }

            // --- Notifications ---

            // 1. Notification for the CONFERENCE CREATOR
            const creatorNotification: Notification = {
                id: uuidv4(),
                createdAt: now,
                isImportant: true, // Probably important for the creator
                seenAt: null,
                deletedAt: null,
                message: notificationMessage,
                type: notificationType,
            };

            if (!usersList[userIndex].notifications) {
                usersList[userIndex].notifications = [];
            }
            usersList[userIndex].notifications.push(creatorNotification);

            // 2. Real-time notification to the CONFERENCE CREATOR
            const creatorSocket = connectedUsers.get(creatorId);
            if (creatorSocket) {
                creatorSocket.emit('notification', creatorNotification);
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


            // Update addConferences (for both approve and reject)
            addConferences[conferenceIndex] = conferenceToProcess;

            // Write back to files
            await Promise.all([
                fs.promises.writeFile(addConferencesFilePath, JSON.stringify(addConferences, null, 2)),
                fs.promises.writeFile(conferencesListFilePath, JSON.stringify(conferencesList, null, 2)),
                fs.promises.writeFile(conferenceDetailsFilePath, JSON.stringify(conferenceDetailsList, null, 2)),
                fs.promises.writeFile(userFilePath, JSON.stringify(usersList, null, 2)), // Update users_list.json
            ]);

            res.redirect('/admin/conferences');

        } catch (error) {
            console.error('Error processing approval/rejection:', error);
            res.status(500).send('Internal Server Error');
        }
    }
};