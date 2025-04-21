// src/function-calling/functionRegistry.ts
import { Socket } from 'socket.io';
import { IFunctionHandler } from '../interface/functionHandler.interface';
import { FunctionHandlerInput, FunctionHandlerOutput, Language } from '../shared/types';
import logToFile from '../utils/logger';

// Import all handlers
import { GetConferencesHandler } from '../handlers/getConferences.handler';
import { GetJournalsHandler } from '../handlers/getJournals.handler';
import { GetWebsiteInfoHandler } from '../handlers/getWebsiteInfo.handler';
import { NavigationHandler } from '../handlers/navigation.handler';
import { OpenGoogleMapHandler } from '../handlers/openGoogleMap.handler';
import { FollowUnfollowItemHandler } from '../handlers/followUnfollowItem.handler';
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
    getWebsiteInformation: new GetWebsiteInfoHandler(),
    navigation: new NavigationHandler(),
    openGoogleMap: new OpenGoogleMapHandler(),
    followUnfollowItem: new FollowUnfollowItemHandler(),
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
    socket: Socket, // Pass the full socket
    handlerId: string,
    language: Language
): Promise<FunctionHandlerOutput> {

    // Emit status *before* executing the specific handler
    const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} ${socketId}] ExecuteFunction SKIPPED Status Emit: Client disconnected. Event: status_update (${step})`);
            return false;
        }
        try {
            socket.emit('status_update', { type: 'status', step, message, details });
            logToFile(`[${handlerId} ${socketId}] ExecuteFunction Status Emit Sent: Step: ${step}, Message: ${message}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} ${socketId}] ExecuteFunction Status Emit FAILED: Step: ${step}, Error: ${error.message}`);
            return false;
        }
    };

    const functionName = functionCall.name;
    const args = functionCall.args;
    const socketId = socket.id;
    const userToken = socket.data.token as string | null; // Retrieve token here

    logToFile(`[${handlerId} ${socketId}] FunctionRegistry: Attempting to execute function: ${functionName} (Authenticated: ${!!userToken})`);

    // Initial Step: Decision made to call this function
    if (!safeEmitStatus('function_call', `Received request to call function: ${functionName}`, { functionName: functionName, args: args })) {
        return { modelResponseContent: "Error: Client disconnected before function call initiation.", frontendAction: undefined };
    }

    const handler = functionRegistry[functionName] ?? functionRegistry.__unknown__;


    if (!handler) {
        logToFile(`[${handlerId} ${socketId}] Error: Unknown function call requested: ${functionName}`);
        safeEmitStatus('unknown_function', `Error: Function "${functionName}" is not recognized.`); // Specific step for unknown
        return { modelResponseContent: `Error: The requested function "${functionName}" is not available.`, frontendAction: undefined };
    }



    try {
        const context: FunctionHandlerInput = {
            args: handler === functionRegistry.__unknown__ ? { ...args, __functionName: functionName } : args, // Add name for unknown handler
            userToken,
            language,
            handlerId,
            socketId,
            socket // Pass socket for potential *internal* status updates within handler
        };

        // Execute the handler
        const result = await handler.execute(context);

        logToFile(`[${handlerId} ${socketId}] FunctionRegistry: Execution finished for ${functionName}. Result: Content Length=${result.modelResponseContent.length}, Action=${JSON.stringify(result.frontendAction)}`);
        // Emit completion status *after* handler execution
        safeEmitStatus('processing_function_result', `Received result from ${functionName}.`, { success: !result.modelResponseContent.toLowerCase().startsWith('error:') }); // Add success hint maybe
        return result;

    } catch (execError: any) {
        logToFile(`[${handlerId} ${socketId}] CRITICAL Error executing function handler for ${functionName}: ${execError.message}, Stack: ${execError.stack}`);
        safeEmitStatus('function_error', `System error during function execution (${functionName}).`, { error: execError.message });

        // Return an error message for the model
        return {
            modelResponseContent: `Error encountered while trying to execute the function ${functionName}: ${execError.message}`,
            frontendAction: undefined, // Ensure no action on critical error
        };
    }
}