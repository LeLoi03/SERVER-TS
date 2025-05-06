import csv from 'csv-parser';
import { createReadStream, promises as fsPromises, ReadStream } from 'fs';

import { InputsOutputs, CsvRowData } from '../../types/crawl.types';


// --- Functions ---

/**
 * Reads a CSV file and extracts 'input:' and 'output:' columns.
 * @param filePath The path to the CSV file.
 * @returns A promise that resolves with an array of { input, output } objects.
 */
export async function read_csv(filePath: string): Promise<CsvRowData[]> {
    return new Promise((resolve, reject) => {
        const results: CsvRowData[] = [];
        let stream: ReadStream | undefined; // Declare stream variable, initially undefined

        // Check if the file exists before attempting to read it
        fsPromises.access(filePath)
            .then(() => {
                // File exists, proceed to create read stream
                try {
                    stream = createReadStream(filePath);

                    stream.pipe(csv()) // Assuming standard CSV headers 'input:' and 'output:'
                        .on('data', (row: Record<string, string>) => { // Type the row data
                            try {
                                // Use bracket notation for headers with special chars
                                const inputText = (row['input:'] || '').trim();
                                const outputText = (row['output:'] || '').trim();

                                if (inputText && outputText) {
                                    results.push({
                                        input: `input:\n${inputText}`,
                                        output: `output:\n${outputText}`
                                    });
                                } else {
                                    console.warn(`Skipping row due to missing input or output:`, row);
                                }
                            } catch (rowProcessingError: unknown) {
                                const message = rowProcessingError instanceof Error ? rowProcessingError.message : String(rowProcessingError);
                                console.error("Error processing row:", message, "Row:", row);
                                // Continue processing other rows
                            }
                        })
                        .on('end', () => {
                            if (results.length === 0) {
                                // Consider if this should be a warning or an error depending on use case
                                console.warn(`No valid data found in CSV file: ${filePath}`);
                                resolve([]); // Resolve with empty array instead of rejecting? Or reject as before?
                                // reject(new Error(`Không tìm thấy dữ liệu hợp lệ trong file CSV: ${filePath}`));
                            } else {
                                console.log(`Successfully read ${results.length} rows from ${filePath}`);
                                resolve(results);
                            }
                        })
                        .on('error', (error: Error) => { // Type the error object
                            reject(new Error(`Lỗi khi đọc hoặc phân tích file CSV (${filePath}): ${error.message}`));
                        });

                    // Handle errors on the stream itself (e.g., read errors)
                    stream.on('error', (error: Error) => {
                        reject(new Error(`Lỗi stream khi đọc file CSV (${filePath}): ${error.message}`));
                    });

                } catch (streamError: unknown) {
                    // Catch synchronous errors during stream creation (less likely but possible)
                    const message = streamError instanceof Error ? streamError.message : String(streamError);
                    reject(new Error(`Lỗi khi tạo stream đọc file CSV (${filePath}): ${message}`));
                }
            })
            .catch((accessError: unknown) => {
                // Handle file access errors (e.g., file not found, permissions)
                const message = accessError instanceof Error ? accessError.message : String(accessError);
                // Customize error message based on common errors
                if (accessError instanceof Error && 'code' in accessError && accessError.code === 'ENOENT') {
                    reject(new Error(`File CSV không tồn tại: ${filePath}`));
                } else {
                    reject(new Error(`Lỗi truy cập file ${filePath}: ${message}`));
                }
            });
    });
}

/**
 * Creates structured input/output objects from CSV data.
 * @param data Array of { input, output } objects.
 * @returns An object containing inputs and outputs records.
 */
export const createInputsOutputs = (data: CsvRowData[]): InputsOutputs => {
    const inputs: Record<string, string> = {};
    const outputs: Record<string, string> = {};
    try {
        data.forEach((item, index) => {
            try {
                const i = index + 1; // 1-based index for keys
                // Ensure item and its properties exist, provide default empty string
                inputs[`input${i}`] = item?.input || '';
                outputs[`output${i}`] = item?.output || '';
            } catch (itemError: unknown) {
                const message = itemError instanceof Error ? itemError.message : String(itemError);
                console.error("Error processing item:", message, "Item:", item);
                // Continue to next item
            }
        });
    } catch (creationError: unknown) {
        const message = creationError instanceof Error ? creationError.message : String(creationError);
        console.error("Error creating inputs/outputs structure:", message);
        return { inputs: {}, outputs: {} }; // Return empty objects on major error
    }

    return { inputs, outputs };
};

// /**
//  * Prepares data for the 'determine' API type by reading its CSV
//  * and attaching inputs/outputs to the config.
//  * @returns A promise resolving to the prepared inputs and outputs.
//  */
// export const prepareDetermineData = async (): Promise<InputsOutputs> => {
//     try {
//         console.log(`Preparing determine data from: ${DETERMINE_LINKS_CSV}`);
//         const determineData = await read_csv(DETERMINE_LINKS_CSV);
//         const { inputs, outputs } = createInputsOutputs(determineData);

//         // Modify the imported config object (ensure ApiConfig interface allows this)
//         if (apiConfigs.determine) {
//             apiConfigs.determine.inputs = inputs;
//             apiConfigs.determine.outputs = outputs;
//             console.log(`Determine data prepared. ${Object.keys(inputs).length} examples loaded.`);
//         } else {
//              console.error("Error: apiConfigs.determine is not defined in config.");
//              return { inputs: {}, outputs: {} }; // Return empty if config structure is wrong
//         }
//         return { inputs, outputs };
//     } catch (error: unknown) {
//         const message = error instanceof Error ? error.message : String(error);
//         // logger.error('Error preparing determine data:', error); // Use logger if available
//         console.error('Error preparing determine data:', message);
//         if (error instanceof Error) console.error(error.stack);
//         return { inputs: {}, outputs: {} }; // Return empty objects on error
//     }
// };

// /**
//  * Prepares data for the 'extract' API type by reading its CSV
//  * and attaching inputs/outputs to the config.
//  * @returns A promise resolving to the prepared inputs and outputs.
//  */
// export const prepareExtractData = async (): Promise<InputsOutputs> => {
//     try {
//         console.log(`Preparing extract data from: ${EXTRACT_INFORMATION_CSV}`);
//         const extractData = await read_csv(EXTRACT_INFORMATION_CSV);
//         const { inputs, outputs } = createInputsOutputs(extractData);

//          // Modify the imported config object (ensure ApiConfig interface allows this)
//         if (apiConfigs.extract) {
//             apiConfigs.extract.inputs = inputs;
//             apiConfigs.extract.outputs = outputs;
//             console.log(`Extract data prepared. ${Object.keys(inputs).length} examples loaded.`);
//         } else {
//              console.error("Error: apiConfigs.extract is not defined in config.");
//              return { inputs: {}, outputs: {} }; // Return empty if config structure is wrong
//         }
//         return { inputs, outputs };
//     } catch (error: unknown) {
//         const message = error instanceof Error ? error.message : String(error);
//         // logger.error('Error preparing extract data:', error); // Use logger if available
//         console.error('Error preparing extract data:', message);
//          if (error instanceof Error) console.error(error.stack);
//         return { inputs: {}, outputs: {} }; // Return empty objects on error
//     }
// };

// /**
//  * Prepares data for the 'cfp' API type by reading its CSV
//  * and attaching inputs/outputs to the config.
//  * @returns A promise resolving to the prepared inputs and outputs.
//  */
// export const prepareCfpData = async (): Promise<InputsOutputs> => {
//     try {
//         console.log(`Preparing cfp data from: ${CFP_INFORMATION_CSV}`);
//         const cfpData = await read_csv(CFP_INFORMATION_CSV);
//         const { inputs, outputs } = createInputsOutputs(cfpData);

//          // Modify the imported config object (ensure ApiConfig interface allows this)
//         if (apiConfigs.cfp) {
//             apiConfigs.cfp.inputs = inputs;
//             apiConfigs.cfp.outputs = outputs;
//             console.log(`Cfp data prepared. ${Object.keys(inputs).length} examples loaded.`);
//         } else {
//              console.error("Error: apiConfigs.cfp is not defined in config.");
//              return { inputs: {}, outputs: {} }; // Return empty if config structure is wrong
//         }
//         return { inputs, outputs };
//     } catch (error: unknown) {
//         const message = error instanceof Error ? error.message : String(error);
//         // logger.error('Error preparing cfp data:', error); // Use logger if available
//         console.error('Error preparing cfp data:', message);
//          if (error instanceof Error) console.error(error.stack);
//         return { inputs: {}, outputs: {} }; // Return empty objects on error
//     }
// };


// // Initialization state
// let isInitialized: boolean = false;
// let initializationPromise: Promise<void> | undefined = undefined;

// /**
//  * Initializes the CSV data by preparing both extract and cfp data.
//  * Ensures initialization only runs once.
//  * @returns A promise that resolves when initialization is complete or throws if it fails.
//  */
// export async function init(): Promise<void> {
//     if (isInitialized) {
//         // console.log("Data already initialized.");
//         return Promise.resolve(); // Already done
//     }

//     if (!initializationPromise) { // Check if initialization is *not* already in progress
//         console.log("Starting data initialization...");
//         initializationPromise = (async () => {
//             try {
//                 // Run preparations in parallel for potentially faster init
//                 await Promise.all([
//                     prepareCfpData()
//                 ]);
//                 // logger.info("Data initialization complete."); // Use logger if available
//                 console.log("Data initialization complete.");
//                 isInitialized = true; // Mark as initialized *after* successful completion
//             } catch (error: unknown) {
//                 const message = error instanceof Error ? error.message : String(error);
//                 // logger.error("Error during data initialization:", error); // Use logger if available
//                 console.error("Error during data initialization:", message);
//                 if (error instanceof Error) console.error(error.stack);
//                 initializationPromise = undefined; // Reset promise on failure so it can be retried
//                 isInitialized = false; // Ensure it's marked as not initialized on failure
//                 throw error; // Rethrow to signal failure to the caller
//             }
//         })();
//     } else {
//         console.log("Data initialization already in progress...");
//     }

//     // Return the promise whether it's new or already existing
//     // Add a catch here just to prevent unhandled rejection warnings if the caller doesn't await/catch
//     return initializationPromise.catch(() => {});
// }