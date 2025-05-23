// src/services/databasePersistence.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import axios, { AxiosError, toFormData } from 'axios';
import fs from 'fs';
import { createReadStream } from 'fs';
// import path from 'path'; // path không được sử dụng, có thể bỏ
import { ConfigService, AppConfig } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';

export interface DatabaseSaveResult {
    success: boolean;
    message: string;
    statusCode?: number;
    data?: any;
    error?: string;
}

@singleton()
export class DatabasePersistenceService {
    private readonly config: AppConfig;
    private readonly baseLogger: Logger;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.config = this.configService.config;
        this.baseLogger = this.loggingService.getLogger({ service: 'DatabasePersistenceServiceBase' });
    }

    public async saveEvaluatedData(parentLogger: Logger): Promise<DatabaseSaveResult> {
        const logger = parentLogger.child({ service: 'DatabasePersistenceSaveEvaluated' });
        const csvFilePath = this.configService.evaluateCsvPath;
        const apiUrl = `${this.config.DATABASE_URL}${this.config.DATABASE_IMPORT_ENDPOINT}`;

        logger.info({ csvFilePath, apiUrl, event: 'db_save_initiated' }, `Attempting to save evaluated data from CSV to database.`);

        if (!fs.existsSync(csvFilePath)) {
            logger.error({ csvFilePath, event: 'db_save_file_not_found' }, "CSV file not found. Cannot save to database.");
            return {
                success: false,
                message: `CSV file not found at ${csvFilePath}`,
                error: 'File not found'
            };
        }
        // Kiểm tra file có rỗng không (chỉ có header hoặc hoàn toàn rỗng)
        // Có thể bạn muốn gửi cả file chỉ có header
        const stats = fs.statSync(csvFilePath);
        if (stats.size === 0) { // Hoặc kiểm tra cụ thể hơn nếu có header
             logger.warn({ csvFilePath, event: 'db_save_file_empty' }, "CSV file is empty. Proceeding with save attempt if configured.");
            // Quyết định xem có nên gửi file rỗng hay không. Hiện tại vẫn gửi.
        }


        try {
            const fileStream = createReadStream(csvFilePath);
            const formData = toFormData({
                file: fileStream
            });

            logger.info({ event: 'db_save_request_sending' }, `Sending POST request to ${apiUrl}`);
            const response = await axios.post(apiUrl, formData, {
                headers: {
                    "Content-Type": "multipart/form-data",
                },
            });

            console.log(response);
            logger.info({
                event: 'db_save_success',
                statusCode: response.status,
                responseData: response.data
            }, "Successfully saved data to database API.");

            return {
                success: true,
                message: "Data saved successfully to database.",
                statusCode: response.status,
                data: response.data
            };

        } catch (error: any) {
            let errorMessage = "Failed to save data to database API.";
            let errorDetails: any = { originalError: error.message };
            let statusCode: number | undefined;

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                errorMessage = `Axios error: ${axiosError.message}`;
                statusCode = axiosError.response?.status;
                errorDetails = {
                    message: axiosError.message,
                    code: axiosError.code,
                    status: axiosError.response?.status,
                    responseData: axiosError.response?.data,
                    requestUrl: axiosError.config?.url,
                    requestMethod: axiosError.config?.method,
                };
            }

            logger.error({
                event: 'db_save_failed',
                err: errorDetails,
                stack: error.stack,
                csvFilePath,
                apiUrl
            }, errorMessage);

            return {
                success: false,
                message: errorMessage,
                statusCode,
                error: errorDetails.message || 'Unknown error',
                data: errorDetails.responseData
            };
        }
    }
}
