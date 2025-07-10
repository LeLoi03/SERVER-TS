// src/services/logDownload.service.ts

import { singleton, inject } from 'tsyringe';
import fs from 'fs/promises';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { CrawlerType } from './logDeletion.service';

export interface FileDownloadResult {
    success: boolean;
    filePath?: string;
    content?: Buffer;
    fileName?: string;
    error?: string;
    statusCode?: number;
}

@singleton()
export class LogDownloadService {
    private logger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) loggingService: LoggingService
    ) {
        this.logger = loggingService.getLogger('app').child({ service: 'LogDownloadService' });
    }

    public async getOutputFile(requestId: string, crawlerType: CrawlerType): Promise<FileDownloadResult> {
        this.logger.info({ requestId, crawlerType }, 'Request to download output file.');

        // Hiện tại, chúng ta chỉ hỗ trợ download cho 'conference'
        if (crawlerType !== 'conference') {
            const message = `File download is not supported for crawler type: ${crawlerType}`;
            this.logger.warn({ requestId, crawlerType }, message);
            return { success: false, error: message, statusCode: 400 };
        }

        const filePath = this.configService.getEvaluateCsvPathForBatch(requestId);
        const fileName = `output_${requestId}.csv`;

        try {
            // Kiểm tra file có tồn tại không
            await fs.access(filePath);
            
            // Đọc nội dung file
            const content = await fs.readFile(filePath);
            this.logger.info({ requestId, filePath }, 'Successfully read output file for download.');
            
            return {
                success: true,
                filePath,
                content,
                fileName,
            };

        } catch (err: any) {
            if (err.code === 'ENOENT') {
                const message = `Output file for request ID ${requestId} not found.`;
                this.logger.warn({ requestId, filePath }, message);
                return { success: false, error: message, statusCode: 404, filePath };
            }
            
            const message = `Error reading file for request ID ${requestId}.`;
            this.logger.error({ err, requestId, filePath }, message);
            return { success: false, error: message, statusCode: 500, filePath };
        }
    }
}