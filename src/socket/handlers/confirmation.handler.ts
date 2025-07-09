// src/socket/handlers/confirmation.handler.ts
import { HandlerDependencies } from './handler.types';
import { handleUserEmailConfirmation, handleUserEmailCancellation } from '../../chatbot/utils/confirmationManager';
// --- Import types ---
import { ConfirmationEventData } from '../../chatbot/shared/types';
// Import the new error utility
import { getErrorMessageAndStack } from '../../utils/errorUtils';

const CONFIRMATION_HANDLER_NAME = 'ConfirmationHandler';

/**
 * Registers Socket.IO event handlers related to user email confirmations and cancellations.
 * These handlers interact with the `confirmationManager` to process user actions.
 *
 * @param {HandlerDependencies} deps - An object containing common dependencies for handlers
 *                                     (socket, userId, sendChatError, ensureAuthenticated, etc.).
 */
export const registerConfirmationHandlers = (deps: HandlerDependencies): void => {
    const {
        socket,
        socketId,
        ensureAuthenticated,
    } = deps;

    const baseLogContext = `[${CONFIRMATION_HANDLER_NAME}][${socketId}]`;

    

    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (isConfirmationEventData(data)) {
            const { confirmationId } = data;
            const confirmationLogContext = `${handlerLogContext}[Confirm:${confirmationId}]`;
            
            handleUserEmailConfirmation(confirmationId, socket);
        } else {
            
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid confirmation data provided.' });
        }
    });

    socket.on('user_cancel_email', (data: unknown) => {
        const eventName = 'user_cancel_email';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (isConfirmationEventData(data)) {
            const { confirmationId } = data;
            const confirmationLogContext = `${handlerLogContext}[Cancel:${confirmationId}]`;
            
            handleUserEmailCancellation(confirmationId, socket);
        } else {
            
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data provided.' });
        }
    });

    
};

function isConfirmationEventData(data: unknown): data is ConfirmationEventData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as ConfirmationEventData).confirmationId === 'string' &&
        !!(data as ConfirmationEventData).confirmationId
    );
}