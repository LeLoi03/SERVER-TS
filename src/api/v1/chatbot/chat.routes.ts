// src/api/v1/chat/chat.routes.ts
import { Router } from 'express';
import { container } from 'tsyringe';
import { ChatController, filesUploadMiddleware } from './chat.controller';

const createChatRouter = (): Router => {
    const router = Router();
    const chatController = container.resolve(ChatController);

    // Route for file uploads (existing)
    router.post(
        '/upload-files',
        filesUploadMiddleware,
        (req, res) => chatController.handleFileUpload(req, res)
    );

    // <<< NEW: Route for submitting feedback >>>
    router.post(
        '/feedback',
        (req, res) => chatController.handleFeedbackSubmission(req, res)
    );

    return router;
};

export default createChatRouter;