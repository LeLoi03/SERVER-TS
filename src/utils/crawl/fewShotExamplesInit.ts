// src/utils/crawl/fewshotExamplesInit.ts
import csv from 'csv-parser';
import { createReadStream, promises as fsPromises, ReadStream } from 'fs';
import { InputsOutputs, CsvRowData } from '../../types/crawl/crawl.types';
import logToFile from '../logger'; // Assuming logger is in ../logger or similar
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility

// --- Functions ---

/**
 * Reads a CSV file and extracts 'input:' and 'output:' columns for few-shot examples.
 * @param filePath The path to the CSV file.
 * @returns A promise that resolves with an array of { input, output } objects.
 *          Rejects if the file does not exist or if there's a critical reading/parsing error.
 */
export async function read_csv(filePath: string): Promise<CsvRowData[]> {
    const logContext = `[FewShotInit][read_csv][${filePath}]`;
    return new Promise((resolve, reject) => {
        const results: CsvRowData[] = [];
        let stream: ReadStream | undefined;

        // Check if the file exists before attempting to create a read stream
        fsPromises.access(filePath)
            .then(() => {
                try {
                    stream = createReadStream(filePath);

                    stream.pipe(csv())
                        .on('data', (row: Record<string, string>) => {
                            try {
                                const inputText = (row['input:'] || '').trim();
                                const outputText = (row['output:'] || '').trim();

                                if (inputText && outputText) {
                                    results.push({
                                        input: `input:\n${inputText}`,
                                        output: `output:\n${outputText}`
                                    });
                                } else {
                                    logToFile(`[WARNING] ${logContext} Skipping row due to missing 'input:' or 'output:' data. Row data (partial): ${JSON.stringify(row).substring(0, 200)}...`);
                                }
                            } catch (rowProcessingError: unknown) {
                                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(rowProcessingError);
                                logToFile(`[ERROR] ${logContext} Error processing CSV row: "${errorMessage}". Row data (partial): ${JSON.stringify(row).substring(0, 200)}... Stack: ${errorStack}.`);
                                // Continue processing other rows even if one fails
                            }
                        })
                        .on('end', () => {
                            if (results.length === 0) {
                                logToFile(`[WARNING] ${logContext} No valid 'input:' and 'output:' data found in CSV file. Resolved with empty array.`);
                                resolve([]);
                            } else {
                                // logToFile(`[INFO] ${logContext} Successfully read ${results.length} valid rows from CSV.`);
                                resolve(results);
                            }
                        })
                        .on('error', (error: unknown) => { // Type as unknown
                            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                            reject(new Error(`[CRITICAL] ${logContext} Error reading or parsing CSV stream: "${errorMessage}". Stack: ${errorStack}.`));
                        });

                    // Ensure stream errors are also caught if they occur before 'data' or 'end'
                    stream.on('error', (error: unknown) => { // Type as unknown
                        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                        reject(new Error(`[CRITICAL] ${logContext} Stream error occurred while reading CSV: "${errorMessage}". Stack: ${errorStack}.`));
                    });

                } catch (streamCreationError: unknown) {
                    // Catch synchronous errors during stream creation (e.g., invalid path format, although `fsPromises.access` should catch most)
                    const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(streamCreationError);
                    reject(new Error(`[CRITICAL] ${logContext} Failed to create read stream for CSV: "${errorMessage}". Stack: ${errorStack}.`));
                }
            })
            .catch((accessError: unknown) => {
                // Handle file access errors (e.g., file not found, permissions issues)
                const { message: errorMessage } = getErrorMessageAndStack(accessError);
                if (accessError instanceof Error && 'code' in accessError && (accessError as NodeJS.ErrnoException).code === 'ENOENT') {
                    // Specific error for file not found
                    reject(new Error(`[CRITICAL] ${logContext} CSV file not found: "${filePath}". Message: "${errorMessage}".`));
                } else {
                    reject(new Error(`[CRITICAL] ${logContext} Failed to access CSV file: "${filePath}". Message: "${errorMessage}".`));
                }
            });
    });
}

/**
 * Creates structured input/output objects from an array of CSV row data.
 * This function formats the data suitable for Gemini's few-shot examples.
 * @param data An array of { input, output } objects parsed from CSV.
 * @returns An object containing 'inputs' and 'outputs' records, where keys are `inputN`/`outputN`.
 */
export const createInputsOutputs = (data: CsvRowData[]): InputsOutputs => {
    const logContext = `[FewShotInit][createInputsOutputs]`;
    const inputs: Record<string, string> = {};
    const outputs: Record<string, string> = {};
    try {
        data.forEach((item, index) => {
            try {
                const i = index + 1; // Use 1-based index for generated keys
                // Ensure item and its properties exist, provide default empty string if null/undefined
                // The `read_csv` function already ensures input/output are non-empty before pushing to `results`.
                // However, defensive check here is still good practice.
                inputs[`input${i}`] = item?.input || '';
                outputs[`output${i}`] = item?.output || '';
            } catch (itemError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(itemError);
                logToFile(`[ERROR] ${logContext} Error processing individual CSV item for InputsOutputs structure: "${errorMessage}". Item (partial): ${JSON.stringify(item)?.substring(0, 200)}... Stack: ${errorStack}.`);
                // Continue to next item even if this one fails
            }
        });
    } catch (creationError: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(creationError);
        logToFile(`[ERROR] ${logContext} Critical error creating InputsOutputs structure: "${errorMessage}". Returning empty structure. Stack: ${errorStack}.`);
        return { inputs: {}, outputs: {} }; // Return empty objects on major failure to avoid breaking
    }

    logToFile(`[INFO] ${logContext} Successfully created InputsOutputs structure for ${data.length} items.`);
    return { inputs, outputs };
};