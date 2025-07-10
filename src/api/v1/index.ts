
import { Router } from 'express';
import createCrawlRouter from './crawl/crawl.routes';
import createLogAnalysisRouter from './logAnalysis/logAnalysis.routes';
import createChatRouter from './chatbot/chat.routes'
import { deleteLogAnalysisRequests, downloadLogOutput } from './logAnalysis/logAnalysis.controller'
import { handleConferenceSaveEvents, importJournalsFromLog as handleJournalImportFromLog } from './save/save.controller';

/**
 * Creates and configures the main API router for version 1 (v1) of the API.
 * This router aggregates all feature-specific routers under the /api/v1 path.
 *
 * @returns {Router} An Express Router instance combining all v1 API feature routes.
 */
const createV1Router = (): Router => {
    const router = Router();
    router.use('/', createCrawlRouter());
    router.use('/logs/analysis', createLogAnalysisRouter());
    router.post('/logs/conference-save-event', handleConferenceSaveEvents);
    router.post('/journals/import-from-log', handleJournalImportFromLog);
    router.use('/logs/requests', deleteLogAnalysisRequests)
    router.use('/logs/download', downloadLogOutput)
    router.use('/chatbot', createChatRouter())
    return router;
};
export default createV1Router;