// // src/api/v2/crawl/crawl.controller.ts

// import { Request, Response } from 'express';
// import 'dotenv/config';
// import path from 'path';
// import fs from 'fs';
// import { crawlJournals } from '../../../journal/crawlJournals';

// const FINAL_OUTPUT_PATH = path.join(__dirname, './data/final_output.jsonl');
// const EVALUATE_CSV_PATH = path.join(__dirname, './data/evaluate.csv');
// const OUTPUT_JSONL_JOURNAL = path.join(__dirname, './data/journal_data.jsonl');


// // --- Function to handle the crawl-journals logic ---
// export async function handleCrawlJournals(req: Request, res: Response): Promise<void> {
//     console.log("Call crawl journals")
//     const requestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
//     const routeLogger = logger.child({ requestId, route: '/crawl-journals' });

//     routeLogger.info({ method: req.method }, "Received request to crawl journals");

//     const startTime = Date.now();

//     try {
//         routeLogger.info("Starting journal crawling...");
//         await crawlJournals_v2(routeLogger); // Call crawlJournals function
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


// // 