// src/handlers/intentHandler.ts
import {
    GenerationConfig,
    Tool,
    FunctionDeclaration,
    FunctionResponsePart,
    EnhancedGenerateContentResponse, // If used by geminiService
} from "@google/generative-ai";
import { Socket } from 'socket.io';
import logToFile from '../utils/logger'; // Adjust path as needed
import {
    HistoryItem,
    GeminiInteractionResult,
    StatusUpdate,
    ResultUpdate,
    ErrorUpdate,
    ThoughtStep,
    ChatUpdate,
    ChatAction,       // <<< Import ChatAction
    Language,         // <<< Import Language type
} from '../shared/types'; // Adjust path as needed
import { GeminiService } from '../gemini/geminiService'; // Adjust path as needed
import {
    executeGetConferences,
    executeGetJournals,
    executeGetWebsiteInformation,

    // executeDrawChart // Uncomment if you have this backend function
} from './backendService'; // Adjust path as needed
import { loadModelConfig } from '../gemini/configLoader'; // Adjust path as needed
import { getLanguageConfig } from '../utils/languageConfig'; // <<< Import language helpers
import { ApiCallResult } from './backendService'; // <<< Import the new type

// --- Services & Base Config ---
// Consider making the model name configurable per handler if needed
const chatbotService = new GeminiService(process.env.GEMINI_API_KEY || "", process.env.CHATBOT_MODEL_NAME || "gemini-2.0-flash");
const chatbotConfigPrefix = "CHATBOT"; // Assuming a config prefix for chatbot settings
const chatbotGenerationConfig: GenerationConfig = loadModelConfig(chatbotConfigPrefix);

// --- Helper Function: Execute Function Call (REVISED - Simplified getConf/getJourn) ---
async function executeFunctionCall(
    functionCall: { name: string; args: any; },
    socket: Socket,
    handlerId: string,
    language: Language
): Promise<{ modelResponseContent: string, frontendAction?: ChatAction }> {

    const declaredFunctionName = functionCall.name;
    let modelResponseContent: string = ''; // Content to send BACK TO THE MODEL
    let frontendAction: ChatAction | undefined = undefined; // Action for the FRONTEND (ONLY set for 'navigation')
    const socketId = socket.id;

    const safeEmitStatus = (step: string, message: string, details?: any): boolean => {
        // ... (safeEmitStatus implementation remains the same) ...
        if (!socket.connected) {
            logToFile(`[${handlerId} ${socketId}] ExecuteFunctionCall SKIPPED Status Emit: Client disconnected. Event: status_update (${step})`);
            return false;
        }
        try {
            socket.emit('status_update', { type: 'status', step, message, details });
            logToFile(`[${handlerId} ${socketId}] ExecuteFunctionCall Status Emit Sent: Step: ${step}, Message: ${message}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} ${socketId}] ExecuteFunctionCall Status Emit FAILED: Step: ${step}, Error: ${error.message}`);
            return false;
        }
    };

    logToFile(`[${handlerId} ${socketId}] Executing backend logic for declared function: ${declaredFunctionName}`);
    if (!safeEmitStatus('function_call', `Calling function: ${declaredFunctionName}...`, { functionName: declaredFunctionName, args: functionCall.args })) {
        return { modelResponseContent: "Error: Could not initiate function call processing.", frontendAction: undefined };
    }

    try {
        const backendFunctionName = declaredFunctionName;

        switch (backendFunctionName) {
            case "getConferences":
            case "getJournals": {
                const isConference = backendFunctionName === "getConferences";
                const dataType = isConference ? "conference" : "journal";
                const searchQuery = (functionCall.args as any)?.searchQuery;

                if (!safeEmitStatus('retrieving_info', `Retrieving ${dataType} data...`)) return { modelResponseContent: "Error: Disconnected during function execution.", frontendAction: undefined };

                // --- Execute the service call ---
                const apiResult: ApiCallResult = isConference
                    ? await executeGetConferences(searchQuery) // backendService returns ApiCallResult
                    : await executeGetJournals(searchQuery);   // backendService returns ApiCallResult

                logToFile(`[${handlerId} ${socketId}] API result for ${backendFunctionName}('${searchQuery}'): Success=${apiResult.success}, FormattedData=${apiResult.formattedData !== null}, ErrorMsg=${apiResult.errorMessage}`);

                // --- Set modelResponseContent based on API result ---
                if (apiResult.success) {
                    // **IMPORTANT:** Use formattedData if available, otherwise use rawData (which might be JSON or error)
                    // In your case, formattedData should be the Markdown string from backendService
                    modelResponseContent = apiResult.formattedData ?? apiResult.rawData;
                    if (apiResult.formattedData === null) {
                        logToFile(`[${handlerId} ${socketId}] Warning: Formatted data is null for ${dataType}. Sending raw data or error message back to model.`);
                        if (apiResult.errorMessage) { // Prefer specific error message if transformation failed
                            modelResponseContent = apiResult.errorMessage;
                            safeEmitStatus('function_warning', `Data formatting issue for ${dataType}.`);
                        }
                    }
                } else {
                    // API call failed
                    modelResponseContent = apiResult.errorMessage || `Failed to retrieve ${dataType} data.`;
                    safeEmitStatus('function_error', `API call failed for ${dataType}.`);
                }
                // *** CRITICAL: frontendAction MUST be undefined here ***
                frontendAction = undefined;
                logToFile(`[${handlerId} ${socketId}] getConferences/getJournals finished. Sending content (length ${modelResponseContent.length}) back to model. NO frontendAction prepared.`);
                break; // End of combined getConferences/getJournals case
            }

            case "getWebsiteInformation": {
                if (!safeEmitStatus('retrieving_info', 'Retrieving website information...')) return { modelResponseContent: "Error: Disconnected during function execution.", frontendAction };
                const info = await executeGetWebsiteInformation(); // Assumes this returns string
                modelResponseContent = info;
                frontendAction = undefined;
                break;
            }

            // --- NAVIGATION CASE (Logic remains correct here) ---
            case "navigation": {
                logToFile(`[${handlerId} ${socketId}] Handling navigation function.`);
                const targetUrl = (functionCall.args as any)?.url;

                if (targetUrl && typeof targetUrl === 'string' && (targetUrl.startsWith('/') || targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
                    logToFile(`[${handlerId} ${socketId}] Valid target URL for navigation: ${targetUrl}`);
                    // *** PREPARE ACTION HERE ***
                    frontendAction = { type: 'navigate', url: targetUrl };
                    // *** SET CONFIRMATION MESSAGE FOR MODEL ***
                    modelResponseContent = `Navigation action acknowledged. The user will be directed to the requested page (${targetUrl}).`;
                    safeEmitStatus('action_prepared', 'Navigation action prepared.');
                } else {
                    logToFile(`[${handlerId} ${socketId}] Error: Invalid or missing 'url' argument for navigation: ${targetUrl}`);
                    modelResponseContent = `Error: Invalid or missing 'url' argument provided for navigation. URL must start with '/' or 'http(s)://'. Received: ${targetUrl}`;
                    safeEmitStatus('function_error', 'Invalid navigation URL provided.');
                    frontendAction = undefined;
                }
                break;
            }
            // --- END NAVIGATION CASE ---


            // <<< NEW CASE for openGoogleMap >>>
            case "openGoogleMap": {
                logToFile(`[${handlerId} ${socketId}] Handling openGoogleMap function.`);
                const location = (functionCall.args as any)?.location;

                if (location && typeof location === 'string' && location.trim() !== '') {
                    const trimmedLocation = location.trim();
                    logToFile(`[${handlerId} ${socketId}] Valid location string: ${trimmedLocation}`);
                    // Prepare frontend action
                    frontendAction = { type: 'openMap', location: trimmedLocation };
                    // Prepare confirmation message for model
                    modelResponseContent = `Map action acknowledged. Google Maps will be opened for the location: "${trimmedLocation}".`;
                    safeEmitStatus('action_prepared', 'Google Maps action prepared.');
                } else {
                    logToFile(`[${handlerId} ${socketId}] Error: Invalid or missing 'location' argument for openGoogleMap: ${location}`);
                    modelResponseContent = `Error: Invalid or missing 'location' argument provided for opening Google Maps.`;
                    safeEmitStatus('function_error', 'Invalid location for map.');
                    frontendAction = undefined;
                }
                break;
            }
            // <<< END NEW CASE >>>

            default:
                logToFile(`[${handlerId} ${socketId}] Error: Unknown function call requested: ${declaredFunctionName}`);
                modelResponseContent = `Error: The requested function "${declaredFunctionName}" is not available or not recognized by the system.`;
                safeEmitStatus('function_error', `Function ${declaredFunctionName} is not recognized.`);
                frontendAction = undefined;
        }
        logToFile(`[${handlerId} ${socketId}] Function ${backendFunctionName} execution finished. ModelResponseContent length: ${modelResponseContent.length}, FrontendAction: ${JSON.stringify(frontendAction)}`);

    } catch (execError: any) {
        logToFile(`[${handlerId} ${socketId}] CRITICAL Error executing function ${declaredFunctionName}: ${execError.message}, Stack: ${execError.stack}`);
        modelResponseContent = `Error encountered while trying to execute the function ${declaredFunctionName}: ${execError.message}`;
        if (socket.connected) {
            socket.emit('chat_error', { type: 'error', message: `System error during function execution (${declaredFunctionName}). Please try again later. Details: ${execError.message}`, step: 'function_call' });
        }
        frontendAction = undefined; // Ensure no action on critical error
    }

    safeEmitStatus('processing_function_result', `Processing result from ${declaredFunctionName}...`);
    return { modelResponseContent, frontendAction };
}


// --- Non-Streaming Handler (Revised for Multi-Turn Function Calls) ---
export async function handleNonStreaming(
    userInput: string,
    historyForHandler: HistoryItem[],
    socket: Socket,
    language: Language
): Promise<HistoryItem[] | void> {

    const handlerId = `Handler-NS-${Date.now()}`;
    const socketId = socket.id;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling NON-STREAMING input: "${userInput}", Lang: ${language} ---`);

    const { systemInstructions, functionDeclarations } = getLanguageConfig(language);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    logToFile(`[${handlerId}] Using System Instructions (Lang: ${language}): ${systemInstructions.substring(0, 100)}...`);
    logToFile(`[${handlerId}] Using Tools (Lang: ${language}): ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);

    const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
    let history: HistoryItem[] = [...historyForHandler, userTurn];
    logToFile(`[${handlerId} History Check - Start] Initialized working history with ${history.length} items.`);

    const thoughts: ThoughtStep[] = [];
    let frontendActionToSend: ChatAction | undefined = undefined;
    let currentTurn = 1; // Track turns for logging/debugging
    const MAX_TURNS = 5; // Prevent infinite loops

    // --- Safe Emit Helper ---
    const safeEmit = (eventName: 'status_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ResultUpdate | ErrorUpdate): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] SKIPPED: Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({ step: data.step, message: data.message, timestamp: new Date().toISOString(), details: (data as StatusUpdate).details });
            }
            if ((eventName === 'chat_result' || eventName === 'chat_error')) {
                const dataWithContext = { ...data, thoughts: thoughts };
                if (eventName === 'chat_result' && frontendActionToSend) {
                    (dataWithContext as ResultUpdate).action = frontendActionToSend;
                    logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final event: ${JSON.stringify(frontendActionToSend)}`);
                }
                socket.emit(eventName, dataWithContext);
            } else {
                socket.emit(eventName, data);
            }
            logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] FAILED: Error during emit. Event: ${eventName}, Error: ${error.message}`);
            return false;
        }
    };

    try {
        if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

        // --- Loop for potential multi-turn function calls ---
        while (currentTurn <= MAX_TURNS) {
            logToFile(`--- [${handlerId} Socket ${socketId}] Turn ${currentTurn}: Sending to Model (History size: ${history.length}) ---`);
            if (currentTurn > 1) { // Emit thinking status only on subsequent turns
                if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on previous results...' })) return;
            } else {
                if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return;
            }

            if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before Model call in Turn ${currentTurn}.`); return; }

            // --- Call the Model ---
            const modelResult: GeminiInteractionResult = await chatbotService.generateTurn(
                [], history, chatbotGenerationConfig, systemInstructions, tools
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after Model call in Turn ${currentTurn}.`); return; }

            // --- Process Model Response ---
            if (modelResult.status === "final_text") {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received final_text.`);
                safeEmit('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = modelResult.text || (frontendActionToSend ? "Okay, action complete." : "Okay.");
                const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }] };
                history.push(finalModelTurn);
                logToFile(`[${handlerId} History Check - Final] Appended final model response. History size: ${history.length}`);
                // safeEmit handles adding action/thoughts
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText });
                return history; // <<< EXIT LOOP: Interaction successful

            } else if (modelResult.status === "error") {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received error from model: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `An error occurred during processing (Turn ${currentTurn}).`, step: 'thinking' });
                return history; // <<< EXIT LOOP: Interaction failed (return current history)

            } else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received requires_function_call: ${modelResult.functionCall.name}`);
                const functionCall = modelResult.functionCall;

                // Append model's request to history
                const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} History Check - FC Prep ${currentTurn}] Appended model FC request. History size: ${history.length}`);

                // --- Execute the Function Call ---
                const { modelResponseContent, frontendAction } = await executeFunctionCall(functionCall, socket, handlerId, language);

                // **IMPORTANT:** Store the frontendAction *only if* it's for navigation (or other client actions)
                // Do NOT store it if it came from getConferences/getJournals (it will be undefined anyway now)
                 // <<< UPDATE: Store action if it's navigation OR openMap >>>
                 if ((functionCall.name === 'navigation' || functionCall.name === 'openGoogleMap') && frontendAction) {
                    frontendActionToSend = frontendAction;
                    logToFile(`[${handlerId} ${socketId}] Stored frontendAction from '${functionCall.name}' call.`);
                } else if (frontendAction){
                    logToFile(`[${handlerId} ${socketId}] Warning: frontendAction generated by non-client-action function '${functionCall.name}'. Ignoring it.`);
                }
                 // <<< END UPDATE >>>


                if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected after function execution in Turn ${currentTurn}.`); return; }

                // --- Prepare Function Response for next Model call ---
                const functionResponsePart: FunctionResponsePart = {
                    functionResponse: { name: functionCall.name, response: { content: modelResponseContent } }
                };
                const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
                history.push(functionTurn); // Add function result to history
                logToFile(`[${handlerId} History Check - FC Done ${currentTurn}] Appended function response. History size: ${history.length}`);

                // Continue to the next iteration of the loop to send the function result back to the model
                currentTurn++;
                continue; // <<< CONTINUE LOOP

            } else {
                // Unexpected status
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received unexpected model status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown' });
                return history; // <<< EXIT LOOP: Unexpected state
            }
        } // End while loop

        // If loop finishes due to MAX_TURNS, it's an error (likely infinite loop)
        if (currentTurn > MAX_TURNS) {
            logToFile(`[${handlerId} Socket ${socketId}] Error: Exceeded maximum interaction turns (${MAX_TURNS}).`);
            safeEmit('chat_error', { type: 'error', message: 'The request seems too complex or is stuck in a loop. Please try rephrasing.', step: 'max_turns_exceeded' });
            return history;
        }

    } catch (error: any) {
        logToFile(`[${handlerId} Socket ${socketId} Lang: ${language}] CRITICAL Error in handleNonStreaming: ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'unknown' });
        return history; // Return history state before the crash
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}




// export async function handleStreaming(
//     userInput: string,
//     currentHistoryFromSocket: HistoryItem[],
//     socket: Socket,
//     language: Language // <<< Accept language parameter

// ): Promise<HistoryItem[] | void> {
//     const handlerId = `Handler-${Date.now()}`;
//     const socketId = socket.id;
//     logToFile(`--- [${handlerId} Socket ${socketId}] Handling input (Stream): "${userInput}" ---`);

//     // --- Get Language-Specific Config ---
//     const { systemInstructions, functionDeclarations } = getLanguageConfig(language); // <<< Get config
//     const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : []; // <<< Create tools

//     // logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] Handling input: "${latestUserInput}" ---`);
//     logToFile(`[${handlerId}] Using System Instructions: ${systemInstructions.substring(0, 100)}...`);
//     logToFile(`[${handlerId}] Using Tools: ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);


//     let history: HistoryItem[] = [...currentHistoryFromSocket];
//     const thoughts: ThoughtStep[] = [];

//     // Updated helper to also collect thoughts
//     const safeEmit = (
//         eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
//         // *** SỬA ĐỔI Ở ĐÂY: Thêm ChatUpdate vào union type ***
//         data: StatusUpdate | ResultUpdate | ErrorUpdate | ChatUpdate
//     ): boolean => {
//         if (!socket.connected) {
//             logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] SKIPPED: Client disconnected. Event: ${eventName}`);
//             return false;
//         }
//         try {
//             // Logic hiện tại để thêm thoughts vẫn ổn vì nó kiểm tra eventName cụ thể
//             if (eventName === 'status_update' && data.type === 'status') {
//                 thoughts.push({
//                     step: data.step,
//                     message: data.message,
//                     timestamp: new Date().toISOString(),
//                     details: (data as StatusUpdate).details
//                 });
//             }

//             // Logic hiện tại để thêm thoughts vào kết quả/lỗi cuối cùng cũng ổn
//             if ((eventName === 'chat_result' || eventName === 'chat_error') && 'thoughts' in data) {
//                 data.thoughts = thoughts;
//             }

//             socket.emit(eventName, data);
//             // Log data.type thay vì chỉ data để rõ ràng hơn
//             logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`);
//             return true;
//         } catch (error: any) {
//             logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] FAILED: Error during emit. Event: ${eventName}, Error: ${error.message}`);
//             return false;
//         }
//     };

//     // --- Helper to process the stream and emit chunks ---
//     async function processAndEmitStream(
//         // *** THIS IS THE CORRECTION ***
//         // The generator yields EnhancedGenerateContentResponse objects, not GenerateContentStreamResult
//         stream: AsyncGenerator<EnhancedGenerateContentResponse>,
//         currentThoughts: ThoughtStep[]
//     ): Promise<{ fullText: string; finalThoughts: ThoughtStep[] } | null> {
//         let accumulatedText = "";
//         let streamFinished = false;
//         try {
//             safeEmit('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' });

//             // Now 'chunk' is correctly typed as EnhancedGenerateContentResponse
//             for await (const chunk of stream) {
//                 if (!socket.connected) {
//                     logToFile(`[${handlerId} Stream Abort - ${socketId}] Client disconnected during stream.`);
//                     return null;
//                 }

//                 // Calling chunk.text() is now valid because chunk is EnhancedGenerateContentResponse
//                 const chunkText = chunk.text();
//                 if (chunkText) {
//                     accumulatedText += chunkText;
//                     // Emit partial result
//                     safeEmit('chat_update', {
//                         type: 'partial_result',
//                         textChunk: chunkText,
//                     }); // Ensure type assertion if needed
//                 }
//                 // Could check chunk.functionCalls() here too if needed, though the service layer handles the first one
//             }
//             streamFinished = true;
//             logToFile(`[${handlerId} Stream] Finished processing stream. Accumulated text length: ${accumulatedText.length}`);

//             // Emit final result
//             safeEmit('chat_result', {
//                 type: 'result',
//                 message: accumulatedText,
//                 thoughts: currentThoughts
//             });

//             return { fullText: accumulatedText, finalThoughts: currentThoughts };


//         } catch (error: any) {
//             logToFile(`[${handlerId} Stream Error - ${socketId}] Error processing stream: ${error.message}`);
//             if (socket.connected) {
//                 // Emit error, potentially including partially accumulated text and thoughts
//                 safeEmit('chat_error', {
//                     type: 'error',
//                     message: `Error processing stream: ${error.message}. Partial response: ${accumulatedText.substring(0, 100)}...`,
//                     step: 'streaming_response',
//                     thoughts: currentThoughts
//                 });
//             }
//             return null; // Indicate error
//         } finally {
//             if (!streamFinished) {
//                 logToFile(`[${handlerId} Stream Warning - ${socketId}] Stream processing loop exited unexpectedly (e.g., error, disconnect).`);
//             }
//         }
//     }


//     try {
//         // 0. Initial Status & Append User Input
//         if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return; // Don't return history yet

//         // *** Append the current user input to the working history ***
//         const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
//         history.push(userTurn);
//         logToFile(`[${handlerId} History Check - Turn 1 Prep] History size: ${history.length}`);

//         // 1. First call to Model (using generateStream)
//         logToFile(`--- [${handlerId} Socket ${socketId}] Turn 1: Requesting Stream ---`); if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return; // Don't return history yet
//         // if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;
//         if (!socket.connected) {
//             logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before initial Gemini call.`);
//             return; // Cannot proceed, don't return history as state is incomplete
//         }

//         logToFile(`[${handlerId} History Check - Turn 1 Send] Sending history with ${history.length} items to model.`);
//         // Call generateTurn with the updated history. The first argument (prompt parts) is often empty
//         // when the main prompt is in the history or system instructions.
//         const streamResult = await chatbotService.generateStream(
//             [], // Start with empty nextTurnInput
//             history,
//             chatbotGenerationConfig,
//             systemInstructions,
//             tools
//         );

//         if (!socket.connected) {
//             logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after initial Gemini call.`);
//             return; // Incomplete state
//         }

//         // --- Handle Stream Result ---
//         if (streamResult.error) {
//             logToFile(`[${handlerId} Socket ${socketId}] Error initiating stream: ${streamResult.error}`);
//             safeEmit('chat_error', { type: 'error', message: streamResult.error, step: 'thinking' });
//             return history; // Return history up to the error

//         } else if (streamResult.functionCalls) {
//             // --- FUNCTION CALL REQUIRED ---
//             logToFile(`--- [${handlerId} Socket ${socketId}] Turn 2: Processing Function Call (detected from stream) ---`);
//             const functionCall = streamResult.functionCalls;

//             const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
//             history.push(modelFunctionCallTurn);
//             logToFile(`[${handlerId} History Check - Turn 2 Prep] Appended model function call. History size: ${history.length}`);


//             if (!safeEmit('status_update', {
//                 type: 'status',
//                 step: 'function_call',
//                 message: `Calling function: ${functionCall.name}...`,
//                 details: { functionName: functionCall.name, args: functionCall.args }
//             })) return;


//             if (!socket.connected) {
//                 logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before executing function ${functionCall.name}.`);
//                 return;
//             }

//             let functionResultContent: string;

//             try {
//                 switch (functionCall.name) {
//                     case "getConferences":
//                         if (!safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving conference data...' })) return;
//                         functionResultContent = await executeGetConferences((functionCall.args as any).searchQuery);
//                         break;
//                     case "getJournals":
//                         if (!safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving journal data...' })) return;
//                         functionResultContent = await executeGetJournals((functionCall.args as any).searchQuery);
//                         break;
//                     case "getWebsiteInformation":
//                         safeEmit('status_update', { type: 'status', step: 'retrieving_info', message: 'Retrieving website information...' });
//                         functionResultContent = await executeGetWebsiteInformation(/* Pass args if needed */);
//                         break;
//                     default:
//                         logToFile(`[${handlerId} Socket ${socketId}] Error: Unknown function call requested: ${functionCall.name}`);
//                         functionResultContent = `Error: The requested function "${functionCall.name}" is not available.`;
//                         safeEmit('status_update', { type: 'status', step: 'function_error', message: `Function ${functionCall.name} is not recognized.` });
//                 }
//                 logToFile(`[${handlerId} Socket ${socketId}] Function ${functionCall.name} execution finished.`);

//                 if (!socket.connected) {
//                     logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after function execution ${functionCall.name}.`);
//                     return;
//                 }

//                 if (!safeEmit('status_update', { type: 'status', step: 'processing_function_result', message: `Processing result from ${functionCall.name}...` })) return;


//             } catch (execError: any) {
//                 logToFile(`[${handlerId} Socket ${socketId}] Error executing function ${functionCall.name}: ${execError.message}`);
//                 // Optionally create a function response indicating the error for the model?
//                 // functionResultContent = `Error executing function ${functionCall.name}: ${execError.message}`;
//                 // Or just emit error to client and return history as is.
//                 if (socket.connected) {
//                     safeEmit('chat_error', { type: 'error', message: `Error during function execution: ${execError.message}`, step: 'function_call' });
//                 } else {
//                     logToFile(`[${handlerId} Socket ${socketId}] Client disconnected before function execution error could be sent.`);
//                     // Don't append a function *response* part if execution failed catastrophically? Or send error back to model?
//                     // Decision point: For now, return history *before* attempting function response.
//                     return history; // <<< RETURN history up to the failed function execution
//                 }
//                 return;
//             }

//             logToFile(`--- [${handlerId} Socket ${socketId}] Turn 3: Function Response to Model ---`);
//             // if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;

//             // *** Append the function execution result to history ***
//             const functionResponsePart: FunctionResponsePart = {
//                 functionResponse: {
//                     name: functionCall.name,
//                     response: { content: functionResultContent } // Send result (or error string) back
//                 }
//             };
//             const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
//             history.push(functionTurn);
//             logToFile(`[${handlerId} History Check - Turn 3 Prep] Appended function response. History size: ${history.length}`);


//             if (!socket.connected) {
//                 logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before final Gemini call.`);
//                 return;
//             }

//             // 3. Request *final* stream after function call
//             logToFile(`--- [${handlerId} Socket ${socketId}] Turn 3: Requesting Final Stream (After Function Call) ---`);
//             if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return; // Incomplete

//             if (!socket.connected) {
//                 logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after final Gemini call.`);
//                 return;
//             }

//             logToFile(`[${handlerId} History Check - Turn 3 Send] Sending history with ${history.length} items to model.`);
//             // Call generateTurn with the updated history (which now includes user, model FC, function response)
//             // *** SỬA Ở ĐÂY: Truyền mảng rỗng cho nextTurnInput ***
//             // Vì 'history' đã chứa lượt function response ở cuối rồi.
//             const finalStreamResult = await chatbotService.generateStream(
//                 [], // <--- SỬA LẠI: Không truyền functionResponsePart ở đây nữa
//                 history, // history đã đầy đủ và kết thúc bằng lượt function response
//                 chatbotGenerationConfig,
//                 systemInstructions,
//                 tools
//             );
//             if (!socket.connected) {
//                 logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after final Gemini call.`);
//                 return;
//             }


//             // --- Handle Final Stream Result ---
//             if (finalStreamResult.error) {
//                 logToFile(`[${handlerId} Socket ${socketId}] Error initiating final stream: ${finalStreamResult.error}`);
//                 safeEmit('chat_error', { type: 'error', message: finalStreamResult.error, step: 'thinking' });
//                 return history;

//             } else if (finalStreamResult.functionCalls) {
//                 // Unexpected second function call
//                 logToFile(`[${handlerId} Socket ${socketId}] Error: Model requested *another* function call unexpectedly after Turn 3.`);
//                 // This might indicate an issue or a complex multi-turn scenario not fully handled.
//                 const errMsg = "Unexpected AI response: The AI requested another action instead of providing a final answer.";
//                 // Append the unexpected function call to history? Or just error out?
//                 // const unexpectedModelTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCall }] };
//                 // history.push(unexpectedModelTurn);
//                 safeEmit('chat_error', { type: 'error', message: errMsg, step: 'thinking' });
//                 // Append unexpected call?
//                 // Check if functionCalls is an array and access accordingly
//                 const unexpectedFc = Array.isArray(finalStreamResult.functionCalls)
//                     ? finalStreamResult.functionCalls[0] // Or handle all if needed
//                     : finalStreamResult.functionCalls;

//                 const unexpectedTurn: HistoryItem = { role: 'model', parts: [{ functionCall: unexpectedFc }] };
//                 history.push(unexpectedTurn);
//                 return history;
//             } else if (finalStreamResult.stream) {
//                 // --- Process Final Stream ---
//                 // >> Pass the correctly typed stream object <<
//                 const finalProcessingResult = await processAndEmitStream(finalStreamResult.stream, thoughts);

//                 if (finalProcessingResult) {
//                     const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalProcessingResult.fullText }] };
//                     history.push(finalModelTurn);
//                     logToFile(`[${handlerId} History Check - Turn 3 Done] Appended final model response. History size: ${history.length}`);
//                     return history;
//                 } else {
//                     // Stream processing failed or was aborted
//                     logToFile(`[${handlerId} Socket ${socketId}] Final stream processing failed or aborted.`);
//                     // Error was already emitted by processAndEmitStream
//                     return history; // Return history up to the point before stream processing failed
//                 }
//             } else {
//                 // Should not happen if error/functionCall/stream are handled
//                 logToFile(`[${handlerId} Socket ${socketId}] Error: Unexpected state from final generateStream call.`);
//                 safeEmit('chat_error', { type: 'error', message: 'Internal server error: Unexpected final stream state.', step: 'thinking' });
//                 return history;
//             }

//         } else if (streamResult.stream) {
//             // --- Process Initial Stream (No Function Call) ---
//             // >> Pass the correctly typed stream object <<
//             const initialProcessingResult = await processAndEmitStream(streamResult.stream, thoughts);
//             if (initialProcessingResult) {
//                 // Append final model text response to history
//                 const modelTurn: HistoryItem = { role: 'model', parts: [{ text: initialProcessingResult.fullText }] };
//                 history.push(modelTurn);
//                 logToFile(`[${handlerId} History Check - Turn 1 Done] Appended model response. History size: ${history.length}`);
//                 // Result already emitted by processAndEmitStream
//                 return history; // <<< RETURN updated history
//             } else {
//                 // Stream processing failed or was aborted
//                 logToFile(`[${handlerId} Socket ${socketId}] Initial stream processing failed or aborted.`);
//                 // Error was already emitted by processAndEmitStream
//                 return history; // Return history up to the point before stream processing failed
//             }
//         } else {
//             // Should not happen if error/functionCall/stream are handled
//             logToFile(`[${handlerId} Socket ${socketId}] Error: Unexpected state from initial generateStream call.`);
//             safeEmit('chat_error', { type: 'error', message: 'Internal server error: Unexpected initial stream state.', step: 'thinking' });
//             return history;
//         }

//     } catch (error: any) {
//         // Catch critical errors *within* the handler's main flow
//         logToFile(`[${handlerId} Socket ${socketId}]  Lang: ${language}] CRITICAL Error in handleUserInputStreaming: ${error.message}, Stack: ${error.stack}`);
//         if (socket.connected) {
//             // Pass accumulated thoughts before the crash
//             safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred during processing.", step: 'unknown' });
//         } else {
//             logToFile(`[${handlerId} Socket ${socketId}] Client disconnected before critical error could be sent.`);
//         }
//         // Return the history state just before the crash, or potentially void/undefined
//         // depending on how unrecoverable the state is. Returning history is safer.
//         return history;
//     } finally {
//         logToFile(`--- [${handlerId} Socket ${socketId}]  Lang: ${language}] Handler execution path finished for input: "${userInput}" (Socket connected: ${socket.connected}) ---`);
//     }
//     // Fallback return (should ideally be unreachable if all paths return)
//     // return history;
// }