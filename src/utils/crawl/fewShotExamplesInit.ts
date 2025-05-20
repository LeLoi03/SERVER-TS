// src/utils/crawl/fewshotExamplesInit.ts
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