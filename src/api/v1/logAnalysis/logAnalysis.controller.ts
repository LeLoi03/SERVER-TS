// src/api/v1/logAnalysis/logAnalysis.controller.ts
import { Request, Response, NextFunction } from 'express';
import { container } from 'tsyringe';
import { LogAnalysisService } from '../../../services/logAnalysis.service';
import { LoggingService } from '../../../services/logging.service';
import { LogAnalysisResult } from '../../../client/types/logAnalysis.types';

export const getLatestAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // <<< Resolve dependencies >>>
    const loggingService = container.resolve(LoggingService);
    const logAnalysisService = container.resolve(LogAnalysisService);
    const logger = loggingService.getLogger({ controller: 'LogAnalysis', handler: 'getLatestAnalysis', requestId: (req as any).id }); // <<< Sử dụng logger

    logger.info('Request received for latest analysis results (will re-analyze).');

    try {
        // <<< Lấy filter từ query params (giữ nguyên logic) >>>
        const { filterStartTime: filterStartTimeStr, filterEndTime: filterEndTimeStr } = req.query;
        const filterStartTime = filterStartTimeStr && !isNaN(parseInt(String(filterStartTimeStr), 10))
            ? parseInt(String(filterStartTimeStr), 10)
            : undefined;
        const filterEndTime = filterEndTimeStr && !isNaN(parseInt(String(filterEndTimeStr), 10))
            ? parseInt(String(filterEndTimeStr), 10)
            : undefined;

        logger.info({ filterStartTime, filterEndTime }, 'Performing analysis with filters.'); // <<< Log thêm filter

        // <<< Gọi hàm thực hiện phân tích từ service đã resolve >>>
        const results: LogAnalysisResult = await logAnalysisService.performAnalysisAndUpdate(filterStartTime, filterEndTime);

        logger.info('Log analysis performed successfully via API request.');

        res.status(200).json(results);

    } catch (error: any) {
        logger.error({ err: error }, 'Error performing log analysis.');
        // Xử lý lỗi cụ thể (giữ nguyên logic nhưng dùng logger)
        if (error.message?.includes('Log file not found')) {
            logger.warn('Log file not found, cannot perform analysis.');
            res.status(404).json({ message: error.message || 'Log file not found, cannot perform analysis.' });
        } else if (error.message?.includes('No log data found')) {
            logger.warn('No log data found for the selected period.');
            res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period.' });
        } else {
            next(error); // Chuyển lỗi cho error handler chung
        }
    }
};

// <<< Hàm KHÔNG nhận service làm tham số >>>
export const triggerAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // <<< Resolve dependencies >>>
    const loggingService = container.resolve(LoggingService);
    const logAnalysisService = container.resolve(LogAnalysisService);
    const logger = loggingService.getLogger({ controller: 'LogAnalysis', handler: 'triggerAnalysis', requestId: (req as any).id }); // <<< Sử dụng logger

    logger.info('Received POST request to trigger analysis.');

    try {
        // <<< Gọi hàm thực hiện phân tích từ service đã resolve >>>
        // Chạy nền và không await, nhưng vẫn cần bắt lỗi đồng bộ khi gọi
        logAnalysisService.performAnalysisAndUpdate().catch(backgroundError => {
            logger.error({ err: backgroundError }, 'Background log analysis process failed after being triggered via POST.');
            // Không thể gửi response ở đây vì request gốc đã xong
        });

        logger.info('Log analysis triggered successfully via POST request (running in background).');

        // Trả về 202 Accepted vì tác vụ chạy nền
        res.status(202).json({ message: 'Log analysis task triggered successfully. Results will be updated asynchronously.' });

    } catch (error) {
        logger.error({ err: error }, 'Error triggering log analysis via POST.');
        next(error);
    }
};