// src/api/v1/chat/chat.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import {
    GoogleGenAI,
    File as GoogleFileSDK,
    FileState,
    UploadFileParameters,
} from '@google/genai';
import { Logger } from 'pino';
import { ConfigService } from '../../../config/config.service'; // Correct path
import { LoggingService } from '../../../services/logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import multer from 'multer';
import { File as NodeFile } from 'node:buffer';
// <<< NEW IMPORTS
import path from 'path';
import fs from 'fs/promises';
import { createObjectCsvWriter } from 'csv-writer';

// Điều chỉnh giới hạn file size lên 50MB
const MAX_FILE_SIZE_MB = 50;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

interface UploadedFileResponse {
    name: string;           // Tên file gốc từ client (file.originalname)
    uri: string | undefined;            // URI từ Google File API (quan trọng nhất)
    mimeType: string;       // MimeType (ưu tiên từ Google, fallback từ client)
    size: number;           // Kích thước file gốc từ client (file.size)
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
    // <<< NEW: Path for feedback file
    private readonly feedbackCsvPath: string;

    constructor() {
        this.configService = container.resolve(ConfigService);
        const loggingService = container.resolve(LoggingService);
        this.logger = loggingService.getLogger().child({ context: 'ChatController' });

        // Use the specific getter for the primary Gemini API key
        const apiKey = this.configService.primaryGeminiApiKey;
        if (!apiKey) {
            this.logger.error('GEMINI_API_KEY is not configured. File uploads will fail.');
            throw new Error('GEMINI_API_KEY is not configured.');
        }
        // The GoogleGenAI constructor expects an object with an apiKey property
        this.genAI = new GoogleGenAI({ apiKey });
        // <<< NEW: Initialize feedback file path
        // Lưu file trong thư mục `data` ở gốc dự án để tránh bị xóa khi build lại
        this.feedbackCsvPath = path.join(process.cwd(), 'data', 'feedback', 'chatbot_feedback.csv');
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
        const uploadPromises: Promise<UploadedFileResponse | null>[] = [];

        for (const file of files) {
            reqLogger.info(`Processing file: ${file.originalname}, size: ${file.size}, mimetype: ${file.mimetype}`);
            if (file.size > MAX_FILE_SIZE_BYTES) {
                reqLogger.warn(`File ${file.originalname} (${file.size} bytes) exceeds the maximum allowed size of ${MAX_FILE_SIZE_MB}MB.`);
                uploadPromises.push(
                    Promise.resolve({
                        name: file.originalname,
                        uri: undefined,
                        mimeType: file.mimetype,
                        size: file.size,
                        googleFileState: FileState.FAILED,
                        googleFileDisplayName: 'File too large',
                        googleFileName: undefined,
                        googleSizeBytes: String(file.size),
                    })
                );
                continue;
            }
            uploadPromises.push(this.uploadFileToGoogle(file, reqLogger));
        }

        try {
            const results = await Promise.all(uploadPromises);
            const successfulUploads: ClientReadyFilePartData[] = results
                .filter((r): r is UploadedFileResponse => r !== null && r.uri !== undefined && r.uri !== '')
                .map(r => ({
                    name: r.name,
                    uri: r.uri!,
                    mimeType: r.mimeType,
                    size: r.size,
                }));

            if (successfulUploads.length === 0 && files.length > 0) {
                reqLogger.error('All file uploads to Google File API failed to get a URI or were too large.');
                res.status(500).json({
                    message: 'Failed to upload any files to Google File API meaningfully or files were too large.',
                    files: results.filter(r => r !== null)
                });
                return;
            }
            if (successfulUploads.length < files.length) {
                reqLogger.warn('Some files failed to upload to Google File API, did not return a URI, or were too large.');
                res.status(207).json({
                    message: 'Some files were processed, some failed.',
                    files: results.filter(r => r !== null),
                    successfulFiles: successfulUploads
                });
                return;
            }

            reqLogger.info(`Successfully uploaded ${successfulUploads.length} files to Google File API.`);
            res.status(200).json({
                message: 'All files uploaded successfully.',
                files: successfulUploads,
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
    ): Promise<UploadedFileResponse | null> {
        try {
            logger.info(`Preparing ${file.originalname} for Google File API upload...`);
            const nodeJsFile = new NodeFile([file.buffer], file.originalname, { type: file.mimetype });

            const params: UploadFileParameters = {
                file: nodeJsFile as unknown as globalThis.Blob,
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
            return {
                name: file.originalname,
                mimeType: file.mimetype,
                size: file.size,
                uri: undefined,
            };
        }
    }

    // <<< NEW: Method to handle feedback submission >>>
    public async handleFeedbackSubmission(req: Request, res: Response): Promise<void> {
        const reqLogger = (req as any).log || this.logger;
        reqLogger.info('Feedback submission request received.');

        const { feedback, conversationContext } = req.body;

        // --- Basic Validation ---
        if (!feedback || !conversationContext) {
            reqLogger.warn('Invalid feedback payload. Missing `feedback` or `conversationContext`.');
            res.status(400).json({ message: 'Invalid payload. `feedback` and `conversationContext` are required.' });
            return;
        }
        if (typeof feedback.rating !== 'number' || !feedback.type) {
            reqLogger.warn('Invalid feedback object. Missing `rating` or `type`.');
            res.status(400).json({ message: 'Invalid feedback object. `rating` and `type` are required.' });
            return;
        }

        try {
            const feedbackDir = path.dirname(this.feedbackCsvPath);
            // Ensure the directory exists
            await fs.mkdir(feedbackDir, { recursive: true });

            const fileExists = await fs.access(this.feedbackCsvPath).then(() => true).catch(() => false);

            const csvWriter = createObjectCsvWriter({
                path: this.feedbackCsvPath,
                header: [
                    { id: 'timestamp', title: 'TIMESTAMP' },
                    { id: 'feedback_type', title: 'FEEDBACK_TYPE' }, // 'like' or 'dislike'
                    { id: 'rating', title: 'RATING' }, // 1-5
                    { id: 'title', title: 'TITLE' },
                    { id: 'details', title: 'DETAILS' },
                    { id: 'conversation_context', title: 'CONVERSATION_CONTEXT_JSON' },
                ],
                append: fileExists, // Append if file exists, otherwise create new with header
            });

            const record = {
                timestamp: new Date().toISOString(),
                feedback_type: feedback.type,
                rating: feedback.rating,
                title: feedback.title || '',
                details: feedback.details || '',
                // Stringify the context to store it in a single CSV cell
                conversation_context: JSON.stringify(conversationContext),
            };

            await csvWriter.writeRecords([record]);

            reqLogger.info({ feedbackType: feedback.type, rating: feedback.rating }, 'Successfully saved feedback to CSV.');
            res.status(201).json({ message: 'Feedback received successfully.' });

        } catch (error) {
            const { message, stack } = getErrorMessageAndStack(error);
            reqLogger.error({ err: { message, stack } }, 'Error saving feedback to CSV.');
            res.status(500).json({ message: 'An error occurred while processing your feedback.', error: message });
        }
    }
}


export const filesUploadMiddleware = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_FILE_SIZE_BYTES }
}).array('files', 5);