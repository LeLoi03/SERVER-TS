// src/api/v1/logAnalysis/controller.ts
import { Request, Response, NextFunction } from 'express';
import logToFile from '../../../utils/logger';
import { LogAnalysisService } from '../../../services/logAnalysis.service';

// <<< Bỏ dòng tạo instance mới ở đây

// <<< Nhận service làm tham số cuối
export const getLatestAnalysis = async (req: Request, res: Response, next: NextFunction, logAnalysisService: LogAnalysisService): Promise<void> => {
    logToFile('[LogAnalysis Controller] Request received for latest analysis results.');
    try {
        // <<< Sử dụng service được truyền vào
        const results = logAnalysisService.getLatestAnalysisResult();
        if (results) {
            logToFile('[LogAnalysis Controller] Returning latest cached analysis results.');
            res.status(200).json(results);
        } else {
            logToFile('[LogAnalysis Controller] No analysis results available yet.');
            // Có thể cân nhắc trả về 200 với message thay vì 404 nếu việc chưa có kết quả không phải lỗi
            res.status(404).json({ message: 'Log analysis results not available yet. Please try again later or trigger analysis.' });
        }
    } catch (error) {
        logToFile('[LogAnalysis Controller] Error retrieving latest analysis results.');
        next(error); // Chuyển lỗi cho error handler
    }
};

// <<< Nhận service làm tham số cuối
export const triggerAnalysis = async (req: Request, res: Response, next: NextFunction, logAnalysisService: LogAnalysisService): Promise<void> => {
    logToFile('[LogAnalysis Controller] Received POST /trigger');
    try {
        // <<< Sử dụng service được truyền vào
        const results = await logAnalysisService.performAnalysisAndUpdate();
        // Cân nhắc việc emit qua socket IO từ service hoặc tại đây nếu cần
        res.status(200).json({ message: 'Log analysis triggered successfully.', results });
    } catch (error) {
        logToFile(`[LogAnalysis Controller] Error POST /trigger: ${error instanceof Error ? error.message : String(error)}`);
        next(error); // Chuyển lỗi cho error handler
    }
};