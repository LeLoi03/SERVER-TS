import fs from 'fs/promises'; // Use promises API for async/await
import { parse } from "json2csv"; // Import types if available/needed
import type { Options as Json2CsvOptions } from 'json2csv'; // Import specific type for options

import { ProcessedResponseData, InputRowData, ProcessedRowData } from './types';
import { readContentFromFile } from './11_utils'; //

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
        // 1. Sử dụng map với async callback để xử lý từng row
        const processPromises = data.map(async (row: InputRowData): Promise<ProcessedRowData | null> => {
            try {
                let fileContent: string = ""; // Nội dung đọc từ file

                // 2. Kiểm tra và đọc file từ path
                if (row.extractResponseTextPath) {
                    try {
                        fileContent = await readContentFromFile(row.extractResponseTextPath);
                    } catch (readError: unknown) {
                        const message = readError instanceof Error ? readError.message : String(readError);
                        console.error(`Error reading file ${row.extractResponseTextPath} for row: ${row.conferenceAcronym}: ${message}`);
                        // Quyết định xử lý tiếp hay bỏ qua row này.
                        // Ở đây, chúng ta tiếp tục với fileContent rỗng, JSON.parse sẽ xử lý.
                    }
                } else {
                    console.warn(`extractResponseTextPath missing for row: ${row.conferenceAcronym}`);
                    // Không có path -> không có nội dung để parse
                }

                // Process the parsed data
                let parsedTruncatedInfo: Record<string, any> = {};
                try {
                    // 3. Parse nội dung đọc được từ file (nếu có)
                    if (fileContent) { // Chỉ parse nếu có nội dung
                        // Remove control characters
                        const cleanedText = fileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

                        // Thêm kiểm tra xem cleanedText có rỗng không trước khi parse
                        if (cleanedText.trim()) {
                            parsedTruncatedInfo = JSON.parse(cleanedText);
                            // Basic check if it's an object after parsing
                            if (typeof parsedTruncatedInfo !== 'object' || parsedTruncatedInfo === null) {
                                console.warn("Parsed file content is not an object for row:", { acronym: row.conferenceAcronym, path: row.extractResponseTextPath });
                                parsedTruncatedInfo = {}; // Reset to empty object
                            }
                        } else {
                            console.warn("Cleaned file content is empty, skipping parse for row:", { acronym: row.conferenceAcronym, path: row.extractResponseTextPath });
                            // parsedTruncatedInfo vẫn là {}
                        }
                    } else {
                        // Log nếu không có nội dung để parse (do path thiếu hoặc đọc file lỗi/rỗng)
                        console.warn("No content to parse for row:", { acronym: row.conferenceAcronym, path: row.extractResponseTextPath || 'N/A' });
                    }
                } catch (parseError: unknown) {
                    const message = parseError instanceof Error ? parseError.message : String(parseError);
                    // Log lỗi kèm path và nội dung snippet
                    console.error("Error parsing JSON from file:", message, "for row:", { acronym: row.conferenceAcronym, path: row.extractResponseTextPath }, "\nContent snippet:", fileContent.substring(0, 100));
                    parsedTruncatedInfo = {}; // Ensure it's an object on error
                }

                // Process the parsed data (logic này giữ nguyên)
                const processedResponse = processResponse(parsedTruncatedInfo);
                // Construct the final row object conforming to ProcessedRowData (logic này giữ nguyên)
                const finalRow: ProcessedRowData = {
                    name: row.conferenceName || "",
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
                    ...processedResponse,
                };
                return finalRow;

            } catch (rowProcessingError: unknown) {
                const message = rowProcessingError instanceof Error ? rowProcessingError.message : String(rowProcessingError);
                console.error("Error processing row:", message, "Row Acronym:", row.conferenceAcronym);
                return null; // Skip this row on error
            }
        });


        // 4. Chờ tất cả các promise xử lý row hoàn thành
        const resolvedResults = await Promise.all(processPromises);

        // 5. Lọc bỏ các kết quả null (những row bị lỗi)
        processedData = resolvedResults.filter((row): row is ProcessedRowData => row !== null);


        // ----- Phần còn lại của việc tạo và ghi CSV giữ nguyên -----

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

        const opts: Json2CsvOptions<ProcessedRowData> = { fields };

        try {
            // Dữ liệu đầu vào cho parse giờ là processedData đã được xử lý hoàn chỉnh
            const csv = parse(processedData, opts);
            await fs.writeFile(filePath, csv, "utf8");
            console.log(`CSV file saved to: ${filePath}`);

        } catch (parseOrWriteError: unknown) {
             const message = parseOrWriteError instanceof Error ? parseOrWriteError.message : String(parseOrWriteError);
            console.error("Error parsing data to CSV or writing file:", message);
             if (parseOrWriteError instanceof Error) console.error(parseOrWriteError.stack);
             // Có thể throw lỗi ở đây nếu cần thiết
        }

        return processedData; // Return the successfully processed data

    } catch (error: unknown) { // Catch any top-level errors
        const message = error instanceof Error ? error.message : String(error);
        console.error("Fatal error in writeCSVFile:", message);
        if (error instanceof Error) console.error(error.stack);
        return []; // Trả về mảng rỗng khi có lỗi nghiêm trọng
    }
};
