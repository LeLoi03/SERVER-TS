// src/api/v1/crawl/crawl.controller.ts

import { Request, Response } from 'express';
import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import { logger } from '../../../conference/11_utils';
import { getConferenceList as getConferenceListFromCrawl } from '../../../conference/3_core_portal_scraping';
import { crawlConferences } from '../../../conference/crawl_conferences';
import { crawlJournals_v1 } from '../../../journal/crawl_journals_v1';
import { ConferenceData } from '../../../conference/types';
import { ProcessedResponseData } from '../../../conference/types';
import { saveToDatabase } from '../../../conference/data/save-to-db';


const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
const EVALUATE_CSV_PATH = path.join(__dirname, './data/evaluate.csv');
const OUTPUT_JSONL_JOURNAL = path.join(__dirname, './data/journal_data.jsonl');


// --- Function to handle the combined crawl/update logic ---
export async function handleCrawlConferences(req: Request<{}, any, ConferenceData[]>, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const routeLogger = (req as any).log || logger.child({ requestId, route: '/crawl-conferences' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to process conferences");

    const startTime = Date.now();
    const dataSource = (req.query.dataSource as string) || 'client'; // Mặc định là 'api'

    try {
        let conferenceList: ConferenceData[];

        routeLogger.info({ dataSource }, "Determining conference data source");

        // --- Lấy danh sách conference (Logic này giữ nguyên) ---
        if (dataSource === 'client') {
            console.log("Call client")
            conferenceList = req.body;
            if (!Array.isArray(conferenceList)) { // Chỉ cần kiểm tra là mảng
                routeLogger.warn({ bodyType: typeof conferenceList }, "Invalid conference list in request body for 'client' source.");
                res.status(400).json({ message: 'Invalid conference list provided in the request body (must be an array).' });
                return;
            }
            // Không cần kiểm tra link ở đây nữa, crawlConferences sẽ tự xử lý
            routeLogger.info({ count: conferenceList.length }, "Using conference list provided by client");
        } else { // dataSource === 'api' hoặc không được cung cấp
            if (req.body && Object.keys(req.body).length > 0) {
                routeLogger.warn("Received body when dataSource is not 'client'. Ignoring body.");
            }
            try {
                routeLogger.info("Fetching conference list from internal source...");
                conferenceList = await getConferenceListFromCrawl() as ConferenceData[];
                routeLogger.info({ count: conferenceList.length }, "Successfully fetched conference list from internal source");
            } catch (apiError: any) {
                routeLogger.error({ err: apiError }, "Failed to fetch conference list from internal source");
                res.status(500).json({ message: 'Failed to fetch conference list from internal source', error: apiError.message });
                return;
            }
        }

        // --- Kiểm tra conferenceList cuối cùng (Logic này giữ nguyên) ---
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
                 outputJsonlPath: FINAL_OUTPUT_PATH,
                 outputCsvPath: EVALUATE_CSV_PATH
             });
             return;
        }

        // --- Gọi hàm core (Logic này giữ nguyên) ---
        routeLogger.info({ conferenceCount: conferenceList.length, dataSource }, "Calling crawlConferences core function...");

        // *** Gọi crawlConferences và nhận kết quả (ProcessedResponseData | null)[] ***
        const crawlResults: (ProcessedResponseData | null)[] = await crawlConferences(conferenceList, routeLogger);

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        // --- Xử lý và gửi Response (Logic này áp dụng cho cả hai dataSource) ---

        // Lọc ra các kết quả không null 
        const processedResults = crawlResults.filter(result => result !== null) as ProcessedResponseData[];

        routeLogger.info({
            runtimeSeconds: runTimeSeconds,
            totalProcessed: conferenceList.length, // Tổng số conf được yêu cầu xử lý
            results: processedResults, // Số kết quả từ luồng trả về
            event: 'processing_finished_successfully',
            outputJsonl: FINAL_OUTPUT_PATH,
            outputCsv: EVALUATE_CSV_PATH
        }, "Conference processing finished. Returning any available results.");

        // *** Luôn trả về cấu trúc response này ***
        res.status(200).json({
            message: `Conference processing completed. ${processedResults.length} conference(s) yielded data. All processing results are reflected in server files.`,
            runtime: `${runTimeSeconds} s`,
            data: processedResults, // Trả về mảng kết quả (có thể rỗng)
            outputJsonlPath: FINAL_OUTPUT_PATH,
            outputCsvPath: EVALUATE_CSV_PATH
        });
        routeLogger.info({ statusCode: 200, resultsCount: processedResults.length }, "Sent successful response");


    } catch (error: any) {
        const endTime = Date.now();
        const runTime = endTime - startTime;
        routeLogger.error({ err: error, stack: error.stack, runtimeMs: runTime, dataSource }, "Conference processing failed within route handler");

        if (!res.headersSent) {
             res.status(500).json({
                 message: 'Conference processing failed',
                 error: error.message
             });
             routeLogger.warn({ statusCode: 500 }, "Sent error response");
        } else {
             routeLogger.error("Headers already sent, could not send 500 error response.");
        }
    }
}


// // --- Function to handle the crawl-journals logic ---
// export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
//     console.log("Call crawl journals")
//     const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
//     const routeLogger = logger.child({ requestId, route: '/crawl-journals' });

//     routeLogger.info({ method: req.method }, "Received request to crawl journals");

//     const startTime = Date.now();

//     try {
//         routeLogger.info("Starting journal crawling...");
//         await crawlJournals(routeLogger); // Call crawlJournals function
//         routeLogger.info("Journal crawling completed.");

//         const endTime = Date.now();
//         const runTime = endTime - startTime;
//         const runTimeSeconds = (runTime / 1000).toFixed(2);

//         routeLogger.info({ runtimeSeconds: runTimeSeconds }, "Journal crawling finished successfully.");

//         try {
//             const runtimeFilePath = path.resolve(__dirname, 'crawl_journals_runtime.txt');
//             await fs.promises.writeFile(runtimeFilePath, `Execution time: ${runTimeSeconds} s`);
//             routeLogger.debug({ path: runtimeFilePath }, "Successfully wrote runtime file.");

//         } catch (writeError: any) {
//             routeLogger.warn(writeError, "Could not write journal crawling runtime or data file");
//         }

//         res.status(200).json({
//             message: 'Journal crawling completed successfully!',
//             // data: journalData,
//             runtime: `${runTimeSeconds} s`
//         });
//         routeLogger.info({ statusCode: 200 }, "Sent successful response");

//     } catch (error: any) {
//         routeLogger.error(error, "Journal crawling failed within route handler");

//         res.status(500).json({
//             message: 'Journal crawling failed',
//             error: error.message,
//             stack: error.stack,
//         });
//         routeLogger.warn({ statusCode: 500 }, "Sent error response");
//     }
// }


// --- Refactored Journal Handler ---
export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
    const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    // Use a specific logger for this route, potentially deriving from a base logger
    const routeLogger = logger.child({ requestId, route: '/crawl-journals' });

    routeLogger.info({ query: req.query, method: req.method }, "Received request to process journals");

    const startTime = Date.now();
    // Determine data source: 'client' or default to 'scimago'
    const dataSource = (req.query.dataSource as string)?.toLowerCase() === 'client' ? 'client' : 'scimago';
    let clientData: string | null = null;

    routeLogger.info({ dataSource }, "Determining journal data source");

    try {
        // --- Get Journal Data based on dataSource ---
        if (dataSource === 'client') {
            // Expect raw CSV string in the body
            if (typeof req.body !== 'string' || req.body.trim().length === 0) {
                routeLogger.warn({ bodyType: typeof req.body, bodyContent: req.body }, "Invalid or empty request body for 'client' source. Expected raw CSV string.");
                res.status(400).json({ message: 'Invalid request body: Expected a non-empty raw CSV string for dataSource=client.' });
                return;
            }
            clientData = req.body;
            routeLogger.info({ bodyLength: clientData.length }, "Using journal data provided by client (CSV string)");
        } else { // dataSource === 'scimago'
            if (req.body && (typeof req.body !== 'object' || Object.keys(req.body).length > 0)) {
                 // Allow empty object bodies, but warn if non-empty body is sent for scimago mode
                 routeLogger.warn("Received non-empty body when dataSource is 'scimago'. Ignoring body.");
            }
            routeLogger.info("Proceeding with Scimago website crawl.");
            // No client data needed for scimago mode
        }

        // --- Call the core crawlJournals function ---
        routeLogger.info({ dataSource }, "Calling crawlJournals core function...");

        // Pass dataSource, clientData (if applicable), apiKeyManager, and logger
        await crawlJournals_v1(dataSource, clientData, routeLogger);

        routeLogger.info("Journal crawling process initiated by crawlJournals completed its synchronous part (actual crawling might be async internally).");

        const endTime = Date.now();
        const runTime = endTime - startTime;
        const runTimeSeconds = (runTime / 1000).toFixed(2);

        routeLogger.info({ runtimeSeconds: runTimeSeconds, dataSource }, "Journal processing request handled successfully.");

        // Optionally write runtime - consider if this is still needed or useful
        // try {
        //     const runtimeFilePath = path.resolve(__dirname, 'crawl_journals_runtime.txt');
        //     await fs.promises.writeFile(runtimeFilePath, `Last execution time: ${runTimeSeconds} s (DataSource: ${dataSource})`);
        //     routeLogger.debug({ path: runtimeFilePath }, "Successfully wrote runtime file.");
        // } catch (writeError: any) {
        //     routeLogger.warn({ err: writeError }, "Could not write journal crawling runtime file");
        // }

        res.status(200).json({
            message: `Journal processing using '${dataSource}' source completed. Results are being written to the output file.`,
            runtime: `${runTimeSeconds} s`,
            outputJsonlPath: OUTPUT_JSONL_JOURNAL // Provide path to the output file
        });
        routeLogger.info({ statusCode: 200, dataSource }, "Sent successful response");

    } catch (error: any) {
        const endTime = Date.now();
        const runTime = endTime - startTime;
        routeLogger.error({ err: error, stack: error.stack, runtimeMs: runTime, dataSource }, "Journal processing failed within route handler");

        if (!res.headersSent) {
            // Distinguish between client input errors and server errors
            if (error.message.includes("Failed to parse CSV string")) {
                 res.status(400).json({
                     message: 'Bad Request: Failed to parse the provided CSV data.',
                     error: error.message
                 });
                 routeLogger.warn({ statusCode: 400, error: error.message }, "Sent Bad Request response due to CSV parsing error.");
            } else {
                 res.status(500).json({
                     message: 'Journal processing failed',
                     error: error.message
                 });
                 routeLogger.warn({ statusCode: 500, error: error.message }, "Sent Internal Server Error response.");
            }
        } else {
            routeLogger.error("Headers already sent, could not send error response.");
        }
    }
}

export async function handleSaveConference() {
    saveToDatabase();
}