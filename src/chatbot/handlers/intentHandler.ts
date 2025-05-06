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


// --- Types ---
interface NonStreamingHandlerResult {
    history: HistoryItem[];
    action?: FrontendAction;
}

interface RouteToAgentArgs {
    targetAgent: AgentId | string;
    taskDescription: string;
    inputData?: any;
}

interface AgentLanguageConfig {
    systemInstructions: string | Part | (string | Part)[]; // Sửa lại để linh hoạt hơn
    functionDeclarations: FunctionDeclaration[];
}

/**
 * Handles the invocation of a Sub Agent based on an AgentCardRequest.
 */
async function callSubAgent(
    requestCard: AgentCardRequest,
    parentHandlerId: string,
    language: Language,
    socket: Socket
): Promise<AgentCardResponse> {
    const subAgentId = requestCard.receiverAgentId as AgentId;
    const subHandlerId = `${parentHandlerId}-Sub-${subAgentId}-${requestCard.taskId.substring(0, 8)}`;
    const socketId = socket.id;
    const logPrefix = `[${subHandlerId} Socket ${socketId}]`;

    logToFile(`${logPrefix} --- Calling Sub Agent ${subAgentId} for Task ${requestCard.taskId} ---`);
    logToFile(`${logPrefix} Task Description: ${requestCard.taskDescription}`);

    let subAgentResultData: any = null;
    let subAgentErrorMessage: string | undefined = undefined;
    let subAgentFrontendAction: FrontendAction | undefined = undefined;
    let subAgentStatus: 'success' | 'error' = 'error';

    try {
        // 1. Get Config for Sub Agent
        // Giả định getAgentLanguageConfig có thể lấy config cần thiết (nếu có) từ ConfigService hoặc nguồn khác
        const agentConfig = getAgentLanguageConfig(language, subAgentId) as AgentLanguageConfig; // Type cast
        if (!agentConfig) {
            throw new Error(`Could not load language config for agent ${subAgentId} and language ${language}`);
        }
        const subAgentTools: Tool[] = agentConfig.functionDeclarations?.length > 0 ? [{ functionDeclarations: agentConfig.functionDeclarations }] : [];
        const systemInstructionsString = agentConfig.systemInstructions;

        logToFile(`${logPrefix} Loaded config for ${subAgentId}. Tools: ${agentConfig.functionDeclarations?.map(f => f.name).join(', ') || 'None'}`);
        // logToFile(`${logPrefix} System Instructions (stringified): ${systemInstructionsString?.substring(0, 100)}...`); // Log snippet nếu cần

        // 2. Prepare Input for Sub Agent
        const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${requestCard.taskDescription}\nPlease execute this task using your available tools. Provide the result directly or state if you cannot fulfill the request.`;
        const subAgentInputParts: Part[] = [{ text: subAgentInputText }];
        const subAgentHistory: HistoryItem[] = [{ role: 'user', parts: subAgentInputParts }];

        // 3. Call Sub Agent's LLM
        logToFile(`${logPrefix} Sending request to ${subAgentId} LLM using model ${chatbotModelName}.`); // Sử dụng chatbotModelName đã lấy từ config
        if (!socket.connected) throw new Error(`Client disconnected before calling ${subAgentId} LLM.`);

        const subAgentResult: GeminiInteractionResult = await GEMINI_SERVICE.generateTurn(
            [], // Assuming sub-agent starts fresh, no previous history passed here
            subAgentHistory, // Pass the prepared input history
            CHATBOT_GENERATION_CONFIG, // **SỬ DỤNG CONFIG CHATBOT ĐÃ LẤY TỪ ConfigService**
            systemInstructionsString, // Pass the stringified instructions
            subAgentTools
        );

        if (!socket.connected) throw new Error(`Client disconnected after ${subAgentId} LLM call.`);
        logToFile(`${logPrefix} Received result from ${subAgentId} LLM: Status ${subAgentResult.status}`);

        // 4. Process Sub Agent's Response
        if (subAgentResult.status === "requires_function_call" && subAgentResult.functionCall) {
            const functionCall = subAgentResult.functionCall;
            logToFile(`${logPrefix} ${subAgentId} requested function call: ${functionCall.name}`);

            // Execute the function
            const statusUpdateCallbackStub = (eventName: 'status_update', data: StatusUpdate): boolean => {
                logToFile(`${logPrefix} [SubAgent Status Stub] Step: ${data.step}, Msg: ${data.message}, Details: ${JSON.stringify(data.details)}`);
                return socket.connected; // Check connection status
            };

            // Giả định executeFunction có thể cần ConfigService hoặc các config khác được truyền vào nếu cần
            const functionResult = await executeFunction(
                functionCall,
                subHandlerId,
                language,
                statusUpdateCallbackStub,
                socket,
                requestCard.context // Pass context if needed by functions
            );
            logToFile(`${logPrefix} Function ${functionCall.name} executed. Result Snippet: ${String(functionResult.modelResponseContent).substring(0, 100)}...`);

            if (typeof functionResult.modelResponseContent === 'string' && functionResult.modelResponseContent.toLowerCase().startsWith('error:')) {
                subAgentErrorMessage = functionResult.modelResponseContent;
                subAgentStatus = 'error';
            } else {
                subAgentResultData = functionResult.modelResponseContent; // Có thể là string, object, etc.
                subAgentStatus = 'success';
                subAgentFrontendAction = functionResult.frontendAction;
            }

        } else if (subAgentResult.status === "final_text") {
            logToFile(`${logPrefix} ${subAgentId} provided direct text response: ${subAgentResult.text}`);
            subAgentResultData = subAgentResult.text;
            subAgentStatus = 'success';
        } else {
            subAgentErrorMessage = subAgentResult.errorMessage || `Error processing task in ${subAgentId} (Status: ${subAgentResult.status}).`;
            logToFile(`${logPrefix} Error during ${subAgentId} LLM interaction: ${subAgentErrorMessage}`);
            subAgentStatus = 'error';
        }

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logPrefix} CRITICAL Error calling Sub Agent ${subAgentId}: ${errorMsg} Stack: ${error.stack}`);
        subAgentErrorMessage = `Failed to execute task via ${subAgentId}: ${errorMsg}`;
        subAgentStatus = 'error';
    }

    // 5. Construct Response Card
    const responseCard: AgentCardResponse = {
        taskId: requestCard.taskId,
        conversationId: requestCard.conversationId,
        senderAgentId: subAgentId,
        receiverAgentId: requestCard.senderAgentId,
        timestamp: new Date().toISOString(),
        status: subAgentStatus,
        resultData: subAgentResultData,
        errorMessage: subAgentErrorMessage,
        frontendAction: subAgentFrontendAction,
    };

    logToFile(`${logPrefix} --- Sub Agent ${subAgentId} finished Task ${requestCard.taskId}. Status: ${responseCard.status}, Action: ${!!responseCard.frontendAction} ---`);
    return responseCard;
}

/**
 * Handles non-streaming chat interactions, orchestrating between HostAgent and SubAgents.
 */
export async function handleNonStreaming(
    userInput: string,
    historyForHandler: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string
): Promise<NonStreamingHandlerResult | void> { // Return void if aborting early due to disconnection

    const socketId = socket.id;
    const conversationId = handlerId; // Use handlerId for correlation
    const logPrefix = `[${handlerId} Socket ${socketId}]`;
    logToFile(`${logPrefix} --- Handling NON-STREAMING input: "${userInput}", Lang: ${language} ---`);

    // --- Host Agent Setup ---
    const hostAgentId: AgentId = 'HostAgent';
    let hostAgentConfig: AgentLanguageConfig;
    try {
        hostAgentConfig = getAgentLanguageConfig(language, hostAgentId) as AgentLanguageConfig;
    } catch (error: any) {
        logToFile(`${logPrefix} CRITICAL ERROR: Failed to load HostAgent config for lang ${language}. ${error.message}`);
        // Attempt to emit error if possible
        socket.emit('chat_error', { type: 'error', message: `Internal server error: Could not load agent configuration.`, step: 'config_load' });
        return; // Cannot proceed
    }
    const hostAgentTools: Tool[] = hostAgentConfig.functionDeclarations.length > 0 ? [{ functionDeclarations: hostAgentConfig.functionDeclarations }] : [];
    // --------------------------

    const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
    let history: HistoryItem[] = [...historyForHandler, userTurn]; // This handler manages the HOST's history
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;
    let currentTurn = 1;

    // --- Local Safe Emit Helper ---
    // Captures 'thoughts' and 'finalFrontendAction' via closure
    const safeEmit = (eventName: 'status_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ResultUpdate | ErrorUpdate): boolean => {
        if (!socket.connected) {
            logToFile(`${logPrefix} [Emit SKIPPED] Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            // Collect thoughts from status updates
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({ step: data.step, message: data.message, timestamp: new Date().toISOString(), details: (data as StatusUpdate).details });
            }

            let dataToSend: any = data;

            // Attach thoughts and action ONLY to the final chat_result or chat_error
            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend = { ...data, thoughts: thoughts }; // Add thoughts
                if (eventName === 'chat_result' && finalFrontendAction) {
                    (dataToSend as ResultUpdate).action = finalFrontendAction; // Add action if present
                    logToFile(`${logPrefix} Attaching finalFrontendAction to ${eventName}: ${JSON.stringify(finalFrontendAction)}`);
                }
            }

            socket.emit(eventName, dataToSend);
            logToFile(`${logPrefix} [Emit Sent] Event: ${eventName}, Type: ${data.type}`);
            return true;
        } catch (error: any) {
            logToFile(`${logPrefix} [Emit FAILED] Error: ${error.message}. Event: ${eventName}`);
            return false;
        }
    };
    // --- Status Callback using local safeEmit ---
    const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => safeEmit(eventName, data);


    try {
        // Initial status update
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return; // Abort if disconnected

        // --- Host Agent Interaction Loop ---
        while (currentTurn <= MAX_TURNS_HOST_AGENT) {
            logToFile(`${logPrefix} --- HostAgent Turn ${currentTurn}/${MAX_TURNS_HOST_AGENT} Start ---`);
            const thinkingMsg = currentTurn > 1 ? 'Thinking based on previous results...' : 'Thinking...';
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: thinkingMsg })) return; // Abort
            if (!socket.connected) { logToFile(`${logPrefix} [Abort] Client disconnected before HostAgent Model call in Turn ${currentTurn}.`); return; }

            // --- Call the Host Agent's LLM ---
            logToFile(`${logPrefix} History Size (Send): ${history.length}`);
            const modelResult: GeminiInteractionResult = await GEMINI_SERVICE.generateTurn(
                [], history, CHATBOT_GENERATION_CONFIG,
                hostAgentConfig.systemInstructions,
                hostAgentTools
            );

            if (!socket.connected) { logToFile(`${logPrefix} [Abort] Client disconnected after HostAgent Model call in Turn ${currentTurn}.`); return; }
            logToFile(`${logPrefix} HostAgent Turn ${currentTurn}: Received Model Status: ${modelResult.status}`);

            // --- Process Host Agent's Response ---
            switch (modelResult.status) {
                case "final_text":
                    // Host agent decided to respond directly
                    statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                    const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Okay, please follow the instructions on your screen." : "Okay.");
                    const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }] };
                    history.push(finalModelTurn);
                    logToFile(`${logPrefix} History Update: Appended final HostAgent response. Size: ${history.length}`);
                    safeEmit('chat_result', { type: 'result', message: finalModelResponseText }); // Emits final result with thoughts/action
                    return { history: history, action: finalFrontendAction }; // <<< EXIT LOOP: Interaction successful

                case "error":
                    logToFile(`${logPrefix} Error Turn ${currentTurn}: HostAgent model error: ${modelResult.errorMessage}`);
                    safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `An error occurred processing your request (Turn ${currentTurn}).`, step: 'thinking' });
                    return { history: history }; // Exit with current history

                case "requires_function_call":
                    if (!modelResult.functionCall) { // Should not happen based on status, but check defensively
                        logToFile(`${logPrefix} Error Turn ${currentTurn}: Status 'requires_function_call' but no functionCall data.`);
                        safeEmit('chat_error', { type: 'error', message: 'Internal error: Invalid response from AI model.', step: 'thinking' });
                        return { history: history };
                    }

                    const functionCall = modelResult.functionCall;
                    logToFile(`${logPrefix} Turn ${currentTurn}: HostAgent requested function call: ${functionCall.name}`);

                    // Append Host's function call request to its history
                    const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                    history.push(modelFunctionCallTurn);
                    logToFile(`${logPrefix} History Update: Appended HostAgent FC request. Size: ${history.length}`);

                    let functionResponseContent: string | null = null;
                    let functionError: string | undefined = undefined;

                    // --- Handle Host Agent's Function Call (Expecting routeToAgent) ---
                    if (functionCall.name === 'routeToAgent') {
                        // --- Validate RouteToAgent Args ---
                        const routeArgs = functionCall.args as RouteToAgentArgs; // Assume structure based on prompt
                        const targetAgent = routeArgs?.targetAgent;
                        const taskDescription = routeArgs?.taskDescription;
                        let routingValidationError: string | undefined;

                        if (!targetAgent || typeof targetAgent !== 'string') {
                            routingValidationError = "Routing failed: Missing or invalid 'targetAgent'.";
                        } else if (!taskDescription || typeof taskDescription !== 'string') {
                            routingValidationError = "Routing failed: Missing or invalid 'taskDescription'.";
                        } else if (!ALLOWED_SUB_AGENTS.includes(targetAgent as AgentId)) {
                            routingValidationError = `Routing failed: Agent "${targetAgent}" is not supported or implemented.`;
                        }

                        if (routingValidationError) {
                            functionError = routingValidationError;
                            logToFile(`${logPrefix} Error Turn ${currentTurn}: Invalid routing arguments: ${JSON.stringify(functionCall.args)}. Reason: ${functionError}`);
                            statusUpdateCallback('status_update', { type: 'status', step: 'routing_error', message: functionError, details: functionCall.args });
                        } else {
                            // --- Arguments Valid: Prepare and Call Sub Agent ---
                            const validTargetAgentId = targetAgent as AgentId; // Cast now safe
                            statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${validTargetAgentId}...`, details: functionCall.args });

                            const requestCard: AgentCardRequest = {
                                taskId: uuidv4(),
                                conversationId: conversationId,
                                senderAgentId: hostAgentId,
                                receiverAgentId: validTargetAgentId,
                                timestamp: new Date().toISOString(),
                                taskDescription: taskDescription,
                                context: { userToken: socket.data.token } // Pass context like token
                            };

                            const subAgentResponse: AgentCardResponse = await callSubAgent(
                                requestCard, handlerId, language, socket
                            );

                            // --- Process Sub Agent Response ---
                            if (subAgentResponse.status === 'success') {
                                // Use stringified data as content for the Host Agent's history
                                functionResponseContent = JSON.stringify(subAgentResponse.resultData ?? "Sub agent completed task successfully.");
                                if (subAgentResponse.frontendAction) {
                                    finalFrontendAction = subAgentResponse.frontendAction; // Store action
                                    logToFile(`${logPrefix} Stored frontendAction from ${validTargetAgentId}.`);
                                }
                                statusUpdateCallback('status_update', { type: 'status', step: 'routing_complete', message: `Received successful response from ${validTargetAgentId}.`, details: { action: !!finalFrontendAction } });
                            } else {
                                functionError = subAgentResponse.errorMessage || `Error occurred in ${validTargetAgentId}.`;
                                logToFile(`${logPrefix} Error Turn ${currentTurn}: Sub agent ${validTargetAgentId} failed: ${functionError}`);
                                statusUpdateCallback('status_update', { type: 'status', step: 'routing_error', message: `Error from ${validTargetAgentId}: ${functionError}` });
                            }
                        }
                        // --- END Sub Agent Call Logic ---

                    } else {
                        // --- Host Agent called a non-routing function (Configuration Error) ---
                        functionError = `Internal configuration error: HostAgent attempted to call unsupported function '${functionCall.name}'. It should only use 'routeToAgent'.`;
                        logToFile(`${logPrefix} ERROR Turn ${currentTurn}: ${functionError}`);
                        statusUpdateCallback('status_update', { type: 'status', step: 'function_error', message: functionError, details: { functionName: functionCall.name } });
                    }

                    // --- Prepare Function Response Part for Host Agent ---
                    if (!socket.connected) { logToFile(`${logPrefix} [Abort] Client disconnected after function/routing execution in Turn ${currentTurn}.`); return; }

                    // Use the error or the stringified content
                    const responsePartContent = functionError
                        ? { error: functionError }
                        : { content: functionResponseContent ?? "Function executed, no specific content returned." }; // Fallback content

                    const functionResponsePart: FunctionResponsePart = {
                        functionResponse: {
                            name: functionCall.name, // Use the original function name called by Host
                            response: responsePartContent
                        }
                    };
                    const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
                    history.push(functionTurn);
                    logToFile(`${logPrefix} History Update: Appended function/routing response. Size: ${history.length}`);

                    currentTurn++; // Increment turn and continue the loop
                    break; // Break switch statement, continue while loop

                default:
                    // Unexpected status from Host Agent LLM
                    logToFile(`${logPrefix} Error Turn ${currentTurn}: Received unexpected model status: ${modelResult.status}`);
                    safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                    return { history: history }; // Exit with current history
            } // End switch
        } // End while loop

        // --- Check if loop exited due to max turns ---
        if (currentTurn > MAX_TURNS_HOST_AGENT) {
            logToFile(`${logPrefix} Error: HostAgent Exceeded maximum interaction turns (${MAX_TURNS_HOST_AGENT}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck in a loop.', step: 'max_turns_exceeded' });
            return { history: history }; // Return current history
        }

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logPrefix} CRITICAL Error in handleNonStreaming: ${errorMsg}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: errorMsg || "An unexpected server error occurred during processing.", step: 'unknown_handler_error' });
        return { history: history }; // Return history on critical error
    } finally {
        logToFile(`${logPrefix} --- NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }

    // This point should ideally be unreachable if the loop terminates correctly
    logToFile(`${logPrefix} Warning: Reached end of handleNonStreaming unexpectedly.`);
    return { history: history };
}

/**
 * Handles streaming chat interactions, orchestrating between HostAgent and SubAgents.
 */
export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    onActionGenerated?: (action: FrontendAction) => void // Callback for server.ts
): Promise<HistoryItem[] | void> { // Return void if aborting early

    const socketId = socket.id;
    const conversationId = handlerId;
    const logPrefix = `[${handlerId} Socket ${socketId}]`;
    logToFile(`${logPrefix} --- Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

    // --- Host Agent Setup ---
    const hostAgentId: AgentId = 'HostAgent';
    let hostAgentConfig: AgentLanguageConfig;
    try {
        hostAgentConfig = getAgentLanguageConfig(language, hostAgentId) as AgentLanguageConfig;
    } catch (error: any) {
        logToFile(`${logPrefix} CRITICAL ERROR: Failed to load HostAgent config for lang ${language}. ${error.message}`);
        socket.emit('chat_error', { type: 'error', message: `Internal server error: Could not load agent configuration.`, step: 'config_load' });
        return; // Cannot proceed
    }
    const hostAgentTools: Tool[] = hostAgentConfig.functionDeclarations.length > 0 ? [{ functionDeclarations: hostAgentConfig.functionDeclarations }] : [];
    logToFile(`${logPrefix} Loaded HostAgent Config (Lang: ${language}). Tools: ${hostAgentConfig.functionDeclarations.map((f: any) => f.name).join(', ') || 'None'}`);
    // ----------------------------------

    let history: HistoryItem[] = [...currentHistoryFromSocket];
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;

    // --- Local Safe Emit Helper (Captures thoughts/action via closure) ---
    const safeEmit = (eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate): boolean => {
        if (!socket.connected) { logToFile(`${logPrefix} [Emit SKIPPED] Client disconnected. Event: ${eventName}`); return false; }
        try {
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({ step: data.step, message: data.message, timestamp: new Date().toISOString(), details: (data as StatusUpdate).details });
            }
            let dataToSend: any = data;
            if ((eventName === 'chat_result' || eventName === 'chat_error')) {
                dataToSend = { ...data, thoughts: thoughts };
                if (eventName === 'chat_result' && finalFrontendAction) {
                    (dataToSend as ResultUpdate).action = finalFrontendAction;
                    logToFile(`${logPrefix} Attaching finalFrontendAction to ${eventName}: ${JSON.stringify(finalFrontendAction)}`);
                }
            }
            socket.emit(eventName, dataToSend);
            logToFile(`${logPrefix} [Emit Sent] Event: ${eventName}, Type: ${data.type}`); return true;
        } catch (error: any) { logToFile(`${logPrefix} [Emit FAILED] Error: ${error.message}. Event: ${eventName}`); return false; }
    };
    // --- Status Callback ---
    const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => safeEmit(eventName, data);

    // --- Local Stream Processing Helper ---
    // Uses the outer 'safeEmit' which correctly handles thoughts and finalFrontendAction
    async function processAndEmitStream(
        stream: AsyncGenerator<EnhancedGenerateContentResponse>,
        isFinalResponse: boolean = true // Flag to control emitting chat_result
    ): Promise<{ fullText: string } | null> {
        let accumulatedText = "";
        let streamFinished = false;
        logToFile(`${logPrefix} [Stream Processing] Starting... (Final emit: ${isFinalResponse})`);

        if (!statusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) {
            logToFile(`${logPrefix} [Stream Processing Abort] Failed initial status emit.`);
            return null;
        }

        try {
            for await (const chunk of stream) {
                if (!socket.connected) { logToFile(`${logPrefix} [Stream Abort] Disconnected during stream.`); return null; }
                const chunkText = chunk.text();
                if (chunkText) {
                    accumulatedText += chunkText;
                    if (!safeEmit('chat_update', { type: 'partial_result', textChunk: chunkText })) {
                        logToFile(`${logPrefix} [Stream Abort] Failed to emit chat_update.`);
                        return null; // Stop processing if emit fails
                    }
                }
                // Add checks here for function calls within the stream if the API supports it
            }
            streamFinished = true;
            logToFile(`${logPrefix} [Stream Processing] Finished. Length: ${accumulatedText.length}`);

            if (isFinalResponse) {
                // Let safeEmit handle adding thoughts/action to the final result
                if (!safeEmit('chat_result', { type: 'result', message: accumulatedText })) {
                    logToFile(`${logPrefix} [Stream Processing Warning] Failed to emit final chat_result.`);
                }
            }
            return { fullText: accumulatedText };

        } catch (error: any) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            logToFile(`${logPrefix} [Stream Processing Error] ${errorMsg}`);
            safeEmit('chat_error', { type: 'error', message: `Error processing AI response stream: ${errorMsg}`, step: 'streaming_response' });
            return null;
        } finally {
            if (!streamFinished) logToFile(`${logPrefix} [Stream Processing Warning] Stream loop exited unexpectedly.`);
        }
    }

    // --- Main Streaming Logic ---
    try {
        // 0. Initial Status & Append User Input
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;
        const userTurn: HistoryItem = { role: 'user', parts: [{ text: userInput }] };
        history.push(userTurn);
        logToFile(`${logPrefix} History Update: Added user turn. Size: ${history.length}`);

        // --- Turn 1: Initial HOST AGENT Call ---
        logToFile(`${logPrefix} --- HostAgent Turn 1 (Stream) Start ---`);
        if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: 'Thinking...' })) return;
        if (!socket.connected) { logToFile(`${logPrefix} [Abort T1] Disconnected before HostAgent model call.`); return; }

        logToFile(`${logPrefix} History Size (Send T1): ${history.length}`);
        const initialResult = await GEMINI_SERVICE.generateStream(
            [], history, CHATBOT_GENERATION_CONFIG,
            hostAgentConfig.systemInstructions,
            hostAgentTools
        );

        if (!socket.connected) { logToFile(`${logPrefix} [Abort T1] Disconnected after HostAgent model call response received.`); return; }

        // --- Process Host Agent Initial Response ---
        if (initialResult.error) {
            logToFile(`${logPrefix} Error T1: HostAgent model returned error: ${initialResult.error}`);
            safeEmit('chat_error', { type: 'error', message: initialResult.error, step: 'thinking' });
            return history; // Return history on error

        } else if (initialResult.functionCalls) {
            // --- Host Agent Requires Routing (Turn 1) ---
            const functionCall = initialResult.functionCalls; // Gemini returns only one FC per turn in current API
            logToFile(`${logPrefix} Turn 1: HostAgent requested function call: ${functionCall.name}`);

            const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
            history.push(modelFunctionCallTurn);
            logToFile(`${logPrefix} History Update: Appended HostAgent FC request. Size: ${history.length}`);

            let functionResponseContent: string | null = null;
            let functionError: string | undefined = undefined;

            // --- Handle routeToAgent (Same logic as non-streaming) ---
            if (functionCall.name === 'routeToAgent') {
                const routeArgs = functionCall.args as RouteToAgentArgs;
                const targetAgent = routeArgs?.targetAgent;
                const taskDescription = routeArgs?.taskDescription;
                let routingValidationError: string | undefined;

                if (!targetAgent || typeof targetAgent !== 'string') {
                    routingValidationError = "Routing failed: Missing or invalid 'targetAgent'.";
                } else if (!taskDescription || typeof taskDescription !== 'string') {
                    routingValidationError = "Routing failed: Missing or invalid 'taskDescription'.";
                } else if (!ALLOWED_SUB_AGENTS.includes(targetAgent as AgentId)) {
                    routingValidationError = `Routing failed: Agent "${targetAgent}" is not supported.`;
                }

                if (routingValidationError) {
                    functionError = routingValidationError;
                    logToFile(`${logPrefix} Error T1: Invalid routing arguments: ${JSON.stringify(functionCall.args)}. Reason: ${functionError}`);
                    statusUpdateCallback('status_update', { type: 'status', step: 'routing_error', message: functionError, details: functionCall.args });
                } else {
                    const validTargetAgentId = targetAgent as AgentId;
                    statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${validTargetAgentId}...`, details: functionCall.args });

                    const requestCard: AgentCardRequest = {
                        taskId: uuidv4(),
                        conversationId: conversationId,
                        senderAgentId: hostAgentId,
                        receiverAgentId: validTargetAgentId,
                        timestamp: new Date().toISOString(),
                        taskDescription: taskDescription,
                        context: { userToken: socket.data.token }
                    };

                    logToFile(`${logPrefix} --- SubAgent Call Start ---`);
                    const subAgentResponse: AgentCardResponse = await callSubAgent(
                        requestCard, handlerId, language, socket
                    );
                    logToFile(`${logPrefix} --- SubAgent Call End - Status: ${subAgentResponse.status} ---`);

                    if (subAgentResponse.status === 'success') {
                        functionResponseContent = JSON.stringify(subAgentResponse.resultData ?? "Sub agent completed task.");
                        if (subAgentResponse.frontendAction) {
                            finalFrontendAction = subAgentResponse.frontendAction; // Store action
                            logToFile(`${logPrefix} Stored frontendAction from ${validTargetAgentId}.`);
                            onActionGenerated?.(finalFrontendAction); // Notify server
                        }
                        statusUpdateCallback('status_update', { type: 'status', step: 'routing_complete', message: `Received successful response from ${validTargetAgentId}.`, details: { action: !!finalFrontendAction } });
                    } else {
                        functionError = subAgentResponse.errorMessage || `Error occurred in ${validTargetAgentId}.`;
                        logToFile(`${logPrefix} Error T1: Sub agent ${validTargetAgentId} failed: ${functionError}`);
                        statusUpdateCallback('status_update', { type: 'status', step: 'routing_error', message: `Error from ${validTargetAgentId}: ${functionError}` });
                    }
                }
            } else {
                // Host agent called something other than routeToAgent - ERROR
                functionError = `Internal configuration error: HostAgent called unexpected function '${functionCall.name}'. Only 'routeToAgent' expected.`;
                logToFile(`${logPrefix} ERROR T1: ${functionError}`);
                statusUpdateCallback('status_update', { type: 'status', step: 'function_error', message: functionError, details: { functionName: functionCall.name } });
            }

            // --- Prepare Function Response for Host Agent History ---
            if (!socket.connected) { logToFile(`${logPrefix} [Abort T1] Disconnected after routing/sub-agent execution.`); return; }

            const responsePartContent = functionError ? { error: functionError } : { content: functionResponseContent ?? "Function executed." };
            const functionResponsePart: FunctionResponsePart = { functionResponse: { name: functionCall.name, response: responsePartContent } };
            const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
            history.push(functionTurn);
            logToFile(`${logPrefix} History Update: Appended function/routing response to Host history. Size: ${history.length}`);

            // --- Turn 2: Second HOST AGENT Call (Request Final Stream) ---
            logToFile(`${logPrefix} --- HostAgent Turn 2 (Stream) Start ---`);
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: 'Synthesizing final response...' })) return;
            if (!socket.connected) { logToFile(`${logPrefix} [Abort T2] Disconnected before final HostAgent model call.`); return; }

            logToFile(`${logPrefix} History Size (Send T2): ${history.length}`);
            const finalResult = await GEMINI_SERVICE.generateStream(
                [], history, CHATBOT_GENERATION_CONFIG,
                hostAgentConfig.systemInstructions,
                hostAgentTools
            );

            if (!socket.connected) { logToFile(`${logPrefix} [Abort T2] Disconnected after final HostAgent model call response received.`); return; }

            // --- Process Final Result from Host Agent (Turn 2) ---
            if (finalResult.error) {
                logToFile(`${logPrefix} Error T2: HostAgent model returned error on final call: ${finalResult.error}`);
                safeEmit('chat_error', { type: 'error', message: finalResult.error, step: 'thinking' });
                return history;
            } else if (finalResult.functionCalls) {
                // Should not happen ideally, Host should provide text now
                logToFile(`${logPrefix} Error T2: HostAgent requested another function call unexpectedly.`);
                safeEmit('chat_error', { type: 'error', message: 'Unexpected AI response during final synthesis.', step: 'thinking' });
                const unexpectedTurn: HistoryItem = { role: 'model', parts: [{ functionCall: finalResult.functionCalls }] };
                history.push(unexpectedTurn);
                return history;
            } else if (finalResult.stream) {
                logToFile(`${logPrefix} Turn 2: Processing final stream from HostAgent...`);
                // processAndEmitStream handles emitting final chat_result with thoughts/action
                const streamOutput = await processAndEmitStream(finalResult.stream, true); // isFinalResponse = true
                if (streamOutput) {
                    const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                    history.push(finalModelTurn);
                    logToFile(`${logPrefix} History Update: Appended final HostAgent response. Size: ${history.length}`);
                    return history; // <<< SUCCESSFUL COMPLETION (A2A STREAM)
                } else {
                    logToFile(`${logPrefix} Error T2: Final stream processing failed.`);
                    // Error likely emitted within processAndEmitStream
                    return history;
                }
            } else {
                logToFile(`${logPrefix} Error T2: Unexpected empty state from final HostAgent model call.`);
                safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected final response.', step: 'thinking' });
                return history;
            }
            // --- End Turn 2 Logic ---

        } else if (initialResult.stream) {
            // --- Initial Host Agent Result is a Stream (Direct Response, No Routing) ---
            logToFile(`${logPrefix} Turn 1: HostAgent provided stream directly. Processing...`);
            // processAndEmitStream handles emitting final chat_result with thoughts/action
            const streamOutput = await processAndEmitStream(initialResult.stream, true); // isFinalResponse = true
            if (streamOutput) {
                const modelTurn: HistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }] };
                history.push(modelTurn);
                logToFile(`${logPrefix} History Update: Appended initial HostAgent stream response. Size: ${history.length}`);
                return history; // <<< SUCCESSFUL COMPLETION (DIRECT STREAM)
            } else {
                logToFile(`${logPrefix} Error T1: Initial stream processing failed.`);
                // Error likely emitted within processAndEmitStream
                return history;
            }

        } else {
            // Unexpected empty state from initial call
            logToFile(`${logPrefix} Error T1: Unexpected empty state from initial HostAgent model call.`);
            safeEmit('chat_error', { type: 'error', message: 'Internal error: Unexpected initial response from AI.', step: 'thinking' });
            return history;
        }

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logToFile(`${logPrefix} CRITICAL Error in handleStreaming: ${errorMsg}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: errorMsg || "An unexpected server error occurred during processing.", step: 'handler_exception' });
        return history; // Return history on critical error
    } finally {
        logToFile(`${logPrefix} --- STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}