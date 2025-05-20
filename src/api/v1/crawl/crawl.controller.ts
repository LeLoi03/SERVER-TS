// src/api/v1/crawl/crawl.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { CrawlOrchestratorService } from '../../../services/crawlOrchestrator.service';
import { ConferenceData, ProcessedRowData } from '../../../types/crawl.types';
import { Logger } from 'pino';
import { LoggingService } from '../../../services/logging.service';
import { ConfigService } from '../../../config/config.service';
import { DatabasePersistenceService, DatabaseSaveResult } from '../../../services/databasePersistence.service';
import { CrawlModelType } from '../../../types/crawl.types';
export async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {

    const loggingService = container.resolve(LoggingService) as LoggingService;
    const configService = container.resolve(ConfigService) as ConfigService;
    const crawlOrchestrator = container.resolve(CrawlOrchestratorService) as CrawlOrchestratorService;

    const reqLogger = (req as any).log as Logger || loggingService.getLogger();
    const currentBatchRequestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`; // ID for this specific API call
    const routeLogger = reqLogger.child({ batchRequestId: currentBatchRequestId, route: '/crawl-conferences' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to process conferences");

    const startTime = Date.now();
    const dataSource = (req.query.dataSource as string) || 'client';
    // ++ GET crawlModel from query parameters
    const crawlModel = (req.query.model as string | undefined) || 'non-tuned'; // Default to 'non-tuned' if not provided

    // ++ VALIDATE crawlModel (optional but good practice)
    if (crawlModel !== 'tuned' && crawlModel !== 'non-tuned') {
        routeLogger.warn({ crawlModelReceived: crawlModel }, "Invalid 'model' query parameter received. Must be 'tuned' or 'non-tuned'.");
        res.status(400).json({ message: "Invalid 'model' query parameter. Must be 'tuned' or 'non-tuned'." });
        return;
    }

    const operationStartTime = Date.now();

    try {
        let conferenceList: ConferenceData[];

        routeLogger.info({ dataSource, crawlModel }, "Determining conference data source and selected model"); // ++ Log crawlModel

        if (dataSource === 'client') {
            conferenceList = req.body;
            if (!Array.isArray(conferenceList)) {
                routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list in request body for 'client' source.");
                res.status(400).json({ message: 'Invalid conference list provided in the request body (must be an array).' });
                return;
            }
            routeLogger.info({ count: conferenceList.length }, "Using conference list provided by client");
        } else {
            routeLogger.warn("Internal data source ('api') is not implemented. Please provide data via 'client' source.");
            res.status(400).json({ message: "dataSource=api is not currently supported. Use dataSource=client and provide data in the body." });
            return;
        }

        if (!conferenceList || !Array.isArray(conferenceList)) {
            routeLogger.error("Internal Error: conferenceList is not a valid array after source determination.");
            res.status(500).json({ message: "Internal Server Error: Invalid conference list." });
            return;
        }
        if (conferenceList.length === 0) {
            routeLogger.warn("Conference list is empty. Nothing to process.");
            res.status(200).json({
                message: 'Conference list provided or fetched was empty. No processing performed.',
                runtime: `0.00 s`,
                outputJsonlPath: configService.finalOutputJsonlPath,
                outputCsvPath: configService.evaluateCsvPath
            });
            return;
        }

        routeLogger.info({ conferenceCount: conferenceList.length, dataSource, crawlModel }, "Calling CrawlOrchestratorService to run the process...");


        // The orchestrator should be aware of the currentBatchRequestId
        // and also the originalRequestId for each item if provided.
        const processedResults: ProcessedRowData[] = await crawlOrchestrator.run(
            conferenceList, // Each item can now have originalRequestId
            routeLogger,
            crawlModel as CrawlModelType,
            currentBatchRequestId // Pass the ID of this batch operation
        );

        const operationEndTime = Date.now();
        const runTimeSeconds = ((operationEndTime - operationStartTime) / 1000).toFixed(2);

        routeLogger.info({
            event: 'processing_finished_successfully',
            context: {
                runtimeSeconds: parseFloat(runTimeSeconds),
                totalInput: conferenceList.length,
                resultsReturned: processedResults.length,
                crawlModelUsed: crawlModel, // ++ Log the model used
                outputJsonl: configService.finalOutputJsonlPath,
                outputCsv: configService.evaluateCsvPath,
                processed_results: processedResults,
                startTime: new Date(operationStartTime).toISOString(),
                endTime: new Date(operationEndTime).toISOString(),
            }
        }, "Conference processing finished successfully via controller. Returning results.");


        res.status(200).json({
            message: `Conference processing completed using ${crawlModel} model. Orchestrator returned ${processedResults.length} processed records. See server files for details.`, // ++ Update message
            runtime: `${runTimeSeconds} s`,
            data: processedResults,
            outputJsonlPath: configService.finalOutputJsonlPath,
            outputCsvPath: configService.evaluateCsvPath
        });
        routeLogger.info({ statusCode: 200, resultsCount: processedResults.length, crawlModelUsed: crawlModel }, "Sent successful response");

    } catch (error: any) {
        const operationEndTime = Date.now();
        const runTimeMs = operationEndTime - operationStartTime;
        const errorLogger = routeLogger || loggingService.getLogger({ currentBatchRequestId });

        errorLogger.error({
            err: error,
            stack: error.stack,
            event: 'processing_failed_in_controller',
            context: {
                runtimeMs: runTimeMs,
                dataSource: (req.query.dataSource as string) || 'client',
                crawlModelAttempted: crawlModel, // ++ Log attempted model
                startTime: new Date(operationStartTime).toISOString(),
                endTime: new Date(operationEndTime).toISOString(),
            }
        }, "Conference processing failed within route handler or orchestrator");

        if (!res.headersSent) {
            res.status(500).json({
                message: 'Conference processing failed',
                error: error.message
            });
            errorLogger.warn({ statusCode: 500 }, "Sent error response");
        } else {
            errorLogger.error("Headers already sent, could not send 500 error response.");
        }
    }
}


// --- Cập nhật các handler khác tương tự ---
export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    // *** FIX: Assert type ***
    const loggingService = container.resolve(LoggingService) as LoggingService;
    const reqLogger = (req as any).log as Logger || loggingService.getLogger();
    const routeLogger = reqLogger.child({ route: '/crawl-journals' });
    routeLogger.warn("handleCrawlJournals needs refactoring into its own service structure.");
    res.status(501).json({ message: "Journal crawling endpoint not yet refactored." });
}


// Controller này không thay đổi, nó là route riêng để lưu DB
export async function handleSaveConference(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const databasePersistenceService = container.resolve(DatabasePersistenceService);
    const configService = container.resolve(ConfigService);

    const reqLogger = (req as any).log as Logger || loggingService.getLogger();
    const requestId = (req as any).id || `req-save-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = reqLogger.child({ requestId, route: '/save-conference-evaluate' });

    routeLogger.info("Received request to save evaluated data to database.");

    try {
        const result: DatabaseSaveResult = await databasePersistenceService.saveEvaluatedData(routeLogger);

        if (result.success) {
            routeLogger.info({ event: 'manual_db_save_success', details: result }, "Manual save to database successful.");
            res.status(result.statusCode || 200).json({
                message: result.message,
                details: result.data
            });
        } else {
            routeLogger.error({ event: 'manual_db_save_failed', details: result }, "Manual save to database failed.");
            if (result.message.includes("CSV file not found")) {
                res.status(404).json({
                    message: result.message,
                    error: result.error,
                    csvPath: configService.evaluateCsvPath
                });
            } else {
                res.status(result.statusCode || 500).json({
                    message: result.message,
                    error: result.error,
                    details: result.data
                });
            }
        }
    } catch (error: any) {
        routeLogger.fatal({ err: error, stack: error.stack, event: 'manual_db_save_controller_error' }, "Unexpected error in handleSaveConference controller.");
        if (!res.headersSent) {
            res.status(500).json({
                message: 'An unexpected error occurred while trying to save to the database.',
                error: error.message
            });
        }
    }
}

// // --- Refactored Journal Handler ---
// export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
//     const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
//     // Use a specific logger for this route, potentially deriving from a base logger
//     const routeLogger = logger.child({ requestId, route: '/crawl-journals' });

//     routeLogger.info({ query: req.query, method: req.method }, "Received request to process journals");

//     const startTime = Date.now();
//     // Determine data source: 'client' or default to 'scimago'
//     const dataSource = (req.query.dataSource as string)?.toLowerCase() === 'client' ? 'client' : 'scimago';
//     let clientData: string | null = null;

//     routeLogger.info({ dataSource }, "Determining journal data source");

//     try {
//         // --- Get Journal Data based on dataSource ---
//         if (dataSource === 'client') {
//             // Expect raw CSV string in the body
//             if (typeof req.body !== 'string' || req.body.trim().length === 0) {
//                 routeLogger.warn({ bodyType: typeof req.body, bodyContent: req.body }, "Invalid or empty request body for 'client' source. Expected raw CSV string.");
//                 res.status(400).json({ message: 'Invalid request body: Expected a non-empty raw CSV string for dataSource=client.' });
//                 return;
//             }
//             clientData = req.body;
//             routeLogger.info({ bodyLength: clientData.length }, "Using journal data provided by client (CSV string)");
//         } else { // dataSource === 'scimago'
//             if (req.body && (typeof req.body !== 'object' || Object.keys(req.body).length > 0)) {
//                  // Allow empty object bodies, but warn if non-empty body is sent for scimago mode
//                  routeLogger.warn("Received non-empty body when dataSource is 'scimago'. Ignoring body.");
//             }
//             routeLogger.info("Proceeding with Scimago website crawl.");
//             // No client data needed for scimago mode
//         }

//         // --- Call the core crawlJournals function ---
//         routeLogger.info({ dataSource }, "Calling crawlJournals core function...");

//         // Pass dataSource, clientData (if applicable), apiKeyManager, and logger
//         await crawlJournals_v1(dataSource, clientData, routeLogger);

//         routeLogger.info("Journal crawling process initiated by crawlJournals completed its synchronous part (actual crawling might be async internally).");

//         const endTime = Date.now();
//         const runTime = endTime - startTime;
//         const runTimeSeconds = (runTime / 1000).toFixed(2);

//         routeLogger.info({ runtimeSeconds: runTimeSeconds, dataSource }, "Journal processing request handled successfully.");

//         // Optionally write runtime - consider if this is still needed or useful
//         // try {
//         //     const runtimeFilePath = path.resolve(__dirname, 'crawl_journals_runtime.txt');
//         //     await fs.promises.writeFile(runtimeFilePath, `Last execution time: ${runTimeSeconds} s (DataSource: ${dataSource})`);
//         //     routeLogger.debug({ path: runtimeFilePath }, "Successfully wrote runtime file.");
//         // } catch (writeError: any) {
//         //     routeLogger.warn({ err: writeError }, "Could not write journal crawling runtime file");
//         // }

//         res.status(200).json({
//             message: `Journal processing using '${dataSource}' source completed. Results are being written to the output file.`,
//             runtime: `${runTimeSeconds} s`,
//             outputJsonlPath: OUTPUT_JSONL_JOURNAL // Provide path to the output file
//         });
//         routeLogger.info({ statusCode: 200, dataSource }, "Sent successful response");

//     } catch (error: any) {
//         const endTime = Date.now();
//         const runTime = endTime - startTime;
//         routeLogger.error({ err: error, stack: error.stack, runtimeMs: runTime, dataSource }, "Journal processing failed within route handler");

//         if (!res.headersSent) {
//             // Distinguish between client input errors and server errors
//             if (error.message.includes("Failed to parse CSV string")) {
//                  res.status(400).json({
//                      message: 'Bad Request: Failed to parse the provided CSV data.',
//                      error: error.message
//                  });
//                  routeLogger.warn({ statusCode: 400, error: error.message }, "Sent Bad Request response due to CSV parsing error.");
//             } else {
//                  res.status(500).json({
//                      message: 'Journal processing failed',
//                      error: error.message
//                  });
//                  routeLogger.warn({ statusCode: 500, error: error.message }, "Sent Internal Server Error response.");
//             }
//         } else {
//             routeLogger.error("Headers already sent, could not send error response.");
//         }
//     }
// }

// export async function handleSaveConference(req: Request, res: Response): Promise<void> {
//     try {
//         await saveToDatabase();
//         console.log("Conference data saved successfully.");
//     }
//     catch (error) {
//         console.error("Error saving conference data:", error);
//         res.status(500).json({ message: 'Error saving conference data' });
//     }
//     res.status(200).json({ message: 'Conference data saved successfully' });
// }