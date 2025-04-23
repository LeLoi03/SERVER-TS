import { Router } from 'express';
import { getLatestAnalysis, triggerAnalysis } from './logAnalysis.controller';
// Có thể thêm middleware validation hoặc auth tại đây nếu cần

const router = Router();

// GET /api/v1/logs/analysis - Lấy kết quả phân tích mới nhất (cached)
router.get('/', getLatestAnalysis);

// POST /api/v1/logs/analysis/trigger - Kích hoạt chạy phân tích mới (ví dụ)
router.post('/trigger', triggerAnalysis);

// Các route khác liên quan đến log analysis (ví dụ: lấy theo khoảng thời gian,...)

export default router;