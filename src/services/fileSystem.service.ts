// src/services/fileSystem.service.ts
import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import fs from 'fs';
import path from 'path';
import { ConfigService } from '../config/config.service';
import { LoggingService } from './logging.service';
import { Logger } from 'pino';
import { ConferenceData } from '../types/crawl/crawl.types'; // ProcessedRowData không dùng ở đây
import { v4 as uuidv4 } from 'uuid';

@singleton()
export class FileSystemService {
    private readonly serviceBaseLogger: Logger; // Logger cơ sở cho service, không có context request
    private readonly conferenceListPath: string;
    private readonly customSearchDir: string;
    private readonly baseOutputDir: string;
    private readonly tempDir: string;

    constructor(
        @inject(ConfigService) private configService: ConfigService,
        @inject(LoggingService) private loggingService: LoggingService,
    ) {
        this.serviceBaseLogger = this.loggingService.getLogger('conference', { service: 'FileSystemServiceBase' });
        this.conferenceListPath = this.configService.conferenceListPath;
        this.customSearchDir = this.configService.customSearchDir;
        this.baseOutputDir = this.configService.baseOutputDir;
        this.tempDir = this.configService.tempDir;

        this.serviceBaseLogger.info("FileSystemService initialized.");
    }

    // Helper để tạo logger cho phương thức với context từ parentLogger
    private getMethodLogger(parentLogger: Logger | undefined, methodName: string): Logger {
        const base = parentLogger || this.serviceBaseLogger;
        return base.child({ serviceMethod: `FileSystemService.${methodName}` });
    }

    // parentLogger có thể là optional, nếu không truyền, dùng serviceBaseLogger
    async prepareOutputArea(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'prepareOutputArea');
        logger.info("Preparing output area...");
        try {
            if (!fs.existsSync(this.baseOutputDir)) {
                logger.info({ path: this.baseOutputDir }, "Creating base output directory.");
                await fs.promises.mkdir(this.baseOutputDir, { recursive: true });
            }

            // await this.deleteFileIfExists(this.finalJsonlPath, 'final output JSONL', logger);
            // await this.deleteFileIfExists(this.evaluateCsvPath, 'evaluation CSV', logger);
            await this.ensureDirExists(this.customSearchDir, logger);

            logger.info("Output area prepared.");
        } catch (error) {
            logger.error({ err: error }, "Failed to prepare output area.");
            throw error;
        }
    }

    async writeConferenceInputList(conferenceList: ConferenceData[], parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'writeConferenceInputList');
        logger.debug({ path: this.conferenceListPath, count: conferenceList.length }, 'Writing initial conference list');
        try {
            await this.ensureDirExists(path.dirname(this.conferenceListPath), logger);
            await fs.promises.writeFile(this.conferenceListPath, JSON.stringify(conferenceList, null, 2), "utf8");
        } catch (writeFileError: any) {
            logger.warn({ err: writeFileError, path: this.conferenceListPath }, `Could not write initial conference list`);
        }
    }

    async writeCustomSearchResults(acronym: string, links: string[], parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'writeCustomSearchResults');
        const safeAcronym = acronym.replace(/[^a-zA-Z0-9_.-]/g, '-');
        const outputPath = path.join(this.customSearchDir, `${safeAcronym}_links.json`);
        logger.debug({ path: outputPath, count: links.length }, 'Writing search result links');
        try {
            await this.ensureDirExists(this.customSearchDir, logger);
            await fs.promises.writeFile(outputPath, JSON.stringify(links, null, 2), "utf8");
        } catch (writeLinksError: any) {
            logger.warn({ err: writeLinksError, path: outputPath }, `Could not write search result links file for ${acronym}`);
        }
    }

    async readFileContent(filePath: string, parentLogger?: Logger): Promise<string> {
        const logger = this.getMethodLogger(parentLogger, 'readFileContent');
        logger.trace({ filePath, event: 'readFileContent_start' });
        try {
            if (!filePath) throw new Error("File path cannot be empty.");
            const content = await fs.promises.readFile(filePath, 'utf8');
            logger.trace({ filePath, length: content.length, event: 'readFileContent_success' });
            return content;
        } catch (error) {
            logger.error({ filePath, err: error, event: 'readFileContent_failed' });
            throw error;
        }
    }

    async saveTemporaryFile(content: string, baseName: string, parentLogger?: Logger): Promise<string> {
        const logger = this.getMethodLogger(parentLogger, 'saveTemporaryFile');
        const logContext = { baseName, tempDir: this.tempDir };
        logger.trace({ ...logContext, event: 'saveTemporaryFile_start' });
        try {
            if (!content) throw new Error("Content cannot be empty.");
            if (!baseName) throw new Error("Base name cannot be empty.");
            const uniqueId = uuidv4();
            const safeBaseName = baseName.replace(/[^a-zA-Z0-9_.-]/g, '_');
            const fileName = `${safeBaseName}_${uniqueId}.txt`;
            const filePath = path.join(this.tempDir, fileName);

            await this.ensureDirExists(this.tempDir, logger);
            await fs.promises.writeFile(filePath, content, 'utf8');
            logger.trace({ ...logContext, filePath, event: 'saveTemporaryFile_success' });
            return filePath;
        } catch (error) {
            logger.error({ ...logContext, err: error, event: 'save_batch_write_file_failed', fileType: `temp_content_${baseName}` });
            throw error;
        }
    }

    async appendFile(filePath: string, data: string, parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'appendFile');
        const logContext = { filePath };
        logger.trace({ ...logContext, event: 'appendFile_start' });
        try {
            if (!filePath) throw new Error("File path cannot be empty.");
            await this.ensureDirExists(path.dirname(filePath), logger);
            await fs.promises.appendFile(filePath, data, 'utf8');
            logger.trace({ ...logContext, event: 'appendFile_success' });
        } catch (error) {
            logger.error({ ...logContext, err: error, event: 'appendFile_failed' });
            throw error;
        }
    }

    private async deleteFileIfExists(filePath: string, description: string, logger: Logger): Promise<void> {
        // logger này được truyền từ phương thức gọi nó (đã có context đúng)
        try {
            if (fs.existsSync(filePath)) {
                logger.warn({ path: filePath }, `Deleting existing ${description} file.`);
                await fs.promises.unlink(filePath);
            }
        } catch (unlinkError: any) {
            logger.error({ err: unlinkError, path: filePath }, `Could not delete existing ${description} file.`);
            throw unlinkError;
        }
    }

    async writeFile(filePath: string, content: string, parentLogger?: Logger, encoding: BufferEncoding = 'utf8'): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'writeFile');
        const logContext = { filePath, encoding };
        logger.trace({ ...logContext, event: 'writeFile_start' });
        try {
            if (!filePath) throw new Error("File path cannot be empty for writeFile.");
            const dir = path.dirname(filePath);
            await this.ensureDirExists(dir, logger);
            await fs.promises.writeFile(filePath, content, encoding);
            logger.trace({ ...logContext, contentLength: content.length, event: 'writeFile_success' });
        } catch (error) {
            logger.error({ ...logContext, err: error, event: 'save_batch_write_file_failed' });
            throw error;
        }
    }

    public async ensureDirExists(dirPath: string, logger: Logger): Promise<void> {
        // logger này được truyền từ phương thức gọi nó (đã có context đúng)
        // hoặc là logger mặc định nếu được gọi từ bên trong mà không có context cụ thể
        const effectiveLogger = logger || this.serviceBaseLogger.child({ serviceMethod: 'ensureDirExistsInternal' });
        try {
            if (!fs.existsSync(dirPath)) {
                effectiveLogger.info({ path: dirPath }, `Creating directory.`);
                await fs.promises.mkdir(dirPath, { recursive: true });
            }
        } catch (mkdirError: any) {
            effectiveLogger.error({ err: mkdirError, path: dirPath }, `Error creating directory`);
            throw mkdirError;
        }
    }

    async cleanupTempFiles(parentLogger?: Logger): Promise<void> {
        const logger = this.getMethodLogger(parentLogger, 'cleanupTempFiles');
        logger.info("Performing temporary file cleanup...");
        const tempDirPath = this.configService.tempDir;
        if (fs.existsSync(tempDirPath)) {
            try {
                await fs.promises.rm(tempDirPath, { recursive: true, force: true });
                logger.info({ path: tempDirPath }, "Removed temporary directory.");
            } catch (rmError) {
                logger.error({ err: rmError, path: tempDirPath }, "Failed to remove temporary directory.")
            }
        } else {
            logger.info({ path: tempDirPath }, "Temporary directory does not exist, no cleanup needed.")
        }
    }
}