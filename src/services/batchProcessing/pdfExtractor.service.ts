// src/services/pdfExtractor.service.ts
import { singleton, inject } from 'tsyringe';
import pdf from 'pdf-parse';
import axios from 'axios';
import { Logger } from 'pino';
import { ConfigService } from '../../config';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

export interface IPdfExtractorService {
    extractTextFromPDF(url: string, logger?: Logger): Promise<string | null>;
}

@singleton()
export class PdfExtractorService implements IPdfExtractorService {
    private readonly userAgent: string;

    // Inject ConfigService vào constructor
    constructor(@inject(ConfigService) private configService: ConfigService) {
        // Lấy userAgent từ config và lưu lại
        this.userAgent = this.configService.playwrightConfig.userAgent || 
                         'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    }

    public async extractTextFromPDF(url: string, logger?: Logger): Promise<string | null> {
        const logContext = `[PDF Extractor Service][${url}]`;
        logger?.trace({ url, event: 'extractTextFromPDF_start', context: logContext });

        try {
            const response = await axios.get(url, {
                responseType: 'arraybuffer',
                timeout: 30000,
                headers: {
                    // Sử dụng userAgent đã được load từ config
                    'User-Agent': this.userAgent 
                }
            });

            if (response.status !== 200) {
                const statusMessage = `Failed to fetch PDF: HTTP Status ${response.status}.`;
                logger?.warn({ url, status: response.status, event: 'extractTextFromPDF_http_error', context: logContext }, statusMessage);
                return null;
            }

            const data = await pdf(response.data);
            logger?.trace({ url, pages: data.numpages, event: 'extractTextFromPDF_success', context: logContext }, `Successfully extracted text from PDF. Pages: ${data.numpages}.`);
            return data.text || null;
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logger?.error({
                url,
                err: { message: errorMessage, stack: errorStack },
                event: 'extractTextFromPDF_failed',
                context: logContext
            }, `Failed to extract text from PDF: "${errorMessage}".`);
            return null;
        }
    }
}