import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { ConferenceListResponse, Meta } from '../../types/conference.list.response';

const conferencesListFilePath = path.resolve(__dirname, '../database/DB.json');

// 16. DB to JSON : Receive and save conference data
// --- Save Conference List ---
export const saveConferenceData: RequestHandler<any, { message: string }, ConferenceListResponse, any> = async (
    req,
    res
) => {
    try {
        const receivedData: ConferenceListResponse = req.body;

        if (!receivedData || !receivedData.payload || !Array.isArray(receivedData.payload)) {
            return res.status(400).json({ message: 'Invalid data format received.' }) as any;
        }

        let dbData: ConferenceListResponse = { payload: [], meta: {} as Meta }; // Initialize with an empty structure
        try {
            const fileContent = await fs.promises.readFile(conferencesListFilePath, 'utf-8');
            dbData = JSON.parse(fileContent);

            //Ensure that dbData and its payload are arrays.
            if (!dbData || !dbData.payload || !Array.isArray(dbData.payload)) {
                dbData = { payload: [], meta: dbData?.meta || {} as Meta }; //Re-initialize if necessary
            }

        } catch (error: any) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
                console.error('Error reading DB.json:', error);
                return res.status(500).json({ message: 'Error reading DB.json' });
            }
            // If the file doesn't exist, it's fine; dbData is already initialized.
        }

        // Iterate through received conferences and add them if they don't exist.
        let addedCount = 0;
        for (const conference of receivedData.payload) {
            const exists = dbData.payload.some(existingConf => existingConf.id === conference.id);
            if (!exists) {
                dbData.payload.push(conference);
                addedCount++;
            }
        }
        dbData.meta = receivedData.meta;


        // Only write if there are new conferences.
        if (addedCount > 0) {
            await fs.promises.writeFile(conferencesListFilePath, JSON.stringify(dbData, null, 2), 'utf-8');
            res.status(200).json({ message: `${addedCount} new conferences added.` });
        } else {
            res.status(200).json({ message: 'No new conferences to add.' }); // Still a 200 OK
        }

    } catch (error: any) {
        console.error('Error saving conference data:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};