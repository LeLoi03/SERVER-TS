// src/api/v1/save/save.controller.ts
import { Request, Response } from 'express';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { LoggingService } from '../../../services/logging.service'; // Điều chỉnh path


export interface PersistSaveStatusPayload {
    batchRequestId: string;
    acronym: string;
    title: string;
    status: 'SAVED_TO_DATABASE'; // Hoặc một enum nếu có nhiều loại status
    clientTimestamp: string; // ISO string
}



// Interface cho payload backend, có thể mở rộng nếu cần
interface ConferenceSaveEventLogPayload extends PersistSaveStatusPayload {
    // Thêm các trường backend-specific nếu có
}

export async function handleConferenceSaveEvent(req: Request, res: Response): Promise<void> {
    const loggingService = container.resolve(LoggingService);
    // Sử dụng logger chuyên dụng cho save events
    const saveEventLogger = loggingService.getLogger('saveEvent'); 
    const baseReqLogger = (req as any).log as Logger || saveEventLogger; // Dùng saveEventLogger làm fallback

    const payload = req.body as ConferenceSaveEventLogPayload;

    // Validate payload cơ bản
    if (!payload.batchRequestId || !payload.acronym || !payload.title || !payload.status || !payload.clientTimestamp) {
        baseReqLogger.warn({ body: req.body }, "Invalid payload for conference-save-event");
        res.status(400).json({ success: false, message: "Missing required fields in payload." });
        return;
    }

    try {
        const logData = {
            event: "CONFERENCE_SAVE_EVENT_RECORDED", // Tên event rõ ràng
            details: {
                batchRequestId: payload.batchRequestId,
                acronym: payload.acronym,
                title: payload.title,
                recordedStatus: payload.status, // Đổi tên để tránh nhầm với status của log entry
                clientTimestamp: payload.clientTimestamp,
            },
            // Các trường metadata khác nếu cần
        };

        saveEventLogger.info(logData, `Conference save event recorded for: ${payload.acronym} - ${payload.title}`);
        
        res.status(200).json({ success: true, message: "Save event logged successfully." });

    } catch (error) {
        const err = error as Error;
        baseReqLogger.error({ err, body: req.body }, "Error processing conference-save-event");
        res.status(500).json({ success: false, message: "Internal server error while logging save event." });
    }
}