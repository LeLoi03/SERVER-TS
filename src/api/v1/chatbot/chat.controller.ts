// src/api/v1/chat/chat.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import {
    GoogleGenAI,
    File as GoogleFileSDK,
    FileState,
    UploadFileParameters,
    // UploadFileConfig // Không cần import trực tiếp nếu dùng trong UploadFileParameters
} from '@google/genai';
import { Logger } from 'pino';
import { ConfigService } from '../../../config/config.service';
import { LoggingService } from '../../../services/logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import multer from 'multer';
import { File as NodeFile } from 'node:buffer';

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

interface UploadedFileResponse {
    name: string;           // Tên file gốc từ client (file.originalname)
    uri: string | undefined;            // URI từ Google File API (quan trọng nhất)
    mimeType: string;       // MimeType (ưu tiên từ Google, fallback từ client)
    size: number;           // Kích thước file gốc từ client (file.size)
    // Các trường tùy chọn từ Google nếu muốn theo dõi/debug:
    googleFileDisplayName?: string;
    googleFileName?: string; // Tên resource trên Google (vd: files/xxxx)
    googleFileState?: FileState;
    googleSizeBytes?: string; // Kích thước từ Google (là string)
}

// Interface cho file upload thành công (chỉ chứa các trường cần thiết cho client)
interface ClientReadyFilePartData {
    name: string;       // Tên file gốc
    uri: string;        // URI từ Google
    mimeType: string;   // MimeType
    size: number;       // Kích thước gốc
}


export class ChatController {
    private readonly logger: Logger;
    private readonly configService: ConfigService;
    private genAI: GoogleGenAI;

    constructor() {
        this.configService = container.resolve(ConfigService);
        const loggingService = container.resolve(LoggingService);
        this.logger = loggingService.getLogger().child({ context: 'ChatController' });

        const apiKey = this.configService.config.GEMINI_API_KEY;
        if (!apiKey) {
            this.logger.error('GEMINI_API_KEY is not configured. File uploads will fail.');
            throw new Error('GEMINI_API_KEY is not configured.');
        }
        this.genAI = new GoogleGenAI({ apiKey });
    }

    public async handleFileUpload(req: Request, res: Response): Promise<void> {
        const reqLogger = (req as any).log || this.logger;
        reqLogger.info('File upload request received.');

        if (!req.files || (Array.isArray(req.files) && req.files.length === 0)) {
            reqLogger.warn('No files were uploaded.');
            res.status(400).json({ message: 'No files uploaded.' });
            return;
        }

        const files = req.files as Express.Multer.File[];
        const uploadPromises: Promise<UploadedFileResponse | null>[] = []; // Có thể là null nếu lỗi nghiêm trọng

        for (const file of files) {
            reqLogger.info(`Processing file: ${file.originalname}, size: ${file.size}, mimetype: ${file.mimetype}`);
            uploadPromises.push(this.uploadFileToGoogle(file, reqLogger));
        }

        try {
            const results = await Promise.all(uploadPromises);
            // Lọc ra những file upload thành công và có URI
            const successfulUploads: ClientReadyFilePartData[] = results
                .filter((r): r is UploadedFileResponse => r !== null && r.uri !== undefined && r.uri !== '')
                .map(r => ({ // Chỉ chọn các trường cần thiết cho client để tạo Part
                    name: r.name,
                    uri: r.uri!, // Đã filter nên uri chắc chắn có
                    mimeType: r.mimeType,
                    size: r.size,
                }));

            if (successfulUploads.length === 0 && files.length > 0) {
                reqLogger.error('All file uploads to Google File API failed to get a URI.');
                // Trả về mảng results đầy đủ để client có thể thấy lỗi từng file nếu muốn
                res.status(500).json({
                    message: 'Failed to upload any files to Google File API meaningfully.',
                    files: results.filter(r => r !== null) // Loại bỏ null nếu có
                });
                return;
            }
            if (successfulUploads.length < files.length) {
                reqLogger.warn('Some files failed to upload to Google File API or did not return a URI.');
                res.status(207).json({ // 207 Multi-Status
                    message: 'Some files were processed, some failed.',
                    files: results.filter(r => r !== null), // Client sẽ check từng file
                    successfulFiles: successfulUploads // Client có thể dùng mảng này trực tiếp
                });
                return;
            }

            reqLogger.info(`Successfully uploaded ${successfulUploads.length} files to Google File API.`);
            res.status(200).json({
                message: 'All files uploaded successfully.',
                files: successfulUploads, // Chỉ trả về các file thành công với cấu trúc ClientReadyFilePartData
            });
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            reqLogger.error({ err: { message, stack } }, 'Error processing file uploads.');
            res.status(500).json({ message: 'An error occurred during file upload.', error: message });
        }
    }

    private async uploadFileToGoogle(
        file: Express.Multer.File,
        logger: Logger
    ): Promise<UploadedFileResponse | null> { // Return null on critical failure
        try {
            logger.info(`Preparing ${file.originalname} for Google File API upload...`);
            const nodeJsFile = new NodeFile([file.buffer], file.originalname, { type: file.mimetype });

            const params: UploadFileParameters = {
                file: nodeJsFile as unknown as globalThis.Blob, // Cast vì SDK type có thể hơi khác
                config: {
                    displayName: file.originalname,
                    mimeType: file.mimetype,
                }
            };

            logger.info(`Uploading ${file.originalname} (${file.mimetype}, ${file.size} bytes) to Google File API.`);
            const googleFileResult: GoogleFileSDK = await this.genAI.files.upload(params);
            logger.info(`File ${file.originalname} processed by Google. Name: ${googleFileResult.name}, URI: ${googleFileResult.uri}, State: ${googleFileResult.state}, DisplayName: ${googleFileResult.displayName}`);

            if (!googleFileResult.uri) {
                logger.error(`Google File API did not return a URI for ${file.originalname}. State: ${googleFileResult.state}. Google Name: ${googleFileResult.name}`);
                // Trả về object với uri undefined để client biết file này lỗi
                return {
                    name: file.originalname,
                    uri: undefined,
                    mimeType: googleFileResult.mimeType || file.mimetype,
                    size: file.size,
                    googleFileDisplayName: googleFileResult.displayName,
                    googleFileName: googleFileResult.name,
                    googleFileState: googleFileResult.state,
                    googleSizeBytes: googleFileResult.sizeBytes,
                };
            }

            return {
                name: file.originalname,
                uri: googleFileResult.uri,
                mimeType: googleFileResult.mimeType || file.mimetype,
                size: file.size,
                googleFileDisplayName: googleFileResult.displayName,
                googleFileName: googleFileResult.name,
                googleFileState: googleFileResult.state,
                googleSizeBytes: googleFileResult.sizeBytes,
            };
        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            logger.error({ err: { message, stack }, fileName: file.originalname }, `Failed to upload ${file.originalname} to Google File API.`);
            // Trả về object với uri undefined cho file lỗi này
            return {
                name: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                uri: undefined, // Đánh dấu lỗi
            };
        }
    }
}

export const filesUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 * 1024 }
}).array('files', 5);