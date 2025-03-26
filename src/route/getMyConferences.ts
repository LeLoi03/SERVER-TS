import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { AddedConference } from '../types/addConference';

const addConferencesFilePath = path.resolve(__dirname, './database/add_conferences.json');

// 7. Get User's Conferences ---
export const getMyConferences: RequestHandler<{ id: string }, AddedConference[] | { message: string }, any, any> = async (req, res) => {
    try {
        const userId = req.params.id;

        if (!userId) {
            return res.status(400).json({ message: 'Missing userId' }) as any;
        }


        let addedConferences: AddedConference[] = []; // Initialize as empty array

        try {
            const data = await fs.promises.readFile(addConferencesFilePath, 'utf-8');
            // Check for empty file *before* parsing.  This is much more robust.
            if (data.trim() === '') {  // .trim() removes leading/trailing whitespace
                // File is empty, no need to parse. `addedConferences` is already [].
                // You *could* return here with a specific message, but it's not usually necessary.
            } else {
                addedConferences = JSON.parse(data);  // Parse only if there's content
            }


        } catch (error: any) {
            // Distinguish between file-not-found and other errors.
            if (error.code === 'ENOENT') {
                // File not found, `addedConferences` remains [].  This is a perfectly valid case.
                // Again, you could return a specific message if you wanted.
            } else {
                // Other I/O or parsing errors
                console.error('Error reading or parsing conference file:', error);
                return res.status(500).json({ message: 'Internal server error' });
            }
        }

        // Filter conferences by creatorId.  This will work correctly even if addedConferences is [].
        const userConferences = addedConferences.filter(conf => conf.conference.creatorId === userId);

        res.status(200).json(userConferences);
    } catch (error: any) {
        // This outer catch is probably not needed if you handle errors within the inner try/catch properly.
        console.error('Error fetching user conferences:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};