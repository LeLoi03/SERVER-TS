// src/chatbot/gemini/functionRegistry.ts
import { Socket } from 'socket.io';
import { IFunctionHandler } from '../interface/functionHandler.interface'; // Điều chỉnh đường dẫn nếu cần
import {
    FunctionHandlerInput,
    FunctionHandlerOutput, // Không cần chứa 'thoughts' trong định nghĩa này nữa
    Language,
    StatusUpdate,
    AgentId
} from '../shared/types'; // Điều chỉnh đường dẫn nếu cần
import logToFile from '../../utils/logger'; // Điều chỉnh đường dẫn nếu cần

// --- Import Handlers ---
import { GetConferencesHandler } from '../handlers/getConferences.handler';
import { GetJournalsHandler } from '../handlers/getJournals.handler';
import { GetWebsiteInfoHandler } from '../handlers/getWebsiteInfo.handler';
import { NavigationHandler } from '../handlers/navigation.handler';
import { OpenGoogleMapHandler } from '../handlers/openGoogleMap.handler';
import { ManageFollowHandler } from '../handlers/manageFollow.handler';
import { ManageCalendarHandler } from '../handlers/manageCalendar.handler';

import { SendEmailToAdminHandler } from '../handlers/sendEmailToAdmin.handler';
// ... import other handlers ...

// --- Unknown Function Handler (Có thể không cần nếu xử lý inline) ---
// class UnknownFunctionHandler implements IFunctionHandler { /* ... */ }

// --- Function Registry ---
const functionRegistry: Record<string, IFunctionHandler> = {
    getConferences: new GetConferencesHandler(),
    getJournals: new GetJournalsHandler(),
    getWebsiteInfo: new GetWebsiteInfoHandler(),
    navigation: new NavigationHandler(),
    openGoogleMap: new OpenGoogleMapHandler(),
    manageFollow: new ManageFollowHandler(),
    manageCalendar: new ManageCalendarHandler(),
    sendEmailToAdmin: new SendEmailToAdminHandler(),
    // '__unknown__': new UnknownFunctionHandler(),
};

/**
 * Looks up and executes the appropriate function handler.
 * Status updates are sent via onStatusUpdate, which is also used by the caller to collect ThoughtSteps.
 *
 * @param functionCall The LLM's function call.
 * @param callingAgentId ID of the agent (e.g., 'ConferenceAgent') making this function call.
 * @param handlerProcessId Unique ID for this specific execution process.
 * @param language Current language.
 * @param onStatusUpdate Callback to send StatusUpdate (caller uses this to generate ThoughtSteps & emit to FE).
 * @param socket Client socket.
 * @param executionContext Optional context.
 * @returns Promise<FunctionHandlerOutput> (modelResponseContent, frontendAction).
 */
export async function executeFunction(
    functionCall: { name: string; args: any },
    callingAgentId: AgentId,
    handlerProcessId: string,
    language: Language,
    onStatusUpdate: (eventName: 'status_update', data: StatusUpdate) => boolean,
    socket: Socket,
    executionContext?: any
): Promise<FunctionHandlerOutput> {

    const functionName = functionCall.name;
    const args = functionCall.args || {};
    const socketId = socket.id;
    const userToken = executionContext?.userToken ?? (socket.data.token as string | null);
    const logPrefix = `[${handlerProcessId} ${socketId} Agent:${callingAgentId} FuncRegistry Func:${functionName}]`;

    logToFile(`${logPrefix} Received request.`);

    // Helper to report a step FOR FUNCTION REGISTRY ITSELF
    // These steps are initiated by the callingAgentId
    const reportRegistryStep = (stepKey: string, message: string, details?: any): boolean => {
        const timestamp = new Date().toISOString();
        return onStatusUpdate('status_update', {
            type: 'status',
            step: stepKey,
            message,
            details,
            timestamp,
            agentId: callingAgentId // Steps taken by the registry are under the calling agent
        });
    };

    // 1. Initial Status Update & Disconnect Check
    if (!reportRegistryStep('function_call_received', `Preparing to execute function: ${functionName}`,
        { argsPreview: JSON.stringify(args).substring(0, 100) + '...' }
    )) {
        logToFile(`${logPrefix} Aborting - Client disconnected (onStatusUpdate for 'function_call_received' returned false).`);
        return { // Không cần 'thoughts' ở đây, reportRegistryStep đã kích hoạt onStatusUpdate
            modelResponseContent: "Error: Could not execute function because the client disconnected.",
            frontendAction: undefined
        };
    }

    // 2. Handler Lookup
    const handler = functionRegistry[functionName];

    // 3. Handle Unknown Function
    if (!handler) {
        const errorMsg = `Function "${functionName}" is not recognized or implemented in the registry.`;
        logToFile(`${logPrefix} Error: ${errorMsg}`);
        reportRegistryStep('unknown_function', `Error: ${errorMsg}`, { functionNameAttempted: functionName });
        return { // Không cần 'thoughts'
            modelResponseContent: `Error: ${errorMsg}`,
            frontendAction: undefined
        };
    }

    // 4. Execute Found Handler
    logToFile(`${logPrefix} Executing handler...`);
    try {
        const context: FunctionHandlerInput = {
            args: args,
            userToken: userToken,
            language: language,
            handlerId: handlerProcessId,      // ID of this specific process
            socketId: socketId,
            // Pass onStatusUpdate directly. The handler is responsible for setting its own agentId
            // in the StatusUpdate it creates when calling this callback.
            onStatusUpdate: onStatusUpdate,
            socket: socket,
            functionName: functionName,
            executionContext: executionContext,
            agentId: callingAgentId           // The agent responsible for this function call
        };

        // The handler will call `onStatusUpdate` for its internal steps.
        // `onStatusUpdate` (which is `onSubAgentFunctionStatusUpdate` from `callSubAgent`)
        // will then create ThoughtSteps and emit to frontend.
        const resultFromHandler: FunctionHandlerOutput = await handler.execute(context);

        const isErrorResult = resultFromHandler.modelResponseContent.toLowerCase().startsWith('error:');
        logToFile(`${logPrefix} Handler execution finished. Result indicates error: ${isErrorResult}`);

        reportRegistryStep('function_result_processed',
            `Function handler for "${functionName}" completed${isErrorResult ? ' with error' : ''}.`,
            { success: !isErrorResult, resultPreview: resultFromHandler.modelResponseContent.substring(0, 100) + '...' }
        );

        return resultFromHandler; // Contains modelResponseContent and frontendAction

    } catch (executionError: any) {
        // This catch block is for UNEXPECTED errors *during the execution of the handler itself*,
        // not for errors *returned by* the handler (which should be part of resultFromHandler.modelResponseContent).
        const errorMsg = executionError instanceof Error ? executionError.message : String(executionError);
        logToFile(`${logPrefix} CRITICAL Error during handler execution: ${errorMsg}\nStack: ${executionError.stack}`);

        reportRegistryStep('function_execution_critical_error',
            `System error during execution of function ${functionName}: ${errorMsg}`,
            { error: errorMsg, stackPreview: executionError.stack?.substring(0,200) }
        );

        return { // Không cần 'thoughts'
            modelResponseContent: `Error: An unexpected system error occurred while trying to execute ${functionName}. (${errorMsg})`,
            frontendAction: undefined,
        };
    }
}