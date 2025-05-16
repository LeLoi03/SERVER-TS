// src/socket/handlers/confirmation.handler.ts
import { HandlerDependencies } from './handler.types';
import { handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager';
// --- Import types ---
import { ConfirmationEventData } from '../../chatbot/shared/types';

const CONFIRMATION_HANDLER_NAME = 'confirmationHandler';

export const registerConfirmationHandlers = (deps: HandlerDependencies): void => {
    const {
        socket,
        logToFile,
        userId: currentUserId, // Again, use ensureAuthenticated
        socketId,
        ensureAuthenticated,
    } = deps;

    const baseLogContext = `[${CONFIRMATION_HANDLER_NAME}][${socketId}]`;

    logToFile(`${baseLogContext}[${currentUserId}] Registering confirmation event handlers.`);

    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            const confirmationLogContext = `${handlerLogContext}[Confirm:${confirmationId}]`;
            logToFile(`[INFO] ${confirmationLogContext} Request received.`);
            handleUserEmailConfirmation(confirmationId, socket); // socket is passed for emitting results
        } else {
            logToFile(`[WARNING] ${handlerLogContext} Invalid event data for email confirmation.`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${currentUserId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (typeof data === 'object' && data !== null && typeof (data as ConfirmationEventData)?.confirmationId === 'string' && (data as ConfirmationEventData).confirmationId) {
            const { confirmationId } = data as ConfirmationEventData;
            const confirmationLogContext = `${handlerLogContext}[Cancel:${confirmationId}]`;
            logToFile(`[INFO] ${confirmationLogContext} Request received.`);
            handleUserEmailCancellation(confirmationId, socket); // socket is passed for emitting results
        } else {
            logToFile(`[WARNING] ${handlerLogContext} Invalid event data for email cancellation.`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data.' });
        }
    });
    logToFile(`${baseLogContext}[${currentUserId}] Confirmation event handlers registered.`);
};