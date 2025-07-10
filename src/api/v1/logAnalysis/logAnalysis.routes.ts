// src/api/v1/logAnalysis/logAnalysis.routes.ts
import { Router } from 'express';
import {
    getLatestConferenceAnalysis,
    getLatestJournalAnalysis,
    getLatestChatbotAnalysis
} from './logAnalysis.controller';

const createLogAnalysisRouter = (): Router => {
    const router = Router();

    // --- Conference Log Analysis Routes ---
    router.get('/conference/latest', getLatestConferenceAnalysis);

    // --- Journal Log Analysis Routes ---
    router.get('/journal/latest', getLatestJournalAnalysis);

    // --- Chatbot Log Analysis Route ---
    router.get('/chatbot/latest', getLatestChatbotAnalysis); // <<< THÊM MỚI

    return router;
}

export default createLogAnalysisRouter;