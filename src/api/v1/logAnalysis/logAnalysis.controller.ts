// src/api/v1/logAnalysis/logAnalysis.controller.ts
import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { LogAnalysisService } from '../../../services/logAnalysis.service';
// import { LoggingService } from '../../../services/logging.service';
import { LogAnalysisResult } from '../../../types/logAnalysis.types';

export const getLatestAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logAnalysisService = container.resolve(LogAnalysisService);
    // const loggingService = container.resolve(LoggingService);
    // const logger = loggingService.getLogger({ controller: 'LogAnalysis', handler: 'getLatestAnalysis', requestId: (req as any).id });

    // logger.info('Request received for latest analysis results (will re-analyze).');

    try {
        const {
            filterStartTime: filterStartTimeStr,
            filterEndTime: filterEndTimeStr,
            requestId: filterRequestId // <<< NEW: Get requestId from query
        } = req.query;

        const filterStartTime = filterStartTimeStr && !isNaN(parseInt(String(filterStartTimeStr), 10))
            ? parseInt(String(filterStartTimeStr), 10)
            : undefined;
        const filterEndTime = filterEndTimeStr && !isNaN(parseInt(String(filterEndTimeStr), 10))
            ? parseInt(String(filterEndTimeStr), 10)
            : undefined;

        // logger.info({ filterStartTime, filterEndTime, filterRequestId }, 'Performing analysis with filters.');

        const results: LogAnalysisResult = await logAnalysisService.performAnalysisAndUpdate(
            filterStartTime,
            filterEndTime,
            filterRequestId as string | undefined // <<< NEW: Pass requestId to service
        );

        // logger.info('Log analysis performed successfully via API request.');
        res.status(200).json(results);

    } catch (error: any) {
        // logger.error({ err: error }, 'Error performing log analysis.');
        if (error.message?.includes('Log file not found')) {
            // logger.warn('Log file not found, cannot perform analysis.');
            res.status(404).json({ message: error.message || 'Log file not found, cannot perform analysis.' });
        } else if (error.message?.includes('No log data found')) { // This might need adjustment based on new filtering
            // logger.warn('No log data found for the selected period or requestId.');
            res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period or requestId.' });
        } else {
            next(error);
        }
    }
};

// triggerAnalysis typically won't take a requestId filter for a full background run.
export const triggerAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logAnalysisService = container.resolve(LogAnalysisService);
    // const loggingService = container.resolve(LoggingService);
    // const logger = loggingService.getLogger({ controller: 'LogAnalysis', handler: 'triggerAnalysis', requestId: (req as any).id });

    // logger.info('Received POST request to trigger analysis.');
    try {
        logAnalysisService.performAnalysisAndUpdate().catch(backgroundError => {
            // logger.error({ err: backgroundError }, 'Background log analysis process failed after being triggered via POST.');
        });
        // logger.info('Log analysis triggered successfully via POST request (running in background).');
        res.status(202).json({ message: 'Log analysis task triggered successfully. Results will be updated asynchronously.' });
    } catch (error) {
        // logger.error({ err: error }, 'Error triggering log analysis via POST.');
        next(error);
    }
};
