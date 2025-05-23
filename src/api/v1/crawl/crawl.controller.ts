// src/api/v1/crawl/crawl.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { Mutex } from 'async-mutex';
import { Logger } from 'pino';

// Import core services and types
import { CrawlOrchestratorService } from '../../../services/crawlOrchestrator.service';
import { LoggingService } from '../../../services/logging.service';
import { ConfigService } from '../../../config/config.service';
import { DatabasePersistenceService, DatabaseSaveResult } from '../../../services/databasePersistence.service';

// Import custom types for request/response data
import { ConferenceData, ProcessedRowData } from '../../../types/crawl.types';
import { ApiModels } from '../../../types/crawl.types';

// Import the new error utility
import { getErrorMessageAndStack } from '../../../utils/errorUtils';

/**
 * Defines the expected keys for the `apiModels` query parameter.
 * These keys map to different stages of the AI model processing pipeline.
 */
const EXPECTED_API_MODEL_KEYS: (keyof ApiModels)[] = ["determineLinks", "extractInfo", "extractCfp"];

/**
 * A global Mutex instance to control concurrency for the `/crawl-conferences` route.
 * This ensures that only one complex crawl operation is processed at a time,
 * preventing server overload from simultaneous long-running tasks.
 * @type {Mutex}
 */
const crawlConferenceLock = new Mutex();

/**
 * Handles incoming requests to crawl conference data.
 * This controller enforces a single-threaded execution for crawl operations
 * using a Mutex to prevent concurrent long-running processes.
 * It validates input, orchestrates the crawling via `CrawlOrchestratorService`,
 * and sends back the processing results.
 *
 * @param {Request<{}, any, ConferenceData[]>} req - The Express request object,
 *   expecting an array of `ConferenceData` in the body for `dataSource='client'`.
 * @param {Response} res - The Express response object.
 * @returns {Promise<void>} A promise that resolves when the response has been sent.
 */
export async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const baseLoggingService = container.resolve(LoggingService);
    const baseReqLogger = (req as any).log as Logger || baseLoggingService.getLogger();

    if (crawlConferenceLock.isLocked()) {
        baseReqLogger.warn(
            { route: '/crawl-conferences' },
            "Request to /crawl-conferences rejected: Server is currently busy processing another crawl request."
        );
        res.status(429).json({
            message: "The server is busy processing another crawl request. Please try again later."
        });
        return;
    }

    try {
        await crawlConferenceLock.runExclusive(async () => {
            const configService = container.resolve(ConfigService);
            const crawlOrchestrator = container.resolve(CrawlOrchestratorService);

            const currentBatchRequestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
            const routeLogger = baseReqLogger.child({ batchRequestId: currentBatchRequestId, route: '/crawl-conferences' });

            routeLogger.info({ query: req.query, method: req.method }, "Mutex lock acquired. Beginning processing for conference crawl request.");

            const finalOutputJsonlPathForBatch = configService.getFinalOutputJsonlPathForBatch(currentBatchRequestId);
            const evaluateCsvPathForBatch = configService.getEvaluateCsvPathForBatch(currentBatchRequestId);

            const dataSource = (req.query.dataSource as string) || 'client';
            if (dataSource !== 'client') {
                routeLogger.warn({ dataSource }, "Unsupported 'dataSource' query parameter. Only 'client' is supported.");
                res.status(400).json({ message: "Invalid 'dataSource' specified. Currently, only 'client' (data in request body) is supported." });
                return;
            }

            const apiModelsFromQuery: unknown = req.query.models;

            let parsedApiModels: ApiModels;

            if (typeof apiModelsFromQuery !== 'object' || apiModelsFromQuery === null) {
                routeLogger.warn({ modelsReceived: apiModelsFromQuery }, "Invalid 'models' query parameter: Expected an object but received non-object or null.");
                res.status(400).json({ message: "Invalid 'models' query parameter: Must be an object with keys 'determineLinks', 'extractInfo', 'extractCfp'." });
                return;
            }

            const validationErrors: string[] = [];
            for (const key of EXPECTED_API_MODEL_KEYS) {
                const modelValue = (apiModelsFromQuery as Record<string, string>)[key];
                if (!modelValue) {
                    validationErrors.push(`Missing model selection for API step: '${key}'.`);
                } else if (modelValue !== 'tuned' && modelValue !== 'non-tuned') {
                    validationErrors.push(`Invalid model value '${modelValue}' for API step '${key}'. Must be 'tuned' or 'non-tuned'.`);
                }
            }

            if (validationErrors.length > 0) {
                routeLogger.warn({ errors: validationErrors, modelsReceived: apiModelsFromQuery }, "Invalid 'models' query parameter values detected.");
                res.status(400).json({ message: "Invalid 'models' selection provided.", errors: validationErrors });
                return;
            }
            parsedApiModels = apiModelsFromQuery as ApiModels;

            const operationStartTime = Date.now();

            try {
                let conferenceList: ConferenceData[];
                routeLogger.info({ dataSource, apiModels: parsedApiModels }, "Determining conference data source and selected API models for processing.");

                conferenceList = req.body;
                if (!Array.isArray(conferenceList)) {
                    routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list in request body: Expected an array.");
                    res.status(400).json({ message: 'Invalid conference list provided in the request body (must be an array).' });
                    return;
                }

                if (!conferenceList || conferenceList.length === 0) {
                    routeLogger.warn("Conference list is empty. No processing will be performed.");
                    const operationEndTime = Date.now();
                    const runTimeSeconds = ((operationEndTime - operationStartTime) / 1000).toFixed(2);
                    res.status(200).json({
                        message: 'Conference list provided was empty. No processing performed.',
                        runtime: `${runTimeSeconds} s`,
                        outputJsonlPath: finalOutputJsonlPathForBatch,
                        outputCsvPath: evaluateCsvPathForBatch
                    });
                    return;
                }

                routeLogger.info(
                    { conferenceCount: conferenceList.length, dataSource, apiModels: parsedApiModels },
                    "Calling CrawlOrchestratorService to begin the conference processing workflow..."
                );

                const processedResults: ProcessedRowData[] = await crawlOrchestrator.run(
                    conferenceList,
                    routeLogger,
                    parsedApiModels,
                    currentBatchRequestId
                );

                const operationEndTime = Date.now();
                const runTimeSeconds = ((operationEndTime - operationStartTime) / 1000).toFixed(2);
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
                        operationStartTime: new Date(operationStartTime).toISOString(),
                        operationEndTime: new Date(operationEndTime).toISOString(),
                    }
                }, `Conference processing completed successfully via controller using models (${modelsUsedDesc}).`);

                res.status(200).json({
                    message: `Conference processing completed using specified API models (${modelsUsedDesc}). Orchestrator returned ${processedResults.length} processed records.`,
                    runtime: `${runTimeSeconds} s`,
                    outputJsonlPath: finalOutputJsonlPathForBatch,
                    outputCsvPath: evaluateCsvPathForBatch
                });
                routeLogger.info({ statusCode: 200, resultsCount: processedResults.length, apiModelsUsed: parsedApiModels }, "Successfully sent 200 OK response to client.");

            } catch (error: unknown) { // Use unknown here
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                const operationEndTime = Date.now();
                const runTimeMs = operationEndTime - operationStartTime;
                const errorLogger = routeLogger;

                errorLogger.error({
                    err: { message: errorMessage, stack: errorStack }, // Use extracted info
                    event: 'processing_failed_in_controller',
                    context: {
                        runtimeMs: runTimeMs,
                        dataSource: (req.query.dataSource as string) || 'client',
                        apiModelsAttempted: parsedApiModels || apiModelsFromQuery,
                        operationStartTime: new Date(operationStartTime).toISOString(),
                        operationEndTime: new Date(operationEndTime).toISOString(),
                    }
                }, "Conference processing failed within the /crawl-conferences route handler or orchestrator service.");

                if (!res.headersSent) {
                    res.status(500).json({
                        message: 'Conference processing failed due to an internal server error.',
                        error: errorMessage // Use extracted message
                    });
                    errorLogger.warn({ statusCode: 500 }, "Sent 500 Internal Server Error response to client.");
                } else {
                    errorLogger.error("Headers already sent for /crawl-conferences request, could not send 500 error response.");
                }
            }
        });
    } catch (error: unknown) { // Use unknown here
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        if (!res.headersSent) {
            baseReqLogger.error(
                { err: { message: errorMessage, stack: errorStack }, route: '/crawl-conferences', event: 'mutex_execution_error' },
                "An unexpected error occurred during mutex execution for /crawl-conferences route."
            );
            res.status(503).json({ message: "Server encountered an internal issue managing the request queue. Please try again." });
        } else {
            baseReqLogger.error(
                { err: { message: errorMessage, stack: errorStack }, route: '/crawl-conferences', event: 'mutex_execution_error_headers_sent' },
                "An unexpected error occurred during mutex execution, but headers were already sent."
            );
        }
    }
}

export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const reqLogger = (req as any).log as Logger || loggingService.getLogger();
    const routeLogger = reqLogger.child({ route: '/crawl-journals' });
    routeLogger.warn("Endpoint /crawl-journals is under development. Journal crawling functionality is not yet fully implemented and refactored.");
    res.status(501).json({ message: "Journal crawling endpoint is currently not implemented. Please check back later." });
}

export async function handleSaveConference(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const databasePersistenceService = container.resolve(DatabasePersistenceService);
    const configService = container.resolve(ConfigService);

    const reqLogger = (req as any).log as Logger || loggingService.getLogger();
    const requestId = (req as any).id || `req-save-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = reqLogger.child({ requestId, route: '/save-conference-evaluate' });

    routeLogger.info("Received request to manually save evaluated data to database.");

    try {
        const result: DatabaseSaveResult = await databasePersistenceService.saveEvaluatedData(routeLogger);

        if (result.success) {
            routeLogger.info({ event: 'manual_db_save_success', details: result }, "Manual save to database completed successfully.");
            res.status(result.statusCode || 200).json({
                message: result.message,
                details: result.data
            });
            routeLogger.info({ statusCode: res.statusCode }, "Sent successful response for manual DB save.");
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
            routeLogger.warn({ statusCode: res.statusCode }, "Sent error response for manual DB save.");
        }
    } catch (error: unknown) { // Use unknown here
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        routeLogger.fatal({ err: { message: errorMessage, stack: errorStack }, event: 'manual_db_save_controller_error' }, "An unexpected fatal error occurred in handleSaveConference controller.");
        if (!res.headersSent) {
            res.status(500).json({
                message: 'An unexpected internal server error occurred while trying to save to the database.',
                error: errorMessage
            });
            routeLogger.warn({ statusCode: 500 }, "Sent 500 Internal Server Error response due to unexpected controller error.");
        }
    }
}