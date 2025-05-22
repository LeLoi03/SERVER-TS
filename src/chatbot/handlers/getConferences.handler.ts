// src/chatbot/handlers/getConferences.handler.ts
import { executeGetConferences } from '../services/getConferences.service';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    StatusUpdate,
    ThoughtStep,
    AgentId // Ensure AgentId is imported
} from '../shared/types';
import logToFile from '../../utils/logger'; // Keeping logToFile as requested
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Handles the 'getConferences' function call from the LLM.
 * This handler validates the search query, calls the `executeGetConferences` service,
 * processes its result, and communicates status updates (including thoughts) to the caller.
 */
export class GetConferencesHandler implements IFunctionHandler {
    /**
     * Executes the logic for retrieving conference information based on a search query.
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
            handlerId: handlerProcessId, // ID of the specific function execution process
            socketId,
            onStatusUpdate,
            agentId // ID of the sub-agent executing this function (e.g., 'ConferenceAgent')
        } = context;

        const logPrefix = `[${handlerProcessId} ${socketId} Handler:GetConferences Agent:${agentId}]`;
        const searchQuery = args?.searchQuery as string | undefined;
        const dataType = "conference";
        const localThoughts: ThoughtStep[] = []; // Collect thoughts specific to this handler execution

        logToFile(`${logPrefix} Executing with args: ${JSON.stringify(args)}`);

        /**
         * Helper function to report a status update and collect a ThoughtStep.
         * This ensures consistency in how status updates and thoughts are generated.
         * @param {string} step - A unique identifier for the current step (e.g., 'validating_function_args').
         * @param {string} message - A human-readable message describing the step.
         * @param {object} [details] - Optional additional details to include in the status update and thought.
         */
        const reportStep = (step: string, message: string, details?: object): void => {
            const timestamp = new Date().toISOString();

            // 1. Collect ThoughtStep for internal logging/return
            const thought: ThoughtStep = {
                step,
                message,
                details,
                timestamp,
                agentId: agentId, // Attach the executing agent's ID to the thought
            };
            localThoughts.push(thought);
            logToFile(`${logPrefix} Thought added: Step: ${step}, Agent: ${agentId}`);

            // 2. Send StatusUpdate via callback (if provided)
            if (onStatusUpdate) {
                const statusData: StatusUpdate = {
                    type: 'status',
                    step,
                    message,
                    details,
                    timestamp,
                    agentId: agentId, // Attach the executing agent's ID to the status update
                };
                // `onStatusUpdate` callback is passed from `executeFunction`
                // and is responsible for emitting to the frontend.
                onStatusUpdate('status_update', statusData);
            } else {
                logToFile(`${logPrefix} Warning: onStatusUpdate callback not provided for step: ${step}`);
            }
        };

        try {
            // --- 1. Validation (Guard Clause) ---
            reportStep('validating_function_args', `Validating arguments for getting ${dataType}...`, { args });

            if (!searchQuery || typeof searchQuery !== 'string' || searchQuery.trim() === '') {
                const errorMsg = "Missing or empty search query for conferences.";
                logToFile(`${logPrefix} Validation Failed - ${errorMsg}`);
                // Record the validation error as a thought
                reportStep('function_error', `Invalid arguments: ${errorMsg}`, { error: errorMsg, args });
                return {
                    modelResponseContent: `Error: ${errorMsg} Please provide a search query for conferences.`,
                    frontendAction: undefined,
                    thoughts: localThoughts // Return collected thoughts
                };
            }

            // --- 2. Prepare & Execute Service Call ---
            reportStep('retrieving_info', `Retrieving ${dataType} data for query: "${searchQuery}"...`, { dataType, searchQuery });

            // Call the external service to get conference data
            const apiResult = await executeGetConferences(searchQuery);
            logToFile(`${logPrefix} API Result: Success=${apiResult.success}, Query="${searchQuery}"`);

            // --- 3. Process Result ---
            let modelResponseContent: string;

            if (apiResult.success) {
                reportStep('api_call_success', `API call for ${dataType} succeeded. Processing data...`, { query: searchQuery });
                if (apiResult.formattedData !== null) {
                    modelResponseContent = apiResult.formattedData;
                    reportStep('data_found', `Successfully retrieved and processed ${dataType} data.`, { success: true, query: searchQuery, resultPreview: modelResponseContent.substring(0, 100) + "..." });
                } else {
                    modelResponseContent = apiResult.rawData ?? (apiResult.errorMessage || `Received raw ${dataType} data for "${searchQuery}", but formatting was unavailable.`);
                    const warningMsg = `Data formatting issue for ${dataType}. Displaying raw data or error message.`;
                    logToFile(`${logPrefix} Warning: ${warningMsg}`);
                    reportStep('function_warning', warningMsg, {
                        rawDataPreview: typeof apiResult.rawData === 'string' ? apiResult.rawData.substring(0, 100) + '...' : '[object]',
                        errorMessage: apiResult.errorMessage,
                        query: searchQuery
                    });
                    // Still considered data found, but with formatting issues
                    reportStep('data_found_with_formatting_issues', `Retrieved ${dataType} data, but with formatting issues.`, { success: true, formattingIssue: true, query: searchQuery });
                }
            } else {
                // API call failed entirely
                modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data for query: "${searchQuery}".`;
                logToFile(`${logPrefix} API call failed: ${modelResponseContent}`);
                reportStep('api_call_failed', `API call failed for ${dataType}: ${modelResponseContent}`, { error: modelResponseContent, success: false, query: searchQuery });
            }

            // --- 4. Return Result ---
            reportStep('function_result_prepared', `Result for GetConferences prepared.`, { success: apiResult.success });
            return {
                modelResponseContent,
                frontendAction: undefined, // No direct frontend action from this function
                thoughts: localThoughts // Return all collected thoughts
            };

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
            logToFile(`${logPrefix} CRITICAL Error: ${errorMessage}\nStack: ${errorStack}`);
            // Record the critical error as a thought
            reportStep('function_error', `Critical error during ${dataType} retrieval: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred while trying to get conferences: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts // Return collected thoughts, including the error thought
            };
        }
    }
}