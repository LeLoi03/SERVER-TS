// src/chatbot/handlers/intentHandler.ts
import 'reflect-metadata'; // Ensure reflect-metadata is imported for tsyringe
import { container } from 'tsyringe'; // Import container for resolving singletons
import {
    GenerationConfig,
    Tool,
    FunctionResponsePart,
    EnhancedGenerateContentResponse,
    Part,
    FunctionDeclaration,
} from "@google/generative-ai";
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import logToFile from '../../utils/logger'; // Điều chỉnh đường dẫn nếu cần
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
    AgentCardRequest,
    AgentCardResponse
} from '../shared/types'; // Điều chỉnh đường dẫn nếu cần
import { Gemini } from '../gemini/gemini'; // Điều chỉnh đường dẫn nếu cần
// import { loadModelConfig } from '../gemini/configLoader'; // **KHÔNG CẦN NỮA** cho chatbot config
import { getAgentLanguageConfig, AgentId } from '../utils/languageConfig'; // Điều chỉnh đường dẫn nếu cần
import { executeFunction } from '../gemini/functionRegistry'; // Điều chỉnh đường dẫn nếu cần
import { ConfigService } from "../../config/config.service"; // **IMPORT ConfigService**

// --- Lấy ConfigService Instance ---
const configService = container.resolve(ConfigService); // Resolve singleton instance

// --- Constants ---
const MAX_TURNS_HOST_AGENT = 5;
const ALLOWED_SUB_AGENTS: AgentId[] = ['ConferenceAgent', 'JournalAgent', 'AdminContactAgent', 'NavigationAgent', 'WebsiteInfoAgent'];

// --- Lấy cấu hình từ ConfigService ---
const geminiApiKey = configService.config.GEMINI_API_KEY; // Lấy API key
const chatbotModelName = configService.config.GEMINI_CHATBOT_MODEL_NAME || "gemini-1.5-flash-latest"; // Lấy tên model chatbot, có fallback

// Log cảnh báo nếu dùng fallback model
if (!configService.config.GEMINI_CHATBOT_MODEL_NAME) {
    logToFile(`Warning: GEMINI_CHATBOT_MODEL_NAME not set in config, using fallback "${chatbotModelName}".`);
}

// Khởi tạo Gemini Service với cấu hình đã lấy
const GEMINI_SERVICE = new Gemini(geminiApiKey, chatbotModelName);

// Tạo Chatbot Generation Config từ ConfigService
const CHATBOT_GENERATION_CONFIG: GenerationConfig = {
    temperature: configService.config.GEMINI_CHATBOT_TEMPERATURE,
    topP: configService.config.GEMINI_CHATBOT_TOP_P,
    topK: configService.config.GEMINI_CHATBOT_TOP_K,
    maxOutputTokens: configService.config.GEMINI_CHATBOT_MAX_OUTPUT_TOKENS,
    // Thêm responseMimeType nếu nó được định nghĩa trong config
    ...(configService.config.GEMINI_CHATBOT_RESPONSE_MIME_TYPE && {
        responseMimeType: configService.config.GEMINI_CHATBOT_RESPONSE_MIME_TYPE
    }),
};

logToFile(`Chatbot Initialized. Model: ${chatbotModelName}, Config: ${JSON.stringify(CHATBOT_GENERATION_CONFIG)}`);


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
    const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${requestCard.taskDescription}\nPlease execute using your available tools.`;
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
        const subAgentResult: GeminiInteractionResult = await GEMINI_SERVICE.generateTurn(
            [], subAgentHistory, CHATBOT_GENERATION_CONFIG, systemInstructions, subAgentTools
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
            const modelResult: GeminiInteractionResult = await GEMINI_SERVICE.generateTurn(
                [], history, CHATBOT_GENERATION_CONFIG, systemInstructions, tools
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
    const conversationId = handlerId;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

    const currentAgentId: AgentId = 'HostAgent';
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentId);
    const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
    logToFile(`[${handlerId}] Using HostAgent Config (Lang: ${language}). Tools: ${functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);

    let history: HistoryItem[] = [...currentHistoryFromSocket];
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;

    
    // --- Safe Emit Helper (Remains the same) ---
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


            return { fullText: accumulatedText };

        } catch (error: any) {
            logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
            throw error; // Re-throw to be caught by the main loop
        } finally {
            if (!streamFinished) logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Stream loop exited unexpectedly.`);
        }
    }


    // --- Main Streaming Logic with Loop ---
    try {
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;
        const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
        if (history.length === 0 || history[history.length - 1].parts[0].text !== userInput) { // Avoid duplicate user turns
            history.push(userTurn);
        }
        logToFile(`[${handlerId} History Init - ${socketId}] Added user turn. Size: ${history.length}`);

        let currentHostTurn = 1;
        const MAX_HOST_TURNS = MAX_TURNS_HOST_AGENT; // Use your constant

        while (currentHostTurn <= MAX_HOST_TURNS) {
            logToFile(`--- [${handlerId} HostAgent Turn ${currentHostTurn} Start - ${socketId}] Requesting response from HostAgent ---`);
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? 'Continuing process...' : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected before HostAgent model call.`); return; }

            logToFile(`[${handlerId} History T${currentHostTurn} Send - ${socketId}] Host History Size: ${history.length}`);

            // Determine tools for this turn.
            // If this is the turn *after* a sub-agent has run and we expect a final text response,
            // we might want to provide NO tools to the HostAgent to force it to generate text.
            // However, for complex multi-step routing, it *needs* tools until the very end.
            // The system prompt should guide this. For now, always provide tools.
            const toolsForThisTurn = hostAgentTools;


            const hostAgentLLMResult = await GEMINI_SERVICE.generateStream(
                [], history, CHATBOT_GENERATION_CONFIG, systemInstructions, toolsForThisTurn
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after HostAgent model call response received.`); return; }

            if (hostAgentLLMResult.error) {
                logToFile(`[${handlerId} Error T${currentHostTurn} - ${socketId}] HostAgent model returned error: ${hostAgentLLMResult.error}`);
                safeEmit('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'thinking' });
                return history; // Exit on error
            } else if (hostAgentLLMResult.functionCalls) {
                // --- Host Agent Requires Routing ---
                const functionCall = hostAgentLLMResult.functionCalls; // Assuming only one for now
                logToFile(`[${handlerId} HostAgent T${currentHostTurn} - ${socketId}] HostAgent requested function call: ${functionCall.name}`);

                const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} History T${currentHostTurn} Prep - ${socketId}] Appended HostAgent FC request. Size: ${history.length}`);

                let functionResponseContent: string | null = null;
                let functionError: string | undefined = undefined;

                if (functionCall.name === 'routeToAgent') {
                    const routeArgs = functionCall.args as RouteToAgentArgs;
                    statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });

                    const targetAgent = routeArgs.targetAgent;
                    const taskDescription = routeArgs.taskDescription;

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
                            context: { userToken: socket.data.token }
                        };

                        logToFile(`--- [${handlerId} SubAgent Call Start T${currentHostTurn} - ${socketId}] Calling ${targetAgent} ---`);
                        const subAgentResponse: AgentCardResponse = await callSubAgent(
                            requestCard, handlerId, language, socket
                        );
                        logToFile(`--- [${handlerId} SubAgent Call End T${currentHostTurn} - ${socketId}] ${targetAgent} finished. Status: ${subAgentResponse.status} ---`);

                        if (subAgentResponse.status === 'success') {
                            functionResponseContent = JSON.stringify(subAgentResponse.resultData || "Sub agent completed task.");
                            if (subAgentResponse.frontendAction) {
                                finalFrontendAction = subAgentResponse.frontendAction;
                                logToFile(`[${handlerId} ${socketId}] Stored frontendAction from ${targetAgent}.`);
                                onActionGenerated?.(finalFrontendAction);
                            }
                        } else {
                            functionError = subAgentResponse.errorMessage || `Error occurred in ${targetAgent}.`;
                        }
                    }
                } else {
                    logToFile(`[${handlerId} ERROR T${currentHostTurn} - ${socketId}] HostAgent called unexpected function '${functionCall.name}'.`);
                    functionError = `Internal configuration error: HostAgent called invalid function '${functionCall.name}'.`;
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after routing/sub-agent execution.`); return; }

                const responsePartContent = functionError ? { error: functionError } : { content: functionResponseContent };
                const functionResponsePart: FunctionResponsePart = {
                    functionResponse: { name: functionCall.name, response: responsePartContent }
                };
                const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
                history.push(functionTurn);
                logToFile(`[${handlerId} History T${currentHostTurn} Done - ${socketId}] Appended function/routing response. Size: ${history.length}`);

                currentHostTurn++; // Increment turn and continue loop for HostAgent to process this result
                continue;

            } else if (hostAgentLLMResult.stream) {
                // --- Host Agent provides the final text stream ---
                logToFile(`[${handlerId} Stream T${currentHostTurn} - ${socketId}] Processing final stream from HostAgent...`);
                statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });

                const streamOutput = await processAndEmitStream(hostAgentLLMResult.stream);
                if (streamOutput) {
                    const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                    history.push(finalModelTurn);
                    logToFile(`[${handlerId} History T${currentHostTurn} Done - ${socketId}] Appended final HostAgent response. Size: ${history.length}`);

                    // Emit the final chat_result here, as the loop is about to terminate
                    safeEmit('chat_result', { type: 'result', message: streamOutput.fullText });
                    return history; // <<< SUCCESSFUL COMPLETION
                } else {
                    logToFile(`[${handlerId} Error T${currentHostTurn} - ${socketId}] Final stream processing failed.`);
                    // Error likely emitted within processAndEmitStream or caught by outer try-catch
                    safeEmit('chat_error', { type: 'error', message: 'Failed to process the final response stream.', step: 'streaming_response' });
                    return history; // Exit on stream processing error
                }
            } else {
                logToFile(`[${handlerId} Error T${currentHostTurn} - ${socketId}] Unexpected empty state from HostAgent model call.`);
                safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected response from AI.', step: 'thinking' });
                return history; // Exit
            }
        } // End while loop

        if (currentHostTurn > MAX_HOST_TURNS) {
            logToFile(`[${handlerId} Socket ${socketId}] Error: HostAgent Exceeded maximum interaction turns (${MAX_HOST_TURNS}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck.', step: 'max_turns_exceeded' });
            return history;
        }

    } catch (error: any) {
        logToFile(`[${handlerId} CRITICAL Error - ${socketId} Lang: ${language}] ${error.message}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'handler_exception' });
        return history;
    } finally {
        logToFile(`--- [${handlerId} ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
    // Should be unreachable if logic is correct
    return history;
}
