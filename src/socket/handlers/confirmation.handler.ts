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
 *                                     (socket, logToFile, userId, sendChatError, ensureAuthenticated, etc.).
 */
export const registerConfirmationHandlers = (deps: HandlerDependencies): void => {
    const {
        socket,
        logToFile,
        socketId,
        ensureAuthenticated,
    } = deps;

    const baseLogContext = `[${CONFIRMATION_HANDLER_NAME}][${socketId}]`;

    logToFile(`${baseLogContext}[${deps.userId}] Registering confirmation event handlers.`);

    socket.on('user_confirm_email', (data: unknown) => {
        const eventName = 'user_confirm_email';
        const authenticatedUserId = ensureAuthenticated(`${baseLogContext}[${deps.userId}]`, eventName);
        if (!authenticatedUserId) return;
        const handlerLogContext = `${baseLogContext}[${authenticatedUserId}]`;

        if (isConfirmationEventData(data)) {
            const { confirmationId } = data;
            const confirmationLogContext = `${handlerLogContext}[Confirm:${confirmationId}]`;
            logToFile(`[INFO] ${confirmationLogContext} 'user_confirm_email' request received.`);
            handleUserEmailConfirmation(confirmationId, socket);
        } else {
            logToFile(`[WARNING] ${handlerLogContext} Invalid event data for 'user_confirm_email'. Received: ${JSON.stringify(data)?.substring(0, 100)}.`);
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
            logToFile(`[INFO] ${confirmationLogContext} 'user_cancel_email' request received.`);
            handleUserEmailCancellation(confirmationId, socket);
        } else {
            logToFile(`[WARNING] ${handlerLogContext} Invalid event data for 'user_cancel_email'. Received: ${JSON.stringify(data)?.substring(0, 100)}.`);
            socket.emit('confirmation_result', { confirmationId: 'N/A', status: 'failed', message: 'Invalid cancellation data provided.' });
        }
    });

    logToFile(`${baseLogContext}[${deps.userId}] Confirmation event handlers successfully registered.`);
};

function isConfirmationEventData(data: unknown): data is ConfirmationEventData {
    return (
        typeof data === 'object' &&
        data !== null &&
        typeof (data as ConfirmationEventData).confirmationId === 'string' &&
        !!(data as ConfirmationEventData).confirmationId
    );
}