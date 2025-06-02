// src/api/v1/logAnalysis/logAnalysis.routes.ts
import { Router } from 'express';
import {
    getLatestConferenceAnalysis,
    triggerConferenceAnalysis,
    getLatestJournalAnalysis,  // <<< NEW IMPORT
    triggerJournalAnalysis     // <<< NEW IMPORT
} from './logAnalysis.controller';

const createLogAnalysisRouter = (): Router => {
    const router = Router();

    // --- Conference Log Analysis Routes ---
    router.get('/conference/latest', getLatestConferenceAnalysis);
    router.post('/conference/trigger', triggerConferenceAnalysis);

    // --- Journal Log Analysis Routes ---
    router.get('/journal/latest', getLatestJournalAnalysis); // <<< NEW ROUTE
    router.post('/journal/trigger', triggerJournalAnalysis);   // <<< NEW ROUTE

    return router;
}

export default createLogAnalysisRouter;