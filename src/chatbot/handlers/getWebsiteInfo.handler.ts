// src/chatbot/handlers/getWebsiteInfo.handler.ts
import { executeGetWebsiteInfo } from '../services/getWebsiteInfo.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdatePayload, ThoughtStep } from '../shared/types';
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Handles the 'getWebsiteInfo' function call from the LLM.
 * This handler calls the `executeGetWebsiteInfo` service to retrieve general website information,
 * processes its result, and communicates status updates to the caller.
 */
export class GetWebsiteInfoHandler implements IFunctionHandler {
    /**
     * Executes the logic for retrieving general website information.
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
            agentId // ID of the sub-agent executing this function
        } = context;
        const logPrefix = `[${handlerProcessId} ${socketId} Handler:GetWebsiteInfo Agent:${agentId}]`;
        const localThoughts: ThoughtStep[] = []; // Collect thoughts specific to this handler

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
                const statusData: StatusUpdatePayload = {
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
            // --- 1. Validation (Minimal for this handler) ---
            reportStep('validating_function_args', 'Validating arguments for getWebsiteInformation...', { args });
            // Note: No specific argument validation (like searchQuery) is needed based on the original code's call to executeGetWebsiteInfo().

            // --- 2. Prepare & Execute Service Call ---
            reportStep('retrieving_info', 'Retrieving general website information...', { target: 'general website info' });

            // Assuming executeGetWebsiteInfo returns { success: boolean, data?: string, errorMessage?: string }
            // And it doesn't require specific arguments from 'args' based on original call
            const result = await executeGetWebsiteInfo();
            logToFile(`${logPrefix} API result: Success=${result.success}`);

            // --- 3. Process Result ---
            if (result.success && result.data) {
                // Successfully retrieved data
                reportStep('data_found', 'Successfully retrieved website information.', { success: true, infoLength: result.data.length, resultPreview: result.data.substring(0, 100) + "..." });
                return {
                    modelResponseContent: result.data,
                    frontendAction: undefined,
                    thoughts: localThoughts
                };
            } else {
                // Handle failure: API call failed OR succeeded but returned no data
                const errorMsg = result.errorMessage || 'Failed to retrieve website information (no data or specific error returned).';
                logToFile(`${logPrefix} Failed to retrieve website info: ${errorMsg}`);
                reportStep('api_call_failed', 'Failed to retrieve website information.', { error: errorMsg, success: result.success }); // Include success status from API if available
                return {
                    modelResponseContent: `Error: ${errorMsg}`,
                    frontendAction: undefined,
                    thoughts: localThoughts
                };
            }
        } catch (error: unknown) { // Catch as unknown
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error: ${errorMessage}\nStack: ${errorStack}`);
            reportStep('function_error', `Critical error during website info retrieval: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred while trying to get website information: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}