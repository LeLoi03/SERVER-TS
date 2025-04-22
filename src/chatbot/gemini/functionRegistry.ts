// src/chatbot/gemini/functionRegistry.ts
import { Socket } from 'socket.io';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, Language } from '../shared/types';
import logToFile from '../utils/logger';
import { StatusUpdate } from '../shared/types';

// Import all handlers
import { GetConferencesHandler } from '../handlers/getConferences.handler';
import { GetJournalsHandler } from '../handlers/getJournals.handler';
import { GetWebsiteInfoHandler } from '../handlers/getWebsiteInfo.handler';
import { NavigationHandler } from '../handlers/navigation.handler';
import { OpenGoogleMapHandler } from '../handlers/openGoogleMap.handler';
import { FollowUnfollowItemHandler } from '../handlers/followUnfollowItem.handler';
import { SendEmailToAdminHandler } from '../handlers/sendEmailToAdmin.handler';
// ... import other handlers as they are created

// Simple handler for unknown functions
class UnknownFunctionHandler implements IFunctionHandler {
    async execute(context: FunctionHandlerInput): Promise<FunctionHandlerOutput> {
        const functionName = context.args?.__functionName || 'unknown'; // Pass name if possible
        logToFile(`[${context.handlerId} ${context.socketId}] Error: Unknown function call requested: ${functionName}`);
        return {
            modelResponseContent: `Error: The requested function "${functionName}" is not available or not recognized by the system.`,
            frontendAction: undefined,
        };
    }
}

// Registry mapping function names to handlers
const functionRegistry: Record<string, IFunctionHandler> = {
    getConferences: new GetConferencesHandler(),
    getJournals: new GetJournalsHandler(),
    getWebsiteInfo: new GetWebsiteInfoHandler(),
    navigation: new NavigationHandler(),
    openGoogleMap: new OpenGoogleMapHandler(),
    followUnfollowItem: new FollowUnfollowItemHandler(),
    sendEmailToAdmin: new SendEmailToAdminHandler(),
    // Add other function names and their corresponding handlers here
    __unknown__: new UnknownFunctionHandler(), // Fallback handler
};

/**
 * Executes the appropriate function handler based on the function call name.
 *
 * @param functionCall The function call object from the LLM.
 * @param socket The socket object for emitting status updates.
 * @param handlerId The ID of the parent handler process.
 * @param language The current language.
 * @returns Promise<FunctionHandlerOutput> The result from the executed handler.
 */

export async function executeFunction(
    functionCall: { name: string; args: any },
    // socket: Socket, // Keep socket if handlers need it for non-status things
    handlerId: string,
    language: Language,
    // ADD the callback parameter
    onStatusUpdate: (eventName: 'status_update', data: StatusUpdate) => boolean,
    // Pass socket separately if needed by handlers for other reasons
    socket: Socket
): Promise<FunctionHandlerOutput> {

    // REMOVE internal safeEmitStatus helper from executeFunction

    const functionName = functionCall.name;
    const args = functionCall.args;
    const socketId = socket.id; // Get socketId from the passed socket
    const userToken = socket.data.token as string | null;

    logToFile(`[${handlerId} ${socketId}] FunctionRegistry: Attempting execution: ${functionName}`);

    // Use the passed-in onStatusUpdate callback
    if (!onStatusUpdate('status_update', { type: 'status', step: 'function_call', message: `Received request to call function: ${functionName}`, details: { functionName, args }, timestamp: new Date().toISOString() })) {
        logToFile(`[${handlerId} ${socketId}] FunctionRegistry: Failed to emit 'function_call' status via callback (maybe disconnected).`);
        // Decide if this is fatal. If the callback returns false, it implies disconnection.
        return { modelResponseContent: "Error: Client disconnected before function call initiation.", frontendAction: undefined };
    }

    const handler = functionRegistry[functionName]; // Use ?? functionRegistry.__unknown__ later if needed

    if (!handler) {
        logToFile(`[${handlerId} ${socketId}] Error: Unknown function: ${functionName}`);
        // Emit via callback
        onStatusUpdate('status_update', { type: 'status', step: 'unknown_function', message: `Error: Function "${functionName}" is not recognized.`, timestamp: new Date().toISOString() });
        return { modelResponseContent: `Error: The requested function "${functionName}" is not available.`, frontendAction: undefined };
    }

    try {
        const context: FunctionHandlerInput = {
            args: args,
            userToken,
            language,
            handlerId,
            socketId,
            onStatusUpdate, // Pass the callback down
            socket // Pass the socket down
        };

        // Execute the handler - IT will now use context.onStatusUpdate
        const result = await handler.execute(context);

        logToFile(`[${handlerId} ${socketId}] FunctionRegistry: Execution finished for ${functionName}.`);
        // Emit completion status *after* handler execution via callback
        onStatusUpdate('status_update', { type: 'status', step: 'processing_function_result', message: `Received result from ${functionName}.`, details: { success: !result.modelResponseContent.toLowerCase().startsWith('error:') }, timestamp: new Date().toISOString() });
        return result;

    } catch (execError: any) {
        logToFile(`[${handlerId} ${socketId}] CRITICAL Error executing handler for ${functionName}: ${execError.message}`);
        // Emit error via callback
        onStatusUpdate('status_update', { type: 'status', step: 'function_error', message: `System error during function execution (${functionName}).`, details: { error: execError.message }, timestamp: new Date().toISOString() });
        return {
            modelResponseContent: `Error encountered while trying to execute the function ${functionName}: ${execError.message}`,
            frontendAction: undefined,
        };
    }
}