// // src/api/v1/logAnalysis/controller.ts
// import { Request, Response, NextFunction } from 'express';
// import logToFile from '../../../utils/logger';
// import { logger } from '../../../conference/11_utils'; // Import pino logger nếu muốn dùng
// import { LogAnalysisService } from '../../../services/logAnalysis.service';
// import { LogAnalysisResult } from '../../../client/types/logAnalysis'; // Import type nếu cần

// export const getLatestAnalysis = async (req: Request, res: Response, next: NextFunction, logAnalysisService: LogAnalysisService): Promise<void> => {


//     logToFile('[LogAnalysis Controller] Request received for latest analysis results (will re-analyze).'); // Giữ logToFile nếu cần

//     try {
//         // <<< Lấy filter từ query params, giống code gốc >>>
//         const { filterStartTime: filterStartTimeStr, filterEndTime: filterEndTimeStr } = req.query;

//         const filterStartTime = filterStartTimeStr && !isNaN(parseInt(String(filterStartTimeStr), 10))
//             ? parseInt(String(filterStartTimeStr), 10)
//             : undefined;

//         const filterEndTime = filterEndTimeStr && !isNaN(parseInt(String(filterEndTimeStr), 10))
//             ? parseInt(String(filterEndTimeStr), 10)
//             : undefined;



//         // <<< Gọi hàm thực hiện phân tích thay vì lấy cache >>>
//         // Hàm này sẽ đọc lại log, phân tích và cập nhật this.latestResult trong service
//         const results: LogAnalysisResult = await logAnalysisService.performAnalysisAndUpdate(filterStartTime, filterEndTime);


//         logToFile('[LogAnalysis Controller] Log analysis performed successfully via API request.');

//         res.status(200).json(results);

//     } catch (error: any) {

//         logToFile(`[LogAnalysis Controller] Error performing log analysis: ${error.message}`);
//         // Có thể thêm xử lý lỗi cụ thể hơn nếu cần, ví dụ file not found
//         if (error.message?.includes('Log file not found')) {
//             res.status(404).json({ message: error.message || 'Log file not found, cannot perform analysis.' });
//         } else if (error.message?.includes('No log data found')) { // Giữ lại lỗi này từ code gốc nếu có thể xảy ra
//             res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period.' });
//         }
//         else {
//             next(error); // Chuyển lỗi cho error handler chung
//         }
//     }
// };

// // Hàm triggerAnalysis giữ nguyên hoặc điều chỉnh nếu cần
// export const triggerAnalysis = async (req: Request, res: Response, next: NextFunction, logAnalysisService: LogAnalysisService): Promise<void> => {
//     logToFile('[LogAnalysis Controller] Received POST /trigger');

//     try {
//         const results = await logAnalysisService.performAnalysisAndUpdate(); // Trigger cũng chạy lại phân tích

//         logToFile('[LogAnalysis Controller] Log analysis triggered successfully via POST request.');
//         res.status(200).json({ message: 'Log analysis triggered successfully.', results });
//     } catch (error) {

//         logToFile(`[LogAnalysis Controller] Error POST /trigger: ${error instanceof Error ? error.message : String(error)}`);
//         next(error);
//     }
// };