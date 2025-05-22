// src/api/v1/logAnalysis/logAnalysis.controller.ts
import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';

// Import services and types
import { LogAnalysisService } from '../../../services/logAnalysis.service';
import { LogAnalysisResult } from '../../../types/logAnalysis.types';

// Import the new error utility
import { getErrorMessageAndStack } from '../../../utils/errorUtils';

/**
 * Handles GET requests to retrieve the latest log analysis results.
 * This endpoint triggers a new log analysis operation on demand, allowing
 * clients to specify time filters (start/end) and a specific request ID for analysis.
 *
 * @param {Request} req - The Express request object, potentially containing `filterStartTime`,
 *                        `filterEndTime` (as Unix timestamps in ms), and `requestId` in query parameters.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function for error handling.
 * @returns {Promise<void>} A promise that resolves when the response is sent or error is passed to next.
 */
export const getLatestAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logAnalysisService = container.resolve(LogAnalysisService);

    try {
        const {
            filterStartTime: filterStartTimeStr,
            filterEndTime: filterEndTimeStr,
            requestId: filterRequestId
        } = req.query;

        const filterStartTime = typeof filterStartTimeStr === 'string' && !isNaN(parseInt(filterStartTimeStr, 10))
            ? parseInt(filterStartTimeStr, 10)
            : undefined;

        const filterEndTime = typeof filterEndTimeStr === 'string' && !isNaN(parseInt(filterEndTimeStr, 10))
            ? parseInt(filterEndTimeStr, 10)
            : undefined;

        const requestIdParam = typeof filterRequestId === 'string' ? filterRequestId : undefined;

        const results: LogAnalysisResult = await logAnalysisService.performAnalysisAndUpdate(
            filterStartTime,
            filterEndTime,
            requestIdParam
        );

        res.status(200).json(results);

    } catch (error: unknown) { // Use unknown here
        const { message: errorMessage } = getErrorMessageAndStack(error); // Only need message here

        if (errorMessage?.includes('Log file not found')) {
            res.status(404).json({ message: errorMessage || 'Log file not found, cannot perform analysis.' });
        } else if (errorMessage?.includes('No log data found')) {
            res.status(404).json({ message: errorMessage || 'No log data found for the selected period or requestId.' });
        } else {
            next(error); // Pass the original error object to next for global error handler
        }
    }
};

/**
 * Handles POST requests to manually trigger a log analysis.
 * This endpoint initiates a background log analysis task without waiting for its completion.
 * Results will be updated asynchronously.
 *
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {NextFunction} next - The Express next middleware function for error handling.
 * @returns {Promise<void>} A promise that resolves when the response is sent or error is passed to next.
 */
export const triggerAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logAnalysisService = container.resolve(LogAnalysisService);

    try {
        logAnalysisService.performAnalysisAndUpdate().catch((backgroundError: unknown) => { // Use unknown here
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(backgroundError);
            console.error('[Background Task Error] Log analysis background process failed:', { message: errorMessage, stack: errorStack });
        });

        res.status(202).json({ message: 'Log analysis task triggered successfully. Results will be updated asynchronously.' });

    } catch (error: unknown) { // Use unknown here
        next(error); // Pass the original error object to next for global error handler
    }
};