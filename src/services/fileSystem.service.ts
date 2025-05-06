// src/services/fileSystem.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { ConferenceData, ProcessedRowData } from '../types/crawl.types'; // Import types
import { v4 as uuidv4 } from 'uuid';

@singleton()
export class FileSystemService {
    private readonly logger: Logger;
    private readonly finalJsonlPath: string;
    private readonly evaluateCsvPath: string;
    private readonly conferenceListPath: string;
    private readonly customSearchDir: string;
    private readonly baseOutputDir: string;
    private readonly tempDir: string; // Get from config

    // Thêm các path khác nếu cần

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.logger = this.loggingService.getLogger({ service: 'FileSystemService' });
        this.finalJsonlPath = this.configService.finalOutputJsonlPath;
        this.evaluateCsvPath = this.configService.evaluateCsvPath;
        this.conferenceListPath = this.configService.conferenceListPath;
        this.customSearchDir = this.configService.customSearchDir;
        this.baseOutputDir = this.configService.baseOutputDir;
        this.tempDir = this.configService.tempDir; // Ensure tempDir is set
    }

    async prepareOutputArea(): Promise<void> {
        this.logger.info("Preparing output area...");
        try {
            // Đảm bảo thư mục gốc tồn tại
            if (!fs.existsSync(this.baseOutputDir)) {
                this.logger.info({ path: this.baseOutputDir }, "Creating base output directory.");
                await fs.promises.mkdir(this.baseOutputDir, { recursive: true });
            }

            // Xóa file output cũ
            await this.deleteFileIfExists(this.finalJsonlPath, 'final output JSONL');
            await this.deleteFileIfExists(this.evaluateCsvPath, 'evaluation CSV');

            // Đảm bảo các thư mục con tồn tại (ví dụ)
            await this.ensureDirExists(this.customSearchDir);
            // await this.ensureDirExists(this.configService.batchesDir); // Nếu vẫn cần

            this.logger.info("Output area prepared.");
        } catch (error) {
            this.logger.error({ err: error }, "Failed to prepare output area.");
            throw error;
        }
    }

    async writeConferenceInputList(conferenceList: ConferenceData[]): Promise<void> {
        this.logger.debug({ path: this.conferenceListPath, count: conferenceList.length }, 'Writing initial conference list');
        try {
            await this.ensureDirExists(path.dirname(this.conferenceListPath));
            await fs.promises.writeFile(this.conferenceListPath, JSON.stringify(conferenceList, null, 2), "utf8");
        } catch (writeFileError: any) {
            this.logger.warn({ err: writeFileError, path: this.conferenceListPath }, `Could not write initial conference list`);
            // Decide if this is critical enough to throw
        }
    }

    async writeCustomSearchResults(acronym: string, links: string[]): Promise<void> {
        const safeAcronym = acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const outputPath = path.join(this.customSearchDir, `${safeAcronym}_links.json`);
        this.logger.debug({ path: outputPath, count: links.length }, 'Writing search result links');
        try {
            await this.ensureDirExists(this.customSearchDir); // Đảm bảo thư mục tồn tại
            await fs.promises.writeFile(outputPath, JSON.stringify(links, null, 2), "utf8");
        } catch (writeLinksError: any) {
            this.logger.warn({ err: writeLinksError, path: outputPath }, `Could not write search result links file for ${acronym}`);
        }
    }

    async readFileContent(filePath: string): Promise<string> {
        this.logger.trace({ filePath, event: 'readFileContent_start' });
        try {
            if (!filePath) throw new Error("File path cannot be empty.");
            // Basic security check (optional, adjust as needed)
            // if (!filePath.startsWith(this.configService.baseOutputDir) && !filePath.startsWith(this.tempDir)) {
            //     throw new Error(`Access denied for path: ${filePath}`);
            // }
            const content = await fs.promises.readFile(filePath, 'utf8');
            this.logger.trace({ filePath, length: content.length, event: 'readFileContent_success' });
            return content;
        } catch (error) {
            this.logger.error({ filePath, err: error, event: 'readFileContent_failed' });
            throw error; // Re-throw
        }
    }


    async saveTemporaryFile(content: string, baseName: string): Promise<string> {
        const logContext = { baseName, tempDir: this.tempDir };
        this.logger.trace({ ...logContext, event: 'saveTemporaryFile_start' });
        try {
            if (!content) throw new Error("Content cannot be empty.");
            if (!baseName) throw new Error("Base name cannot be empty.");
            // Sanitize baseName further if needed
            const uniqueId = uuidv4();

            const safeBaseName = baseName.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const fileName = `${safeBaseName}_${uniqueId}.txt`;
            const filePath = path.join(this.tempDir, fileName);

            await this.ensureDirExists(this.tempDir); // Ensure temp dir exists
            await fs.promises.writeFile(filePath, content, 'utf8');
            this.logger.trace({ ...logContext, filePath, event: 'saveTemporaryFile_success' });
            return filePath;
        } catch (error) {
            this.logger.error({ ...logContext, err: error, event: 'saveTemporaryFile_failed' });
            throw error; // Re-throw
        }
    }

    // Hàm để ghi nối vào file JSONL (quan trọng cho luồng SAVE)
    // Đảm bảo hàm này an toàn khi gọi đồng thời (appendFile thường là atomic)
    async appendFile(filePath: string, data: string): Promise<void> {
        const logContext = { filePath };
        this.logger.trace({ ...logContext, event: 'appendFile_start' });
        try {
            if (!filePath) throw new Error("File path cannot be empty.");
            // Add security checks if needed
            await this.ensureDirExists(path.dirname(filePath)); // Ensure directory exists
            await fs.promises.appendFile(filePath, data, 'utf8');
            this.logger.trace({ ...logContext, event: 'appendFile_success' });
        } catch (error) {
            this.logger.error({ ...logContext, err: error, event: 'appendFile_failed' });
            throw error;
        }
    }

    // Hàm tiện ích để xóa file nếu tồn tại
    private async deleteFileIfExists(filePath: string, description: string): Promise<void> {
        try {
            if (fs.existsSync(filePath)) {
                this.logger.warn({ path: filePath }, `Deleting existing ${description} file.`);
                await fs.promises.unlink(filePath);
            }
        } catch (unlinkError: any) {
            this.logger.error({ err: unlinkError, path: filePath }, `Could not delete existing ${description} file.`);
            throw unlinkError; // Ném lỗi nếu xóa thất bại có thể gây vấn đề
        }
    }

    /**
    * Writes content to a file, ensuring the parent directory exists.
    * @param filePath The full path to the file to write.
    * @param content The string content to write.
    * @param encoding The file encoding (defaults to 'utf8').
    */
    async writeFile(filePath: string, content: string, encoding: BufferEncoding = 'utf8'): Promise<void> {
        const logContext = { filePath, encoding };
        this.logger.trace({ ...logContext, event: 'writeFile_start' });
        try {
            if (!filePath) throw new Error("File path cannot be empty for writeFile.");
            // Add security checks if desired (e.g., check if path is within allowed base dirs)

            const dir = path.dirname(filePath);
            await this.ensureDirExists(dir); // Ensure parent directory exists

            await fs.promises.writeFile(filePath, content, encoding);
            this.logger.trace({ ...logContext, contentLength: content.length, event: 'writeFile_success' });

        } catch (error) {
            this.logger.error({ ...logContext, err: error, event: 'writeFile_failed' });
            // Re-throw the error so the caller knows the write failed
            throw error;
        }
    }


    // Hàm tiện ích để đảm bảo thư mục tồn tại
    public async ensureDirExists(dirPath: string): Promise<void> {
        try {
            if (!fs.existsSync(dirPath)) {
                this.logger.info({ path: dirPath }, `Creating directory.`);
                await fs.promises.mkdir(dirPath, { recursive: true });
            }
        } catch (mkdirError: any) {
            this.logger.error({ err: mkdirError, path: dirPath }, `Error creating directory`);
            throw mkdirError;
        }
    }

    // Có thể thêm hàm cleanupTempFiles nếu cần
    async cleanupTempFiles(): Promise<void> {
        // Logic dọn dẹp từ utils cũ (nếu có)
        this.logger.info("Performing temporary file cleanup (implement if needed)...");
        // Ví dụ: Xóa thư mục temp
        const tempDirPath = this.configService.tempDir;
        if (fs.existsSync(tempDirPath)) {
            await fs.promises.rm(tempDirPath, { recursive: true, force: true });
            this.logger.info({ path: tempDirPath }, "Removed temporary directory.");
        }
    }
}