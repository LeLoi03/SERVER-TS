// src/chatbot/handlers/hostAgent.streaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Tool, Part, GenerateContentResponse, GenerateContentConfig, Content } from '@google/genai';
import { ChatHistoryItem, FrontendAction, Language, AgentId, ThoughtStep, StatusUpdate, ResultUpdate, ErrorUpdate, ChatUpdate, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo } from '../shared/types';
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';
import { Logger } from 'pino'; // <<< ĐÃ THÊM
import { performance } from 'perf_hooks'; // <<< ĐÃ THÊM

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
    handlerId: string,
    deps: HostAgentHandlerCustomDeps,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[],
    pageContextText?: string,
    pageContextUrl?: string,
    // <<< THÊM THAM SỐ NÀY VÀO >>>
    userSelectedModel?: string,
    logger?: Logger,
    performanceCallback?: (metrics: { prep: number, ai: number }) => void
): Promise<ChatHistoryItem[] | void> {
    const { geminiServiceForHost, hostAgentGenerationConfig, allowedSubAgents, maxTurnsHostAgent, callSubAgentHandler } = deps;
    const baseLogContext = `[${handlerId} Streaming Socket ${socket.id}]`;
    const requestId = handlerId; // Đổi tên để rõ nghĩa là requestId

    const conversationIdForSubAgent = handlerId;

    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(
        language,
        'HostAgent',
        personalizationData,
        pageContextText
    );
    const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let completeHistoryToSave: ChatHistoryItem[] = [...initialHistoryFromSocket];
    let historyForApiCall: ChatHistoryItem[] = [];

    if (pageContextText) {
        const pageContextTurn: ChatHistoryItem = {
            role: 'user',
            parts: [{ text: pageContextText }],
            uuid: `context-${handlerId}-${Date.now()}`,
            timestamp: new Date(Date.now() - 1000)
        };
        historyForApiCall.push(pageContextTurn);
    }
    historyForApiCall.push(...initialHistoryFromSocket);

    const allThoughtsCollectedStreaming: ThoughtStep[] = [];
    let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

    const currentUserTurn: ChatHistoryItem = {
        role: 'user',
        parts: userInputParts,
        timestamp: new Date(),
        uuid: frontendMessageId || `user-stream-${handlerId}-${Date.now()}`,
        userFileInfo: originalUserFiles && originalUserFiles.length > 0 ? originalUserFiles : undefined
    };

    if (currentUserTurn.parts.length > 0 || pageContextText) {
        completeHistoryToSave.push(currentUserTurn);
    }

    const safeEmitStreaming = (
        eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
        data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate
    ): boolean => {
        if (!socket.connected) return false;
        try {
            let dataToSend: any = { ...data };
            if (eventName === 'status_update' && data.type === 'status') {
                if (!data.agentId || data.agentId === 'HostAgent') {
                    allThoughtsCollectedStreaming.push({
                        step: data.step, message: data.message, agentId: 'HostAgent',
                        timestamp: (data as StatusUpdate).timestamp || new Date().toISOString(), details: (data as StatusUpdate).details
                    });
                }
                dataToSend.agentId = data.agentId || 'HostAgent';
            }
            if (eventName === 'chat_result' || eventName === 'chat_error') {
                dataToSend.thoughts = [...allThoughtsCollectedStreaming];
                if (eventName === 'chat_result' && finalFrontendActionStreaming) {
                    (dataToSend as ResultUpdate).action = finalFrontendActionStreaming;
                }
                if ((data as ResultUpdate).sources) {
                    dataToSend.sources = (data as ResultUpdate).sources;
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

    // <<< SỬA ĐỔI QUAN TRỌNG: Cập nhật hàm processAndEmitStream >>>
    async function processAndEmitStream(
        stream: AsyncGenerator<GenerateContentResponse>,
        requestId: string, // Nhận requestId
        logger?: Logger    // Nhận logger
    ): Promise<{ fullText: string; parts?: Part[] } | null> {
        let accumulatedText = "";
        let accumulatedParts: Part[] = [];
        let streamFinishedSuccessfully = false;
        let firstTokenTime: number | null = null; // Biến để lưu thời điểm nhận token đầu tiên

        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) return null;


        try {
            for await (const chunk of stream) {
                // <<< THÊM MỚI: Ghi nhận thời điểm nhận token đầu tiên >>>
                if (firstTokenTime === null) {
                    firstTokenTime = performance.now();
                    if (logger) {
                        logger.info({
                            event: 'performance_log',
                            stage: 'ai_first_token_received',
                            requestId,
                        }, `Received first token from Gemini API.`);
                    }
                }
                // <<< KẾT THÚC THÊM MỚI >>>
                const chunkText = chunk.text;
                if (chunkText !== undefined && chunkText !== null) {
                    accumulatedText += chunkText;
                    if (!safeEmitStreaming('chat_update', { type: 'partial_result', textChunk: chunkText })) return null;
                }
                const chunkParts = chunk.candidates?.[0]?.content?.parts;
                if (chunkParts) {
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
            if (accumulatedParts.length === 0 && accumulatedText) {
                accumulatedParts.push({ text: accumulatedText });
            }
            return { fullText: accumulatedText, parts: accumulatedParts };
        } catch (error: any) {
            if (socket.connected) {
                safeEmitStreaming('chat_error', { type: 'error', message: `Error processing stream: ${error.message}`, step: 'streaming_processing_error' });
            }
            return null;
        }
    }

    try {
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return completeHistoryToSave;

        let nextTurnInputForLlm: Part[] = userInputParts;
        let currentHostTurn = 1;

        while (currentHostTurn <= maxTurnsHostAgent) {

            const currentApiHistoryForThisCall = [...historyForApiCall];

            if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? `Continuing process (Turn ${currentHostTurn})...` : 'Thinking...' })) return completeHistoryToSave;

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig, systemInstruction: systemInstructions, tools: hostAgentTools
            };

            // <<< SỬA ĐỔI QUAN TRỌNG: Cập nhật khối log >>>
            const aiCallStartTime = performance.now();
            if (logger) {
                logger.info({
                    event: 'performance_log',
                    stage: 'ai_call_start',
                    requestId,
                    details: {
                        turn: currentHostTurn,
                        // Model người dùng yêu cầu (nếu có)
                        requestedModel: userSelectedModel || 'default',
                        // // Model thực sự được sử dụng để gọi API
                        // actualModel: geminiServiceForHost.modelName,
                    }
                }, `Calling Gemini API.`);
            }
            // <<< KẾT THÚC SỬA ĐỔI >>>

            const hostAgentLLMResult = await geminiServiceForHost.generateStream(
                nextTurnInputForLlm,
                currentApiHistoryForThisCall,
                combinedConfig
            );
            const aiCallEndTime = performance.now(); // <<< THÊM MỚI: Ghi nhận thời điểm kết thúc ngay lập tức


            if (currentHostTurn === 1) {
                if (currentUserTurn.parts.length > 0 || pageContextText) {
                    historyForApiCall.push(currentUserTurn);
                }
            } else {
                const lastFunctionResponseTurnInComplete = completeHistoryToSave.find(
                    msg => msg.role === 'function' && msg.parts[0] === nextTurnInputForLlm[0]
                );
                if (lastFunctionResponseTurnInComplete) {
                    historyForApiCall.push(lastFunctionResponseTurnInComplete);
                }
            }

            if (hostAgentLLMResult.error) {
                safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
                return completeHistoryToSave;
            } else if (hostAgentLLMResult.functionCall) {
                // <<< THÊM MỚI: Ghi log cho function call >>>
                if (logger) {
                    logger.info({
                        event: 'performance_log',
                        stage: 'ai_function_call_completed', // Một stage mới
                        requestId,
                        details: {
                            turn: currentHostTurn,
                            functionName: hostAgentLLMResult.functionCall.name
                        },
                        metrics: {
                            // Thời gian từ lúc bắt đầu gọi đến lúc nhận được function call
                            duration_ms: parseFloat((aiCallEndTime - aiCallStartTime).toFixed(2))
                        }
                    }, `Gemini API returned a function call for turn ${currentHostTurn}.`);
                }
                // <<< KẾT THÚC THÊM MỚI >>>
                const functionCall = hostAgentLLMResult.functionCall;
                const modelUuid = uuidv4();
                const modelFunctionCallTurn: ChatHistoryItem = {
                    role: 'model', parts: [{ functionCall: functionCall }], uuid: modelUuid, timestamp: new Date()
                };
                completeHistoryToSave.push(modelFunctionCallTurn);
                historyForApiCall.push(modelFunctionCallTurn);

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
                                conversationId: conversationIdForSubAgent,
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
                                    if (subAgentResponse.frontendAction.type === 'displayConferenceSources') {
                                        if (finalFrontendActionStreaming && finalFrontendActionStreaming.type === 'displayConferenceSources') {
                                            finalFrontendActionStreaming.payload.conferences.push(
                                                ...subAgentResponse.frontendAction.payload.conferences
                                            );
                                        } else {
                                            finalFrontendActionStreaming = subAgentResponse.frontendAction;
                                        }
                                    } else {
                                        finalFrontendActionStreaming = subAgentResponse.frontendAction;
                                    }
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

                const functionResponseUuid = uuidv4();
                const functionResponseTurn: ChatHistoryItem = {
                    role: 'function', parts: [functionResponseContentPart], uuid: functionResponseUuid, timestamp: new Date()
                };
                completeHistoryToSave.push(functionResponseTurn);
                nextTurnInputForLlm = [functionResponseContentPart];
                currentHostTurn++;
                continue;
            } else if (hostAgentLLMResult.stream) {
                // <<< SỬA ĐỔI QUAN TRỌNG: Đo TTFT bên trong processAndEmitStream >>>
                const streamOutput = await processAndEmitStream(
                    hostAgentLLMResult.stream,
                    requestId, // Truyền requestId vào
                    logger     // Truyền logger vào
                );

                const aiStreamEndTime = performance.now();
                if (logger) {
                    logger.info({
                        event: 'performance_log',
                        stage: 'ai_stream_completed',
                        requestId,
                        details: { turn: currentHostTurn },
                        metrics: {
                            // <<< SỬA ĐỔI: Dùng aiCallEndTime thay vì aiStreamEndTime để nhất quán >>>
                            totalStreamDuration_ms: parseFloat((aiCallEndTime - aiCallStartTime).toFixed(2))
                        }
                    }, `Gemini API stream finished for turn ${currentHostTurn}.`);
                }



                if (performanceCallback && (socket as any).requestStartTime) {
                    // Callback vẫn có thể báo cáo tổng thời gian AI
                    performanceCallback({
                        prep: aiCallStartTime - (socket as any).requestStartTime,
                        ai: aiStreamEndTime - aiCallStartTime
                    });
                }
                // <<< KẾT THÚC THÊM MỚI >>>

                if (streamOutput && socket.connected) {
                    const botMessageUuid = uuidv4();
                    const finalModelParts = streamOutput.parts && streamOutput.parts.length > 0 ? streamOutput.parts : [{ text: streamOutput.fullText }];
                    const finalModelTurn: ChatHistoryItem = {
                        role: 'model',
                        parts: finalModelParts,
                        uuid: botMessageUuid,
                        timestamp: new Date(),
                        sources: []
                    };

                    if (pageContextUrl && pageContextText) {
                        try {
                            const urlObj = new URL(pageContextUrl);
                            finalModelTurn.sources?.push({ name: urlObj.hostname, url: pageContextUrl, type: 'page_context' });
                        } catch (e) {
                            finalModelTurn.sources?.push({ name: pageContextUrl, url: pageContextUrl, type: 'page_context' });
                        }
                    }

                    completeHistoryToSave.push(finalModelTurn);

                    const resultPayload: ResultUpdate = {
                        type: 'result',
                        message: streamOutput.fullText,
                        parts: finalModelParts,
                        id: botMessageUuid,
                        sources: finalModelTurn.sources
                    };
                    safeEmitStreaming('chat_result', resultPayload);
                    return completeHistoryToSave;
                } else {
                    if (socket.connected) safeEmitStreaming('chat_error', { type: 'error', message: 'Failed to process final stream response.', step: 'streaming_response_error' });
                    return completeHistoryToSave;
                }
            } else {
                safeEmitStreaming('chat_error', { type: 'error', message: 'Internal error: Unexpected AI response (streaming).', step: 'unknown_host_llm_status_stream' });
                return completeHistoryToSave;
            }
        }

        if (currentHostTurn > maxTurnsHostAgent) {
            safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long or got stuck in a loop (streaming).', step: 'max_turns_exceeded_stream' });
        }
        return completeHistoryToSave;
    } catch (error: any) {
        const criticalErrorMsg = error instanceof Error ? error.message : "An unknown critical error occurred";
        if (socket.connected) safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg, step: 'unknown_handler_error_stream' });
        return completeHistoryToSave;
    }
}