// src/api/v1/logAnalysis/logAnalysis.routes.ts
import { Router } from 'express';
import {
    getLatestConferenceAnalysis,
    getLatestJournalAnalysis,
    deleteLogAnalysisRequests, // Import the new controller function
} from './logAnalysis.controller';

const createLogAnalysisRouter = (): Router => {
    const router = Router();

    // --- Conference Log Analysis Routes ---
    router.get('/conference/latest', getLatestConferenceAnalysis);

    // --- Journal Log Analysis Routes ---
    router.get('/journal/latest', getLatestJournalAnalysis);


    return router;
}

export default createLogAnalysisRouter;