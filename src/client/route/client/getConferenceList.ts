import 'dotenv/config';
import path from 'path';
import { RequestHandler } from 'express';
import fs from 'fs';


import { ConferenceListResponse } from '../../types/conference.list.response';

const userFilePath = path.resolve(__dirname, '../database/users_list.json');
const addConferencesFilePath = path.resolve(__dirname, '../database/add_conferences.json');
const conferencesListFilePath = path.resolve(__dirname, '../database/DB.json');
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json');


// 2. Lấy danh sách Conferences
export const getConferenceList: RequestHandler<any, ConferenceListResponse | { message: string }, any, any> = async (
    req,
    res
): Promise<void> => {
    try {
        const data = await fs.promises.readFile(conferencesListFilePath, 'utf-8');

        // Parse toàn bộ file JSON thành đối tượng ConferenceListResponse
        const conferenceListResponse: ConferenceListResponse = JSON.parse(data);

        // Trả về đối tượng ConferenceListResponse đã parse
        res.status(200).json(conferenceListResponse);
        return;


    } catch (error: any) {
        console.error('Error reading or processing conference data:', error);
        if (error instanceof SyntaxError) {
            res.status(500).json({ message: 'Invalid JSON format in conference-list.json' });
            return;
        } else if (error.code === 'ENOENT') {
            res.status(500).json({ message: 'conference-list.json not found' });
            return;
        } else {
            res.status(500).json({ message: 'Internal server error' });
            return;
        }
    }
};