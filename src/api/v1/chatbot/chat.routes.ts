// src/api/v1/chat/chat.routes.ts
import { Router } from 'express';
import { container } from 'tsyringe';
import { ChatController, filesUploadMiddleware } from './chat.controller'; // Adjust path as needed

const createChatRouter = (): Router => {
    const router = Router();
    // Resolve controller from tsyringe or instantiate directly if not using tsyringe for controllers
    const chatController = container.resolve(ChatController); // Or new ChatController()

    // Route for file uploads
    // The 'filesUploadMiddleware' will process 'multipart/form-data'
    // and put the file(s) in req.files
    router.post(
        '/upload-files', // Changed from /upload-file to /upload-files to reflect multiple files
        filesUploadMiddleware,
        (req, res) => chatController.handleFileUpload(req, res) // Bind context or use arrow function
    );

    return router;
};

export default createChatRouter;