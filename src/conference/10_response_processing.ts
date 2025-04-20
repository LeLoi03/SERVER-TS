import fs from 'fs';
import readline from 'readline';
import { ParserOptions, Transform as Json2CsvTransform } from '@json2csv/node';
import { Readable, Transform as NodeTransform, TransformOptions } from 'stream';
import { pipeline as streamPipeline } from 'stream/promises';
import path from 'path';

import { logger } from './11_utils';
import { ProcessedResponseData, InputRowData, ProcessedRowData } from './types';
import { readContentFromFile } from './11_utils';

// --- Constants for Validation ---
// NOTE: Adjust this list based on the exact valid continent names you expect/use.
const VALID_CONTINENTS = new Set(['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica']);
const VALID_TYPES = new Set(['Hybrid', 'Online', 'Offline']);
const YEAR_REGEX = /^\d{4}$/; // Simple check for 4 digits


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

// --- Main Functions ---
export const processResponse = (response: Record<string, any> | null | undefined): ProcessedResponseData => {
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
    // 'determineLinks', // Consider flattening or omitting
    "information", "conferenceDates", "year",
    "location", "cityStateProvince", "country", "continent", "type",
    "submissionDate", "notificationDate", "cameraReadyDate", "registrationDate",
    "otherDate", "topics", "publisher", "summary", "callForPapers"
];

// --- Hàm xử lý từng dòng JSONL và tạo ProcessedRowData ---
async function* processJsonlStream(jsonlFilePath: string, parentLogger: typeof logger): AsyncGenerator<ProcessedRowData | null> {
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
            continue;
        }

        let inputRow: InputRowData | null = null;
        let acronym: string | undefined = undefined;
        let title: string | undefined = undefined;

        try {
            inputRow = JSON.parse(line) as InputRowData;
            acronym = inputRow?.conferenceAcronym;
            title = inputRow?.conferenceTitle;
        } catch (parseError: any) {
            parentLogger.error({
                ...logContext,
                err: parseError,
                lineContentSubstring: line.substring(0, 100),
                event: 'jsonl_parse_error'
            }, "Failed to parse line in JSONL file");
            yield null;
            continue;
        }

        const rowLogContext = { ...logContext, acronym, title }; // Base context for this row

        if (!inputRow || !acronym || !title) {
            parentLogger.warn({
                ...rowLogContext,
                event: 'jsonl_missing_core_data',
                hasInputRow: !!inputRow,
                hasAcronym: !!acronym,
                hasTitle: !!title
            }, "Parsed line missing essential data (row/acronym/title)");
            yield null;
            continue;
        }

        let determineFileContent: string = "";
        let extractFileContent: string = "";
        let parsedTruncatedInfo: Record<string, any> = {};
        let parsedDetermineInfo: Record<string, any> = {};

        try {
            if (inputRow.determineResponseTextPath) {
                try {
                    determineFileContent = await readContentFromFile(inputRow.determineResponseTextPath);
                    const cleaned = determineFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                    parsedDetermineInfo = cleaned ? JSON.parse(cleaned) : {};
                    if (typeof parsedDetermineInfo !== 'object' || parsedDetermineInfo === null) parsedDetermineInfo = {};
                } catch (readOrParseError: any) {
                    parentLogger.warn({ ...rowLogContext, err: readOrParseError, path: inputRow.determineResponseTextPath, type: 'determine', event: 'file_read_parse_warn' }, `Warning reading/parsing determine file`);
                    parsedDetermineInfo = {};
                }
            } else {
                parsedDetermineInfo = {};
            }

            if (inputRow.extractResponseTextPath) {
                try {
                    extractFileContent = await readContentFromFile(inputRow.extractResponseTextPath);
                    const cleaned = extractFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
                    parsedTruncatedInfo = cleaned ? JSON.parse(cleaned) : {};
                    if (typeof parsedTruncatedInfo !== 'object' || parsedTruncatedInfo === null) parsedTruncatedInfo = {};
                } catch (readOrParseError: any) {
                    parentLogger.warn({ ...rowLogContext, err: readOrParseError, path: inputRow.extractResponseTextPath, type: 'extract', event: 'file_read_parse_warn' }, `Warning reading/parsing extract file`);
                    parsedTruncatedInfo = {};
                }
            } else {
                parsedTruncatedInfo = {};
            }

            // --- Process the parsed data ---
            const processedResponse = processResponse(parsedTruncatedInfo);

            const finalRow: ProcessedRowData = {
                title: title,
                acronym: acronym.replace(/_\d+$/, ''),
                link: inputRow.conferenceLink || "",
                cfpLink: inputRow.cfpLink || "",
                impLink: inputRow.impLink || "",
                determineLinks: parsedDetermineInfo,
                ...processedResponse,
            };

            // ************************************************
            // *** START: VALIDATION & NORMALIZATION LOGIC ***
            // ************************************************
            const validationLogContext = { ...rowLogContext }; // Use row context for validation logs

            // --- Continent Validation & Normalization ---
            const originalContinent = finalRow.continent?.trim();
            if (!originalContinent) {
                finalRow.continent = "No continent";
                // Optional: Log normalization of empty value if needed for tracking
                // parentLogger.trace({ ...validationLogContext, event: 'normalization_applied', field: 'continent', reason: 'empty_value' }, `Normalized empty continent`);
            } else if (!VALID_CONTINENTS.has(originalContinent)) {
                parentLogger.info({ // Log as info since we are normalizing
                    ...validationLogContext,
                    event: 'validation_warning',
                    field: 'continent',
                    invalidValue: originalContinent,
                    action: 'normalized',
                    normalizedTo: 'No continent'
                }, `Invalid continent value found. Normalizing to 'No continent'.`);
                finalRow.continent = "No continent"; // Normalize invalid value
            } // else: continent is valid, keep the trimmed original value

            // --- Type Validation & Normalization ---
            const originalType = finalRow.type?.trim();
            if (!originalType) {
                finalRow.type = "Offline"; // Default for empty
                // Optional: Log normalization
                // parentLogger.trace({ ...validationLogContext, event: 'normalization_applied', field: 'type', reason: 'empty_value' }, `Normalized empty type to 'Offline'.`);
            } else if (!VALID_TYPES.has(originalType)) {
                parentLogger.info({ // Log as info
                    ...validationLogContext,
                    event: 'validation_warning',
                    field: 'type',
                    invalidValue: originalType,
                    action: 'normalized',
                    normalizedTo: 'Offline'
                }, `Invalid type value found. Normalizing to 'Offline'.`);
                finalRow.type = "Offline"; // Default for invalid
            } // else: type is valid, keep the trimmed original value

            // --- Location, City, Country Normalization (only for empty/missing) ---
            if (!finalRow.location?.trim()) {
                finalRow.location = "No location";
            }
            if (!finalRow.cityStateProvince?.trim()) {
                finalRow.cityStateProvince = "No city/state/province";
            }
            if (!finalRow.country?.trim()) {
                finalRow.country = "No country";
            }
            if (!finalRow.publisher?.trim()) {
                finalRow.publisher = "No publisher";
            }
            if (!finalRow.topics?.trim()) {
                finalRow.topics = "No topics";
            }
            if (!finalRow.summary?.trim()) {
                finalRow.summary = "No summary available";
            }
            if (!finalRow.callForPapers?.trim()) {
                finalRow.callForPapers = "No call for papers available";
            }

            // --- Year Validation (Log only, no normalization here) ---
            const originalYear = finalRow.year?.trim();
            if (originalYear && !YEAR_REGEX.test(originalYear)) {
                parentLogger.info({ // Log as info
                    ...validationLogContext,
                    event: 'validation_warning',
                    field: 'year',
                    invalidValue: originalYear,
                    action: 'logged_only' // Indicate we are not changing it here
                }, `Invalid year format detected. Value kept as is.`);
                // Keep the original invalid value in the finalRow
            }
            // **********************************************
            // *** END: VALIDATION & NORMALIZATION LOGIC ***
            // **********************************************


            // Yield the potentially modified row object
            yield finalRow;

        } catch (rowProcessingError: any) {
            parentLogger.error({
                ...rowLogContext, // Includes acronym/title if available
                err: rowProcessingError,
                event: 'row_processing_error'
            }, "Error processing row data after parsing JSONL");
            yield null; // Yield null on processing error for this row
        }
    }
    parentLogger.info({ ...logContextBase, totalLines: lineNumber, event: 'jsonl_processing_finished' }, 'Finished processing JSONL file stream');
}


// --- Hàm chính để ghi CSV bằng Stream (unchanged) ---
export const writeCSVStream = async (
    jsonlFilePath: string,
    csvFilePath: string,
    parentLogger: typeof logger,
): Promise<any> => {
    const logContext = { jsonlInput: jsonlFilePath, csvOutput: csvFilePath, function: 'writeCSVStream' };
    parentLogger.info({ ...logContext, event: 'csv_stream_start' }, 'Starting CSV writing stream');

    const processorGenerator = processJsonlStream; // Use the updated generator

    let rowObjectStream: Readable | null = null;
    let filterAndLogTransform: NodeTransform | null = null;
    let csvTransform: Json2CsvTransform<ProcessedRowData, ProcessedRowData> | null = null;
    let csvWriteStream: fs.WriteStream | null = null;
    let recordsProcessed = 0;
    let recordsWritten = 0;

    try {
        // 1. Create source stream
        rowObjectStream = Readable.from(processorGenerator(jsonlFilePath, parentLogger));
        if (!rowObjectStream || typeof rowObjectStream.pipe !== 'function') {
            throw new Error('Failed to create Readable stream from generator.');
        }

        // 2. Create a transform stream to filter out nulls AND log success
        filterAndLogTransform = new NodeTransform({
            objectMode: true,
            transform(chunk: ProcessedRowData | null, encoding, callback) {
                recordsProcessed++;
                if (chunk !== null && chunk.acronym && chunk.title) {
                    // Log success *before* passing downstream
                    parentLogger.info({
                        event: 'csv_write_record_success',
                        acronym: chunk.acronym,
                        title: chunk.title,
                        // Optional: Add line number if you track it through transforms
                    }, `Successfully processed and validated record for CSV`);
                    recordsWritten++;
                    this.push(chunk); // Pass the valid chunk downstream
                } else {
                    // Error was already logged in processJsonlStream or chunk was invalid
                }
                callback();
            }
        });
        if (!filterAndLogTransform || typeof filterAndLogTransform.pipe !== 'function') throw new Error('Invalid filterAndLogTransform');


        // 3. Set up CSV parser options
        const csvOptions: ParserOptions<ProcessedRowData, ProcessedRowData> = { fields: CSV_FIELDS };
        const transformOpts: TransformOptions = { objectMode: true };
        const asyncOpts = {};


        // 4. Create json2csv Transform stream
        csvTransform = new Json2CsvTransform(csvOptions, asyncOpts, transformOpts);
        if (!csvTransform || typeof csvTransform.pipe !== 'function') {
            throw new Error('Failed to create Json2CsvTransform or it is not a valid stream.');
        }

        // 5. Create destination stream
        csvWriteStream = fs.createWriteStream(csvFilePath);
        if (!csvWriteStream || typeof csvWriteStream.on !== 'function') throw new Error('Invalid csvWriteStream');

        // 6. Use pipeline
        parentLogger.info({ ...logContext, event: 'pipeline_starting' }, 'Calling streamPipeline...');
        await streamPipeline(
            rowObjectStream,
            filterAndLogTransform,
            csvTransform,
            csvWriteStream
        );

        parentLogger.info({
            ...logContext,
            event: 'csv_stream_success',
            recordsProcessed,
            recordsWritten
        }, 'CSV writing stream finished successfully.');

        return rowObjectStream;

    } catch (error: any) {
        parentLogger.error({
            ...logContext,
            streamStatus: {
                rowObjectStreamExists: !!rowObjectStream,
                filterTransformExists: !!filterAndLogTransform,
                csvTransformInstanceExists: !!csvTransform,
                csvWriteStreamExists: !!csvWriteStream,
            },
            recordsProcessed,
            recordsWritten,
            err: { message: error.message, stack: error.stack, code: error.code, type: error.constructor.name },
            event: 'csv_stream_failed'
        }, 'Error during CSV writing stream pipeline');

        // Attempt to clean up streams
        rowObjectStream?.destroy();
        filterAndLogTransform?.destroy();
        csvTransform?.destroy();
        if (csvWriteStream && !csvWriteStream.destroyed) {
            csvWriteStream.destroy(error instanceof Error ? error : new Error(String(error)));
        }
        throw error;
    }
};