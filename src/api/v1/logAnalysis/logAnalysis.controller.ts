// src/api/v1/logAnalysis/logAnalysis.controller.ts
import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';

// Import services and types
import { LogAnalysisService } from '../../../services/logAnalysisConference.service';
import { ConferenceLogAnalysisResult } from '../../../types/logAnalysis';
import { LogAnalysisJournalService } from '../../../services/logAnalysisJournal.service';
import { JournalLogAnalysisResult } from '../../../types/logAnalysisJournal/logAnalysisJournal.types';

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
export const getLatestConferenceAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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

        const results: ConferenceLogAnalysisResult = await logAnalysisService.performConferenceAnalysisAndUpdate(
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
export const triggerConferenceAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const logAnalysisService = container.resolve(LogAnalysisService);

    try {
        logAnalysisService.performConferenceAnalysisAndUpdate().catch((backgroundError: unknown) => { // Use unknown here
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(backgroundError);
            console.error('[Background Task Error] Log analysis background process failed:', { message: errorMessage, stack: errorStack });
        });

        res.status(202).json({ message: 'Log analysis task triggered successfully. Results will be updated asynchronously.' });

    } catch (error: unknown) { // Use unknown here
        next(error); // Pass the original error object to next for global error handler
    }
};



// --- Journal Analysis Handlers ---
export const getLatestJournalAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const journalLogAnalysisService = container.resolve(LogAnalysisJournalService); // <<< SỬ DỤNG SERVICE MỚI
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

        const results: JournalLogAnalysisResult = await journalLogAnalysisService.performJournalAnalysisAndUpdate(
            filterStartTime,
            filterEndTime,
            requestIdParam
        );

        // Xử lý response tương tự như conference, nhưng với thông báo của journal
        if (results.status === 'Failed' && results.errorMessage?.includes('Log file not found')) {
            res.status(404).json({ message: results.errorMessage });
        } else if (results.errorMessage && results.analyzedRequestIds?.length === 0 && results.status !== 'Failed') {
            res.status(200).json(results); // Trả về results với errorMessage (vd: No data found)
        } else if (results.status === 'Failed') {
            res.status(500).json({ message: results.errorMessage || "Journal analysis failed." });
        }
         else {
            res.status(200).json(results);
        }

    } catch (error: unknown) {
        const { message: errorMessage } = getErrorMessageAndStack(error);
        if (res.headersSent) return;

        if (errorMessage?.includes('Log file not found')) {
             res.status(404).json({ message: errorMessage });
        } else if (errorMessage?.includes('No log data found')) { // Mặc dù service trả về completed, controller có thể quyết định 404
             res.status(404).json({ message: errorMessage });
        } else if (errorMessage?.includes('Analysis is already in progress')) {
            res.status(429).json({ message: errorMessage });
        }
        else {
            next(error);
        }
    }
};

export const triggerJournalAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const journalLogAnalysisService = container.resolve(LogAnalysisJournalService); // <<< SỬ DỤNG SERVICE MỚI
    try {
        journalLogAnalysisService.performJournalAnalysisAndUpdate().catch((backgroundError: unknown) => {
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(backgroundError);
            console.error('[Background Task Error] Journal log analysis failed:', { message: errorMessage, stack: errorStack });
        });
        res.status(202).json({ message: 'Journal log analysis triggered.' });
    } catch (error: unknown) {
        next(error);
    }
};