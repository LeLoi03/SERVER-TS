// src/utils/pdf.utils.ts
import pdf from 'pdf-parse'; 
import axios from 'axios'; 
import { Logger } from 'pino'; 

/**
 * Extracts text content from a PDF URL.
 */
export async function extractTextFromPDF(url: string, logger?: Logger): Promise<string | null> {
    logger?.trace({ url, event: 'extractTextFromPDF_start' });
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        if (response.status !== 200) {
            throw new Error(`Failed to fetch PDF: Status ${response.status}`);
        }
        const data = await pdf(response.data);
        logger?.trace({ url, pages: data.numpages, event: 'extractTextFromPDF_success' });
        return data.text || null;
    } catch (error) {
        logger?.error({ url, err: error, event: 'extractTextFromPDF_failed' });
        return null; // Return null on error
    }
}