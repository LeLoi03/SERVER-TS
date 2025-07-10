// src/api/v1/crawl/crawl.controller.ts
import { Request, Response } from 'express';
import { container as rootContainer } from 'tsyringe';
import { Logger } from 'pino';
import { CrawlOrchestratorService } from '../../../services/crawlOrchestrator.service';
import { LoggingService, RequestSpecificLoggerType } from '../../../services/logging.service';
import { ConfigService } from '../../../config/config.service';
import { LogAnalysisCacheService } from '../../../services/logAnalysisCache.service';
import { ProcessedRowData, ApiModels, CrawlRequestPayload } from '../../../types/crawl/crawl.types';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { crawlJournals } from '../../../journal/crawlJournals';
import { CrawlProcessManagerService } from '../../../services/crawlProcessManager.service';
import { RequestStateService } from '../../../services/requestState.service';

const EXPECTED_API_MODEL_KEYS: (keyof ApiModels)[] = ["determineLinks", "extractInfo", "extractCfp"];
const DEFAULT_API_MODELS: ApiModels = { determineLinks: 'non-tuned', extractInfo: 'non-tuned', extractCfp: 'non-tuned' };

async function cleanupRequestResources(
    loggingService: LoggingService,
    cacheService: LogAnalysisCacheService,
    type: RequestSpecificLoggerType,
    batchRequestId: string,
    requestLogger: Logger
): Promise<void> {
    const cleanupPhaseLogger = loggingService.getLogger('app', {
        service: 'CrawlControllerCleanup',
        originalBatchRequestId: batchRequestId,
        cleanupType: type
    });
    cleanupPhaseLogger.info(`Initiating cleanup for request resources (ID: ${batchRequestId}).`);
    try {
        requestLogger.info({ batchRequestId, type, event: 'cleanup_cache_invalidation_start' }, `Invalidating analysis cache for request ID.`);
        await cacheService.invalidateCacheForRequest(type, batchRequestId);
    } catch (cacheError) {
        const { message, stack } = getErrorMessageAndStack(cacheError);
        cleanupPhaseLogger.error({ err: { message, stack }, batchRequestId, type, errorMessage: message }, `Error invalidating ${type} cache during cleanup.`);
    }
    try {
        requestLogger.info({ batchRequestId, type, event: 'cleanup_logger_close_start' }, `Closing request-specific logger.`);
        await loggingService.closeRequestSpecificLogger(type, batchRequestId);
    } catch (closeLoggerError) {
        const { message, stack } = getErrorMessageAndStack(closeLoggerError);
        cleanupPhaseLogger.error({ err: { message, stack }, batchRequestId, type, errorMessage: message }, `CRITICAL: Error closing request-specific logger during cleanup. This might lead to resource leaks.`);
    }
    cleanupPhaseLogger.info(`Cleanup for request resources completed (ID: ${batchRequestId}).`);
}


/**
 * Xử lý yêu cầu crawl conference với hai chế độ:
 * - `mode=sync` (blocking): Đợi xử lý xong và trả về dữ liệu. Dùng cho các tác vụ cập nhật nhỏ.
 * - `mode=async` (non-blocking, mặc định): Trả về 202 Accepted ngay lập tức. Dùng cho crawl hàng loạt từ Admin UI.
 */
export async function handleCrawlConferences(req: Request<{}, any, CrawlRequestPayload>, res: Response): Promise<void> {

    const requestStartTime = performance.now(); // Bắt đầu đếm giờ

    const requestContainer = rootContainer.createChildContainer();
    const loggingService = requestContainer.resolve(LoggingService);
    const currentBatchRequestId = (req as any).id || `req-conf-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = loggingService.getRequestSpecificLogger('conference', currentBatchRequestId, {
        route: '/crawl-conferences',
        entryPoint: 'handleCrawlConferences'
    });
    const { description, items: conferenceList, models: modelsFromPayload, recordFile } = req.body;
    const executionMode = (req.query.mode as string) === 'sync' ? 'sync' : 'async';
    routeLogger.info({
        event: 'received_request',
        query: req.query,
        method: req.method,
        requestDescription: description,
        itemCount: conferenceList?.length,
        modelsReceived: modelsFromPayload,
        recordFile: recordFile === true,
        executionMode: executionMode,
    }, "Received request.");

    const requestStateService = requestContainer.resolve(RequestStateService);
    requestStateService.init(recordFile);
    const crawlOrchestrator = requestContainer.resolve(CrawlOrchestratorService)
    const logAnalysisCacheService = requestContainer.resolve(LogAnalysisCacheService);

    const performCrawl = async (
        orchestrator: CrawlOrchestratorService
    ): Promise<ProcessedRowData[] | void> => {
        routeLogger.info({ description }, "Beginning processing conference crawl.");
        const dataSource = (req.query.dataSource as string) || 'client';
        if (dataSource !== 'client') {
            routeLogger.warn({ dataSource }, "Unsupported 'dataSource'. Only 'client' is supported.");
            throw new Error("Invalid 'dataSource'. Only 'client' is supported.");
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
            return [];
        }
        const processedResults: ProcessedRowData[] = await orchestrator.run(
            conferenceList,
            routeLogger,
            parsedApiModels,
            currentBatchRequestId,
            requestStateService,
            requestContainer

        );
        const modelsUsedDesc = `Determine Links: ${parsedApiModels.determineLinks}, Extract Info: ${parsedApiModels.extractInfo}, Extract CFP: ${parsedApiModels.extractCfp}`;
        routeLogger.info({
            event: 'processing_finished_successfully',
            context: {
                totalInputConferences: conferenceList.length,
                processedResults: processedResults,
                apiModelsUsed: parsedApiModels,
                requestDescription: description,
            }
        }, `Conference processing completed successfully via controller using models (${modelsUsedDesc}).`);
        return processedResults;
    };

    if (executionMode === 'sync') {
        let requestProcessed = false;
        try {
            requestProcessed = true;

            // const innerOperationStartTime = Date.now();
            const processedResults = await performCrawl(crawlOrchestrator);
            if (typeof processedResults === 'undefined') {
                if (!res.headersSent) {
                    res.status(400).json({ message: "Request could not be processed due to validation errors." });
                }
                return;
            }
            // const operationEndTime = Date.now();
            // const runTimeSeconds = ((operationEndTime - innerOperationStartTime) / 1000).toFixed(2);

            const totalRequestDurationMs = performance.now() - requestStartTime;

            routeLogger.info({
                event: 'REQUEST_COMPLETED',
                durationMs: Math.round(totalRequestDurationMs)
            }, `Sync request completed and response sent.`);

            if (!res.headersSent) {
                res.status(200).json({
                    message: `Conference processing completed. Orchestrator returned ${processedResults.length} records.`,
                    runtime: `${(totalRequestDurationMs / 1000).toFixed(2)} s`, // Sử dụng duration đã tính
                    data: processedResults,
                    description: description,
                    batchRequestId: currentBatchRequestId
                });
            }
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
        res.status(202).json({
            message: `Crawl request accepted. Processing started in the background.`,
            batchRequestId: currentBatchRequestId,
            description: description
        });
        (async () => {
            try {
                await performCrawl(crawlOrchestrator);
                const totalRequestDurationMs = performance.now() - requestStartTime;
                routeLogger.info({
                    event: 'REQUEST_COMPLETED_ASYNC',
                    durationMs: Math.round(totalRequestDurationMs)
                }, `Async background processing completed.`);
                
            } catch (error) {
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                routeLogger.error({
                    err: { message: errorMessage, stack: errorStack },
                    event: 'processing_failed_in_controller_scope',
                    requestDescription: description,
                }, "Conference processing failed in asynchronous background task.");
            } finally {
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


export async function handleStopCrawl(req: Request<{}, any, { batchRequestId: string }>, res: Response): Promise<void> {
    const { batchRequestId } = req.body;
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
    let isClientDataMissingError = false;

    try {

        requestProcessed = true;
        routeLogger.info("Starting journal crawling...");

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
                requestProcessed = false;

                throw new Error("Client data missing for journal crawl.");
            }
        } else if (dataSourceQuery && dataSourceQuery !== 'scimago') {
            routeLogger.warn({ dataSourceQueryProvided: dataSourceQuery }, "Invalid 'dataSource'. Defaulting to 'scimago'.");
        } else {
            routeLogger.info({ dataSource: 'scimago' }, "Using 'scimago' dataSource (default).");
        }

        const innerOperationStartTime = Date.now();

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

            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(processingError);
            routeLogger.error({
                err: { message: errorMessage, stack: errorStack },
                event: 'journal_processing_failed_in_scope',
            }, "Journal crawling failed.");
            if (!res.headersSent) {
                res.status(500).json({ message: 'Journal crawling failed.', error: errorMessage });
            }
            routeLogger.warn({ statusCode: res.statusCode }, "Sent error response.");

        }
    } catch (error: unknown) {
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        if (errorMessage === "Client data missing for journal crawl.") {



        } else {
            routeLogger.error(
                { err: { message: errorMessage, stack: errorStack }, event: 'journal_controller_setup_or_unexpected_error' },
                "Error during journal crawl setup or unexpected controller error."
            );
            if (!res.headersSent) {
                res.status(503).json({ message: "Server error during journal crawl request or setup." });
            }


        }
    } finally {
        if (requestProcessed) {

            await cleanupRequestResources(loggingService, logAnalysisCacheService, 'journal', batchRequestId, routeLogger);
        } else {



            try {
                await loggingService.closeRequestSpecificLogger('journal', batchRequestId);
            } catch (e) {
                const cleanupPhaseLogger = loggingService.getLogger('app', { service: 'CrawlControllerCleanupFinally' });
                cleanupPhaseLogger.warn({ err: e, batchRequestId: batchRequestId, type: 'journal' }, "Error closing logger in finally block for non-processed/error request.");
            }
        }
    }
}