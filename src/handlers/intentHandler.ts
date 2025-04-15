import { GenerationConfig, Tool, FunctionDeclaration, FunctionResponsePart } from "@google/generative-ai";
// Remove ExpressResponse import
import { Socket } from 'socket.io'; // Import Socket type
import logToFile from '../utils/logger';
import { HistoryItem, GeminiInteractionResult, StatusUpdate, ResultUpdate, ErrorUpdate, ThoughtStep } from '../shared/types';
import { GeminiService } from '../gemini/geminiService';
import {
    executeGetConferences,
    executeGetJournals,
    executeGetWebsiteInformation
} from './backendService'; // Assuming these DON'T need the socket to emit intermediate results
import { getConferencesDeclaration, getJournalsDeclaration, getWebsiteInformationDeclaration, systemInstructions } from "../gemini/functionDeclarations";
import dotenv from 'dotenv';

dotenv.config();

// --- Services, Tools, Config (Keep as is) ---
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const chatbotService = new GeminiService(GEMINI_API_KEY, "gemini-2.0-flash");

const functionDeclarations: FunctionDeclaration[] = [
    getConferencesDeclaration,
    getJournalsDeclaration,
    getWebsiteInformationDeclaration,
];
const tools: Tool[] = [{ functionDeclarations }];

const chatbotGenerationConfig: GenerationConfig = {
    temperature: 0.3,
    topP: 0.9,
    topK: 20,
    maxOutputTokens: 8192,
    responseMimeType: "text/plain",
};


// --- *** UPDATED Handler for Socket.IO *** ---

export async function handleUserInputStreaming(
    userInput: string,
    history: HistoryItem[],
    socket: Socket
): Promise<void> {
    const handlerId = `Handler-${Date.now()}`;
    const socketId = socket.id;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling input: "${userInput}" ---`);
    logToFile(`[${handlerId} History Check - Input] Received history with ${history.length} items.`);

    // *** Array to store the steps for this request ***
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
                data.thoughts = thoughts; // Attach the recorded steps
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
        // 0. Initial Status (will be added to thoughts by safeEmit)
        if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

          // 1. First call (status 'thinking' added to thoughts by safeEmit)
          logToFile(`--- [${handlerId} Socket ${socketId}] Turn 1: User Input to Model ---`);
          if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return;

        // --- CHECK CONNECTION BEFORE API CALL ---
        if (!socket.connected) {
            logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before initial Gemini call.`);
            return; // Stop processing
        }
        // --- END CHECK ---

        logToFile(`[${handlerId} History Check - Turn 1] Sending history with ${history.length} items to model.`);
        const initialResult: GeminiInteractionResult = await chatbotService.generateTurn(
            userInput, history, chatbotGenerationConfig, systemInstructions, tools
        );

        // --- CHECK CONNECTION AFTER API CALL ---
        if (!socket.connected) {
            logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after initial Gemini call.`);
            return;
        }
        // --- END CHECK ---

        // Check the result
        if (initialResult.status === "final_text") {
            // Status 'generating_response' added to thoughts
            safeEmit('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
            // Final result emission includes thoughts
            safeEmit('chat_result', { type: 'result', message: initialResult.text || "No response text." });
            return;

        } else if (initialResult.status === "error") {
            logToFile(`[${handlerId} Socket ${socketId}] Error in initial model call: ${initialResult.errorMessage}`);
            // Final error emission includes thoughts accumulated so far
            safeEmit('chat_error', { type: 'error', message: initialResult.errorMessage || "An error occurred contacting the AI model.", step: 'thinking' });
            return;

        } else if (initialResult.status === "requires_function_call" && initialResult.functionCall) {
            logToFile(`--- [${handlerId} Socket ${socketId}] Turn 2: Executing Function Call ---`);
            const functionCall = initialResult.functionCall;
            let functionResultContent: string;

            // Status 'function_call' added to thoughts, including details
            if(!safeEmit('status_update', {
                type: 'status',
                step: 'function_call',
                message: `Calling function: ${functionCall.name}...`,
                details: { functionName: functionCall.name, args: functionCall.args } // Pass details
            })) return;

            const historyForNextTurn: HistoryItem[] = [
                ...history,
                { role: 'user', parts: [{ text: userInput }] },
                { role: 'model', parts: [{ functionCall: functionCall }] }
            ];
            logToFile(`[${handlerId} History Check - Turn 2 Prep] Constructed historyForNextTurn with ${historyForNextTurn.length} items.`);

            // --- CHECK CONNECTION BEFORE FUNCTION EXECUTION ---
            if (!socket.connected) {
                logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before executing function ${functionCall.name}.`);
                return;
            }
            // --- END CHECK ---

            // 2. Execute the requested function
            try {
                switch (functionCall.name) {
                    case "getConferences":
                        // *** ADD STATUS UPDATE ***
                        if(!safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving conference data...' })) return;
                        functionResultContent = await executeGetConferences((functionCall.args as any).searchQuery);
                        break;
                    case "getJournals":
                        // *** ADD STATUS UPDATE ***
                        if(!safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving journal data...' })) return;
                        functionResultContent = await executeGetJournals((functionCall.args as any).searchQuery);
                        break;
                    case "getWebsiteInformation":
                         // Existing status update is already here - good!
                         safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving website information...' });
                         functionResultContent = await executeGetWebsiteInformation(/* Pass args if needed */);
                        break;
                    default:
                        logToFile(`[${handlerId} Socket ${socketId}] Error: Unknown function call requested: ${functionCall.name}`);
                        functionResultContent = `Error: The requested function "${functionCall.name}" is not available.`;
                        // Existing status update for unknown function name - good!
                        safeEmit('status_update', { type: 'status', step: 'function_error', message: `Function ${functionCall.name} is not recognized.` });
                }
                logToFile(`[${handlerId} Socket ${socketId}] Function ${functionCall.name} execution finished.`);

                // Check connection status again immediately after function execution
                if (!socket.connected) {
                    logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after function execution ${functionCall.name}.`);
                    return;
                }

                if (!safeEmit('status_update', { type: 'status', step: 'processing_function_result', message: `Processing result from ${functionCall.name}...` })) return;

                
           } catch (execError: any) {
                logToFile(`[${handlerId} Socket ${socketId}] Error executing function ${functionCall.name}: ${execError.message}`);
                if (socket.connected) {
                    // Optional: status 'function_error' added to thoughts
                    // safeEmit('status_update', { type: 'status', step: 'function_error', message: `Error during ${functionCall.name}...` });
                    // Final error emission includes thoughts accumulated so far
                    safeEmit('chat_error', { type: 'error', message: `Error during function execution: ${execError.message}`, step: 'function_call' });
                 } else {
                     logToFile(`[${handlerId} Socket ${socketId}] Client disconnected before function execution error could be sent.`);
                 }
                return; // Stop processing on error
            }

            // 3. Send the function response back to the model
            logToFile(`--- [${handlerId} Socket ${socketId}] Turn 3: Function Response to Model ---`);
             if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;

            const functionResponsePart: FunctionResponsePart = {
                 functionResponse: {
                     name: functionCall.name,
                     response: { content: functionResultContent }
                 }
             };

            // --- CHECK CONNECTION BEFORE FINAL API CALL ---
             if (!socket.connected) {
                 logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before final Gemini call.`);
                 return;
             }
            // --- END CHECK ---

            logToFile(`[${handlerId} History Check - Turn 3] Sending historyForNextTurn with ${historyForNextTurn.length} items + FunctionResponsePart to model.`);
            const finalResult: GeminiInteractionResult = await chatbotService.generateTurn(
                 [functionResponsePart],
                 historyForNextTurn,
                 chatbotGenerationConfig,
                 systemInstructions,
                 tools
             );

             // --- CHECK CONNECTION AFTER FINAL API CALL ---
              if (!socket.connected) {
                  logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after final Gemini call.`);
                  return;
              }
             // --- END CHECK ---

            // 4. Process the final response from the model
            if (finalResult.status === "final_text") {
                logToFile(`[${handlerId} Socket ${socketId}] Preparing to send final text result (After Function Call).`);
                safeEmit('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                safeEmit('chat_result', { type: 'result', message: finalResult.text || "No final response text." });
                logToFile(`[${handlerId} Socket ${socketId}] Sent final text result (After Function Call).`);
                return;

            } else if (finalResult.status === "requires_function_call") {
                logToFile(`[${handlerId} Socket ${socketId}] Error: Model requested another function call unexpectedly after Turn 3.`);
                const errMsg = "Unexpected AI response: The AI requested another action instead of providing a final answer.";
                safeEmit('chat_error', { type: 'error', message: errMsg, step: 'thinking' });
                return;

            } else { // Error status from final call
                logToFile(`[${handlerId} Socket ${socketId}] Error in final model call: ${finalResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: finalResult.errorMessage || "An error occurred while getting the final response from the AI.", step: 'thinking' });
                return;
            }

        } else {
            logToFile(`[${handlerId} Socket ${socketId}] Error: Unexpected initial result status: ${JSON.stringify(initialResult)}`);
            safeEmit('chat_error', { type: 'error', message: "An unexpected internal error occurred (invalid initial status).", step: 'processing_input' });
            return;
        }

    } catch (error: any) {
        // Catch critical errors *within* the handler's main flow
        logToFile(`[${handlerId} Socket ${socketId}] CRITICAL Error in handleUserInputStreaming: ${error.message}, Stack: ${error.stack}`);
         // Check connection before sending error
         if (socket.connected) {
              safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred during processing.", step: 'unknown' });
         } else {
              logToFile(`[${handlerId} Socket ${socketId}] Client disconnected before critical error could be sent.`);
         }
    } finally {
         // Log completion of this specific handler invocation
         logToFile(`--- [${handlerId} Socket ${socketId}] Handler execution path finished for input: "${userInput}" (Socket connected: ${socket.connected}) ---`);
    }
}