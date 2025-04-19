import { Request, RequestHandler , Response } from 'express';
import fs from 'fs/promises'; // Use promise-based fs
import path from 'path';
import { parse } from 'csv-parse/sync';
import { transformCsvRowToJson } from './dataTransformer'; // Adjust path

const csvFilePath = path.resolve(__dirname, '../conference/data/evaluate.csv'); // Adjust relative path
const conferenceDetailsFilePath = path.resolve(__dirname, '../database/DB_details.json'); // Adjust relative path

interface SaveRequestBody {
    acronym: string;
    title: string; // Include title for better matching if needed
}


export const saveCrawlConferenceFromCsvToJson:  RequestHandler = async (req, res) => {
    console.log('Received request to save conference from CSV to JSON.');
    console.log(`Request body: ${JSON.stringify(req)}`);
    return req.body;
    let { acronym } = req.body;

    if (!acronym ) {
        return res.status(400).json({ success: false, message: 'Missing acronym or title in request body.' }) as any;
    }
    acronym = acronym.split('-')[0].trim() ;
    const title = acronym.split('-')[1]?.trim() || ''; // Optional title for better matching
    // Optional title for better matching
    console.log(`Received request to save conference: Acronym=${acronym}, Title=${title}`);


    try {
        // 1. Read CSV
        console.log(`Reading CSV file from: ${csvFilePath}`);
        const csvFileContent = await fs.readFile(csvFilePath, { encoding: 'utf8' });

        // 2. Parse CSV
        // Adjust columns based on your ACTUAL evaluate.csv header order or use columns: true
         const records: Record<string, string>[] = parse(csvFileContent, {
             columns: true, // Assume first row is header
             skip_empty_lines: true,
             trim: true,
             relax_column_count: true, // Allow varying column counts
         });
         console.log(`Parsed ${records.length} records from CSV.`);


        // 3. Find Matching Row
        // Matching logic might need refinement (case-insensitivity, partial match?)
         const matchingRow = records.find(record =>
             record.acronym?.trim().toLowerCase() === acronym.trim().toLowerCase() &&
             record.title?.trim().toLowerCase() === title.trim().toLowerCase() // Optional: match title too
         );


        if (!matchingRow) {
            console.log(`No matching conference found in CSV for Acronym=${acronym}, Title=${title}`);
            return res.status(404).json({ success: false, message: `Conference with Acronym '${acronym}' not found in source CSV.` });
        }
         console.log(`Found matching row for ${acronym}.`);

        // 4. Transform Data
        // Make sure CsvRow interface matches the keys from `columns: true` parsing
         const transformedData = transformCsvRowToJson(matchingRow as any); // Cast if necessary, ensure keys match CsvRow

         if (!transformedData) {
             console.error(`Failed to transform data for ${acronym}.`);
             return res.status(500).json({ success: false, message: `Error transforming data for ${acronym}. Check backend logs.` });
         }
          console.log(`Successfully transformed data for ${acronym}.`);


        // 5. Read Existing JSON DB
         let existingData: any[] = [];
         try {
             console.log(`Reading existing JSON DB from: ${conferenceDetailsFilePath}`);
             const jsonFileContent = await fs.readFile(conferenceDetailsFilePath, { encoding: 'utf8' });
              // Handle empty file or invalid JSON
             if (jsonFileContent.trim()) {
                  existingData = JSON.parse(jsonFileContent);
                  if (!Array.isArray(existingData)) {
                     console.warn(`Existing JSON file content is not an array. Initializing as empty array.`);
                     existingData = [];
                 }
             } else {
                  console.log(`JSON DB file is empty. Initializing as empty array.`);
                  existingData = [];
             }


         } catch (error: any) {
             if (error.code === 'ENOENT') {
                 console.log('JSON DB file not found. Creating a new one.');
                 existingData = []; // File doesn't exist, start with empty array
             } else {
                  console.error('Error reading or parsing existing JSON DB:', error);
                  return res.status(500).json({ success: false, message: 'Error reading existing data file.' });
             }
         }
          console.log(`Found ${existingData.length} existing entries in JSON DB.`);

        // 6. Check for Duplicates (Example: check by acronym)
         const alreadyExists = existingData.some(entry => entry?.conference?.acronym?.trim().toLowerCase() === acronym.trim().toLowerCase());

         if (alreadyExists) {
             console.log(`Conference ${acronym} already exists in JSON DB. Skipping.`);
             // Optionally update existing entry here if needed
             return res.status(200).json({ success: true, message: `Conference ${acronym} already exists. No changes made.` });
         }

        // 7. Append New Data
        existingData.push(transformedData);
        console.log(`Added ${acronym} to data. Total entries now: ${existingData.length}`);


        // 8. Write Updated JSON DB
        await fs.writeFile(conferenceDetailsFilePath, JSON.stringify(existingData, null, 2), { encoding: 'utf8' });
         console.log(`Successfully wrote updated data back to ${conferenceDetailsFilePath}`);

        // 9. Send Success Response
        return res.status(200).json({ success: true, message: `Conference ${acronym} saved successfully to JSON.` });

    } catch (error: any) {
        console.error(`Error processing save request for ${acronym}:`, error);
        return res.status(500).json({ success: false, message: `Internal server error: ${error.message}` });
    }
}