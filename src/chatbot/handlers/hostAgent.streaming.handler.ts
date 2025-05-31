// src/chatbot/handlers/hostAgent.streaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import {
    Tool,
    Part,
    GenerateContentResponse,
    GenerateContentConfig,
    Content,
    FunctionCall,
    Candidate, // Import Candidate
    CitationMetadata // Import CitationMetadata
} from '@google/genai';
import {
    ChatHistoryItem, FrontendAction, Language, AgentId, ThoughtStep, StatusUpdate, ResultUpdate, ErrorUpdate,
    ChatUpdate, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo
} from '../shared/types'; // Đảm bảo ChatHistoryItem có thể chứa citationMetadata nếu bạn muốn lưu
import { getAgentLanguageConfig } from '../utils/languageConfig';
import { HostAgentHandlerCustomDeps } from './intentHandler.dependencies';
import logToFile from '../../utils/logger';
interface RouteToAgentArgs { targetAgent: string; taskDescription: string; }
function isRouteToAgentArgs(args: any): args is RouteToAgentArgs {
    if (typeof args !== 'object' || args === null) return false;
    return typeof args.targetAgent === 'string' && typeof args.taskDescription === 'string';
}

async function executeHostAgentFunction(
    functionCall: FunctionCall,
    deps: HostAgentHandlerCustomDeps,
    handlerId: string,
    language: Language,
    socket: Socket,
    conversationIdForSubAgent: string,
    statusCallback: (eventName: 'status_update', data: StatusUpdate) => boolean,
    allThoughtsCollected: ThoughtStep[]
    // onActionGenerated không cần truyền vào đây nữa, sẽ xử lý ở nơi gọi
): Promise<{ functionResponsePart: Part; frontendAction?: FrontendAction }> {
    const { logToFile, allowedSubAgents, callSubAgentHandler } = deps;
    const functionName = functionCall.name;
    const functionArgs = functionCall.args || {};

    logToFile(`[${handlerId}] Executing HostAgent function: ${functionName} with args: ${JSON.stringify(functionArgs)}`);
    statusCallback('status_update', { type: 'status', step: `executing_function_${functionName}`, message: `Executing function: ${functionName}...` });

    let responseContent: any = { error: `Function ${functionName} is not implemented by HostAgent or failed.` };
    let frontendActionFromSubAgent: FrontendAction | undefined = undefined;

    if (functionName === 'routeToAgent') {
        if (isRouteToAgentArgs(functionArgs)) {
            const routeArgs = functionArgs;
            statusCallback('status_update', { type: 'status', step: 'routing_task', message: `Routing task to ${routeArgs.targetAgent}...`, details: routeArgs });

            if (!allowedSubAgents.includes(routeArgs.targetAgent as AgentId)) {
                responseContent = { error: `Routing failed: Agent "${routeArgs.targetAgent}" is not allowed or supported.` };
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
                if (subAgentResponse.thoughts) allThoughtsCollected.push(...subAgentResponse.thoughts);

                if (subAgentResponse.status === 'success') {
                    responseContent = { content: JSON.stringify(subAgentResponse.resultData || "Sub agent task completed.") };
                    if (subAgentResponse.frontendAction) {
                        frontendActionFromSubAgent = subAgentResponse.frontendAction;
                    }
                } else {
                    responseContent = { error: subAgentResponse.errorMessage || `Error in ${routeArgs.targetAgent}.` };
                }
            }
        } else {
            responseContent = { error: "Routing failed: Invalid or missing arguments for routeToAgent." };
        }
    }
    // Các function call tùy chỉnh khác của HostAgent có thể được thêm ở đây

    return {
        functionResponsePart: {
            functionResponse: {
                name: functionName,
                response: responseContent,
            },
        },
        frontendAction: frontendActionFromSubAgent
    };
}

interface ProcessedStreamOutput {
    fullText: string;
    parts?: Part[];
    citationMetadata?: CitationMetadata | null; // Sử dụng type từ SDK
}

async function processAndEmitStream(
    stream: AsyncGenerator<GenerateContentResponse>,
    baseLogContext: string,
    hostAgentStreamingStatusUpdateCallback: (eventName: 'status_update', data: StatusUpdate) => boolean,
    safeEmitChatUpdate: (data: ChatUpdate) => boolean // Chỉ cần callback cho chat_update
): Promise<ProcessedStreamOutput | null> {
    let accumulatedText = "";
    let accumulatedParts: Part[] = [];
    let finalCitationMetadata: CitationMetadata | null = null;

    if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'streaming_response', message: 'Receiving response...' })) {
        return null;
    }

    try {
        for await (const chunk of stream) {
            const candidate: Candidate | undefined = chunk.candidates?.[0];

            if (candidate?.citationMetadata) {
                // Ghi đè hoặc hợp nhất citation metadata.
                // Thông thường, citation metadata liên quan đến toàn bộ phản hồi,
                // nên lấy cái cuối cùng hoặc hợp nhất có thể hợp lý.
                // Để đơn giản, chúng ta có thể lấy cái đầu tiên gặp hoặc cái cuối cùng.
                // Lấy cái cuối cùng có thể bao quát hơn.
                finalCitationMetadata = candidate.citationMetadata;
                logToFile(`[${baseLogContext}] Citation metadata found/updated in stream chunk: ${JSON.stringify(finalCitationMetadata)}`);
            }

            const chunkText = chunk.text; // SDK getter, có thể đã xử lý parts
            if (chunkText) { // Kiểm tra chunkText có giá trị không (không phải null/undefined/empty string)
                accumulatedText += chunkText;
                if (!safeEmitChatUpdate({ type: 'partial_result', textChunk: chunkText })) {
                    // Client disconnected or error emitting
                    return null;
                }
            }

            // Tùy chọn: Tích lũy parts nếu bạn muốn cấu trúc chi tiết hơn text
            // Tuy nhiên, nếu chunk.text đã đủ, có thể không cần thiết.
            const chunkContentParts = candidate?.content?.parts;
            if (chunkContentParts) {
                chunkContentParts.forEach(cp => {
                    // Logic gộp part cơ bản (có thể cải tiến nếu cần)
                    if (cp.text && accumulatedParts.length > 0 && accumulatedParts[accumulatedParts.length - 1].text) {
                        accumulatedParts[accumulatedParts.length - 1].text += cp.text;
                    } else if (Object.keys(cp).length > 0) { // Chỉ thêm part có nội dung
                        accumulatedParts.push(cp);
                    }
                });
            }
        }

        // Nếu không có parts nào được tích lũy nhưng có text, tạo một text part
        if (accumulatedParts.length === 0 && accumulatedText) {
            accumulatedParts.push({ text: accumulatedText });
        }

        return {
            fullText: accumulatedText,
            parts: accumulatedParts.length > 0 ? accumulatedParts : undefined,
            citationMetadata: finalCitationMetadata
        };
    } catch (error: any) {
        logToFile(`[${baseLogContext}] Error processing stream: ${error.message}`);
        throw error; // Ném lỗi để nơi gọi xử lý và emit 'chat_error'
    }
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
    originalUserFiles?: OriginalUserFileInfo[]
): Promise<ChatHistoryItem[] | void> {
    const { geminiServiceForHost, hostAgentGenerationConfig, logToFile, maxTurnsHostAgent } = deps;
    const baseLogContext = `[${handlerId} Streaming Socket ${socket.id}]`;
    logToFile(`--- ${baseLogContext} Handling inputParts: "${(userInputParts.find(p => p.text)?.text || '').substring(0, 50)}...", Lang: ${language}, Personalization: ${!!personalizationData?.isPersonalizationEnabled}, GoogleSearch Grounding: ${!!personalizationData?.isGoogleSearchEnabled} ---`);

    const { systemInstructions, tools } = getAgentLanguageConfig(language, 'HostAgent', personalizationData);

    let completeHistoryToSave: ChatHistoryItem[] = [...initialHistoryFromSocket];
    let historyForApiCall: ChatHistoryItem[] = [...initialHistoryFromSocket];
    const allThoughtsCollectedStreaming: ThoughtStep[] = [];
    let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

    const currentUserTurn: ChatHistoryItem = {
        role: 'user',
        parts: userInputParts,
        timestamp: new Date(),
        uuid: frontendMessageId || `user-stream-${handlerId}-${Date.now()}`,
        userFileInfo: originalUserFiles && originalUserFiles.length > 0 ? originalUserFiles : undefined
    };
    completeHistoryToSave.push(currentUserTurn);
    logToFile(`[${baseLogContext}] User turn (UUID: ${currentUserTurn.uuid}) constructed. Files: ${currentUserTurn.userFileInfo?.length || 0}. History length: ${completeHistoryToSave.length}.`);

    const safeEmitStreaming = (
        eventName: 'status_update' | 'chat_update' | 'chat_result' | 'chat_error',
        data: StatusUpdate | ChatUpdate | ResultUpdate | ErrorUpdate
    ): boolean => {
        if (!socket.connected) {
            logToFile(`[${baseLogContext}] Socket disconnected. Cannot emit event '${eventName}'.`);
            return false;
        }
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
                dataToSend.thoughts = [...allThoughtsCollectedStreaming]; // Gửi tất cả thoughts đã thu thập
                if (eventName === 'chat_result' && finalFrontendActionStreaming) {
                    (dataToSend as ResultUpdate).action = finalFrontendActionStreaming;
                }
            }
            socket.emit(eventName, dataToSend);
            return true;
        } catch (error: any) {
            logToFile(`[${baseLogContext}] Error emitting event '${eventName}': ${error.message}`);
            return false;
        }
    };

    const hostAgentStreamingStatusUpdateCallback = (eventName: 'status_update', data: StatusUpdate): boolean => {
        return safeEmitStreaming(eventName, { ...data, agentId: 'HostAgent' });
    };

    try {
        if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'processing_input', message: 'Processing your request...' })) return completeHistoryToSave;

        let nextTurnInputForLlm: Part[] = userInputParts;
        let currentHostTurn = 1;

        while (currentHostTurn <= maxTurnsHostAgent) {
            const turnLogContext = `${baseLogContext} Turn ${currentHostTurn}`;
            const currentApiHistory = [...historyForApiCall]; // Lịch sử cho API call hiện tại

            logToFile(`--- ${turnLogContext} Start --- Input for LLM: "${(nextTurnInputForLlm.find(p => p.text)?.text || '[non-text]').substring(0, 30)}...". API History length: ${currentApiHistory.length} ---`);

            if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? `Continuing process (Turn ${currentHostTurn})...` : 'Thinking...' })) return completeHistoryToSave;
            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected before Host model call.`); return completeHistoryToSave; }

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig,
                systemInstruction: systemInstructions,
                tools: tools
            };

            const hostAgentLLMResult = await geminiServiceForHost.generateStream(
                nextTurnInputForLlm,
                currentApiHistory,
                combinedConfig
            );

            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after Host model call initiated.`); return completeHistoryToSave; }

            // Cập nhật historyForApiCall cho lượt API TIẾP THEO
            // Thêm lượt input (user hoặc function response) mà LLM vừa xử lý
            if (currentHostTurn === 1) { // Lượt đầu tiên, input là currentUserTurn
                historyForApiCall.push(currentUserTurn);
            } else { // Các lượt sau, input là kết quả của function call trước đó
                const lastFunctionResponseTurnInComplete = completeHistoryToSave.find(
                    msg => msg.role === 'function' && msg.parts[0] === nextTurnInputForLlm[0]
                );
                if (lastFunctionResponseTurnInComplete) {
                    historyForApiCall.push(lastFunctionResponseTurnInComplete);
                } else {
                    logToFile(`[WARN] ${turnLogContext} Could not find exact function response turn in completeHistoryToSave to add to historyForApiCall. This might indicate an issue if parts are complex.`);
                    // Fallback: Tạo một turn 'function' tạm thời (ít lý tưởng hơn)
                    // historyForApiCall.push({ role: 'function', parts: nextTurnInputForLlm, uuid: uuidv4(), timestamp: new Date() });
                }
            }
            logToFile(`${turnLogContext} Updated historyForApiCall for NEXT turn. Length: ${historyForApiCall.length}`);


            if (hostAgentLLMResult.error) {
                logToFile(`${turnLogContext} Error - HostAgent model error: ${hostAgentLLMResult.error}`);
                safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
                return completeHistoryToSave;
            } else if (hostAgentLLMResult.functionCall) { // Xử lý function call tùy chỉnh
                const functionCallFromLLM = hostAgentLLMResult.functionCall;
                const modelUuid = uuidv4();
                const modelFunctionCallTurn: ChatHistoryItem = {
                    role: 'model', parts: [{ functionCall: functionCallFromLLM }], uuid: modelUuid, timestamp: new Date()
                };

                completeHistoryToSave.push(modelFunctionCallTurn);
                historyForApiCall.push(modelFunctionCallTurn); // Thêm lượt model (function call) vào lịch sử cho API call tiếp theo
                logToFile(`${turnLogContext} HostAgent requests CUSTOM function: ${functionCallFromLLM.name}. Args: ${JSON.stringify(functionCallFromLLM.args)}.`);

                const executionResult = await executeHostAgentFunction(
                    functionCallFromLLM,
                    deps,
                    handlerId,
                    language,
                    socket,
                    handlerId, // conversationIdForSubAgent
                    hostAgentStreamingStatusUpdateCallback,
                    allThoughtsCollectedStreaming
                );

                // Xử lý frontend action nếu có từ executeHostAgentFunction
                if (executionResult.frontendAction) {
                    finalFrontendActionStreaming = executionResult.frontendAction;
                    onActionGenerated?.(finalFrontendActionStreaming); // Emit ngay nếu cần
                }
                const functionResponseContentPart = executionResult.functionResponsePart;

                if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after function execution.`); return completeHistoryToSave; }

                const functionResponseUuid = uuidv4();
                const functionResponseTurn: ChatHistoryItem = {
                    role: 'function', parts: [functionResponseContentPart], uuid: functionResponseUuid, timestamp: new Date()
                };
                completeHistoryToSave.push(functionResponseTurn);
                // historyForApiCall đã được cập nhật với modelFunctionCallTurn,
                // functionResponseTurn sẽ được thêm vào historyForApiCall ở đầu vòng lặp tiếp theo nếu nó là nextTurnInputForLlm.
                logToFile(`${turnLogContext} Appended function response for ${functionCallFromLLM.name}.`);

                nextTurnInputForLlm = [functionResponseContentPart]; // Input cho lượt LLM tiếp theo
                currentHostTurn++;
                continue; // Tiếp tục vòng lặp để LLM xử lý function response

            } else if (hostAgentLLMResult.stream) { // Xử lý stream (có thể là kết quả từ grounding)
                let streamOutput: ProcessedStreamOutput | null = null;
                try {
                    streamOutput = await processAndEmitStream(
                        hostAgentLLMResult.stream,
                        baseLogContext,
                        hostAgentStreamingStatusUpdateCallback,
                        (data) => safeEmitStreaming('chat_update', data)
                    );
                } catch (streamProcessingError: any) {
                    logToFile(`${turnLogContext} Error - Failed to process stream: ${streamProcessingError.message}.`);
                    if (socket.connected) safeEmitStreaming('chat_error', { type: 'error', message: `Failed to process stream response: ${streamProcessingError.message}`, step: 'streaming_response_error' });
                    return completeHistoryToSave; // Trả về lịch sử hiện tại
                }

                if (streamOutput && socket.connected) {
                    const botMessageUuid = uuidv4();
                    const finalModelParts = streamOutput.parts && streamOutput.parts.length > 0 ? streamOutput.parts : [{ text: streamOutput.fullText }];

                    const finalModelTurn: ChatHistoryItem = {
                        role: 'model',
                        parts: finalModelParts,
                        uuid: botMessageUuid,
                        timestamp: new Date(),
                        // citationMetadata: streamOutput.citationMetadata // Lưu citation metadata nếu có
                    };

                    if (streamOutput.citationMetadata) {
                        logToFile(`[${turnLogContext}] Final response includes citation metadata: ${JSON.stringify(streamOutput.citationMetadata)}`);
                    }

                    completeHistoryToSave.push(finalModelTurn);
                    // historyForApiCall.push(finalModelTurn); // Thêm lượt model vào lịch sử cho API call tiếp theo (nếu có)

                    safeEmitStreaming('chat_result', {
                        type: 'result',
                        message: streamOutput.fullText,
                        parts: finalModelParts,
                        id: botMessageUuid,
                        // citationMetadata: streamOutput.citationMetadata // Gửi cho client nếu cần
                    });
                    logToFile(`${turnLogContext} Stream processed. Final model turn UUID: ${botMessageUuid} added.`);
                    return completeHistoryToSave; // Kết thúc và trả về lịch sử hoàn chỉnh
                } else {
                    // Xử lý trường hợp streamOutput là null (ví dụ: client disconnected trong lúc xử lý stream)
                    // hoặc socket đã disconnected sau khi streamOutput được xử lý.
                    if (!socket.connected) {
                        logToFile(`${turnLogContext} Client disconnected during or after stream processing.`);
                    } else { // streamOutput is null but socket is connected
                        logToFile(`${turnLogContext} Stream processing completed but yielded no output (possibly due to client disconnect during emit).`);
                        // Không cần emit lỗi ở đây nữa nếu processAndEmitStream đã xử lý hoặc ném lỗi
                    }
                    return completeHistoryToSave; // Trả về lịch sử hiện tại
                }
            } else { // Trường hợp không mong muốn: không error, không functionCall, không stream
                logToFile(`${turnLogContext} Error - HostAgent model unexpected response (no error, no function call, no stream).`);
                safeEmitStreaming('chat_error', { type: 'error', message: 'Internal error: Unexpected AI response.', step: 'unknown_host_llm_empty_response' });
                return completeHistoryToSave;
            }
        } // Kết thúc while loop

        if (currentHostTurn > maxTurnsHostAgent) {
            logToFile(`${baseLogContext} Error - Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long or got stuck in a loop.', step: 'max_turns_exceeded' });
        }
        return completeHistoryToSave; // Trả về lịch sử nếu vòng lặp kết thúc do max_turns
    } catch (error: any) {
        const criticalErrorMsg = error instanceof Error ? error.message : "An unknown critical error occurred";
        logToFile(`${baseLogContext} CRITICAL Error in handleStreaming: ${criticalErrorMsg}\nStack: ${error.stack}`);
        if (socket.connected) safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg, step: 'handler_critical_error' });
        return completeHistoryToSave; // Trả về lịch sử hiện tại trong trường hợp lỗi nghiêm trọng
    }
    finally {
        logToFile(`--- ${baseLogContext} STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}