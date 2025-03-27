import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';

import { ConferenceResponse } from '../types/conference.response';

const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


export const getVisualizationData: RequestHandler = async (req, res) => {
    try {
        if (!fs.existsSync(conferenceDetailsFilePath)) {
            console.error('Database file not found:', conferenceDetailsFilePath);
            return res.status(404).json({ message: 'Conference data not found.' }) as any;
        }

        const rawData = fs.readFileSync(conferenceDetailsFilePath, 'utf-8');
        const conferences: ConferenceResponse[] = JSON.parse(rawData);

        // Optional: Pre-process data slightly if needed (e.g., ensure consistency)
        // For now, send the raw array
        res.status(200).json(conferences);

    } catch (error) {
        console.error('Error reading or parsing conference data:', error);
        res.status(500).json({ message: 'Internal server error while fetching visualization data.' });
    }
};