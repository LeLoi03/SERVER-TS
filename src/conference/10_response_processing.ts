import fs from 'fs/promises'; // Use promises API for async/await
import { parse } from "json2csv"; // Import types if available/needed
import type { Options as Json2CsvOptions } from 'json2csv'; // Import specific type for options

import { ProcessedResponseData, InputRowData, ProcessedRowData } from './types';


// --- Helper Functions ---

// Convert a string to camelCase
function toCamelCase(str: string): string {
    if (!str) return ""; // Handle empty or nullish input
    try {
        // Keep the original logic, but ensure input is treated as string
        return String(str).replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (match, index) => {
            // Explicitly check match type if needed, but JS coercion usually handles it
            if (+match === 0) return ""; // Check for whitespace converted to 0
            return index === 0 ? match.toLowerCase() : match.toUpperCase();
        }).replace(/[^a-zA-Z0-9]+/g, ''); // Remove non-alphanumeric characters
    } catch (camelCaseError: unknown) { // Catch as unknown
        const message = camelCaseError instanceof Error ? camelCaseError.message : String(camelCaseError);
        console.error("Error converting to camelCase:", message, "Input string:", str);
        return ""; // Or some other default value
    }
}

// --- Main Functions ---

// Type guard to check if a key is a valid date detail key
function isDateDetailKey(key: string): key is keyof Pick<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate'> {
    return ["submissionDate", "notificationDate", "cameraReadyDate", "registrationDate", "otherDate"].includes(key);
}

// Type guard to check if a key is a direct string property key
function isDirectStringKey(key: string): key is keyof Omit<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate' | 'information'> {
     return ["conferenceDates", "year", "location", "cityStateProvince", "country", "continent", "type", "topics", "publisher", "summary", "callForPapers"].includes(key);
}


// Hàm xử lý dữ liệu "response"
export const processResponse = (response: Record<string, any> | null | undefined): ProcessedResponseData => {
    // Initialize with default values matching the interface
    const result: ProcessedResponseData = {
        conferenceDates: "",
        year: "",
        location: "",
        cityStateProvince: "",
        country: "",
        continent: "",
        type: "",
        submissionDate: {},
        notificationDate: {},
        cameraReadyDate: {},
        registrationDate: {},
        otherDate: {},
        topics: "",
        publisher: "",
        summary: "",
        callForPapers: "",
        information: ""
    };

    if (!response) return result; // Return default if input is null or undefined

    try {
        for (const key in response) {
            // Use hasOwnProperty for safe iteration
            if (Object.prototype.hasOwnProperty.call(response, key)) {
                try {
                    const value = response[key];
                    const camelCaseKey = toCamelCase(key);

                    // Check if it's a non-null, non-array object (for date groups)
                    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                        if (isDateDetailKey(camelCaseKey)) {
                            // Handle nested date objects safely
                            result[camelCaseKey] = {}; // Initialize the date detail object
                            for (const subKey in value) {
                                if (Object.prototype.hasOwnProperty.call(value, subKey)) {
                                    try {
                                        // Ensure value[subKey] is treated as string
                                        const subValue = String(value[subKey] ?? ''); // Default to empty string if null/undefined
                                        result[camelCaseKey][subKey] = subValue;
                                        // Append to information string
                                        result.information += `${subKey}: ${subValue}\n`;
                                    } catch (subKeyError: unknown) {
                                        const message = subKeyError instanceof Error ? subKeyError.message : String(subKeyError);
                                        console.error("Error processing subkey:", message, "Key:", subKey, "Value:", value[subKey]);
                                    }
                                }
                            }
                        } else {
                            // Handle other nested objects (just add to information)
                            try {
                                result.information += `${key}: ${JSON.stringify(value)}\n`;
                            } catch (stringifyError: unknown) {
                                const message = stringifyError instanceof Error ? stringifyError.message : String(stringifyError);
                                console.error("Error stringifying nested object:", message, "Key:", key, "Value:", value);
                            }
                        }
                    } else {
                        // Handle primitive values and arrays (treat as string)
                         const stringValue = String(value ?? ''); // Convert value to string, handle null/undefined

                        if (isDirectStringKey(camelCaseKey)) {
                             result[camelCaseKey] = stringValue;
                             // Append to information if not summary or callForPapers
                             if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
                                 result.information += `${key}: ${stringValue}\n`;
                             }
                        } else {
                            // Handle any other keys not explicitly matched (like potential future fields)
                             if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
                                result.information += `${key}: ${stringValue}\n`;
                            }
                        }
                    }
                } catch (valueProcessingError: unknown) {
                     const message = valueProcessingError instanceof Error ? valueProcessingError.message : String(valueProcessingError);
                    console.error("Error processing value for key:", key, message);
                }
            }
        }
        result.information = result.information.trim(); // Remove trailing newline
    } catch (responseProcessingError: unknown) {
         const message = responseProcessingError instanceof Error ? responseProcessingError.message : String(responseProcessingError);
        console.error("Error in processResponse:", message);
        if (responseProcessingError instanceof Error) console.error(responseProcessingError.stack);
        // Return the partially processed result object on error
    }
    return result;
};

// Hàm ghi dữ liệu vào file CSV - Now async
export const writeCSVFile = async (filePath: string, data: InputRowData[]): Promise<ProcessedRowData[]> => {
    let processedData: ProcessedRowData[] = []; // Initialize with correct type

    try {
        // Use map and filter, ensuring type safety
        processedData = data.map((row: InputRowData): ProcessedRowData | null => { // Explicitly type map callback return
            try {
                let parsedTruncatedInfo: Record<string, any> = {}; // Keep as Record<string, any> or define more strictly if possible
                try {
                    if (row.extractResponseText && typeof row.extractResponseText === 'string') {
                        // Remove control characters
                        const cleanedText = row.extractResponseText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
                        parsedTruncatedInfo = JSON.parse(cleanedText);
                         // Basic check if it's an object after parsing
                         if (typeof parsedTruncatedInfo !== 'object' || parsedTruncatedInfo === null) {
                            console.warn("Parsed extractResponseText is not an object for row:", row, "\nContent:", row.extractResponseText);
                            parsedTruncatedInfo = {}; // Reset to empty object
                         }
                    } else {
                         console.warn("extractResponseText missing or not a string for row:", row)
                    }
                } catch (parseError: unknown) {
                     const message = parseError instanceof Error ? parseError.message : String(parseError);
                    console.error("Error parsing extractResponseText JSON:", message, "for row:", /* Consider logging less verbose row info */ { acronym: row.conferenceAcronym, link: row.conferenceLink }, "\nContent snippet:", row.extractResponseText?.substring(0, 100));
                    parsedTruncatedInfo = {}; // Ensure it's an object on error
                }

                // Process the parsed data
                const processedResponse = processResponse(parsedTruncatedInfo);

                // Construct the final row object conforming to ProcessedRowData
                const finalRow: ProcessedRowData = {
                    // Fields from InputRowData (provide defaults)
                    name: row.conferenceName || "",
                    // Handle potential _diff suffix
                    acronym: (row.conferenceAcronym || "").split("_diff")[0],
                    rank: row.conferenceRank || "",
                    rating: row.conferenceRating || "",
                    dblp: row.conferenceDBLP || "",
                    note: row.conferenceNote || "",
                    comments: row.conferenceComments || "",
                    fieldOfResearch: row.conferencePrimaryFoR || "",
                    source: row.conferenceSource || "",
                    link: row.conferenceLink || "",
                    cfpLink: row.cfpLink || "",
                    impLink: row.impLink || "",
                    // Spread the processed data (already matches part of ProcessedRowData)
                    ...processedResponse,
                    // Ensure 'information' from processedResponse is included (it's part of the spread)
                };
                return finalRow;

            } catch (rowProcessingError: unknown) {
                 const message = rowProcessingError instanceof Error ? rowProcessingError.message : String(rowProcessingError);
                console.error("Error processing row:", message, "Row Acronym:", row.conferenceAcronym);
                return null; // Skip this row on error
            }
        }).filter((row): row is ProcessedRowData => row !== null); // Type predicate to filter out nulls


        // Define fields for CSV header and ordering
        // Ensure these fields match the keys in ProcessedRowData
        const fields: (keyof ProcessedRowData)[] = [
            "name", "acronym", "link", "cfpLink", "impLink", "source", "rank",
            "rating", "fieldOfResearch", "information", "conferenceDates", "year",
            "location", "cityStateProvince", "country", "continent", "type",
            // Note: Date objects need special handling if not just strings
            "submissionDate", "notificationDate", "cameraReadyDate", "registrationDate",
            "otherDate", "topics", "publisher", "summary", "callForPapers"
        ];

        // Define options for json2csv parser
        const opts: Json2CsvOptions<ProcessedRowData> = { fields };

        try {
            const csv = parse(processedData, opts);

            // Use async writeFile
            await fs.writeFile(filePath, csv, "utf8");
            console.log(`CSV file saved to: ${filePath}`);

        } catch (parseOrWriteError: unknown) { // Catch errors from parse or writeFile
             const message = parseOrWriteError instanceof Error ? parseOrWriteError.message : String(parseOrWriteError);
            console.error("Error parsing data to CSV or writing file:", message);
             if (parseOrWriteError instanceof Error) console.error(parseOrWriteError.stack);
            // Don't write a partial/corrupt CSV. Rethrow or handle as needed.
            // Depending on requirements, you might want to throw here to signal failure
             // throw parseOrWriteError;
        }

        return processedData; // Return the successfully processed data

    } catch (error: unknown) { // Catch any top-level errors
        const message = error instanceof Error ? error.message : String(error);
        console.error("Fatal error in writeCSVFile:", message);
        if (error instanceof Error) console.error(error.stack);
        // Decide return value on fatal error: empty array or throw
        return []; // Return empty array as a fallback
        // Or rethrow: throw error;
    }
};

// Export writeCSVFile as the default export if needed (or keep named exports)
// export default writeCSVFile;