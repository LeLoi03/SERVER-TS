// src/api/v1/index.ts
import { Router } from 'express';
import { container } from 'tsyringe'; // <<< Import container (nếu cần resolve ở đây, thường thì không)
import crawlRouter from './crawl/crawl.routes'; // crawl router không cần service (trừ khi thay đổi)
import logAnalysisRouter from './logAnalysis/logAnalysis.routes'; // <<< Import hàm tạo log analysis router
// import { LogAnalysisService } from '../../services/logAnalysis.service'; // <<< Xóa import service

// <<< Hàm tạo router không nhận service nữa
const createV1Router = (): Router => {
    const router = Router();

    // crawl router không cần service (giữ nguyên)
    router.use('/', crawlRouter);

    // <<< logAnalysisRouter sẽ tự resolve service bên trong nó hoặc các handlers của nó
    router.use('/logs/analysis', logAnalysisRouter()); // <<< Gọi hàm tạo không có tham số

    // Gắn các router khác nếu cần, chúng cũng sẽ tự resolve
    // router.use('/users', userRouter());

    return router;
};

export default createV1Router; // <<< Export hàm tạo đã sửa