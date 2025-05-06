// src/api/v1/logAnalysis/logAnalysis.routes.ts
import { Router } from 'express';
import { container } from 'tsyringe';
import { LoggingService } from '../../../services/logging.service';
import { getLatestAnalysis, triggerAnalysis } from '../logAnalysis/logAnalysis.controller';

const createLogAnalysisRouter = (): Router => {
    const router = Router();


    const loggingService = container.resolve(LoggingService);
    const logger = loggingService.getLogger({ context: 'LogAnalysisRoutes' });

    logger.info('Configuring log analysis API routes...');

    // <<< Các route trỏ trực tiếp đến hàm controller
    // Các hàm controller (getLatestAnalysis, triggerAnalysis) sẽ tự resolve service bên trong chúng.
    router.get('/latest', getLatestAnalysis);
    router.post('/trigger', triggerAnalysis);

    logger.info('Log analysis API routes configured: GET /latest, POST /trigger');

    return router;
}

export default createLogAnalysisRouter; // <<< Export hàm tạo đã sửa