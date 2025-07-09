// src/chatbot/gemini/functionRegistry.ts
import { Socket } from 'socket.io';
// import { Logger } from 'pino'; // REMOVED: As per requirement, no pino Logger

import { IFunctionHandler } from '../interface/functionHandler.interface';
import {
    FunctionHandlerInput,
    FunctionHandlerOutput,
    Language,
    StatusUpdate,
    AgentId
} from '../shared/types';
import { getErrorMessageAndStack } from '../../utils/errorUtils';

// --- Import Handlers ---
// Assuming these handlers are already properly implemented and follow IFunctionHandler
import { GetConferencesHandler } from '../handlers/getConferences.handler';
import { GetWebsiteInfoHandler } from '../handlers/getWebsiteInfo.handler';
import { NavigationHandler } from '../handlers/navigation.handler';
import { OpenGoogleMapHandler } from '../handlers/openGoogleMap.handler';
import { ManageFollowHandler } from '../handlers/manageFollow.handler';
import { ManageCalendarHandler } from '../handlers/manageCalendar.handler';
import { ManageBlacklistHandler } from '../handlers/manageBlacklist.handler';
import { SendEmailToAdminHandler } from '../handlers/sendEmailToAdmin.handler';

/**
 * Global registry for all available function handlers.
 * Each key maps to a function name (as expected from the LLM) and its value is an instance of `IFunctionHandler`.
 */
const functionRegistry: Record<string, IFunctionHandler> = {
    getConferences: new GetConferencesHandler(),
    getWebsiteInfo: new GetWebsiteInfoHandler(),
    navigation: new NavigationHandler(),
    openGoogleMap: new OpenGoogleMapHandler(),
    manageFollow: new ManageFollowHandler(),
    manageCalendar: new ManageCalendarHandler(),
    manageBlacklist: new ManageBlacklistHandler(),
    sendEmailToAdmin: new SendEmailToAdminHandler(),
    // Add other handlers here
};

/**
 * Looks up and executes the appropriate function handler based on the LLM's function call.
 * Status updates are sent via `onStatusUpdate` callback, which is used by the caller
 * to collect `ThoughtStep`s and emit updates to the frontend.
 *
 * @param {{ name: string; args: any }} functionCall - The LLM's function call object, containing the function name and arguments.
 * @param {AgentId} callingAgentId - The ID of the agent (e.g., 'ConferenceAgent') making this function call.
 * @param {string} handlerProcessId - A unique ID for this specific execution process, used for correlating logs and status updates.
 * @param {Language} language - The current language context for the operation.
 * @param {(eventName: 'status_update', data: StatusUpdate) => boolean} onStatusUpdate - Callback to send `StatusUpdate` messages.
 *                                                                                          Returns `true` if the update was processed, `false` if client disconnected.
 * @param {Socket} socket - The client Socket.IO socket, used for context and potentially direct communication.
 * @param {any} [executionContext] - Optional additional context for the function handler (e.g., `userToken`).
 * @returns {Promise<FunctionHandlerOutput>} A Promise that resolves with the function handler's output,
 *                                          containing `modelResponseContent` and an optional `frontendAction`.
 */
export async function executeFunction(
    functionCall: { name: string; args: any },
    callingAgentId: AgentId,
    handlerProcessId: string,
    language: Language,
    onStatusUpdate: (eventName: 'status_update', data: StatusUpdate) => boolean,
    socket: Socket,
    // REMOVED: logger: Logger parameter
    executionContext?: any
): Promise<FunctionHandlerOutput> {

    const functionName = functionCall.name;
    const args = functionCall.args || {};
    const socketId = socket.id;
    const userToken = executionContext?.userToken ?? (socket.data.token as string | null);


    

    // Helper to report a step FOR FUNCTION REGISTRY ITSELF
    // These steps are initiated by the callingAgentId.
    const reportRegistryStep = (stepKey: string, message: string, details?: any): boolean => {
        const timestamp = new Date().toISOString();
        const statusUpdate: StatusUpdate = {
            type: 'status',
            step: stepKey,
            message,
            details,
            timestamp,
            agentId: callingAgentId, // Steps by the registry are under the calling agent
        };
        return onStatusUpdate('status_update', statusUpdate);
    };

    // 1. Initial Status Update & Disconnect Check
    if (!reportRegistryStep('function_call_received', `Preparing to execute function: "${functionName}".`,
        { argsPreview: JSON.stringify(args).substring(0, 100) + '...' }
    )) {
        
        return {
            modelResponseContent: "Error: Could not execute function because the client disconnected.",
            frontendAction: undefined
        };
    }

    // 2. Handler Lookup
    const handler = functionRegistry[functionName];

    // 3. Handle Unknown Function
    if (!handler) {
        const errorMsg = `Function "${functionName}" is not recognized or implemented in the registry.`;
        
        reportRegistryStep('unknown_function', `Error: ${errorMsg}`, { functionNameAttempted: functionName });
        return {
            modelResponseContent: `Error: ${errorMsg}`,
            frontendAction: undefined
        };
    }

    // 4. Execute Found Handler
    
    try {
        const context: FunctionHandlerInput = {
            args: args,
            userToken: userToken,
            language: language,
            handlerId: handlerProcessId,
            socketId: socketId,
            onStatusUpdate: onStatusUpdate, // Pass onStatusUpdate directly
            socket: socket,
            functionName: functionName,
            executionContext: executionContext,
            agentId: callingAgentId, // The agent responsible for this function call
            // REMOVED: logger: childLogger.child({ sub_context: 'handler_execution' }) // No Pino logger
        };

        // The handler will call `onStatusUpdate` for its internal steps, setting its own agentId/handlerId.
        const resultFromHandler: FunctionHandlerOutput = await handler.execute(context);

        const isErrorResult = resultFromHandler.modelResponseContent.toLowerCase().startsWith('error:');
        

        reportRegistryStep('function_result_processed',
            `Function handler for "${functionName}" completed${isErrorResult ? ' with error' : ''}.`,
            { success: !isErrorResult, resultPreview: resultFromHandler.modelResponseContent.substring(0, 100) + '...' }
        );

        return resultFromHandler;

    } catch (executionError: unknown) { // Catch as unknown for safety
        // This catch block is for UNEXPECTED errors *during the execution of the handler itself*,
        // not for errors *returned by* the handler (which should be part of resultFromHandler.modelResponseContent).
        const { message: errorMessage, stack: errorStack } = getErrorMessageAndStack(executionError);
        

        reportRegistryStep('function_execution_critical_error',
            `System error during execution of function "${functionName}": ${errorMessage}`,
            { error: errorMessage, stackPreview: errorStack?.substring(0, 200) }
        );

        return {
            modelResponseContent: `Error: An unexpected system error occurred while trying to execute ${functionName}. (${errorMessage})`,
            frontendAction: undefined,
        };
    }
}