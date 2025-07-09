// src/chatbot/handlers/openGoogleMap.handler.ts
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, StatusUpdate, ThoughtStep, AgentId } from '../shared/types'; // Added ThoughtStep, AgentId
import { getErrorMessageAndStack } from '../../utils/errorUtils'; // Import error utility

/**
 * Handles the 'openGoogleMap' function call from the LLM.
 * This handler prepares a frontend action to open Google Maps for a specified location.
 * It performs basic validation on the provided location string.
 */
export class OpenGoogleMapHandler implements IFunctionHandler {
    /**
     * Executes the Google Maps opening logic.
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
        const location = args?.location as string | undefined;
        const logPrefix = `[${handlerProcessId} ${socketId} Handler:OpenGoogleMap Agent:${agentId}]`; // Extended prefix
        const localThoughts: ThoughtStep[] = []; // Collection for thoughts

    

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
            
            }
        };

        try {
            // --- 1. Validation (Guard Clause) ---
            reportStep('validating_map_location', 'Validating location argument...', { args });

            // Trim and check if the location is a non-empty string
            const trimmedLocation = location?.trim();
            if (!trimmedLocation) { // Checks for null, undefined, '', or ' '
                const errorMsg = "Invalid or missing 'location' argument.";
            
                reportStep('function_error', 'Invalid location provided for map.', { error: errorMsg, location });
                return {
                    modelResponseContent: `Error: ${errorMsg} Please provide a valid location for the map. Received: "${location || 'not provided'}"`,
                    frontendAction: undefined,
                    thoughts: localThoughts
                };
            }
            // --- Location is now confirmed to be a non-empty string ---

            // --- 2. Prepare Action (Success Case) ---
        
            reportStep('map_action_prepared', 'Google Maps action prepared.', { location: trimmedLocation });

            return {
                modelResponseContent: `Map action acknowledged. Google Maps will be opened for the location: "${trimmedLocation}".`,
                frontendAction: { type: 'openMap', location: trimmedLocation },
                thoughts: localThoughts
            };

        } catch (error: unknown) { // Catch as unknown for safer error handling
            const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(error);
        
            reportStep('function_error', `Critical error during map processing: ${errorMessage}`, { error: errorMessage, stack: errorStack });
            return {
                modelResponseContent: `An unexpected error occurred while preparing the map action: ${errorMessage}`,
                frontendAction: undefined,
                thoughts: localThoughts
            };
        }
    }
}