// src/api/v1/index.ts
import { Router } from 'express';

// Import router creation functions for specific API feature areas (v1).
// These functions will handle their own service dependencies internally.
import createCrawlRouter from './crawl/crawl.routes';
import createLogAnalysisRouter from './logAnalysis/logAnalysis.routes';
import createChatRouter from './chatbot/chat.routes'; // <<< ADD THIS IMPORT

import { handleBatchConferenceSaveEvents } from './save/save.controller';
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
    router.use('/log/conference-save-event', handleBatchConferenceSaveEvents);

    router.use('/chatbot', createChatRouter()); // <<< ADD THIS LINE (e.g. /api/v1/chatbot/upload-files)


    return router;
};

// Export the router creation function for the v1 API.
export default createV1Router;