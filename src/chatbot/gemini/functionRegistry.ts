// src/chatbot/gemini/functionRegistry.ts
import { Socket } from 'socket.io';
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Adjust path if needed
import { FunctionHandlerInput, FunctionHandlerOutput, Language, StatusUpdate } from '../shared/types'; // Adjust path if needed
import logToFile from '../../utils/logger'; // Adjust path if needed
import { Logger } from 'pino'; // <<< Import Logger

// --- Import Handlers ---
// Ensure paths are correct relative to this file's location
import { GetConferencesHandler } from '../handlers/getConferences.handler';
import { GetJournalsHandler } from '../handlers/getJournals.handler';
import { GetWebsiteInfoHandler } from '../handlers/getWebsiteInfo.handler';
import { NavigationHandler } from '../handlers/navigation.handler';
import { OpenGoogleMapHandler } from '../handlers/openGoogleMap.handler';
import { FollowUnfollowItemHandler } from '../handlers/followUnfollowItem.handler';
import { SendEmailToAdminHandler } from '../handlers/sendEmailToAdmin.handler';
// ... import other handlers

// --- Unknown Function Handler ---
class UnknownFunctionHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        // Attempt to get the function name from context if passed down, otherwise use a generic message
        const functionName = context.functionName || 'unknown function';
        const logPrefix = `[${context.handlerId} ${context.socketId}]`;
        logToFile(`${logPrefix} Error: Attempted to execute unknown function: ${functionName}`);
        // No need to emit status here, as the calling function (executeFunction) already did.
        return {
            modelResponseContent: `Error: I cannot perform the action associated with "${functionName}" as it's not a recognized capability.`,
            frontendAction: undefined,
        };
    }
}

// --- Function Registry ---
// Maps the function names called by the LLM to their corresponding handler instances.
const functionRegistry: Record<string, IFunctionHandler> = {
    // Map function names exactly as defined in the FunctionDeclarations provided to the LLM
    getConferences: new GetConferencesHandler(),
    getJournals: new GetJournalsHandler(),
    getWebsiteInfo: new GetWebsiteInfoHandler(),
    navigation: new NavigationHandler(),
    openGoogleMap: new OpenGoogleMapHandler(),
    followUnfollowItem: new FollowUnfollowItemHandler(),
    sendEmailToAdmin: new SendEmailToAdminHandler(), // Handles the confirmation step initiation
    // Add other function handlers here...

    // Explicit fallback handler (can be used if needed, but direct lookup failure is handled below)
    '__unknown__': new UnknownFunctionHandler(),
};

/**
 * Looks up and executes the appropriate function handler based on the LLM's function call.
 * Handles status updates via the provided callback and manages execution errors.
 *
 * @param functionCall The function call object { name: string; args: any } from the LLM.
 * @param handlerId A unique identifier for the parent process handling this interaction.
 * @param language The current language context.
 * @param onStatusUpdate A callback function to send status updates back to the orchestrator.
 * @param socket The Socket.IO client socket instance.
 * @param executionContext Optional context passed down from the caller (e.g., userToken from Agent Card).
 * @returns A Promise resolving to the FunctionHandlerOutput from the executed handler.
 */
export async function executeFunction(
    functionCall: { name: string; args: any },
    handlerId: string,
    language: Language,
    onStatusUpdate: (eventName: 'status_update', data: StatusUpdate) => boolean,
    socket: Socket,
    executionContext?: any // Optional context from caller (like AgentCard context)
): Promise<FunctionHandlerOutput> {

    const functionName = functionCall.name;
    const args = functionCall.args || {}; // Ensure args is an object
    const socketId = socket.id;
    // Prefer token from executionContext if available (e.g., from AgentCard), otherwise fallback to socket data
    const userToken = executionContext?.userToken ?? (socket.data.token as string | null);
    const logPrefix = `[${handlerId} ${socketId}]`;

    logToFile(`${logPrefix} FunctionRegistry: Received request for function: ${functionName}`);

    // 1. Initial Status Update & Disconnect Check
    // Inform the orchestrator that a function call is being attempted.
    if (!onStatusUpdate('status_update', {
        type: 'status',
        step: 'function_call_received', // Renamed step for clarity
        message: `Executing function: ${functionName}`,
        details: { functionName, argsPreview: JSON.stringify(args).substring(0, 100) + '...' },
        timestamp: new Date().toISOString()
    })) {
        // If the callback returns false, it typically means the client disconnected.
        logToFile(`${logPrefix} FunctionRegistry: Aborting execution - Client disconnected (onStatusUpdate returned false).`);
        return {
            modelResponseContent: "Error: Could not execute function because the client disconnected.",
            frontendAction: undefined
        };
    }

    // 2. Handler Lookup
    const handler = functionRegistry[functionName];

    // 3. Handle Unknown Function
    if (!handler) {
        const errorMsg = `Function "${functionName}" is not recognized or implemented.`;
        logToFile(`${logPrefix} FunctionRegistry Error: ${errorMsg}`);
        // Send a specific status update for unknown function
        onStatusUpdate('status_update', {
            type: 'status',
            step: 'unknown_function',
            message: `Error: ${errorMsg}`,
            details: { functionName },
            timestamp: new Date().toISOString()
        });
        // Return an error message suitable for the LLM
        return {
            modelResponseContent: `Error: ${errorMsg}`,
            frontendAction: undefined
        };
        // Alternatively, you could use the UnknownFunctionHandler instance:
        // const unknownHandler = new UnknownFunctionHandler();
        // const context = { ... create context ... functionName }; // Pass functionName in context
        // return await unknownHandler.execute(context);
    }

    // 4. Execute Found Handler
    logToFile(`${logPrefix} FunctionRegistry: Executing handler for ${functionName}...`);
    try {
        const context: FunctionHandlerInput = {
            args: args,
            userToken: userToken,
            language: language,
            handlerId: handlerId,
            socketId: socketId,
            onStatusUpdate: onStatusUpdate,
            socket: socket,
            functionName: functionName,
            executionContext: executionContext
        };


        // --- Execute the handler ---
        const result = await handler.execute(context);
        // -------------------------

        const isErrorResult = result.modelResponseContent.toLowerCase().startsWith('error:');
        logToFile(`${logPrefix} FunctionRegistry: Execution finished for ${functionName}. Result indicates error: ${isErrorResult}`);

        // Send a final status update indicating the result processing stage
        onStatusUpdate('status_update', {
            type: 'status',
            step: 'function_result_processed', // Renamed step
            message: `Function ${functionName} execution completed${isErrorResult ? ' with error' : ''}.`,
            details: { functionName, success: !isErrorResult }, // Simple success check based on convention
            timestamp: new Date().toISOString()
        });

        return result; // Return the handler's output

    } catch (executionError: any) {
        // Catch unexpected errors *during* handler execution (not errors returned *by* the handler)
        const errorMsg = executionError instanceof Error ? executionError.message : String(executionError);
        logToFile(`${logPrefix} FunctionRegistry CRITICAL Error executing ${functionName}: ${errorMsg}\nStack: ${executionError.stack}`);

        // Send a critical error status update
        onStatusUpdate('status_update', {
            type: 'status',
            step: 'function_error', // Use a generic function error step
            message: `System error during execution of function ${functionName}.`,
            details: { functionName, error: errorMsg },
            timestamp: new Date().toISOString()
        });

        // Return an error output suitable for the LLM
        return {
            modelResponseContent: `Error: An unexpected system error occurred while trying to execute ${functionName}. (${errorMsg})`,
            frontendAction: undefined,
        };
    }
}