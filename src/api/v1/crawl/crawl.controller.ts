
// src/api/v1/crawl/crawl.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { Mutex } from 'async-mutex';
import { Logger } from 'pino';

import { CrawlOrchestratorService } from '../../../services/crawlOrchestrator.service';
import { LoggingService, RequestSpecificLoggerType } from '../../../services/logging.service'; // Import RequestSpecificLoggerType
import { ConfigService } from '../../../config/config.service';
import { LogAnalysisCacheService } from '../../../services/logAnalysisCache.service';
import { ConferenceData, ProcessedRowData, ApiModels, CrawlModelType } from '../../../types/crawl/crawl.types';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { crawlJournals } from '../../../journal/crawlJournals';
import { DatabasePersistenceService, DatabaseSaveResult } from '../../../services/databasePersistence.service';

const EXPECTED_API_MODEL_KEYS: (keyof ApiModels)[] = ["determineLinks", "extractInfo", "extractCfp"];
const DEFAULT_API_MODELS: ApiModels = { determineLinks: 'tuned', extractInfo: 'tuned', extractCfp: 'non-tuned' };

const crawlConferenceLock: Mutex = new Mutex();
const crawlJournalLock: Mutex = new Mutex();

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



export async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const currentBatchRequestId = (req as any).id || `req-conf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    // Lấy logger cụ thể cho request này
    const routeLogger = loggingService.getRequestSpecificLogger('conference', currentBatchRequestId, {
        route: '/crawl-conferences',
        entryPoint: 'handleCrawlConferences'
    });
    routeLogger.info({ query: req.query, method: req.method, bodySample: req.body?.slice(0, 1) }, "Received request.");

    if (crawlConferenceLock.isLocked()) {
        routeLogger.warn("Request rejected: Server is busy processing another conference crawl request.");
        res.status(429).json({ message: "The server is busy processing another conference crawl request. Please try again later." });
        // Không cần cleanup ở đây vì request chưa thực sự bắt đầu xử lý tài nguyên (logger, cache)
        return;
    }

    const logAnalysisCacheService = container.resolve(LogAnalysisCacheService);
    let requestProcessed = false; // Cờ để biết liệu có cần cleanup không

    try {
        await crawlConferenceLock.runExclusive(async () => {
            requestProcessed = true; // Đánh dấu request đã bắt đầu xử lý
            routeLogger.info("Mutex lock acquired. Beginning processing.");

            const configService = container.resolve(ConfigService);
            const crawlOrchestrator = container.resolve(CrawlOrchestratorService);
            const finalOutputJsonlPathForBatch = configService.getFinalOutputJsonlPathForBatch(currentBatchRequestId);
            const evaluateCsvPathForBatch = configService.getEvaluateCsvPathForBatch(currentBatchRequestId);

            const dataSource = (req.query.dataSource as string) || 'client';
            if (dataSource !== 'client') {
                routeLogger.warn({ dataSource }, "Unsupported 'dataSource'. Only 'client' is supported.");
                if (!res.headersSent) {
                    res.status(400).json({ message: "Invalid 'dataSource'. Only 'client' is supported." });
                }
                requestProcessed = false; // Không xử lý, không cần cleanup
                return;
            }


            const apiModelsFromQuery = req.query.models;
            let parsedApiModels: ApiModels = { ...DEFAULT_API_MODELS };

            // If models query parameter is provided, try to parse it
            if (typeof apiModelsFromQuery === 'object' && apiModelsFromQuery !== null) {
                const validationErrors: string[] = [];
                for (const key of EXPECTED_API_MODEL_KEYS) {
                    const modelValue = (apiModelsFromQuery as Record<string, string>)[key];

                    if (modelValue) { // If a value is provided for this key
                        if (modelValue === 'tuned' || modelValue === 'non-tuned') {
                            parsedApiModels[key] = modelValue as CrawlModelType;
                        } else {
                            validationErrors.push(`Invalid model value '${modelValue}' for API step '${key}'. Must be 'tuned' or 'non-tuned'. Defaulting to '${DEFAULT_API_MODELS[key]}'.`);
                            // Keep default if invalid value provided
                        }
                    } else {
                        // If modelValue is undefined or empty string, it means it's not provided in the query for this specific key.
                        // We already initialized with DEFAULT_API_MODELS, so no action needed here.
                        routeLogger.debug(`Model for '${key}' not provided in query. Using default: '${DEFAULT_API_MODELS[key]}'.`);
                    }
                }

                if (validationErrors.length > 0) {
                    routeLogger.warn({ errors: validationErrors, modelsReceived: apiModelsFromQuery }, "Some 'models' query parameter values were invalid. Using defaults for those invalid/missing entries.");
                    // Do NOT send 400 here, as we are defaulting. Just log the warning.
                }
            } else if (apiModelsFromQuery !== undefined) {
                // If 'models' parameter was provided but was not an object or was null (e.g., ?models=abc)
                routeLogger.warn({ modelsReceived: apiModelsFromQuery }, "Invalid 'models' query parameter: Expected an object but received non-object, or it was explicitly null. Using default models.");
                // No 400 error, as we default gracefully.
            } else {
                // If 'models' parameter was not provided at all
                routeLogger.info("No 'models' query parameter provided. Using default API models for all steps.");
            }

            // Log the final parsedApiModels
            console.log('\n--- Parsed API Models Used ---');
            console.log(JSON.stringify(parsedApiModels, null, 2));
            console.log('------------------------------');

            const innerOperationStartTime = Date.now();
            try {
                let conferenceList: ConferenceData[] = req.body;
                if (!Array.isArray(conferenceList)) {
                    routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list: Expected an array.");
                    if (!res.headersSent) {
                        res.status(400).json({ message: 'Invalid conference list (must be an array).' });
                    }
                    requestProcessed = false; // Không xử lý, không cần cleanup
                    return;
                }

                if (!conferenceList || conferenceList.length === 0) {
                    routeLogger.warn("Conference list is empty. No processing will be performed.");
                    const operationEndTime = Date.now();
                    const runTimeSeconds = ((operationEndTime - innerOperationStartTime) / 1000).toFixed(2);
                    if (!res.headersSent) {
                        res.status(200).json({
                            message: 'Conference list provided was empty. No processing performed.',
                            runtime: `${runTimeSeconds} s`,
                            outputJsonlPath: finalOutputJsonlPathForBatch,
                            outputCsvPath: evaluateCsvPathForBatch
                        });
                    }
                    // Vẫn coi là đã xử lý request này (dù không có data)
                    return; // cleanup sẽ được gọi trong finally của runExclusive
                }

                routeLogger.info({ conferenceCount: conferenceList.length }, "Calling CrawlOrchestratorService...");
                // Truyền routeLogger (logger của request) vào orchestrator
                const processedResults: ProcessedRowData[] = await crawlOrchestrator.run(
                    conferenceList, routeLogger, parsedApiModels, currentBatchRequestId
                );


                const operationEndTime = Date.now();
                const runTimeSeconds = ((operationEndTime - innerOperationStartTime) / 1000).toFixed(2);

                const modelsUsedDesc = `Determine Links: ${parsedApiModels.determineLinks}, Extract Info: ${parsedApiModels.extractInfo}, Extract CFP: ${parsedApiModels.extractCfp}`;

                routeLogger.info({
                    event: 'processing_finished_successfully',
                    context: {
                        runtimeSeconds: parseFloat(runTimeSeconds),
                        totalInputConferences: conferenceList.length,
                        processedResults: processedResults, // Bắt buộc log cho frontend để save vào db
                        apiModelsUsed: parsedApiModels,
                        outputJsonlFilePath: finalOutputJsonlPathForBatch,
                        outputCsvFilePath: evaluateCsvPathForBatch,
                        operationStartTime: new Date(innerOperationStartTime).toISOString(),
                        operationEndTime: new Date(operationEndTime).toISOString(),
                    }
                }, `Conference processing completed successfully via controller using models (${modelsUsedDesc}).`);

                // Log the final processed results returned by the orchestrator
                console.log('\n--- Final Processed Results (ProcessedRowData[]) ---');
                console.log(JSON.stringify(processedResults, null, 2));
                console.log('----------------------------------------------------');

                if (!res.headersSent) {
                    res.status(200).json({
                        message: `Conference processing completed. Orchestrator returned ${processedResults.length} records.`,
                        runtime: `${runTimeSeconds} s`,
                        data: processedResults,
                        outputJsonlPath: finalOutputJsonlPathForBatch,
                        outputCsvPath: evaluateCsvPathForBatch
                    });
                }
                routeLogger.info({ statusCode: res.statusCode }, "Sent successful response.");
                // cleanup sẽ được gọi trong finally của runExclusive


            } catch (processingError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(processingError);
                routeLogger.error({
                    err: { message: errorMessage, stack: errorStack },
                    event: 'processing_failed_in_controller_exclusive_scope',
                }, "Conference processing failed.");
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Conference processing failed.', error: errorMessage });
                }
                routeLogger.warn({ statusCode: res.statusCode }, "Sent error response.");
                // cleanup sẽ được gọi trong finally của runExclusive
            }
        }); // Kết thúc runExclusive
    } catch (mutexError: unknown) { // Lỗi từ Mutex (ví dụ: runExclusive bị reject)
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(mutexError);
        routeLogger.error(
            { err: { message: errorMessage, stack: errorStack }, event: 'mutex_execution_error' },
            "Unexpected error during Mutex execution."
        );
        if (!res.headersSent) {
            res.status(503).json({ message: "Server error managing request queue." });
        }
        // Không cần đặt requestProcessed = false ở đây vì lỗi Mutex nghĩa là nó không vào runExclusive
    } finally {
        // Cleanup chỉ được gọi nếu request đã thực sự được xử lý (logger đã được tạo và có thể có cache)
        if (requestProcessed) {
            await cleanupRequestResources(loggingService, logAnalysisCacheService, 'conference', currentBatchRequestId, routeLogger);
        } else {
            // Nếu request không được xử lý (ví dụ: lỗi param sớm), logger có thể đã được tạo nhưng không có gì để invalidate
            // Chỉ cần đóng logger nếu nó đã được tạo.
            // LoggingService.closeRequestSpecificLogger sẽ tự xử lý nếu logger không tồn tại trong map.
            try {
                await loggingService.closeRequestSpecificLogger('conference', currentBatchRequestId);
            } catch (e) { /* ignore */ }
        }
    }
}



export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const batchRequestId = (req as any).id || `req-journal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = loggingService.getRequestSpecificLogger('journal', batchRequestId, {
        route: '/crawl-journals',
        entryPoint: 'handleCrawlJournals'
    });

    routeLogger.info({ method: req.method, query: req.query, bodySample: typeof req.body === 'string' ? req.body.slice(0, 100) + '...' : typeof req.body }, "Received request.");

    if (crawlJournalLock.isLocked()) {
        routeLogger.warn("Request rejected: Server is busy processing another journal crawl request.");
        res.status(429).json({ message: "The server is busy processing another journal crawl request. Please try again later." });
        return;
    }

    const logAnalysisCacheService = container.resolve(LogAnalysisCacheService);
    const configService = container.resolve(ConfigService);
    let requestProcessed = false;
    let isClientDataMissingError = false;

    try {
        await crawlJournalLock.runExclusive(async () => {
            requestProcessed = true;
            routeLogger.info("Mutex lock acquired. Starting journal crawling...");

            let dataSource: 'scimago' | 'client' = 'scimago';
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
                    isClientDataMissingError = true; // Đánh dấu lỗi cụ thể
                    requestProcessed = false; // Không xử lý, không cần cleanup tài nguyên đầy đủ
                    throw new Error("Client data missing for journal crawl."); // Thoát runExclusive
                }
            } else if (dataSourceQuery && dataSourceQuery !== 'scimago') {
                routeLogger.warn({ dataSourceQueryProvided: dataSourceQuery }, "Invalid 'dataSource'. Defaulting to 'scimago'.");
            } else {
                routeLogger.info({ dataSource: 'scimago' }, "Using 'scimago' dataSource (default).");
            }

            const innerOperationStartTime = Date.now();
            try {
                // Truyền routeLogger (logger của request) vào crawlJournals
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
                // cleanup sẽ được gọi trong finally của runExclusive

            } catch (processingError: unknown) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(processingError);
                routeLogger.error({
                    err: { message: errorMessage, stack: errorStack },
                    event: 'journal_processing_failed_in_exclusive_scope',
                }, "Journal crawling failed.");
                if (!res.headersSent) {
                    res.status(500).json({ message: 'Journal crawling failed.', error: errorMessage });
                }
                routeLogger.warn({ statusCode: res.statusCode }, "Sent error response.");
                // cleanup sẽ được gọi trong finally của runExclusive
            }
        }); // Kết thúc runExclusive
    } catch (mutexOrSetupError: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(mutexOrSetupError);
        // Kiểm tra xem có phải lỗi "Client data missing" không để tránh log và gửi response trùng lặp
        if (errorMessage === "Client data missing for journal crawl.") {
            // Lỗi này đã được xử lý và response đã được gửi (hoặc sẽ được gửi bởi finally)
            // requestProcessed vẫn là false
        } else {
            routeLogger.error(
                { err: { message: errorMessage, stack: errorStack }, event: 'journal_mutex_or_setup_error' },
                "Error during Mutex execution or setup."
            );
            if (!res.headersSent) {
                res.status(503).json({ message: "Server error managing journal request queue or setup." });
            }
        }
    } finally {
        if (requestProcessed) {
            await cleanupRequestResources(loggingService, logAnalysisCacheService, 'journal', batchRequestId, routeLogger);
        } else if (!isClientDataMissingError) { // Chỉ đóng logger nếu không phải lỗi client data missing (vì lúc đó logger có thể chưa dùng nhiều)
            try {
                await loggingService.closeRequestSpecificLogger('journal', batchRequestId);
            } catch (e) { /* ignore */ }
        }
        // Nếu là isClientDataMissingError, logger đã được tạo nhưng request không thực sự chạy,
        // việc đóng logger ở đây vẫn ổn, LoggingService sẽ xử lý nếu key không tồn tại.
        // Hoặc có thể thêm một lần gọi closeRequestSpecificLogger ở đây nếu isClientDataMissingError = true
        // để đảm bảo nó được đóng.
        if (isClientDataMissingError) {
             try {
                await loggingService.closeRequestSpecificLogger('journal', batchRequestId);
            } catch (e) { /* ignore */ }
        }
    }
}


export async function handleSaveConference(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const databasePersistenceService = container.resolve(DatabasePersistenceService);
    const configService = container.resolve(ConfigService);

    // Sử dụng logger 'app' hoặc 'conference' tùy theo mục đích log của việc save này
    const baseRouteLogger = loggingService.getLogger('app'); // Hoặc 'conference'
    const requestId = (req as any).id || `req-save-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = baseRouteLogger.child({ requestId, route: '/save-conference-evaluate' });

    routeLogger.info("Received request to manually save evaluated data to database.");

    try {
        const result: DatabaseSaveResult = await databasePersistenceService.saveEvaluatedData(routeLogger);

        if (result.success) {
            routeLogger.info({ event: 'manual_db_save_success', details: result }, "Manual save to database completed successfully.");
            res.status(result.statusCode || 200).json({
                message: result.message,
                details: result.data
            });
        } else {
            routeLogger.error({ event: 'manual_db_save_failed', details: result }, "Manual save to database failed based on service response.");
            if (result.message.includes("CSV file not found")) {
                res.status(404).json({
                    message: result.message,
                    error: result.error,
                    csvPath: configService.getBaseEvaluateCsvPath()
                });
            } else {
                res.status(result.statusCode || 500).json({
                    message: result.message,
                    error: result.error,
                    details: result.data
                });
            }
        }
    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        routeLogger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'manual_db_save_controller_error' }, "Unexpected fatal error in handleSaveConference controller.");
        if (!res.headersSent) {
            res.status(500).json({
                message: 'Unexpected internal server error while saving to database.',
                error: errorMessage
            });
        }
    }
}