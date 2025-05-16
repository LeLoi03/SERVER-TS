// src/chatbot/handlers/hostAgent.nonStreaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Tool, Part, FunctionResponsePart } from "@google/generative-ai"; // Import FunctionResponsePart
import {
    HistoryItem,
    FrontendAction,
    Language,
    AgentId,
    ThoughtStep,
    StatusUpdate,
    ResultUpdate,
    ErrorUpdate,
    AgentCardRequest,
    AgentCardResponse
} from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';

interface NonStreamingHandlerResult {
    history: HistoryItem[];
    action?: FrontendAction;
}

interface RouteToAgentArgs {
    targetAgent: string;
    taskDescription: string;
}

export async function handleNonStreaming(
    userInput: string,
    historyForHandler: HistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    deps: HostAgentHandlerCustomDeps,
    frontendMessageId?: string
): Promise<NonStreamingHandlerResult | void> {
    const {
        geminiServiceForHost,
        hostAgentGenerationConfig,
        logToFile,
        allowedSubAgents,
        maxTurnsHostAgent,
        callSubAgentHandler
    } = deps;

    const socketId = socket.id;
    const conversationId = handlerId;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling NON-STREAMING input: "${userInput.substring(0, 50)}...", Lang: ${language} ---`);

    const currentAgentId: AgentId = 'HostAgent';
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentId);
    const tools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let history: HistoryItem[] = [...historyForHandler];
    const thoughts: ThoughtStep[] = [];
    let finalFrontendAction: FrontendAction | undefined = undefined;
    let currentTurn = 1;

    const isEditContextOrAlreadyProcessed = frontendMessageId &&
        history.length > 0 &&
        history[history.length - 1].role === 'user' &&
        history[history.length - 1].uuid === frontendMessageId &&
        history[history.length - 1].parts[0]?.text === userInput;

    if (!isEditContextOrAlreadyProcessed) {
        logToFile(`[${handlerId} NonStreaming - UserTurn] Adding new userTurn. frontendMessageId: ${frontendMessageId}`);
        history.push({
            role: 'user', parts: [{ text: userInput }],
            timestamp: new Date(), uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}`
        });
    } else {
        logToFile(`[${handlerId} NonStreaming - UserTurn] Skipping adding userTurn (edit/processed). frontendMessageId: ${frontendMessageId}`);
    }



    const safeEmit = (eventName: 'status_update' | 'chat_result' | 'chat_error', data: StatusUpdate | ResultUpdate | ErrorUpdate): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} Socket Emit Attempt - ${socketId}] SKIPPED: Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            if (eventName === 'status_update' && data.type === 'status') {
                thoughts.push({
                    step: data.step, message: data.message, agentId: currentAgentId, // HostAgent thoughts
                    timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(), details: (data as StatusUpdate).details
                });
            }
            let dataToSend: any = { ...data };
            if (eventName === 'status_update' && !dataToSend.agentId) dataToSend.agentId = currentAgentId;


            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend = { ...dataToSend, thoughts: [...thoughts] }; // Gửi bản sao của thoughts
                if (eventName === 'chat_result' && finalFrontendAction) {
                    (dataToSend as ResultUpdate).action = finalFrontendAction;
                }
            }
            socket.emit(eventName, dataToSend);
            logToFile(`[${handlerId} Socket Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}, Agent: ${dataToSend.agentId || 'N/A'}`);
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

        // Khởi tạo nextTurnInputForHost với userInput ban đầu cho lượt đầu tiên.
        // Nó sẽ được cập nhật thành FunctionResponsePart cho các lượt sau nếu có function call.
        let nextTurnInputForHost: string | Part[] = userInput;

        while (currentTurn <= maxTurnsHostAgent) {
            logToFile(`--- [${handlerId} Socket ${socketId}] HostAgent Turn ${currentTurn}: Input type: ${typeof nextTurnInputForHost === 'string' ? 'string' : 'Part[]'}, History size: ${history.length} ---`);
            if (!statusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentTurn > 1 ? `Thinking based on previous action (Turn ${currentTurn})...` : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentTurn} - ${socketId}] Client disconnected before Model call.`); return; }

            const modelResult = await geminiServiceForHost.generateTurn(
                nextTurnInputForHost,
                history, // history này đã được cập nhật với user turn, model function call, function response từ các lượt trước
                hostAgentGenerationConfig,
                systemInstructions,
                tools
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentTurn} - ${socketId}] Client disconnected after Model call.`); return; }

            if (modelResult.status === "final_text") {
                statusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const finalModelResponseText = modelResult.text || (finalFrontendAction ? "Please follow instructions." : "Okay.");
                const botMessageUuid = uuidv4();
                const finalModelTurn: HistoryItem = { role: 'model', parts: [{ text: finalModelResponseText }], uuid: botMessageUuid, timestamp: new Date() };
                history.push(finalModelTurn);
                logToFile(`[${handlerId} NonStreaming - Final Text] Appended final HostAgent response. History size: ${history.length}`);
                safeEmit('chat_result', { type: 'result', message: finalModelResponseText, id: botMessageUuid });
                return { history: history, action: finalFrontendAction };
            }
            else if (modelResult.status === "error") {
                logToFile(`[${handlerId} NonStreaming Error T${currentTurn}] HostAgent model error: ${modelResult.errorMessage}`);
                safeEmit('chat_error', { type: 'error', message: modelResult.errorMessage || `Error processing your request (Turn ${currentTurn}).`, step: 'host_llm_error' });
                return { history: history };
            }
            else if (modelResult.status === "requires_function_call" && modelResult.functionCall) {
                const functionCall = modelResult.functionCall;
                // Thêm lượt model (yêu cầu function call) vào history
                const modelFunctionCallTurn: HistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} NonStreaming T${currentTurn}] HostAgent requests function: ${functionCall.name}. History size: ${history.length}`);

                let functionResponseForNextTurn: FunctionResponsePart; // Sẽ chứa kết quả để truyền cho lượt sau của Host
                let functionErrorOccurred = false;


                if (functionCall.name === 'routeToAgent') {
                    const routeArgs = functionCall.args as RouteToAgentArgs;
                    statusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });

                    if (!routeArgs.targetAgent || !routeArgs.taskDescription) {
                        functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: "Routing failed: Missing targetAgent or taskDescription." } } };
                        functionErrorOccurred = true;
                        logToFile(`[${handlerId} NonStreaming T${currentTurn}] Invalid routing args: ${JSON.stringify(routeArgs)}`);
                    } else if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                        functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` } } };
                        functionErrorOccurred = true;
                        logToFile(`[${handlerId} NonStreaming T${currentTurn}] Disallowed agent: ${routeArgs.targetAgent}`);
                    } else {
                        const requestCard: AgentCardRequest = {
                            taskId: uuidv4(), conversationId, senderAgentId: 'HostAgent',
                            receiverAgentId: routeArgs.targetAgent as AgentId,
                            timestamp: new Date().toISOString(), taskDescription: routeArgs.taskDescription,
                            context: { userToken: socket.data.token, language },
                        };
                        const subAgentResponse: AgentCardResponse = await callSubAgentHandler(
                            requestCard, handlerId, language, socket
                        );

                        if (subAgentResponse.thoughts && subAgentResponse.thoughts.length > 0) {
                            thoughts.push(...subAgentResponse.thoughts);
                        }

                        if (subAgentResponse.status === 'success') {
                            functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") } } };
                            if (subAgentResponse.frontendAction) {
                                finalFrontendAction = subAgentResponse.frontendAction;
                            }
                        } else {
                            functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` } } };
                            functionErrorOccurred = true;
                        }
                    }
                } else {
                    // Xử lý các function call khác (nếu HostAgent có thể gọi trực tiếp)
                    // Hiện tại, theo logic gốc, HostAgent chỉ nên gọi 'routeToAgent'
                    const errMsg = `Internal config error: HostAgent cannot directly call '${functionCall.name}'.`;
                    functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: errMsg } } };
                    functionErrorOccurred = true;
                    statusUpdateCallback('status_update', { type: 'status', step: 'host_agent_config_error', message: errMsg, details: { functionName: functionCall.name } });
                    logToFile(`[${handlerId} NonStreaming T${currentTurn}] HostAgent invalid direct call: ${functionCall.name}`);
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentTurn} - ${socketId}] Client disconnected after function execution.`); return; }

                // Thêm lượt function (kết quả của function call) vào history
                const functionResponseTurn: HistoryItem = { role: 'function', parts: [functionResponseForNextTurn] };
                history.push(functionResponseTurn);
                logToFile(`[${handlerId} NonStreaming T${currentTurn}] Appended function response for ${functionCall.name}. History size: ${history.length}`);

                // CẬP NHẬT input cho lượt tiếp theo của Host Agent
                // CHO LƯỢT TIẾP THEO CỦA HOST, chúng ta muốn model xử lý history đã được cập nhật.
                // Không cần truyền lại FunctionResponsePart làm nextTurnInput nữa.
                // Truyền một chuỗi rỗng hoặc một user input mới nếu có.
                // Nếu truyền chuỗi rỗng, Gemini class sẽ không thêm lượt 'user' mới.
                nextTurnInputForHost = ""; // Hoặc một thông điệp user mới nếu user có thể ngắt lời
                currentTurn++;
                // Nếu có lỗi nghiêm trọng từ function call, có thể quyết định dừng ở đây thay vì continue
                // if (functionErrorOccurred && some_condition_to_stop) {
                //     safeEmit('chat_error', { type: 'error', message: 'Failed to execute required action.', step: 'function_execution_failed' });
                //     return { history: history };
                // }
                continue; // Tiếp tục vòng lặp để Host Agent xử lý kết quả của function
            }
            else {
                // Trường hợp không mong muốn từ model
                logToFile(`[${handlerId} NonStreaming Error T${currentTurn}] HostAgent model unexpected status: ${modelResult.status}`);
                safeEmit('chat_error', { type: 'error', message: `An unexpected internal error occurred (Turn ${currentTurn}).`, step: 'unknown_model_status' });
                return { history: history };
            }
        } // Kết thúc while loop

        // Nếu vòng lặp kết thúc do vượt quá maxTurnsHostAgent
        if (currentTurn > maxTurnsHostAgent) {
            logToFile(`[${handlerId} NonStreaming Error] Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmit('chat_error', { type: 'error', message: 'Request processing took too long or got stuck in a loop.', step: 'max_turns_exceeded' });
            return { history: history };
        }

    } catch (error: any) {
        const errorMsg = error instanceof Error ? error.message : "An unknown error occurred";
        logToFile(`[${handlerId} NonStreaming CRITICAL Error - ${socketId}] ${errorMsg}\nStack: ${error.stack}`);
        safeEmit('chat_error', { type: "error", message: errorMsg, step: 'unknown_handler_error' });
        return { history: history };
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] NON-STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }

    // Dòng này chỉ để TypeScript không báo lỗi, về lý thuyết tất cả các nhánh đã return.
    // Nếu code chạy đến đây, có nghĩa là có một lỗi logic trong vòng lặp while.
    logToFile(`[${handlerId} NonStreaming WARN] Reached end of handler unexpectedly. Returning current history.`);
    return { history: history, action: finalFrontendAction };
} 