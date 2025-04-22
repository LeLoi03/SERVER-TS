// src/chatbot/handlers/intentHandler.ts
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
    FrontendAction,
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
// Define return type for handleNonStreaming
interface NonStreamingHandlerResult {
    history: HistoryItem[];
    action?: FrontendAction;
}


export async function handleNonStreaming(
    userInput: string,
    historyForHandler: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string // Receive handlerId
): Promise<NonStreamingHandlerResult | void> { // Update return type

    // const handlerId = `Handler-NS-${Date.now()}`; // handlerId is now passed in
    const socketId = socket.id;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling NON-STREAMING input: "${userInput}", Lang: ${language} ---`);

    const { systemInstructions, functionDeclarations } = getLanguageConfig(language);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
    let history: HistoryItem[] = [...historyForHandler, userTurn];
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined; // Store the final action
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

            let dataToSend: any = data;

            // Attach thoughts and action to the *final* chat_result or chat_error
            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend = { ...data, thoughts: thoughts };
                // Only attach the action if it's the final result being emitted by this handler
                if (eventName === 'chat_result' && finalFrontendAction) {
                    (dataToSend as ResultUpdate).action = finalFrontendAction;
                    logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final event: ${JSON.stringify(finalFrontendAction)}`);
                }
            }

            socket.emit(eventName, dataToSend);
            logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] FAILED: Error during emit. Event: ${eventName}, Error: ${error.message}`);
            return false;
        }
    };

    try {
        if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

        while (currentTurn <= MAX_TURNS) {
            logToFile(`--- [${handlerId} Socket ${socketId}] Turn ${currentTurn}: Sending to Model (History size: ${history.length}) ---`);
            if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? 'Thinking based on previous results...' : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before Model call in Turn ${currentTurn}.`); return; }

            const modelResult: GeminiInteractionResult = await chatbotService.generateTurn(
                [], history, chatbotGenerationConfig, systemInstructions, tools
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after Model call in Turn ${currentTurn}.`); return; }

            if (modelResult.status === "final_text") {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received final_text.`);
                safeEmit('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Please follow the instructions on screen." : "Okay."); // Adjust message if action exists
                const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }] };
                history.push(finalModelTurn);
                logToFile(`[${handlerId} History Check - Final] Appended final model response. History size: ${history.length}`);
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText }); // safeEmit handles attaching action/thoughts

                // --- Return final state ---
                return { history: history, action: finalFrontendAction }; // <<< RETURN RESULT OBJECT

            } else if (modelResult.status === "error") {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received error from model: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `An error occurred (Turn ${currentTurn}).`, step: 'thinking' });
                return { history: history }; // Return history up to the error point

            } else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received requires_function_call: ${modelResult.functionCall.name}`);
                const functionCall = modelResult.functionCall;
                const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} History Check - FC Prep ${currentTurn}] Appended model FC request. History size: ${history.length}`);

                const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
                    return safeEmit(eventName, data);
                };

                // --- Execute Function ---
                const functionResult = await executeFunction(
                    functionCall,
                    handlerId, // Pass handlerId
                    language,
                    statusUpdateCallback,
                    socket // Pass socket
                );
                // functionResult is { modelResponseContent: string, frontendAction?: FrontendAction }

                // --- Store potential action ---
                // We only store the *last* action generated in a multi-turn sequence
                // If a text response comes after an action, the action is still sent.
                if (functionResult.frontendAction) {
                    finalFrontendAction = functionResult.frontendAction; // Store/overwrite action
                    logToFile(`[${handlerId} ${socketId}] Stored/Updated frontendAction from '${functionCall.name}' result.`);
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected after function execution in Turn ${currentTurn}.`); return; }

                const functionResponsePart: FunctionResponsePart = {
                    functionResponse: { name: functionCall.name, response: { content: functionResult.modelResponseContent } }
                };
                const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
                history.push(functionTurn);
                logToFile(`[${handlerId} History Check - FC Done ${currentTurn}] Appended function response. History size: ${history.length}`);

                currentTurn++;
                continue; // <<< CONTINUE LOOP

            } else {
                logToFile(`[${handlerId} Socket ${socketId}] Turn ${currentTurn}: Received unexpected model status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                return { history: history }; // Return history up to the error point
            }
        } // End while loop

        if (currentTurn > MAX_TURNS) {
            logToFile(`[${handlerId} Socket ${socketId}] Error: Exceeded maximum interaction turns (${MAX_TURNS}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request too complex or stuck in a loop.', step: 'max_turns_exceeded' });
            return { history: history };
        }

    } catch (error: any) {
        logToFile(`[${handlerId} Socket ${socketId} Lang: ${language}] CRITICAL Error in handleNonStreaming: ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'unknown_handler_error' });
        return { history: history }; // Return history state before the crash
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
    // Should be unreachable if logic is correct, but satisfies TS
    return { history: history };
}


// --- handleStreaming function ---
export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string, // <<< Added handlerId parameter
    onActionGenerated?: (action: FrontendAction) => void // <<< Added callback parameter
): Promise<HistoryItem[] | void> { // Return type remains the same

    // <<< Use the passed handlerId >>>
    // const handlerId = `Handler-S-${Date.now()}`; // Remove this line
    const socketId = socket.id;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

    // --- Get Language Config --- (No changes)
    const { systemInstructions, functionDeclarations } = getLanguageConfig(language);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    logToFile(`[${handlerId}] Using System Instructions (Lang: ${language}): ${systemInstructions.substring(0, 100)}...`);
    logToFile(`[${handlerId}] Using Tools (Lang: ${language}): ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);

    // --- State Variables --- (No changes)
    let history: HistoryItem[] = [...currentHistoryFromSocket];
    const thoughts: ThoughtStep[] = [];
    let frontendActionToSend: FrontendAction | undefined = undefined; // To store action from executeFunction

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
            // --- Function Call Required ---
            logToFile(`--- [${handlerId} Turn 2 Start - ${socketId}] Function Call Required: ${initialResult.functionCalls.name} ---`);
            const functionCall = initialResult.functionCalls;
            const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
            history.push(modelFunctionCallTurn);
            logToFile(`[${handlerId} History T2 Prep - ${socketId}] Added model FC request. Size: ${history.length}`);

            if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected before function execution.`); return; }

            // Execute Function Call using the Registry
            const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
                return safeEmit(eventName, data);
            };

            const functionResult = await executeFunction( // <<< Get the full result object
                functionCall,
                handlerId,
                language,
                statusUpdateCallback,
                socket
            );
            // functionResult is { modelResponseContent: string, frontendAction?: FrontendAction }

            // <<< --- MODIFICATION START --- >>>
            // STORE POTENTIAL ACTION and NOTIFY SERVER
            if (functionResult.frontendAction) {
                frontendActionToSend = functionResult.frontendAction; // Store it for final emit
                logToFile(`[${handlerId} ${socketId}] Stored frontendAction from '${functionCall.name}' execution.`);
                // --- CALL THE CALLBACK passed from server.ts ---
                if (onActionGenerated) {
                    onActionGenerated(frontendActionToSend);
                    logToFile(`[${handlerId} ${socketId}] Notified caller (server.ts) about generated action.`);
                } else {
                    logToFile(`[${handlerId} ${socketId}] Warning: onActionGenerated callback was not provided.`);
                }
                // ---------------------------------------------
            }
            // <<< --- MODIFICATION END --- >>>



            if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected after function execution completed.`); return; }

            // Append Function Response to History (Use modelResponseContent from functionResult)
            const functionResponsePart: FunctionResponsePart = { functionResponse: { name: functionCall.name, response: { content: functionResult.modelResponseContent } } };
            const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
            history.push(functionTurn);
            logToFile(`[${handlerId} History T2 Done - ${socketId}] Added function response. Size: ${history.length}`);


            // --- Turn 3: Second Model Call (Request Final Stream) --- (No changes in this block's logic)
            logToFile(`--- [${handlerId} Turn 3 Start - ${socketId}] Requesting final stream after function call ---`);
            if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T3 - ${socketId}] Disconnected before final model call.`); return; }
            const finalResult = await chatbotService.generateStream([], history, chatbotGenerationConfig, systemInstructions, tools);
            if (!socket.connected) { logToFile(`[${handlerId} Abort T3 - ${socketId}] Disconnected after final model call response received.`); return; }

            // --- Process Final Result --- (No changes in this block's logic)
            if (finalResult.error) {
                logToFile(`[${handlerId} Error T3 - ${socketId}] Model returned error on final call: ${finalResult.error}`);
                safeEmit('chat_error', { type: 'error', message: finalResult.error, step: 'thinking' });
                return history;
            } else if (finalResult.functionCalls) {
                logToFile(`[${handlerId} Error T3 - ${socketId}] Unexpected second function call requested.`);
                safeEmit('chat_error', { type: 'error', message: 'Unexpected AI response.', step: 'thinking' });
                const unexpectedTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCalls }] };
                history.push(unexpectedTurn);
                return history;
            } else if (finalResult.stream) {
                logToFile(`[${handlerId} Stream T3 - ${socketId}] Processing final stream...`);
                // processAndEmitStream will emit the final chat_result *including the stored frontendActionToSend*
                const streamOutput = await processAndEmitStream(finalResult.stream, true);
                if (streamOutput) {
                    const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                    history.push(finalModelTurn);
                    logToFile(`[${handlerId} History T3 Done - ${socketId}] Appended final model response. Size: ${history.length}`);
                    return history; // <<< SUCCESSFUL COMPLETION (MULTI-TURN STREAM)
                } else {
                    logToFile(`[${handlerId} Error T3 - ${socketId}] Final stream processing failed.`);
                    return history;
                }
            } else {
                logToFile(`[${handlerId} Error T3 - ${socketId}] Unexpected empty state from final model call.`);
                safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected final response.', step: 'thinking' });
                return history;
            }
            // --- End Turn 3 Logic ---

        } else if (initialResult.stream) {
            // --- Initial Result is a Stream --- (No changes needed, no action expected here)
            logToFile(`[${handlerId} Stream T1 - ${socketId}] Processing initial stream directly...`);
            // processAndEmitStream will emit the final chat_result (no action expected here)
            const streamOutput = await processAndEmitStream(initialResult.stream, true);
            if (streamOutput) {
                const modelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                history.push(modelTurn);
                logToFile(`[${handlerId} History T1 Done - ${socketId}] Appended initial model response. Size: ${history.length}`);
                return history; // <<< SUCCESSFUL COMPLETION (SINGLE-TURN STREAM)
            } else {
                logToFile(`[${handlerId} Error T1 - ${socketId}] Initial stream processing failed.`);
                return history;
            }

        } else { // (No changes)
            logToFile(`[${handlerId} Error T1 - ${socketId}] Unexpected empty state from initial model call.`);
            safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected initial response.', step: 'thinking' });
            return history;
        }

    } catch (error: any) { // (No changes)
        logToFile(`[${handlerId} CRITICAL Error - ${socketId} Lang: ${language}] ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'handler_exception' });
        return history;
    } finally { // (No changes)
        logToFile(`--- [${handlerId} ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}