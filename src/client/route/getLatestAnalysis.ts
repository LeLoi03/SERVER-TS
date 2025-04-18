import { RequestHandler } from 'express';
import { LogAnalysisResult } from '../types/logAnalysis';
import { performLogAnalysis } from '../service/logAnalysisService'; 




// --- Lưu trữ kết quả phân tích mới nhất ---
let latestOverallAnalysisResult: LogAnalysisResult | null = null;


export const getConferenceById: RequestHandler<any, any> = async (
    req,
    res
): Promise<void> => {
    try {
        // Đọc và parse tham số query (dạng string) thành number (milliseconds)
        const filterStartTimeStr = req.query.filterStartTime as string | undefined;
        const filterEndTimeStr = req.query.filterEndTime as string | undefined;

        let filterStartTime: number | undefined = undefined;
        let filterEndTime: number | undefined = undefined;

        if (filterStartTimeStr && !isNaN(parseInt(filterStartTimeStr, 10))) {
            filterStartTime = parseInt(filterStartTimeStr, 10);
        }

        if (filterEndTimeStr && !isNaN(parseInt(filterEndTimeStr, 10))) {
            filterEndTime = parseInt(filterEndTimeStr, 10);
        }

        console.log(`Backend received request with filterStartTime: ${filterStartTime}, filterEndTime: ${filterEndTime}`);

        // Gọi hàm phân tích với các tham số thời gian (hoặc undefined nếu không có)
        const results = await performLogAnalysis(filterStartTime, filterEndTime);

        // Cập nhật kết quả mới nhất *tổng thể* nếu không có bộ lọc (dành cho socket?)
        // Hoặc bạn có thể quyết định không cần biến này nữa nếu socket cũng gửi dữ liệu lọc.
        // Tạm thời vẫn cập nhật nếu không lọc:
        if (filterStartTime === undefined && filterEndTime === undefined) {
            latestOverallAnalysisResult = results;
        }

        // Trả về kết quả (đã lọc hoặc không)
        res.status(200).json(results);

    } catch (error: any) {
        console.error("Error performing log analysis:", error);
        // Có thể trả về lỗi cụ thể hơn
        // Kiểm tra xem lỗi có phải do chưa có dữ liệu không
        if (error.message === 'No log data found for the specified period') {
            res.status(404).json({ message: error.message || 'Log analysis data not available for the selected period.' });
        } else {
            res.status(500).json({ message: 'Failed to perform log analysis.', error: error.message });
        }
    }
};