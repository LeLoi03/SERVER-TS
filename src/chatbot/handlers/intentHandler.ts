// src/handlers/intentHandler.ts
import {
    GenerationConfig,
    Tool,
    FunctionResponsePart,
    EnhancedGenerateContentResponse
} from "@google/generative-ai";
import { Socket } from 'socket.io';
import logToFile from '../utils/logger';
import {
    HistoryItem,
    GeminiInteractionResult,
    StatusUpdate,
    ResultUpdate,
    ErrorUpdate,
    ThoughtStep,
    ChatAction,
    ChatUpdate,
    Language,

} from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { loadModelConfig } from '../gemini/configLoader';
import { getLanguageConfig } from '../utils/languageConfig';
import { executeFunction } from '../gemini/functionRegistry';
import { GEMINI_API_KEY, CHATBOT_MODEL_NAME } from "../../config";
// --- Services & Base Config ---
// Consider making the model name configurable per handler if needed
const chatbotService = new Gemini(GEMINI_API_KEY!, CHATBOT_MODEL_NAME || "gemini-2.0-flash");
const chatbotConfigPrefix = "CHATBOT"; // Assuming a config prefix for chatbot settings
const chatbotGenerationConfig: GenerationConfig = loadModelConfig(chatbotConfigPrefix);

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
    let currentTurn = 1;
    const MAX_TURNS = 5;

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

            let dataToSend: any = data; // Use 'any' temporarily for flexibility

            // Always attach thoughts to final events
            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend = { ...data, thoughts: thoughts }; // Clone and add thoughts
                // Attach frontendAction *only* to the final result event if it exists
                if (eventName === 'chat_result' && frontendActionToSend) {
                    (dataToSend as ResultUpdate).action = frontendActionToSend; // Type assertion
                    logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final event: ${JSON.stringify(frontendActionToSend)}`);
                }
            }

            socket.emit(eventName, dataToSend); // Send the potentially modified data
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
            if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? 'Thinking based on previous results...' : 'Thinking...' })) return;

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
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText }); // safeEmit handles adding action/thoughts
                return history; // <<< EXIT LOOP: Interaction successful

            } else if (modelResult.status === "error") {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received error from model: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `An error occurred during processing (Turn ${currentTurn}).`, step: 'thinking' });
                // Return current history, including the user input that caused the error maybe?
                // Or just return void/undefined to signal failure? Let's return history for now.
                return history; // <<< EXIT LOOP: Interaction failed

            } else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received requires_function_call: ${modelResult.functionCall.name}`);
                const functionCall = modelResult.functionCall;

                // Append model's request to history
                const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} History Check - FC Prep ${currentTurn}] Appended model FC request. History size: ${history.length}`);

                // --- Execute the Function Call using the Registry --- <<< REFACRORED PART
                // The registry's executeFunction now handles logging, status emits, and error handling internally
                // Create a specific callback for status updates to pass down
                const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
                    // Directly use the main handler's safeEmit, ensuring type safety
                    return safeEmit(eventName, data);
                };


                // Pass the callback to executeFunction
                const { modelResponseContent, frontendAction } = await executeFunction(
                    functionCall,
                    // socket, // Pass socket separately if needed by handlers
                    handlerId,
                    language,
                    statusUpdateCallback, // Pass the callback function
                    socket // Pass socket separately
                );
                // ---

                // Store the frontendAction *if* it was returned by the handler.
                // The logic within the specific handlers determines if an action is needed.
                if (frontendAction) {
                    frontendActionToSend = frontendAction; // Store it to be sent with the *final* message
                    logToFile(`[${handlerId} ${socketId}] Stored frontendAction from '${functionCall.name}' result.`);
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected after function execution in Turn ${currentTurn}.`); return; }

                // --- Prepare Function Response for next Model call ---
                const functionResponsePart: FunctionResponsePart = {
                    functionResponse: { name: functionCall.name, response: { content: modelResponseContent } }
                };
                const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
                history.push(functionTurn);
                logToFile(`[${handlerId} History Check - FC Done ${currentTurn}] Appended function response. History size: ${history.length}`);

                // Continue to the next iteration
                currentTurn++;
                continue; // <<< CONTINUE LOOP

            } else {
                // Unexpected status
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received unexpected model status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                return history; // <<< EXIT LOOP: Unexpected state
            }
        } // End while loop

        // If loop finishes due to MAX_TURNS
        if (currentTurn > MAX_TURNS) {
            logToFile(`[${handlerId} Socket ${socketId}] Error: Exceeded maximum interaction turns (${MAX_TURNS}).`);
            safeEmit('chat_error', { type: 'error', message: 'The request seems too complex or is stuck in a loop. Please try rephrasing.', step: 'max_turns_exceeded' });
            return history;
        }

    } catch (error: any) {
        logToFile(`[${handlerId} Socket ${socketId} Lang: ${language}] CRITICAL Error in handleNonStreaming: ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'unknown_handler_error' });
        return history; // Return history state before the crash
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
    // Ensure a return path if the loop somehow exits without returning (shouldn't happen with current logic)
    return history;
}

export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: HistoryItem[],
    socket: Socket,
    language: Language
): Promise<HistoryItem[] | void> { // Return type remains the same

    const handlerId = `Handler-S-${Date.now()}`;
    const socketId = socket.id;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

    // --- Get Language Config ---
    const { systemInstructions, functionDeclarations } = getLanguageConfig(language);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    logToFile(`[${handlerId}] Using System Instructions (Lang: ${language}): ${systemInstructions.substring(0, 100)}...`);
    logToFile(`[${handlerId}] Using Tools (Lang: ${language}): ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);

    // --- State Variables ---
    let history: HistoryItem[] = [...currentHistoryFromSocket];
    const thoughts: ThoughtStep[] = [];
    let frontendActionToSend: ChatAction | undefined = undefined; // To store action from executeFunction

    // --- Safe Emit Helper (Collects Thoughts, Adds Context to Final Events) ---
    const safeEmit = (eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate): boolean => {
        if (!socket.connected) { logToFile(`[${handlerId} Emit SKIPPED - ${socketId}] Client disconnected. Event: ${eventName}`); return false; }
        try {
            // Collect thoughts from status updates
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({ step: data.step, message: data.message, timestamp: new Date().toISOString(), details: (data as StatusUpdate).details });
            }

            let dataToSend: any = data; // Use 'any' temporarily

            // Add collected thoughts and potential action to final result/error
            if ((eventName === 'chat_result' || eventName === 'chat_error')) {
                // Clone and add context
                dataToSend = { ...data, thoughts: thoughts };
                if (eventName === 'chat_result' && frontendActionToSend) {
                    (dataToSend as ResultUpdate).action = frontendActionToSend; // Type assertion
                    logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final stream event: ${JSON.stringify(frontendActionToSend)}`);
                }
            }

            socket.emit(eventName, dataToSend); // Emit potentially modified data
            logToFile(`[${handlerId} Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`); return true;
        } catch (error: any) { logToFile(`[${handlerId} Emit FAILED - ${socketId}] Error: ${error.message}. Event: ${eventName}`); return false; }
    };


    // --- Helper to Process Stream Chunks ---
    // (This helper remains largely unchanged, focused on stream consumption and partial updates)
    async function processAndEmitStream(
        stream: AsyncGenerator<EnhancedGenerateContentResponse>,
        emitFinalResult: boolean = true // Controls if this helper sends the 'chat_result'
    ): Promise<{ fullText: string } | null> {
        let accumulatedText = "";
        let streamFinished = false;
        logToFile(`[${handlerId} Stream Processing - ${socketId}] Starting... (Emit final: ${emitFinalResult})`);

        // Emit initial streaming status *once* before the loop
        if (!safeEmit('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) {
            logToFile(`[${handlerId} Stream Processing Abort - ${socketId}] Failed initial status emit (disconnected?).`);
            return null; // Can't proceed if disconnected
        }


        try {
            for await (const chunk of stream) {
                if (!socket.connected) { logToFile(`[${handlerId} Stream Abort - ${socketId}] Disconnected during stream.`); return null; }

                // We expect potential function calls *before* the stream starts,
                // or text chunks during the stream. The Gemini API generally doesn't
                // embed function calls *within* text chunks in a streaming response.
                // Therefore, we only need to process text here.
                const chunkText = chunk.text();
                if (chunkText) {
                    accumulatedText += chunkText;
                    // Use the safeEmit helper
                    if (!safeEmit('chat_update', { type: 'partial_result', textChunk: chunkText })) {
                        // If emitting fails, likely disconnected, abort stream processing
                        logToFile(`[${handlerId} Stream Abort - ${socketId}] Failed to emit chat_update.`);
                        return null;
                    }
                }
            }
            streamFinished = true;
            logToFile(`[${handlerId} Stream Processing - ${socketId}] Finished. Length: ${accumulatedText.length}`);

            // --- Conditional Final Emit ---
            if (emitFinalResult) {
                logToFile(`[${handlerId} Stream Processing - ${socketId}] Emitting final chat_result via safeEmit.`);
                // safeEmit will automatically add thoughts and frontendActionToSend if available
                if (!safeEmit('chat_result', { type: 'result', message: accumulatedText })) {
                    logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Failed to emit final chat_result.`);
                    // Don't return null here, as text was processed, but signal potential issue.
                    // The main handler will still return the history.
                }
            }
            return { fullText: accumulatedText }; // Return the accumulated text regardless of final emit success

        } catch (error: any) {
            logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
            // safeEmit will add thoughts automatically
            safeEmit('chat_error', { type: 'error', message: `Error processing stream: ${error.message}`, step: 'streaming_response' });
            return null; // Indicate failure to process stream
        } finally {
            // Log if the loop finished unexpectedly (e.g., break/return without setting flag)
            if (!streamFinished) logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Stream loop exited unexpectedly.`);
        }
    }


    // --- Main Streaming Logic ---
    try {
        // 0. Initial Status & Append User Input
        if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return; // Check connection early
        const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
        history.push(userTurn);
        logToFile(`[${handlerId} History Init - ${socketId}] Added user turn. Size: ${history.length}`);

        // --- Turn 1: Initial Model Call ---
        logToFile(`--- [${handlerId} Turn 1 Start - ${socketId}] Requesting initial stream ---`);
        if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return;
        if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected before model call.`); return; }

        logToFile(`[${handlerId} History T1 Send - ${socketId}] Size: ${history.length}`);
        // Call Gemini Service (assuming generateStream handles potential non-stream responses like errors/FCs)
        const initialResult = await chatbotService.generateStream([], history, chatbotGenerationConfig, systemInstructions, tools);

        if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected after model call response received.`); return; }

        // --- Process Initial Result ---
        if (initialResult.error) {
            logToFile(`[${handlerId} Error T1 - ${socketId}] Model returned error: ${initialResult.error}`);
            safeEmit('chat_error', { type: 'error', message: initialResult.error, step: 'thinking' });
            return history; // Return history up to the point of error

        } else if (initialResult.functionCalls) {
            // --- Function Call Required (Instead of Initial Stream) ---
            logToFile(`--- [${handlerId} Turn 2 Start - ${socketId}] Function Call Required: ${initialResult.functionCalls.name} ---`);
            const functionCall = initialResult.functionCalls; // Extract the function call object

            // Append Model's FC Request to History
            const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
            history.push(modelFunctionCallTurn);
            logToFile(`[${handlerId} History T2 Prep - ${socketId}] Added model FC request. Size: ${history.length}`);

            // Execute Function Call using the REFACTORED REGISTRY
            // Status updates for 'function_call' and 'processing_function_result' are handled within executeFunction
            if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected before function execution.`); return; }

            // <<< CALL THE REFACTORED FUNCTION EXECUTOR >>>
            // Create a specific callback for status updates to pass down
            const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
                // Directly use the main handler's safeEmit
                return safeEmit(eventName, data);
            };

            // Pass the callback to executeFunction
            const { modelResponseContent, frontendAction } = await executeFunction(
                functionCall,
                // socket, // Pass socket separately if needed
                handlerId,
                language,
                statusUpdateCallback, // Pass the callback
                socket // Pass socket separately
            );
            // <<< --- >>>

            // STORE POTENTIAL ACTION to be sent with the *final* result
            if (frontendAction) {
                frontendActionToSend = frontendAction;
                logToFile(`[${handlerId} ${socketId}] Stored frontendAction from '${functionCall.name}' execution.`);
            }

            if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected after function execution completed.`); return; }

            // Append Function Response to History
            const functionResponsePart: FunctionResponsePart = { functionResponse: { name: functionCall.name, response: { content: modelResponseContent } } };
            const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
            history.push(functionTurn);
            logToFile(`[${handlerId} History T2 Done - ${socketId}] Added function response. Size: ${history.length}`);

            // --- Turn 3: Second Model Call (Request Final Stream) ---
            logToFile(`--- [${handlerId} Turn 3 Start - ${socketId}] Requesting final stream after function call ---`);
            if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T3 - ${socketId}] Disconnected before final model call.`); return; }

            logToFile(`[${handlerId} History T3 Send - ${socketId}] Size: ${history.length}`);
            // Request the final stream response from the model
            const finalResult = await chatbotService.generateStream([], history, chatbotGenerationConfig, systemInstructions, tools);

            if (!socket.connected) { logToFile(`[${handlerId} Abort T3 - ${socketId}] Disconnected after final model call response received.`); return; }

            // --- Process Final Result ---
            if (finalResult.error) {
                logToFile(`[${handlerId} Error T3 - ${socketId}] Model returned error on final call: ${finalResult.error}`);
                safeEmit('chat_error', { type: 'error', message: finalResult.error, step: 'thinking' });
                return history; // Return history up to this point

            } else if (finalResult.functionCalls) {
                // This is generally unexpected after providing a function result. Handle as an error.
                logToFile(`[${handlerId} Error T3 - ${socketId}] Unexpected second function call requested after providing result.`);
                safeEmit('chat_error', { type: 'error', message: 'Unexpected AI response: Another action was requested instead of a final answer.', step: 'thinking' });
                const unexpectedTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCalls }] };
                history.push(unexpectedTurn); // Add the unexpected request to history for context
                return history;

            } else if (finalResult.stream) {
                // --- Process Final Stream ---
                logToFile(`[${handlerId} Stream T3 - ${socketId}] Processing final stream...`);
                // Process the stream AND emit the final result ('chat_result')
                const streamOutput = await processAndEmitStream(finalResult.stream, true); // emitFinalResult = true

                if (streamOutput) {
                    // Stream processed successfully, add final model response to history
                    const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                    history.push(finalModelTurn);
                    logToFile(`[${handlerId} History T3 Done - ${socketId}] Appended final model response. Size: ${history.length}`);
                    return history; // <<< SUCCESSFUL COMPLETION (MULTI-TURN STREAM)
                } else {
                    // Stream processing failed (error already emitted by helper)
                    logToFile(`[${handlerId} Error T3 - ${socketId}] Final stream processing failed.`);
                    return history; // Return history up to the point of failure
                }

            } else {
                // Neither error, function call, nor stream - unexpected state
                logToFile(`[${handlerId} Error T3 - ${socketId}] Unexpected empty state from final model call.`);
                safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected final response state from AI.', step: 'thinking' });
                return history;
            }
            // --- End Turn 3 Logic ---

        } else if (initialResult.stream) {
            // --- Initial Result is a Stream (No Function Call Needed) ---
            logToFile(`[${handlerId} Stream T1 - ${socketId}] Processing initial stream directly...`);
            // Process the stream AND emit the final result ('chat_result')
            const streamOutput = await processAndEmitStream(initialResult.stream, true); // emitFinalResult = true

            if (streamOutput) {
                // Stream processed successfully, add model response to history
                const modelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                history.push(modelTurn);
                logToFile(`[${handlerId} History T1 Done - ${socketId}] Appended initial model response. Size: ${history.length}`);
                return history; // <<< SUCCESSFUL COMPLETION (SINGLE-TURN STREAM)
            } else {
                // Initial stream processing failed (error already emitted by helper)
                logToFile(`[${handlerId} Error T1 - ${socketId}] Initial stream processing failed.`);
                return history; // Return history up to the point of failure
            }

        } else {
            // Should not happen if error/functionCall/stream are exhaustive possibilities
            logToFile(`[${handlerId} Error T1 - ${socketId}] Unexpected empty state from initial model call.`);
            safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected initial response state from AI.', step: 'thinking' });
            return history;
        }

    } catch (error: any) {
        logToFile(`[${handlerId} CRITICAL Error - ${socketId} Lang: ${language}] ${error.message}\nStack: ${error.stack}`);
        // safeEmit will add thoughts
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'handler_exception' });
        return history; // Return history state before the crash
    } finally {
        logToFile(`--- [${handlerId} ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}