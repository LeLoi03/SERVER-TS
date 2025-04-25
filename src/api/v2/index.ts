// src/api/v2/index.ts
import { Router } from 'express';
import crawlRouter from './crawl/crawl.routes';

// <<< Hàm tạo router nhận service
const createV1Router = (): Router => {
    const router = Router();

    router.use('/', crawlRouter);

    return router;
};


export default createV1Router; // <<< Export hàm tạo