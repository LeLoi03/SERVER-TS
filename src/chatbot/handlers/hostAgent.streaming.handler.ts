// src/chatbot/handlers/hostAgent.streaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Tool, Part, FunctionResponsePart, EnhancedGenerateContentResponse, FunctionCall } from "@google/generative-ai"; // Import Part, FunctionCall
import {
    ChatHistoryItem,
    FrontendAction,
    Language,
    AgentId,
    ThoughtStep,
    StatusUpdate,
    ResultUpdate,
    ErrorUpdate,
    ChatUpdate,
    AgentCardRequest,
    AgentCardResponse
} from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';

interface RouteToAgentArgs {
    targetAgent: string;
    taskDescription: string;
}

export async function handleStreaming(
    userInput: string,
    currentHistoryFromSocket: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string,
    deps: HostAgentHandlerCustomDeps, // Nhận dependencies đã được cập nhật
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string
): Promise<ChatHistoryItem[] | void> {
    const {
        geminiServiceForHost,         // Sử dụng service của Host
        hostAgentGenerationConfig,    // Sử dụng config của Host
        logToFile,
        allowedSubAgents,
        maxTurnsHostAgent,
        callSubAgentHandler
    } = deps;

    const socketId = socket.id;
    const conversationId = handlerId;
    logToFile(`--- [${handlerId} Socket ${socketId}] Handling STREAMING input: "${userInput.substring(0, 50)}...", Lang: ${language} ---`);

    const currentAgentIdForHost: AgentId = 'HostAgent';
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, currentAgentIdForHost);
    const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let history: ChatHistoryItem[] = [...currentHistoryFromSocket];
    const allThoughtsCollectedStreaming: ThoughtStep[] = [];
    let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

    const isEditContextOrAlreadyProcessed = frontendMessageId &&
        history.length > 0 &&
        history[history.length - 1].role === 'user' &&
        history[history.length - 1].uuid === frontendMessageId &&
        history[history.length - 1].parts[0]?.text === userInput;

    if (!isEditContextOrAlreadyProcessed) {
        logToFile(`[${handlerId} Streaming - UserTurn] Adding new userTurn. frontendMessageId: ${frontendMessageId}`);
        history.push({
            role: 'user', parts: [{ text: userInput }],
            timestamp: new Date(), uuid: frontendMessageId || `user-fallback-${handlerId}-${Date.now()}`
        });
    } else {
        logToFile(`[${handlerId} Streaming - UserTurn] Skipping adding userTurn (edit/processed). frontendMessageId: ${frontendMessageId}`);
    }


    const safeEmitStreaming = (
        eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
        data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate
    ): boolean => {
        if (!socket.connected) {
            logToFile(`[${handlerId} Streaming Emit SKIPPED - ${socketId}] Client disconnected. Event: ${eventName}`);
            return false;
        }
        try {
            let dataToSend: any = { ...data };
            if (eventName === 'status_update' && data.type === 'status') {
                // Chỉ thu thập thoughts nếu agentId là HostAgent hoặc không được chỉ định (mặc định là HostAgent)
                if (!data.agentId || data.agentId === 'HostAgent') {
                    allThoughtsCollectedStreaming.push({
                        step: data.step, message: data.message, agentId: 'HostAgent', // Luôn là HostAgent ở đây
                        timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(), details: (data as StatusUpdate).details
                    });
                }
                // Đảm bảo status_update luôn có agentId
                dataToSend.agentId = data.agentId || 'HostAgent';
            }

            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend.thoughts = [...allThoughtsCollectedStreaming];
                if (eventName === 'chat_result' && finalFrontendActionStreaming) {
                    (dataToSend as ResultUpdate).action = finalFrontendActionStreaming;
                }
            }
            socket.emit(eventName, dataToSend);
            logToFile(`[${handlerId} Streaming Emit Sent - ${socketId}] Event: ${eventName}, Type: ${data.type}, Agent: ${dataToSend.agentId || 'N/A'}`);
            return true;
        } catch (error: any) {
            logToFile(`[${handlerId} Streaming Emit FAILED - ${socketId}] Error: ${error.message}. Event: ${eventName}`);
            return false;
        }
    };

    const hostAgentStreamingStatusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        return safeEmitStreaming(eventName, { ...data, agentId: 'HostAgent' });
    };


    async function processAndEmitStream(stream: AsyncGenerator<EnhancedGenerateContentResponse>): Promise<{ fullText: string } | null> {
        let accumulatedText = "";
        let streamFinished = false;
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) return null;

        try {
            for await (const chunk of stream) {
                if (!socket.connected) { logToFile(`[${handlerId} Stream Abort - ${socketId}] Disconnected.`); return null; }
                const chunkText = chunk.text();
                if (chunkText) {
                    accumulatedText += chunkText;
                    if (!safeEmitStreaming('chat_update', { type: 'partial_result', textChunk: chunkText })) return null;
                }
            }
            streamFinished = true;
            return { fullText: accumulatedText };
        } catch (error: any) {
            logToFile(`[${handlerId} Stream Processing Error - ${socketId}] ${error.message}`);
            throw error;
        } finally {
            if (!streamFinished) logToFile(`[${handlerId} Stream Processing Warn - ${socketId}] Stream loop exited unexpectedly.`);
        }
    }

    try {
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return;

        // Khởi tạo nextTurnInputForHost với userInput ban đầu.
        let nextTurnInputForHost: string | Part[] = userInput;
        let currentHostTurn = 1;

        while (currentHostTurn <= maxTurnsHostAgent) {
            logToFile(`--- [${handlerId} HostAgent Streaming Turn ${currentHostTurn} Start - Socket ${socketId}] Input type: ${typeof nextTurnInputForHost === 'string' ? 'string' : 'Part[]'}, History size: ${history.length} ---`);
            if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? `Continuing process based on previous action (Turn ${currentHostTurn})...` : 'Thinking...' })) return;
            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected before Host model call.`); return; }

            // Gọi generateStream với nextTurnInputForHost và history TÍCH LŨY của Host
            const hostAgentLLMResult = await geminiServiceForHost.generateStream(
                nextTurnInputForHost,
                history,
                hostAgentGenerationConfig,
                systemInstructions,
                hostAgentTools
            );

            if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after Host model call initiated.`); return; }

            if (hostAgentLLMResult.error) {
                logToFile(`[${handlerId} Streaming Error T${currentHostTurn}] HostAgent model error: ${hostAgentLLMResult.error}`);
                safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
                return history; // Trả về history hiện tại
            } else if (hostAgentLLMResult.functionCalls) { // Lưu ý: Gemini.ts trả về functionCalls (số nhiều) nhưng là một FunctionCall object đơn
                const functionCall = hostAgentLLMResult.functionCalls as FunctionCall; // Ép kiểu nếu chắc chắn là 1
                // Thêm lượt model (yêu cầu function call) vào history
                const modelFunctionCallTurn: ChatHistoryItem = { role: 'model', parts: [{ functionCall: functionCall }] };
                history.push(modelFunctionCallTurn);
                logToFile(`[${handlerId} Streaming T${currentHostTurn}] HostAgent requests function: ${functionCall.name}. History size: ${history.length}`);

                let functionResponseForNextTurn: FunctionResponsePart;
                let functionErrorOccurred = false;

                if (functionCall.name === 'routeToAgent') {
                    const routeArgs = functionCall.args as RouteToAgentArgs;
                    hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: functionCall.args });

                    if (!routeArgs.targetAgent || !routeArgs.taskDescription) {
                        functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: "Routing failed: Missing targetAgent or taskDescription." } } };
                        functionErrorOccurred = true;
                    } else if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                        functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` } } };
                        functionErrorOccurred = true;
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
                            allThoughtsCollectedStreaming.push(...subAgentResponse.thoughts);
                        }

                        if (subAgentResponse.status === 'success') {
                            functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") } } };
                            if (subAgentResponse.frontendAction) {
                                finalFrontendActionStreaming = subAgentResponse.frontendAction;
                                onActionGenerated?.(finalFrontendActionStreaming);
                            }
                        } else {
                            functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` } } };
                            functionErrorOccurred = true;
                        }
                    }
                } else {
                    const errMsg = `Internal config error: HostAgent (streaming) cannot directly call '${functionCall.name}'.`;
                    functionResponseForNextTurn = { functionResponse: { name: functionCall.name, response: { error: errMsg } } };
                    functionErrorOccurred = true;
                    hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'host_agent_config_error', message: errMsg, details: { functionName: functionCall.name } });
                }

                if (!socket.connected) { logToFile(`[${handlerId} Abort T${currentHostTurn} - ${socketId}] Disconnected after routing/function execution.`); return; }

                // Thêm lượt function (kết quả) vào history
                const functionResponseTurn: ChatHistoryItem = { role: 'function', parts: [functionResponseForNextTurn] };
                history.push(functionResponseTurn);
                logToFile(`[${handlerId} Streaming T${currentHostTurn}] Appended function response for ${functionCall.name}. History size: ${history.length}`);

                // CẬP NHẬT input cho lượt tiếp theo của Host Agent
                // CHO LƯỢT TIẾP THEO CỦA HOST, chúng ta muốn model xử lý history đã được cập nhật.
                // Không cần truyền lại FunctionResponsePart làm nextTurnInput nữa.
                // Truyền một chuỗi rỗng hoặc một user input mới nếu có.
                // Nếu truyền chuỗi rỗng, Gemini class sẽ không thêm lượt 'user' mới.
                nextTurnInputForHost = ""; // Hoặc một thông điệp user mới nếu user có thể ngắt lời
                currentHostTurn++;
                // if (functionErrorOccurred && some_condition_to_stop_streaming) {
                //     safeEmitStreaming('chat_error', { type: 'error', message: 'Failed to execute required action (streaming).', step: 'function_execution_failed_stream' });
                //     return history;
                // }
                continue; // Vòng lặp tiếp theo của Host Agent

            } else if (hostAgentLLMResult.stream) {
                // Host Agent quyết định trả lời trực tiếp bằng stream
                hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'generating_response', message: 'Generating final answer...' });
                const streamOutput = await processAndEmitStream(hostAgentLLMResult.stream);
                if (streamOutput && socket.connected) { // Kiểm tra socket.connected lần nữa sau khi stream kết thúc
                    const botMessageUuid = uuidv4();
                    const finalModelTurn: ChatHistoryItem = { role: 'model', parts: [{ text: streamOutput.fullText }], uuid: botMessageUuid, timestamp: new Date() };
                    history.push(finalModelTurn);
                    logToFile(`[${handlerId} Streaming - Final Result] Thoughts collected: ${JSON.stringify(allThoughtsCollectedStreaming)}`);
                    safeEmitStreaming('chat_result', { type: 'result', message: streamOutput.fullText, id: botMessageUuid });
                    return history;
                } else {
                    // Lỗi trong processAndEmitStream hoặc client disconnected
                    logToFile(`[${handlerId} Streaming Error T${currentHostTurn}] Failed to process final stream or client disconnected.`);
                    if (socket.connected) { // Chỉ emit lỗi nếu socket còn kết nối
                        safeEmitStreaming('chat_error', { type: 'error', message: 'Failed to process final stream response.', step: 'streaming_response_error' });
                    }
                    return history; // Trả về history hiện tại
                }
            } else {
                // Trường hợp không mong muốn từ generateStream (ví dụ: không error, không functionCalls, không stream)
                logToFile(`[${handlerId} Streaming Error T${currentHostTurn}] HostAgent model unexpected response (streaming).`);
                safeEmitStreaming('chat_error', { type: 'error', message: 'Internal error: Unexpected AI response (streaming).', step: 'unknown_host_llm_status_stream' });
                return history;
            }
        } // Kết thúc while loop

        if (currentHostTurn > maxTurnsHostAgent) {
            logToFile(`[${handlerId} Streaming Error] Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long or got stuck in a loop (streaming).', step: 'max_turns_exceeded_stream' });
            return history;
        }

    } catch (error: any) {
        const criticalErrorMsg = error instanceof Error ? error.message : "An unknown critical error occurred";
        logToFile(`[${handlerId} Streaming CRITICAL Error - ${socketId} Lang: ${language}] ${criticalErrorMsg}\nStack: ${error.stack}`);
        if (socket.connected) {
            safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg, step: 'unknown_handler_error_stream' });
        }
        return history; // Trả về history hiện tại
    } finally {
        logToFile(`--- [${handlerId} Socket ${socketId} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }

    logToFile(`[${handlerId} Streaming WARN] Reached end of handler unexpectedly. Returning current history.`);
    return history;
}