// // src/api/v1/logAnalysis/logAnalysis.routes.ts
// import { Router } from 'express';
// import { getLatestAnalysis, triggerAnalysis } from './logAnalysis.controller';
// import { LogAnalysisService } from '../../../services/logAnalysis.service'; // <<< Import service

// // <<< Hàm tạo router nhận service
// const createLogAnalysisRouter = (logAnalysisService: LogAnalysisService): Router => {
//     const router = Router();

//     // Truyền service vào controller thông qua closure hoặc middleware
//     // Cách 1: Closure (đơn giản cho trường hợp này)
//     router.get('/latest', (req, res, next) => getLatestAnalysis(req, res, next, logAnalysisService));
//     router.post('/trigger', (req, res, next) => triggerAnalysis(req, res, next, logAnalysisService));

//     // Cách 2: Middleware (phù hợp hơn nếu nhiều route cần service)
//     // const injectService = (req, res, next) => {
//     //     req.logAnalysisService = logAnalysisService;
//     //     next();
//     // };
//     // router.get('/latest', injectService, getLatestAnalysisController); // Controller cần sửa để đọc từ req.logAnalysisService
//     // router.post('/trigger', injectService, triggerAnalysisController);

//     return router;
// }

// export default createLogAnalysisRouter; // <<< Export hàm tạo