// src/chatbot/handlers/navigation.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate, ThoughtStep, AgentId } from '../shared/types'; // Added ThoughtStep, AgentId
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Handles the 'navigation' function call from the LLM.
 * This handler prepares a frontend action to navigate the user's browser to a specified URL.
 * It performs basic validation on the URL format.
 */
export class NavigationHandler implements IFunctionHandler {
    /**
     * Executes the navigation logic.
     *
     * @param {FunctionHandlerInput} context - The input context for the function handler,
     *                                       including arguments, handler ID, socket ID,
     *                                       status update callback, and agent ID.
     * @returns {Promise<FunctionHandlerOutput>} A Promise that resolves with the model's response content,
     *                                          an optional frontend action, and a collection of `ThoughtStep`s.
     */
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const {
            args,
            handlerId: handlerProcessId,
            socketId,
            onStatusUpdate,
            agentId // Agent ID from the calling context
        } = context;
        const targetUrl = args?.url as string | undefined;
        const logPrefix = `[${handlerProcessId} ${socketId} Handler:Navigation Agent:${agentId}]`; // Extended prefix
        const localThoughts: ThoughtStep[] = []; // Collection for thoughts

        logToFile(`${logPrefix} Executing with args: ${JSON.stringify(args)}`);

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
            // 1. Validation
            reportStep('validating_navigation_url', 'Validating navigation URL argument...', { args });

            const isValidUrl = targetUrl &&
                typeof targetUrl === 'string' &&
                (targetUrl.startsWith('/') || targetUrl.startsWith('http://') || targetUrl.startsWith('https://'));

            // Using Guard Clause: Handle error cases and return early
            if (!isValidUrl) {
                const errorMsg = "Invalid or missing 'url' argument. URL must start with '/' or 'http(s)://'.";
                logToFile(`${logPrefix} Invalid or missing 'url': "${targetUrl || 'undefined'}"`);
                reportStep('function_error', 'Invalid navigation URL provided.', { error: errorMsg, url: targetUrl });
                return {
                    modelResponseContent: `Error: ${errorMsg} Received: "${targetUrl || 'undefined'}"`,
                    frontendAction: undefined,
                    thoughts: localThoughts // Return collected thoughts
                };
            }

            // --- If validation succeeds ---
            logToFile(`${logPrefix} Valid target URL: ${targetUrl}`);

            // 2. Prepare Action
            reportStep('navigation_action_prepared', 'Navigation action prepared.', { url: targetUrl });

            // Return success result
            return {
                modelResponseContent: `Navigation action acknowledged. The user will be directed to the requested page (${targetUrl}).`,
                frontendAction: { type: 'navigate', url: targetUrl }, // targetUrl is definitely a string here
                thoughts: localThoughts // Return collected thoughts
            };

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error in NavigationHandler: ${errorMessage}\nStack: ${errorStack}`);
            reportStep('function_error', `Critical error during navigation processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}