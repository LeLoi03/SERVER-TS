// src/handlers/intentHandler.ts
import {
    GenerationConfig, Tool, FunctionDeclaration, FunctionResponsePart, Part, // Import Part
} from "@google/generative-ai";
import { Socket } from 'socket.io';
import logToFile from '../utils/logger';
import {
    HistoryItem, GeminiInteractionResult, StatusUpdate, ResultUpdate, ErrorUpdate, ThoughtStep, // Make sure HistoryItem uses Part[]
} from '../shared/types'; // Adjust path
import { GeminiService } from '../gemini/geminiService'; // Adjust path
import {
    executeGetConferences,
    executeGetJournals,
    executeGetWebsiteInformation
} from './backendService'; // Adjust path
import { getConferencesDeclaration, getJournalsDeclaration, getWebsiteInformationDeclaration, systemInstructions } from "../gemini/functionDeclarations"; // Adjust path
import { loadModelConfig } from '../gemini/configLoader'; // Adjust path

// --- Services, Tools, Config ---
const chatbotService = new GeminiService(process.env.GEMINI_API_KEY || "", "gemini-1.5-flash-latest"); // Ensure API Key and Model Name are set

const functionDeclarations: FunctionDeclaration[] = [
    getConferencesDeclaration,
    getJournalsDeclaration,
    getWebsiteInformationDeclaration,
];
const tools: Tool[] = [{ functionDeclarations }];

// Use loadModelConfig
const chatbotConfigPrefix = "CHATBOT"; // Or your chosen prefix
const chatbotGenerationConfig: GenerationConfig = loadModelConfig(chatbotConfigPrefix);


// --- *** UPDATED Handler for Socket.IO *** ---

export async function handleUserInputStreaming(
    userInput: string,
    currentHistoryFromSocket: HistoryItem[], // Receive current history
    socket: Socket
): Promise<HistoryItem[] | void> { // Return updated history or void on failure
    const handlerId = `Handler-${Date.now()}`;
    const socketId = socket.id;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling input: "${userInput}" ---`);

    // *** Create a mutable copy of the history for this request ***
    let history: HistoryItem[] = [...currentHistoryFromSocket];
    logToFile(`[${handlerId} History Check - Input] Received history with ${history.length} items.`);

    // Array to store thoughts *for this specific request*
    const thoughts: ThoughtStep[] = [];

    // Updated helper to also collect thoughts
    const safeEmit = (
        eventName: 'status_update' | 'chat_result' | 'chat_error',
        data: StatusUpdate | ResultUpdate | ErrorUpdate
    ): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] SKIPPED: Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            // *** Collect thought if it's a status update ***
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({
                    step: data.step,
                    message: data.message,
                    timestamp: new Date().toISOString(),
                    details: (data as StatusUpdate).details // Capture details if provided
                });
            }

            // *** Add accumulated thoughts to final result/error ***
            if (eventName === 'chat_result' || eventName === 'chat_error') {
                data.thoughts = thoughts; // Attach thoughts specific to this request
            }

            socket.emit(eventName, data);
            logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] FAILED: Error during emit. Event: ${eventName}, Error: ${error.message}`);
            return false;
        }
    };

    try {
        // 0. Initial Status
        if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return; // Don't return history yet

        // *** Append the current user input to the working history ***
        const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
        history.push(userTurn);
        logToFile(`[${handlerId} History Check - Turn 1 Prep] History now has ${history.length} items after adding user input.`);

        // 1. First call to Model
        logToFile(`--- [${handlerId} Socket ${socketId}] Turn 1: Sending to Model ---`);
        if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return; // Don't return history yet

        if (!socket.connected) {
            logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before initial Gemini call.`);
            return; // Cannot proceed, don't return history as state is incomplete
        }

        logToFile(`[${handlerId} History Check - Turn 1 Send] Sending history with ${history.length} items to model.`);
        // Call generateTurn with the updated history. The first argument (prompt parts) is often empty
        // when the main prompt is in the history or system instructions.
        const initialResult: GeminiInteractionResult = await chatbotService.generateTurn(
            [], // No separate prompt parts needed here
            history, // Pass the full, updated history
            chatbotGenerationConfig,
            systemInstructions,
            tools
        );

        if (!socket.connected) {
            logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after initial Gemini call.`);
            return; // Incomplete state
        }

        // Check the result
        if (initialResult.status === "final_text") {
            safeEmit('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
            const modelResponseText = initialResult.text || "No response text.";
            const modelTurn: HistoryItem = { role: 'model', parts: [{ text: modelResponseText }] };
            history.push(modelTurn); // Append model's response to history
            logToFile(`[${handlerId} History Check - Turn 1 Done] Appended model response. History size: ${history.length}`);
            safeEmit('chat_result', { type: 'result', message: modelResponseText });
            return history; // <<< RETURN updated history

        } else if (initialResult.status === "error") {
            logToFile(`[${handlerId} Socket ${socketId}] Error in initial model call: ${initialResult.errorMessage}`);
            safeEmit('chat_error', { type: 'error', message: initialResult.errorMessage || "An error occurred contacting the AI model.", step: 'thinking' });
            // Optionally append an error marker to history? Generally not needed for API history.
            return history; // <<< RETURN history up to the point of error

        } else if (initialResult.status === "requires_function_call" && initialResult.functionCall) {
            logToFile(`--- [${handlerId} Socket ${socketId}] Turn 2: Processing Function Call ---`);
            const functionCall = initialResult.functionCall;

            // *** Append the model's function call request to history ***
            const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
            history.push(modelFunctionCallTurn);
            logToFile(`[${handlerId} History Check - Turn 2 Prep] Appended model function call. History size: ${history.length}`);

            let functionResultContent: string;


            if (!safeEmit('status_update', {
                type: 'status',
                step: 'function_call',
                message: `Calling function: ${functionCall.name}...`,
                details: { functionName: functionCall.name, args: functionCall.args }
            })) return;

            // const historyForNextTurn: HistoryItem[] = [
            //     ...history,
            //     { role: 'user', parts: [{ text: userInput }] },
            //     { role: 'model', parts: [{ functionCall: functionCall }] }
            // ];
            // logToFile(`[${handlerId} History Check - Turn 2 Prep] Constructed historyForNextTurn with ${historyForNextTurn.length} items.`);

            if (!socket.connected) {
                logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before executing function ${functionCall.name}.`);
                return;
            }

            try {
                switch (functionCall.name) {
                    case "getConferences":
                        if (!safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving conference data...' })) return;
                        functionResultContent = await executeGetConferences((functionCall.args as any).searchQuery);
                        break;
                    case "getJournals":
                        if (!safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving journal data...' })) return;
                        functionResultContent = await executeGetJournals((functionCall.args as any).searchQuery);
                        break;
                    case "getWebsiteInformation":
                        safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving website information...' });
                        functionResultContent = await executeGetWebsiteInformation(/* Pass args if needed */);
                        break;
                    default:
                        logToFile(`[${handlerId} Socket ${socketId}] Error: Unknown function call requested: ${functionCall.name}`);
                        functionResultContent = `Error: The requested function "${functionCall.name}" is not available.`;
                        safeEmit('status_update', { type: 'status', step: 'function_error', message: `Function ${functionCall.name} is not recognized.` });
                }
                logToFile(`[${handlerId} Socket ${socketId}] Function ${functionCall.name} execution finished.`);

                if (!socket.connected) {
                    logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after function execution ${functionCall.name}.`);
                    return;
                }

                if (!safeEmit('status_update', { type: 'status', step: 'processing_function_result', message: `Processing result from ${functionCall.name}...` })) return;


            } catch (execError: any) {
                logToFile(`[${handlerId} Socket ${socketId}] Error executing function ${functionCall.name}: ${execError.message}`);
                // Optionally create a function response indicating the error for the model?
                // functionResultContent = `Error executing function ${functionCall.name}: ${execError.message}`;
                // Or just emit error to client and return history as is.
                if (socket.connected) {
                    safeEmit('chat_error', { type: 'error', message: `Error during function execution: ${execError.message}`, step: 'function_call' });
                } else {
                    logToFile(`[${handlerId} Socket ${socketId}] Client disconnected before function execution error could be sent.`);
                    // Don't append a function *response* part if execution failed catastrophically? Or send error back to model?
                    // Decision point: For now, return history *before* attempting function response.
                    return history; // <<< RETURN history up to the failed function execution
                }
                return;
            }

            logToFile(`--- [${handlerId} Socket ${socketId}] Turn 3: Function Response to Model ---`);
            // if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;

            // *** Append the function execution result to history ***
            const functionResponsePart: FunctionResponsePart = {
                functionResponse: {
                    name: functionCall.name,
                    response: { content: functionResultContent } // Send result (or error string) back
                }
            };
            const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
            history.push(functionTurn);
            logToFile(`[${handlerId} History Check - Turn 3 Prep] Appended function response. History size: ${history.length}`);


            if (!socket.connected) {
                logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before final Gemini call.`);
                return;
            }

            // 3. Send the function response back to the model
            logToFile(`--- [${handlerId} Socket ${socketId}] Turn 3: Sending Function Response to Model ---`);
            if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return; // Incomplete

            if (!socket.connected) {
                logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after final Gemini call.`);
                return;
            }

            logToFile(`[${handlerId} History Check - Turn 3 Send] Sending history with ${history.length} items to model.`);
            // Call generateTurn with the updated history (which now includes user, model FC, function response)
            const finalResult: GeminiInteractionResult = await chatbotService.generateTurn(
                [], // No separate prompt parts needed
                history, // Pass the full, updated history
                chatbotGenerationConfig,
                systemInstructions,
                tools // Still provide tools in case of multi-turn functions (though less common)
            );

            if (!socket.connected) {
                logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after final Gemini call.`);
                return;
            }


            // 4. Process the final response from the model
            if (finalResult.status === "final_text") {
                logToFile(`[${handlerId} Socket ${socketId}] Preparing to send final text result (After Function Call).`);
                safeEmit('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = finalResult.text || "No final response text.";
                const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }] };
                history.push(finalModelTurn); // Append final model response
                logToFile(`[${handlerId} History Check - Turn 3 Done] Appended final model response. History size: ${history.length}`);
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText });
                return history; // <<< RETURN final updated history

            } else if (finalResult.status === "requires_function_call") {
                // This might indicate an issue or a complex multi-turn scenario not fully handled.
                logToFile(`[${handlerId} Socket ${socketId}] Error: Model requested *another* function call unexpectedly after Turn 3.`);
                const errMsg = "Unexpected AI response: The AI requested another action instead of providing a final answer.";
                // Append the unexpected function call to history? Or just error out?
                // const unexpectedModelTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCall }] };
                // history.push(unexpectedModelTurn);
                safeEmit('chat_error', { type: 'error', message: errMsg, step: 'thinking' });
                return history; // Return history up to the unexpected state

            } else { // Error status from final call
                logToFile(`[${handlerId} Socket ${socketId}] Error in final model call: ${finalResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: finalResult.errorMessage || "An error occurred while getting the final response from the AI.", step: 'thinking' });
                return history; // Return history up to the error
            }

        } else {
            // Should not happen with current GeminiInteractionResult statuses
            logToFile(`[${handlerId} Socket ${socketId}] Error: Unexpected initial result status: ${JSON.stringify(initialResult)}`);
            safeEmit('chat_error', { type: 'error', message: "An unexpected internal error occurred (invalid initial status).", step: 'processing_input' });
            return history; // Return history as is
        }

    } catch (error: any) {
        // Catch critical errors *within* the handler's main flow
        logToFile(`[${handlerId} Socket ${socketId}] CRITICAL Error in handleUserInputStreaming: ${error.message}, Stack: ${error.stack}`);
        if (socket.connected) {
            // Pass accumulated thoughts before the crash
            safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred during processing.", step: 'unknown' });
        } else {
            logToFile(`[${handlerId} Socket ${socketId}] Client disconnected before critical error could be sent.`);
        }
        // Return the history state just before the crash, or potentially void/undefined
        // depending on how unrecoverable the state is. Returning history is safer.
        return history;
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId}] Handler execution path finished for input: "${userInput}" (Socket connected: ${socket.connected}) ---`);
    }
    // Fallback return (should ideally be unreachable if all paths return)
    // return history;
}