// src/api/v1/save/save.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../../../services/logging.service'; // Điều chỉnh path

// Interface for a single item in the batch payload from the client
export interface PersistSaveStatusPayload {
    batchRequestId: string;
    acronym: string;
    title: string;
    status: 'SAVED_TO_DATABASE'; // Or a more general string if other statuses are possible
    clientTimestamp: string; // ISO string
}

// Interface for the payload items as processed by the backend
// (can be the same as PersistSaveStatusPayload or extended)
interface ConferenceSaveEventLogPayload extends PersistSaveStatusPayload {
    // Add any backend-specific fields if necessary
}

// Interface for the result of processing a single item in the batch
interface BatchItemResult {
    acronym: string;
    title: string;
    success: boolean;
    message: string;
}

/**
 * Handles a batch of conference save event logging requests.
 * Expects an array of ConferenceSaveEventLogPayload in req.body.
 * Returns an overall status and itemized results.
 */
export async function handleConferenceSaveEvents(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    const saveEventLogger = loggingService.getLogger('saveConferenceEvent');
    // Use request-specific logger if available (e.g., from pino-http middleware), otherwise fallback
    const baseReqLogger = (req as any).log as Logger || saveEventLogger;

    const payloads = req.body as ConferenceSaveEventLogPayload[];

    // Validate if the payload is an array and not empty
    if (!Array.isArray(payloads)) {
        baseReqLogger.warn({ body: req.body, type: typeof req.body }, "Invalid payload: Expected an array for batch conference-save-event.");
        res.status(400).json({
            success: false,
            message: "Invalid payload format. Expected an array of save event objects.",
            data: []
        });
        return;
    }

    if (payloads.length === 0) {
        baseReqLogger.info("Empty payload array received for batch conference-save-event.");
        res.status(200).json({
            success: true,
            message: "No save events to process in the batch.",
            data: []
        });
        return;
    }

    const results: BatchItemResult[] = [];
    let allItemsSucceeded = true;

    baseReqLogger.info(`Processing batch of ${payloads.length} conference save events.`);

    for (const payload of payloads) {
        // Validate individual payload item
        if (!payload || !payload.batchRequestId || !payload.acronym || !payload.title || !payload.status || !payload.clientTimestamp) {
            const errorMessage = "Missing required fields in an item.";
            baseReqLogger.warn({ itemPayload: payload }, `Invalid item in batch: ${errorMessage}`);
            results.push({
                acronym: payload?.acronym || 'N/A',
                title: payload?.title || 'N/A',
                success: false,
                message: errorMessage
            });
            allItemsSucceeded = false;
            continue; // Move to the next item
        }

        try {
            const logData = {
                event: "CONFERENCE_SAVE_EVENT_RECORDED", // Clear event name
                details: {
                    batchRequestId: payload.batchRequestId,
                    acronym: payload.acronym,
                    title: payload.title,
                    recordedStatus: payload.status, // Renamed to avoid confusion with log entry status
                    clientTimestamp: payload.clientTimestamp,
                    // You might want to add serverTimestamp here as well
                    serverTimestamp: new Date().toISOString(),
                },
                // Other metadata fields if needed
            };

            // Log the event using the specialized logger
            saveEventLogger.info(logData, `Conference save event recorded for: ${payload.acronym} - ${payload.title}`);

            results.push({
                acronym: payload.acronym,
                title: payload.title,
                success: true,
                message: "Save event logged successfully."
            });

        } catch (error) {
            const err = error as Error;
            // Log the error with context of the specific item
            baseReqLogger.error({ err, itemPayload: payload }, `Error processing item in conference-save-event batch for: ${payload.acronym} - ${payload.title}`);
            results.push({
                acronym: payload.acronym,
                title: payload.title,
                success: false,
                message: "Internal server error while logging save event for this item."
            });
            allItemsSucceeded = false;
        }
    }

    // Determine overall response
    if (allItemsSucceeded) {
        baseReqLogger.info("All conference save events in batch processed successfully.");
        res.status(200).json({
            success: true,
            message: "All save events in the batch logged successfully.",
            data: results
        });
    } else {
        baseReqLogger.warn("Some conference save events in batch failed to process.");
        // HTTP 207 Multi-Status is appropriate when an operation has multiple parts,
        // and the status of each part needs to be reported.
        res.status(207).json({
            success: false, // Overall success is false if any item failed
            message: "Some save events in the batch could not be logged. Check itemized results.",
            data: results
        });
    }
}



//// ----- JOURNAL ------

import { JournalImportService } from '../../../services/journalImport.service';

/**
 * Xử lý yêu cầu import journals từ một file log (.jsonl).
 */
export async function importJournalsFromLog(req: Request, res: Response): Promise<void> {
    // Lấy một logger ổn định ngay từ đầu.
    // Logger này không phụ thuộc vào vòng đời của request.
    const loggingService = container.resolve(LoggingService);
    const stableLogger = loggingService.getLogger('app', { controller: 'importJournalsFromLog' });

    const { batchRequestId } = req.body;

    if (!batchRequestId) {
        stableLogger.warn({ body: req.body }, 'Import request failed: Missing batchRequestId');
        res.status(400).json({ success: false, message: 'batchRequestId is required.' });
        return;
    }

    // Thêm context vào logger để dễ theo dõi
    const loggerWithContext = stableLogger.child({ batchRequestId });

    try {
        loggerWithContext.info('Starting import process from log file...');
        
        const journalImportService = container.resolve(JournalImportService);
        const result = await journalImportService.importJournalsFromLogFile(batchRequestId);

        // SỬ DỤNG LOGGER ỔN ĐỊNH ĐỂ GHI LOG THÀNH CÔNG
        loggerWithContext.info({ ...result }, `Successfully processed import for batch.`);
        
        // Chỉ gửi response nếu nó chưa được gửi đi
        if (!res.headersSent) {
            // API đã trả về status 201 (Created), nên chúng ta cũng nên trả về 200 hoặc 201
            // Kết quả từ DB API đã có, chỉ cần trả về cho client
            res.status(200).json(result);
        }

    } catch (error) {
        const err = error as Error;
        
        // SỬ DỤNG LOGGER ỔN ĐỊNH ĐỂ GHI LOG LỖI
        loggerWithContext.error({ 
            err: { message: err.message, stack: err.stack }
        }, `Error processing import for batch.`);
        
        // Chỉ gửi response nếu nó chưa được gửi đi
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: err.message || 'An internal server error occurred.' });
        }
    }
}