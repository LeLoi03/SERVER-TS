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
import { ConferenceData, ProcessedRowData } from '../../../types/crawl/crawl.types';
import { ApiModels, CrawlModelType } from '../../../types/crawl/crawl.types'; // Import CrawlModelType

// Import the new error utility
import { getErrorMessageAndStack } from '../../../utils/errorUtils';


// Import the journal crawling function
import { crawlJournals } from '../../../journal/crawlJournals';

/**
 * Defines the expected keys for the `apiModels` query parameter.
 * These keys map to different stages of the AI model processing pipeline.
 */
const EXPECTED_API_MODEL_KEYS: (keyof ApiModels)[] = ["determineLinks", "extractInfo", "extractCfp"];

/**
 * Default API models to use if not specified in the request.
 */
const DEFAULT_API_MODELS: ApiModels = {
    determineLinks: 'tuned',
    extractInfo: 'tuned',
    extractCfp: 'non-tuned',
};

/**
 * A global Mutex instance to control concurrency for the `/crawl-conferences` route.
 * This ensures that only one complex crawl operation is processed at a time,
 * preventing server overload from simultaneous long-running tasks.
 * @type {Mutex}
 */
const crawlConferenceLock: Mutex = new Mutex();

/**
 * A global Mutex instance to control concurrency for the `/crawl-journals` route.
 */
const crawlJournalLock: Mutex = new Mutex(); // <<<< ADD Mutex for journal crawling


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

    // Log request body data (ConferenceData array)
    console.log('\n--- API Request Body (ConferenceData) ---');
    console.log(JSON.stringify(req.body, null, 2)); // Use JSON.stringify for pretty print
    console.log('------------------------------------------');

    // Log query parameters
    console.log('\n--- API Request Query Parameters ---');
    console.log(JSON.stringify(req.query, null, 2));
    console.log('------------------------------------');


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

            const apiModelsFromQuery = req.query.models;
            let parsedApiModels: ApiModels = { ...DEFAULT_API_MODELS }; // Start with defaults

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

                // Log the final processed results returned by the orchestrator
                console.log('\n--- Final Processed Results (ProcessedRowData[]) ---');
                console.log(JSON.stringify(processedResults, null, 2));
                console.log('----------------------------------------------------');

                res.status(200).json({
                    message: `Conference processing completed using specified API models (${modelsUsedDesc}). Orchestrator returned ${processedResults.length} processed records.`,
                    runtime: `${runTimeSeconds} s`,
                    data: processedResults,
                    outputJsonlPath: finalOutputJsonlPathForBatch,
                    outputCsvPath: evaluateCsvPathForBatch
                });
                routeLogger.info({ statusCode: 200, resultsCount: processedResults.length, apiModelsUsed: parsedApiModels }, "Successfully sent 200 OK response to client.");

            } catch (error: unknown) { // Use unknown here
                const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
                const operationEndTime = Date.now();
                const runTimeMs = operationEndTime - operationStartTime;
                const errorLogger = routeLogger;

                // Log any error details caught within the processing flow
                console.error('\n--- Error Details from Controller ---');
                console.error('Message:', errorMessage);
                console.error('Stack:', errorStack);
                console.error('-------------------------------------');

                errorLogger.error({
                    err: { message: errorMessage, stack: errorStack }, // Use extracted info
                    event: 'processing_failed_in_controller',
                    context: {
                        runtimeMs: runTimeMs,
                        dataSource: (req.query.dataSource as string) || 'client',
                        apiModelsAttempted: parsedApiModels || apiModelsFromQuery, // parsedApiModels will always be defined now
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
        // Log any unexpected error during mutex acquisition/execution
        console.error('\n--- Critical Error Details (Mutex) ---');
        console.error('Message:', errorMessage);
        console.error('Stack:', errorStack);
        console.error('--------------------------------------');

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



// --- Function to handle the crawl-journals logic ---
export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    const baseLoggingService = container.resolve(LoggingService);
    const baseReqLogger = (req as any).log as Logger || baseLoggingService.getLogger();
    const configService = container.resolve(ConfigService); // <<<< Get ConfigService instance

    const requestId = (req as any).id || `req-journal-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = baseReqLogger.child({ requestId, route: '/crawl-journals' });

    routeLogger.info({ method: req.method, query: req.query }, "Received request to crawl journals");

    if (crawlJournalLock.isLocked()) {
        routeLogger.warn(
            { route: '/crawl-journals' },
            "Request to /crawl-journals rejected: Server is currently busy processing another journal crawl request."
        );
        res.status(429).json({
            message: "The server is busy processing another journal crawl request. Please try again later."
        });
        return;
    }

    const startTime = Date.now();

    try {
        await crawlJournalLock.runExclusive(async () => {
            routeLogger.info("Mutex lock acquired for journal crawl. Starting journal crawling...");

            // Determine dataSource for journals: 'scimago' or 'client'
            // 'scimago' is default if not specified or invalid
            // 'client' requires CSV data in the request body
            let dataSource: 'scimago' | 'client' = 'scimago';
            const dataSourceQuery = req.query.dataSource as string;
            let clientData: string | null = null;

            if (dataSourceQuery === 'client') {
                dataSource = 'client';
                // For 'client' mode, expect CSV data in the body
                // Assuming body-parser or similar middleware handles raw text/csv body
                if (typeof req.body === 'string' && req.body.trim().length > 0) {
                    clientData = req.body;
                    routeLogger.info({ dataSource: 'client', bodyLength: clientData.length }, "Journal crawl mode: client. Using CSV data from request body.");
                } else {
                    routeLogger.error({ dataSource: 'client', bodyType: typeof req.body }, "Journal crawl mode 'client' selected, but no valid CSV string found in request body.");
                    if (!res.headersSent) {
                        res.status(400).json({ message: "For 'client' dataSource, a non-empty CSV string is required in the request body." });
                    }
                    // To prevent further execution within runExclusive if headers already sent or to stop processing
                    throw new Error("Client data missing for journal crawl.");
                }
            } else if (dataSourceQuery) {
                routeLogger.warn({ dataSourceQueryProvided: dataSourceQuery }, "Invalid 'dataSource' for journals. Defaulting to 'scimago'. Supported: 'scimago', 'client'.");
                // dataSource remains 'scimago'
            } else {
                routeLogger.info({ dataSource: 'scimago' }, "Journal crawl mode: scimago (default).");
            }

            // Call crawlJournals function with ConfigService and determined dataSource/clientData
            await crawlJournals(dataSource, clientData, routeLogger, configService);

            routeLogger.info("Journal crawling completed by the service.");

            const endTime = Date.now();
            const runTime = endTime - startTime;
            const runTimeSeconds = (runTime / 1000).toFixed(2);

            routeLogger.info({ runtimeSeconds: runTimeSeconds, dataSourceUsed: dataSource }, "Journal crawling finished successfully.");

            // The journal_data.jsonl path is now managed by ConfigService and crawlJournals
            const journalOutputPath = configService.journalOutputJsonlPath;

            if (!res.headersSent) {
                res.status(200).json({
                    message: `Journal crawling completed successfully using '${dataSource}' source!`,
                    runtime: `${runTimeSeconds} s`,
                    outputPath: journalOutputPath
                });
                routeLogger.info({ statusCode: 200, outputPath: journalOutputPath }, "Sent successful response for journal crawl.");
            }
        });

    } catch (error: unknown) { // Catch errors from runExclusive or crawlJournals itself
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        const endTime = Date.now();
        const runTimeMs = endTime - startTime;

        console.error('\n--- Error Details from Journal Controller ---');
        console.error('Message:', errorMessage);
        console.error('Stack:', errorStack);
        console.error('---------------------------------------------');

        routeLogger.error({
            err: { message: errorMessage, stack: errorStack },
            event: 'journal_processing_failed_in_controller',
            context: { runtimeMs: runTimeMs }
        }, "Journal crawling failed within the /crawl-journals route handler or service.");

        if (!res.headersSent) {
            // If the error was due to missing client data, it might have already sent a 400
            if (errorMessage === "Client data missing for journal crawl.") {
                // The 400 response was likely already sent, or this is a fallback.
                // Avoid sending another response if one was already sent.
                // The check for res.headersSent should handle this, but being explicit.
            } else {
                res.status(500).json({
                    message: 'Journal crawling failed due to an internal server error.',
                    error: errorMessage,
                });
                routeLogger.warn({ statusCode: 500 }, "Sent 500 Internal Server Error response for journal crawl.");
            }
        } else {
            routeLogger.error("Headers already sent for /crawl-journals request, could not send 500 error response.");
        }
    }
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