// src/services/resultProcessing.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { ProcessedRowData } from '../types/crawl.types';
import { writeCSVAndCollectData as originalWriteCSV } from '../utils/crawl/responseProcessing';
// -----------------------------------------

@singleton()
export class ResultProcessingService {
    private readonly logger: Logger;
    private readonly finalJsonlPath: string;
    private readonly evaluateCsvPath: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.logger = this.loggingService.getLogger({ service: 'ResultProcessingService' });
        this.finalJsonlPath = this.configService.finalOutputJsonlPath;
        this.evaluateCsvPath = this.configService.evaluateCsvPath;
    }

    /**
     * Xử lý file JSONL cuối cùng để tạo CSV và thu thập dữ liệu trả về.
     * Giả định hàm gốc `originalWriteCSV` trả về mảng ProcessedRowData.
     */
    async processOutput(): Promise<ProcessedRowData[]> {
        this.logger.info({ jsonlPath: this.finalJsonlPath, csvPath: this.evaluateCsvPath }, "Processing final output (JSONL to CSV and data collection)...");

        // Kiểm tra xem file JSONL có tồn tại và có nội dung không
        try {
             const stats = await fs.promises.stat(this.finalJsonlPath);
             if (stats.size === 0) {
                 this.logger.warn({ path: this.finalJsonlPath }, "Final JSONL file is empty. No CSV will be generated, returning empty results.");
                 // Tạo file CSV rỗng với header nếu cần
                 // await fs.promises.writeFile(this.evaluateCsvPath, "Acronym,Title,...\n"); // Thay bằng header thực tế
                 return [];
             }
        } catch (error: any) {
             if (error.code === 'ENOENT') {
                 this.logger.warn({ path: this.finalJsonlPath }, "Final JSONL file not found. No CSV will be generated, returning empty results.");
                 return [];
             }
             this.logger.error({ err: error, path: this.finalJsonlPath }, "Error checking final JSONL file stats.");
             throw error; // Ném lỗi nếu không phải lỗi không tìm thấy file
        }


        try {
             // *** GỌI HÀM GỐC HOẶC LOGIC TƯƠNG ĐƯƠNG ***
             // Hàm này cần đường dẫn file input/output và logger
             const collectedData = await originalWriteCSV(
                 this.finalJsonlPath,
                 this.evaluateCsvPath,
                 this.logger // Truyền logger con hoặc logger chính
             );
             this.logger.info({ csvPath: this.evaluateCsvPath, collectedCount: collectedData.length }, 'CSV streaming and data collection completed.');
             return collectedData;
        } catch (streamCollectError: any) {
             this.logger.error({ err: streamCollectError }, `Final output processing (CSV streaming/collection) failed`);
             // Quyết định xem có nên ném lỗi hay trả về mảng rỗng
             // throw streamCollectError;
             return []; // Trả về rỗng để báo hiệu có lỗi nhưng không dừng hẳn
        }
    }
}