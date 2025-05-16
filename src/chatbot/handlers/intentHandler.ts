

// // src/chatbot/handlers/intentHandler.ts
// import 'reflect-metadata';
// import { container } from 'tsyringe';
// import {
//     GenerationConfig,
//     Tool,
//     FunctionResponsePart,
//     EnhancedGenerateContentResponse,
//     Part,
//     FunctionDeclaration,
// } from "@google/generative-ai";
// import { Socket } from 'socket.io';
// import { v4 as uuidv4 } from 'uuid';
// import logToFile from '../../utils/logger';
// import {
//     HistoryItem,
//     GeminiInteractionResult,
//     StatusUpdate,
//     ResultUpdate,
//     ErrorUpdate,
//     ThoughtStep,
//     FrontendAction,
//     ChatUpdate,
//     Language,
//     AgentCardRequest,
//     AgentCardResponse,
//     AgentId, // Đảm bảo AgentId được import
//     FunctionHandlerOutput

// } from '../shared/types';
// import { Gemini } from '../gemini/gemini';
// import { getAgentLanguageConfig } from '../utils/languageConfig';
// import { executeFunction } from '../gemini/functionRegistry';
// import { ConfigService } from "../../config/config.service";

// const configService = container.resolve(ConfigService);

// const MAX_TURNS_HOST_AGENT = 5; // Lấy từ config nếu có
// const ALLOWED_SUB_AGENTS: AgentId[] = ['ConferenceAgent', 'JournalAgent', 'AdminContactAgent', 'NavigationAgent', 'WebsiteInfoAgent']; // Lấy từ config

// const geminiApiKey = configService.config.GEMINI_API_KEY;
// const chatbotModelName = configService.config.GEMINI_CHATBOT_MODEL_NAME || "gemini-1.5-flash-latest";

// if (!configService.config.GEMINI_CHATBOT_MODEL_NAME) {
//     logToFile(`Warning: GEMINI_CHATBOT_MODEL_NAME not set in config, using fallback "${chatbotModelName}".`);
// }

// const GEMINI_SERVICE = new Gemini(geminiApiKey, chatbotModelName);

// const CHATBOT_GENERATION_CONFIG: GenerationConfig = {
//     temperature: configService.config.GEMINI_CHATBOT_TEMPERATURE,
//     topP: configService.config.GEMINI_CHATBOT_TOP_P,
//     topK: configService.config.GEMINI_CHATBOT_TOP_K,
//     maxOutputTokens: configService.config.GEMINI_CHATBOT_MAX_OUTPUT_TOKENS,
//     ...(configService.config.GEMINI_CHATBOT_RESPONSE_MIME_TYPE && {
//         responseMimeType: configService.config.GEMINI_CHATBOT_RESPONSE_MIME_TYPE
//     }),
// };

// logToFile(`Chatbot Initialized. Model: ${chatbotModelName}, Config: ${JSON.stringify(CHATBOT_GENERATION_CONFIG)}`);

// interface NonStreamingHandlerResult {
//     history: HistoryItem[];
//     action?: FrontendAction;
//     // Không cần trả về thoughts từ đây vì nó đã được gửi qua safeEmit
// }

// interface RouteToAgentArgs {
//     targetAgent: string;
//     taskDescription: string;
//     inputData?: any; // inputData có thể là tùy chọn
// }

// function isValidAgentId(id: string): id is AgentId {
//     return (ALLOWED_SUB_AGENTS as string[]).includes(id);
// }

// // --- Function to handle calling a Sub Agent ---
// async function callSubAgent(
//     requestCard: AgentCardRequest,
//     parentHandlerId: string,
//     language: Language,
//     socket: Socket
// ): Promise<AgentCardResponse> {
//     const subAgentId = requestCard.receiverAgentId as AgentId;
//     const subHandlerProcessId = `${parentHandlerId}-Sub-${subAgentId}-${Date.now()}`;
//     const socketId = socket.id;
//     const subAgentLocalThoughts: ThoughtStep[] = [];

//     logToFile(`--- [${subHandlerProcessId} Socket ${socketId}] Calling Sub Agent: ${subAgentId}, Task: ${requestCard.taskId} ---`);
//     const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, subAgentId);
//     const subAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
//     const subAgentInputText = `Received Task Request (ID: ${requestCard.taskId}):\nDescription: ${requestCard.taskDescription}\nPlease execute using your available tools.`;
//     const subAgentInputParts: Part[] = [{ text: subAgentInputText }];
//     const subAgentHistory: HistoryItem[] = [{ role: 'user', parts: subAgentInputParts }];

//     let subAgentResultData: any = null;
//     let subAgentErrorMessage: string | undefined = undefined;
//     let subAgentFrontendAction: FrontendAction | undefined = undefined;
//     let subAgentStatus: 'success' | 'error' = 'error'; // Default to error

//     // Callback này sẽ được gọi bởi executeFunction và các IFunctionHandler
//     // Nó chịu trách nhiệm emit StatusUpdate LÊN FRONTEND và thu thập ThoughtStep cho AgentCardResponse
//     const onSubAgentFunctionStatusUpdate = (eventName: 'status_update', data: StatusUpdate): boolean => {
//         if (!socket.connected) {
//             logToFile(`[${subHandlerProcessId} SubAgent Emit SKIPPED - ${socketId}] Client disconnected. Event: ${eventName} for ${data.agentId || subAgentId}`);
//             return false;
//         }
//         try {
//             // Đảm bảo agentId trong data là của Sub Agent đang thực thi
//             // Nếu data.agentId chưa có, hoặc nếu muốn ghi đè, sử dụng subAgentId
//             const effectiveAgentId = data.agentId || subAgentId;

//             const thought: ThoughtStep = {
//                 step: data.step,
//                 message: data.message,
//                 details: data.details,
//                 timestamp: data.timestamp || new Date().toISOString(),
//                 agentId: effectiveAgentId // Sử dụng agentId hiệu quả
//             };
//             subAgentLocalThoughts.push(thought); // Thu thập thought
//             logToFile(`[${subHandlerProcessId} SubAgent Thought Added - ${socketId}] Step: ${thought.step}, Agent: ${thought.agentId}`);

//             // Gửi StatusUpdate lên frontend (đã có agentId từ data hoặc effectiveAgentId)
//             socket.emit(eventName, { ...data, agentId: effectiveAgentId });
//             logToFile(`[${subHandlerProcessId} SubAgent Emit Sent - ${socketId}] Event: ${eventName}, Step: ${data.step} for ${effectiveAgentId}`);
//             return true;
//         } catch (error: any) {
//             logToFile(`[${subHandlerProcessId} SubAgent Emit FAILED - ${socketId}] Event: ${eventName}, Error: ${error.message} for ${data.agentId || subAgentId}`);
//             return false;
//         }
//     };

//     try {
//         // Bước suy nghĩ ban đầu của Sub Agent
//         onSubAgentFunctionStatusUpdate('status_update', {
//             type: 'status',
//             step: 'sub_agent_thinking',
//             message: `Sub Agent ${subAgentId} is processing the task: ${requestCard.taskDescription.substring(0, 50)}...`,
//             agentId: subAgentId // Tự đặt agentId ở đây cho rõ
//         });

//         const subAgentLlmResult: GeminiInteractionResult = await GEMINI_SERVICE.generateTurn(
//             [], subAgentHistory, CHATBOT_GENERATION_CONFIG, systemInstructions, subAgentTools
//         );
//         logToFile(`[${subHandlerProcessId}] LLM result from ${subAgentId}: Status ${subAgentLlmResult.status}`);

//         if (subAgentLlmResult.status === "requires_function_call" && subAgentLlmResult.functionCall) {
//             const functionCall = subAgentLlmResult.functionCall;
//             logToFile(`[${subHandlerProcessId}] ${subAgentId} requests function call: ${functionCall.name}`);

//             // `executeFunction` sẽ gọi `onSubAgentFunctionStatusUpdate` cho các bước của nó
//             // và các handler con cũng sẽ gọi `onSubAgentFunctionStatusUpdate`
//             const functionOutput: FunctionHandlerOutput = await executeFunction(
//                 functionCall,
//                 subAgentId,         // ID của agent đang gọi (SubAgent)
//                 subHandlerProcessId,// ID của tiến trình xử lý này
//                 language,
//                 onSubAgentFunctionStatusUpdate, // Callback để emit status và thu thập thoughts
//                 socket,
//                 requestCard.context
//             );

//             if (functionOutput.modelResponseContent.toLowerCase().startsWith('error:')) {
//                 subAgentErrorMessage = functionOutput.modelResponseContent;
//                 subAgentStatus = 'error';
//             } else {
//                 subAgentResultData = functionOutput.modelResponseContent;
//                 subAgentStatus = 'success';
//                 subAgentFrontendAction = functionOutput.frontendAction;
//             }

//         } else if (subAgentLlmResult.status === "final_text") {
//             subAgentResultData = subAgentLlmResult.text || "Sub agent provided a text response.";
//             subAgentStatus = 'success';
//             onSubAgentFunctionStatusUpdate('status_update', {
//                 type: 'status',
//                 step: 'sub_agent_text_response_generated',
//                 message: `Sub Agent ${subAgentId} generated a direct text response.`,
//                 agentId: subAgentId
//             });
//         } else { // Error từ LLM của Sub Agent
//             subAgentErrorMessage = subAgentLlmResult.errorMessage || `Error processing task in ${subAgentId}.`;
//             subAgentStatus = 'error';
//             onSubAgentFunctionStatusUpdate('status_update', {
//                 type: 'status',
//                 step: 'sub_agent_llm_error',
//                 message: `Sub Agent ${subAgentId} encountered an LLM error: ${subAgentErrorMessage}`,
//                 details: { error: subAgentErrorMessage },
//                 agentId: subAgentId
//             });
//         }

//     } catch (error: any) {
//         const criticalErrorMsg = error instanceof Error ? error.message : String(error);
//         logToFile(`[${subHandlerProcessId}] CRITICAL Error calling Sub Agent ${subAgentId}: ${criticalErrorMsg}\nStack: ${error.stack}`);
//         subAgentErrorMessage = `Failed to execute task via ${subAgentId}: ${criticalErrorMsg}`;
//         subAgentStatus = 'error';
//         onSubAgentFunctionStatusUpdate('status_update', {
//             type: 'status',
//             step: 'sub_agent_critical_error',
//             message: `A critical error occurred while Sub Agent ${subAgentId} was processing: ${criticalErrorMsg}`,
//             details: { error: criticalErrorMsg },
//             agentId: subAgentId
//         });
//     }

//     // Bước hoàn thành của Sub Agent
//     onSubAgentFunctionStatusUpdate('status_update', {
//         type: 'status',
//         step: 'sub_agent_processing_complete',
//         message: `Sub Agent ${subAgentId} has completed its task. Status: ${subAgentStatus}`,
//         details: { finalStatus: subAgentStatus, resultPreview: JSON.stringify(subAgentResultData)?.substring(0, 100) },
//         agentId: subAgentId
//     });

//     const responseCard: AgentCardResponse = {
//         taskId: requestCard.taskId,
//         conversationId: requestCard.conversationId,
//         senderAgentId: subAgentId,
//         receiverAgentId: requestCard.senderAgentId,
//         timestamp: new Date().toISOString(),
//         status: subAgentStatus,
//         resultData: subAgentResultData,
//         errorMessage: subAgentErrorMessage,
//         frontendAction: subAgentFrontendAction,
//         thoughts: subAgentLocalThoughts // <<< GỬI KÈM THOUGHTS ĐÃ THU THẬP CỦA SUB AGENT
//     };

//     logToFile(`--- [${subHandlerProcessId}] Sub Agent ${subAgentId} finished. Status: ${responseCard.status}, Thoughts collected: ${subAgentLocalThoughts.length} ---`);
//     return responseCard;
// }


// // --- Main Handler (handleNonStreaming) ---
// export async function handleNonStreaming(
//     userInput: string,
//     historyForHandler: HistoryItem[],
//     socket: Socket,
//     language: Language,
//     handlerId: string,
//     frontendMessageId?: string
// ): Promise<NonStreamingHandlerResult | void> {

//     const socketId = socket.id;
//     const conversationId = handlerId;
//     logToFile(`--- [${handlerId} Socket ${socketId}] Handling NON-STREAMING input: "${userInput}", Lang: ${language} ---`);

//     const currentAgentId: AgentId = 'HostAgent';
//     const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentId);
//     const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

//     let history: HistoryItem[] = [...historyForHandler]; // Start with the provided history

//     // --- Determine if userTurn needs to be added ---
//     const isEditContextOrAlreadyProcessed = frontendMessageId &&
//                                history.length > 0 &&
//                                history[history.length - 1].role === 'user' &&
//                                history[history.length - 1].uuid === frontendMessageId &&
//                                history[history.length - 1].parts[0]?.text === userInput;

//     if (!isEditContextOrAlreadyProcessed) {
//         logToFile(`[${handlerId} NonStreaming - UserTurn] Adding new userTurn. frontendMessageId: ${frontendMessageId}, userInput: "${userInput.substring(0, 20)}"`);
//         const newUserTurn: HistoryItem = { // Create userTurn only when needed
//             role: 'user',
//             parts: [{ text: userInput }],
//             timestamp: new Date(),
//             uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}`
//         };
//         history.push(newUserTurn);
//     } else {
//         logToFile(`[${handlerId} NonStreaming - UserTurn] Skipping adding userTurn; assumed already present in history (edit context or already processed). frontendMessageId: ${frontendMessageId}`);
//     }
//     // --- End of UserTurn logic ---

//     const thoughts: ThoughtStep[] = [];
//     let finalFrontendAction: FrontendAction | undefined = undefined;
//     let currentTurn = 1;
//     const MAX_TURNS = 5;

//     // --- Safe Emit Helper ---
//     const safeEmit = (eventName: 'status_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ResultUpdate | ErrorUpdate): boolean => {
//         if (!socket.connected) {
//             logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] SKIPPED: Client disconnected. Event: ${eventName}`);
//             return false;
//         }
//         try {
//             if (eventName === 'status_update' && data.type === 'status') {
//                 thoughts.push({ step: data.step, message: data.message, timestamp: new Date().toISOString(), details: (data as StatusUpdate).details });
//             }

//             let dataToSend: any = data;


//             // Attach thoughts and action to the *final* chat_result or chat_error
//             if (eventName === 'chat_result' || eventName === 'chat_error') {
//                 dataToSend = { ...data, thoughts: thoughts };
//                 // Only attach the action if it's the final result being emitted by this handler
//                 if (eventName === 'chat_result' && finalFrontendAction) {
//                     (dataToSend as ResultUpdate).action = finalFrontendAction;
//                     logToFile(`[${handlerId} ${socketId}] Attaching frontendAction to final event: ${JSON.stringify(finalFrontendAction)}`);
//                 }
//             }

//             socket.emit(eventName, dataToSend);
//             logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}`);
//             return true;
//         } catch (error: any) {
//             logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] FAILED: Error during emit. Event: ${eventName}, Error: ${error.message}`);
//             return false;
//         }
//     };

//     const statusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
//         return safeEmit(eventName, data);
//     };


//     try {
//         if (!statusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

//         while (currentTurn <= MAX_TURNS) {
//             logToFile(`--- [${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Sending to Model (History size: ${history.length}) ---`);
//             if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? 'Thinking based on previous results...' : 'Thinking...' })) return;
//             if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected before Model call in Turn ${currentTurn}.`); return; }

//             // --- Call the Host Agent's LLM ---
//             const modelResult: GeminiInteractionResult = await GEMINI_SERVICE.generateTurn(
//                 [], history, CHATBOT_GENERATION_CONFIG, systemInstructions, tools
//             );

//             if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected during/after HostAgent Model call in Turn ${currentTurn}.`); return; }

//             // --- Process Host Agent's Response ---
//             if (modelResult.status === "final_text") {
//                 // Host agent decided to respond directly
//                 logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Received final_text.`);
//                 statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
//                 const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Please follow the instructions on screen." : "Okay.");
//                 // ***** GET THE FINAL ID OF THIS BOT MESSAGE *****
//                 // This ID should be generated by the backend before or during saving to history.
//                 // Let's assume you generate it and store it in the HistoryItem.
//                 const botMessageUuid = uuidv4(); // Or however you generate your message IDs
//                 // *************************************************

//                 const finalModelTurn: HistoryItem = {
//                     role: 'model',
//                     parts: [{ text: finalModelResponseText }],
//                     uuid: botMessageUuid, // Store the ID here
//                     timestamp: new Date()
//                 };
//                 history.push(finalModelTurn);
//                 logToFile(`[${handlerId} History Check - Final] Appended final HostAgent response. History size: ${history.length}`);

//                 safeEmit('chat_result', {
//                     type: 'result',
//                     message: finalModelResponseText,
//                     id: botMessageUuid // <<< ADD THE FINAL ID HERE
//                     // thoughts and action are added by safeEmit if present
//                 });
//                 return { history: history, action: finalFrontendAction };
//             }
//             else if (modelResult.status === "error") {
//                 logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Received error from model: ${modelResult.errorMessage}`);
//                 safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `An error occurred processing your request (Turn ${currentTurn}).`, step: 'thinking' });
//                 return { history: history };

//             } else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
//                 const functionCall = modelResult.functionCall;
//                 logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Requested function call: ${functionCall.name}`);

//                 // Append Host's request to its history
//                 const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
//                 history.push(modelFunctionCallTurn);
//                 logToFile(`[${handlerId} History Check - Host FC Prep ${currentTurn}] Appended HostAgent FC request. History size: ${history.length}`);


//                 let functionResponseContent: string | null = null;
//                 let functionError: string | undefined = undefined;

//                 if (functionCall.name === 'routeToAgent') {


//                     // --- TYPE ASSERTION HERE ---
//                     const routeArgs = functionCall.args as RouteToAgentArgs;
//                     // --------------------------

//                     statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });


//                     // --- Use the typed variable 'routeArgs' ---
//                     const targetAgent = routeArgs.targetAgent;
//                     const taskDescription = routeArgs.taskDescription;
//                     const inputData = routeArgs.inputData;
//                     // -----------------------------------------

//                     // Expand allowed agents
//                     const allowedSubAgents: AgentId[] = ['ConferenceAgent', 'JournalAgent', 'AdminContactAgent', 'NavigationAgent', 'WebsiteInfoAgent']; // <-- Add WebsiteInfoAgent

//                     // Validation
//                     if (!targetAgent || !taskDescription /* inputData can be optional for WebsiteInfo */) {
//                         functionError = "Routing failed: Missing targetAgent or taskDescription.";
//                         logToFile(`[${handlerId} Error] Invalid routing arguments: ${JSON.stringify(functionCall.args)}`);
//                     }
//                     else if (!allowedSubAgents.includes(targetAgent as AgentId)) {
//                         functionError = `Routing failed: Agent "${targetAgent}" is not supported or implemented yet.`;
//                         logToFile(`[${handlerId} Error] Unsupported target agent: ${targetAgent}`);
//                     }
//                     else {
//                         // --- Prepare and Call Sub Agent ---
//                         const requestCard: AgentCardRequest = {
//                             taskId: uuidv4(),
//                             conversationId: conversationId,
//                             senderAgentId: 'HostAgent',
//                             receiverAgentId: targetAgent,
//                             timestamp: new Date().toISOString(),
//                             taskDescription: taskDescription,
//                             context: { userToken: socket.data.token }
//                         };

//                         const subAgentResponse: AgentCardResponse = await callSubAgent(
//                             requestCard, handlerId, language, socket
//                         );

//                         // --- Process Sub Agent Response ---
//                         if (subAgentResponse.status === 'success') {
//                             functionResponseContent = JSON.stringify(subAgentResponse.resultData || "Sub agent provided no data.");
//                             if (subAgentResponse.frontendAction) {
//                                 finalFrontendAction = subAgentResponse.frontendAction;
//                                 logToFile(`[${handlerId}] Stored frontendAction returned from ${targetAgent}.`);
//                             }
//                         } else {
//                             functionError = subAgentResponse.errorMessage || `Error occurred in ${targetAgent}.`;
//                         }
//                     }
//                     // --- END Sub Agent Call Logic ---

//                 } else {
//                     // --- THIS BLOCK SHOULD NOT BE REACHED if Host Agent is configured correctly ---
//                     logToFile(`[${handlerId} ERROR] HostAgent attempted to call function '${functionCall.name}' directly, but it should only use 'routeToAgent'. Check HostAgent prompt and tool configuration.`);
//                     functionError = `Internal configuration error: HostAgent cannot directly call function '${functionCall.name}'.`;
//                     // -------------------------------------------------------------------------
//                 }


//                 // --- Prepare Function Response for Host Agent ---
//                 if (!socket.connected) { logToFile(`[${handlerId} Abort - ${socketId}] Client disconnected after function/routing execution in Turn ${currentTurn}.`); return; }

//                 const responsePartContent = functionError ? { error: functionError } : { content: functionResponseContent };
//                 const functionResponsePart: FunctionResponsePart = {
//                     functionResponse: {
//                         name: functionCall.name, // Use the original function name called by Host
//                         response: responsePartContent
//                     }
//                 };
//                 const functionTurn: HistoryItem = { role: 'function', parts: [functionResponsePart] };
//                 history.push(functionTurn);
//                 logToFile(`[${handlerId} History Check - Host FC Done ${currentTurn}] Appended function/routing response. History size: ${history.length}`);

//                 currentTurn++;
//                 continue; // <<< CONTINUE HOST AGENT LOOP

//             } else {
//                 // Unexpected status from Host Agent LLM
//                 logToFile(`[${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Received unexpected model status: ${modelResult.status}`);
//                 safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
//                 return { history: history };
//             }
//         } // End while loop

//         if (currentTurn > MAX_TURNS) {
//             logToFile(`[${handlerId} Socket ${socketId}] Error: HostAgent Exceeded maximum interaction turns (${MAX_TURNS}).`);
//             safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck.', step: 'max_turns_exceeded' });
//             return { history: history };
//         }

//     } catch (error: any) {
//         logToFile(`[${handlerId} Socket ${socketId} Lang: ${language}] CRITICAL Error in handleNonStreaming (HostAgent): ${error.message}\nStack: ${error.stack}`);
//         safeEmit('chat_error', { type: "error", message: error.message || "An unexpected server error occurred.", step: 'unknown_handler_error' });
//         return { history: history };
//     } finally {
//         logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
//     }
//     return { history: history }; // Should be unreachable
// }

// // --- handleStreaming function - Updated with A2A Logic ---
// export async function handleStreaming(
//     userInput: string,
//     currentHistoryFromSocket: HistoryItem[],
//     socket: Socket,
//     language: Language,
//     handlerId: string,
//     onActionGenerated?: (action: FrontendAction) => void,
//     frontendMessageId?: string
// ): Promise<HistoryItem[] | void> {

//     const socketId = socket.id;
//     const conversationId = handlerId;
//     logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput}", Lang: ${language} ---`);

//     const currentAgentIdForHost: AgentId = 'HostAgent';
//     const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentIdForHost);
//     const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

//     let history: HistoryItem[] = [...currentHistoryFromSocket];
//     const allThoughtsCollectedStreaming: ThoughtStep[] = [];
//     let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

//     // --- Determine if userTurn needs to be added ---
//     const isEditContextOrAlreadyProcessed = frontendMessageId &&
//                                history.length > 0 &&
//                                history[history.length - 1].role === 'user' &&
//                                history[history.length - 1].uuid === frontendMessageId &&
//                                history[history.length - 1].parts[0]?.text === userInput;

//     if (!isEditContextOrAlreadyProcessed) {
//         logToFile(`[${handlerId} Streaming - UserTurn] Adding new userTurn. frontendMessageId: ${frontendMessageId}, userInput: "${userInput.substring(0, 20)}"`);
//         const newUserTurn: HistoryItem = {
//             role: 'user',
//             parts: [{ text: userInput }],
//             timestamp: new Date(),
//             uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}`
//         };
//         history.push(newUserTurn);
//     } else {
//         logToFile(`[${handlerId} Streaming - UserTurn] Skipping adding userTurn; assumed already present in history (edit context or already processed). frontendMessageId: ${frontendMessageId}`);
//     }
//     // --- End of UserTurn logic ---

//     // --- Safe Emit Helper (ĐIỀU CHỈNH ĐỂ GIỐNG NON-STREAMING VỀ THOUGHTS) ---
//     const safeEmitStreaming = (
//         eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
//         data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate
//     ): boolean => {
//         if (!socket.connected) {
//             logToFile(`[${handlerId} Streaming Emit SKIPPED - ${socketId}] Client disconnected. Event: ${eventName}`);
//             return false;
//         }
//         try {
//             let dataToSend: any = { ...data }; // Clone data

//             // Nếu là status_update từ Host Agent trong streaming, thu thập nó
//             if (eventName === 'status_update' && data.type === 'status') {
//                 const hostThought: ThoughtStep = {
//                     step: data.step,
//                     message: data.message,
//                     details: (data as StatusUpdate).details,
//                     timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(),
//                     agentId: 'HostAgent' // Đánh dấu thought này của HostAgent
//                 };
//                 allThoughtsCollectedStreaming.push(hostThought);
//                 // Gửi status update lên frontend, cũng với agentId là HostAgent
//                 dataToSend.agentId = 'HostAgent';
//             }

//             // Đính kèm tất cả thoughts đã thu thập vào KẾT QUẢ CUỐI CÙNG hoặc LỖI CUỐI CÙNG của stream
//             if (eventName === 'chat_result' || eventName === 'chat_error') {
//                 dataToSend.thoughts = [...allThoughtsCollectedStreaming];
//                 if (eventName === 'chat_result' && finalFrontendActionStreaming) {
//                     (dataToSend as ResultUpdate).action = finalFrontendActionStreaming;
//                 }
//                 logToFile(`[${handlerId} ${socketId}] Emitting final streaming ${eventName} with ${allThoughtsCollectedStreaming.length} thoughts.`);
//             }

//             socket.emit(eventName, dataToSend);
//             logToFile(`[${handlerId} Streaming Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}, Agent: ${dataToSend.agentId || 'N/A'}`);
//             return true;
//         } catch (error: any) {
//             logToFile(`[${handlerId} Streaming Emit FAILED - ${socketId}] Error: ${error.message}. Event: ${eventName}`);
//             return false;
//         }
//     };

//     // Callback này CHỈ dành cho các status update của Host Agent trong streaming
//     const hostAgentStreamingStatusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
//         return safeEmitStreaming(eventName, data);
//     };

//     async function processAndEmitStream(
//         stream: AsyncGenerator<EnhancedGenerateContentResponse>
//     ): Promise<{ fullText: string } | null> {
//         let accumulatedText = "";
//         let streamFinished = false; // <<<< KHAI BÁO LẠI Ở ĐÂY
//         logToFile(`[${handlerId} Stream Processing - ${socketId}] Starting...`);

//         if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) {
//             logToFile(`[${handlerId} Stream Processing Abort - ${socketId}] Failed initial status emit (disconnected?).`);
//             return null;
//         }

//         try {
//             for await (const chunk of stream) {
//                 if (!socket.connected) {
//                     logToFile(`[${handlerId} Stream Abort - ${socketId}] Disconnected during stream.`);
//                     return null; // streamFinished vẫn là false
//                 }
//                 const chunkText = chunk.text();
//                 if (chunkText) {
//                     accumulatedText += chunkText;
//                     if (!safeEmitStreaming('chat_update', { type: 'partial_result', textChunk: chunkText })) {
//                         logToFile(`[${handlerId} Stream Abort - ${socketId}] Failed to emit chat_update.`);
//                         return null; // streamFinished vẫn là false
//                     }
//                 }
//             }
//             streamFinished = true; // <<<< ĐẶT LÀ TRUE KHI VÒNG LẶP KẾT THÚC BÌNH THƯỜNG
//             logToFile(`[${handlerId} Stream Processing - ${socketId}] Finished. Length: ${accumulatedText.length}`);
//             return { fullText: accumulatedText };

//         } catch (error: any) {
//             logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
//             // streamFinished vẫn là false nếu có lỗi trong try
//             throw error; // Re-throw to be caught by the main loop
//         } finally {
//             // Khối finally sẽ luôn chạy, bất kể try có return hay throw error
//             if (!streamFinished) { // <<<< KIỂM TRA Ở ĐÂY
//                 logToFile(`[${handlerId} Stream Processing Warning - ${socketId}] Stream loop exited unexpectedly (e.g. error, disconnect, or premature return).`);
//             }
//         }
//     }


//     // --- Main Streaming Logic with Loop ---
//     try {
//         if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

//         const userTurn: HistoryItem = {
//             role: 'user',
//             parts: [{ text: userInput }],
//             timestamp: new Date(),
//             uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}` // Sử dụng frontendMessageId nếu có
//             // Hoặc tạo một fallback nếu không có (nhưng nên có)
//         };
//         if (history.length === 0 || history[history.length - 1]?.parts[0]?.text !== userInput || (history[history.length - 1] as any)?.uuid !== frontendMessageId) {
//             // Điều kiện này có thể cần xem lại. Nếu uuid khác nhau thì luôn là message mới.
//             // Nếu mục đích là tránh gửi đi gửi lại cùng 1 input thì điều kiện text là đủ.
//             // Quan trọng là userTurn phải có uuid.
//             history.push(userTurn);
//         }

//         let currentHostTurn = 1;
//         const MAX_HOST_TURNS = MAX_TURNS_HOST_AGENT;

//         while (currentHostTurn <= MAX_HOST_TURNS) {
//             logToFile(`--- [${handlerId} HostAgent Streaming Turn ${currentHostTurn} Start - ${socketId}] ---`);
//             if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? 'Continuing process...' : 'Thinking...' })) return;
//             if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected before HostAgent model call.`); return; }

//             logToFile(`[${handlerId} History T${currentHostTurn} Send - ${socketId}] Host History Size: ${history.length}`);

//             // Determine tools for this turn.
//             // If this is the turn *after* a sub-agent has run and we expect a final text response,
//             // we might want to provide NO tools to the HostAgent to force it to generate text.
//             // However, for complex multi-step routing, it *needs* tools until the very end.
//             // The system prompt should guide this. For now, always provide tools.
//             const toolsForThisTurn = hostAgentTools;


//             const hostAgentLLMResult = await GEMINI_SERVICE.generateStream(
//                 [], history, CHATBOT_GENERATION_CONFIG, systemInstructions, toolsForThisTurn
//             );

//             if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after HostAgent model call response received.`); return; }

//             if (hostAgentLLMResult.error) {
//                 logToFile(`[${handlerId} Streaming Error T${currentHostTurn} - ${socketId}] HostAgent model error: ${hostAgentLLMResult.error}`);
//                 safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
//                 return history;

//             } else if (hostAgentLLMResult.functionCalls) {
//                 // --- Host Agent Requires Routing ---
//                 // GIẢ SỬ: hostAgentLLMResult.functionCalls là một FunctionCall object duy nhất,
//                 // tương tự như modelResult.functionCall trong non-streaming.
//                 // Nếu Gemini API cho streaming trả về một MẢNG các function call, bạn cần xử lý vòng lặp.
//                 // Tuy nhiên, thông thường một lượt LLM chỉ trả về một yêu cầu gọi hàm hoặc không.
//                 const functionCall = hostAgentLLMResult.functionCalls; // <<<< BỎ [0] ĐI
//                 history.push({ role: 'model', parts: [{ functionCall: functionCall }] });
//                 logToFile(`[${handlerId} HostAgent Streaming T${currentHostTurn} - ${socketId}] Requests function: ${functionCall.name}`);

//                 let funcResponseContent: string | null = null;
//                 let funcError: string | undefined = undefined;

//                 if (functionCall.name === 'routeToAgent') {
//                     const routeArgs = functionCall.args as RouteToAgentArgs;
//                     // Status update này sẽ được safeEmitStreaming xử lý (thêm agentId và thought)
//                     hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });

//                     if (!routeArgs.targetAgent || !routeArgs.taskDescription) {
//                         funcError = "Routing failed: Missing targetAgent or taskDescription.";
//                     } else if (!isValidAgentId(routeArgs.targetAgent)) { // Sử dụng hàm isValidAgentId
//                         funcError = `Routing failed: Agent "${routeArgs.targetAgent}" is not supported.`;
//                     } else {
//                         const requestCard: AgentCardRequest = {
//                             taskId: uuidv4(), conversationId, senderAgentId: 'HostAgent',
//                             receiverAgentId: routeArgs.targetAgent, timestamp: new Date().toISOString(),
//                             taskDescription: routeArgs.taskDescription, context: { userToken: socket.data.token, language }
//                         };

//                         const subAgentResponse: AgentCardResponse = await callSubAgent(
//                             requestCard, handlerId, language, socket
//                         );

//                         // Gộp thoughts từ Sub Agent vào mảng thoughts tổng của streaming
//                         if (subAgentResponse.thoughts && subAgentResponse.thoughts.length > 0) {
//                             allThoughtsCollectedStreaming.push(...subAgentResponse.thoughts);
//                             logToFile(`[${handlerId} Streaming] Appended ${subAgentResponse.thoughts.length} thoughts from ${routeArgs.targetAgent}. Total: ${allThoughtsCollectedStreaming.length}`);
//                         }

//                         if (subAgentResponse.status === 'success') {
//                             funcResponseContent = JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.");
//                             if (subAgentResponse.frontendAction) {
//                                 finalFrontendActionStreaming = subAgentResponse.frontendAction;
//                                 onActionGenerated?.(finalFrontendActionStreaming);
//                             }
//                         } else {
//                             funcError = subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.`;
//                         }
//                     }
//                 } else {
//                     funcError = `Internal config error: HostAgent (streaming) cannot call '${functionCall.name}'.`;
//                     hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'host_agent_config_error', message: funcError, details: { functionName: functionCall.name } });
//                 }

//                 if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after routing/sub-agent execution.`); return; }

//                 const responsePart: FunctionResponsePart = { functionResponse: { name: functionCall.name, response: funcError ? { error: funcError } : { content: funcResponseContent } } };
//                 history.push({ role: 'function', parts: [responsePart] });
//                 currentHostTurn++;
//                 continue;

//             } else if (hostAgentLLMResult.stream) {
//                 hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
//                 const streamOutput = await processAndEmitStream(hostAgentLLMResult.stream);
//                 if (streamOutput) {
//                     // ***** GET THE FINAL ID OF THIS BOT MESSAGE *****
//                     const botMessageUuid = uuidv4(); 
//                     // *************************************************

//                     history.push({ 
//                         role: 'model', 
//                         parts: [{ text: streamOutput.fullText }],
//                         uuid: botMessageUuid, // Store the ID here
//                         timestamp: new Date()
//                     });
                    
//                     safeEmitStreaming('chat_result', { 
//                         type: 'result', 
//                         message: streamOutput.fullText,
//                         id: botMessageUuid // <<< ADD THE FINAL ID HERE
//                         // thoughts and action are added by safeEmitStreaming if present
//                     });
//                     return history;
//                 } else {
//                     safeEmitStreaming('chat_error', { type: 'error', message: 'Failed to process final stream.', step: 'streaming_response_error' });
//                     return history;
//                 }
//             } else {
//                 safeEmitStreaming('chat_error', { type: 'error', message: 'Internal error: Unexpected AI response (streaming).', step: 'unknown_host_llm_status' });
//                 return history;
//             }
//         } // End while loop

//         if (currentHostTurn > MAX_HOST_TURNS) {
//             safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long (streaming).', step: 'max_turns_exceeded' });
//             return history;
//         }

//     } catch (error: any) {
//         const criticalErrorMsg = error instanceof Error ? error.message : String(error);
//         logToFile(`[${handlerId} Streaming CRITICAL Error - ${socketId} Lang: ${language}] ${criticalErrorMsg}\nStack: ${error.stack}`);
//         safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg || "An unexpected server error occurred.", step: 'unknown_handler_error' });
//         return history;
//     } finally {
//         logToFile(`--- [${handlerId} ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
//     }
//     return history;
// }