// src/api/index.ts
import { Router } from 'express';
import v1Router from './v1';
import { LogAnalysisService } from '../services/logAnalysis.service'; // <<< Import service

// <<< Hàm tạo router nhận service
const createApiRouter = (logAnalysisService: LogAnalysisService): Router => {
    const router = Router();

    // <<< Truyền service vào v1 router
    router.use('/v1', v1Router(logAnalysisService));

    // router.use('/v2', v2Router(logAnalysisService)); // Nếu có v2

    return router;
}

export default createApiRouter; // <<< Export hàm tạo