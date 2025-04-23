import { Request, Response, NextFunction } from 'express';
import logToFile from '../../../utils/logger';
import { LogAnalysisService } from '../../../services/logAnalysis.service';

// Giả định LogAnalysisService được inject hoặc tạo instance ở đâu đó
// Trong ví dụ này, chúng ta sẽ tạo một instance mới, nhưng tốt hơn là inject từ loader
const logAnalysisService = new LogAnalysisService(); // << Nên được inject

export const getLatestAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    logToFile('[LogAnalysis Controller] Request received for latest analysis results.');
    try {
        const results = logAnalysisService.getLatestAnalysisResult(); // Lấy từ service
        if (results) {
            logToFile('[LogAnalysis Controller] Returning latest cached analysis results.');
            res.status(200).json(results);
        } else {
            logToFile('[LogAnalysis Controller] No analysis results available yet.');
            res.status(404).json({ message: 'Log analysis results not available yet. Please try again later.' });
        }
    } catch (error) {
        logToFile('[LogAnalysis Controller] Error retrieving latest analysis results.');
        next(error);
    }
};

export const triggerAnalysis = async (req: Request, res: Response, next: NextFunction): Promise<void> => {

    logToFile('[LogAnalysis Controller] Received POST /trigger'); // Ví dụ path
    try {
        // Gọi service để thực hiện phân tích (có thể bất đồng bộ)
        // Service này cũng nên emit kết quả qua Socket.IO nếu cần
        const results = await logAnalysisService.performAnalysisAndUpdate();

        res.status(200).json({ message: 'Log analysis triggered successfully.', results });
    } catch (error) {

        logToFile(`[LogAnalysis Controller] Error POST /trigger: ${error instanceof Error ? error.message : String(error)}`);
        next(error);
    }
};