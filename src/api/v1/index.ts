// src/api/v1/index.ts
import { Router } from 'express';

// Import router creation functions for specific API feature areas (v1).
// These functions will handle their own service dependencies internally.
import createCrawlRouter from './crawl/crawl.routes';
import createLogAnalysisRouter from './logAnalysis/logAnalysis.routes';
import createChatRouter from './chatbot/chat.routes'; // <<< ADD THIS IMPORT
import { deleteLogAnalysisRequests } from './logAnalysis/logAnalysis.controller';
// Đổi tên import cho rõ ràng, hoặc giữ nguyên cũng được
import { handleConferenceSaveEvents, importJournalsFromLog as handleJournalImportFromLog } from './save/save.controller';

/**
 * Creates and configures the main API router for version 1 (v1) of the API.
 * This router aggregates all feature-specific routers under the /api/v1 path.
 *
 * @returns {Router} An Express Router instance combining all v1 API feature routes.
 */
const createV1Router = (): Router => {
    const router = Router();

    // Mount the crawl-related routes under the base v1 path.
    // `createCrawlRouter()` is called here to get the configured router instance.
    router.use('/', createCrawlRouter());

    // Mount the log analysis routes under '/logs/analysis' path.
    // `createLogAnalysisRouter()` is called here to get the configured router instance.
    router.use('/logs/analysis', createLogAnalysisRouter());

    // Route mới để ghi log save event
    // Route để ghi log save event cho conference (giữ nguyên)
    router.post('/logs/conference-save-event', handleConferenceSaveEvents);

    // Route MỚI và ĐÚNG để trigger quá trình import journal từ file log
    router.post('/journals/import-from-log', handleJournalImportFromLog);

    // --- Route for deleting requests ---
    router.use('/logs/requests', deleteLogAnalysisRequests); // Add the new DELETE route


    router.use('/chatbot', createChatRouter()); // <<< ADD THIS LINE (e.g. /api/v1/chatbot/upload-files)


    return router;
};

// Export the router creation function for the v1 API.
export default createV1Router;