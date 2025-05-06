// src/handlers/sendEmailToAdmin.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    ConfirmSendEmailAction, // Renamed from ConfirmEmailSendPayload potentially, ensure type consistency
    FrontendAction
} from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed
import { v4 as uuidv4 } from 'uuid'; // For generating unique confirmation IDs

// Define a default timeout (e.g., 60 seconds = 60000 ms)
const CONFIRMATION_TIMEOUT_MS = 60000;
// Define valid request types for clarity and reuse
const VALID_REQUEST_TYPES = ['contact', 'report'] as const;
type ValidRequestType = typeof VALID_REQUEST_TYPES[number]; // 'contact' | 'report'

export class SendEmailToAdminHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const { args, handlerId, socketId, onStatusUpdate, userToken } = context; // userToken included for context, though not used directly here yet
        const logPrefix = `[${handlerId} ${socketId}]`;

        logToFile(`${logPrefix} Handler: SendEmailToAdmin (Confirmation Step), Args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

        // --- Helper function để gửi status update ---
        const sendStatus = (step: string, message: string, details?: object) => {
            if (onStatusUpdate) {
                onStatusUpdate('status_update', {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp: new Date().toISOString(),
                });
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate not provided for step: ${step}`);
            }
        };

        try {
            // --- 1. Validation (Using Guard Clauses) ---
            sendStatus('validating_email_args', 'Validating email arguments...', { args });

            const subject = args?.subject as string | undefined;
            const requestType = args?.requestType as string | undefined; // Validate as string first
            const message = args?.message as string | undefined;

            // a) Validate Subject
            if (!subject || typeof subject !== 'string' || subject.trim() === '') {
                const errorMsg = "Missing or invalid 'subject' argument.";
                logToFile(`${logPrefix} SendEmailToAdmin: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments for sending email.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }
            const trimmedSubject = subject.trim(); // Use trimmed version onwards

            // b) Validate Request Type
            if (!requestType || !VALID_REQUEST_TYPES.includes(requestType as ValidRequestType)) {
                const errorMsg = `Invalid or missing 'requestType'. Must be one of: ${VALID_REQUEST_TYPES.join(', ')}. Received: "${requestType}"`;
                logToFile(`${logPrefix} SendEmailToAdmin: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments for sending email.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }
            // Type is now narrowed to ValidRequestType
            const validRequestType = requestType as ValidRequestType;

            // c) Validate Message
            if (!message || typeof message !== 'string' || message.trim() === '') {
                const errorMsg = "Missing or invalid 'message' argument.";
                logToFile(`${logPrefix} SendEmailToAdmin: Validation Failed - ${errorMsg}`);
                sendStatus('function_error', 'Invalid arguments for sending email.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined };
            }
            const trimmedMessage = message.trim(); // Use trimmed version onwards

            // --- Validation Passed ---

            // --- 2. Prepare Confirmation Action ---
            const confirmationId = uuidv4();
            logToFile(`${logPrefix} SendEmailToAdmin: Preparing confirmation request ID: ${confirmationId}`);
            sendStatus('preparing_email_confirmation', 'Preparing email confirmation dialog...', { confirmationId, subject: trimmedSubject, requestType: validRequestType });

            // Build the payload for the frontend confirmation action
            // Types are already validated/narrowed above
            const confirmationPayload: ConfirmSendEmailAction = {
                confirmationId,
                subject: trimmedSubject,
                requestType: validRequestType,
                message: trimmedMessage,
                timeoutMs: CONFIRMATION_TIMEOUT_MS,
            };

            const frontendAction: FrontendAction = {
                type: 'confirmEmailSend',
                payload: confirmationPayload
            };

            // --- 3. Backend Staging (Conceptual Log) ---
            // This log reminds us that the actual storage happens elsewhere
            logToFile(`${logPrefix} SendEmailToAdmin: Staging confirmation ${confirmationId}. Awaiting frontend response. (Requires external state management)`);
            // NOTE: Implement the actual storage/timeout mechanism where executeFunctionCall resides or in a dedicated service.

            // --- 4. Return Response to Model & Trigger Frontend ---
            // Inform the model/user about the next step (checking the confirmation dialog)
            return {
                modelResponseContent: `Okay, I've prepared an email with the subject "${trimmedSubject}". Please review the details in the confirmation pop-up and click 'Send' to proceed. This confirmation will expire in ${CONFIRMATION_TIMEOUT_MS / 1000} seconds.`,
                frontendAction: frontendAction
            };

        } catch (error: any) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} CRITICAL Error in SendEmailToAdminHandler (Confirmation Step): ${errorMessage}\nStack: ${error.stack}`);
            // Use optional chaining for sendStatus
            sendStatus?.('function_error', `Internal error preparing email confirmation: ${errorMessage}`);
            // Inform the model about the failure to even start the confirmation process
            return {
                modelResponseContent: `Error: An unexpected issue occurred while preparing the email confirmation. Please try again later. (${errorMessage})`,
                frontendAction: undefined
            };
        }
    }
}