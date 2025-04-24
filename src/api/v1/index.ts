// src/api/v1/index.ts
import { Router } from 'express';
import crawlRouter from './crawl/crawl.routes';
import logAnalysisRouter from './logAnalysis/logAnalysis.routes';
import { LogAnalysisService } from '../../services/logAnalysis.service'; // <<< Import service

// <<< Hàm tạo router nhận service
const createV1Router = (logAnalysisService: LogAnalysisService): Router => {
    const router = Router();

    router.use('/crawl', crawlRouter); // crawl router không cần service này (trừ khi logic thay đổi)

    // <<< Truyền service vào log analysis router
    router.use('/logs/analysis', logAnalysisRouter(logAnalysisService));

    // Gắn các router khác nếu cần và truyền service nếu chúng cần
    // router.use('/users', userRouter(someOtherService));

    return router;
};


export default createV1Router; // <<< Export hàm tạo