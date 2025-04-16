// src/utils/dataTransformer.ts
import { v4 as uuidv4 } from 'uuid';
import { parse as dateParse, isValid as isDateValid, formatISO } from 'date-fns'; // Using date-fns for robust parsing

interface CsvRow {
    title: string;
    acronym: string;
    link: string;
    cfpLink: string;
    impLink: string;
    conferenceDates: string;
    year: string;
    location: string; // Assuming this is the 'address' field like "Valencia, Spain"
    cityStateProvince: string;
    country: string;
    continent: string;
    type: string; // Corresponds to organization.accessType? Needs clarification. 'Offline'/'Online'/'Hybrid'
    submissionDate: string; // JSON string
    notificationDate: string; // JSON string
    cameraReadyDate: string; // JSON string
    registrationDate: string; // JSON string
    otherDate: string; // JSON string
    topics: string; // Comma-separated
    publisher: string;
    summary: string;
    callForPapers: string;
    // Add other columns if they exist in evaluate.csv
}

interface JsonDateEntry {
    id: string;
    organizedId: string;
    fromDate: string | null; // ISO String
    toDate: string | null; // ISO String
    type: 'conferenceDates' | 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate';
    name: string; // e.g., "Conference", "Paper Submission", "Registration"
    createdAt: string; // ISO String
    updatedAt: string; // ISO String
    isAvailable: boolean;
}

interface TransformedJson {
    conference: {
        id: string;
        title: string;
        acronym: string;
        creatorId: string | null; // Placeholder
        createdAt: string; // ISO String
        updatedAt: string; // ISO String
    };
    organization: {
        id: string;
        year: number | null;
        accessType: string; // Map from CsvRow.type
        isAvailable: boolean;
        conferenceId: string;
        publisher: string | null;
        summerize: string | null; // Note: field name typo in example, using 'summerize'
        callForPaper: string | null; // Note: field name typo in example, using 'callForPaper'
        link: string | null;
        cfpLink: string | null;
        impLink: string | null;
        createdAt: string; // ISO String
        updatedAt: string; // ISO String
        topics: string[];
    };
    location: {
        id: string;
        createdAt: string; // ISO String
        updatedAt: string; // ISO String
        isAvailable: boolean;
        organizeId: string; // organization id
        cityStateProvince: string | null;
        country: string | null;
        address: string | null; // Use CsvRow.location here
        continent: string | null;
    };
    dates: JsonDateEntry[];
    ranks: any[]; // Placeholder
    followedBy: any[]; // Placeholder
    feedBacks: any[]; // Placeholder
}

// Helper to parse date strings like "Month Day, Year" or ranges
// Returns [Date | null, Date | null]
function parseDateRange(dateString: string, year: number): [Date | null, Date | null] {
    if (!dateString || dateString.toLowerCase() === 'none' || dateString.toLowerCase() === 'n/a') {
        return [null, null];
    }
    dateString = dateString.trim();
    const yearStr = year.toString(); // Ensure year is part of the string for parsing consistency

    try {
         // Handle ranges like "Month Day - Day, Year" -> "Month Day, Year" and "Month Day, Year"
         if (dateString.includes(' - ') && dateString.includes(',')) {
            const parts = dateString.split(' - ');
            const datePart1 = parts[0].trim();
            const datePart2 = parts[1].trim();
            let fromDateStr = datePart1;
            let toDateStr = datePart2;

            // Check if year is only in the second part: "Month Day - Month Day, Year"
            if (!datePart1.includes(',')) {
                 fromDateStr = `${datePart1}, ${yearStr}`; // Add year if missing
            }
             // Check if month is only in the first part: "Month Day - Day, Year"
             if (!datePart2.match(/[a-zA-Z]/) && datePart1.match(/[a-zA-Z]/)) {
                 const month = datePart1.split(' ')[0];
                 toDateStr = `${month} ${datePart2}`;
             }
             // Add year to second part if missing comma: "Month Day, Year - Month Day"
             if(!datePart2.includes(',')){
                 toDateStr = `${toDateStr}, ${yearStr}`
             }


             const fromDate = dateParse(fromDateStr, 'MMMM d, yyyy', new Date());
             const toDate = dateParse(toDateStr, 'MMMM d, yyyy', new Date());


            return [isDateValid(fromDate) ? fromDate : null, isDateValid(toDate) ? toDate : null];
         }
         // Handle single date: "Month Day, Year"
         else {
             const fullDateStr = dateString.includes(',') ? dateString : `${dateString}, ${yearStr}`;
             const date = dateParse(fullDateStr, 'MMMM d, yyyy', new Date());
             return [isDateValid(date) ? date : null, isDateValid(date) ? date : null]; // Single date means fromDate === toDate
         }
    } catch (e) {
        console.warn(`Could not parse date range: "${dateString}"`, e);
        return [null, null];
    }
}

// Helper to parse JSON date objects like {"Name": "Date String"}
function parseJsonDates(jsonString: string | undefined | null, type: JsonDateEntry['type'], organizedId: string, year: number): JsonDateEntry[] {
    if (!jsonString) return [];
    const entries: JsonDateEntry[] = [];
    try {
        const parsed = JSON.parse(jsonString);
        if (typeof parsed !== 'object' || parsed === null) return [];

        for (const name in parsed) {
            if (Object.prototype.hasOwnProperty.call(parsed, name)) {
                const dateValue = parsed[name];
                if (typeof dateValue === 'string') {
                    const [fromDate, toDate] = parseDateRange(dateValue, year); // Use year from CSV
                     const now = new Date().toISOString();
                     entries.push({
                         id: uuidv4(),
                         organizedId: organizedId,
                         fromDate: fromDate ? formatISO(fromDate) : null,
                         toDate: toDate ? formatISO(toDate) : null, // Use fromDate if toDate is null for single dates
                         type: type,
                         name: name, // Key from the JSON object
                         createdAt: now,
                         updatedAt: now,
                         isAvailable: true,
                     });
                }
            }
        }
    } catch (e) {
        console.warn(`Could not parse JSON dates for type ${type}: "${jsonString}"`, e);
    }
    return entries;
}

// Main transformation function
export function transformCsvRowToJson(row: CsvRow): TransformedJson | null {
    try {
        const now = new Date().toISOString();
        const conferenceId = uuidv4();
        const organizationId = uuidv4();
        const locationId = uuidv4();
        const currentYear = parseInt(row.year, 10) || new Date().getFullYear(); // Fallback to current year

         // Map CSV type to AccessType (example mapping, adjust as needed)
        let accessType = "Unknown";
        const csvTypeLower = row.type?.toLowerCase();
        if (csvTypeLower?.includes("offline") || csvTypeLower?.includes("physical")) accessType = "Offline";
        else if (csvTypeLower?.includes("online") || csvTypeLower?.includes("virtual")) accessType = "Online";
        else if (csvTypeLower?.includes("hybrid")) accessType = "Hybrid";


        // --- Parse Conference Dates ---
        const [confFromDate, confToDate] = parseDateRange(row.conferenceDates, currentYear);
         const conferenceDateEntry: JsonDateEntry | null = confFromDate ? {
             id: uuidv4(),
             organizedId: organizationId,
             fromDate: formatISO(confFromDate),
             toDate: confToDate ? formatISO(confToDate) : formatISO(confFromDate), // Use from if to is null
             type: 'conferenceDates',
             name: 'Conference',
             createdAt: now,
             updatedAt: now,
             isAvailable: true,
         } : null;


        // --- Parse Other Dates from JSON ---
        const submissionDates = parseJsonDates(row.submissionDate, 'submissionDate', organizationId, currentYear);
        const notificationDates = parseJsonDates(row.notificationDate, 'notificationDate', organizationId, currentYear);
        const cameraReadyDates = parseJsonDates(row.cameraReadyDate, 'cameraReadyDate', organizationId, currentYear);
        const registrationDates = parseJsonDates(row.registrationDate, 'registrationDate', organizationId, currentYear);
        const otherDates = parseJsonDates(row.otherDate, 'otherDate', organizationId, currentYear);

         const allDates = [
             ...(conferenceDateEntry ? [conferenceDateEntry] : []), // Add conference date if valid
             ...submissionDates,
             ...notificationDates,
             ...cameraReadyDates,
             ...registrationDates,
             ...otherDates
         ];


        return {
            conference: {
                id: conferenceId,
                title: row.title?.trim() ?? 'N/A',
                acronym: row.acronym?.trim() ?? 'N/A',
                creatorId: null, // Or fetch from user session if available
                createdAt: now,
                updatedAt: now,
            },
            organization: {
                id: organizationId,
                year: currentYear,
                accessType: accessType,
                isAvailable: true,
                conferenceId: conferenceId,
                publisher: row.publisher?.trim() || null,
                summerize: row.summary?.trim() || null,
                callForPaper: row.callForPapers?.trim() || null,
                link: row.link?.trim() || null,
                cfpLink: row.cfpLink?.trim() || null,
                impLink: row.impLink?.trim() || null,
                createdAt: now,
                updatedAt: now,
                topics: row.topics ? row.topics.split(',').map(t => t.trim()).filter(t => t) : [],
            },
            location: {
                id: locationId,
                createdAt: now,
                updatedAt: now,
                isAvailable: true,
                organizeId: organizationId,
                cityStateProvince: row.cityStateProvince?.trim() || null,
                country: row.country?.trim() || null,
                address: row.location?.trim() || null, // Use the 'location' column from CSV
                continent: row.continent?.trim() || null,
            },
            dates: allDates.filter(d => d.fromDate), // Only include dates that were successfully parsed
            ranks: [],
            followedBy: [],
            feedBacks: [],
        };
    } catch (error) {
        console.error(`Error transforming CSV row for ${row.acronym}:`, error);
        return null;
    }
}