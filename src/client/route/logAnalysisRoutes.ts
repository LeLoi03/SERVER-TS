// src/client/route/logAnalysisRoutes.ts

import express, { Request, Response, Router } from 'express';
import { performLogAnalysis } from '../service/logAnalysis.service'; // Điều chỉnh đường dẫn nếu cần
import { logger } from '../../conference/11_utils'; // Hoặc logger bạn muốn dùng cho route này
// Bỏ import logToFile nếu không dùng trong route này nữa
// import logToFile from '../chatbot/utils/logger';
import { LogAnalysisResult } from '../types/logAnalysis'; // Import type

// Định nghĩa một interface cho các dependencies mà router cần
// Điều này giúp dễ dàng inject dependencies và testing
interface LogAnalysisRouterDependencies {
    performLogAnalysisService: typeof performLogAnalysis;
    routeLogger: typeof logger; // Hoặc một logger interface cụ thể hơn
    // Không cần truyền latestOverallAnalysisResult hay setter nữa
    // vì route này chỉ đọc dữ liệu, không cập nhật state global đó
}

// Hàm tạo và trả về một Express Router đã cấu hình
export function createLogAnalysisRouter(dependencies: LogAnalysisRouterDependencies): Router {
    const router = Router();
    const { performLogAnalysisService, routeLogger } = dependencies;

    // Chỉ cần định nghĩa phần cuối của path, vì base path sẽ được set khi mount router
    router.get('/latest', async (req: Request, res: Response) => {
        const requestId = (req as any).id || `req-log-${Date.now()}`; // Tạo request ID nếu chưa có
        const specificLogger = routeLogger.child({ requestId, route: '/api/v1/logs/analysis/latest' });

        try {
            const { filterStartTime: filterStartTimeStr, filterEndTime: filterEndTimeStr } = req.query;

            // Validate and parse query parameters safely
            const filterStartTime = filterStartTimeStr && !isNaN(parseInt(String(filterStartTimeStr), 10))
                ? parseInt(String(filterStartTimeStr), 10)
                : undefined;

            const filterEndTime = filterEndTimeStr && !isNaN(parseInt(String(filterEndTimeStr), 10))
                ? parseInt(String(filterEndTimeStr), 10)
                : undefined;

            specificLogger.info({ query: req.query }, `Received request with filters - Start: ${filterStartTime}, End: ${filterEndTime}`);

            // Gọi service để thực hiện phân tích với các bộ lọc (hoặc không)
            const results: LogAnalysisResult = await performLogAnalysisService(filterStartTime, filterEndTime);

            // *** QUAN TRỌNG: Route này không còn cập nhật biến global latestOverallAnalysisResult nữa ***
            // Biến global đó chỉ nên được cập nhật bởi cron job hoặc khi khởi động.
            // Route này chỉ chịu trách nhiệm lấy dữ liệu (có thể đã lọc) và trả về.

            specificLogger.info("Log analysis performed successfully via API request.");
            res.status(200).json(results);

        } catch (error: any) {
            specificLogger.error({ err: error, stack: error.stack }, "Error performing log analysis via API route");
            // Kiểm tra loại lỗi cụ thể hơn nếu cần
            if (error.message?.includes('No log data found')) {
                res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period.' });
            } else {
                res.status(500).json({ message: 'Failed to perform log analysis.', error: error.message });
            }
        }
    });

    // Thêm các route khác liên quan đến log analysis vào đây nếu cần
    // router.get('/summary', ...);
    // router.post('/config', ...);

    return router;
}