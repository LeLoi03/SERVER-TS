// src/journal/utils.ts
import fs from 'fs';
import { parse, Parser } from 'csv-parse';
import { CSVRecord, JournalDetails } from './types'; // Gộp import
import 'reflect-metadata'; // Cần cho tsyringe nếu file này được DI, nhưng utils thường không.
                           // Nếu chỉ gọi từ service đã có DI thì không cần ở đây.

// Import Logger từ pino để sử dụng nhất quán
import { Logger } from 'pino'; // <<<< SỬ DỤNG LOGGER TỪ PINO

export interface RetryOptions {
    retries: number;
    minTimeout: number;
    factor: number;
}

// 1. traverseNodes: Giữ nguyên
export const traverseNodes = (node: Node | null): string => {
    // ... (như cũ)
    if (!node) return '';
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent?.trim() || '';
    } else if (node.nodeType === Node.ELEMENT_NODE && node.childNodes.length > 0) {
        return Array.from(node.childNodes).map(traverseNodes).join(' ').trim();
    }
    return '';
};

// 2. createURLList: Giữ nguyên
export const createURLList = (baseURL: string, lastPageNumber: number): string[] => {
    // ... (như cũ)
    return Array.from({ length: lastPageNumber }, (_, i) => `${baseURL}&page=${i + 1}`);
};

// 3. formatISSN: Giữ nguyên
export const formatISSN = (issn: string): string | null => {
    // ... (như cũ)
    if (!issn) {
        return null;
    }
    const issnValues = issn.split(',').map(item => item.trim());
    const issnToSearch = (issnValues[1] || issnValues[0] || '').replace(/-/g, '');
    const issnRegex = /^(\d{4})(\d{3}[\dX])$/i;
    const match = issnToSearch.match(issnRegex);
    if (match) {
        return `${match[1]}-${match[2]}`;
    }
    return null;
};

// 4. retryAsync:
export const retryAsync = async <T>(
    fn: (attempt: number) => Promise<T>,
    options: RetryOptions,
    logger: Logger // <<<< Yêu cầu Logger từ Pino
): Promise<T> => {
    const { retries, minTimeout, factor } = options;
    let lastError: any = null;

    // logger đã là một child logger với context của tác vụ gọi nó (ví dụ, fetchScimagoDetails)
    // Chúng ta có thể thêm context cụ thể cho retry vào đây
    const retryLogger = logger.child({ retryContext: 'retryAsyncFunction' });

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            return await fn(attempt);
        } catch (error: any) {
            lastError = error;
            const isLastAttempt = attempt >= retries;
            const timeout = Math.round(minTimeout * Math.pow(factor, attempt - 1));

            const logContext = {
                event: isLastAttempt ? 'retry_max_attempts_reached' : 'retry_attempt_failed',
                attempt,
                maxRetries: retries,
                err: {
                    message: error.message,
                    name: error.name,
                    stack: error.stack?.substring(0, 500),
                    ...(error.response && { responseStatus: error.response.status, responseData: error.response.data }),
                    ...(error.code && { code: error.code }),
                },
                ...(isLastAttempt ? {} : { delayMs: timeout }),
            };

            if (isLastAttempt) {
                retryLogger.error(logContext, `Function failed after maximum ${retries} attempts. Throwing last error.`);
                throw lastError;
            } else {
                retryLogger.warn(logContext, `Attempt ${attempt}/${retries} failed. Retrying in ${timeout}ms...`);
                await new Promise((resolve) => setTimeout(resolve, timeout));
            }
        }
    }
    retryLogger.error({ event: 'retry_logic_error', err: lastError }, "Retry loop completed without success or throwing (unexpected).");
    throw lastError || new Error("Retry failed after multiple attempts, but no specific error was captured.");
};

const escapeQuotesInQuotedFields = (csvString: string, delimiter = ';', logger?: Logger) => { // <<<< Logger từ Pino
    let result = '';
    let inQuotes = false;
    const len = csvString.length;

    for (let i = 0; i < len; i++) {
        const char = csvString[i];
        const nextChar = i < len - 1 ? csvString[i + 1] : null;
        const prevChar = i > 0 ? csvString[i - 1] : null;

        if (!inQuotes) {
            result += char;
            if (char === '"') {
                if (i === 0 || prevChar === delimiter || prevChar === '\n' || prevChar === '\r') {
                    inQuotes = true;
                }
            }
        } else {
            if (char === '"') {
                if (nextChar === '"') {
                    result += '""';
                    i++;
                } else if (nextChar === delimiter || nextChar === '\n' || nextChar === '\r' || nextChar === null || i === len - 1) {
                    result += '"';
                    inQuotes = false;
                } else {
                    result += '""';
                }
            } else {
                result += char;
            }
        }
    }

    if (inQuotes && logger) { // Chỉ log nếu logger được cung cấp
        logger.warn({ event: 'csv_unterminated_quote_warning' }, "[escapeQuotesInQuotedFields] CSV string potentially ended with an unterminated quoted field.");
    }
    return result;
};

export const parseCSVString = async (
    csvContent: string,
    parentLogger: Logger // <<<< Yêu cầu Logger từ Pino
): Promise<CSVRecord[]> => {
    // parentLogger đã có context từ nơi gọi nó (ví dụ, batchRequestId từ readCSV)
    // Tạo child logger cho context cụ thể của hàm này
    const csvLogger = parentLogger.child({ utilFunction: 'parseCSVString' });

    csvLogger.info({
        event: 'parse_csv_string_start',
        inputLength: csvContent.length,
    }, `Attempting to parse CSV string content.`);

    let processedCsvContent: string;
    try {
        // csvLogger.debug("Starting pre-processing to escape inner quotes."); // Có thể bỏ debug log này
        processedCsvContent = escapeQuotesInQuotedFields(csvContent, ';', csvLogger); // Truyền csvLogger
        // csvLogger.debug({ outputLength: processedCsvContent.length }, "Finished pre-processing.");
    } catch (preProcessError: any) {
        csvLogger.error({
            event: 'parse_csv_string_failed',
            stage: 'preprocessing',
            err: { message: preProcessError.message, stack: preProcessError.stack?.substring(0, 500) },
        }, `Error during CSV pre-processing.`);
        throw new Error(`Failed during CSV pre-processing: ${preProcessError.message}`);
    }

    return new Promise((resolve, reject) => {
        const records: CSVRecord[] = [];
        const parser: Parser = parse(processedCsvContent, {
            columns: true, skip_empty_lines: true, delimiter: ';', trim: true,
        });

        parser.on('readable', () => {
            let record;
            while ((record = parser.read()) !== null) records.push(record);
        });

        parser.on('error', (err) => {
            csvLogger.error({
                event: 'parse_csv_string_failed',
                stage: 'parsing',
                err: { message: err.message, stack: err.stack?.substring(0, 500) },
            }, `Error parsing pre-processed CSV string.`);
            reject(new Error(`Failed to parse CSV string (after pre-processing): ${err.message}`));
        });

        parser.on('end', () => {
            csvLogger.info({
                event: 'parse_csv_string_success',
                recordCount: records.length,
            }, `Successfully parsed ${records.length} records from CSV string.`);
            resolve(records);
        });
    });
};

export const readCSV = async (
    filePath: string,
    parentLogger: Logger // <<<< Yêu cầu Logger từ Pino
): Promise<CSVRecord[]> => {
    // parentLogger đã có context từ nơi gọi nó (ví dụ, batchRequestId từ crawlJournals)
    // Tạo child logger cho context cụ thể của hàm này
    const fileReadLogger = parentLogger.child({ utilFunction: 'readCSV', filePath });

    fileReadLogger.info({
        event: 'read_csv_file_start',
    }, `Attempting to read CSV file.`);

    try {
        const fileContent = await fs.promises.readFile(filePath, { encoding: 'utf8' });
        // fileReadLogger.debug({ fileSize: fileContent.length }, "Successfully read file content.");

        // Truyền fileReadLogger (đã có filePath) vào parseCSVString
        const records = await parseCSVString(fileContent, fileReadLogger);

        fileReadLogger.info({
            event: 'read_csv_file_success',
            recordCount: records.length,
        }, `Successfully read and parsed CSV file.`);
        return records;

    } catch (error: any) {
        fileReadLogger.error({
            event: 'read_csv_file_failed',
            err: { message: error.message, stack: error.stack?.substring(0, 500) },
        }, `Error reading or parsing CSV file.`);
        return []; // Hoặc throw error tùy theo yêu cầu
    }
};

export async function appendJournalToFile(
    journalData: JournalDetails,
    filePath: string,
    taskLogger: Logger // <<<< Yêu cầu Logger từ Pino
): Promise<void> {
    // taskLogger đã là một child logger với context đầy đủ từ crawlJournals
    // (bao gồm batchRequestId, journalTitle, filePath nếu được thêm vào từ nơi gọi)
    // Không cần tạo child logger mới ở đây trừ khi muốn thêm context rất cụ thể cho việc append.
    // Ví dụ: const appendLogger = taskLogger.child({ appendOperationId: Date.now() });

    taskLogger.debug({ // Có thể dùng debug thay vì info cho các bước nhỏ
        event: 'append_journal_to_file_start',
        // Các context quan trọng như journalTitle, batchRequestId đã có trong taskLogger
    }, "Attempting to append journal to file.");

    let jsonLine: string;
    try {
        jsonLine = JSON.stringify(journalData);
    } catch (stringifyError: any) {
        taskLogger.error({
            event: 'append_journal_to_file_failed',
            stage: 'stringify',
            err: { message: stringifyError.message, stack: stringifyError.stack?.substring(0, 500) }
        }, "CRITICAL ERROR DURING JSON.stringify!");
        return;
    }

    if (!jsonLine) {
        taskLogger.error({
            event: 'append_journal_to_file_failed',
            stage: 'stringify_undefined',
        }, "CRITICAL: JSON.stringify returned undefined!");
        return;
    }

    const lineToWrite = jsonLine + '\n';
    try {
        await fs.promises.appendFile(filePath, lineToWrite, 'utf8');
        taskLogger.info({ // Dùng info cho kết quả thành công cuối cùng
            event: 'append_journal_to_file_success',
        }, `Successfully appended journal.`);
    } catch (appendError: any) {
        taskLogger.error({
            event: 'append_journal_to_file_failed',
            stage: 'append_fs',
            err: { message: appendError.message, stack: appendError.stack?.substring(0, 500), code: appendError.code }
        }, `CRITICAL ERROR during fs.appendFile!`);
    }
}