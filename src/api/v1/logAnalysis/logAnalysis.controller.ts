// src/api/v1/logAnalysis/logAnalysis.controller.ts
import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { Logger } from 'pino';

// Đổi tên import để rõ ràng hơn
import { ConferenceLogAnalysisService } from '../../../services/conferenceLogAnalysis.service';
import { ConferenceLogAnalysisResult } from '../../../types/logAnalysis';
import { JournalLogAnalysisService } from '../../../services/journalLogAnalysis.service';
import { JournalLogAnalysisResult } from '../../../types/logAnalysisJournal/logAnalysisJournal.types';
// initializeJournalLogAnalysisResult có thể không cần import trực tiếp ở controller
// import { initializeJournalLogAnalysisResult } from '../../../utils/logAnalysisJournal/helpers';
import { LogAnalysisCacheService } from '../../../services/logAnalysisCache.service';
import { LoggingService, LoggerType } from '../../../services/logging.service'; // Import LoggerType
// ConfigService không cần thiết nếu controller không tự tạo emptyResult
// import { ConfigService } from '../../../config/config.service';
import { getErrorMessageAndStack } from '../../../utils/errorUtils';

const getControllerLogger = (req: Request, loggerType: LoggerType, routeName: string): Logger => {
    const loggingService = container.resolve(LoggingService);
    // Lấy pinoRequestId từ middleware (nếu có, ví dụ từ pino-http)
    // Hoặc tạo một ID duy nhất cho request nếu không có
    const pinoRequestId = (req as any).id || `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    return loggingService.getLogger(loggerType).child({
        controller: 'LogAnalysisController',
        route: routeName,
        pinoRequestId: pinoRequestId, // Sử dụng ID này để trace log
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
    const logger = getControllerLogger(req, 'conference', 'getLatestConferenceAnalysis');
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

export const triggerConferenceCacheRegeneration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'conference', 'triggerConferenceCacheRegeneration');
    const { requestId } = req.query;

    if (!requestId || typeof requestId !== 'string') {
        logger.warn({ query: req.query }, "Bad request: 'requestId' query parameter is required.");
        res.status(400).json({ message: "'requestId' query parameter is required." });
        return;
    }
    logger.info({ requestId }, "Request received to trigger conference cache regeneration.");

    const logAnalysisCacheService = container.resolve(LogAnalysisCacheService);
    try {
        // Chạy bất đồng bộ, không await
        logAnalysisCacheService.generateAndCacheAnalysis('conference', requestId)
            .then(() => {
                logger.info({ requestId }, `Background cache regeneration for conference request ${requestId} initiated successfully.`);
            })
            .catch((backgroundError: unknown) => {
                const { message: errorMessage } = getErrorMessageAndStack(backgroundError);
                logger.error({ err: backgroundError, requestId, errorMessage: errorMessage }, `Background cache regeneration failed for conference request ${requestId}.`);
            });

        res.status(202).json({ message: `Analysis cache regeneration triggered for conference request ${requestId}. Results will be updated asynchronously.` });
    } catch (error: unknown) { // Lỗi đồng bộ khi gọi generateAndCacheAnalysis (rất hiếm)
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, requestId, errorMessage: message }, "Error triggering conference cache regeneration.");
        next(error);
    }
};

export const getLatestJournalAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'journal', 'getLatestJournalAnalysis');
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

export const triggerJournalCacheRegeneration = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logger = getControllerLogger(req, 'journal', 'triggerJournalCacheRegeneration');
    const { requestId } = req.query;

    if (!requestId || typeof requestId !== 'string') {
        logger.warn({ query: req.query }, "Bad request: 'requestId' query parameter is required.");
        res.status(400).json({ message: "'requestId' query parameter is required." });
        return;
    }
    logger.info({ requestId }, "Request received to trigger journal cache regeneration.");

    const logAnalysisCacheService = container.resolve(LogAnalysisCacheService);
    try {
        // Chạy bất đồng bộ, không await
        logAnalysisCacheService.generateAndCacheAnalysis('journal', requestId)
            .then(() => {
                logger.info({ requestId }, `Background cache regeneration for journal request ${requestId} initiated successfully.`);
            })
            .catch((backgroundError: unknown) => {
                const { message: errorMessage } = getErrorMessageAndStack(backgroundError);
                logger.error({ err: backgroundError, requestId, errorMessage: errorMessage }, `Background cache regeneration failed for journal request ${requestId}.`);
            });
        res.status(202).json({ message: `Analysis cache regeneration triggered for journal request ${requestId}.` });
    } catch (error: unknown) { // Lỗi đồng bộ khi gọi generateAndCacheAnalysis (rất hiếm)
        const { message } = getErrorMessageAndStack(error);
        logger.error({ err: error, requestId, errorMessage: message }, "Error triggering journal cache regeneration.");
        next(error);
    }
};