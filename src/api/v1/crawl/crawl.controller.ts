// src/api/v1/crawl/crawl.controller.ts
import { Request, Response } from 'express';
import { container as rootContainer } from 'tsyringe'; // <<< Đổi tên container gốc
import { Logger } from 'pino';

import { CrawlOrchestratorService } from '../../../services/crawlOrchestrator.service';
import { LoggingService, RequestSpecificLoggerType } from '../../../services/logging.service';
import { ConfigService } from '../../../config/config.service';
import { LogAnalysisCacheService } from '../../../services/logAnalysisCache.service';
// Import CrawlRequestPayload và cập nhật ConferenceData nếu cần
import { ConferenceData, ProcessedRowData, ApiModels, CrawlModelType, CrawlRequestPayload } from '../../../types/crawl/crawl.types';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { crawlJournals } from '../../../journal/crawlJournals'; // Giữ lại nếu dùng
import { CrawlProcessManagerService } from '../../../services/crawlProcessManager.service'; // <<< IMPORT MỚI
import { RequestStateService } from '../../../services/requestState.service'; // <<< IMPORT MỚI

const EXPECTED_API_MODEL_KEYS: (keyof ApiModels)[] = ["determineLinks", "extractInfo", "extractCfp"];
// DEFAULT_API_MODELS sẽ được áp dụng nếu model tương ứng trong payload là null hoặc không hợp lệ
const DEFAULT_API_MODELS: ApiModels = { determineLinks: 'non-tuned', extractInfo: 'non-tuned', extractCfp: 'non-tuned' };


// Helper function để dọn dẹp tài nguyên sau khi request kết thúc
async function cleanupRequestResources(
    loggingService: LoggingService,
    cacheService: LogAnalysisCacheService,
    type: RequestSpecificLoggerType,
    batchRequestId: string,
    requestLogger: Logger // Đổi tên tham số để rõ ràng hơn
): Promise<void> {
    // Sử dụng appLogger cho các log của quá trình cleanup này,
    // vì requestLogger sắp bị đóng.
    const cleanupPhaseLogger = loggingService.getLogger('app', {
        service: 'CrawlControllerCleanup', // Context cho biết đây là log từ quá trình cleanup
        originalBatchRequestId: batchRequestId, // Giữ lại ID của request gốc
        cleanupType: type
    });

    cleanupPhaseLogger.info(`Initiating cleanup for request resources (ID: ${batchRequestId}).`);

    try {
        // Log trước khi đóng requestLogger, sử dụng chính nó lần cuối
        requestLogger.info({ batchRequestId, type, event: 'cleanup_cache_invalidation_start' }, `Invalidating analysis cache for request ID.`);
        await cacheService.invalidateCacheForRequest(type, batchRequestId);
        // Không cần log thành công ở đây nữa, vì requestLogger sắp bị đóng
    } catch (cacheError) {
        const { message, stack } = getErrorMessageAndStack(cacheError);
        // Log lỗi này bằng cleanupPhaseLogger (appLogger)
        cleanupPhaseLogger.error({ err: { message, stack }, batchRequestId, type, errorMessage: message }, `Error invalidating ${type} cache during cleanup.`);
    }

    try {
        // Log trước khi đóng requestLogger, sử dụng chính nó lần cuối
        requestLogger.info({ batchRequestId, type, event: 'cleanup_logger_close_start' }, `Closing request-specific logger.`);
        await loggingService.closeRequestSpecificLogger(type, batchRequestId);
        // Log "Stream finished" đã có trong closeRequestSpecificLogger, nó sẽ dùng logger của chính nó trước khi stream bị hủy.
        // Không log thêm gì bằng requestLogger sau dòng này.
    } catch (closeLoggerError) {
        const { message, stack } = getErrorMessageAndStack(closeLoggerError);
        // Dùng cleanupPhaseLogger (appLogger) cho lỗi nghiêm trọng này
        cleanupPhaseLogger.error({ err: { message, stack }, batchRequestId, type, errorMessage: message }, `CRITICAL: Error closing request-specific logger during cleanup. This might lead to resource leaks.`);
    }

    // Log hoàn tất cleanup bằng cleanupPhaseLogger
    cleanupPhaseLogger.info(`Cleanup for request resources completed (ID: ${batchRequestId}).`);
}


/**
 * Xử lý yêu cầu crawl conference với hai chế độ:
 * - `mode=sync` (blocking): Đợi xử lý xong và trả về dữ liệu. Dùng cho các tác vụ cập nhật nhỏ.
 * - `mode=async` (non-blocking, mặc định): Trả về 202 Accepted ngay lập tức. Dùng cho crawl hàng loạt từ Admin UI.
 */
export async function handleCrawlConferences(req: Request<{}, any, CrawlRequestPayload>, res: Response): Promise<void> {
    // <<< TẠO CONTAINER CON CHO REQUEST NÀY >>>
    const requestContainer = rootContainer.createChildContainer();

    // Lấy các service cần thiết từ container con
    const loggingService = requestContainer.resolve(LoggingService);
    const currentBatchRequestId = (req as any).id || `req-conf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = loggingService.getRequestSpecificLogger('conference', currentBatchRequestId, {
        route: '/crawl-conferences',
        entryPoint: 'handleCrawlConferences'
    });


    // <<< THÊM LOGIC XỬ LÝ recordFile >>>
    const { description, items: conferenceList, models: modelsFromPayload, recordFile } = req.body;
    const executionMode = (req.query.mode as string) === 'sync' ? 'sync' : 'async';


    routeLogger.info({
        event: 'received_request',
        query: req.query,
        method: req.method,
        requestDescription: description,
        itemCount: conferenceList?.length,
        modelsReceived: modelsFromPayload,
        recordFile: recordFile === true, // Log giá trị của cờ
        executionMode: executionMode, // Log chế độ thực thi
    }, "Received request.");

    // <<< KHỞI TẠO STATE SERVICE TỪ CONTAINER CON >>>
    const requestStateService = requestContainer.resolve(RequestStateService);
    requestStateService.init(recordFile);

    const crawlOrchestrator = requestContainer.resolve(CrawlOrchestratorService);

    // <<< RESOLVE CÁC SERVICE CHÍNH SỚM HƠN >>>
    const logAnalysisCacheService = requestContainer.resolve(LogAnalysisCacheService);


    // Hàm xử lý logic crawl chính, bây giờ nhận các service đã được resolve
    const performCrawl = async (
        orchestrator: CrawlOrchestratorService // <<< Nhận orchestrator
    ): Promise<ProcessedRowData[] | void> => {
        routeLogger.info({ description }, "Beginning processing conference crawl.");

        // --- Phần xác thực và chuẩn bị dữ liệu (giữ nguyên) ---
        const dataSource = (req.query.dataSource as string) || 'client';
        if (dataSource !== 'client') {
            routeLogger.warn({ dataSource }, "Unsupported 'dataSource'. Only 'client' is supported.");
            throw new Error("Invalid 'dataSource'. Only 'client' is supported."); // Ném lỗi để bắt ở ngoài
        }

        let parsedApiModels: ApiModels = { ...DEFAULT_API_MODELS };
        if (typeof modelsFromPayload === 'object' && modelsFromPayload !== null) {
            const validationErrors: string[] = [];
            for (const key of EXPECTED_API_MODEL_KEYS) {
                const modelValue = modelsFromPayload[key];
                if (modelValue === 'tuned' || modelValue === 'non-tuned') {
                    parsedApiModels[key] = modelValue;
                } else if (modelValue !== null && modelValue !== undefined) {
                    validationErrors.push(`Invalid model value '${modelValue}' for API step '${key}'.`);
                }
            }
            if (validationErrors.length > 0) {
                routeLogger.warn({ errors: validationErrors, modelsReceived: modelsFromPayload }, "Some 'models' in payload were invalid. Using defaults for those invalid/missing entries.");
            }
        } else {
            routeLogger.warn({ modelsReceived: modelsFromPayload }, "Invalid 'models' in payload: Expected an object but received non-object, or it was null/undefined. Using default models for all steps.");
        }
        routeLogger.info({ parsedApiModels, userProvidedDescription: description }, "Using API models for crawl.");

        if (!Array.isArray(conferenceList)) {
            throw new Error("Invalid conference list in payload: 'items' field must be an array.");
        }

        if (conferenceList.length === 0) {
            routeLogger.warn("Conference list ('items') is empty. No processing will be performed.");
            return []; // Trả về mảng rỗng cho chế độ sync
        }
        // --- Kết thúc phần xác thực ---

        routeLogger.info({ conferenceCount: conferenceList.length, description }, "Calling CrawlOrchestratorService...");
        // KHÔNG cần truyền recordFile vào `run` nữa
        // <<< TRUYỀN STATE SERVICE VÀO HÀM RUN >>>
        const processedResults: ProcessedRowData[] = await orchestrator.run(
            conferenceList,
            routeLogger,
            parsedApiModels,
            currentBatchRequestId,
            requestStateService, // <<< TRUYỀN VÀO ĐÂY
            requestContainer // <<< TRUYỀN VÀO ĐÂY

        );

        const modelsUsedDesc = `Determine Links: ${parsedApiModels.determineLinks}, Extract Info: ${parsedApiModels.extractInfo}, Extract CFP: ${parsedApiModels.extractCfp}`;
        routeLogger.info({
            event: 'processing_finished_successfully',
            context: {
                totalInputConferences: conferenceList.length, // bắt buộc log kết quả , sẽ dùng để đọc log từ FE
                processedResults: processedResults,
                apiModelsUsed: parsedApiModels,
                requestDescription: description,
            }
        }, `Conference processing completed successfully via controller using models (${modelsUsedDesc}).`);

        return processedResults;
    };


    // Phân luồng xử lý dựa trên executionMode
    if (executionMode === 'sync') {
        // ----- CHẾ ĐỘ SYNC (BLOCKING) -----
        let requestProcessed = false; ``
        try {
            requestProcessed = true;
            const innerOperationStartTime = Date.now();
            // Truyền crawlOrchestrator đã được resolve vào
            const processedResults = await performCrawl(crawlOrchestrator);

            // Nếu performCrawl trả về void (do lỗi đã được xử lý), không gửi response ở đây
            if (typeof processedResults === 'undefined') {
                if (!res.headersSent) {
                    res.status(400).json({ message: "Request could not be processed due to validation errors." });
                }
                return;
            }

            const operationEndTime = Date.now();
            const runTimeSeconds = ((operationEndTime - innerOperationStartTime) / 1000).toFixed(2);

            if (!res.headersSent) {
                res.status(200).json({
                    message: `Conference processing completed. Orchestrator returned ${processedResults.length} records.`,
                    runtime: `${runTimeSeconds} s`,
                    data: processedResults, // Trả về dữ liệu
                    description: description,
                    batchRequestId: currentBatchRequestId
                });
            }
            routeLogger.info({ statusCode: res.statusCode }, "Sent successful synchronous response.");
        } catch (error: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            routeLogger.error({
                err: { message: errorMessage, stack: errorStack },
                event: 'processing_failed_in_controller_scope',
                requestDescription: description,
            }, "Conference processing failed in synchronous mode.");
            if (!res.headersSent) {
                res.status(500).json({ message: 'Conference processing failed.', error: errorMessage, description: description });
            }
        } finally {
            if (requestProcessed) {
                await cleanupRequestResources(loggingService, logAnalysisCacheService, 'conference', currentBatchRequestId, routeLogger);
            }
        }
    } else {
        // ----- CHẾ ĐỘ ASYNC (NON-BLOCKING) -----
        res.status(202).json({
            message: `Crawl request accepted. Processing started in the background.`,
            batchRequestId: currentBatchRequestId,
            description: description
        });
        routeLogger.info({ statusCode: 202, batchRequestId: currentBatchRequestId }, "Sent 202 Accepted response to client for asynchronous processing.");

        // Thực thi trong nền
        (async () => {
            try {
                // Truyền crawlOrchestrator đã được resolve vào
                await performCrawl(crawlOrchestrator);
            } catch (error) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                routeLogger.error({
                    err: { message: errorMessage, stack: errorStack },
                    event: 'processing_failed_in_controller_scope',
                    requestDescription: description,
                }, "Conference processing failed in asynchronous background task.");
            } finally {
                // Truyền loggingService và logAnalysisCacheService đã được resolve vào
                await cleanupRequestResources(loggingService, logAnalysisCacheService, 'conference', currentBatchRequestId, routeLogger);
            }
        })().catch(err => {
            const { message, stack } = getErrorMessageAndStack(err);
            routeLogger.fatal({
                err: { message, stack },
                event: 'unexpected_controller_error',
                batchRequestId: currentBatchRequestId
            }, "An unhandled exception occurred in the background processing wrapper.");
        });
    }
}

// HÀM CONTROLLER MỚI
export async function handleStopCrawl(req: Request<{}, any, { batchRequestId: string }>, res: Response): Promise<void> {
    const { batchRequestId } = req.body;

    // <<< TẠO CONTAINER CON CHO REQUEST NÀY >>>
    const requestContainer = rootContainer.createChildContainer();

    const loggingService = requestContainer.resolve(LoggingService);
    const appLogger = loggingService.getLogger('app', { service: 'StopCrawlController' });

    if (!batchRequestId) {
        appLogger.warn({ body: req.body }, "Stop request received without a batchRequestId.");
        res.status(400).json({ message: "batchRequestId is required." });
        return;
    }

    try {
        const crawlProcessManager = requestContainer.resolve(CrawlProcessManagerService);
        // Sử dụng appLogger hoặc một logger tạm thời cho hành động này
        crawlProcessManager.requestStop(batchRequestId, appLogger);

        res.status(200).json({
            message: `Stop request received for batch ${batchRequestId}. The process will halt gracefully.`,
            batchRequestId: batchRequestId
        });
    } catch (error: unknown) {
        const { message } = getErrorMessageAndStack(error);
        appLogger.error({ err: error, batchRequestId }, `Error processing stop request for batch ${batchRequestId}.`);
        res.status(500).json({ message: "Failed to process stop request.", error: message });
    }
}


export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    const requestContainer = rootContainer.createChildContainer();
    const loggingService = requestContainer.resolve(LoggingService);
    const batchRequestId = (req as any).id || `req-journal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = loggingService.getRequestSpecificLogger('journal', batchRequestId, {
        route: '/crawl-journals',
        entryPoint: 'handleCrawlJournals'
    });

    routeLogger.info({ method: req.method, query: req.query, bodySample: typeof req.body === 'string' ? req.body.slice(0, 100) + '...' : typeof req.body }, "Received request.");


    const logAnalysisCacheService = requestContainer.resolve(LogAnalysisCacheService);
    const configService = requestContainer.resolve(ConfigService);
    let requestProcessed = false;
    let isClientDataMissingError = false; // Keep this flag for specific error handling

    try {
        // runExclusive wrapper removed
        requestProcessed = true; // Assume processing will start
        routeLogger.info("Starting journal crawling..."); // Adjusted log message

        let dataSource: 'scimago' | 'client' = 'client';
        const dataSourceQuery = req.query.dataSource as string;
        let clientData: string | null = null;

        if (dataSourceQuery === 'client') {
            dataSource = 'client';
            if (typeof req.body === 'string' && req.body.trim().length > 0) {
                clientData = req.body;
                routeLogger.info({ dataSource: 'client', bodyLength: clientData.length }, "Using CSV data from request body.");
            } else {
                routeLogger.error({ dataSource: 'client', bodyType: typeof req.body }, "Client mode selected, but no valid CSV string in request body.");
                if (!res.headersSent) {
                    res.status(400).json({ message: "For 'client' dataSource, a non-empty CSV string is required in request body." });
                }
                isClientDataMissingError = true;
                requestProcessed = false; // Not processed due to this specific error
                // Throw error to be caught by the outer catch, then handled by finally
                throw new Error("Client data missing for journal crawl.");
            }
        } else if (dataSourceQuery && dataSourceQuery !== 'scimago') {
            routeLogger.warn({ dataSourceQueryProvided: dataSourceQuery }, "Invalid 'dataSource'. Defaulting to 'scimago'.");
        } else {
            routeLogger.info({ dataSource: 'scimago' }, "Using 'scimago' dataSource (default).");
        }

        const innerOperationStartTime = Date.now();
        // Inner try-catch for processing logic remains
        try {
            await crawlJournals(dataSource, clientData, routeLogger, configService);
            routeLogger.info("Journal crawling completed by the service.");

            const operationEndTime = Date.now();
            const runTimeSeconds = ((operationEndTime - innerOperationStartTime) / 1000).toFixed(2);
            routeLogger.info({ runtimeSeconds: runTimeSeconds, dataSourceUsed: dataSource }, "Journal crawling finished successfully.");

            const journalOutputPath = configService.getJournalOutputJsonlPathForBatch(batchRequestId);
            if (!res.headersSent) {
                res.status(200).json({
                    message: `Journal crawling completed successfully using '${dataSource}' source!`,
                    runtime: `${runTimeSeconds} s`,
                    outputPath: journalOutputPath
                });
            }
            routeLogger.info({ statusCode: res.statusCode }, "Sent successful response.");

        } catch (processingError: unknown) {
            // This catch block is for errors from crawlJournals itself
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(processingError);
            routeLogger.error({
                err: { message: errorMessage, stack: errorStack },
                event: 'journal_processing_failed_in_scope', // Adjusted event name
            }, "Journal crawling failed.");
            if (!res.headersSent) {
                res.status(500).json({ message: 'Journal crawling failed.', error: errorMessage });
            }
            routeLogger.warn({ statusCode: res.statusCode }, "Sent error response.");
            // requestProcessed remains true as an attempt was made. Cleanup will run.
        }
    } catch (error: unknown) { // Catches errors from setup (like clientData missing) or unexpected errors
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        if (errorMessage === "Client data missing for journal crawl.") {
            // This specific error was handled (response sent, flags set), just log it here if needed
            // routeLogger.warn("Client data missing error was thrown and caught as expected.");
            // requestProcessed is already false, isClientDataMissingError is true
        } else {
            routeLogger.error(
                { err: { message: errorMessage, stack: errorStack }, event: 'journal_controller_setup_or_unexpected_error' },
                "Error during journal crawl setup or unexpected controller error."
            );
            if (!res.headersSent) {
                res.status(503).json({ message: "Server error during journal crawl request or setup." });
            }
            // If an unexpected error occurs here, requestProcessed might still be true if it happened after being set.
            // Or it could be false if it happened very early. The finally block will handle cleanup.
        }
    } finally {
        if (requestProcessed) {
            // Full cleanup if processing was initiated and completed (successfully or with processing error)
            await cleanupRequestResources(loggingService, logAnalysisCacheService, 'journal', batchRequestId, routeLogger);
        } else {
            // If not processed (e.g., client data missing error, or other early exit)
            // only close the logger. cleanupRequestResources handles cache which might not be relevant.
            // The isClientDataMissingError flag ensures we don't double-log or misinterpret.
            try {
                await loggingService.closeRequestSpecificLogger('journal', batchRequestId);
            } catch (e) {
                const cleanupPhaseLogger = loggingService.getLogger('app', { service: 'CrawlControllerCleanupFinally' });
                cleanupPhaseLogger.warn({ err: e, batchRequestId: batchRequestId, type: 'journal' }, "Error closing logger in finally block for non-processed/error request.");
            }
        }
    }
}