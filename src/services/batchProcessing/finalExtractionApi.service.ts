import 'reflect-metadata';
import { singleton, inject } from 'tsyringe';
import { Logger } from 'pino';
import fetch from 'node-fetch'; // <<< THÊM IMPORT NÀY

// --- Types ---
import { CrawlModelType, GeminiApiParams } from '../../types/crawl';

// --- Service Imports ---
import { GeminiApiService } from '../geminiApi.service';
import { FileSystemService } from '../fileSystem.service';
// ConfigService không cần thiết ở đây vì FileSystemService đã xử lý logic môi trường

// +++ UPDATE THE INTERFACE +++
export interface IFinalExtractionApiService {
    execute(
        contentSendToAPI: string,
        batchItemIndex: number,
        titleForApis: string,
        originalAcronymForApis: string,
        safeConferenceAcronymForFiles: string,
        isUpdate: boolean,
        extractModel: CrawlModelType,
        cfpModel: CrawlModelType,
        imageUrls: string[] | undefined, // <<< THÊM THAM SỐ MỚI
        parentLogger: Logger
    ): Promise<{
        extractResponseTextPath: string | null; // Can be null
        extractResponseContent: Record<string, any> | null; // The parsed JSON object
        extractMetaData: any | null;
        cfpResponseTextPath: string | null; // Can be null
        cfpResponseContent: Record<string, any> | null; // The parsed JSON object
        cfpMetaData: any | null;
    }>;
}

@singleton()
export class FinalExtractionApiService implements IFinalExtractionApiService {
    constructor(
        @inject(GeminiApiService) private readonly geminiApiService: GeminiApiService,
        @inject(FileSystemService) private readonly fileSystemService: FileSystemService
    ) { }


    // +++ HELPER ĐỂ CHUYỂN URL SANG BASE64 +++
    private async urlToGenerativePart(url: string, logger: Logger): Promise<{ inlineData: { mimeType: string; data: string; } } | null> {
        try {
            logger.info({ imageUrl: url }, "Fetching image to convert to Base64.");
            const response = await fetch(url);
            if (!response.ok) {
                logger.error({ imageUrl: url, status: response.status }, "Failed to fetch image.");
                return null;
            }

            // Xác định MimeType đơn giản từ URL
            let mimeType = 'image/jpeg'; // Mặc định
            if (url.endsWith('.png')) mimeType = 'image/png';
            else if (url.endsWith('.webp')) mimeType = 'image/webp';
            else if (url.endsWith('.jpg') || url.endsWith('.jpeg')) mimeType = 'image/jpeg';

            const imageArrayBuffer = await response.arrayBuffer();
            const base64ImageData = Buffer.from(imageArrayBuffer).toString('base64');

            return {
                inlineData: {
                    mimeType,
                    data: base64ImageData,
                },
            };
        } catch (error) {
            logger.error({ err: error, imageUrl: url }, "Error converting image URL to generative part.");
            return null;
        }
    }

    public async execute(
        contentSendToAPI: string,
        batchItemIndex: number,
        titleForApis: string,
        originalAcronymForApis: string,
        safeConferenceAcronymForFiles: string,
        isUpdate: boolean,
        extractModel: CrawlModelType,
        cfpModel: CrawlModelType,
        imageUrls: string[] | undefined, // <<< NHẬN THAM SỐ MỚI
        parentLogger: Logger
    ): Promise<{
        extractResponseTextPath: string | null;
        extractResponseContent: Record<string, any> | null;
        extractMetaData: any | null;
        cfpResponseTextPath: string | null;
        cfpResponseContent: Record<string, any> | null;
        cfpMetaData: any | null;
    }> {
        const logger = parentLogger.child({
            batchServiceFunction: 'executeFinalExtractionApis',
            isUpdateContext: isUpdate,
            extractModelUsed: extractModel,
            cfpModelUsed: cfpModel,
            originalConferenceAcronym: originalAcronymForApis,
            fileNameBaseAcronym: safeConferenceAcronymForFiles
        });

        const suffix = isUpdate ? `_update_response_${batchItemIndex}` : `_response_${batchItemIndex}`;
        const extractFileBase = `${safeConferenceAcronymForFiles}_extract${suffix}`;
        const cfpFileBase = `${safeConferenceAcronymForFiles}_cfp${suffix}`;

        logger.info({ event: 'batch_processing_parallel_final_apis_start', flow: isUpdate ? 'update' : 'save' });

        const commonApiParams: Omit<GeminiApiParams, 'batch'> = {
            batchIndex: batchItemIndex,
            title: titleForApis,
            acronym: originalAcronymForApis,
        };


        logger.info({ event: 'API_FINAL_EXTRACTION_START', flow: isUpdate ? 'update' : 'save' });
        const finalApiStartTime = performance.now();

        // +++ LOGIC MỚI: XÂY DỰNG PAYLOAD MULTIMODAL +++
        const extractPromise = (async () => {
            const extractApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_EXTRACT });
            try {
                const imageParts = [];
                if (imageUrls && imageUrls.length > 0) {
                    for (const url of imageUrls) {
                        const part = await this.urlToGenerativePart(url, extractApiLogger);
                        if (part) imageParts.push(part);
                    }
                }

                // Xây dựng mảng `contents`
                const contents = [
                    ...imageParts, // Thêm các phần ảnh trước
                    { text: contentSendToAPI } // Sau đó là phần text
                ];

                extractApiLogger.info({ inputLength: contentSendToAPI.length, imageCount: imageParts.length, event: 'batch_processing_final_extract_api_call_start' });

                // Gọi API với `contents` thay vì `batch`
                const response = await this.geminiApiService.extractInformation(
                    { ...commonApiParams, contents: contents }, // <<< THAY ĐỔI PAYLOAD
                    extractModel,
                    extractApiLogger
                );

                let parsedContent: Record<string, any> | null = null;
                if (response.responseText) {
                    try {
                        // Cố gắng parse text thành JSON
                        parsedContent = JSON.parse(response.responseText);
                    } catch (e) {
                        extractApiLogger.error({ err: e, responseText: response.responseText, event: 'final_api_response_parse_failed' });
                        // Nếu parse lỗi, tạo một object lỗi để lưu lại
                        parsedContent = { error: "Failed to parse JSON from API response", responseText: response.responseText };
                    }
                }

                // Luôn gọi saveTemporaryFile. Nó sẽ tự động bỏ qua việc ghi file trong môi trường production.
                const pathValue = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", extractFileBase, extractApiLogger
                );

                extractApiLogger.info({ responseLength: response.responseText?.length, filePath: pathValue, hasParsedContent: !!parsedContent, event: 'batch_processing_final_extract_api_call_end' });
                return { responseTextPath: pathValue, responseContent: parsedContent, metaData: response.metaData };
            } catch (error: any) {
                extractApiLogger.error({ err: error, event: 'batch_extract_api_call_failed' });
                return { responseTextPath: null, responseContent: null, metaData: null };
            }
        })();

        const cfpPromise = (async () => {
            const cfpApiLogger = logger.child({ apiTypeContext: this.geminiApiService.API_TYPE_CFP });
            cfpApiLogger.info({ inputLength: contentSendToAPI.length, event: 'batch_processing_final_cfp_api_call_start' });
            try {
                const response = await this.geminiApiService.extractCfp(
                    { ...commonApiParams, batch: contentSendToAPI },
                    cfpModel,
                    cfpApiLogger
                );

                let parsedContent: Record<string, any> | null = null;
                if (response.responseText) {
                    try {
                        parsedContent = JSON.parse(response.responseText);
                    } catch (e) {
                        cfpApiLogger.error({ err: e, responseText: response.responseText, event: 'final_api_response_parse_failed' });
                        parsedContent = { error: "Failed to parse JSON from API response", responseText: response.responseText };
                    }
                }

                const pathValue = await this.fileSystemService.saveTemporaryFile(
                    response.responseText || "", cfpFileBase, cfpApiLogger
                );

                cfpApiLogger.info({ responseLength: response.responseText?.length, filePath: pathValue, hasParsedContent: !!parsedContent, event: 'batch_processing_final_cfp_api_call_end' });
                return { responseTextPath: pathValue, responseContent: parsedContent, metaData: response.metaData };
            } catch (error: any) {
                cfpApiLogger.error({ err: error, event: 'batch_cfp_api_call_failed' });
                return { responseTextPath: null, responseContent: null, metaData: null };
            }
        })();

        const [extractResult, cfpResult] = await Promise.all([extractPromise, cfpPromise]);


        const finalApiDurationMs = performance.now() - finalApiStartTime;
        logger.info({
            event: 'API_FINAL_EXTRACTION_END',
            durationMs: Math.round(finalApiDurationMs),
            // ...
        });

        // Cập nhật logic kiểm tra thành công
        const extractSuccess = !!extractResult.responseContent;
        const cfpSuccess = !!cfpResult.responseContent;

        logger.info({
            event: 'batch_processing_parallel_final_apis_finished',
            extractSuccess,
            cfpSuccess,
            flow: isUpdate ? 'update' : 'save'
        });

        if (!extractSuccess && !cfpSuccess) {
            logger.error({ event: 'batch_parallel_final_apis_both_failed', flow: isUpdate ? 'update' : 'save' });
        }

        return {
            extractResponseTextPath: extractResult.responseTextPath,
            extractResponseContent: extractResult.responseContent,
            extractMetaData: extractResult.metaData,
            cfpResponseTextPath: cfpResult.responseTextPath,
            cfpResponseContent: cfpResult.responseContent,
            cfpMetaData: cfpResult.metaData,
        };
    }
}