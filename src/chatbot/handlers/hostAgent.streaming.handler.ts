// src/chatbot/handlers/hostAgent.streaming.handler.ts
import { Socket } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import { Tool, Part, GenerateContentResponse, GenerateContentConfig, Content } from '@google/genai';
import { ChatHistoryItem, FrontendAction, Language, AgentId, ThoughtStep, StatusUpdate, ResultUpdate, ErrorUpdate, ChatUpdate, AgentCardRequest, AgentCardResponse, PersonalizationPayload, OriginalUserFileInfo } from '../shared/types';
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
    handlerId: string,
    deps: HostAgentHandlerCustomDeps,
    onActionGenerated?: (action: FrontendAction) => void,
    frontendMessageId?: string,
    personalizationData?: PersonalizationPayload | null,
    originalUserFiles?: OriginalUserFileInfo[],
    pageContextText?: string,
    pageContextUrl?: string // <<< THÊM PARAMETER

): Promise<ChatHistoryItem[] | void> {
    const { geminiServiceForHost, hostAgentGenerationConfig, logToFile, allowedSubAgents, maxTurnsHostAgent, callSubAgentHandler } = deps;
    const baseLogContext = `[${handlerId} Streaming Socket ${socket.id}]`;
    const inputTextSummary = userInputParts.find(p => p.text)?.text || (userInputParts.length > 0 ? `[${userInputParts.length} parts content]` : "[No user text query]");

    logToFile(`--- ${baseLogContext} Handling inputParts: "${inputTextSummary.substring(0, 50)}...", Lang: ${language}, Personalization: ${!!personalizationData}` +
        (pageContextText ? `, PageContext: Present (len ${pageContextText.length})` : ``) + ` ---`);
    logToFile(`[DEBUG] ${baseLogContext} Initial history from socket (length ${initialHistoryFromSocket.length}): ${initialHistoryFromSocket.map(m => m.uuid).join(', ')}`);

    const conversationIdForSubAgent = handlerId;

    // <<< SỬA ĐỔI ĐỂ TRUYỀN PAGE CONTEXT VÀO LANGUAGE CONFIG >>>
    const { systemInstructions, functionDeclarations } = getAgentLanguageConfig(
        language,
        'HostAgent',
        personalizationData,
        pageContextText // <<< TRUYỀN PAGE CONTEXT
    );
    const hostAgentTools: Tool[] = functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];

    let completeHistoryToSave: ChatHistoryItem[] = [...initialHistoryFromSocket];
    let historyForApiCall: ChatHistoryItem[] = []; // Sẽ được xây dựng cẩn thận

    // <<< XỬ LÝ PAGE CONTEXT CHO HISTORY API CALL >>>
    if (pageContextText) {
        const pageContextTurn: ChatHistoryItem = {
            role: 'user', // Coi như một tin nhắn user "ngầm"
            parts: [{ text: pageContextText }],
            uuid: `context-${handlerId}-${Date.now()}`, // ID tạm thời, không lưu DB
            timestamp: new Date(Date.now() - 1000) // Thời gian trước tin nhắn user thật một chút
            // Không có userFileInfo cho context này
        };
        historyForApiCall.push(pageContextTurn);
        logToFile(`${baseLogContext} Added page context as a pseudo user turn to API history. UUID: ${pageContextTurn.uuid}`);
    }
    // Thêm lịch sử thật từ DB vào sau context (nếu có)
    historyForApiCall.push(...initialHistoryFromSocket);
    // <<< KẾT THÚC XỬ LÝ PAGE CONTEXT CHO HISTORY API CALL >>>


    const allThoughtsCollectedStreaming: ThoughtStep[] = [];
    let finalFrontendActionStreaming: FrontendAction | undefined = undefined;

    const currentUserTurn: ChatHistoryItem = {
        role: 'user',
        parts: userInputParts, // userInputParts đã được làm sạch ở message.handler
        timestamp: new Date(),
        uuid: frontendMessageId || `user-stream-${handlerId}-${Date.now()}`,
        userFileInfo: originalUserFiles && originalUserFiles.length > 0 ? originalUserFiles : undefined
    };

    // Chỉ thêm currentUserTurn vào completeHistoryToSave nếu nó có nội dung (parts)
    // hoặc nếu không có parts nhưng có pageContext (trường hợp user chỉ gửi @currentpage)
    if (currentUserTurn.parts.length > 0 || pageContextText) {
        completeHistoryToSave.push(currentUserTurn);
        logToFile(`${baseLogContext} User turn (UUID: ${currentUserTurn.uuid}) constructed and added to completeHistoryToSave. ` +
            `userFileInfo: ${currentUserTurn.userFileInfo ? currentUserTurn.userFileInfo.length + ' files' : 'none'}. ` +
            `completeHistoryToSave length: ${completeHistoryToSave.length}.`);
    } else {
        logToFile(`${baseLogContext} User turn (UUID: ${currentUserTurn.uuid}) has no parts and no page context, not added to completeHistoryToSave.`);
    }

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
                 // Đảm bảo data.sources được truyền nếu có
                    if ((data as ResultUpdate).sources) { // data ở đây là ResultUpdate
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

            // Lịch sử gửi cho API ở lượt này:
            // - Lượt 1: historyForApiCall (đã có pageContext nếu có, và initialHistoryFromSocket)
            //            + nextTurnInputForLlm (là userInputParts)
            // - Các lượt sau: historyForApiCall (đã được cập nhật với model_FC và function_FR)
            //            + nextTurnInputForLlm (là function_response_part)
            const currentApiHistoryForThisCall = [...historyForApiCall]; // Tạo bản sao để log và sử dụng

            logToFile(`--- ${turnLogContext} Start --- Input Parts for LLM (nextTurnInputForLlm length ${nextTurnInputForLlm.length}): "${nextTurnInputForLlm.find(p => p.text)?.text?.substring(0, 30) || (nextTurnInputForLlm.length > 0 ? '[non-text]' : '[empty input]')}..." ---`);
            logToFile(`--- ${turnLogContext} API History (currentApiHistoryForThisCall length ${currentApiHistoryForThisCall.length}): ${currentApiHistoryForThisCall.map(m => m.role + ':' + (m.uuid || 'no-uuid')).join(', ')} ---`);

            if (!hostAgentStreamingStatusUpdateCallback('status_update', { type: 'status', step: 'thinking', message: currentHostTurn > 1 ? `Continuing process (Turn ${currentHostTurn})...` : 'Thinking...' })) return completeHistoryToSave;
            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected before Host model call.`); return completeHistoryToSave; }

            const combinedConfig: GenerateContentConfig & { systemInstruction?: string | Part | Content; tools?: Tool[] } = {
                ...hostAgentGenerationConfig, systemInstruction: systemInstructions, tools: hostAgentTools
            };

            const hostAgentLLMResult = await geminiServiceForHost.generateStream(
                nextTurnInputForLlm,
                currentApiHistoryForThisCall, // Sử dụng bản sao đã chuẩn bị
                combinedConfig
            );

            if (!socket.connected) { logToFile(`${turnLogContext} Abort - Disconnected after Host model call initiated.`); return completeHistoryToSave; }

            // Cập nhật historyForApiCall cho lượt TIẾP THEO (nếu có function call)
            // Thêm lượt input (user hoặc function response part) mà LLM vừa xử lý vào historyForApiCall
            if (currentHostTurn === 1) {
                // Lượt đầu tiên, nextTurnInputForLlm là userInputParts (currentUserTurn)
                // Chỉ thêm nếu currentUserTurn có nội dung
                if (currentUserTurn.parts.length > 0 || pageContextText) {
                    historyForApiCall.push(currentUserTurn);
                }
            } else {
                // Các lượt sau, nextTurnInputForLlm là functionResponseContentPart.
                const lastFunctionResponseTurnInComplete = completeHistoryToSave.find(
                    msg => msg.role === 'function' && msg.parts[0] === nextTurnInputForLlm[0]
                );
                if (lastFunctionResponseTurnInComplete) {
                    historyForApiCall.push(lastFunctionResponseTurnInComplete);
                } else {
                    logToFile(`[WARN] ${turnLogContext} Could not find exact function response turn in completeHistoryToSave to add to historyForApiCall.`);
                }
            }
            logToFile(`${turnLogContext} Updated historyForApiCall (after adding current input turn, length ${historyForApiCall.length}): ${historyForApiCall.map(m => m.role + ':' + (m.uuid || 'no-uuid')).join(', ')}`);


            if (hostAgentLLMResult.error) {
                logToFile(`${turnLogContext} Error - HostAgent model error: ${hostAgentLLMResult.error}`);
                safeEmitStreaming('chat_error', { type: 'error', message: hostAgentLLMResult.error, step: 'host_llm_error' });
                return completeHistoryToSave; // Trả về lịch sử đã có currentUserTurn
            } else if (hostAgentLLMResult.functionCall) {
                const functionCall = hostAgentLLMResult.functionCall;
                const modelUuid = uuidv4();
                const modelFunctionCallTurn: ChatHistoryItem = {
                    role: 'model', parts: [{ functionCall: functionCall }], uuid: modelUuid, timestamp: new Date()
                };

                completeHistoryToSave.push(modelFunctionCallTurn);
                historyForApiCall.push(modelFunctionCallTurn); // Thêm lượt model (function call) vào lịch sử cho lượt API tiếp theo
                logToFile(`${turnLogContext} HostAgent requests function: ${functionCall.name}. completeHistoryToSave length: ${completeHistoryToSave.length}, historyForApiCall length: ${historyForApiCall.length}`);

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
                // KHÔNG thêm functionResponseTurn vào historyForApiCall ở đây,
                // vì nó sẽ được thêm vào đầu vòng lặp sau thông qua logic cập nhật historyForApiCall (else block)
                // nếu nó trở thành nextTurnInputForLlm.
                // Hoặc, nếu nextTurnInputForLlm là input cho lượt sau, thì historyForApiCall đã đúng (chứa model_FC).
                logToFile(`${turnLogContext} Appended function response for ${functionCall.name}. completeHistoryToSave length: ${completeHistoryToSave.length}`);

                nextTurnInputForLlm = [functionResponseContentPart]; // Đây sẽ là input cho lượt LLM tiếp theo
                currentHostTurn++;
                continue; // Tiếp tục vòng lặp để LLM xử lý function response
             } else if (hostAgentLLMResult.stream) {
                const streamOutput = await processAndEmitStream(hostAgentLLMResult.stream);
                if (streamOutput && socket.connected) {
                    const botMessageUuid = uuidv4();
                    const finalModelParts = streamOutput.parts && streamOutput.parts.length > 0 ? streamOutput.parts : [{ text: streamOutput.fullText }];
                    
                    const finalModelTurn: ChatHistoryItem = {
                        role: 'model',
                        parts: finalModelParts,
                        uuid: botMessageUuid,
                        timestamp: new Date(),
                        sources: [] // Khởi tạo mảng sources
                    };

                    // <<< THÊM PAGE CONTEXT URL VÀO SOURCES CỦA MODEL (CHỈ MỘT LẦN) >>>
                    if (pageContextUrl && pageContextText) { // Chỉ thêm nếu context thực sự được dùng (có text)
                        try {
                            const urlObj = new URL(pageContextUrl);
                            finalModelTurn.sources?.push({
                                name: urlObj.hostname, // Lấy domain làm tên
                                url: pageContextUrl,
                                type: 'page_context'
                            });
                        } catch (e) {
                            logToFile(`[WARN] ${turnLogContext} Invalid pageContextUrl: ${pageContextUrl}. Cannot extract hostname.`);
                            finalModelTurn.sources?.push({
                                name: pageContextUrl, // Dùng URL đầy đủ nếu không parse được
                                url: pageContextUrl,
                                type: 'page_context'
                            });
                        }
                    }
                    // Bạn có thể thêm logic để LLM tự xác định sources khác ở đây nếu cần (ví dụ từ nội dung trả về của LLM)

                    completeHistoryToSave.push(finalModelTurn);
                    
                    const resultPayload: ResultUpdate = { 
                        type: 'result', 
                        message: streamOutput.fullText, 
                        parts: finalModelParts, 
                        id: botMessageUuid,
                        sources: finalModelTurn.sources // <<< TRUYỀN SOURCES
                    };
                    safeEmitStreaming('chat_result', resultPayload);
                    
                    logToFile(`${turnLogContext} Stream processed. Final model turn UUID: ${botMessageUuid} added. Sources: ${JSON.stringify(finalModelTurn.sources)}. completeHistoryToSave length: ${completeHistoryToSave.length}`);
                    return completeHistoryToSave; // Kết thúc và trả về lịch sử hoàn chỉnh
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
        } // Kết thúc while loop

        if (currentHostTurn > maxTurnsHostAgent) {
            logToFile(`${baseLogContext} Error - Exceeded maximum HostAgent turns (${maxTurnsHostAgent}).`);
            safeEmitStreaming('chat_error', { type: 'error', message: 'Processing took too long or got stuck in a loop (streaming).', step: 'max_turns_exceeded_stream' });
        }
        // Nếu vòng lặp kết thúc mà không có return sớm (ví dụ do lỗi hoặc max_turns)
        // thì trả về completeHistoryToSave hiện tại.
        return completeHistoryToSave;
    } catch (error: any) {
        const criticalErrorMsg = error instanceof Error ? error.message : "An unknown critical error occurred";
        logToFile(`${baseLogContext} CRITICAL Error - Lang: ${language}] ${criticalErrorMsg}\nStack: ${error.stack}`);
        if (socket.connected) safeEmitStreaming('chat_error', { type: "error", message: criticalErrorMsg, step: 'unknown_handler_error_stream' });
        return completeHistoryToSave; // Trả về lịch sử đã có currentUserTurn
    }
    finally {
        logToFile(`--- ${baseLogContext} Lang: ${language}] STREAMING Handler execution finished. (Socket connected: ${socket.connected}) ---`);
    }
}