// src/chatbot/handlers/hostAgent.streaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Tool, Part, GenerateContentResponse, GenerateContentConfig, Content } from '@google/genai';
import { ChatHistoryItem, FrontendAction, Language, AgentId, ThoughtStep, StatusUpdate, ResultUpdate, ErrorUpdate, ChatUpdate, AgentCardRequest, AgentCardResponse, PersonalizationPayload } from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';

interface RouteToAgentArgs { targetAgent: string; taskDescription: string; }
function isRouteToAgentArgs(args: any): args is RouteToAgentArgs {
    if (typeof args !== 'object' || args === null) return false;
    return typeof args.targetAgent === 'string' && typeof args.taskDescription === 'string';
}

export async function handleStreaming(
    userInputParts: Part[],
    initialHistoryFromSocket: ChatHistoryItem[],
    socket: Socket,
    language: Language,
    handlerId: string, // Đây sẽ được dùng như conversationId cho logic bên trong
    deps: HostAgentHandlerCustomDeps,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null
): Promise<ChatHistoryItem[] | void> {
    const { geminiServiceForHost, hostAgentGenerationConfig, logToFile, allowedSubAgents, maxTurnsHostAgent, callSubAgentHandler } = deps;
    const baseLogContext = `[${handlerId} Streaming Socket ${socket.id}]`;
    const inputTextSummary = userInputParts.find(p => p.text)?.text || `[${userInputParts.length} parts content]`;
    logToFile(`--- ${baseLogContext} Handling inputParts: "${inputTextSummary.substring(0, 50)}...", Lang: ${language}, Personalization: ${!!personalizationData} ---`);

    // Sử dụng handlerId như là conversationId cho AgentCardRequest
    const conversationIdForSubAgent = handlerId;

    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(language, 'HostAgent', personalizationData);
    const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let completeHistoryToSave: ChatHistoryItem[] = [...initialHistoryFromSocket];
    let historyForApiCall: ChatHistoryItem[] = [...initialHistoryFromSocket];

    const allThoughtsCollectedStreaming: ThoughtStep[] = [];
    let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

    const currentUserTurn: ChatHistoryItem = {
        role: 'user',
        parts: userInputParts,
        timestamp: new Date(),
        uuid: frontendMessageId || `user-stream-${handlerId}-${Date.now()}`
    };
    completeHistoryToSave.push(currentUserTurn);
    logToFile(`${baseLogContext} User turn (UUID: ${currentUserTurn.uuid}) added to completeHistoryToSave. Total: ${completeHistoryToSave.length}`);


    const safeEmitStreaming = (
        eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
        data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate
    ): boolean => {
        if (!socket.connected) {
            return false;
        }
        try {
            let dataToSend: any = { ...data };
            if (eventName === 'status_update' && data.type === 'status') {
                if (!data.agentId || data.agentId === 'HostAgent') { // Only add HostAgent thoughts here
                    allThoughtsCollectedStreaming.push({
                        step: data.step, message: data.message, agentId: 'HostAgent',
                        timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(), details: (data as StatusUpdate).details
                    });
                }
                // Ensure agentId is set for the emitted event, defaulting to HostAgent if not specified by a sub-agent
                dataToSend.agentId = data.agentId || 'HostAgent';
            }

            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend.thoughts = [...allThoughtsCollectedStreaming]; // Send all collected thoughts
                if (eventName === 'chat_result' && finalFrontendActionStreaming) {
                    (dataToSend as ResultUpdate).action = finalFrontendActionStreaming;
                }
            }
            socket.emit(eventName, dataToSend);
            return true;
        } catch (error: any) {
            return false;
        }
    };

    const hostAgentStreamingStatusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        return safeEmitStreaming(eventName, { ...data, agentId: 'HostAgent' });
    };

    async function processAndEmitStream(stream: AsyncGenerator<GenerateContentResponse>): Promise<{ fullText: string; parts?: Part[] } | null> {
        let accumulatedText = "";
        let accumulatedParts: Part[] = []; // To store all parts from the stream if needed
        let streamFinishedSuccessfully = false;
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) return null;

        try {
            for await (const chunk of stream) { // chunk is GenerateContentResponse

                const chunkText = chunk.text; // text is a direct property
                if (chunkText !== undefined && chunkText !== null) {
                    accumulatedText += chunkText;
                    if (!safeEmitStreaming('chat_update', { type: 'partial_result', textChunk: chunkText })) return null;
                }

                // Accumulate all parts from the chunk if they exist
                // chunk.candidates[0].content.parts
                const chunkParts = chunk.candidates?.[0]?.content?.parts;
                if (chunkParts) {
                    // A simple way to merge: if the last accumulated part is text and current chunkPart is text, append.
                    // Otherwise, push. This is a basic merge.
                    chunkParts.forEach(cp => {
                        if (cp.text && accumulatedParts.length > 0 && accumulatedParts[accumulatedParts.length - 1].text) {
                            accumulatedParts[accumulatedParts.length - 1].text += cp.text;
                        } else {
                            accumulatedParts.push(cp);
                        }
                    });
                }
            }
            streamFinishedSuccessfully = true;
            // If accumulatedParts is empty but text is not, create a text part
            if (accumulatedParts.length === 0 && accumulatedText) {
                accumulatedParts.push({ text: accumulatedText });
            }
            return { fullText: accumulatedText, parts: accumulatedParts };
        } catch (error: any) {
            if (socket.connected) {
                safeEmitStreaming('chat_error', { type: 'error', message: `Error processing stream: ${error.message}`, step: 'streaming_processing_error' });
            }
            return null;
        } finally {
            if (!streamFinishedSuccessfully) {
            }
        }
    }
     try {
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return completeHistoryToSave;

        let nextTurnInputForLlm: Part[] = userInputParts;
        let currentHostTurn = 1;

        while (currentHostTurn <= maxTurnsHostAgent) {
            const turnLogContext = `${baseLogContext} Turn ${currentHostTurn}`;
            
            logToFile(`--- ${turnLogContext} Start --- Input type: Part[] length ${nextTurnInputForLlm.length}, API History (to send): ${historyForApiCall.length} ---`);
            if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? `Continuing process (Turn ${currentHostTurn})...` : 'Thinking...' })) return completeHistoryToSave;
            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected before Host model call.`); return completeHistoryToSave; }

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig, systemInstruction: systemInstructions, tools: hostAgentTools
            };

            const hostAgentLLMResult = await geminiServiceForHost.generateStream(
                nextTurnInputForLlm,
                historyForApiCall,
                combinedConfig
            );

            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after Host model call initiated.`); return completeHistoryToSave; }

            // Cập nhật historyForApiCall SAU KHI gọi API, với lượt mà nextTurnInputForLlm vừa đại diện
            if (currentHostTurn === 1) {
                historyForApiCall.push(currentUserTurn);
            } else {
                // Tìm lượt function response cuối cùng trong completeHistoryToSave
                // (đã được thêm ở vòng lặp trước khi nextTurnInputForLlm là function response đó)
                let lastFunctionResponseTurn: ChatHistoryItem | undefined;
                for (let i = completeHistoryToSave.length - 1; i >= 0; i--) {
                    if (completeHistoryToSave[i].role === 'function') {
                        lastFunctionResponseTurn = completeHistoryToSave[i];
                        break;
                    }
                }

                if (lastFunctionResponseTurn) {
                    // Chỉ thêm nếu nó chưa có trong historyForApiCall (để tránh trùng lặp nếu logic phức tạp hơn)
                    // Cách đơn giản là giả định nó chưa có và push.
                    // Hoặc, đảm bảo rằng historyForApiCall được xây dựng lại chính xác.
                    // Với logic hiện tại, nó nên được push.
                    historyForApiCall.push(lastFunctionResponseTurn);
                } else {
                    logToFile(`${turnLogContext} WARNING: Could not find last function response in completeHistoryToSave to update historyForApiCall for turn > 1. This might be an issue if multiple function calls occur without intervening user/model text turns.`);
                }
            }

            if (hostAgentLLMResult.error) {
                logToFile(`${turnLogContext} Error - HostAgent model error: ${hostAgentLLMResult.error}`);
                safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
                return completeHistoryToSave;
            } else if (hostAgentLLMResult.functionCall) {
                const functionCall = hostAgentLLMResult.functionCall;
                const modelUuid = uuidv4();
                const modelFunctionCallTurn: ChatHistoryItem = {
                    role: 'model', parts: [{ functionCall: functionCall }], uuid: modelUuid, timestamp: new Date()
                };
                
                completeHistoryToSave.push(modelFunctionCallTurn);
                historyForApiCall.push(modelFunctionCallTurn);
                logToFile(`${turnLogContext} HostAgent requests function: ${functionCall.name}. Save history: ${completeHistoryToSave.length}, API history: ${historyForApiCall.length}`);

                let functionResponseContentPart: Part;
                if (functionCall.name === 'routeToAgent') {
                    if (isRouteToAgentArgs(functionCall.args)) {
                        const routeArgs = functionCall.args;
                        hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: routeArgs });

                        if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                            functionResponseContentPart = {
                                functionResponse: { name: functionCall.name, response: { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` } }
                            };
                        } else {
                            const requestCard: AgentCardRequest = {
                                taskId: uuidv4(),
                                conversationId: conversationIdForSubAgent, // Sử dụng biến đã khai báo
                                senderAgentId: 'HostAgent',
                                receiverAgentId: routeArgs.targetAgent as AgentId,
                                timestamp: new Date().toISOString(),
                                taskDescription: routeArgs.taskDescription,
                                context: { userToken: socket.data.token, language },
                            };
                            const subAgentResponse: AgentCardResponse = await callSubAgentHandler(requestCard, handlerId, language, socket);
                            if (subAgentResponse.thoughts) allThoughtsCollectedStreaming.push(...subAgentResponse.thoughts);

                            if (subAgentResponse.status === 'success') {
                                functionResponseContentPart = {
                                    functionResponse: { name: functionCall.name, response: { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") } }
                                };
                                if (subAgentResponse.frontendAction) {
                                    finalFrontendActionStreaming = subAgentResponse.frontendAction;
                                    onActionGenerated?.(finalFrontendActionStreaming);
                                }
                            } else {
                                functionResponseContentPart = {
                                    functionResponse: { name: functionCall.name, response: { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` } }
                                };
                            }
                        }
                    } else {
                        functionResponseContentPart = {
                            functionResponse: { name: functionCall.name, response: { error: "Routing failed: Invalid or missing arguments for routeToAgent." } }
                        };
                    }
                } else {
                    const errMsg = `Internal config error: HostAgent (streaming) cannot directly call '${functionCall.name}'.`;
                    functionResponseContentPart = {
                        functionResponse: { name: functionCall.name, response: { error: errMsg } }
                    };
                }

                if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after routing/function execution.`); return completeHistoryToSave; }

                const functionResponseUuid = uuidv4();
                const functionResponseTurn: ChatHistoryItem = {
                    role: 'function', parts: [functionResponseContentPart], uuid: functionResponseUuid, timestamp: new Date()
                };
                completeHistoryToSave.push(functionResponseTurn);
                // Lượt function response này sẽ được thêm vào historyForApiCall ở ĐẦU vòng lặp tiếp theo
                // thông qua logic cập nhật historyForApiCall ở trên, nếu nó trở thành nextTurnInputForLlm.
                logToFile(`${turnLogContext} Appended function response for ${functionCall.name}. Save history: ${completeHistoryToSave.length}`);
                
                nextTurnInputForLlm = [functionResponseContentPart];
                currentHostTurn++;
                continue;
            } else if (hostAgentLLMResult.stream) {
                const streamOutput = await processAndEmitStream(hostAgentLLMResult.stream);
                if (streamOutput && socket.connected) {
                    const botMessageUuid = uuidv4();
                    const finalModelParts = streamOutput.parts && streamOutput.parts.length > 0 ? streamOutput.parts : [{ text: streamOutput.fullText }];
                    const finalModelTurn: ChatHistoryItem = {
                        role: 'model', parts: finalModelParts, uuid: botMessageUuid, timestamp: new Date()
                    };
                    completeHistoryToSave.push(finalModelTurn);
                    safeEmitStreaming('chat_result', { type: 'result', message: streamOutput.fullText, parts: finalModelParts, id: botMessageUuid });
                    return completeHistoryToSave;
                } else { 
                    logToFile(`${turnLogContext} Error - Failed to process final stream or client disconnected.`);
                    if (socket.connected) safeEmitStreaming('chat_error', { type: 'error', message: 'Failed to process final stream response.', step: 'streaming_response_error' });
                    return completeHistoryToSave;
                }
            } else { 
                logToFile(`${turnLogContext} Error - HostAgent model unexpected response (streaming).`);
                safeEmitStreaming('chat_error', { type: 'error', message: 'Internal error: Unexpected AI response (streaming).', step: 'unknown_host_llm_status_stream' });
                return completeHistoryToSave;
            }
        }

        if (currentHostTurn > maxTurnsHostAgent) { 
            logToFile(`${baseLogContext} Error - Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long or got stuck in a loop (streaming).', step: 'max_turns_exceeded_stream' });
        }
        return completeHistoryToSave;
    } catch (error: any) { 
        const criticalErrorMsg = error instanceof Error ? error.message : "An unknown critical error occurred";
        logToFile(`${baseLogContext} CRITICAL Error - Lang: ${language}] ${criticalErrorMsg}\nStack: ${error.stack}`);
        if (socket.connected) safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg, step: 'unknown_handler_error_stream' });
        return completeHistoryToSave;
    }
    finally { 
        logToFile(`--- ${baseLogContext} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}