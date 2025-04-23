import { Router } from 'express';
import crawlRouter from './crawl/crawl.routes';
import logAnalysisRouter from './logAnalysis/logAnalysis.routes';
// Import các router khác của v1 nếu có

const router = Router();

router.use('/crawl', crawlRouter);
router.use('/logs/analysis', logAnalysisRouter); // Giữ nguyên base path này

// Gắn các router khác
// router.use('/users', userRouter);
// router.use('/auth', authRouter);

export default router;