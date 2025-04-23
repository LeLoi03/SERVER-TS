// src/chatbot/handlers/intentHandler.ts
import {
    GenerationConfig,
    Tool,
    FunctionResponsePart,
    FunctionCall, // Import FunctionCall
    EnhancedGenerateContentResponse,
    Part,
    Content
} from "@google/generative-ai";
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid'; // For generating task IDs
import logToFile from '../../utils/logger';
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
    AgentCardRequest, // Import Agent Card types
    AgentCardResponse
} from '../shared/types';
import { Gemini } from '../gemini/gemini';
import { loadModelConfig } from '../gemini/configLoader';
// Change import to use the new function
import { getAgentLanguageConfig, AgentId } from '../utils/languageConfig';
import { executeFunction } from '../gemini/functionRegistry';
import { GEMINI_API_KEY, CHATBOT_MODEL_NAME } from "../../config";

const chatbotService = new Gemini(GEMINI_API_KEY!, CHATBOT_MODEL_NAME || "gemini-2.0-flash"); // Maybe use 1.5 for better routing
const chatbotConfigPrefix = "CHATBOT";
const chatbotGenerationConfig: GenerationConfig = loadModelConfig(chatbotConfigPrefix);

interface NonStreamingHandlerResult {
    history: HistoryItem[];
    action?: FrontendAction;
}


// --- Define type for routeToAgent arguments ---
interface RouteToAgentArgs {
    targetAgent: string;
    taskDescription: string;
    inputData: any; // Hoặc một kiểu cụ thể hơn nếu bạn biết rõ inputData
}



// --- Function to handle calling a Sub Agent ---
async function callSubAgent(
    requestCard: AgentCardRequest,
    parentHandlerId: string, // ID of the Host Agent's handler process
    language: Language,
    socket: Socket // Pass socket for potential direct emits if needed, but unlikely
): Promise<AgentCardResponse> {
    const subAgentId = requestCard.receiverAgentId as AgentId; // Cast to known AgentId type
    const subHandlerId = `${parentHandlerId}-Sub-${subAgentId}-${Date.now()}`;
    const socketId = socket.id;
    logToFile(`--- [${subHandlerId} Socket ${socketId}] Calling Sub Agent: ${subAgentId}, Task: ${requestCard.taskId} ---`);

    // 1. Get Config for Sub Agent
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, subAgentId);
    const subAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    // 2. Prepare Input for Sub Agent (Use AgentCard as input context)
    // Convert AgentCardRequest to a Part for the history
    // Option A: Simple text description (might lose structure)
    // const subAgentInputText = `Task: ${requestCard.taskDescription}. Input Data: ${JSON.stringify(requestCard.inputData || {})}`;
    // const subAgentInputParts: Part[] = [{ text: subAgentInputText }];

    // Option B: Pass structured data (if model supports it well in history)
    // This might require adjusting how Gemini service handles non-text parts.
    // Let's stick to text for simplicity in V1.
    const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${requestCard.taskDescription}\nInput Data: ${JSON.stringify(requestCard.inputData || {})}\nPlease execute using your available tools.`;
    const subAgentInputParts: Part[] = [{ text: subAgentInputText }];

    // Sub agent history starts fresh or with minimal context from the card
    const subAgentHistory: HistoryItem[] = [{ role: 'user', parts: subAgentInputParts }]; // Simulating the request as a 'user' turn for the sub-agent

    // 3. Call Sub Agent's LLM
    // Note: This is a simplified loop, a real sub-agent might need multiple turns too.
    // For PoC, assume ConferenceAgent calls its function in one turn.
    let subAgentResultData: any = null;
    let subAgentErrorMessage: string | undefined = undefined;
    let subAgentFrontendAction: FrontendAction | undefined = undefined;
    let subAgentStatus: 'success' | 'error' = 'error'; // Default to error

    try {
        logToFile(`[${subHandlerId}] Sending request to ${subAgentId} LLM.`);
        const subAgentResult: GeminiInteractionResult = await chatbotService.generateTurn(
            [], subAgentHistory, chatbotGenerationConfig, systemInstructions, subAgentTools
        );
        logToFile(`[${subHandlerId}] Received result from ${subAgentId} LLM: Status ${subAgentResult.status}`);

        if (subAgentResult.status === "requires_function_call" && subAgentResult.functionCall) {
            const functionCall = subAgentResult.functionCall;
            logToFile(`[${subHandlerId}] ${subAgentId} requested function call: ${functionCall.name}`);

            // Execute the function requested by the Sub Agent
            // The status callback here is tricky - should it emit under the subHandlerId? Or parentHandlerId?
            // Let's keep it simple for now and not emit sub-agent internal steps to frontend directly.
            const statusUpdateCallbackStub = (eventName: 'status_update', data: StatusUpdate): boolean => {
                logToFile(`[${subHandlerId} Status Stub] Step: ${data.step}, Msg: ${data.message}`);
                return socket.connected; // Check connection
            };

            const functionResult = await executeFunction(
                functionCall,
                subHandlerId, // Use sub-handler ID for logging within executeFunction
                language,
                statusUpdateCallbackStub, // Use stub or a more sophisticated callback
                socket // Pass socket if handlers need it
            );
            logToFile(`[${subHandlerId}] Function ${functionCall.name} executed. Result: ${functionResult.modelResponseContent.substring(0, 100)}...`);

            // Simulate the Sub Agent processing the function result and preparing the final response
            // For ConferenceAgent PoC, we assume the result of getConferences IS the final resultData
            if (functionResult.modelResponseContent.toLowerCase().startsWith('error:')) {
                subAgentErrorMessage = functionResult.modelResponseContent;
                subAgentStatus = 'error';
            } else {
                subAgentResultData = functionResult.modelResponseContent; // Raw data expected
                subAgentStatus = 'success';
                // Check if the *sub-agent's function call* resulted in a FE action
                subAgentFrontendAction = functionResult.frontendAction;
            }

        } else if (subAgentResult.status === "final_text") {
            // Sub agent responded directly without function call (unlikely for ConferenceAgent)
            logToFile(`[${subHandlerId}] ${subAgentId} provided direct text response (unexpected for PoC): ${subAgentResult.text}`);
            subAgentResultData = subAgentResult.text;
            subAgentStatus = 'success';
        } else {
            // Error from Sub Agent LLM call
            logToFile(`[${subHandlerId}] Error during ${subAgentId} LLM call: ${subAgentResult.errorMessage}`);
            subAgentErrorMessage = subAgentResult.errorMessage || `Error processing task in ${subAgentId}.`;
            subAgentStatus = 'error';
        }

    } catch (error: any) {
        logToFile(`[${subHandlerId}] CRITICAL Error calling Sub Agent ${subAgentId}: ${error.message}`);
        subAgentErrorMessage = `Failed to execute task via ${subAgentId}: ${error.message}`;
        subAgentStatus = 'error';
    }

    // 4. Construct Response Card
    const responseCard: AgentCardResponse = {
        taskId: requestCard.taskId,
        conversationId: requestCard.conversationId,
        senderAgentId: subAgentId,
        receiverAgentId: requestCard.senderAgentId,
        timestamp: new Date().toISOString(),
        status: subAgentStatus,
        resultData: subAgentResultData,
        errorMessage: subAgentErrorMessage,
        frontendAction: subAgentFrontendAction, // Pass FE action back if generated
    };

    logToFile(`--- [${subHandlerId}] Sub Agent ${subAgentId} finished. Status: ${responseCard.status} ---`);
    return responseCard;
}

// --- Main Handler (handleNonStreaming) ---
export async function handleNonStreaming(
    userInput: string,
    historyForHandler: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string // Renamed from initialHandlerId for clarity
): Promise<NonStreamingHandlerResult | void> {

    const socketId = socket.id;
    const conversationId = handlerId; // Use handlerId as conversationId for simplicity
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling NON-STREAMING input: "${userInput}", Lang: ${language} ---`);

    // --- Start with HOST AGENT ---
    const currentAgentId: AgentId = 'HostAgent';
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentId);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    // --------------------------

    const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
    let history: HistoryItem[] = [...historyForHandler, userTurn]; // This is the HOST's history
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;
    let currentTurn = 1;
    const MAX_TURNS = 5; // Max turns for the HOST agent loop

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

    const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        return safeEmit(eventName, data);
    };


    try {
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

        while (currentTurn <= MAX_TURNS) {
            logToFile(`--- [${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Sending to Model (History size: ${history.length}) ---`);
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? 'Thinking based on previous results...' : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before Model call in Turn ${currentTurn}.`); return; }

            // --- Call the Host Agent's LLM ---
            const modelResult: GeminiInteractionResult = await chatbotService.generateTurn(
                [], history, chatbotGenerationConfig, systemInstructions, tools
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after HostAgent Model call in Turn ${currentTurn}.`); return; }

            // --- Process Host Agent's Response ---
            if (modelResult.status === "final_text") {
                // Host agent decided to respond directly
                logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Received final_text.`);
                statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Please follow the instructions on screen." : "Okay.");
                const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }] };
                history.push(finalModelTurn);
                logToFile(`[${handlerId} History Check - Final] Appended final HostAgent response. History size: ${history.length}`);
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText }); // safeEmit handles adding action/thoughts
                return { history: history, action: finalFrontendAction }; // <<< EXIT LOOP: Interaction successful

            } else if (modelResult.status === "error") {
                logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Received error from model: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `An error occurred processing your request (Turn ${currentTurn}).`, step: 'thinking' });
                return { history: history };

            } else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                const functionCall = modelResult.functionCall;
                logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Requested function call: ${functionCall.name}`);

                // Append Host's request to its history
                const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} History Check - Host FC Prep ${currentTurn}] Appended HostAgent FC request. History size: ${history.length}`);


                let functionResponseContent: string | null = null;
                let functionError: string | undefined = undefined;

                if (functionCall.name === 'routeToAgent') {


                    // --- TYPE ASSERTION HERE ---
                    const routeArgs = functionCall.args as RouteToAgentArgs;
                    // --------------------------

                    statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });


                    // --- Use the typed variable 'routeArgs' ---
                    const targetAgent = routeArgs.targetAgent;
                    const taskDescription = routeArgs.taskDescription;
                    const inputData = routeArgs.inputData;
                    // -----------------------------------------

                    // Expand allowed agents
                    const allowedSubAgents: AgentId[] = ['ConferenceAgent', 'JournalAgent', 'AdminContactAgent', 'NavigationAgent', 'WebsiteInfoAgent']; // <-- Add WebsiteInfoAgent

                    // Validation
                    if (!targetAgent || !taskDescription /* inputData can be optional for WebsiteInfo */) {
                        functionError = "Routing failed: Missing targetAgent or taskDescription.";
                        logToFile(`[${handlerId} Error] Invalid routing arguments: ${JSON.stringify(functionCall.args)}`);
                    }
                    else if (!allowedSubAgents.includes(targetAgent as AgentId)) {
                        functionError = `Routing failed: Agent "${targetAgent}" is not supported or implemented yet.`;
                        logToFile(`[${handlerId} Error] Unsupported target agent: ${targetAgent}`);
                    }
                    else {
                        // --- Prepare and Call Sub Agent ---
                        const requestCard: AgentCardRequest = {
                            taskId: uuidv4(),
                            conversationId: conversationId,
                            senderAgentId: 'HostAgent',
                            receiverAgentId: targetAgent,
                            timestamp: new Date().toISOString(),
                            taskDescription: taskDescription,
                            inputData: inputData || {}, // Ensure inputData exists
                            context: { userToken: socket.data.token }
                        };

                        const subAgentResponse: AgentCardResponse = await callSubAgent(
                            requestCard, handlerId, language, socket
                        );

                        // --- Process Sub Agent Response ---
                        if (subAgentResponse.status === 'success') {
                            functionResponseContent = JSON.stringify(subAgentResponse.resultData || "Sub agent provided no data.");
                            if (subAgentResponse.frontendAction) {
                                finalFrontendAction = subAgentResponse.frontendAction;
                                logToFile(`[${handlerId}] Stored frontendAction returned from ${targetAgent}.`);
                            }
                        } else {
                            functionError = subAgentResponse.errorMessage || `Error occurred in ${targetAgent}.`;
                        }
                    }
                    // --- END Sub Agent Call Logic ---

                } else {
                    // --- THIS BLOCK SHOULD NOT BE REACHED if Host Agent is configured correctly ---
                    logToFile(`[${handlerId} ERROR] HostAgent attempted to call function '${functionCall.name}' directly, but it should only use 'routeToAgent'. Check HostAgent prompt and tool configuration.`);
                    functionError = `Internal configuration error: HostAgent cannot directly call function '${functionCall.name}'.`;
                    // -------------------------------------------------------------------------
                }


                // --- Prepare Function Response for Host Agent ---
                if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected after function/routing execution in Turn ${currentTurn}.`); return; }

                const responsePartContent = functionError ? { error: functionError } : { content: functionResponseContent };
                const functionResponsePart: FunctionResponsePart = {
                    functionResponse: {
                        name: functionCall.name, // Use the original function name called by Host
                        response: responsePartContent
                    }
                };
                const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
                history.push(functionTurn);
                logToFile(`[${handlerId} History Check - Host FC Done ${currentTurn}] Appended function/routing response. History size: ${history.length}`);

                currentTurn++;
                continue; // <<< CONTINUE HOST AGENT LOOP

            } else {
                // Unexpected status from Host Agent LLM
                logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Received unexpected model status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                return { history: history };
            }
        } // End while loop

        if (currentTurn > MAX_TURNS) {
            logToFile(`[${handlerId} Socket ${socketId}] Error: HostAgent Exceeded maximum interaction turns (${MAX_TURNS}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck.', step: 'max_turns_exceeded' });
            return { history: history };
        }

    } catch (error: any) {
        logToFile(`[${handlerId} Socket ${socketId} Lang: ${language}] CRITICAL Error in handleNonStreaming (HostAgent): ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'unknown_handler_error' });
        return { history: history };
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
    return { history: history }; // Should be unreachable
}



// // --- handleStreaming function ---
// export async function handleStreaming(
//     userInput: string,
//     currentHistoryFromSocket: HistoryItem[],
//     socket: Socket,
//     language: Language,
//     handlerId: string, // <<< Added handlerId parameter
//     onActionGenerated?: (action: FrontendAction) => void // <<< Added callback parameter
// ): Promise<HistoryItem[] | void> { // Return type remains the same

//     // <<< Use the passed handlerId >>>
//     // const handlerId = `Handler-S-${Date.now()}`; // Remove this line
//     const socketId = socket.id;
//     logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

//     // --- Get Language Config --- (No changes)
//     const { systemInstructions, functionDeclarations } = getLanguageConfig(language);
//     const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
//     logToFile(`[${handlerId}] Using System Instructions (Lang: ${language}): ${systemInstructions.substring(0, 100)}...`);
//     logToFile(`[${handlerId}] Using Tools (Lang: ${language}): ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);

//     // --- State Variables --- (No changes)
//     let history: HistoryItem[] = [...currentHistoryFromSocket];
//     const thoughts: ThoughtStep[] = [];
//     let frontendActionToSend: FrontendAction | undefined = undefined; // To store action from executeFunction

//     // --- Safe Emit Helper (Collects Thoughts, Adds Context to Final Events) ---
//     const safeEmit = (eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate): boolean => {
//         if (!socket.connected) { logToFile(`[${handlerId} Emit SKIPPED - ${socketId}] Client disconnected. Event: ${eventName}`); return false; }
//         try {
//             // Collect thoughts from status updates
//             if (eventName === 'status_update' && data.type === 'status') {
//                 thoughts.push({ step: data.step, message: data.message, timestamp: new Date().toISOString(), details: (data as StatusUpdate).details });
//             }

//             let dataToSend: any = data; // Use 'any' temporarily

//             // Add collected thoughts and potential action to final result/error
//             if ((eventName === 'chat_result' || eventName === 'chat_error')) {
//                 // Clone and add context
//                 dataToSend = { ...data, thoughts: thoughts };
//                 if (eventName === 'chat_result' && frontendActionToSend) {
//                     (dataToSend as ResultUpdate).action = frontendActionToSend; // Type assertion
//                     logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final stream event: ${JSON.stringify(frontendActionToSend)}`);
//                 }
//             }

//             socket.emit(eventName, dataToSend); // Emit potentially modified data
//             logToFile(`[${handlerId} Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`); return true;
//         } catch (error: any) { logToFile(`[${handlerId} Emit FAILED - ${socketId}] Error: ${error.message}. Event: ${eventName}`); return false; }
//     };


//     // --- Helper to Process Stream Chunks ---
//     // (This helper remains largely unchanged, focused on stream consumption and partial updates)
//     async function processAndEmitStream(
//         stream: AsyncGenerator<EnhancedGenerateContentResponse>,
//         emitFinalResult: boolean = true // Controls if this helper sends the 'chat_result'
//     ): Promise<{ fullText: string } | null> {
//         let accumulatedText = "";
//         let streamFinished = false;
//         logToFile(`[${handlerId} Stream Processing - ${socketId}] Starting... (Emit final: ${emitFinalResult})`);

//         // Emit initial streaming status *once* before the loop
//         if (!safeEmit('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) {
//             logToFile(`[${handlerId} Stream Processing Abort - ${socketId}] Failed initial status emit (disconnected?).`);
//             return null; // Can't proceed if disconnected
//         }


//         try {
//             for await (const chunk of stream) {
//                 if (!socket.connected) { logToFile(`[${handlerId} Stream Abort - ${socketId}] Disconnected during stream.`); return null; }

//                 // We expect potential function calls *before* the stream starts,
//                 // or text chunks during the stream. The Gemini API generally doesn't
//                 // embed function calls *within* text chunks in a streaming response.
//                 // Therefore, we only need to process text here.
//                 const chunkText = chunk.text();
//                 if (chunkText) {
//                     accumulatedText += chunkText;
//                     // Use the safeEmit helper
//                     if (!safeEmit('chat_update', { type: 'partial_result', textChunk: chunkText })) {
//                         // If emitting fails, likely disconnected, abort stream processing
//                         logToFile(`[${handlerId} Stream Abort - ${socketId}] Failed to emit chat_update.`);
//                         return null;
//                     }
//                 }
//             }
//             streamFinished = true;
//             logToFile(`[${handlerId} Stream Processing - ${socketId}] Finished. Length: ${accumulatedText.length}`);

//             // --- Conditional Final Emit ---
//             if (emitFinalResult) {
//                 logToFile(`[${handlerId} Stream Processing - ${socketId}] Emitting final chat_result via safeEmit.`);
//                 // safeEmit will automatically add thoughts and frontendActionToSend if available
//                 if (!safeEmit('chat_result', { type: 'result', message: accumulatedText })) {
//                     logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Failed to emit final chat_result.`);
//                     // Don't return null here, as text was processed, but signal potential issue.
//                     // The main handler will still return the history.
//                 }
//             }
//             return { fullText: accumulatedText }; // Return the accumulated text regardless of final emit success

//         } catch (error: any) {
//             logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
//             // safeEmit will add thoughts automatically
//             safeEmit('chat_error', { type: 'error', message: `Error processing stream: ${error.message}`, step: 'streaming_response' });
//             return null; // Indicate failure to process stream
//         } finally {
//             // Log if the loop finished unexpectedly (e.g., break/return without setting flag)
//             if (!streamFinished) logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Stream loop exited unexpectedly.`);
//         }
//     }


//     // --- Main Streaming Logic ---
//     try {
//         // 0. Initial Status & Append User Input
//         if (!safeEmit('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return; // Check connection early
//         const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
//         history.push(userTurn);
//         logToFile(`[${handlerId} History Init - ${socketId}] Added user turn. Size: ${history.length}`);

//         // --- Turn 1: Initial Model Call ---
//         logToFile(`--- [${handlerId} Turn 1 Start - ${socketId}] Requesting initial stream ---`);
//         if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return;
//         if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected before model call.`); return; }

//         logToFile(`[${handlerId} History T1 Send - ${socketId}] Size: ${history.length}`);
//         // Call Gemini Service (assuming generateStream handles potential non-stream responses like errors/FCs)
//         const initialResult = await chatbotService.generateStream([], history, chatbotGenerationConfig, systemInstructions, tools);

//         if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected after model call response received.`); return; }

//         // --- Process Initial Result ---
//         if (initialResult.error) {
//             logToFile(`[${handlerId} Error T1 - ${socketId}] Model returned error: ${initialResult.error}`);
//             safeEmit('chat_error', { type: 'error', message: initialResult.error, step: 'thinking' });
//             return history; // Return history up to the point of error

//         } else if (initialResult.functionCalls) {
//             // --- Function Call Required ---
//             logToFile(`--- [${handlerId} Turn 2 Start - ${socketId}] Function Call Required: ${initialResult.functionCalls.name} ---`);
//             const functionCall = initialResult.functionCalls;
//             const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
//             history.push(modelFunctionCallTurn);
//             logToFile(`[${handlerId} History T2 Prep - ${socketId}] Added model FC request. Size: ${history.length}`);

//             if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected before function execution.`); return; }

//             // Execute Function Call using the Registry
//             const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
//                 return safeEmit(eventName, data);
//             };

//             const functionResult = await executeFunction( // <<< Get the full result object
//                 functionCall,
//                 handlerId,
//                 language,
//                 statusUpdateCallback,
//                 socket
//             );
//             // functionResult is { modelResponseContent: string, frontendAction?: FrontendAction }

//             // <<< --- MODIFICATION START --- >>>
//             // STORE POTENTIAL ACTION and NOTIFY SERVER
//             if (functionResult.frontendAction) {
//                 frontendActionToSend = functionResult.frontendAction; // Store it for final emit
//                 logToFile(`[${handlerId} ${socketId}] Stored frontendAction from '${functionCall.name}' execution.`);
//                 // --- CALL THE CALLBACK passed from server.ts ---
//                 if (onActionGenerated) {
//                     onActionGenerated(frontendActionToSend);
//                     logToFile(`[${handlerId} ${socketId}] Notified caller (server.ts) about generated action.`);
//                 } else {
//                     logToFile(`[${handlerId} ${socketId}] Warning: onActionGenerated callback was not provided.`);
//                 }
//                 // ---------------------------------------------
//             }
//             // <<< --- MODIFICATION END --- >>>



//             if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected after function execution completed.`); return; }

//             // Append Function Response to History (Use modelResponseContent from functionResult)
//             const functionResponsePart: FunctionResponsePart = { functionResponse: { name: functionCall.name, response: { content: functionResult.modelResponseContent } } };
//             const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
//             history.push(functionTurn);
//             logToFile(`[${handlerId} History T2 Done - ${socketId}] Added function response. Size: ${history.length}`);


//             // --- Turn 3: Second Model Call (Request Final Stream) --- (No changes in this block's logic)
//             logToFile(`--- [${handlerId} Turn 3 Start - ${socketId}] Requesting final stream after function call ---`);
//             if (!safeEmit('status_update', { type: 'status', step: 'thinking', message: 'Thinking based on function results...' })) return;
//             if (!socket.connected) { logToFile(`[${handlerId} Abort T3 - ${socketId}] Disconnected before final model call.`); return; }
//             const finalResult = await chatbotService.generateStream([], history, chatbotGenerationConfig, systemInstructions, tools);
//             if (!socket.connected) { logToFile(`[${handlerId} Abort T3 - ${socketId}] Disconnected after final model call response received.`); return; }

//             // --- Process Final Result --- (No changes in this block's logic)
//             if (finalResult.error) {
//                 logToFile(`[${handlerId} Error T3 - ${socketId}] Model returned error on final call: ${finalResult.error}`);
//                 safeEmit('chat_error', { type: 'error', message: finalResult.error, step: 'thinking' });
//                 return history;
//             } else if (finalResult.functionCalls) {
//                 logToFile(`[${handlerId} Error T3 - ${socketId}] Unexpected second function call requested.`);
//                 safeEmit('chat_error', { type: 'error', message: 'Unexpected AI response.', step: 'thinking' });
//                 const unexpectedTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCalls }] };
//                 history.push(unexpectedTurn);
//                 return history;
//             } else if (finalResult.stream) {
//                 logToFile(`[${handlerId} Stream T3 - ${socketId}] Processing final stream...`);
//                 // processAndEmitStream will emit the final chat_result *including the stored frontendActionToSend*
//                 const streamOutput = await processAndEmitStream(finalResult.stream, true);
//                 if (streamOutput) {
//                     const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
//                     history.push(finalModelTurn);
//                     logToFile(`[${handlerId} History T3 Done - ${socketId}] Appended final model response. Size: ${history.length}`);
//                     return history; // <<< SUCCESSFUL COMPLETION (MULTI-TURN STREAM)
//                 } else {
//                     logToFile(`[${handlerId} Error T3 - ${socketId}] Final stream processing failed.`);
//                     return history;
//                 }
//             } else {
//                 logToFile(`[${handlerId} Error T3 - ${socketId}] Unexpected empty state from final model call.`);
//                 safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected final response.', step: 'thinking' });
//                 return history;
//             }
//             // --- End Turn 3 Logic ---

//         } else if (initialResult.stream) {
//             // --- Initial Result is a Stream --- (No changes needed, no action expected here)
//             logToFile(`[${handlerId} Stream T1 - ${socketId}] Processing initial stream directly...`);
//             // processAndEmitStream will emit the final chat_result (no action expected here)
//             const streamOutput = await processAndEmitStream(initialResult.stream, true);
//             if (streamOutput) {
//                 const modelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
//                 history.push(modelTurn);
//                 logToFile(`[${handlerId} History T1 Done - ${socketId}] Appended initial model response. Size: ${history.length}`);
//                 return history; // <<< SUCCESSFUL COMPLETION (SINGLE-TURN STREAM)
//             } else {
//                 logToFile(`[${handlerId} Error T1 - ${socketId}] Initial stream processing failed.`);
//                 return history;
//             }

//         } else { // (No changes)
//             logToFile(`[${handlerId} Error T1 - ${socketId}] Unexpected empty state from initial model call.`);
//             safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected initial response.', step: 'thinking' });
//             return history;
//         }

//     } catch (error: any) { // (No changes)
//         logToFile(`[${handlerId} CRITICAL Error - ${socketId} Lang: ${language}] ${error.message}\nStack: ${error.stack}`);
//         safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'handler_exception' });
//         return history;
//     } finally { // (No changes)
//         logToFile(`--- [${handlerId} ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
//     }
// }


// --- handleStreaming function - Updated with A2A Logic ---
export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    onActionGenerated?: (action: FrontendAction) => void
): Promise<HistoryItem[] | void> {

    const socketId = socket.id;
    const conversationId = handlerId; // Use handlerId as conversationId
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

    // --- Start with HOST AGENT Config ---
    const currentAgentId: AgentId = 'HostAgent';
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentId);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    logToFile(`[${handlerId}] Using HostAgent Config (Lang: ${language}). Tools: ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);
    // ----------------------------------

    let history: HistoryItem[] = [...currentHistoryFromSocket];
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined; // <<< Changed name for clarity

    // --- Safe Emit Helper (Remains the same) ---
    const safeEmit = ( eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate): boolean => {
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
                if (eventName === 'chat_result' && finalFrontendAction) { // <<< Use finalFrontendAction
                    (dataToSend as ResultUpdate).action = finalFrontendAction; // Type assertion
                    logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final stream event: ${JSON.stringify(finalFrontendAction)}`);
                }
            }

            socket.emit(eventName, dataToSend); // Emit potentially modified data
            logToFile(`[${handlerId} Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`); return true;
        } catch (error: any) { logToFile(`[${handlerId} Emit FAILED - ${socketId}] Error: ${error.message}. Event: ${eventName}`); return false; }
    };

    // --- Status Update Callback ---
    const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        return safeEmit(eventName, data);
    };


    // --- Helper to Process Stream Chunks (Remains the same) ---
    async function processAndEmitStream(
        stream: AsyncGenerator<EnhancedGenerateContentResponse>,
        emitFinalResult: boolean = true
    ): Promise<{ fullText: string } | null> {
        let accumulatedText = "";
        let streamFinished = false;
        logToFile(`[${handlerId} Stream Processing - ${socketId}] Starting... (Emit final: ${emitFinalResult})`);

        if (!statusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) {
             logToFile(`[${handlerId} Stream Processing Abort - ${socketId}] Failed initial status emit (disconnected?).`);
            return null;
        }

        try {
            for await (const chunk of stream) {
                if (!socket.connected) { logToFile(`[${handlerId} Stream Abort - ${socketId}] Disconnected during stream.`); return null; }
                const chunkText = chunk.text();
                if (chunkText) {
                    accumulatedText += chunkText;
                     if (!safeEmit('chat_update', { type: 'partial_result', textChunk: chunkText })) {
                         logToFile(`[${handlerId} Stream Abort - ${socketId}] Failed to emit chat_update.`);
                        return null;
                    }
                }
            }
            streamFinished = true;
            logToFile(`[${handlerId} Stream Processing - ${socketId}] Finished. Length: ${accumulatedText.length}`);

            if (emitFinalResult) {
                logToFile(`[${handlerId} Stream Processing - ${socketId}] Emitting final chat_result via safeEmit.`);
                // safeEmit will add thoughts and finalFrontendAction automatically
                if (!safeEmit('chat_result', { type: 'result', message: accumulatedText })) {
                    logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Failed to emit final chat_result.`);
                }
            }
            return { fullText: accumulatedText };

        } catch (error: any) {
            logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
            safeEmit('chat_error', { type: 'error', message: `Error processing stream: ${error.message}`, step: 'streaming_response' });
            return null;
        } finally {
            if (!streamFinished) logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Stream loop exited unexpectedly.`);
        }
    }


    // --- Main Streaming Logic with A2A ---
    try {
        // 0. Initial Status & Append User Input
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;
        const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
        history.push(userTurn);
        logToFile(`[${handlerId} History Init - ${socketId}] Added user turn. Size: ${history.length}`);

        // --- Turn 1: Initial HOST AGENT Call ---
        logToFile(`--- [${handlerId} HostAgent Turn 1 Start - ${socketId}] Requesting initial response from HostAgent ---`);
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return;
        if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected before HostAgent model call.`); return; }

        logToFile(`[${handlerId} History T1 Send - ${socketId}] Host History Size: ${history.length}`);
        // Call Host Agent
        const initialResult = await chatbotService.generateStream(
            [], history, chatbotGenerationConfig, systemInstructions, tools
        );

        if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected after HostAgent model call response received.`); return; }

        // --- Process Host Agent Initial Response ---
        if (initialResult.error) {
            logToFile(`[${handlerId} Error T1 - ${socketId}] HostAgent model returned error: ${initialResult.error}`);
            safeEmit('chat_error', { type: 'error', message: initialResult.error, step: 'thinking' });
            return history;

        } else if (initialResult.functionCalls) {
            // --- Host Agent Requires Routing ---
            const functionCall = initialResult.functionCalls;
            logToFile(`[${handlerId} HostAgent T1 - ${socketId}] HostAgent requested function call: ${functionCall.name}`);

            // Append Host's request to its history
            const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
            history.push(modelFunctionCallTurn);
            logToFile(`[${handlerId} History T1 Prep - ${socketId}] Appended HostAgent FC request. Size: ${history.length}`);

            let functionResponseContent: string | null = null;
            let functionError: string | undefined = undefined;

            // --- Verify it's the routeToAgent call ---
            if (functionCall.name === 'routeToAgent') {
                const routeArgs = functionCall.args as RouteToAgentArgs; // Type assertion
                statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });

                const targetAgent = routeArgs.targetAgent;
                const taskDescription = routeArgs.taskDescription;
                const inputData = routeArgs.inputData;

                // --- Validation (Copied from non-streaming) ---
                const allowedSubAgents: AgentId[] = ['ConferenceAgent', 'JournalAgent', 'AdminContactAgent', 'NavigationAgent', 'WebsiteInfoAgent'];
                if (!targetAgent || !taskDescription) {
                    functionError = "Routing failed: Missing targetAgent or taskDescription.";
                    logToFile(`[${handlerId} Error] Invalid routing arguments: ${JSON.stringify(functionCall.args)}`);
                } else if (!allowedSubAgents.includes(targetAgent as AgentId)) {
                    functionError = `Routing failed: Agent "${targetAgent}" is not supported.`;
                    logToFile(`[${handlerId} Error] Unsupported target agent: ${targetAgent}`);
                } else {
                    // --- Prepare and Call Sub Agent ---
                    const requestCard: AgentCardRequest = {
                        taskId: uuidv4(),
                        conversationId: conversationId,
                        senderAgentId: 'HostAgent',
                        receiverAgentId: targetAgent,
                        timestamp: new Date().toISOString(),
                        taskDescription: taskDescription,
                        inputData: inputData || {},
                        context: { userToken: socket.data.token }
                    };

                    // --- Call the Sub Agent ---
                    logToFile(`--- [${handlerId} SubAgent Call Start - ${socketId}] Calling ${targetAgent} via callSubAgent ---`);
                    const subAgentResponse: AgentCardResponse = await callSubAgent(
                        requestCard, handlerId, language, socket // Pass socket here
                    );
                    logToFile(`--- [${handlerId} SubAgent Call End - ${socketId}] ${targetAgent} finished. Status: ${subAgentResponse.status} ---`);


                    // --- Process Sub Agent Response ---
                    if (subAgentResponse.status === 'success') {
                        functionResponseContent = JSON.stringify(subAgentResponse.resultData || "Sub agent completed task."); // Provide content for Host history
                        if (subAgentResponse.frontendAction) {
                            finalFrontendAction = subAgentResponse.frontendAction; // Store action for final emit
                            logToFile(`[${handlerId} ${socketId}] Stored frontendAction from ${targetAgent}.`);
                            // --- Notify server.ts about the action ---
                            onActionGenerated?.(finalFrontendAction);
                        }
                    } else {
                        functionError = subAgentResponse.errorMessage || `Error occurred in ${targetAgent}.`;
                    }
                }
                // --- END Sub Agent Call Logic ---

            } else {
                // Host agent called something other than routeToAgent - ERROR
                logToFile(`[${handlerId} ERROR T1 - ${socketId}] HostAgent called unexpected function '${functionCall.name}'. Only 'routeToAgent' expected.`);
                functionError = `Internal configuration error: HostAgent called invalid function '${functionCall.name}'.`;
            }

            // --- Prepare Function Response for Host Agent History ---
            if (!socket.connected) { logToFile(`[${handlerId} Abort T1 - ${socketId}] Disconnected after routing/sub-agent execution.`); return; }

            const responsePartContent = functionError ? { error: functionError } : { content: functionResponseContent };
            const functionResponsePart: FunctionResponsePart = {
                functionResponse: { name: functionCall.name, response: responsePartContent }
            };
            const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
            history.push(functionTurn);
            logToFile(`[${handlerId} History T1 Done - ${socketId}] Appended function/routing response to Host history. Size: ${history.length}`);

            // --- Turn 2: Second HOST AGENT Call (Request Final Stream) ---
            logToFile(`--- [${handlerId} HostAgent Turn 2 Start - ${socketId}] Requesting final stream from HostAgent ---`);
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: 'Synthesizing response...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected before final HostAgent model call.`); return; }

            logToFile(`[${handlerId} History T2 Send - ${socketId}] Host History Size: ${history.length}`);
            const finalResult = await chatbotService.generateStream(
                 [], history, chatbotGenerationConfig, systemInstructions, tools // Still Host Agent config
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort T2 - ${socketId}] Disconnected after final HostAgent model call response received.`); return; }

            // --- Process Final Result from Host Agent ---
            if (finalResult.error) {
                logToFile(`[${handlerId} Error T2 - ${socketId}] HostAgent model returned error on final call: ${finalResult.error}`);
                safeEmit('chat_error', { type: 'error', message: finalResult.error, step: 'thinking' });
                logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                return history;
            } else if (finalResult.functionCalls) {
                // Should not happen ideally, Host should provide text now
                logToFile(`[${handlerId} Error T2 - ${socketId}] HostAgent requested another function call unexpectedly.`);
                safeEmit('chat_error', { type: 'error', message: 'Unexpected AI response during final synthesis.', step: 'thinking' });
                const unexpectedTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCalls }] };
                history.push(unexpectedTurn);
                logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                return history;
            } else if (finalResult.stream) {
                logToFile(`[${handlerId} Stream T2 - ${socketId}] Processing final stream from HostAgent...`);
                // Process the final stream - safeEmit inside processAndEmitStream will attach finalFrontendAction
                const streamOutput = await processAndEmitStream(finalResult.stream, true); // Emit final result=true
                if (streamOutput) {
                    const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                    history.push(finalModelTurn);
                    logToFile(`[${handlerId} History T2 Done - ${socketId}] Appended final HostAgent response. Size: ${history.length}`);
                    logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                    return history; // <<< SUCCESSFUL COMPLETION (A2A STREAM)
                } else {
                    logToFile(`[${handlerId} Error T2 - ${socketId}] Final stream processing failed.`);
                    // safeEmit for error was likely called inside processAndEmitStream
                    logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                    return history;
                }
            } else {
                logToFile(`[${handlerId} Error T2 - ${socketId}] Unexpected empty state from final HostAgent model call.`);
                safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected final response.', step: 'thinking' });
                logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                return history;
            }
            // --- End Turn 2 Logic ---

        } else if (initialResult.stream) {
            // --- Initial Host Agent Result is a Stream ---
            // This is less likely now but handle it. No Sub Agent involved here.
            logToFile(`[${handlerId} Stream T1 Direct - ${socketId}] HostAgent provided stream directly. Processing...`);
            const streamOutput = await processAndEmitStream(initialResult.stream, true); // Emit final result=true
            if (streamOutput) {
                const modelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                history.push(modelTurn);
                logToFile(`[${handlerId} History T1 Direct Done - ${socketId}] Appended initial HostAgent response. Size: ${history.length}`);
                logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                return history; // <<< SUCCESSFUL COMPLETION (DIRECT STREAM)
            } else {
                logToFile(`[${handlerId} Error T1 Direct - ${socketId}] Initial stream processing failed.`);
                logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
                return history;
            }

        } else {
            logToFile(`[${handlerId} Error T1 - ${socketId}] Unexpected empty state from initial HostAgent model call.`);
            safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected initial response.', step: 'thinking' });
            logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
            return history;
        }

    } catch (error: any) {
        logToFile(`[${handlerId} CRITICAL Error - ${socketId} Lang: ${language}] ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'handler_exception' });
        logToFile(`[${handlerId} Return History Check] Returning history. Size: ${history.length}. Content: ${JSON.stringify(history, null, 2)}`);
        return history;
    } finally {
        logToFile(`--- [${handlerId} ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}