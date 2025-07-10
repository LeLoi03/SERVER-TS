import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { Logger } from 'pino';
import { z } from 'zod';

import { ConferenceLogAnalysisService } from '../../../services/conferenceLogAnalysis.service';
import { ConferenceLogAnalysisResult } from '../../../types/logAnalysis';
import { JournalLogAnalysisService } from '../../../services/journalLogAnalysis.service';
import { JournalLogAnalysisResult } from '../../../types/logAnalysisJournal/logAnalysisJournal.types';
import { LoggingService } from '../../../services/logging.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';
import { LogDeletionService, RequestDeletionResult, CrawlerType } from '../../../services/logDeletion.service';
// --- THÊM IMPORT MỚI ---
import { LogDownloadService } from '../../../services/logDownload.service';
import { ChatbotLogAnalysisService } from '../../../services/chatbotAnalysis.service';

const getControllerLogger = (req: Request, routeName: string): Logger => {
    const loggingService = container.resolve(LoggingService);
    const pinoRequestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    return loggingService.getLogger('app').child({
        controller: 'LogAnalysisController',
        route: routeName,
        pinoRequestId: pinoRequestId,
        analysisType: routeName.includes('Conference') ? 'conference' : 'journal'
    });
};

const handleAnalysisResponse = (
    res: Response,
    results: ConferenceLogAnalysisResult | JournalLogAnalysisResult,
) => {
    res.status(200).json(results);
};

export const getLatestConferenceAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'getLatestConferenceAnalysis');
    const conferenceAnalysisService = container.resolve(ConferenceLogAnalysisService);

    try {
        const {
            filterStartTime: filterStartTimeStr,
            filterEndTime: filterEndTimeStr,
            // SỬA LỖI Ở ĐÂY: Đọc đúng tham số 'textFilter'
            textFilter: textFilterQuery
        } = req.query;

        const filterStartTime = typeof filterStartTimeStr === 'string' && !isNaN(parseInt(filterStartTimeStr, 10))
            ? parseInt(filterStartTimeStr, 10) : undefined;
        const filterEndTime = typeof filterEndTimeStr === 'string' && !isNaN(parseInt(filterEndTimeStr, 10))
            ? parseInt(filterEndTimeStr, 10) : undefined;

        // SỬA LỖI Ở ĐÂY: Gán giá trị từ textFilterQuery
        const textFilterParam = typeof textFilterQuery === 'string' ? textFilterQuery : undefined;

        logger.debug({ filterStartTime, filterEndTime, textFilter: textFilterParam }, "Performing conference analysis.");
        const results: ConferenceLogAnalysisResult = await conferenceAnalysisService.performConferenceAnalysisAndUpdate(
            filterStartTime, filterEndTime, textFilterParam // Truyền đúng tham số
        );

        handleAnalysisResponse(res, results);

    } catch (error: unknown) {
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack: (error as Error).stack }, "Unhandled error in getLatestConferenceAnalysis.");
        next(error);
    }
};

export const getLatestJournalAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'getLatestJournalAnalysis');
    logger.info({ query: req.query }, "Request received for latest journal analysis.");

    const journalLogAnalysisService = container.resolve(JournalLogAnalysisService);

    try {
        const {
            filterStartTime: filterStartTimeStr,
            filterEndTime: filterEndTimeStr,
            // SỬA LỖI Ở ĐÂY: Đọc đúng tham số 'textFilter'
            textFilter: textFilterQuery
        } = req.query;

        const filterStartTime = typeof filterStartTimeStr === 'string' && !isNaN(parseInt(filterStartTimeStr, 10))
            ? parseInt(filterStartTimeStr, 10) : undefined;
        const filterEndTime = typeof filterEndTimeStr === 'string' && !isNaN(parseInt(filterEndTimeStr, 10))
            ? parseInt(filterEndTimeStr, 10) : undefined;

        // SỬA LỖI Ở ĐÂY: Gán giá trị từ textFilterQuery
        const requestIdParam = typeof textFilterQuery === 'string' ? textFilterQuery : undefined;

        logger.debug({ filterStartTime, filterEndTime, textFilter: requestIdParam }, "Performing journal analysis.");
        const results: JournalLogAnalysisResult = await journalLogAnalysisService.performJournalAnalysisAndUpdate(
            filterStartTime, filterEndTime, requestIdParam // Truyền đúng tham số
        );

        handleAnalysisResponse(res, results);

    } catch (error: unknown) {
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack: (error as Error).stack }, `Unhandled error in getLatestJournalAnalysis.`);
        next(error);
    }
};

// Schema for delete request validation
const deleteRequestsSchema = z.object({
    requestIds: z.array(z.string().min(1, "Request ID cannot be empty"))
        .min(1, "At least one requestId must be provided"),
    crawlerType: z.enum(['conference', 'journal']),
});

export const deleteLogAnalysisRequests = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'deleteLogAnalysisRequests');
    logger.info({ body: req.body }, "Request received to delete log analysis requests.");

    try {
        const validation = deleteRequestsSchema.safeParse(req.body);
        if (!validation.success) {
            logger.warn({ errors: validation.error.format() }, "Invalid request body for deleting requests.");
            res.status(400).json({ message: "Invalid input", errors: validation.error.format() });
            return;
        }

        const { requestIds, crawlerType } = validation.data;

        const logDeletionService = container.resolve(LogDeletionService);
        const results: RequestDeletionResult[] = [];

        for (const requestId of requestIds) {
            const result = await logDeletionService.deleteRequestData(requestId, crawlerType as CrawlerType);
            results.push(result);
        }

        const allSucceeded = results.every(r => r.overallSuccess);
        const someSucceeded = results.some(r => r.overallSuccess) && !allSucceeded;

        logger.info({ results, allSucceeded, someSucceeded }, "Deletion processing complete.");

        if (allSucceeded) {
            res.status(200).json({
                message: `Successfully deleted data for all ${results.length} request(s).`,
                results
            });
        } else if (someSucceeded) {
            res.status(207).json({
                message: "Partial success: Some requests had issues during deletion. See results for details.",
                results
            });
        } else {
            res.status(500).json({
                message: "Failed to delete data for any of the specified requests. See results for details.",
                results
            });
        }

    } catch (error: unknown) {
        const { message, stack } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack }, "Unhandled error in deleteLogAnalysisRequests.");
        next(error);
    }
};


// --- BỔ SUNG CONTROLLER MỚI ĐỂ DOWNLOAD ---

// Schema để validate request download
const downloadRequestSchema = z.object({
    requestId: z.string().min(1, "requestId cannot be empty"),
    crawlerType: z.enum(['conference', 'journal']),
});

export const downloadLogOutput = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'downloadLogOutput');

    // Validate query params thay vì body
    const validation = downloadRequestSchema.safeParse(req.query);
    if (!validation.success) {
        logger.warn({ errors: validation.error.format(), query: req.query }, "Invalid request query for downloading output.");
        res.status(400).json({ message: "Invalid input", errors: validation.error.format() });
        return;
    }

    const { requestId, crawlerType } = validation.data;
    logger.info({ requestId, crawlerType }, "Request received to download log output file.");

    try {
        const downloadService = container.resolve(LogDownloadService);
        const result = await downloadService.getOutputFile(requestId, crawlerType as CrawlerType);

        if (result.success && result.content && result.fileName) {
            // Thiết lập header để trình duyệt hiểu đây là một file download
            res.setHeader('Content-Disposition', `attachment; filename=${result.fileName}`);
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Length', result.content.length);

            // Gửi nội dung file
            res.status(200).send(result.content);
        } else {
            // Gửi lỗi với status code tương ứng từ service
            res.status(result.statusCode || 500).json({ message: result.error });
        }

    } catch (error: unknown) {
        const { message, stack } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack }, "Unhandled error in downloadLogOutput.");
        next(error);
    }
};




/**
 * Controller để lấy kết quả phân tích log chatbot mới nhất.
 */
export const getLatestChatbotAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'getLatestChatbotAnalysis');
    const chatbotAnalysisService = container.resolve(ChatbotLogAnalysisService);
    try {
        const results = await chatbotAnalysisService.performAnalysis();
        res.status(200).json(results);

    } catch (error: unknown) {
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack: (error as Error).stack }, "Unhandled error in getLatestChatbotAnalysis.");
        next(error);
    }
};