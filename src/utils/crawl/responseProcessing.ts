// // src/utils/responseProcessing.ts
// import { container } from 'tsyringe';
// import { LoggingService } from '../../services/logging.service';
// import { Logger } from 'pino';
// import fs from 'fs';
// import readline from 'readline';
// import { ParserOptions, Transform as Json2CsvTransform } from '@json2csv/node';
// import { Readable, Transform as NodeTransform, TransformOptions } from 'stream';
// import { pipeline as streamPipeline } from 'stream/promises';
// import path from 'path';

// import { ProcessedResponseData, InputRowData, ProcessedRowData } from '../../types/crawl.types';
// import { readContentFromFile } from '../../conference/11_utils';


// // <<< Resolve services
// const loggingService = container.resolve(LoggingService);
// const logger: Logger = loggingService.getLogger({ loader: 'Database' }); // <<< Tạo child logger

// // --- Constants for Validation ---
// // NOTE: Adjust this list based on the exact valid continent names you expect/use.
// const VALID_CONTINENTS = new Set(['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania', 'Antarctica']);
// const VALID_TYPES = new Set(['Hybrid', 'Online', 'Offline']);
// const YEAR_REGEX = /^\d{4}$/; // Simple check for 4 digits


// // --- Helper Functions (toCamelCase, isDateDetailKey, isDirectStringKey - MODIFIED) ---
// function toCamelCase(str: string): string {
//     // (Implementation remains the same)
//     if (!str) return "";
//     try {
//         return String(str).replace(/(?:^\w|[A-Z]|\b\w|\s+)/g, (match, index) => {
//             if (+match === 0) return "";
//             return index === 0 ? match.toLowerCase() : match.toUpperCase();
//         }).replace(/[^a-zA-Z0-9]+/g, '');
//     } catch (camelCaseError: unknown) {
//         const message = camelCaseError instanceof Error ? camelCaseError.message : String(camelCaseError);
//         console.error("Error converting to camelCase:", message, "Input string:", str);
//         return "";
//     }
// }
// function isDateDetailKey(key: string): key is keyof Pick<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate'> {
//     return ["submissionDate", "notificationDate", "cameraReadyDate", "registrationDate", "otherDate"].includes(key);
// }
// // MODIFIED: Removed "summary" and "callForPapers"
// function isDirectStringKey(key: string): key is keyof Omit<ProcessedResponseData, 'submissionDate' | 'notificationDate' | 'cameraReadyDate' | 'registrationDate' | 'otherDate' | 'information' | 'summary' | 'callForPapers'> {
//     // Excludes summary and callForPapers as they now come from CFP response
//     return ["conferenceDates", "year", "location", "cityStateProvince", "country", "continent", "type", "topics", "publisher"].includes(key);
// }


// // --- Main Functions ---
// // MODIFIED: processResponse no longer handles summary/callForPapers extraction
// export const processResponse = (response: Record<string, any> | null | undefined): Omit<ProcessedResponseData, 'summary' | 'callForPapers'> => {
//     // Initialize result *without* summary/callForPapers fields being actively populated here
//     const result: Omit<ProcessedResponseData, 'summary' | 'callForPapers'> & { information: string } = {
//         conferenceDates: "",
//         year: "",
//         location: "",
//         cityStateProvince: "",
//         country: "",
//         continent: "",
//         type: "",
//         submissionDate: {},
//         notificationDate: {},
//         cameraReadyDate: {},
//         registrationDate: {},
//         otherDate: {},
//         topics: "",
//         publisher: "",
//         // summary: "", // Not populated here
//         // callForPapers: "", // Not populated here
//         information: "" // Initialize information
//     };

//     if (!response) return result;

//     try {
//         for (const key in response) {
//             if (Object.prototype.hasOwnProperty.call(response, key)) {
//                 try {
//                     const value = response[key];
//                     const camelCaseKey = toCamelCase(key);

//                     if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
//                         if (isDateDetailKey(camelCaseKey)) {
//                             result[camelCaseKey] = {};
//                             for (const subKey in value) {
//                                 if (Object.prototype.hasOwnProperty.call(value, subKey)) {
//                                     try {
//                                         const subValue = String(value[subKey] ?? '');
//                                         result[camelCaseKey][subKey] = subValue;
//                                         result.information += `${subKey}: ${subValue}\n`;
//                                     } catch (subKeyError: unknown) {
//                                         // Log subkey processing error
//                                     }
//                                 }
//                             }
//                         } else {
//                             // Other nested objects - add raw to information
//                             try {
//                                 // *** CRITICAL: Ensure summary/callForPapers from EXTRACT are NOT added here ***
//                                 if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
//                                     result.information += `${key}: ${JSON.stringify(value)}\n`;
//                                 }
//                             } catch (stringifyError: unknown) {
//                                 // Log stringify error
//                             }
//                         }
//                     } else {
//                         // Primitive values and arrays
//                         const stringValue = String(value ?? '');

//                         if (isDirectStringKey(camelCaseKey)) {
//                             // Assign directly if it's a recognized direct string key
//                             result[camelCaseKey] = stringValue;
//                             // Add to information (already excluded summary/cfp via isDirectStringKey check)
//                             result.information += `${key}: ${stringValue}\n`;
//                         } else {
//                             // Handle any other keys
//                             // *** CRITICAL: Explicitly skip adding summary/callForPapers from EXTRACT response to information ***
//                             if (camelCaseKey !== "summary" && camelCaseKey !== "callForPapers") {
//                                 result.information += `${key}: ${stringValue}\n`;
//                             }
//                         }
//                     }
//                 } catch (valueProcessingError: unknown) {
//                     // Log value processing error
//                 }
//             }
//         }
//         result.information = result.information.trim();
//     } catch (responseProcessingError: unknown) {
//         // Log main processing error
//     }
//     return result;
// };


// // --- CSV Fields Definition (remains the same) ---
// const CSV_FIELDS: (keyof ProcessedRowData | { label: string; value: keyof ProcessedRowData })[] = [
//     "title", "acronym", "link", "cfpLink", "impLink",
//     "information", "conferenceDates", "year",
//     "location", "cityStateProvince", "country", "continent", "type",
//     "submissionDate", "notificationDate", "cameraReadyDate", "registrationDate",
//     "otherDate", "topics", "publisher", "summary", "callForPapers" // Keep columns in output
// ];

// // --- MODIFIED: processJsonlStream to handle CFP response for summary/callForPapers ---
// async function* processJsonlStream(jsonlFilePath: string, parentLogger: typeof logger): AsyncGenerator<ProcessedRowData | null> {
//     const fileStream = fs.createReadStream(jsonlFilePath);
//     const rl = readline.createInterface({
//         input: fileStream,
//         crlfDelay: Infinity
//     });
//     const logContextBase = { file: path.basename(jsonlFilePath), function: 'processJsonlStream' };

//     let lineNumber = 0;
//     for await (const line of rl) {
//         lineNumber++;
//         const logContext = { ...logContextBase, lineNumber };
//         if (!line.trim()) continue;

//         let inputRow: InputRowData | null = null;
//         let acronym: string | undefined = undefined;
//         let title: string | undefined = undefined;

//         try {
//             inputRow = JSON.parse(line) as InputRowData;
//             acronym = inputRow?.conferenceAcronym;
//             title = inputRow?.conferenceTitle;
//         } catch (parseError: any) {
//             parentLogger.error({
//                 ...logContext,
//                 err: parseError,
//                 lineContentSubstring: line.substring(0, 100),
//                 event: 'jsonl_parse_error'
//             }, "Failed to parse line in JSONL file");
//             yield null;
//             continue;
//         }

//         const rowLogContext = { ...logContext, acronym, title }; // Base context for this row

//         if (!inputRow || !acronym || !title) {
//             parentLogger.warn({
//                 ...rowLogContext,
//                 event: 'jsonl_missing_core_data',
//                 hasInputRow: !!inputRow,
//                 hasAcronym: !!acronym,
//                 hasTitle: !!title
//             }, "Parsed line missing essential data (row/acronym/title)");
//             yield null;
//             continue;
//         }


//         // --- Read and Parse API Response Files ---
//         let parsedDetermineInfo: Record<string, any> = {};
//         let parsedExtractInfo: Record<string, any> = {}; // Renamed for clarity
//         let parsedCfpInfo: Record<string, any> = {};   // <<< NEW: For CFP data

//         try {
//             // Determine Response
//             if (inputRow.determineResponseTextPath) {
//                 try {
//                     const determineFileContent = await readContentFromFile(inputRow.determineResponseTextPath);
//                     const cleaned = determineFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
//                     parsedDetermineInfo = cleaned ? JSON.parse(cleaned) : {};
//                     if (typeof parsedDetermineInfo !== 'object' || parsedDetermineInfo === null) parsedDetermineInfo = {};
//                 } catch (readOrParseError: any) {
//                     parentLogger.warn({ ...rowLogContext, err: readOrParseError, path: inputRow.determineResponseTextPath, type: 'determine', event: 'file_read_parse_warn' }, `Warning reading/parsing determine file`);
//                     parsedDetermineInfo = {};
//                 }
//             }

//             // Extract Response
//             if (inputRow.extractResponseTextPath) {
//                 try {
//                     const extractFileContent = await readContentFromFile(inputRow.extractResponseTextPath);
//                     const cleaned = extractFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
//                     parsedExtractInfo = cleaned ? JSON.parse(cleaned) : {}; // Assign to new var name
//                     if (typeof parsedExtractInfo !== 'object' || parsedExtractInfo === null) parsedExtractInfo = {};
//                 } catch (readOrParseError: any) {
//                     parentLogger.warn({ ...rowLogContext, err: readOrParseError, path: inputRow.extractResponseTextPath, type: 'extract', event: 'file_read_parse_warn' }, `Warning reading/parsing extract file`);
//                     parsedExtractInfo = {};
//                 }
//             }

//             // <<< NEW: CFP Response >>>
//             if (inputRow.cfpResponseTextPath) { // Check if the path exists in the input data
//                 try {
//                     const cfpFileContent = await readContentFromFile(inputRow.cfpResponseTextPath);
//                     const cleaned = cfpFileContent.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').trim();
//                     parsedCfpInfo = cleaned ? JSON.parse(cleaned) : {};
//                     if (typeof parsedCfpInfo !== 'object' || parsedCfpInfo === null) parsedCfpInfo = {};
//                 } catch (readOrParseError: any) {
//                     parentLogger.warn({ ...rowLogContext, err: readOrParseError, path: inputRow.cfpResponseTextPath, type: 'cfp', event: 'file_read_parse_warn' }, `Warning reading/parsing CFP file`);
//                     parsedCfpInfo = {}; // Default to empty object on error
//                 }
//             }
//             // --- End Read and Parse ---


//             // --- Process the parsed EXTRACT data (excluding summary/cfp) ---
//             const processedExtractResponse = processResponse(parsedExtractInfo); // processResponse now excludes summary/cfp

//             // --- Create the final row object ---
//             const finalRow: ProcessedRowData = {
//                 // Base info from input line
//                 title: title,
//                 acronym: acronym.replace(/_\d+$/, ''), // Remove potential index suffix
//                 link: inputRow.conferenceLink || "",
//                 cfpLink: inputRow.cfpLink || "",
//                 impLink: inputRow.impLink || "",
//                 // Data from Determine response
//                 determineLinks: parsedDetermineInfo,
//                 // Data from processed Extract response
//                 ...processedExtractResponse, // Spread fields like location, dates, topics etc.
//                 // Initialize summary/cfp before populating from CFP data
//                 summary: "",
//                 callForPapers: "",
//             };

//             // <<< NEW: Populate summary and callForPapers from parsed CFP data >>>
//             // Handle potential variations in key casing/naming from the API
//             finalRow.summary = String(parsedCfpInfo?.summary ?? parsedCfpInfo?.Summary ?? '');
//             finalRow.callForPapers = String(
//                 parsedCfpInfo?.callForPapers
//                 ?? parsedCfpInfo?.['Call for Papers']
//                 ?? parsedCfpInfo?.['Call For Papers']
//                 ?? parsedCfpInfo?.cfp // Add other potential variations if needed
//                 ?? ''
//             );
//             // --- End Populating from CFP data ---


//             // ************************************************
//             // *** START: VALIDATION & NORMALIZATION LOGIC ***
//             // ************************************************
//             const validationLogContext = { ...rowLogContext }; // Use row context for validation logs

//             // --- Continent Validation & Normalization ---
//             const originalContinent = finalRow.continent?.trim();
//             if (!originalContinent) {
//                 finalRow.continent = "No continent";
//             } else if (!VALID_CONTINENTS.has(originalContinent)) {
//                 parentLogger.info({ // Log as info since we are normalizing
//                     ...validationLogContext,
//                     event: 'validation_warning',
//                     field: 'continent',
//                     invalidValue: originalContinent,
//                     action: 'normalized',
//                     normalizedTo: 'No continent'
//                 }, `Invalid continent value found. Normalizing to 'No continent'.`);
//                 finalRow.continent = "No continent"; // Normalize invalid value
//             } // else: continent is valid, keep the trimmed original value

//             // --- Type Validation & Normalization ---
//             const originalType = finalRow.type?.trim();
//             if (!originalType) {
//                 finalRow.type = "Offline";
//             } else if (!VALID_TYPES.has(originalType)) {
//                 parentLogger.info({ // Log as info
//                     ...validationLogContext,
//                     event: 'validation_warning',
//                     field: 'type',
//                     invalidValue: originalType,
//                     action: 'normalized',
//                     normalizedTo: 'Offline'
//                 }, `Invalid type value found. Normalizing to 'Offline'.`);
//                 finalRow.type = "Offline"; // Default for invalid
//             } // else: type is valid, keep the trimmed original value

//             // --- Location, City, Country, Publisher, Topics Normalization (for empty/missing) ---
//             if (!finalRow.location?.trim()) finalRow.location = "No location";
//             if (!finalRow.cityStateProvince?.trim()) finalRow.cityStateProvince = "No city/state/province";
//             if (!finalRow.country?.trim()) finalRow.country = "No country";
//             if (!finalRow.publisher?.trim()) finalRow.publisher = "No publisher";
//             if (!finalRow.topics?.trim()) finalRow.topics = "No topics";

//             // <<< MODIFIED: Apply default/normalization AFTER attempting to populate from CFP >>>
//             if (!finalRow.summary?.trim()) { // Check if summary is still empty after trying CFP data
//                 finalRow.summary = "No summary available";
//             }
//             if (!finalRow.callForPapers?.trim()) { // Check if cfp is still empty after trying CFP data
//                 finalRow.callForPapers = "No call for papers available";
//             }

//             // --- Year Validation (Log only, no normalization here) ---
//             const originalYear = finalRow.year?.trim();
//             if (originalYear && !YEAR_REGEX.test(originalYear)) {
//                 parentLogger.info({ // Log as info
//                     ...validationLogContext,
//                     event: 'validation_warning',
//                     field: 'year',
//                     invalidValue: originalYear,
//                     action: 'logged_only' // Indicate we are not changing it here
//                 }, `Invalid year format detected. Value kept as is.`);
//                 // Keep the original invalid value in the finalRow
//             }
//             // **********************************************
//             // *** END: VALIDATION & NORMALIZATION LOGIC ***
//             // **********************************************


//             // Yield the potentially modified row object
//             yield finalRow;

//         } catch (rowProcessingError: any) {
//             parentLogger.error({
//                 ...rowLogContext, // Includes acronym/title if available
//                 err: rowProcessingError,
//                 event: 'row_processing_error'
//             }, "Error processing row data after parsing JSONL");
//             yield null; // Yield null on processing error for this row
//         }
//     }
//     parentLogger.info({ ...logContextBase, totalLines: lineNumber, event: 'jsonl_processing_finished' }, 'Finished processing JSONL file stream');
// }


// // --- Hàm chính để ghi CSV bằng Stream và trả về dữ liệu ---
// export const writeCSVAndCollectData = async ( // <<< Đổi tên hàm
//     jsonlFilePath: string,
//     csvFilePath: string,
//     parentLogger: typeof logger,
// ): Promise<ProcessedRowData[]> => { // <<< Thay đổi kiểu trả về
//     const logContext = { jsonlInput: jsonlFilePath, csvOutput: csvFilePath, function: 'writeCSVAndCollectData' };
//     parentLogger.info({ ...logContext, event: 'csv_stream_collect_start' }, 'Starting CSV writing stream and data collection');

//     const collectedData: ProcessedRowData[] = []; // <<< Mảng để thu thập dữ liệu
//     const processorGenerator = processJsonlStream; // Generator xử lý JSONL

//     let rowObjectStream: Readable | null = null;
//     let filterLogCollectTransform: NodeTransform | null = null; // <<< Đổi tên transform
//     let csvTransform: Json2CsvTransform<ProcessedRowData, ProcessedRowData> | null = null;
//     let csvWriteStream: fs.WriteStream | null = null;
//     let recordsProcessed = 0;
//     let recordsWrittenToCsv = 0;

//     // --- Kiểm tra file JSONL tồn tại và không rỗng trước khi bắt đầu ---
//     try {
//         if (!fs.existsSync(jsonlFilePath)) {
//             parentLogger.warn({ ...logContext, event: 'csv_stream_collect_skip_no_file' }, 'JSONL file does not exist. Returning empty array.');
//             return []; // Trả về mảng rỗng
//         }
//         const stats = await fs.promises.stat(jsonlFilePath);
//         if (stats.size === 0) {
//             parentLogger.warn({ ...logContext, event: 'csv_stream_collect_skip_empty_file' }, 'JSONL file is empty. Returning empty array.');
//             return []; // Trả về mảng rỗng
//         }
//     } catch (statError: any) {
//         parentLogger.error({ ...logContext, err: statError, event: 'csv_stream_collect_stat_error' }, 'Error checking JSONL file status.');
//         return []; // Trả về mảng rỗng khi không kiểm tra được file
//     }
//     // --- Hết kiểm tra file ---

//     try {
//         // 1. Create source stream
//         rowObjectStream = Readable.from(processorGenerator(jsonlFilePath, parentLogger));
//         if (!rowObjectStream || typeof rowObjectStream.pipe !== 'function') {
//             throw new Error('Failed to create Readable stream from generator.');
//         }

//         // 2. Create a transform stream to filter out nulls AND log success
//         filterLogCollectTransform = new NodeTransform({
//             objectMode: true,
//             transform(chunk: ProcessedRowData | null, encoding, callback) {
//                 recordsProcessed++;
//                 if (chunk !== null && chunk.acronym && chunk.title) {
//                     // Log success *before* passing downstream
//                     parentLogger.info({
//                         event: 'csv_write_record_success',
//                         acronym: chunk.acronym,
//                         title: chunk.title,
//                         // Optional: Add line number if you track it through transforms
//                     }, `Successfully processed and validated record for CSV`);

//                     // <<<--- Thu thập dữ liệu ---
//                     collectedData.push(chunk);
//                     // <<<----------------------

//                     recordsWrittenToCsv++;
//                     this.push(chunk); // Pass the valid chunk downstream
//                 } else {
//                     // Error was already logged in processJsonlStream or chunk was invalid
//                 }
//                 callback();
//             }
//         });
//         if (!filterLogCollectTransform || typeof filterLogCollectTransform.pipe !== 'function') throw new Error('Invalid filterLogCollectTransform');


//         // 3. Set up CSV parser options
//         const csvOptions: ParserOptions<ProcessedRowData, ProcessedRowData> = { fields: CSV_FIELDS };
//         const transformOpts: TransformOptions = { objectMode: true };
//         const asyncOpts = {};


//         // 4. Create json2csv Transform stream
//         csvTransform = new Json2CsvTransform(csvOptions, asyncOpts, transformOpts);
//         if (!csvTransform || typeof csvTransform.pipe !== 'function') {
//             throw new Error('Failed to create Json2CsvTransform or it is not a valid stream.');
//         }

//         // 5. Create destination stream
//         csvWriteStream = fs.createWriteStream(csvFilePath);
//         if (!csvWriteStream || typeof csvWriteStream.on !== 'function') throw new Error('Invalid csvWriteStream');

//         // 6. Use pipeline
//         parentLogger.info({ ...logContext, event: 'pipeline_starting' }, 'Calling streamPipeline...');
//         await streamPipeline(
//             rowObjectStream,
//             filterLogCollectTransform,
//             csvTransform,
//             csvWriteStream
//         );

//         parentLogger.info({
//             ...logContext,
//             event: 'csv_stream_collect_success',
//             recordsProcessed,
//             recordsWrittenToCsv,
//             recordsCollected: collectedData.length // Log số lượng thu thập được
//         }, 'CSV writing stream and data collection finished successfully.');

//         // <<<--- Trả về dữ liệu đã thu thập ---
//         return collectedData;
//         // <<<---------------------------------


//     } catch (error: any) {
//         parentLogger.error({
//             ...logContext,
//             streamStatus: {
//                 rowObjectStreamExists: !!rowObjectStream,
//                 filterTransformExists: !!filterLogCollectTransform,
//                 csvTransformInstanceExists: !!csvTransform,
//                 csvWriteStreamExists: !!csvWriteStream,
//             },
//             recordsProcessed,
//             recordsCollected: collectedData.length, // Log số lượng đã thu thập được khi lỗi
//             event: 'csv_stream_collect_failed'
//         }, 'Error during CSV writing stream and data collection pipeline');

//         // Attempt to clean up streams
//         rowObjectStream?.destroy();
//         filterLogCollectTransform?.destroy();
//         csvTransform?.destroy();
//         if (csvWriteStream && !csvWriteStream.destroyed) {
//             csvWriteStream.destroy(error instanceof Error ? error : new Error(String(error)));
//         }
//         throw error;
//     }
// };