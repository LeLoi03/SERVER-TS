// src/chatbot/handlers/sendEmailToAdmin.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    ConfirmSendEmailAction,
    FrontendAction,
    StatusUpdate, // Added for consistency
    ThoughtStep, // Added for consistency
    AgentId // Added for consistency
} from '../shared/types';
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { v4 as uuidv4 } from 'uuid'; // For generating unique confirmation IDs
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Define a default timeout for the confirmation dialog (e.g., 60 seconds = 60000 ms).
 */
const CONFIRMATION_TIMEOUT_MS = 60000;
/**
 * Define valid request types for clarity and reuse.
 */
const VALID_REQUEST_TYPES = ['contact', 'report'] as const;
/**
 * Type alias for `VALID_REQUEST_TYPES` elements.
 */
type ValidRequestType = typeof VALID_REQUEST_TYPES[number];

/**
 * Handles the 'sendEmailToAdmin' function call from the LLM.
 * This handler prepares a confirmation dialog for the user on the frontend
 * before an actual email is sent. It performs validation on email arguments
 * and generates a unique confirmation ID.
 */
export class SendEmailToAdminHandler implements IFunctionHandler {
    /**
     * Executes the email to admin confirmation logic.
     *
     * @param {FunctionHandlerInput} context - The input context for the function handler,
     *                                       including arguments, handler ID, socket ID,
     *                                       status update callback, and user token.
     * @returns {Promise<FunctionHandlerOutput>} A Promise that resolves with the model's response content,
     *                                          a frontend action to trigger confirmation, and a collection of `ThoughtStep`s.
     */
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const {
            args,
            handlerId: handlerProcessId,
            socketId,
            onStatusUpdate,
            userToken, // userToken included for context, though not used directly here yet
            agentId // Agent ID from the calling context
        } = context;
        const logPrefix = `[${handlerProcessId} ${socketId} Handler:SendEmailToAdmin Agent:${agentId}]`; // Extended prefix
        const localThoughts: ThoughtStep[] = []; // Collection for thoughts

        logToFile(`${logPrefix} Executing with args: ${JSON.stringify(args)}, Auth: ${!!userToken}`);

        /**
         * Helper function to report a status update and collect a ThoughtStep.
         * @param {string} step - A unique identifier for the current step.
         * @param {string} message - A human-readable message.
         * @param {object} [details] - Optional additional details.
         */
        const reportStep = (step: string, message: string, details?: object): void => {
            const timestamp = new Date().toISOString();
            const thought: ThoughtStep = {
                step,
                message,
                details,
                timestamp,
                agentId: agentId,
            };
            localThoughts.push(thought);
            logToFile(`${logPrefix} Thought added: Step: ${step}, Agent: ${agentId}`);

            if (onStatusUpdate) {
                const statusData: StatusUpdate = {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp,
                    agentId: agentId,
                };
                onStatusUpdate('status_update', statusData);
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate callback not provided for step: ${step}`);
            }
        };

        try {
            // --- 1. Validation (Using Guard Clauses) ---
            reportStep('validating_email_args', 'Validating email arguments...', { args });

            const subject = args?.subject as string | undefined;
            const requestType = args?.requestType as string | undefined; // Validate as string first
            const message = args?.message as string | undefined;

            // a) Validate Subject
            if (!subject || typeof subject !== 'string' || subject.trim() === '') {
                const errorMsg = "Missing or invalid 'subject' argument.";
                logToFile(`${logPrefix} Validation Failed - ${errorMsg}`);
                reportStep('function_error', 'Invalid arguments for sending email.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }
            const trimmedSubject = subject.trim(); // Use trimmed version onwards

            // b) Validate Request Type
            if (!requestType || !VALID_REQUEST_TYPES.includes(requestType as ValidRequestType)) {
                const errorMsg = `Invalid or missing 'requestType'. Must be one of: ${VALID_REQUEST_TYPES.join(', ')}. Received: "${requestType}"`;
                logToFile(`${logPrefix} Validation Failed - ${errorMsg}`);
                reportStep('function_error', 'Invalid arguments for sending email.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }
            // Type is now narrowed to ValidRequestType
            const validRequestType = requestType as ValidRequestType;

            // c) Validate Message
            if (!message || typeof message !== 'string' || message.trim() === '') {
                const errorMsg = "Missing or invalid 'message' argument.";
                logToFile(`${logPrefix} Validation Failed - ${errorMsg}`);
                reportStep('function_error', 'Invalid arguments for sending email.', { error: errorMsg, args });
                return { modelResponseContent: `Error: ${errorMsg}`, frontendAction: undefined, thoughts: localThoughts };
            }
            const trimmedMessage = message.trim(); // Use trimmed version onwards

            // --- Validation Passed ---

            // --- 2. Prepare Confirmation Action ---
            const confirmationId = uuidv4();
            logToFile(`${logPrefix} Preparing confirmation request ID: ${confirmationId}`);
            reportStep('preparing_email_confirmation', 'Preparing email confirmation dialog...', { confirmationId, subject: trimmedSubject, requestType: validRequestType });

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
            logToFile(`${logPrefix} Staging confirmation ${confirmationId}. Awaiting frontend response. (Requires external state management)`);
            // NOTE: Implement the actual storage/timeout mechanism where executeFunctionCall resides or in a dedicated service.

            // --- 4. Return Response to Model & Trigger Frontend ---
            // Inform the model/user about the next step (checking the confirmation dialog)
            return {
                modelResponseContent: `Okay, I've prepared an email with the subject "${trimmedSubject}". Please review the details in the confirmation pop-up and click 'Send' to proceed. This confirmation will expire in ${CONFIRMATION_TIMEOUT_MS / 1000} seconds.`,
                frontendAction: frontendAction,
                thoughts: localThoughts
            };

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error in SendEmailToAdminHandler (Confirmation Step): ${errorMessage}\nStack: ${errorStack}`);
            reportStep('function_error', `Internal error preparing email confirmation: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            // Inform the model about the failure to even start the confirmation process
            return {
                modelResponseContent: `Error: An unexpected issue occurred while preparing the email confirmation. Please try again later. (${errorMessage})`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}