// src/api/v1/crawl/crawl.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
// import { Mutex } from 'async-mutex'; // Mutex removed
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

// Mutexes removed
// const crawlConferenceLock: Mutex = new Mutex();
// const crawlJournalLock: Mutex = new Mutex();

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
    const routeLogger = loggingService.getRequestSpecificLogger('conference', currentBatchRequestId, {
        route: '/crawl-conferences',
        entryPoint: 'handleCrawlConferences'
    });
    routeLogger.info({ query: req.query, method: req.method, bodySample: req.body?.slice(0, 1) }, "Received request.");

    // Mutex lock check removed
    // if (crawlConferenceLock.isLocked()) {
    //     routeLogger.warn("Request rejected: Server is busy processing another conference crawl request.");
    //     res.status(429).json({ message: "The server is busy processing another conference crawl request. Please try again later." });
    //     return;
    // }

    const logAnalysisCacheService = container.resolve(LogAnalysisCacheService);
    let requestProcessed = false;

    try {
        // runExclusive wrapper removed
        requestProcessed = true; // Đánh dấu request đã bắt đầu xử lý
        routeLogger.info("Beginning processing conference crawl."); // Adjusted log message

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
            requestProcessed = false; // Không xử lý, không cần cleanup đầy đủ
            // Ensure logger is closed if request is not processed further
            await loggingService.closeRequestSpecificLogger('conference', currentBatchRequestId);
            return;
        }

        const apiModelsFromQuery = req.query.models;
        let parsedApiModels: ApiModels = { ...DEFAULT_API_MODELS };

        if (typeof apiModelsFromQuery === 'object' && apiModelsFromQuery !== null) {
            const validationErrors: string[] = [];
            for (const key of EXPECTED_API_MODEL_KEYS) {
                const modelValue = (apiModelsFromQuery as Record<string, string>)[key];
                if (modelValue) {
                    if (modelValue === 'tuned' || modelValue === 'non-tuned') {
                        parsedApiModels[key] = modelValue as CrawlModelType;
                    } else {
                        validationErrors.push(`Invalid model value '${modelValue}' for API step '${key}'. Must be 'tuned' or 'non-tuned'. Defaulting to '${DEFAULT_API_MODELS[key]}'.`);
                    }
                } else {
                    routeLogger.debug(`Model for '${key}' not provided in query. Using default: '${DEFAULT_API_MODELS[key]}'.`);
                }
            }
            if (validationErrors.length > 0) {
                routeLogger.warn({ errors: validationErrors, modelsReceived: apiModelsFromQuery }, "Some 'models' query parameter values were invalid. Using defaults for those invalid/missing entries.");
            }
        } else if (apiModelsFromQuery !== undefined) {
            routeLogger.warn({ modelsReceived: apiModelsFromQuery }, "Invalid 'models' query parameter: Expected an object but received non-object, or it was explicitly null. Using default models.");
        } else {
            routeLogger.info("No 'models' query parameter provided. Using default API models for all steps.");
        }

        routeLogger.info({ parsedApiModels }, "Using API models for crawl."); // Changed console.log to routeLogger.info

        const innerOperationStartTime = Date.now();
        // Inner try-catch for processing logic remains
        try {
            let conferenceList: ConferenceData[] = req.body;
            if (!Array.isArray(conferenceList)) {
                routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list: Expected an array.");
                if (!res.headersSent) {
                    res.status(400).json({ message: 'Invalid conference list (must be an array).' });
                }
                requestProcessed = false;
                await loggingService.closeRequestSpecificLogger('conference', currentBatchRequestId);
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
                // Request was "processed" (acknowledged and handled), so cleanup will run
                return;
            }

            routeLogger.info({ conferenceCount: conferenceList.length }, "Calling CrawlOrchestratorService...");
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
                    processedResults: processedResults,
                    apiModelsUsed: parsedApiModels,
                    outputJsonlFilePath: finalOutputJsonlPathForBatch,
                    outputCsvFilePath: evaluateCsvPathForBatch,
                    operationStartTime: new Date(innerOperationStartTime).toISOString(),
                    operationEndTime: new Date(operationEndTime).toISOString(),
                }
            }, `Conference processing completed successfully via controller using models (${modelsUsedDesc}).`);
            
            routeLogger.debug({ processedResults }, "Final Processed Results (ProcessedRowData[])"); // Changed console.log to routeLogger.debug

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

        } catch (processingError: unknown) {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(processingError);
            routeLogger.error({
                err: { message: errorMessage, stack: errorStack },
                event: 'processing_failed_in_controller_scope', // Adjusted event name
            }, "Conference processing failed.");
            if (!res.headersSent) {
                res.status(500).json({ message: 'Conference processing failed.', error: errorMessage });
            }
            routeLogger.warn({ statusCode: res.statusCode }, "Sent error response.");
        }
    // Removed catch for mutexError as runExclusive is removed
    // } catch (mutexError: unknown) { ... }
    } catch (error: unknown) { // General catch for any errors outside the inner processing try-catch
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        routeLogger.error(
            { err: { message: errorMessage, stack: errorStack }, event: 'unexpected_controller_error' },
            "Unexpected error in handleCrawlConferences."
        );
        if (!res.headersSent) {
            res.status(503).json({ message: "Server error during conference crawl request." });
        }
        // Ensure requestProcessed is false if we reach here due to an early error before it was set true
        // or if an error occurred that should prevent full cleanup.
        // However, if it was already set true, cleanup should proceed.
    } finally {
        if (requestProcessed) {
            await cleanupRequestResources(loggingService, logAnalysisCacheService, 'conference', currentBatchRequestId, routeLogger);
        } else {
            // If request was not fully processed (e.g., early validation error),
            // logger might have been created. Ensure it's closed.
            // LoggingService.closeRequestSpecificLogger handles non-existent loggers gracefully.
            try {
                await loggingService.closeRequestSpecificLogger('conference', currentBatchRequestId);
            } catch (e) {
                const cleanupPhaseLogger = loggingService.getLogger('app', { service: 'CrawlControllerCleanupFinally' });
                cleanupPhaseLogger.warn({ err: e, batchRequestId: currentBatchRequestId, type: 'conference' }, "Error closing logger in finally block for non-processed request.");
            }
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

    // Mutex lock check removed
    // if (crawlJournalLock.isLocked()) {
    //     routeLogger.warn("Request rejected: Server is busy processing another journal crawl request.");
    //     res.status(429).json({ message: "The server is busy processing another journal crawl request. Please try again later." });
    //     return;
    // }

    const logAnalysisCacheService = container.resolve(LogAnalysisCacheService);
    const configService = container.resolve(ConfigService);
    let requestProcessed = false;
    let isClientDataMissingError = false; // Keep this flag for specific error handling

    try {
        // runExclusive wrapper removed
        requestProcessed = true; // Assume processing will start
        routeLogger.info("Starting journal crawling..."); // Adjusted log message

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


export async function handleSaveConference(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const databasePersistenceService = container.resolve(DatabasePersistenceService);
    const configService = container.resolve(ConfigService);

    const baseRouteLogger = loggingService.getLogger('app');
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