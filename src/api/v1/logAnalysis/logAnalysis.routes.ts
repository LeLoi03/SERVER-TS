// src/api/v1/logAnalysis/logAnalysis.routes.ts
import { Router } from 'express';
import {
    getLatestConferenceAnalysis,
    triggerConferenceCacheRegeneration,
    getLatestJournalAnalysis,
    triggerJournalCacheRegeneration
} from './logAnalysis.controller';

const createLogAnalysisRouter = (): Router => {
    const router = Router();

    // --- Conference Log Analysis Routes ---
    router.get('/conference/latest', getLatestConferenceAnalysis);
    router.post('/conference/trigger', triggerConferenceCacheRegeneration);

    // --- Journal Log Analysis Routes ---
    router.get('/journal/latest', getLatestJournalAnalysis);
    router.post('/journal/trigger', triggerJournalCacheRegeneration);

    return router;
}

export default createLogAnalysisRouter;