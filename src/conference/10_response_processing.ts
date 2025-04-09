import fs from 'fs';
import fsp from 'fs/promises';
import readline from 'readline';
// *** SỬA IMPORT: Sử dụng 'Transform' được export từ thư viện ***
import { ParserOptions, Transform as Json2CsvTransform } from '@json2csv/node';
// Vẫn cần các kiểu stream gốc
import { Readable, Transform as NodeTransform, TransformOptions } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import path from 'path';

import { logger } from './11_utils';
import { ProcessedResponseData, InputRowData, ProcessedRowData } from './types';
import { readContentFromFile } from './11_utils';

// --- Helper Functions (toCamelCase, isDateDetailKey, isDirectStringKey) ---
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
function isDateDetailKey(key: string): key is keyof Pick<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate'> {
    return ["submissionDate", "notificationDate", "cameraReadyDate", "registrationDate", "otherDate"].includes(key);
}
function isDirectStringKey(key: string): key is keyof Omit<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate' | 'information'> {
    return ["conferenceDates", "year", "location", "cityStateProvince", "country", "continent", "type", "topics", "publisher", "summary", "callForPapers"].includes(key);
}

// --- Main Functions (processResponse) ---
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
                            // Append to information string, avoiding summary/callForPapers
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


// --- Định nghĩa các trường cho CSV ---
const CSV_FIELDS: (keyof ProcessedRowData | { label: string; value: keyof ProcessedRowData })[] = [
    "title", "acronym", "link", "cfpLink", "impLink",
    // "source", "rank", "rating", "fieldOfResearch",
    // 'determineLinks', // Object phức tạp, cân nhắc cách thể hiện trong CSV hoặc bỏ qua
    "information", "conferenceDates", "year",
    "location", "cityStateProvince", "country", "continent", "type",
    "submissionDate", "notificationDate", "cameraReadyDate", "registrationDate",
    "otherDate", "topics", "publisher", "summary", "callForPapers"
    // Thêm hoặc bớt trường nếu cần
];

// --- Hàm xử lý từng dòng JSONL và tạo ProcessedRowData ---
async function* processJsonlStream(jsonlFilePath: string, parentLogger: typeof logger): AsyncGenerator<ProcessedRowData | null> { // Return null on error/skip
    const fileStream = fs.createReadStream(jsonlFilePath);
    const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
    });
    const logContextBase = { file: path.basename(jsonlFilePath), function: 'processJsonlStream' };

    let lineNumber = 0;
    for await (const line of rl) {
        lineNumber++;
        const logContext = { ...logContextBase, lineNumber };
        if (!line.trim()) {
            // parentLogger.info({ ...logContext, event: 'skipping_empty_line' });
            continue;
        }

        let inputRow: InputRowData | null = null;
        try {
            inputRow = JSON.parse(line) as InputRowData;
        } catch (parseError: any) {
            parentLogger.error({ ...logContext, err: parseError, lineContentSubstring: line.substring(0, 100), event: 'jsonl_parse_error' }, "Failed to parse line in JSONL file");
            yield null; // Yield null to indicate an error/skip for this line
            continue;
        }

        if (!inputRow) {
            parentLogger.warn({ ...logContext, event: 'jsonl_empty_row_after_parse' }, "Parsed line resulted in null/undefined data");
             yield null; // Yield null
            continue;
        }

        // --- Đọc và xử lý nội dung file text ---
        let determineFileContent: string = "";
        let extractFileContent: string = "";
        let parsedTruncatedInfo: Record<string, any> = {};
        let parsedDetermineInfo: Record<string, any> = {};

        try {
            // Đọc determine file
            if (inputRow.determineResponseTextPath) {
                try {
                    determineFileContent = await readContentFromFile(inputRow.determineResponseTextPath);
                    const cleaned = determineFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                    if (cleaned) {
                         parsedDetermineInfo = JSON.parse(cleaned);
                         if (typeof parsedDetermineInfo !== 'object' || parsedDetermineInfo === null) parsedDetermineInfo = {};
                    } else parsedDetermineInfo = {};
                } catch (readOrParseError: any) {
                    parentLogger.warn({ ...logContext, err: readOrParseError, path: inputRow.determineResponseTextPath, type: 'determine', event: 'file_read_parse_warn' }, `Warning reading/parsing determine file for row ${inputRow.conferenceAcronym}`);
                    parsedDetermineInfo = {};
                }
            } else {
                parsedDetermineInfo = {};
            }

            // Đọc extract file
            if (inputRow.extractResponseTextPath) {
                try {
                    extractFileContent = await readContentFromFile(inputRow.extractResponseTextPath);
                     const cleaned = extractFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                    if (cleaned) {
                        parsedTruncatedInfo = JSON.parse(cleaned);
                         if (typeof parsedTruncatedInfo !== 'object' || parsedTruncatedInfo === null) parsedTruncatedInfo = {};
                    } else parsedTruncatedInfo = {};
                } catch (readOrParseError: any) {
                    parentLogger.warn({ ...logContext, err: readOrParseError, path: inputRow.extractResponseTextPath, type: 'extract', event: 'file_read_parse_warn' }, `Warning reading/parsing extract file for row ${inputRow.conferenceAcronym}`);
                    parsedTruncatedInfo = {};
                }
            } else {
                parsedTruncatedInfo = {};
            }

            const processedResponse = processResponse(parsedTruncatedInfo);

            const finalRow: ProcessedRowData = {
                title: inputRow.conferenceTitle || "",
                acronym: (inputRow.conferenceAcronym || "").replace(/_\d+$/, ''),
                link: inputRow.conferenceLink || "",
                cfpLink: inputRow.cfpLink || "",
                impLink: inputRow.impLink || "",
                determineLinks: parsedDetermineInfo,
                ...processedResponse,
            };

            yield finalRow;

        } catch (rowProcessingError: any) {
            parentLogger.error({ ...logContext, err: rowProcessingError, acronym: inputRow?.conferenceAcronym, event: 'row_processing_error' }, "Error processing row data");
             yield null; // Yield null on processing error
        }
    }
    parentLogger.info({ ...logContextBase, totalLines: lineNumber, event: 'jsonl_processing_finished' }, 'Finished processing JSONL file stream');
}


// --- Hàm chính để ghi CSV bằng Stream ---
export const writeCSVStream = async (
    jsonlFilePath: string,
    csvFilePath: string,
    parentLogger: typeof logger,
): Promise<void> => {
    const logContext = { jsonlInput: jsonlFilePath, csvOutput: csvFilePath, function: 'writeCSVStream' };
    parentLogger.info({ ...logContext, event: 'csv_stream_start' }, 'Starting CSV writing stream');

    // --- FIX: Assign the function directly ---
    const processorGenerator = processJsonlStream;

    let rowObjectStream: Readable | null = null;
    let filterTransform: NodeTransform | null = null;
    let csvTransform: Json2CsvTransform<ProcessedRowData, ProcessedRowData> | null = null;
    let csvWriteStream: fs.WriteStream | null = null;

    try {
        // 1. Create source stream from the JSONL processing generator
        // Now processorGenerator *is* the function, so this call is valid
        rowObjectStream = Readable.from(processorGenerator(jsonlFilePath, parentLogger));
        // Simple check (though Readable.from should handle async iterators fine)
        if (!rowObjectStream || typeof rowObjectStream.pipe !== 'function') {
             throw new Error('Failed to create Readable stream from generator.');
        }

        // 2. Create a transform stream to filter out null values (yielded on errors/skips)
        filterTransform = new NodeTransform({
            objectMode: true,
            transform(chunk: ProcessedRowData | null, encoding, callback) {
                if (chunk !== null) { // Only pass non-null objects
                    this.push(chunk);
                }
                callback();
            }
        });
         if (!filterTransform || typeof filterTransform.pipe !== 'function') throw new Error('Invalid filterTransform');


        // 3. Set up the CSV parser options
        // Make sure CSV_FIELDS aligns with ProcessedRowData properties
        const csvOptions: ParserOptions<ProcessedRowData, ProcessedRowData> = { fields: CSV_FIELDS };
        const transformOpts: TransformOptions = { objectMode: true };
        const asyncOpts = {}; // Keep empty if no async specific options needed for json2csv


        // 4. Create instance of the json2csv Transform stream
        csvTransform = new Json2CsvTransform(csvOptions, asyncOpts, transformOpts);
        if (!csvTransform || typeof csvTransform.pipe !== 'function') {
            throw new Error('Failed to create Json2CsvTransform or it is not a valid stream.');
        }

        // 5. Create the destination stream to write the CSV file
        csvWriteStream = fs.createWriteStream(csvFilePath);
         if (!csvWriteStream || typeof csvWriteStream.on !== 'function') throw new Error('Invalid csvWriteStream');

        // 6. Use pipeline
        parentLogger.info({ ...logContext, event: 'pipeline_starting' }, 'Calling streamPipeline...');
        await streamPipeline(
            rowObjectStream,
            filterTransform, // Filter out nulls first
            csvTransform,
            csvWriteStream
        );

        parentLogger.info({ ...logContext, event: 'csv_stream_success' }, 'CSV writing stream finished successfully.');

    } catch (error: any) {
        parentLogger.error({
            ...logContext,
            streamStatus: {
                rowObjectStreamExists: !!rowObjectStream,
                filterTransformExists: !!filterTransform,
                csvTransformInstanceExists: !!csvTransform,
                csvWriteStreamExists: !!csvWriteStream,
            },
            err: { message: error.message, stack: error.stack, code: error.code, type: error.constructor.name },
            event: 'csv_stream_failed'
        }, 'Error during CSV writing stream pipeline');
        // Clean up streams if pipeline failed partially (though promisified pipeline often handles this)
        rowObjectStream?.destroy();
        filterTransform?.destroy();
        csvTransform?.destroy();
        csvWriteStream?.destroy(error); // Signal error during destruction
        throw error; // Re-throw the error
    }
};