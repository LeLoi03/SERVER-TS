// src/api/v1/logAnalysis/logAnalysis.controller.ts
import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { Logger } from 'pino';

// Đổi tên import để rõ ràng hơn
import { ConferenceLogAnalysisService } from '../../../services/conferenceLogAnalysis.service';
import { ConferenceLogAnalysisResult } from '../../../types/logAnalysis';
import { JournalLogAnalysisService } from '../../../services/journalLogAnalysis.service';
import { JournalLogAnalysisResult } from '../../../types/logAnalysisJournal/logAnalysisJournal.types';
import { LoggingService, LoggerType } from '../../../services/logging.service'; // Import LoggerType
import { getErrorMessageAndStack } from '../../../utils/errorUtils';

const getControllerLogger = (req: Request, /* loggerType: LoggerType, */ routeName: string): Logger => {
    const loggingService = container.resolve(LoggingService);
    const pinoRequestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Luôn sử dụng logger 'app' (hoặc một logger chung khác) cho controller này
    // Context cụ thể của controller và route được thêm qua child()
    return loggingService.getLogger('app').child({ // Giả sử 'app' là logger chung
        controller: 'LogAnalysisController',
        route: routeName,
        pinoRequestId: pinoRequestId,
        // Nếu bạn vẫn muốn biết nó liên quan đến conference hay journal analysis:
        analysisType: routeName.includes('Conference') ? 'conference' : 'journal'
    });
};

const handleAnalysisResponse = (
    res: Response,
    results: ConferenceLogAnalysisResult | JournalLogAnalysisResult,
    logger: Logger
) => {
    // Logic chung để xử lý response dựa trên results.status
    // Luôn trả về 200 OK, FE sẽ dựa vào 'status' và 'errorMessage' trong payload để hiển thị
    logger.info({
        finalStatus: results.status,
        analyzedIdsCount: results.analyzedRequestIds?.length,
        requestIdParam: results.filterRequestId,
        errorMessage: results.errorMessage
    }, "Analysis processing complete. Sending response.");
    res.status(200).json(results);
};


export const getLatestConferenceAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'getLatestConferenceAnalysis'); // Không cần truyền loggerType nữa nếu dùng cách trên
    logger.info({ query: req.query }, "Request received for latest conference analysis.");

    const conferenceAnalysisService = container.resolve(ConferenceLogAnalysisService);

    try {
        const {
            filterStartTime: filterStartTimeStr,
            filterEndTime: filterEndTimeStr,
            requestId: filterRequestIdQuery
        } = req.query;

        const filterStartTime = typeof filterStartTimeStr === 'string' && !isNaN(parseInt(filterStartTimeStr, 10))
            ? parseInt(filterStartTimeStr, 10) : undefined;
        const filterEndTime = typeof filterEndTimeStr === 'string' && !isNaN(parseInt(filterEndTimeStr, 10))
            ? parseInt(filterEndTimeStr, 10) : undefined;
        const requestIdParam = typeof filterRequestIdQuery === 'string' ? filterRequestIdQuery : undefined;

        logger.debug({ filterStartTime, filterEndTime, requestIdParam }, "Performing conference analysis.");
        const results: ConferenceLogAnalysisResult = await conferenceAnalysisService.performConferenceAnalysisAndUpdate(
            filterStartTime, filterEndTime, requestIdParam
        );

        handleAnalysisResponse(res, results, logger);

    } catch (error: unknown) { // Lỗi không mong muốn từ service hoặc logic controller
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack: (error as Error).stack }, "Unhandled error in getLatestConferenceAnalysis.");
        // Chuyển cho global error handler
        next(error);
    }
};

export const getLatestJournalAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'getLatestJournalAnalysis'); // Không cần truyền loggerType nữa nếu dùng cách trên
    logger.info({ query: req.query }, "Request received for latest journal analysis.");

    const journalLogAnalysisService = container.resolve(JournalLogAnalysisService);

    try {
        const {
            filterStartTime: filterStartTimeStr,
            filterEndTime: filterEndTimeStr,
            requestId: filterRequestIdQuery
        } = req.query;

        const filterStartTime = typeof filterStartTimeStr === 'string' && !isNaN(parseInt(filterStartTimeStr, 10))
            ? parseInt(filterStartTimeStr, 10) : undefined;
        const filterEndTime = typeof filterEndTimeStr === 'string' && !isNaN(parseInt(filterEndTimeStr, 10))
            ? parseInt(filterEndTimeStr, 10) : undefined;
        const requestIdParam = typeof filterRequestIdQuery === 'string' ? filterRequestIdQuery : undefined;

        logger.debug({ filterStartTime, filterEndTime, requestIdParam }, "Performing journal analysis.");
        const results: JournalLogAnalysisResult = await journalLogAnalysisService.performJournalAnalysisAndUpdate(
            filterStartTime, filterEndTime, requestIdParam
        );

        handleAnalysisResponse(res, results, logger);

    } catch (error: unknown) { // Lỗi không mong muốn từ service hoặc logic controller
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, errorMessage: message, stack: (error as Error).stack }, `Unhandled error in getLatestJournalAnalysis.`);
        // Chuyển cho global error handler
        next(error);
    }
};