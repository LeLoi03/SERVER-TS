// src/utils/crawl/pdf.utils.ts
import pdf from 'pdf-parse';
import axios from 'axios';
import { Logger } from 'pino'; // Keep Pino Logger type
import { getErrorMessageAndStack } from '../errorUtils'; // Import the error utility

/**
 * Extracts text content from a PDF URL.
 * It fetches the PDF as a binary buffer and then uses `pdf-parse` to extract text.
 *
 * @param {string} url - The URL of the PDF document.
 * @param {Logger} [logger] - Optional Pino logger instance for detailed logging.
 * @returns {Promise<string | null>} A Promise that resolves with the extracted text content
 *                                   or null if an error occurs during fetching or parsing.
 */
export async function extractTextFromPDF(url: string, logger?: Logger): Promise<string | null> {
    const logContext = `[PDF Utility][${url}]`;
    logger?.trace({ url, event: 'extractTextFromPDF_start', context: logContext });

    try {
        const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 30000 }); // 30-second timeout

        if (response.status !== 200) {
            const statusMessage = `Failed to fetch PDF: HTTP Status ${response.status}.`;
            logger?.warn({ url, status: response.status, event: 'extractTextFromPDF_http_error', context: logContext }, statusMessage);
            return null; // Return null on non-200 status
        }

        const data = await pdf(response.data); // pdf-parse can throw errors internally
        logger?.trace({ url, pages: data.numpages, event: 'extractTextFromPDF_success', context: logContext }, `Successfully extracted text from PDF. Pages: ${data.numpages}.`);
        return data.text || null; // Return text or null if text is empty
    } catch (error: unknown) { // Catch as unknown
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        logger?.error({
            url,
            err: { message: errorMessage, stack: errorStack }, // Log extracted error details
            event: 'extractTextFromPDF_failed',
            context: logContext
        }, `Failed to extract text from PDF: "${errorMessage}".`);
        return null; // Return null on any error during the process
    }
}