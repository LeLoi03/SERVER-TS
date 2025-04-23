// src/handlers/sendEmailToAdmin.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, ConfirmSendEmailAction, FrontendAction } from '../shared/types'; // Make sure ConfirmEmailSendPayload is imported
import logToFile from '../../utils/logger';
// NOTE: We DO NOT import executeSendEmailToAdmin here anymore, as the handler doesn't call it directly.
import { v4 as uuidv4 } from 'uuid'; // Import a UUID generator

// Define a default timeout (e.g., 60 seconds)
const CONFIRMATION_TIMEOUT_MS = 60000;

export class SendEmailToAdminHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate, socket } = context;
        const userToken = context.userToken;

        const subject = args?.subject as string | undefined;
        const requestType = args?.requestType as ('contact' | 'report' | undefined);
        const message = args?.message as string | undefined;

        logToFile(`[${handlerId} ${socketId}] Handler: SendEmailToAdmin (Confirmation Step), Args: ${JSON.stringify(args)} Auth: ${!!userToken}`);

        try {
            // --- Validation (remains the same) ---
            if (!onStatusUpdate('status_update', { type: 'status', step: 'validating_email_args', message: 'Validating email arguments...', details: { args }, timestamp: new Date().toISOString() })) {
                 if (!socket?.connected) throw new Error("Client disconnected during validation status update.");
                 logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'validating_email_args' status via callback.`);
            }

            let validationError: string | null = null;
            if (!subject || typeof subject !== 'string' || subject.trim() === '') {
                validationError = "Missing or invalid 'subject' argument.";
            } else if (!requestType || !['contact', 'report'].includes(requestType)) {
                validationError = `Invalid or missing 'requestType'. Must be 'contact' or 'report'. Received: "${requestType}"`;
            } else if (!message || typeof message !== 'string' || message.trim() === '') {
                validationError = "Missing or invalid 'message' argument.";
            }
            // Add any other necessary validation (e.g., length limits)

            if (validationError) {
                logToFile(`[${handlerId} ${socketId}] SendEmailToAdmin: Validation Failed: ${validationError}`);
                onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: 'Invalid arguments for sending email.', details: { error: validationError, args }, timestamp: new Date().toISOString() });
                return { modelResponseContent: `Error: ${validationError}`, frontendAction: undefined };
            }

            // --- Prepare Confirmation Action ---
            const confirmationId = uuidv4(); // Generate a unique ID for this request
            logToFile(`[${handlerId} ${socketId}] SendEmailToAdmin: Preparing confirmation request ID: ${confirmationId}`);

            if (!onStatusUpdate('status_update', { type: 'status', step: 'preparing_email_confirmation', message: 'Preparing email confirmation dialog...', details: { confirmationId, subject, requestType }, timestamp: new Date().toISOString() })) {
                 if (!socket?.connected) throw new Error("Client disconnected before preparing email confirmation status update.");
                 logToFile(`[${handlerId} ${socketId}] Warning: Failed to emit 'preparing_email_confirmation' status via callback.`);
            }

            // After validation, we know these are not undefined.
            // Use type assertions to tell TypeScript this.
            const confirmationPayload: ConfirmSendEmailAction = {
                confirmationId,
                subject: subject as string, // Assert subject is string
                requestType: requestType as 'contact' | 'report', // Assert requestType is 'contact' | 'report'
                message: message as string, // Assert message is string
                timeoutMs: CONFIRMATION_TIMEOUT_MS,
            };

            const frontendAction: FrontendAction = {
                 type: 'confirmEmailSend',
                 payload: confirmationPayload
            };

            // --- IMPORTANT ---
            // The backend now needs a mechanism (outside this handler, likely where executeFunctionCall is managed)
            // to store the 'confirmationPayload' along with 'userToken' (if needed for sending)
            // associated with 'confirmationId'. This data is needed when the frontend sends back the confirmation.
            // Example: pendingConfirmations.set(confirmationId, { payload: confirmationPayload, userToken, handlerId, socketId });
            // Also start a timeout for 'confirmationId'.
            logToFile(`[${handlerId} ${socketId}] SendEmailToAdmin: Staging confirmation ${confirmationId}. Awaiting frontend response.`);


            // --- Return response to Model and trigger Frontend Action ---
            return {
                // This message guides the model on what to tell the user NEXT
                modelResponseContent: `Okay, I have prepared the email with the subject "${subject}". Please check the confirmation dialog that appeared on your screen to review the details and confirm sending. It will expire in ${CONFIRMATION_TIMEOUT_MS / 1000} seconds.`,
                frontendAction: frontendAction
            };

        } catch (error: any) {
            logToFile(`[${handlerId} ${socketId}] CRITICAL Error in SendEmailToAdminHandler (Confirmation Step): ${error.message}\nStack: ${error.stack}`);
            onStatusUpdate?.('status_update', { type: 'status', step: 'function_error', message: `Internal error preparing email confirmation: ${error.message}`, timestamp: new Date().toISOString() });
            // Inform the model about the failure to even start the confirmation
            return { modelResponseContent: `Error preparing email confirmation: An unexpected error occurred. ${error.message}`, frontendAction: undefined };
        }
    }
}