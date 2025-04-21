import { Request, RequestHandler , Response } from 'express';
import * as fs from 'fs'
import path from 'path';
import { parse } from 'csv-parse/sync';
import { transformCsvRowToJson } from './dataTransformer';
import axios, { toFormData } from 'axios';

const csvFilePath = path.resolve(__dirname, '../../../conference/data/evaluate.csv'); // Adjust relative path

interface SaveRequestBody {
    acronym: string;
    title: string; // Include title for better matching if needed
}
export const saveCrawlConferenceFromCsvToJson:  RequestHandler = async (req, res) => {
    let { acronym } = req.body;

    if (!acronym ) {
        return res.status(400).json({ success: false, message: 'Missing acronym or title in request body.' }) as any;
    }
    let [acronym1 , title] = acronym.split('-') ;
    acronym = acronym1.trim() ;
    title = title.trim() // Extract acronym from the request body
    // Optional title for better matching
    console.log(`Received request to save conference: Acronym=${acronym}, Title=${title}`);

    try {
        // 1. Read CSV
        console.log(`Reading CSV file from: ${csvFilePath}`);
        const csvFileContent = await fs.createReadStream(csvFilePath);

        const formData = toFormData({
            file: csvFileContent,
        });
        
        const data = await axios.post('http://localhost:3000/api/v1/admin-conference/import-evaluate', formData)
        console.log('CSV data:', data.data);

        // 8. Write Updated JSON D

        // 9. Send Success Response
        return res.status(200).json({ success: true, message: `Conference ${acronym} saved successfully to JSON.` });
    } catch (error: any) {
        console.error(`Error processing save request for ${acronym}:`, error);
        return res.status(500).json({ success: false, message: `Internal server error: ${error.message}` });
    }
}